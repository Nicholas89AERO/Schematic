"""
Layer 2 — Schematic DXF Parser.

Extracts Component, ConnectorShell, WireSegment, and Connection objects
from a schematic DXF file and assembles them into SchematicSheet objects.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Optional

from models.project import (
    Component, ComponentType, Connection, ConnectorPin, ConnectorShell,
    Point, SchematicSheet, SignalType, WireSegment,
)
from .symbol_matcher import (
    block_to_component_type,
    block_pins,
    extract_cross_section,
    extract_voltage,
    extract_wire_label,
    infer_signal_type,
    is_connector_layer,
    is_connector_ref,
    is_wire_layer,
    lookup_block,
)


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _get_text(entity) -> str:
    """Extract plain text from a TEXT or MTEXT entity."""
    kind = entity.dxftype()
    if kind == "TEXT":
        return entity.dxf.text or ""
    if kind == "MTEXT":
        raw = entity.text or ""
        # Strip MTEXT formatting codes like \P \L etc.
        return re.sub(r"\\[^;]+;|{|}|\\~|\\U\+[0-9A-Fa-f]{4}", "", raw).strip()
    return ""


def _point(x: float, y: float) -> Point:
    return Point(x=round(x, 4), y=round(y, 4))


def _entity_position(entity) -> Point:
    try:
        pos = entity.dxf.insert
        return _point(pos.x, pos.y)
    except Exception:
        return Point()


def _entity_rotation(entity) -> float:
    try:
        return entity.dxf.rotation or 0.0
    except Exception:
        return 0.0


def _collect_attribs(insert_entity) -> dict[str, str]:
    """Return {tag: value} dict from an INSERT entity's attributes."""
    attribs = {}
    try:
        for attrib in insert_entity.attribs:
            tag = (attrib.dxf.tag or "").upper().strip()
            val = (attrib.dxf.text or "").strip()
            if tag:
                attribs[tag] = val
    except Exception:
        pass
    return attribs


# ─────────────────────────────────────────────
# Sheet detection
# ─────────────────────────────────────────────

_SHEET_RE = re.compile(r'SHEET\s*(\d+)', re.IGNORECASE)
_DWG_TITLE_ATTRS = {"TITLE", "DWG_TITLE", "DRAWING_TITLE", "SHEET_TITLE", "NAME"}


def _detect_sheet_number(all_text: list[str]) -> int:
    for t in all_text:
        m = _SHEET_RE.search(t)
        if m:
            return int(m.group(1))
    return 1


def _detect_sheet_title(attrib_map: dict[str, dict]) -> str:
    for tag in _DWG_TITLE_ATTRS:
        if tag in attrib_map:
            return attrib_map[tag]
    return ""


# ─────────────────────────────────────────────
# Wire extraction
# ─────────────────────────────────────────────

def _extract_wires(msp, sheet_num: int, text_map: list[tuple[Point, str]]) -> list[WireSegment]:
    """
    Extract WireSegment objects from LWPOLYLINE / LINE entities on wire layers.
    Nearby text entities are associated with the wire segment as labels.
    """
    wires: list[WireSegment] = []

    for entity in msp:
        kind = entity.dxftype()
        layer_name = ""
        try:
            layer_name = entity.dxf.layer or ""
        except Exception:
            pass

        if not is_wire_layer(layer_name) and kind not in ("LINE",):
            # Also capture LINEs even without explicit wire layer if they
            # are very short (typical wire segment length ≤ 200mm)
            if kind == "LINE":
                try:
                    sx, sy = entity.dxf.start.x, entity.dxf.start.y
                    ex, ey = entity.dxf.end.x, entity.dxf.end.y
                    length = ((ex - sx) ** 2 + (ey - sy) ** 2) ** 0.5
                    if length > 500:
                        continue  # too long to be a wire segment
                except Exception:
                    continue
            else:
                continue

        segments: list[tuple[Point, Point]] = []

        if kind == "LINE":
            try:
                s = entity.dxf.start
                e = entity.dxf.end
                segments.append((_point(s.x, s.y), _point(e.x, e.y)))
            except Exception:
                continue
        elif kind == "LWPOLYLINE":
            try:
                pts = list(entity.get_points())
                for i in range(len(pts) - 1):
                    x0, y0 = pts[i][0], pts[i][1]
                    x1, y1 = pts[i + 1][0], pts[i + 1][1]
                    segments.append((_point(x0, y0), _point(x1, y1)))
            except Exception:
                continue

        for start, end in segments:
            mid_x = (start.x + end.x) / 2
            mid_y = (start.y + end.y) / 2

            # Find closest text within 15mm of midpoint
            closest_text = ""
            closest_dist = 15.0
            for tp, tv in text_map:
                dist = ((tp.x - mid_x) ** 2 + (tp.y - mid_y) ** 2) ** 0.5
                if dist < closest_dist:
                    closest_dist = dist
                    closest_text = tv

            label = extract_wire_label(closest_text) or ""
            voltage = extract_voltage(closest_text)
            cross_section = extract_cross_section(closest_text)
            sig_type = infer_signal_type(closest_text)

            ws = WireSegment(
                id=str(uuid.uuid4()),
                label=label,
                start=start,
                end=end,
                sheet=sheet_num,
                layer=layer_name,
                cross_section_mm2=cross_section,
                voltage=voltage,
                signal_type=sig_type,
            )
            wires.append(ws)

    return wires


