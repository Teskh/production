from __future__ import annotations

import argparse
import contextlib
import html
import io
import os
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import HouseType
from app.scripts import partidas_task_import as partidas


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8082
UNSAFE_PORTS = {6000}


def _load_house_types() -> list[HouseType]:
    with SessionLocal() as session:
        return list(session.execute(select(HouseType).order_by(HouseType.name)).scalars())


def _run_import(
    house_type_id: int,
    partidas_path: Path,
    prefer_geovictoria: bool,
    reset_regular_crew: bool,
    reset_expected_durations: bool,
) -> str:
    output_buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(output_buffer):
            result = partidas.run_partidas_import(
                house_type_id=house_type_id,
                partidas_path=partidas_path,
                prefer_geovictoria=prefer_geovictoria,
                reset_regular_crew=reset_regular_crew,
                reset_expected_durations=reset_expected_durations,
            )
            output_buffer.write(result)
    except Exception as exc:
        output_buffer.write(f"\nERROR: {exc}\n")
    return output_buffer.getvalue()


def _render_page(state: dict[str, Any]) -> str:
    house_types = state.get("house_types", [])
    selected_house_type = str(state.get("house_type_id", ""))
    partidas_path = html.escape(state.get("partidas_path", ""))
    prefer_geovictoria = state.get("prefer_geovictoria", True)
    reset_regular_crew = state.get("reset_regular_crew", True)
    reset_expected_durations = state.get("reset_expected_durations", True)
    output = html.escape(state.get("output", ""))

    def checked(condition: bool) -> str:
        return "checked" if condition else ""

    options = []
    for house_type in house_types:
        selected = "selected" if str(house_type.id) == selected_house_type else ""
        label = html.escape(f"{house_type.name} (id {house_type.id})")
        options.append(
            f"<option value='{house_type.id}' {selected}>{label}</option>"
        )
    options_html = "\n".join(options)

    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Partidas Task Import</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 20px; }}
    fieldset {{ margin-bottom: 16px; padding: 10px; }}
    legend {{ font-weight: bold; }}
    input[type=text], select {{ width: 100%; padding: 6px; }}
    button {{ padding: 6px 12px; }}
    pre {{ background: #f5f5f5; padding: 10px; border: 1px solid #ddd; }}
    .help {{ color: #555; font-size: 0.9em; margin-top: 6px; }}
  </style>
</head>
<body>
  <h2>Partidas Task Import</h2>
  <form method="post" action="/run">
    <fieldset>
      <legend>House Type</legend>
      <select name="house_type_id">{options_html}</select>
    </fieldset>
    <fieldset>
      <legend>Partidas file</legend>
      <input type="text" name="partidas_path" value="{partidas_path}">
      <div class="help">Default: {html.escape(str(partidas.DEFAULT_PARTIDAS_PATH))}</div>
    </fieldset>
    <fieldset>
      <legend>Options</legend>
      <label><input type="checkbox" name="prefer_geovictoria" {checked(prefer_geovictoria)}> Prefer GeoVictoria worker names</label><br>
      <label><input type="checkbox" name="reset_regular_crew" {checked(reset_regular_crew)}> Reset regular crew to partidas names</label><br>
      <label><input type="checkbox" name="reset_expected_durations" {checked(reset_expected_durations)}> Reset expected durations for this house type</label>
    </fieldset>
    <button type="submit">Run</button>
  </form>
  <h3>Output</h3>
  <pre>{output}</pre>
</body>
</html>"""


def _sanitize_port(port: int) -> int:
    if port in UNSAFE_PORTS:
        print(f"Port {port} is blocked by browsers; using {DEFAULT_PORT} instead.")
        return DEFAULT_PORT
    return port


def _run_web_ui(host: str, port: int) -> None:
    from http.server import BaseHTTPRequestHandler, HTTPServer

    house_types = _load_house_types()
    default_house_type_id = house_types[0].id if house_types else ""
    state: dict[str, Any] = {
        "house_types": house_types,
        "house_type_id": default_house_type_id,
        "partidas_path": str(partidas._ensure_partidas_path(None)),
        "prefer_geovictoria": True,
        "reset_regular_crew": True,
        "reset_expected_durations": True,
        "output": "",
    }

    class Handler(BaseHTTPRequestHandler):
        def _send(self, content: str) -> None:
            body = content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path not in ("/", ""):
                self.send_error(404)
                return
            self._send(_render_page(state))

        def do_POST(self) -> None:
            if self.path != "/run":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            payload = self.rfile.read(length).decode("utf-8")
            params = parse_qs(payload)

            house_type_id = params.get("house_type_id", [state["house_type_id"]])[0]
            partidas_path = params.get("partidas_path", [state["partidas_path"]])[0].strip()
            prefer_geovictoria = "prefer_geovictoria" in params
            reset_regular_crew = "reset_regular_crew" in params
            reset_expected_durations = "reset_expected_durations" in params

            state["house_type_id"] = house_type_id
            state["partidas_path"] = partidas_path
            state["prefer_geovictoria"] = prefer_geovictoria
            state["reset_regular_crew"] = reset_regular_crew
            state["reset_expected_durations"] = reset_expected_durations

            try:
                house_type_id_int = int(house_type_id)
            except ValueError:
                state["output"] = "ERROR: invalid house type selection."
                self._send(_render_page(state))
                return

            result = _run_import(
                house_type_id_int,
                Path(partidas_path).expanduser(),
                prefer_geovictoria,
                reset_regular_crew,
                reset_expected_durations,
            )
            state["output"] = result
            self._send(_render_page(state))

    port = _sanitize_port(port)
    server = HTTPServer((host, port), Handler)
    url = f"http://{host}:{port}/"
    print(f"Open {url} in a browser.")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Launch the web UI for importing partidas tasks."
    )
    parser.add_argument(
        "--host",
        type=str,
        default=DEFAULT_HOST,
        help="Host for the web UI (default: 127.0.0.1).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="Port for the web UI (default: 8082).",
    )
    args = parser.parse_args()

    _run_web_ui(args.host, args.port)


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
