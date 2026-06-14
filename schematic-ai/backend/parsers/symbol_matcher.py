"""
Symbol Matcher — maps DXF block names to ComponentType using the symbol library,
with fuzzy fallback for non-standard block names.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from ..models.project import ComponentType, SignalType

# ─────────────────────────────────────────────
# Load symbol library at import time
# ─────────────────────────────────────────────

_LIBRARY_PATH = Path(__file__).parent.parent / "symbol_library.json"


def _load_library() -> dict:
    with open(_LIBRARY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


_LIB = _load_library()
_SYMBOLS: dict[str, dict] = {k.upper(): v for k, v in _LIB["symbols"].items()}
_SIGNAL_KEYWORDS: dict[str, list[str]] = _LIB.get("signal_type_keywords", {})
_LAYER_NAMES: dict[str, list[str]] = _LIB.get("layer_names", {})

# Pre-compiled wire layer pattern
_WIRE_LAYERS = {n.upper() for n in _LAYER_NAMES.get("wires", [])}
_SYMBOL_LAYERS = {n.upper() for n in _LAYER_NAMES.get("symbols", [])}
_CONNECTOR_LAYERS = {n.upper() for n in _LAYER_NAMES.get("connectors", [])}


# ─────────────────────────────────────────────
# Symbol lookup
# ─────────────────────────────────────────────

def lookup_block(block_name: str) -> Optional[dict]:
    """
    Return the symbol library entry for a DXF block name.
    Tries exact match first, then prefix match.
    """
    key = block_name.upper().strip()
    if key in _SYMBOLS:
        return _SYMBOLS[key]

    # Try prefix match (e.g. "CB_10A" → "CB")
    for sym_key, sym_data in _SYMBOLS.items():
        if key.startswith(sym_key):
            return sym_data

    return None


def block_to_component_type(block_name: str) -> ComponentType:
    """Map a DXF block name to a ComponentType enum value."""
    entry = lookup_block(block_name)
    if entry is None:
        return ComponentType.UNKNOWN
    type_str = entry.get("component_type", "unknown")
    try:
        return ComponentType(type_str)
    except ValueError:
        return ComponentType.UNKNOWN


def block_pin_count(block_name: str) -> int:
    """Return the expected pin count for a block, or 0 if unknown."""
    entry = lookup_block(block_name)
    return entry.get("pin_count", 0) if entry else 0


def block_pins(block_name: str) -> list[str]:
    """Return the default pin labels for a block."""
    entry = lookup_block(block_name)
    return entry.get("pins", []) if entry else []


# ─────────────────────────────────────────────
# DXF layer name helpers
# ─────────────────────────────────────────────

def is_wire_layer(layer_name: str) -> bool:
    """True if the DXF layer name looks like a wire layer."""
    upper = layer_name.upper()
    if upper in _WIRE_LAYERS:
        return True
    return upper.startswith("WIRE") or "WIRE" in upper


def is_symbol_layer(layer_name: str) -> bool:
    upper = layer_name.upper()
    return upper in _SYMBOL_LAYERS or upper.startswith("SYMBOL") or upper.startswith("ELEC")


def is_connector_layer(layer_name: str) -> bool:
    upper = layer_name.upper()
    return upper in _CONNECTOR_LAYERS or "CONN" in upper


# ─────────────────────────────────────────────
# Signal type inference from text
# ─────────────────────────────────────────────

def infer_signal_type(text: str) -> SignalType:
    """
    Infer SignalType from a wire label, signal name, or attribute value.
    Iterates keyword lists from symbol_library.json.
    """
    upper = text.upper()
    for type_key, keywords in _SIGNAL_KEYWORDS.items():
        for kw in keywords:
            if kw.upper() in upper:
                try:
                    return SignalType(type_key)
                except ValueError:
                    pass
    return SignalType.UNKNOWN


# ─────────────────────────────────────────────
# Wire label pattern helpers
# ─────────────────────────────────────────────

_WIRE_LABEL_RE   = re.compile(r'\bW\d{3,}-\d{3,}\b')
_SP_RE           = re.compile(r'\bSP-\d{3,}\b')
_REF_DES_RE      = re.compile(r'\b([A-Z]{1,3})(\d+)\b')
_CONN_REF_RE     = re.compile(r'\b([PJ])(\d{3,}[A-Z]?)\b')
_VOLTAGE_RE      = re.compile(r'\b(\d+(?:\.\d+)?(?:VDC|VAC|V))\b', re.IGNORECASE)
_AWG_RE          = re.compile(r'\bAWG\s*(\d+)\b', re.IGNORECASE)
_MM2_RE          = re.compile(r'\b(\d+(?:\.\d+)?)\s*MM2\b', re.IGNORECASE)


def extract_wire_label(text: str) -> Optional[str]:
    m = _WIRE_LABEL_RE.search(text)
    return m.group(0) if m else None


def extract_signal_path_id(text: str) -> Optional[str]:
    m = _SP_RE.search(text)
    return m.group(0) if m else None


def extract_voltage(text: str) -> Optional[str]:
    m = _VOLTAGE_RE.search(text)
    return m.group(0).upper() if m else None


def extract_cross_section(text: str) -> Optional[float]:
    m = _MM2_RE.search(text)
    if m:
        return float(m.group(1))
    awg = _AWG_RE.search(text)
    if awg:
        awg_num = int(awg.group(1))
        # Approximate AWG → mm² conversion table (common values)
        awg_table = {
            22: 0.34, 20: 0.52, 18: 0.82, 16: 1.31, 14: 2.08,
            12: 3.31, 10: 5.26, 8: 8.37, 6: 13.3, 4: 21.2, 2: 33.6,
        }
        return awg_table.get(awg_num)
    return None


def is_connector_ref(text: str) -> bool:
    return bool(_CONN_REF_RE.match(text.strip()))


def parse_connector_ref(text: str) -> tuple[str, str]:
    """Return (prefix, number) e.g. 'P042A' → ('P', '042A')."""
    m = _CONN_REF_RE.match(text.strip())
    if m:
        return m.group(1), m.group(2)
    return "", text
