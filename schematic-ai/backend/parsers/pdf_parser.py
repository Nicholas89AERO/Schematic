"""
PDF Parser dispatcher — detects layer and extracts data from PDF drawings.

Extraction is coordinate-aware: words are pulled with their bounding boxes and
re-grouped into visual rows so that tabular data (wire lists, pin tables) keeps
related fields on the same logical line. Scanned/raster PDFs with no embedded
text fall back to OCR when ``pytesseract`` is available.

For full geometric/graphical extraction (symbol shapes, exact wire routing),
a PDF should still be converted to DXF via the ODA File Converter and parsed by
``dxf_parser.py``; this module recovers the text-bearing data only.
"""

from __future__ import annotations

import io
import re
import uuid
from pathlib import Path
from typing import Optional

from models.project import (
    BlockDiagram, Component, ComponentType, Connection, ConnectorDetail,
    ConnectorShell, DrawingLayer, HarnessAssembly, HarnessSheet, LRUBlock,
    Point, SchematicSheet, SignalPath, SignalType, TitleBlock, WireRecord,
    WireSegment,
)
from .layer_detector import LayerDetectionResult, detect_layer
from .symbol_matcher import (
    block_to_component_type, extract_cross_section, extract_voltage,
    infer_signal_type, is_connector_ref,
)

# ─────────────────────────────────────────────
# Shared regex patterns
# ─────────────────────────────────────────────

_SP_RE      = re.compile(r'\bSP-\d{3,}\b')
_LRU_RE     = re.compile(r'\b([A-Z]{2,5}-\d+)\b')
_WIRE_RE    = re.compile(r'\bW\d{3,}-\d{3,}\b')
_CONN_RE    = re.compile(r'\b([PJ][0-9A-Z]{3,})\b')
_REF_DES_RE = re.compile(r'\b([A-Z]{1,3}\d+)\b')
_LENGTH_RE  = re.compile(r'\b(\d+(?:\.\d+)?)\s*(?:M|METERS?)\b', re.I)
_SPEC_RE    = re.compile(r'\b(M22759/\S+|MIL-\S+)\b', re.I)
_COLOR_RE   = re.compile(r'\b(BRN|BLK|WHT|RED|ORG|YEL|GRN|BLU|VIO|GRY)\b', re.I)
_AWG_RE     = re.compile(r'\bAWG\s*(\d{1,2})\b', re.I)
# A pin token: a short alphanumeric like "A", "1", "12", "A1", "12B" — but not a
# connector reference (those carry 3+ trailing chars and are caught by _CONN_RE).
_PIN_RE     = re.compile(r'^(?:[A-Za-z]\d{0,3}|\d{1,3}[A-Za-z]?)$')


# ─────────────────────────────────────────────
# PDF open + coordinate-aware text extraction
# ─────────────────────────────────────────────

def _open_pdf(file_path: Path, warnings: list[str]):
    """Open a PDF document, appending a warning and returning None on failure."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        warnings.append("PyMuPDF (fitz) not installed — PDF parsing unavailable")
        return None
    try:
        return fitz.open(str(file_path))
    except Exception as exc:
        warnings.append(f"PDF open error: {exc}")
        return None


def _group_words_into_rows(words: list, y_tol: float = 3.0) -> list[str]:
    """
    Cluster PyMuPDF ``words`` tuples (x0, y0, x1, y1, word, ...) into visual rows.

    Words whose top-y values fall within ``y_tol`` points are treated as the same
    row and joined left-to-right by x position. This reconstructs table rows that
    ``page.get_text()`` would otherwise split into one word per line.
    """
    if not words:
        return []

    rows: list[list] = []
    current: list = []
    band_y: Optional[float] = None

    for w in sorted(words, key=lambda t: (t[1], t[0])):
        y0 = w[1]
        if band_y is None or abs(y0 - band_y) <= y_tol:
            current.append(w)
            if band_y is None:
                band_y = y0
        else:
            rows.append(current)
            current = [w]
            band_y = y0
    if current:
        rows.append(current)

    return [" ".join(t[4] for t in sorted(row, key=lambda t: t[0])) for row in rows]


def _ocr_page(page, warnings: list[str]) -> Optional[list[str]]:
    """
    OCR a page image. Returns a list of text lines, [] if OCR produced nothing,
    or None if the OCR stack (pytesseract/Pillow/Tesseract) is unavailable.
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return None
    try:
        pix = page.get_pixmap(dpi=200)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        text = pytesseract.image_to_string(img)
    except Exception as exc:
        warnings.append(f"OCR failed: {exc}")
        return []
    return [l.strip() for l in text.splitlines() if l.strip()]


