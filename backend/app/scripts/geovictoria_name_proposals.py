from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
import zipfile
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable, Mapping

import httpx

from app.core.config import settings

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PARTIDAS_PATH = REPO_ROOT / "docs" / "references" / "partidas.csv"
SHEET_XML = "xl/worksheets/sheet1.xml"
SHARED_STRINGS_XML = "xl/sharedStrings.xml"


@dataclass(frozen=True)
class GeoVictoriaUser:
    geovictoria_id: str | None
    identifier: str | None
    first_name: str | None
    last_name: str | None

    @property
    def full_name(self) -> str:
        return " ".join(part for part in [self.first_name, self.last_name] if part)


@dataclass(frozen=True)
class MatchSuggestion:
    name: str
    candidate: GeoVictoriaUser
    score: float


def _require_credentials() -> tuple[str, str]:
    user = settings.geovictoria_api_user
    password = settings.geovictoria_api_password
    if not user or not password:
        raise RuntimeError("GeoVictoria credentials not configured in environment.")
    return user, password


def _get_token() -> str:
    user, password = _require_credentials()
    resp = httpx.post(
        f"{settings.geovictoria_base_url}/Login",
        json={"User": user, "Password": password},
        timeout=30,
    )
    resp.raise_for_status()
    token = resp.json().get("token")
    if not token:
        raise RuntimeError("GeoVictoria auth did not return a token.")
    return token


def _post_geovictoria(endpoint: str, token: str) -> Any:
    resp = httpx.post(
        f"{settings.geovictoria_base_url}/{endpoint.lstrip('/')}",
        headers={"Authorization": f"Bearer {token}"},
        json={},
        timeout=60,
    )
    if resp.status_code in (401, 403):
        token = _get_token()
        resp = httpx.post(
            f"{settings.geovictoria_base_url}/{endpoint.lstrip('/')}",
            headers={"Authorization": f"Bearer {token}"},
            json={},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.json()


def _extract_users(payload: Any) -> list[Mapping[str, object]]:
    if isinstance(payload, list):
        return [v for v in payload if isinstance(v, Mapping)]
    if isinstance(payload, Mapping):
        for key in ("Data", "Users", "Lista"):
            value = payload.get(key)
            if isinstance(value, list):
                return [v for v in value if isinstance(v, Mapping)]
    return []


def _normalize_user(raw: Mapping[str, object]) -> GeoVictoriaUser:
    def _get_str(key: str) -> str | None:
        value = raw.get(key)
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    geovictoria_id = _get_str("Id") or _get_str("ID") or _get_str("UserId") or _get_str("UserID")
    identifier = _get_str("Identifier")
    first_name = _get_str("Name")
    last_name = _get_str("LastName") or _get_str("Lastname")
    return GeoVictoriaUser(
        geovictoria_id=geovictoria_id,
        identifier=identifier,
        first_name=first_name,
        last_name=last_name,
    )


def fetch_geovictoria_users() -> list[GeoVictoriaUser]:
    token = _get_token()
    payload = _post_geovictoria("User/List", token)
    return [_normalize_user(user) for user in _extract_users(payload)]


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def _normalize_name(value: str) -> str:
    value = _strip_accents(value)
    value = re.sub(r"[^a-zA-Z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", value)


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def _best_matches(name: str, users: Iterable[GeoVictoriaUser], *, top: int) -> list[MatchSuggestion]:
    normalized_target = _normalize_name(name)
    matches: list[MatchSuggestion] = []
    for user in users:
        full_name = user.full_name
        if not full_name:
            continue
        normalized_full = _normalize_name(full_name)
        reversed_full = _normalize_name(" ".join(part for part in [user.last_name, user.first_name] if part))
        score = max(
            _similarity(normalized_target, normalized_full),
            _similarity(normalized_target, reversed_full),
        )
        matches.append(MatchSuggestion(name=name, candidate=user, score=score))
    matches.sort(key=lambda item: item.score, reverse=True)
    return matches[:top]


def _column_index(cell_ref: str) -> int:
    match = re.match(r"([A-Z]+)", cell_ref)
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_ref}")
    letters = match.group(1)
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - 64)
    return idx - 1


def _index_to_column(index: int) -> str:
    if index < 0:
        raise ValueError("Column index must be non-negative.")
    letters: list[str] = []
    value = index + 1
    while value:
        value, remainder = divmod(value - 1, 26)
        letters.append(chr(65 + remainder))
    return "".join(reversed(letters))


