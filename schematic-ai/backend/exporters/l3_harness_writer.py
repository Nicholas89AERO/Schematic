"""
Layer 3 — Harness DXF Writer and wire list CSV exporter.
"""

from __future__ import annotations

import csv
import uuid
from pathlib import Path

import ezdxf

from models.project import HarnessSheet, ProjectModel


_LAYER_TRUNK  = "HARNESS_TRUNK"
_LAYER_BRANCH = "HARNESS_BRANCH"
_LAYER_CONN   = "CONNECTOR"
_LAYER_TEXT   = "TEXT"
_LAYER_TABLE  = "WIRE_TABLE"


def _setup_layers(doc) -> None:
    for name, color in [
        (_LAYER_TRUNK, 7), (_LAYER_BRANCH, 8), (_LAYER_CONN, 3),
        (_LAYER_TEXT, 7), (_LAYER_TABLE, 2),
    ]:
        if name not in doc.layers:
            doc.layers.add(name, color=color)


def write_harness_dxf(project: ProjectModel, out_path: Path) -> Path:
    """Write all HarnessSheet objects to DXF."""
    doc = ezdxf.new("R2018", setup=True)
    _setup_layers(doc)
    msp = doc.modelspace()

    sheet_offset = 0.0
    for hs in project.harness_sheets:
        _write_harness_sheet(msp, hs, offset_y=sheet_offset)
        sheet_offset += 400.0

    doc.saveas(str(out_path))
    return out_path


def _write_harness_sheet(msp, hs: HarnessSheet, offset_y: float = 0.0) -> None:
    for asm_idx, asm in enumerate(hs.assemblies):
        x_start = 20.0
        x_end   = 280.0
        y_trunk = offset_y + 200.0 - asm_idx * 100.0

        # ── Harness trunk ────────────────────────────────────────────
        msp.add_line(
            (x_start, y_trunk), (x_end, y_trunk),
            dxfattribs={"layer": _LAYER_TRUNK, "lineweight": 70},
        )
        msp.add_text(
            asm.assembly_number or "H???",
            dxfattribs={"layer": _LAYER_TEXT, "height": 4.0,
                        "insert": (x_start, y_trunk + 5)},
        )
        if asm.airframe_zone:
            msp.add_text(
                asm.airframe_zone,
                dxfattribs={"layer": _LAYER_TEXT, "height": 2.5,
                            "insert": (x_start, y_trunk + 10)},
            )

        # ── Connector circles at trunk ends ──────────────────────────
        for x_pos in (x_start, x_end):
            msp.add_circle(
                (x_pos, y_trunk), radius=6.0,
                dxfattribs={"layer": _LAYER_CONN, "lineweight": 30},
            )

        # ── Branch breakouts ──────────────────────────────────────────
        for bk_idx, bk in enumerate(asm.breakouts):
            bx = x_start + (x_end - x_start) * (bk_idx + 1) / (len(asm.breakouts) + 1)
            msp.add_line(
                (bx, y_trunk), (bx, y_trunk - 40.0),
                dxfattribs={"layer": _LAYER_BRANCH, "lineweight": 25},
            )
            msp.add_text(
                bk.ref or f"BR{bk_idx + 1:02d}",
                dxfattribs={"layer": _LAYER_TEXT, "height": 2.5,
                            "insert": (bx + 1, y_trunk - 45)},
            )

        # ── Wire list table ───────────────────────────────────────────
        _write_wire_table(msp, asm.wires, x_start=x_start, y_start=y_trunk - 70.0)


def _write_wire_table(msp, wires, x_start: float, y_start: float) -> None:
    """Write a simple tabular wire list below the harness trunk."""
    if not wires:
        return

    col_widths = [30, 25, 10, 25, 10, 15, 12, 15, 40]
    headers    = ["Wire No.", "From", "Pin", "To", "Pin", "Length(m)", "CS(mm²)", "Color", "Spec"]
    row_h      = 7.0
    y          = y_start

    # Header row
    x = x_start
    for col, (w, h) in enumerate(zip(col_widths, headers)):
        msp.add_text(
            h,
            dxfattribs={"layer": _LAYER_TABLE, "height": 2.5, "insert": (x, y), "color": 2},
        )
        x += w
    y -= row_h

    # Data rows
    for wr in wires:
        x = x_start
        row = [
            wr.wire_label,
            wr.from_connector,
            wr.from_pin,
            wr.to_connector,
            wr.to_pin,
            f"{wr.length_m:.2f}" if wr.length_m is not None else "",
            f"{wr.cross_section_mm2}" if wr.cross_section_mm2 else "",
            wr.color,
            wr.material_spec,
        ]
        for val, w in zip(row, col_widths):
            msp.add_text(
                str(val)[:20],
                dxfattribs={"layer": _LAYER_TABLE, "height": 2.5, "insert": (x, y)},
            )
            x += w
        y -= row_h


def write_wire_list_csv(project: ProjectModel) -> Path:
    """Export the full wire list across all harness sheets as a CSV."""
    out_path = Path(f"/tmp/wire_list_{uuid.uuid4().hex[:8]}.csv")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Assembly", "Wire No.", "From Connector", "From Pin",
            "To Connector", "To Pin", "Length (m)", "Cross Section (mm²)",
            "AWG", "Color", "Material Spec", "Signal Name", "Signal Type", "Shielded",
        ])
        for hs in project.harness_sheets:
            for asm in hs.assemblies:
                for wr in asm.wires:
                    writer.writerow([
                        asm.assembly_number,
                        wr.wire_label,
                        wr.from_connector,
                        wr.from_pin,
                        wr.to_connector,
                        wr.to_pin,
                        wr.length_m if wr.length_m is not None else "",
                        wr.cross_section_mm2 or "",
                        wr.awg or "",
                        wr.color,
                        wr.material_spec,
                        wr.signal_name,
                        wr.signal_type.value,
                        "Yes" if wr.shielded else "No",
                    ])
    return out_path
