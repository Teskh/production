from __future__ import annotations

import difflib
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - dependency availability is environment-specific
    PdfReader = None


DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_MIME_TYPE = "application/pdf"
ALLOWED_PROTOCOL_MIME_TYPES = {DOCX_MIME_TYPE, PDF_MIME_TYPE}
ALLOWED_PROTOCOL_EXTENSIONS = {".docx", ".pdf"}


@dataclass(frozen=True)
class ProtocolDiffEntry:
    kind: str
    document_name: str
    added_lines: int = 0
    removed_lines: int = 0
    diff_excerpt: str | None = None


def safe_protocol_filename(filename: str) -> str:
    candidate = Path(filename or "").name.strip()
    if not candidate:
        return "documento"
    return re.sub(r"[^A-Za-z0-9._-]+", "_", candidate)


def normalized_protocol_document_name(filename: str) -> str:
    return safe_protocol_filename(filename).casefold()


def normalize_signature_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"\s+", " ", text).strip().casefold()
    return text


def resolve_protocol_content_type(filename: str, content_type: str | None) -> str | None:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_PROTOCOL_EXTENSIONS:
        return None
    if content_type in ALLOWED_PROTOCOL_MIME_TYPES:
        return content_type
    if suffix == ".pdf":
        return PDF_MIME_TYPE
    if suffix == ".docx":
        return DOCX_MIME_TYPE
    return None


def extract_protocol_document_text(path: Path, mime_type: str) -> str:
    try:
        if mime_type == PDF_MIME_TYPE:
            return _extract_pdf_text(path)
        if mime_type == DOCX_MIME_TYPE:
            return _extract_docx_text(path)
    except Exception:
        return ""
    return ""


def _extract_pdf_text(path: Path) -> str:
    if PdfReader is None:
        return ""
    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            parts.append(text.strip())
    return "\n\n".join(parts).strip()


def _extract_docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        with archive.open("word/document.xml") as handle:
            root = ElementTree.parse(handle).getroot()
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        pieces = [
            node.text.strip()
            for node in paragraph.findall(".//w:t", namespace)
            if node.text and node.text.strip()
        ]
        if pieces:
            paragraphs.append("".join(pieces))
    return "\n".join(paragraphs).strip()


def build_protocol_diff(
    previous_documents: list[tuple[str, str | None, str]],
    current_documents: list[tuple[str, str | None, str]],
) -> list[ProtocolDiffEntry]:
    previous_map = {
        normalized_protocol_document_name(name): (name, text or "", checksum)
        for name, text, checksum in previous_documents
    }
    current_map = {
        normalized_protocol_document_name(name): (name, text or "", checksum)
        for name, text, checksum in current_documents
    }
    entries: list[ProtocolDiffEntry] = []
    all_keys = sorted(set(previous_map) | set(current_map))
    for key in all_keys:
        previous = previous_map.get(key)
        current = current_map.get(key)
        if previous is None and current is not None:
            entries.append(
                ProtocolDiffEntry(kind="added", document_name=current[0])
            )
            continue
        if current is None and previous is not None:
            entries.append(
                ProtocolDiffEntry(kind="removed", document_name=previous[0])
            )
            continue
        if previous is None or current is None:
            continue
        if previous[2] == current[2]:
            continue
        added_lines, removed_lines = _count_diff_lines(previous[1], current[1])
        diff_excerpt = (
            _build_diff_excerpt(previous[1], current[1])
            if previous[1] != current[1]
            else "No se detectaron cambios textuales; el archivo binario fue actualizado."
        )
        entries.append(
            ProtocolDiffEntry(
                kind="changed",
                document_name=current[0],
                added_lines=added_lines,
                removed_lines=removed_lines,
                diff_excerpt=diff_excerpt,
            )
        )
    return entries


def _count_diff_lines(previous_text: str, current_text: str) -> tuple[int, int]:
    matcher = difflib.SequenceMatcher(
        a=previous_text.splitlines(), b=current_text.splitlines()
    )
    added_lines = 0
    removed_lines = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in {"insert", "replace"}:
            added_lines += max(j2 - j1, 0)
        if tag in {"delete", "replace"}:
            removed_lines += max(i2 - i1, 0)
    return added_lines, removed_lines


def _build_diff_excerpt(previous_text: str, current_text: str) -> str:
    diff_lines = list(
        difflib.unified_diff(
            previous_text.splitlines(),
            current_text.splitlines(),
            fromfile="anterior",
            tofile="actual",
            lineterm="",
            n=1,
        )
    )
    if not diff_lines:
        return ""
    limited = diff_lines[:120]
    excerpt = "\n".join(limited)
    if len(diff_lines) > len(limited):
        excerpt = f"{excerpt}\n... diff truncado ..."
    if len(excerpt) > 12000:
        excerpt = f"{excerpt[:11980]}\n... diff truncado ..."
    return excerpt