def _read_xlsx_rows(path: Path) -> list[list[str]]:
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(path) as zf:
        shared = ET.fromstring(zf.read(SHARED_STRINGS_XML))
        strings = [
            text.text or ""
            for text in shared.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
        ]
        sheet = ET.fromstring(zf.read(SHEET_XML))

    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows: list[list[str]] = []
    for row in sheet.findall("m:sheetData/m:row", ns):
        cells: dict[int, str] = {}
        for cell in row.findall("m:c", ns):
            cell_ref = cell.get("r")
            if not cell_ref:
                continue
            idx = _column_index(cell_ref)
            value_el = cell.find("m:v", ns)
            value = "" if value_el is None else value_el.text or ""
            if cell.get("t") == "s":
                try:
                    value = strings[int(value)]
                except (ValueError, IndexError):
                    value = ""
            cells[idx] = value
        max_idx = max(cells) if cells else -1
        rows.append([cells.get(i, "") for i in range(max_idx + 1)])
    return rows


def _extract_worker_names(rows: list[list[str]]) -> list[str]:
    if not rows:
        return []
    header = rows[0]
    try:
        names_idx = header.index("Nombres de los trabajadores")
    except ValueError as exc:
        raise RuntimeError("Missing 'Nombres de los trabajadores' column in partidas sheet.") from exc

    raw_names: list[str] = []
    for row in rows[1:]:
        if names_idx >= len(row):
            continue
        cell = row[names_idx].strip()
        if not cell:
            continue
        if ";" in cell:
            parts = [part.strip() for part in cell.split(";")]
        elif "," in cell:
            parts = [part.strip() for part in cell.split(",")]
        else:
            parts = [cell]
        raw_names.extend([part for part in parts if part])
    return sorted(set(raw_names))


def _extract_worker_cells(
    rows: list[list[str]],
) -> tuple[int, list[str], list[list[str]]]:
    if not rows:
        raise RuntimeError("Partidas file has no rows.")
    header = rows[0]
    try:
        names_idx = header.index("Nombres de los trabajadores")
    except ValueError as exc:
        raise RuntimeError("Missing 'Nombres de los trabajadores' column in partidas sheet.") from exc
    return names_idx, header, rows[1:]


def _split_names(cell: str) -> list[str]:
    if ";" in cell:
        parts = [part.strip() for part in cell.split(";")]
    elif "," in cell:
        parts = [part.strip() for part in cell.split(",")]
    else:
        parts = [cell.strip()]
    return [part for part in parts if part]


def _select_name(
    name: str,
    users: Iterable[GeoVictoriaUser],
    min_score: float,
) -> tuple[str, float | None, GeoVictoriaUser | None]:
    matches = _best_matches(name, users, top=1)
    if not matches:
        return name, None, None
    best = matches[0]
    if best.score < min_score:
        return name, best.score, best.candidate
    return best.candidate.full_name, best.score, best.candidate


def _build_updated_rows(
    rows: list[list[str]],
    users: Iterable[GeoVictoriaUser],
    min_score: float,
) -> list[list[str]]:
    names_idx, header, data_rows = _extract_worker_cells(rows)
    updated_header = header + ["Nombres de trabajadores (GeoVictoria)"]
    updated_rows = [updated_header]
    for row in data_rows:
        cell = row[names_idx].strip() if names_idx < len(row) else ""
        if cell:
            selected = []
            for name in _split_names(cell):
                replacement, _score, _user = _select_name(name, users, min_score)
                selected.append(replacement)
            selected_cell = ";".join(selected)
        else:
            selected_cell = ""
        updated_rows.append(row + [selected_cell])
    return updated_rows


def _build_shared_strings(rows: list[list[str]]) -> tuple[dict[str, int], str]:
    import xml.etree.ElementTree as ET

    strings: list[str] = []
    index: dict[str, int] = {}
    for row in rows:
        for value in row:
            if value == "":
                continue
            if value not in index:
                index[value] = len(strings)
                strings.append(value)

    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    sst = ET.Element(
        "sst",
        xmlns=ns,
        count=str(len(strings)),
        uniqueCount=str(len(strings)),
    )
    for value in strings:
        si = ET.SubElement(sst, "si")
        t = ET.SubElement(si, "t")
        t.text = value
    return index, ET.tostring(sst, encoding="utf-8", xml_declaration=True).decode("utf-8")


