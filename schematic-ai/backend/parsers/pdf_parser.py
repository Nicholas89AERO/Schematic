"""
PDF Parser dispatcher — detects layer and extracts data from PDF drawings.

PDF parsing extracts text-based data (wire lists, title blocks, annotations).
For geometric/graphical extraction from PDFs, the PDF should first be converted
to DXF via the ODA File Converter or similar, then parsed by dxf_parser.py.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from models.project import (
    BlockDiagram, ConnectorDetail, DrawingLayer, HarnessAssembly,
    HarnessSheet, LRUBlock, Point, SchematicSheet, SignalPath,
    SignalType, TitleBlock, WireRecord,
)
from .layer_detector import LayerDetectionResult, detect_layer
from .symbol_matcher import (
    extract_cross_section, extract_signal_path_id, extract_voltage,
    infer_signal_type,
)

# ─────────────────────────────────────────────
# Shared text extraction helper
# ─────────────────────────────────────────────

def _extract_pdf_text(file_path: Path, warnings: list[str]) -> list[str]:
    """Return all text lines from a PDF document."""
    try:
        import fitz
    except ImportError:
        warnings.append("PyMuPDF (fitz) not installed — PDF parsing unavailable")
        return []

    try:
        doc = fitz.open(str(file_path))
    except Exception as exc:
        warnings.append(f"PDF open error: {exc}")
        return []

    lines: list[str] = []
    for page in doc:
        text = page.get_text()
        lines.extend(text.splitlines())
    doc.close()
    return [l.strip() for l in lines if l.strip()]


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
    tb = TitleBlock()
    combined = " ".join(lines[:40])  # title block is usually in the first 40 lines
    for field, pattern in _TB_PATTERNS.items():
        m = pattern.search(combined)
        if m:
            setattr(tb, field, m.group(1).strip()[:80])
    return tb


# ─────────────────────────────────────────────
# Layer-specific parsers
# ─────────────────────────────────────────────

def _parse_pdf_block_diagram(lines: list[str], sheet_number: int) -> BlockDiagram:
    """Extract LRU blocks and signal paths from block-diagram PDF text."""
    lru_blocks: list[LRUBlock] = []
    signal_paths: list[SignalPath] = []

    _LRU_RE  = re.compile(r'\b([A-Z]{2,5}-\d+)\b')
    _SP_RE   = re.compile(r'\bSP-\d{3,}\b')

    for line in lines:
        if _SP_RE.search(line):
            sp_id = _SP_RE.search(line).group(0)
            voltage   = extract_voltage(line)
            sig_type  = infer_signal_type(line)
            import uuid
            signal_paths.append(SignalPath(
                id=str(uuid.uuid4()),
                path_id=sp_id,
                signal_type=sig_type,
                voltage=voltage,
                sheet=sheet_number,
            ))

        if _LRU_RE.search(line):
            ref = _LRU_RE.search(line).group(1)
            if not any(b.ref == ref for b in lru_blocks):
                import uuid
                lru_blocks.append(LRUBlock(
                    id=str(uuid.uuid4()),
                    ref=ref,
                    name=line[:60],
                    sheet=sheet_number,
                ))

    return BlockDiagram(
        sheet_number=sheet_number,
        lru_blocks=lru_blocks,
        signal_paths=signal_paths,
    )


def _parse_pdf_harness(lines: list[str], sheet_number: int, warnings: list[str]) -> HarnessSheet:
    """Extract wire records and connector details from harness PDF wire lists."""
    import uuid

    wire_records: list[WireRecord] = []
    connectors: list[ConnectorDetail] = []

    _WIRE_RE   = re.compile(r'\bW\d{3,}-\d{3,}\b')
    _CONN_RE   = re.compile(r'\b([PJ][0-9A-Z]{3,})\b')
    _LENGTH_RE = re.compile(r'\b(\d+(?:\.\d+)?)\s*(?:M|METERS?)\b', re.I)
    _SPEC_RE   = re.compile(r'\b(M22759/\S+|MIL-\S+)\b', re.I)
    _COLOR_RE  = re.compile(r'\b(BRN|BLK|WHT|RED|ORG|YEL|GRN|BLU|VIO|GRY)\b', re.I)

    for line in lines:
        if not _WIRE_RE.search(line):
            continue

        wire_label  = _WIRE_RE.search(line).group(0)
        conns       = _CONN_RE.findall(line)
        from_conn   = conns[0] if len(conns) > 0 else ""
        to_conn     = conns[1] if len(conns) > 1 else ""
        length_m    = None
        lm          = _LENGTH_RE.search(line)
        if lm:
            length_m = float(lm.group(1))

        spec_m      = _SPEC_RE.search(line)
        spec        = spec_m.group(0) if spec_m else ""
        color_m     = _COLOR_RE.search(line)
        color       = color_m.group(0).upper() if color_m else ""
        cross       = extract_cross_section(line)
        sig_type    = infer_signal_type(line)

        wire_records.append(WireRecord(
            id=str(uuid.uuid4()),
            wire_label=wire_label,
            from_connector=from_conn,
            to_connector=to_conn,
            length_m=length_m,
            cross_section_mm2=cross,
            color=color,
            material_spec=spec,
            signal_type=sig_type,
        ))

    assembly = HarnessAssembly(
        id=str(uuid.uuid4()),
        assembly_number="H001",
        wires=wire_records,
        connectors=connectors,
    )

    return HarnessSheet(
        number=sheet_number,
        assemblies=[assembly],
        wire_list=wire_records,
        connector_table=connectors,
    )


# ─────────────────────────────────────────────
# PUBLIC
# ─────────────────────────────────────────────

def parse_pdf(
    file_path: str | Path,
    layer_hint: Optional[DrawingLayer] = None,
    sheet_number: int = 1,
    warnings: Optional[list[str]] = None,
) -> tuple[DrawingLayer, BlockDiagram | SchematicSheet | HarnessSheet, LayerDetectionResult]:
    """
    Detect the layer of a PDF file and parse it with the appropriate text extractor.

    Returns:
        Tuple of (detected_layer, parsed_object, detection_result).
    """
    if warnings is None:
        warnings = []

    path = Path(file_path)
    detection = detect_layer(path, hint=layer_hint)
    layer = layer_hint or detection.detected_layer

    lines = _extract_pdf_text(path, warnings)

    if layer == DrawingLayer.BLOCK_DIAGRAM:
        result = _parse_pdf_block_diagram(lines, sheet_number)
    elif layer == DrawingLayer.HARNESS:
        result = _parse_pdf_harness(lines, sheet_number, warnings)
    else:
        # Schematic PDFs are primarily graphical — return a minimal sheet
        warnings.append(
            "Schematic PDF parsing extracts title block and annotations only. "
            "For full symbol/wire extraction, convert PDF to DXF first."
        )
        result = SchematicSheet(number=sheet_number)

    return layer, result, detection