def _extract_page_rows(page, warnings: list[str]) -> list[str]:
    """
    Return the visual text rows of a page, using embedded words when present and
    falling back to OCR for scanned/raster pages.
    """
    words = page.get_text("words")
    if words:
        return _group_words_into_rows(words)

    ocr_lines = _ocr_page(page, warnings)
    if ocr_lines is None:
        warnings.append(
            "Page has no extractable text and OCR (pytesseract) is not installed — "
            "no data extracted from this page. Install pytesseract + Tesseract, or "
            "convert the PDF to DXF."
        )
        return []
    if not ocr_lines:
        warnings.append("Page has no extractable text; OCR produced no output.")
    return ocr_lines


# ─────────────────────────────────────────────
# Title block extraction (common to all layers)
# ─────────────────────────────────────────────

_TB_PATTERNS = {
    "drawing_number": re.compile(r'(?:DWG(?:\s*NO)?|DRAWING\s*(?:NO|NUMBER))[:\s]+(\S+)', re.I),
    "drawing_title":  re.compile(r'(?:TITLE)[:\s]+(.+)', re.I),
    "revision":       re.compile(r'(?:REV(?:ISION)?)[:\s]+([A-Z0-9]+)', re.I),
    "ata_chapter":    re.compile(r'ATA\s*(?:CHAPTER)?\s*(\d{2})', re.I),
    "aircraft_type":  re.compile(r'(?:AIRCRAFT|A/C|TYPE)[:\s]+([A-Z0-9\-]+)', re.I),
}


def _extract_title_block_from_lines(lines: list[str]) -> TitleBlock:
    """
    Search the head and tail of the page for title-block fields. Aerospace title
    blocks sit in the first lines or in the bottom-right cluster, so both ends are
    scanned.
    """
    tb = TitleBlock()
    candidates = lines[:40] + (lines[-40:] if len(lines) > 40 else [])
    # Scan per-line so greedy fields (e.g. TITLE: .+) stay bounded to their row.
    for field, pattern in _TB_PATTERNS.items():
        for line in candidates:
            m = pattern.search(line)
            if m:
                setattr(tb, field, m.group(1).strip()[:80])
                break
    return tb


def _tb_title(title_block: Optional[TitleBlock]) -> str:
    return title_block.drawing_title if title_block else ""


def _strip_token(text: str, token: str) -> str:
    """Remove a token from a row and collapse surrounding whitespace."""
    return re.sub(r'\s+', ' ', text.replace(token, " ")).strip()


def _extract_awg(text: str) -> Optional[int]:
    m = _AWG_RE.search(text)
    return int(m.group(1)) if m else None


def _extract_pins(tokens: list[str], conns: list[str]) -> tuple[str, str]:
    """For up to two connector tokens, return the pin token that follows each."""
    pins: list[str] = []
    for c in conns[:2]:
        pin = ""
        if c in tokens:
            i = tokens.index(c)
            if i + 1 < len(tokens) and _PIN_RE.match(tokens[i + 1]) and not _CONN_RE.match(tokens[i + 1]):
                pin = tokens[i + 1]
        pins.append(pin)
    while len(pins) < 2:
        pins.append("")
    return pins[0], pins[1]


# ─────────────────────────────────────────────
# Layer-specific parsers (operate on visual rows)
# ─────────────────────────────────────────────