def _build_sheet_xml(rows: list[list[str]], string_index: Mapping[str, int]) -> str:
    import xml.etree.ElementTree as ET

    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    worksheet = ET.Element("worksheet", xmlns=ns)
    sheet_data = ET.SubElement(worksheet, "sheetData")
    for row_idx, row in enumerate(rows, start=1):
        row_el = ET.SubElement(sheet_data, "row", r=str(row_idx))
        for col_idx, value in enumerate(row):
            if value == "":
                continue
            cell_ref = f"{_index_to_column(col_idx)}{row_idx}"
            cell_el = ET.SubElement(row_el, "c", r=cell_ref, t="s")
            v_el = ET.SubElement(cell_el, "v")
            v_el.text = str(string_index[value])
    return ET.tostring(worksheet, encoding="utf-8", xml_declaration=True).decode("utf-8")


def _write_updated_xlsx(path: Path, output_path: Path, rows: list[list[str]]) -> None:
    string_index, shared_xml = _build_shared_strings(rows)
    sheet_xml = _build_sheet_xml(rows, string_index)
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(output_path, "w") as dest:
        for info in src.infolist():
            if info.filename in {SHEET_XML, SHARED_STRINGS_XML}:
                continue
            dest.writestr(info, src.read(info.filename))
        dest.writestr(SHEET_XML, sheet_xml)
        dest.writestr(SHARED_STRINGS_XML, shared_xml)


def _write_csv(path: Path, rows: Iterable[Mapping[str, object]]) -> None:
    rows = list(rows)
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Suggest GeoVictoria worker name replacements for partidas.",
    )
    parser.add_argument(
        "--partidas",
        type=Path,
        default=DEFAULT_PARTIDAS_PATH,
        help="Path to partidas file (xlsx content stored as .csv).",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=0.58,
        help="Minimum similarity score to consider a match (0-1).",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=3,
        help="Number of candidate matches to show per name.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional output CSV path for suggestions.",
    )
    parser.add_argument(
        "--updated-partidas",
        type=Path,
        default=None,
        help="Optional output path for partidas with GeoVictoria name column.",
    )
    parser.add_argument(
        "--skip-updated",
        action="store_true",
        help="Skip writing the updated partidas file.",
    )
    args = parser.parse_args()

    partidas_path = args.partidas
    if not partidas_path.exists():
        print(f"Partidas file not found: {partidas_path}", file=sys.stderr)
        return 1

    try:
        rows = _read_xlsx_rows(partidas_path)
    except zipfile.BadZipFile as exc:
        print(f"Partidas file is not a valid xlsx/zip: {exc}", file=sys.stderr)
        return 1

    if not rows:
        print("No rows found in partidas file.")
        return 0

    try:
        users = fetch_geovictoria_users()
    except Exception as exc:
        print(f"Failed to fetch GeoVictoria users: {exc}", file=sys.stderr)
        return 2

    try:
        worker_names = _extract_worker_names(rows)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if not worker_names:
        print("No worker names found in partidas file.")
        return 0

    output_rows: list[dict[str, object]] = []
    for name in worker_names:
        matches = _best_matches(name, users, top=args.top)
        if not matches:
            print(f"{name}: no GeoVictoria candidates found.")
            continue
        best = matches[0]
        if best.score < args.min_score:
            print(f"{name}: no match above threshold (best {best.score:.2f}).")
            continue

        print(f"{name} -> {best.candidate.full_name} ({best.score:.2f})")
        for alt in matches[1:]:
            print(f"  alt: {alt.candidate.full_name} ({alt.score:.2f})")

        output_rows.append(
            {
                "original_name": name,
                "proposed_name": best.candidate.full_name,
                "geovictoria_id": best.candidate.geovictoria_id or "",
                "geovictoria_identifier": best.candidate.identifier or "",
                "score": round(best.score, 3),
                "alternates": "; ".join(
                    f"{alt.candidate.full_name} ({alt.score:.2f})" for alt in matches[1:]
                ),
            }
        )

    if args.output:
        _write_csv(args.output, output_rows)
        print(f"Wrote suggestions to {args.output}")

    if not args.skip_updated:
        updated_path = args.updated_partidas
        if updated_path is None:
            updated_path = partidas_path.with_name(f"{partidas_path.stem}_geovictoria.xlsx")
        updated_rows = _build_updated_rows(rows, users, args.min_score)
        _write_updated_xlsx(partidas_path, updated_path, updated_rows)
        print(f"Wrote updated partidas to {updated_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
