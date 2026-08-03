from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit


def app_base_path(config: object) -> str:
    value = str(getattr(config, "app_base_path", "") or "").strip()
    if not value or value == "/":
        return ""
    return f"/{value.strip('/')}"


def external_path(path: str, config: object) -> str:
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc:
        raise ValueError("External application paths must be relative to the public origin")

    base = app_base_path(config)
    current_path = parsed.path or "/"
    if base and current_path != base and not current_path.startswith(f"{base}/"):
        current_path = f"{base}{current_path if current_path.startswith('/') else f'/{current_path}'}"
    if base and current_path == base:
        current_path = f"{base}/"
    return urlunsplit(("", "", current_path, parsed.query, parsed.fragment))


def internal_path(path: str, config: object) -> str:
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc:
        return path
    base = app_base_path(config)
    current_path = parsed.path or "/"
    if base and current_path == base:
        current_path = "/"
    elif base and current_path.startswith(f"{base}/"):
        current_path = current_path[len(base) :]
    return urlunsplit(("", "", current_path, parsed.query, parsed.fragment))


def session_cookie_path(config: object) -> str:
    return app_base_path(config) or "/"