def _parse_pdf_block_diagram(
    rows: list[str], sheet_number: int, title_block: Optional[TitleBlock] = None,
) -> BlockDiagram:
    """Extract LRU blocks and signal paths from block-diagram PDF rows."""
    lru_blocks: list[LRUBlock] = []
    signal_paths: list[SignalPath] = []

    for row in rows:
        sp_m = _SP_RE.search(row)
        if sp_m:
            signal_paths.append(SignalPath(
                id=str(uuid.uuid4()),
                path_id=sp_m.group(0),
                signal_type=infer_signal_type(row),
                voltage=extract_voltage(row),
                sheet=sheet_number,
            ))

        lru_m = _LRU_RE.search(row)
        if lru_m:
            ref = lru_m.group(1)
            if not any(b.ref == ref for b in lru_blocks):
                name = _strip_token(row, ref)[:60]
                lru_blocks.append(LRUBlock(
                    id=str(uuid.uuid4()),
                    ref=ref,
                    name=name or ref,
                    sheet=sheet_number,
                ))

    return BlockDiagram(
        sheet_number=sheet_number,
        title=_tb_title(title_block),
        lru_blocks=lru_blocks,
        signal_paths=signal_paths,
    )


def _parse_pdf_harness(
    rows: list[str], sheet_number: int, warnings: list[str],
    title_block: Optional[TitleBlock] = None,
) -> HarnessSheet:
    """Extract wire records and connector details from harness PDF wire lists."""
    wire_records: list[WireRecord] = []
    connectors_by_ref: dict[str, ConnectorDetail] = {}

    for row in rows:
        wm = _WIRE_RE.search(row)
        if not wm:
            continue

        tokens = row.split()
        wire_label = wm.group(0)
        conns = _CONN_RE.findall(row)
        from_conn = conns[0] if conns else ""
        to_conn = conns[1] if len(conns) > 1 else ""
        from_pin, to_pin = _extract_pins(tokens, conns)

        length_m = None
        lm = _LENGTH_RE.search(row)
        if lm:
            length_m = float(lm.group(1))

        spec_m = _SPEC_RE.search(row)
        spec = spec_m.group(0) if spec_m else ""
        color_m = _COLOR_RE.search(row)
        color = color_m.group(0).upper() if color_m else ""

        wire_records.append(WireRecord(
            id=str(uuid.uuid4()),
            wire_label=wire_label,
            from_connector=from_conn,
            from_pin=from_pin,
            to_connector=to_conn,
            to_pin=to_pin,
            length_m=length_m,
            cross_section_mm2=extract_cross_section(row),
            awg=_extract_awg(row),
            color=color,
            material_spec=spec,
            signal_type=infer_signal_type(row),
        ))

        for c in (from_conn, to_conn):
            if c and c not in connectors_by_ref:
                connectors_by_ref[c] = ConnectorDetail(
                    id=str(uuid.uuid4()),
                    ref=c,
                    part_number=spec if spec else "",
                )

    connectors = list(connectors_by_ref.values())

    assembly_number = (title_block.drawing_number if title_block and title_block.drawing_number else "H001")
    assembly_title = title_block.drawing_title if title_block else ""

    assembly = HarnessAssembly(
        id=str(uuid.uuid4()),
        assembly_number=assembly_number,
        assembly_title=assembly_title,
        wires=wire_records,
        connectors=connectors,
    )

    return HarnessSheet(
        number=sheet_number,
        title=_tb_title(title_block),
        assemblies=[assembly],
        wire_list=wire_records,
        connector_table=connectors,
    )


