"""
Layer Detector — classify an input file (DXF or PDF) as Layer 1, 2, or 3.

Returns a confidence score 0.0–1.0. If confidence < 0.8, the caller should
ask the user to confirm the layer before parsing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..models.project import DrawingLayer


# ─────────────────────────────────────────────
# RESULT TYPE
# ─────────────────────────────────────────────

@dataclass
class LayerDetectionResult:
    detected_layer: DrawingLayer
    confidence: float
    reason: str
    requires_user_confirmation: bool = False

    def __post_init__(self) -> None:
        self.requires_user_confirmation = self.confidence < 0.8


# ─────────────────────────────────────────────
# DXF DETECTION
# ─────────────────────────────────────────────

# Regex patterns used across DXF text entity values
_SP_PATTERN        = re.compile(r'\bSP-\d{3,}\b')
_BUS_PATTERN       = re.compile(r'\b(DC BUS|AC BUS|ESS BUS|BUS \d)\b', re.IGNORECASE)
_WIRE_LABEL_PATTERN = re.compile(r'\bW\d{3,}-\d{3,}\b')
_REF_DES_PATTERN   = re.compile(r'\b[A-Z]{1,3}\d+\b')
_HARNESS_PATTERN   = re.compile(r'\bH\d{3,}\b')
_PIN_TABLE_HEADER  = re.compile(r'(FROM|TO|WIRE NO|GAUGE|LENGTH|SPEC)', re.IGNORECASE)
_LRU_PATTERN       = re.compile(r'\b(LRU|ECU|FCU|PSU|DCU|MCU|IOM)\b', re.IGNORECASE)

# DXF layer name hints
_WIRE_LAYER_RE     = re.compile(r'^WIRE', re.IGNORECASE)
_SYMBOL_LAYER_RE   = re.compile(r'^(SYMBOL|COMPONENT|ELEC)', re.IGNORECASE)


def _detect_dxf(path: Path) -> LayerDetectionResult:
    """Analyse a DXF file and return the most likely drawing layer."""
    try:
        import ezdxf
    except ImportError:
        return LayerDetectionResult(
            DrawingLayer.SCHEMATIC, 0.5, "ezdxf not installed; defaulting to schematic"
        )

    try:
        doc = ezdxf.readfile(str(path))
    except Exception as exc:
        return LayerDetectionResult(
            DrawingLayer.SCHEMATIC, 0.3, f"DXF read error: {exc}"
        )

    msp = doc.modelspace()

    # Count entity types
    counts: dict[str, int] = {}
    text_values: list[str] = []
    dxf_layers: set[str] = set()

    for entity in msp:
        kind = entity.dxftype()
        counts[kind] = counts.get(kind, 0) + 1
        if kind in ("TEXT", "MTEXT"):
            val = entity.dxf.text if kind == "TEXT" else entity.text
            text_values.append(str(val))
        if hasattr(entity, "dxf") and hasattr(entity.dxf, "layer"):
            dxf_layers.add(entity.dxf.layer)

    all_text = " ".join(text_values)
    total_entities = max(sum(counts.values()), 1)

    insert_count    = counts.get("INSERT", 0)
    polyline_count  = counts.get("LWPOLYLINE", 0) + counts.get("POLYLINE", 0)
    line_count      = counts.get("LINE", 0)
    text_count      = counts.get("TEXT", 0) + counts.get("MTEXT", 0)

    insert_density  = insert_count / total_entities
    polyline_density = polyline_count / total_entities

    sp_hits         = len(_SP_PATTERN.findall(all_text))
    bus_hits        = len(_BUS_PATTERN.findall(all_text))
    wire_hits       = len(_WIRE_LABEL_PATTERN.findall(all_text))
    ref_des_hits    = len(_REF_DES_PATTERN.findall(all_text))
    harness_hits    = len(_HARNESS_PATTERN.findall(all_text))
    pin_table_hits  = len(_PIN_TABLE_HEADER.findall(all_text))
    lru_hits        = len(_LRU_PATTERN.findall(all_text))

    has_wire_layers    = any(_WIRE_LAYER_RE.match(l) for l in dxf_layers)
    has_symbol_layers  = any(_SYMBOL_LAYER_RE.match(l) for l in dxf_layers)

    # ── Score each layer ──────────────────────────────────────────────
    scores: dict[DrawingLayer, float] = {
        DrawingLayer.BLOCK_DIAGRAM: 0.0,
        DrawingLayer.SCHEMATIC:     0.0,
        DrawingLayer.HARNESS:       0.0,
    }

    # Layer 1 signals
    if sp_hits > 0:
        scores[DrawingLayer.BLOCK_DIAGRAM] += 0.25
    if bus_hits > 0:
        scores[DrawingLayer.BLOCK_DIAGRAM] += 0.20
    if lru_hits > 0:
        scores[DrawingLayer.BLOCK_DIAGRAM] += 0.15
    if polyline_density < 0.1 and insert_density > 0.1:
        scores[DrawingLayer.BLOCK_DIAGRAM] += 0.15
    if "BLOCK DIAGRAM" in all_text.upper() or "SINGLE LINE" in all_text.upper():
        scores[DrawingLayer.BLOCK_DIAGRAM] += 0.30

    # Layer 2 signals
    if insert_density > 0.2:
        scores[DrawingLayer.SCHEMATIC] += 0.20
    if ref_des_hits > 5:
        scores[DrawingLayer.SCHEMATIC] += 0.20
    if has_wire_layers or has_symbol_layers:
        scores[DrawingLayer.SCHEMATIC] += 0.20
    if wire_hits > 0:
        scores[DrawingLayer.SCHEMATIC] += 0.15
    if polyline_density > 0.1:
        scores[DrawingLayer.SCHEMATIC] += 0.10
    if "SCHEMATIC" in all_text.upper() or "INTERCONNECTION" in all_text.upper():
        scores[DrawingLayer.SCHEMATIC] += 0.25

    # Layer 3 signals
    if harness_hits > 0:
        scores[DrawingLayer.HARNESS] += 0.20
    if pin_table_hits >= 3:
        scores[DrawingLayer.HARNESS] += 0.30
    if wire_hits > 10:
        scores[DrawingLayer.HARNESS] += 0.20
    if "HARNESS" in all_text.upper() or "WIRE LIST" in all_text.upper():
        scores[DrawingLayer.HARNESS] += 0.30

    best_layer = max(scores, key=lambda k: scores[k])
    best_score = scores[best_layer]

    # Normalise: cap at 0.97 so genuine matches don't claim perfect confidence
    confidence = min(best_score, 0.97)
    if confidence < 0.1:
        confidence = 0.4  # too little information — moderate uncertainty

    reason_parts = []
    if sp_hits:    reason_parts.append(f"{sp_hits} SP-NNN signal path labels")
    if bus_hits:   reason_parts.append(f"{bus_hits} bus labels")
    if wire_hits:  reason_parts.append(f"{wire_hits} wire labels")
    if ref_des_hits: reason_parts.append(f"{ref_des_hits} reference designators")
    if pin_table_hits: reason_parts.append(f"{pin_table_hits} pin-table header matches")
    if has_wire_layers: reason_parts.append("WIRE* DXF layers present")
    reason = "; ".join(reason_parts) or "Low signal density — defaulting to schematic"

    return LayerDetectionResult(best_layer, confidence, reason)


# ─────────────────────────────────────────────
# PDF DETECTION
# ─────────────────────────────────────────────

_PDF_L1_KEYWORDS = ["BLOCK DIAGRAM", "SINGLE LINE DIAGRAM", "SYSTEM DIAGRAM", "SIGNAL PATH"]
_PDF_L2_KEYWORDS = ["SCHEMATIC", "INTERCONNECTION", "WIRING DIAGRAM", "CIRCUIT DIAGRAM"]
_PDF_L3_KEYWORDS = ["HARNESS", "WIRE LIST", "CABLE ASSEMBLY", "PIN ASSIGNMENT", "ROUTING"]


def _detect_pdf(path: Path) -> LayerDetectionResult:
    """Analyse a PDF file and return the most likely drawing layer."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return LayerDetectionResult(
            DrawingLayer.SCHEMATIC, 0.5, "PyMuPDF not installed; defaulting to schematic"
        )

    try:
        doc = fitz.open(str(path))
    except Exception as exc:
        return LayerDetectionResult(
            DrawingLayer.SCHEMATIC, 0.3, f"PDF read error: {exc}"
        )

    full_text = ""
    for page in doc:
        full_text += page.get_text()
    doc.close()

    upper = full_text.upper()

    scores: dict[DrawingLayer, float] = {
        DrawingLayer.BLOCK_DIAGRAM: 0.0,
        DrawingLayer.SCHEMATIC:     0.0,
        DrawingLayer.HARNESS:       0.0,
    }

    for kw in _PDF_L1_KEYWORDS:
        if kw in upper:
            scores[DrawingLayer.BLOCK_DIAGRAM] += 0.25

    for kw in _PDF_L2_KEYWORDS:
        if kw in upper:
            scores[DrawingLayer.SCHEMATIC] += 0.25

    for kw in _PDF_L3_KEYWORDS:
        if kw in upper:
            scores[DrawingLayer.HARNESS] += 0.20

    # Wire label density
    wire_hits = len(_WIRE_LABEL_PATTERN.findall(full_text))
    pin_hits  = len(_PIN_TABLE_HEADER.findall(full_text))
    sp_hits   = len(_SP_PATTERN.findall(full_text))

    if sp_hits > 2:
        scores[DrawingLayer.BLOCK_DIAGRAM] += 0.20
    if wire_hits > 10 and pin_hits >= 2:
        scores[DrawingLayer.HARNESS] += 0.20
    if wire_hits > 0 and pin_hits < 2:
        scores[DrawingLayer.SCHEMATIC] += 0.15

    best_layer = max(scores, key=lambda k: scores[k])
    best_score = scores[best_layer]
    confidence = min(best_score, 0.95)
    if confidence < 0.1:
        confidence = 0.4

    reason_parts = []
    for kw in _PDF_L1_KEYWORDS + _PDF_L2_KEYWORDS + _PDF_L3_KEYWORDS:
        if kw in upper:
            reason_parts.append(f'"{kw}"')
    if wire_hits:
        reason_parts.append(f"{wire_hits} wire labels")
    reason = "Keywords: " + ", ".join(reason_parts) if reason_parts else "No strong signals"

    return LayerDetectionResult(best_layer, confidence, reason)


# ─────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────

def detect_layer(
    file_path: str | Path,
    hint: Optional[DrawingLayer] = None,
) -> LayerDetectionResult:
    """
    Detect the drawing layer for a DXF or PDF file.

    Args:
        file_path: Path to the file.
        hint: Optional caller-supplied layer hint. If provided and confidence
              of auto-detection is < 0.6, the hint is used instead.

    Returns:
        LayerDetectionResult with detected_layer, confidence, reason,
        and requires_user_confirmation flag.
    """
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix in (".dxf", ".dwg"):
        result = _detect_dxf(path)
    elif suffix == ".pdf":
        result = _detect_pdf(path)
    else:
        result = LayerDetectionResult(
            DrawingLayer.SCHEMATIC,
            0.3,
            f"Unsupported file type '{suffix}'; defaulting to schematic",
        )

    if hint is not None and result.confidence < 0.6:
        result = LayerDetectionResult(
            hint,
            max(result.confidence, 0.5),
            f"User hint '{hint}' applied (auto-detection confidence was {result.confidence:.2f})",
        )

    return result