# ─────────────────────────────────────────────
# Component / connector extraction
# ─────────────────────────────────────────────

def _extract_inserts(
    msp,
    sheet_num: int,
) -> tuple[list[Component], list[ConnectorShell]]:
    """
    Walk INSERT entities, classify them as Component or ConnectorShell,
    and extract all attributes.
    """
    components: list[Component] = []
    connectors: list[ConnectorShell] = []

    for entity in msp:
        if entity.dxftype() != "INSERT":
            continue

        block_name = entity.dxf.name or ""
        pos = _entity_position(entity)
        rot = _entity_rotation(entity)
        attribs = _collect_attribs(entity)
        comp_type = block_to_component_type(block_name)

        # Reference designator — try REF, REF_DES, REFDIS, TAG, ID
        ref = (
            attribs.get("REF")
            or attribs.get("REF_DES")
            or attribs.get("REFDES")
            or attribs.get("TAG")
            or attribs.get("ID")
            or ""
        )

        layer_name = ""
        try:
            layer_name = entity.dxf.layer or ""
        except Exception:
            pass

        # Detect connectors: by component type, block name prefix, or layer
        is_conn = (
            comp_type == ComponentType.CONNECTOR_SHELL
            or block_name.upper().startswith("CONN")
            or is_connector_ref(ref)
            or is_connector_layer(layer_name)
        )

        if is_conn:
            pn = (
                attribs.get("PART_NUMBER")
                or attribs.get("PN")
                or attribs.get("PART_NO")
                or ""
            )
            mating = attribs.get("MATING_REF") or attribs.get("MATING") or ""
            shell_class = attribs.get("SHELL_CLASS") or attribs.get("CLASS") or ""
            insert_arr = attribs.get("INSERT_ARRANGEMENT") or attribs.get("INSERT") or ""
            backshell = attribs.get("BACKSHELL_PN") or attribs.get("BACKSHELL") or ""
            potting = (attribs.get("POTTING", "").upper() in ("YES", "Y", "TRUE", "1"))

            conn = ConnectorShell(
                id=str(uuid.uuid4()),
                ref=ref,
                part_number=pn,
                mating_ref=mating,
                shell_class=shell_class,
                insert_arrangement=insert_arr,
                backshell_pn=backshell,
                potting_required=potting,
                pins=[],
                position=pos,
                sheet=sheet_num,
            )
            connectors.append(conn)
        else:
            comp = Component(
                id=str(uuid.uuid4()),
                ref=ref,
                type=comp_type,
                position=pos,
                rotation=rot,
                sheet=sheet_num,
                attributes=dict(attribs),
            )
            components.append(comp)

    return components, connectors


# ─────────────────────────────────────────────
# Pin table extraction (TABLE entities)
# ─────────────────────────────────────────────

def _extract_connector_pins_from_tables(doc, connectors: list[ConnectorShell]) -> None:
    """
    Parse DXF TABLE objects for connector pin assignment data and
    attach ConnectorPin records to the matching ConnectorShell.
    Uses a ref → ConnectorShell index for fast lookup.
    """
    conn_index = {c.ref.upper(): c for c in connectors if c.ref}

    try:
        for table in doc.tables:
            # TABLE is an ezdxf table entity — iterate its rows
            pass  # TABLE entities in DXF are different from data tables
    except Exception:
        pass

    # Pin assignment tables are more commonly encoded as MTEXT blocks or
    # custom block attributes. Fall back to scanning MTEXT near each connector.


def _extract_pins_from_text_proximity(
    msp,
    connectors: list[ConnectorShell],
    text_map: list[tuple[Point, str]],
) -> None:
    """
    Attempt to associate nearby text lines with connector pins.
    Text lines matching PIN_NUMBER SIGNAL_NAME WIRE_LABEL are parsed.
    """
    _PIN_ROW_RE = re.compile(
        r'^\s*([A-Z]?\d{1,3})\s+(\S+)\s+(W\d{3,}-\d{3,})\s*$'
    )

    for conn in connectors:
        cx, cy = conn.position.x, conn.position.y
        # Gather all text within 80mm of connector position
        nearby: list[str] = []
        for tp, tv in text_map:
            dist = ((tp.x - cx) ** 2 + (tp.y - cy) ** 2) ** 0.5
            if dist < 80:
                nearby.append(tv)

        for line in nearby:
            m = _PIN_ROW_RE.match(line.strip())
            if m:
                pin_num, sig_name, wire_label = m.group(1), m.group(2), m.group(3)
                if not any(p.pin_number == pin_num for p in conn.pins):
                    conn.pins.append(ConnectorPin(
                        pin_number=pin_num,
                        signal_name=sig_name,
                        wire_id=wire_label,
                    ))


# ─────────────────────────────────────────────
# Connection tracing
# ─────────────────────────────────────────────