def _parse_pdf_schematic(
    rows: list[str], sheet_number: int, warnings: list[str],
    title_block: Optional[TitleBlock] = None,
) -> SchematicSheet:
    """
    Extract components, connectors, wires, and component↔wire connections from
    schematic PDF text. Geometry is not recovered (positions are left at origin);
    convert to DXF for full graphical extraction.
    """
    components: list[Component] = []
    connectors: list[ConnectorShell] = []
    wires: list[WireSegment] = []
    connections: list[Connection] = []

    comp_by_ref: dict[str, Component] = {}
    conn_by_ref: dict[str, ConnectorShell] = {}
    wire_by_label: dict[str, WireSegment] = {}

    for row in rows:
        wire_labels = _WIRE_RE.findall(row)
        # Strip wire labels before scanning ref-designators so "W001-001" is not
        # mistaken for component "W001".
        ref_scan = _WIRE_RE.sub(" ", row)
        refs = [m.group(1) for m in _REF_DES_RE.finditer(ref_scan)]

        row_comp_ids: list[str] = []
        for ref in refs:
            if is_connector_ref(ref):
                if ref not in conn_by_ref:
                    conn = ConnectorShell(
                        id=str(uuid.uuid4()), ref=ref,
                        position=Point(), sheet=sheet_number,
                    )
                    conn_by_ref[ref] = conn
                    connectors.append(conn)
            else:
                if ref not in comp_by_ref:
                    comp = Component(
                        id=str(uuid.uuid4()), ref=ref,
                        type=block_to_component_type(ref),
                        position=Point(), sheet=sheet_number,
                    )
                    comp_by_ref[ref] = comp
                    components.append(comp)
                row_comp_ids.append(comp_by_ref[ref].id)

        for wl in wire_labels:
            if wl not in wire_by_label:
                w = WireSegment(
                    id=str(uuid.uuid4()), label=wl, sheet=sheet_number,
                    signal_type=infer_signal_type(row),
                    voltage=extract_voltage(row),
                    cross_section_mm2=extract_cross_section(row),
                )
                wire_by_label[wl] = w
                wires.append(w)

        if wire_labels and row_comp_ids:
            wid = wire_by_label[wire_labels[0]].id
            for cid in row_comp_ids:
                connections.append(Connection(component_id=cid, pin="", wire_id=wid))

    if not components and not connectors:
        warnings.append(
            "Schematic PDF parsing extracted no symbols from text. "
            "For full symbol/wire extraction, convert the PDF to DXF first."
        )

    return SchematicSheet(
        number=sheet_number,
        title=_tb_title(title_block),
        components=components,
        connectors=connectors,
        wires=wires,
        connections=connections,
    )


# ─────────────────────────────────────────────
# Fragment helpers
# ─────────────────────────────────────────────

def _empty_fragment(
    layer: DrawingLayer, sheet_number: int,
) -> BlockDiagram | SchematicSheet | HarnessSheet:
    if layer == DrawingLayer.BLOCK_DIAGRAM:
        return BlockDiagram(sheet_number=sheet_number)
    if layer == DrawingLayer.HARNESS:
        return HarnessSheet(number=sheet_number)
    return SchematicSheet(number=sheet_number)


# ─────────────────────────────────────────────
# PUBLIC
# ─────────────────────────────────────────────

def parse_pdf(
    file_path: str | Path,
    layer_hint: Optional[DrawingLayer] = None,
    warnings: Optional[list[str]] = None,
) -> tuple[DrawingLayer, list[BlockDiagram | SchematicSheet | HarnessSheet], LayerDetectionResult]:
    """
    Detect the layer of a PDF file and parse every page into its own sheet
    fragment with the appropriate text extractor.

    Returns:
        Tuple of (detected_layer, list_of_fragments, detection_result). One
        fragment is produced per page (sheet number = page index + 1).
    """
    if warnings is None:
        warnings = []

    path = Path(file_path)
    detection = detect_layer(path, hint=layer_hint)
    layer = layer_hint or detection.detected_layer

    doc = _open_pdf(path, warnings)
    if doc is None:
        return layer, [_empty_fragment(layer, 1)], detection

    fragments: list[BlockDiagram | SchematicSheet | HarnessSheet] = []
    title_block: Optional[TitleBlock] = None

    try:
        for index, page in enumerate(doc):
            sheet_number = index + 1
            rows = _extract_page_rows(page, warnings)

            if title_block is None and rows:
                title_block = _extract_title_block_from_lines(rows)

            if layer == DrawingLayer.BLOCK_DIAGRAM:
                fragments.append(_parse_pdf_block_diagram(rows, sheet_number, title_block))
            elif layer == DrawingLayer.HARNESS:
                fragments.append(_parse_pdf_harness(rows, sheet_number, warnings, title_block))
            else:
                fragments.append(_parse_pdf_schematic(rows, sheet_number, warnings, title_block))
    finally:
        doc.close()

    if not fragments:
        fragments.append(_empty_fragment(layer, 1))

    return layer, fragments, detection
