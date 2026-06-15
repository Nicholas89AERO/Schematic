"""
Layer 3 — Harness DXF Parser.

Extracts HarnessAssembly, WireRecord, ConnectorDetail, and Splice objects
from a harness drawing DXF, including both graphical and tabular (wire list) data.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Optional

from models.project import (
    ConnectorDetail, HarnessAssembly, HarnessSheet, Point,
    SignalType, Splice, WireRecord,
)
from .symbol_matcher import extract_cross_section, extract_voltage, infer_signal_type


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _point(x: float, y: float) -> Point:
    return Point(x=round(x, 4), y=round(y, 4))


def _get_text(entity) -> str:
    kind = entity.dxftype()
    if kind == "TEXT":
        return entity.dxf.text or ""
    if kind == "MTEXT":
        raw = entity.text or ""
        return re.sub(r"\\[^;]+;|{|}|\\~", "", raw).strip()
    return ""


def _get_attribs(insert_entity) -> dict[str, str]:
    attribs: dict[str, str] = {}
    try:
        for att in insert_entity.attribs:
            tag = (att.dxf.tag or "").upper().strip()
            val = (att.dxf.text or "").strip()
            if tag:
                attribs[tag] = val
    except Exception:
        pass
    return attribs


# ─────────────────────────────────────────────
# Wire list table parsing
# ─────────────────────────────────────────────

# Typical wire list table row:
#   W042-003  P042A  3  J042B  3  2.3  1.0  BRN  M22759/16-20-9  28V_FEED
_WIRE_ROW_RE = re.compile(
    r'\b(W\d{3,}-\d{3,})\b'           # wire label
    r'.*?([PJ]\w+)\b'                 # from connector
    r'.*?\b(\w+)\b'                   # from pin
    r'.*?([PJ]\w+)\b'                 # to connector
    r'.*?\b(\w+)\b'                   # to pin
)
_LENGTH_RE   = re.compile(r'\b(\d+(?:\.\d+)?)\s*(?:M|MM|METERS?)\b', re.IGNORECASE)
_COLOR_RE    = re.compile(r'\b(BRN|BLK|WHT|RED|ORG|YEL|GRN|BLU|VIO|GRY|PNK|TAN|SLT|BLK/WHT|BRN/WHT|BLU/WHT)\b', re.IGNORECASE)
_SPEC_RE     = re.compile(r'\b(M22759/\S+|MIL-\S+|AS\d+\S*|ASTM\s*\S+)\b', re.IGNORECASE)
_CONN_REF_RE = re.compile(r'\b([PJ][0-9A-Z]{3,})\b')
_ASSEMBLY_RE = re.compile(r'\bH(\d{3,})\b')
_ZONE_RE     = re.compile(r'\b(?:STA|FR|ZONE|ZN|FRAME)-?\s*\d+\b', re.IGNORECASE)


def _parse_wire_table_text(lines: list[str]) -> list[WireRecord]:
    """
    Parse a plain-text wire list table (one wire per line).
    Columns are identified by content pattern, not strict position.
    """
    records: list[WireRecord] = []

    for line in lines:
        # Must contain a wire label
        wire_m = re.search(r'\bW\d{3,}-\d{3,}\b', line)
        if not wire_m:
            continue

        wire_label = wire_m.group(0)

        # Extract connector refs (first = from, second = to)
        conns = _CONN_REF_RE.findall(line)
        from_conn = conns[0] if len(conns) > 0 else ""
        to_conn   = conns[1] if len(conns) > 1 else ""

        # Length
        length_m = None
        lm = _LENGTH_RE.search(line)
        if lm:
            val = float(lm.group(1))
            unit = lm.group(0).upper()
            length_m = val if "M" in unit and "MM" not in unit else val / 1000

        # Colour
        color = ""
        cm = _COLOR_RE.search(line)
        if cm:
            color = cm.group(0).upper()

        # Spec
        material_spec = ""
        sm = _SPEC_RE.search(line)
        if sm:
            material_spec = sm.group(0)

        # Cross-section
        cross_section = extract_cross_section(line)

        # Signal type
        sig_type = infer_signal_type(line)

        records.append(WireRecord(
            id=str(uuid.uuid4()),
            wire_label=wire_label,
            from_connector=from_conn,
            from_pin="",
            to_connector=to_conn,
            to_pin="",
            length_m=length_m,
            cross_section_mm2=cross_section,
            color=color,
            material_spec=material_spec,
            signal_type=sig_type,
        ))

    return records


# ─────────────────────────────────────────────
# Connector detail extraction
# ─────────────────────────────────────────────

def _extract_connector_details(msp) -> list[ConnectorDetail]:
    """Extract connector manufacturing details from INSERT attributes."""
    details: list[ConnectorDetail] = []
    _CONN_BLOCKS = {"CONN_DETAIL", "CONNECTOR_DETAIL", "CONN_TABLE", "CONNECTOR"}

    for entity in msp:
        if entity.dxftype() != "INSERT":
            continue
        bname = (entity.dxf.name or "").upper()
        if not any(bname.startswith(b) for b in _CONN_BLOCKS):
            continue

        attribs = _get_attribs(entity)
        ref = (
            attribs.get("REF") or attribs.get("CONN_REF") or
            attribs.get("ID") or ""
        )
        pn  = attribs.get("PART_NUMBER") or attribs.get("PN") or ""
        cage = attribs.get("CAGE") or attribs.get("CAGE_CODE") or ""
        shell_class = attribs.get("SHELL_CLASS") or attribs.get("CLASS") or ""
        insert_arr  = attribs.get("INSERT_ARRANGEMENT") or attribs.get("INSERT") or ""
        contact_pn  = attribs.get("CONTACT_PN") or attribs.get("CONTACT") or ""
        backshell   = attribs.get("BACKSHELL_PN") or attribs.get("BACKSHELL") or ""
        bs_angle    = attribs.get("BACKSHELL_ANGLE") or ""
        potting     = attribs.get("POTTING_COMPOUND") or ""
        zone        = attribs.get("AIRFRAME_ZONE") or attribs.get("ZONE") or ""

        if not ref and not pn:
            continue

        details.append(ConnectorDetail(
            id=str(uuid.uuid4()),
            ref=ref,
            part_number=pn,
            cage_code=cage,
            shell_class=shell_class,
            insert_arrangement=insert_arr,
            contact_pn=contact_pn,
            backshell_pn=backshell,
            backshell_angle=bs_angle,
            potting_compound=potting,
            airframe_zone=zone,
        ))

    return details


# ─────────────────────────────────────────────
# Harness trunk / assembly detection
# ─────────────────────────────────────────────

def _extract_assemblies(msp, all_text: str, warnings: list[str]) -> list[HarnessAssembly]:
    """
    Detect harness assemblies from INSERT blocks or from assembly title text.
    """
    assemblies: list[HarnessAssembly] = []
    _HARNESS_BLOCKS = {"HARNESS_ASSEMBLY", "HARNESS", "CABLE_ASSEMBLY", "WIRE_BUNDLE"}

    for entity in msp:
        if entity.dxftype() != "INSERT":
            continue
        bname = (entity.dxf.name or "").upper()
        if not any(bname.startswith(b) for b in _HARNESS_BLOCKS):
            continue

        attribs = _get_attribs(entity)
        assembly_number = (
            attribs.get("ASSEMBLY_NUMBER") or attribs.get("ASS_NO") or
            attribs.get("DWG_NO") or attribs.get("PN") or ""
        )
        title     = attribs.get("TITLE") or attribs.get("DESCRIPTION") or ""
        ata       = attribs.get("ATA") or ""
        zone      = attribs.get("ZONE") or attribs.get("AIRFRAME_ZONE") or ""
        sleeving  = attribs.get("SLEEVING") or attribs.get("SLEEVE_SPEC") or ""

        routing_codes: list[str] = []
        for m in _ZONE_RE.finditer(attribs.get("ROUTING", "") or zone):
            routing_codes.append(m.group(0))

        assemblies.append(HarnessAssembly(
            id=str(uuid.uuid4()),
            assembly_number=assembly_number,
            assembly_title=title,
            ata_chapter=ata,
            airframe_zone=zone,
            routing_codes=routing_codes,
            sleeving_spec=sleeving,
        ))

    # Fallback: detect from title text if no INSERT blocks found
    if not assemblies:
        for m in _ASSEMBLY_RE.finditer(all_text):
            asm_num = f"H{m.group(1)}"
            if not any(a.assembly_number == asm_num for a in assemblies):
                zones = _ZONE_RE.findall(all_text)
                assemblies.append(HarnessAssembly(
                    id=str(uuid.uuid4()),
                    assembly_number=asm_num,
                    routing_codes=list(set(zones)),
                ))

    if not assemblies:
        # Create a single default assembly to hold all wires
        assemblies.append(HarnessAssembly(
            id=str(uuid.uuid4()),
            assembly_number="H001",
            assembly_title="Default Harness Assembly",
        ))
        warnings.append("No explicit harness assembly blocks found; created default H001.")

    return assemblies


# ─────────────────────────────────────────────
# Splice extraction
# ─────────────────────────────────────────────

def _extract_splices(msp) -> list[Splice]:
    splices: list[Splice] = []
    _SPLICE_BLOCKS = {"SPLICE", "SPLICE_CRIMP", "SPLICE_SOLDER"}
    _SPLICE_REF_RE = re.compile(r'\bSP\d{3,}\b')

    for entity in msp:
        if entity.dxftype() != "INSERT":
            continue
        bname = (entity.dxf.name or "").upper()
        if not any(bname.startswith(b) for b in _SPLICE_BLOCKS):
            continue

        attribs = _get_attribs(entity)
        ref = attribs.get("REF") or attribs.get("SPLICE_REF") or ""
        splice_type = attribs.get("TYPE") or "crimp"
        pn   = attribs.get("PART_NUMBER") or attribs.get("PN") or ""
        loc  = attribs.get("LOCATION") or attribs.get("POSITION") or ""
        zone = attribs.get("ZONE") or ""

        splices.append(Splice(
            id=str(uuid.uuid4()),
            ref=ref,
            splice_type=splice_type.lower(),
            part_number=pn,
            location_description=loc,
            airframe_zone=zone,
        ))

    return splices


# ─────────────────────────────────────────────
# PUBLIC
# ─────────────────────────────────────────────

def parse_harness_dxf(
    file_path: str | Path,
    sheet_number: int = 1,
    warnings: Optional[list[str]] = None,
) -> HarnessSheet:
    """
    Parse a DXF file as a Layer 3 harness drawing.

    Returns:
        Populated HarnessSheet.
    """
    if warnings is None:
        warnings = []

    try:
        import ezdxf
    except ImportError:
        warnings.append("ezdxf not installed — cannot parse DXF")
        return HarnessSheet(number=sheet_number)

    try:
        doc = ezdxf.readfile(str(file_path))
    except Exception as exc:
        warnings.append(f"DXF read error: {exc}")
        return HarnessSheet(number=sheet_number)

    msp = doc.modelspace()

    # Collect all text
    all_lines: list[str] = []
    for entity in msp:
        if entity.dxftype() in ("TEXT", "MTEXT"):
            t = _get_text(entity)
            if t.strip():
                all_lines.extend(t.splitlines())
    all_text = "\n".join(all_lines)

    # Extract data
    wire_records   = _parse_wire_table_text(all_lines)
    connectors     = _extract_connector_details(msp)
    assemblies     = _extract_assemblies(msp, all_text, warnings)
    splices        = _extract_splices(msp)

    # Routing codes from text
    routing_codes  = list({m.group(0) for m in _ZONE_RE.finditer(all_text)})

    # Assign wires to the first assembly (simplistic; cross_ref_builder refines later)
    if assemblies:
        assemblies[0].wires = wire_records
        assemblies[0].connectors = connectors
        assemblies[0].splices = splices
        if routing_codes:
            assemblies[0].routing_codes = routing_codes

    if not wire_records:
        warnings.append(
            f"Sheet {sheet_number}: No wire records extracted. "
            "Ensure wire list table contains W###-### labels with connector refs."
        )

    sheet_title = Path(file_path).stem

    return HarnessSheet(
        number=sheet_number,
        title=sheet_title,
        assemblies=assemblies,
        wire_list=wire_records,
        connector_table=connectors,
    )