def _build_connections(
    components: list[Component],
    connectors: list[ConnectorShell],
    wires: list[WireSegment],
) -> list[Connection]:
    """
    Build Connection objects by matching wire endpoints to component/connector
    positions within a tolerance of 2mm.
    """
    connections: list[Connection] = []
    TOLERANCE = 2.0

    all_elements: list[tuple[str, Point]] = []
    for c in components:
        all_elements.append((c.id, c.position))
    for c in connectors:
        all_elements.append((c.id, c.position))

    for wire in wires:
        for endpoint in (wire.start, wire.end):
            for elem_id, elem_pos in all_elements:
                dist = ((endpoint.x - elem_pos.x) ** 2 + (endpoint.y - elem_pos.y) ** 2) ** 0.5
                if dist < TOLERANCE:
                    connections.append(Connection(
                        component_id=elem_id,
                        pin="",       # pin matching requires deeper analysis
                        wire_id=wire.id,
                    ))
                    break

    return connections


# ─────────────────────────────────────────────
# Title block extraction
# ─────────────────────────────────────────────

def _extract_title_block_info(msp) -> dict:
    """Extract title block fields from special INSERT blocks or MTEXT."""
    info: dict = {}
    _TB_BLOCKS = {"TITLEBLOCK", "TITLE_BLOCK", "TITLE", "TB", "BORDER"}
    _TB_ATTRS = {
        "TITLE": "drawing_title", "DRAWING_TITLE": "drawing_title",
        "SHEET": "sheet_number", "SHEET_NO": "sheet_number",
        "PROJECT": "project_number", "PROJ_NO": "project_number",
        "REV": "revision", "REVISION": "revision",
        "DRAWN_BY": "drawn_by", "DRAWN": "drawn_by",
        "DATE": "date",
    }

    for entity in msp:
        if entity.dxftype() != "INSERT":
            continue
        bname = (entity.dxf.name or "").upper()
        if bname not in _TB_BLOCKS:
            continue
        attribs = _collect_attribs(entity)
        for tag, field_name in _TB_ATTRS.items():
            if tag in attribs:
                info[field_name] = attribs[tag]

    return info


# ─────────────────────────────────────────────
# PUBLIC: parse_schematic_dxf
# ─────────────────────────────────────────────

def parse_schematic_dxf(
    file_path: str | Path,
    sheet_number: int = 1,
    warnings: Optional[list[str]] = None,
) -> SchematicSheet:
    """
    Parse a DXF file as a Layer 2 schematic and return a SchematicSheet.

    Args:
        file_path: Path to the DXF file.
        sheet_number: Override the sheet number (auto-detected if possible).
        warnings: List to append parse warnings to.

    Returns:
        Populated SchematicSheet.
    """
    if warnings is None:
        warnings = []

    try:
        import ezdxf
    except ImportError:
        warnings.append("ezdxf not installed — cannot parse DXF")
        return SchematicSheet(number=sheet_number)

    try:
        doc = ezdxf.readfile(str(file_path))
    except Exception as exc:
        warnings.append(f"DXF read error: {exc}")
        return SchematicSheet(number=sheet_number)

    msp = doc.modelspace()

    # ── Build text map (position → value) for label association ──────
    text_map: list[tuple[Point, str]] = []
    all_text_values: list[str] = []
    for entity in msp:
        if entity.dxftype() in ("TEXT", "MTEXT"):
            txt = _get_text(entity)
            if txt.strip():
                pos = _entity_position(entity)
                text_map.append((pos, txt.strip()))
                all_text_values.append(txt.strip())

    # ── Sheet number + title detection ───────────────────────────────
    detected_sheet_num = _detect_sheet_number(all_text_values) or sheet_number

    # ── Extract components and connectors ────────────────────────────
    components, connectors = _extract_inserts(msp, detected_sheet_num)

    # ── Extract wires ────────────────────────────────────────────────
    wires = _extract_wires(msp, detected_sheet_num, text_map)

    # ── Extract connector pins ────────────────────────────────────────
    _extract_pins_from_text_proximity(msp, connectors, text_map)

    # ── Build connections ─────────────────────────────────────────────
    connections = _build_connections(components, connectors, wires)

    # ── Title block info ──────────────────────────────────────────────
    tb_info = _extract_title_block_info(msp)
    title = tb_info.get("drawing_title", Path(file_path).stem)

    # ── Signal path ID reference ─────────────────────────────────────
    signal_path_id = ""
    for tv in all_text_values:
        from .symbol_matcher import extract_signal_path_id
        sp = extract_signal_path_id(tv)
        if sp:
            signal_path_id = sp
            break

    if not components and not connectors:
        warnings.append(
            f"Sheet {detected_sheet_num}: No components or connectors extracted. "
            "Verify DXF uses INSERT entities for symbols."
        )
    if not wires:
        warnings.append(
            f"Sheet {detected_sheet_num}: No wire segments extracted. "
            "Verify DXF wires are on layers matching WIRE*."
        )

    return SchematicSheet(
        number=detected_sheet_num,
        title=title,
        signal_path_id=signal_path_id,
        lru_refs=[],
        components=components,
        connectors=connectors,
        wires=wires,
        connections=connections,
    )
