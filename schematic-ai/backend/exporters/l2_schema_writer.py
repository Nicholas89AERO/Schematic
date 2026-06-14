"""
Layer 2 — Schematic DXF Writer and CSV exporters (BOM, pin table).
"""

from __future__ import annotations

import csv
import uuid
from pathlib import Path

import ezdxf

from ..models.project import DrawingLayer, ProjectModel, SchematicSheet


_LAYER_WIRE   = "WIRE"
_LAYER_SYM    = "SYMBOL"
_LAYER_TEXT   = "TEXT"
_LAYER_CONN   = "CONNECTOR"
_LAYER_TB     = "TITLE_BLOCK"


def _setup_layers(doc) -> None:
    for name, color in [
        (_LAYER_WIRE, 5), (_LAYER_SYM, 7), (_LAYER_TEXT, 7),
        (_LAYER_CONN, 3), (_LAYER_TB, 8),
    ]:
        if name not in doc.layers:
            doc.layers.add(name, color=color)


def write_schematic_dxf(project: ProjectModel, out_path: Path) -> Path:
    """Write all SchematicSheet objects to a single DXF file (separate viewports per sheet)."""
    doc = ezdxf.new("R2018", setup=True)
    _setup_layers(doc)
    msp = doc.modelspace()

    sheet_offset_y = 0.0
    for sheet in project.schematic_sheets:
        _write_schematic_sheet(msp, sheet, offset_y=sheet_offset_y)
        sheet_offset_y += 300.0  # stack sheets vertically

    doc.saveas(str(out_path))
    return out_path


def _write_schematic_sheet(msp, sheet: SchematicSheet, offset_y: float = 0.0) -> None:
    """Write one schematic sheet into modelspace with a Y offset."""

    # ── Connector shells ──────────────────────────────────────────────
    for conn in sheet.connectors:
        cx = conn.position.x
        cy = conn.position.y + offset_y
        pin_h = 8.0
        box_h = max(len(conn.pins), 1) * pin_h + 4.0
        box_w = 40.0

        # Connector outline
        msp.add_lwpolyline(
            [(cx, cy), (cx + box_w, cy), (cx + box_w, cy + box_h),
             (cx, cy + box_h), (cx, cy)],
            dxfattribs={"layer": _LAYER_CONN, "lineweight": 25},
        )
        msp.add_text(
            conn.ref or "?",
            dxfattribs={"layer": _LAYER_TEXT, "height": 3.0, "insert": (cx + 2, cy + box_h - 4)},
        )
        if conn.part_number:
            msp.add_text(
                conn.part_number,
                dxfattribs={"layer": _LAYER_TEXT, "height": 2.0, "insert": (cx + 2, cy + box_h - 8)},
            )

        # Pin rows
        for i, pin in enumerate(conn.pins):
            py = cy + box_h - 12 - i * pin_h
            msp.add_text(
                f"{pin.pin_number}  {pin.signal_name}  {pin.wire_id}",
                dxfattribs={"layer": _LAYER_TEXT, "height": 2.5, "insert": (cx + 2, py)},
            )

    # ── Components ────────────────────────────────────────────────────
    for comp in sheet.components:
        cx = comp.position.x
        cy = comp.position.y + offset_y
        msp.add_text(
            comp.ref or comp.type.value,
            dxfattribs={"layer": _LAYER_TEXT, "height": 2.5, "insert": (cx, cy + 4)},
        )
        # Simple box placeholder for symbol
        msp.add_lwpolyline(
            [(cx - 5, cy - 5), (cx + 5, cy - 5), (cx + 5, cy + 5),
             (cx - 5, cy + 5), (cx - 5, cy - 5)],
            dxfattribs={"layer": _LAYER_SYM},
        )

    # ── Wire segments ─────────────────────────────────────────────────
    for wire in sheet.wires:
        sx, sy = wire.start.x, wire.start.y + offset_y
        ex, ey = wire.end.x, wire.end.y + offset_y
        msp.add_line(
            (sx, sy), (ex, ey),
            dxfattribs={"layer": _LAYER_WIRE, "lineweight": 18},
        )
        if wire.label:
            mx, my = (sx + ex) / 2, (sy + ey) / 2 + 2
            msp.add_text(
                wire.label,
                dxfattribs={"layer": _LAYER_TEXT, "height": 2.0, "insert": (mx, my)},
            )


def write_bom_csv(project: ProjectModel, layer: DrawingLayer) -> Path:
    """Generate a Bill of Materials CSV for schematic components."""
    out_path = Path(f"/tmp/bom_{uuid.uuid4().hex[:8]}.csv")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Ref", "Type", "Sheet", "Part Number", "Description"])
        for sheet in project.schematic_sheets:
            for comp in sheet.components:
                pn  = comp.attributes.get("PART_NUMBER", "")
                desc = comp.attributes.get("DESCRIPTION", comp.type.value)
                writer.writerow([comp.ref, comp.type.value, sheet.number, pn, desc])
            for conn in sheet.connectors:
                writer.writerow([conn.ref, "connector_shell", sheet.number, conn.part_number, ""])
    return out_path


def write_pin_table_csv(project: ProjectModel, connector_ref: str) -> Path:
    """Generate a pin assignment CSV for a specific connector."""
    out_path = Path(f"/tmp/pin_table_{connector_ref}_{uuid.uuid4().hex[:8]}.csv")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Pin", "Signal Name", "Wire Label", "Mating Connector", "Mating Pin"])
        for sheet in project.schematic_sheets:
            for conn in sheet.connectors:
                if conn.ref.upper() == connector_ref.upper():
                    for pin in conn.pins:
                        writer.writerow([
                            pin.pin_number, pin.signal_name, pin.wire_id,
                            pin.mating_connector_ref, pin.mating_pin,
                        ])
    return out_path
