# PYTHONPATH=backend ./venv/bin/python -m app.scripts.import_legacy_sqlite_gui

from __future__ import annotations

import argparse
import contextlib
import html
import io
import os
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from app.scripts import import_legacy_sqlite as legacy


BASE_DIR = Path(__file__).resolve().parents[3]
DEFAULT_SQLITE = BASE_DIR / "docs/references/database.db"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8081
UNSAFE_PORTS = {6000}
SECTION_OPTIONS = (
    ("tasks", "Tasks"),
    ("houses", "House Types/Subtypes/Parameters"),
    ("panels", "Panel Definitions"),
    ("pause_reasons", "Pause Reasons"),
    ("comment_templates", "Comment Templates"),
    ("module_task_templates", "Task Applicability/Durations (module + panel)"),
    ("workers", "Workers"),
    ("specialties", "Specialties/Skills"),
    ("module_production", "Module Production Plan"),
    ("task_logs", "Task Logs (module)"),
    ("panel_task_logs", "Panel Task Logs"),
)


def _run_legacy(
    sqlite_path: Path,
    mode: str,
    sections: set[str],
    allow_existing: bool,
    truncate: bool,
) -> str:
    output_buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(output_buffer):
            if mode == "report":
                legacy._report(sqlite_path)
            else:
                legacy._import(sqlite_path, sections, allow_existing, truncate)
    except Exception as exc:
        output_buffer.write(f"\nERROR: {exc}\n")
    return output_buffer.getvalue()


def _render_page(state: dict[str, Any]) -> str:
    sqlite_path = html.escape(state.get("sqlite_path", str(DEFAULT_SQLITE)))
    mode = state.get("mode", "report")
    allow_existing = state.get("allow_existing", False)
    truncate = state.get("truncate", False)
    selected_sections = set(state.get("sections", []))
    output = html.escape(state.get("output", ""))

    def checked(condition: bool) -> str:
        return "checked" if condition else ""

    def selected(value: str) -> str:
        return "checked" if mode == value else ""

    section_html = []
    for key, label in SECTION_OPTIONS:
        section_html.append(
            f"<label><input type='checkbox' name='sections' value='{key}' "
            f"{checked(key in selected_sections)}> {html.escape(label)}</label>"
        )
    sections_block = "<br>".join(section_html)

    return f"""<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\">
  <title>Legacy SQLite Import</title>
    <style>
    body {{ font-family: Arial, sans-serif; margin: 20px; }}
    fieldset {{ margin-bottom: 16px; padding: 10px; }}
    legend {{ font-weight: bold; }}
    input[type=text] {{ width: 100%; padding: 6px; }}
    button {{ padding: 6px 12px; }}
    pre {{ background: #f5f5f5; padding: 10px; border: 1px solid #ddd; }}
    .help {{ color: #555; font-size: 0.9em; margin-left: 18px; margin-top: 4px; }}
  </style>
</head>
<body>
  <h2>Legacy SQLite Import</h2>
  <form method=\"post\" action=\"/run\">
    <fieldset>
      <legend>SQLite file</legend>
      <input type=\"text\" name=\"sqlite_path\" value=\"{sqlite_path}\">
    </fieldset>
    <fieldset>
      <legend>Mode</legend>
      <label><input type=\"radio\" name=\"mode\" value=\"report\" {selected('report')}> Report (read-only)</label><br>
      <label><input type=\"radio\" name=\"mode\" value=\"import\" {selected('import')}> Import (write to DB)</label>
    </fieldset>
    <fieldset>
      <legend>Sections (import only)</legend>
      {sections_block}
    </fieldset>
    <fieldset>
      <legend>Options (import only)</legend>
      <label><input type=\"checkbox\" name=\"allow_existing\" {checked(allow_existing)}> Allow existing rows (merge/upsert)</label><br>
      <div class=\"help\">Keeps existing rows and updates them instead of failing on duplicates.</div>
      <label><input type=\"checkbox\" name=\"truncate\" {checked(truncate)}> Truncate config tables before import</label>
      <div class=\"help\">Clears config tables first so the import replaces what is currently there.</div>
    </fieldset>
    <button type=\"submit\">Run</button>
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

    state: dict[str, Any] = {
        "sqlite_path": str(DEFAULT_SQLITE),
        "mode": "report",
        "sections": list(legacy.DEFAULT_SECTIONS),
        "allow_existing": False,
        "truncate": False,
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
            sqlite_path = params.get("sqlite_path", [str(DEFAULT_SQLITE)])[0].strip()
            mode = params.get("mode", ["report"])[0]
            sections = params.get("sections", [])
            allow_existing = "allow_existing" in params
            truncate = "truncate" in params

            state["sqlite_path"] = sqlite_path
            state["mode"] = mode
            state["sections"] = sections or [key for key, _ in SECTION_OPTIONS]
            state["allow_existing"] = allow_existing
            state["truncate"] = truncate

            result = _run_legacy(
                Path(sqlite_path).expanduser(),
                mode,
                set(state["sections"]),
                allow_existing,
                truncate,
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
        description="Launch the web UI for the legacy sqlite import."
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
        help="Port for the web UI (default: 8081).",
    )
    args = parser.parse_args()

    _run_web_ui(args.host, args.port)


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
