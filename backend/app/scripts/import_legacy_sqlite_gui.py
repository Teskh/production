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


def _run_tk_ui() -> None:
    import tkinter as tk
    from tkinter import filedialog, messagebox, scrolledtext

    def append_output(output: scrolledtext.ScrolledText, text: str) -> None:
        output.configure(state="normal")
        output.insert(tk.END, text)
        output.see(tk.END)
        output.configure(state="disabled")

    root = tk.Tk()
    root.title("Legacy SQLite Import")

    sqlite_var = tk.StringVar(value=str(DEFAULT_SQLITE))
    mode_var = tk.StringVar(value="report")
    allow_existing_var = tk.BooleanVar(value=False)
    truncate_var = tk.BooleanVar(value=False)
    section_vars: dict[str, tk.BooleanVar] = {
        key: tk.BooleanVar(value=True) for key, _ in SECTION_OPTIONS
    }

    path_frame = tk.Frame(root, padx=10, pady=10)
    path_frame.pack(fill="x")

    tk.Label(path_frame, text="SQLite file").pack(anchor="w")
    path_row = tk.Frame(path_frame)
    path_row.pack(fill="x")
    path_entry = tk.Entry(path_row, textvariable=sqlite_var)
    path_entry.pack(side="left", fill="x", expand=True)

    def browse() -> None:
        selected = filedialog.askopenfilename(
            initialdir=str(DEFAULT_SQLITE.parent),
            title="Select sqlite database",
            filetypes=[
                ("SQLite DB", "*.db *.sqlite *.sqlite3"),
                ("All files", "*.*"),
            ],
        )
        if selected:
            sqlite_var.set(selected)

    tk.Button(path_row, text="Browse", command=browse).pack(side="left", padx=6)

    mode_frame = tk.LabelFrame(root, text="Mode", padx=10, pady=10)
    mode_frame.pack(fill="x", padx=10)

    def update_mode(*_args: object) -> None:
        is_import = mode_var.get() == "import"
        state = "normal" if is_import else "disabled"
        allow_checkbox.configure(state=state)
        truncate_checkbox.configure(state=state)
        for widget in section_frame.winfo_children():
            widget.configure(state=state)

    tk.Radiobutton(
        mode_frame, text="Report (read-only)", variable=mode_var, value="report",
        command=update_mode
    ).pack(anchor="w")
    tk.Radiobutton(
        mode_frame, text="Import (write to DB)", variable=mode_var, value="import",
        command=update_mode
    ).pack(anchor="w")

    section_frame = tk.LabelFrame(root, text="Sections (import only)", padx=10, pady=10)
    section_frame.pack(fill="x", padx=10, pady=(6, 0))

    for key, label in SECTION_OPTIONS:
        tk.Checkbutton(
            section_frame, text=label, variable=section_vars[key]
        ).pack(anchor="w")

    options_frame = tk.LabelFrame(root, text="Options (import only)", padx=10, pady=10)
    options_frame.pack(fill="x", padx=10, pady=(6, 0))

    allow_checkbox = tk.Checkbutton(
        options_frame, text="Allow existing rows (merge/upsert)", variable=allow_existing_var
    )
    allow_checkbox.pack(anchor="w")

    truncate_checkbox = tk.Checkbutton(
        options_frame, text="Truncate config tables before import", variable=truncate_var
    )
    truncate_checkbox.pack(anchor="w")

    output_frame = tk.LabelFrame(root, text="Output", padx=10, pady=10)
    output_frame.pack(fill="both", expand=True, padx=10, pady=10)

    output = scrolledtext.ScrolledText(output_frame, height=16, state="disabled")
    output.pack(fill="both", expand=True)

    def run() -> None:
        sqlite_path = Path(sqlite_var.get()).expanduser()
        if not sqlite_path.exists():
            messagebox.showerror("Missing file", f"SQLite file not found: {sqlite_path}")
            return
        mode = mode_var.get()
        sections = {key for key, var in section_vars.items() if var.get()}
        if mode == "import" and truncate_var.get():
            confirm = messagebox.askyesno(
                "Confirm truncate",
                "This will delete config rows before import. Continue?",
            )
            if not confirm:
                return
        if mode == "report":
            append_output(output, "Running report...\n")
        else:
            if not sections:
                sections = {key for key, _ in SECTION_OPTIONS}
            append_output(output, f"Importing sections: {', '.join(sorted(sections))}\n")
        result = _run_legacy(
            sqlite_path,
            mode,
            sections,
            allow_existing_var.get(),
            truncate_var.get(),
        )
        append_output(output, result + "\n")

    def clear_output() -> None:
        output.configure(state="normal")
        output.delete("1.0", tk.END)
        output.configure(state="disabled")

    actions = tk.Frame(root, padx=10, pady=(0, 10))
    actions.pack(fill="x")
    tk.Button(actions, text="Run", command=run).pack(side="left")
    tk.Button(actions, text="Clear output", command=clear_output).pack(side="left", padx=6)

    update_mode()
    root.mainloop()


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
      <label><input type=\"checkbox\" name=\"truncate\" {checked(truncate)}> Truncate config tables before import</label>
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
        "sections": [key for key, _ in SECTION_OPTIONS],
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
        description="Launch a simple UI for the legacy sqlite import."
    )
    parser.add_argument(
        "--web",
        action="store_true",
        help="Force the web UI (skips tkinter).",
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

    if args.web:
        _run_web_ui(args.host, args.port)
        return

    try:
        _run_tk_ui()
    except ModuleNotFoundError:
        _run_web_ui(args.host, args.port)


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
