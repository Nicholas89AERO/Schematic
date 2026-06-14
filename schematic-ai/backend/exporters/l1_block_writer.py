"""
Layer 1 — Block Diagram DXF Writer.

Writes a BlockDiagram to DXF R2018 format.
  - LRU boxes: closed LWPOLYLINE + centred MTEXT labels
  - Signal paths: LWPOLYLINE with arrowhead and midpoint text label
  - Power buses: thick LWPOLYLINE with label
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

import ezdxf
from ezdxf.enums import TextEntityAlignment

from ..models.project import BlockDiagram, DrawingLayer, ProjectModel, SignalType


# Signal type → DXF colour index (ACI)
_SIGNAL_COLORS = {
    SignalType.POWER_DC:     2,   # Yellow
    SignalType.POWER_AC:     1,   # Red
    SignalType.ARINC429:     5,   # Blue
    SignalType.ARINC664:     4,   # Cyan
    SignalType.MIL_STD_1553: 6,   # Magenta
    SignalType.DISCRETE:     8,   # Dark grey
    SignalType.ANALOG:       3,   # Green
    SignalType.RS422:        30,  # Orange-ish
    SignalType.CAN:          40,
    SignalType.GROUND:       3,
    SignalType.UNKNOWN:      7,   # White
}

_LAYER_WIRE    = "WIRE"
_LAYER_LRU     = "LRU_BOX"
_LAYER_SIGNAL  = "SIGNAL_PATH"
_LAYER_BUS     = "POWER_BUS"
_LAYER_TEXT    = "TEXT"
_LAYER_TB      = "TITLE_BLOCK"


def _setup_layers(doc: ezdxf.document.Drawing) -> None:
    lt = doc.layers
    for name, color in [
        (_LAYER_LRU, 7), (_LAYER_SIGNAL, 5), (_LAYER_BUS, 2),
        (_LAYER_TEXT, 7), (_LAYER_TB, 8),
    ]:
        if name not in lt:
            lt.add(name, color=color)


def _add_arrowhead(msp, x: float, y: float, angle_deg: float, size: float = 3.0) -> None:
    """Add a simple filled triangle arrowhead."""
    import math
    rad = math.radians(angle_deg)
    tip_x = x
    tip_y = y
    base1_x = x - size * math.cos(rad) + (size / 2) * math.sin(rad)
    base1_y = y - size * math.sin(rad) - (size / 2) * math.cos(rad)
    base2_x = x - size * math.cos(rad) - (size / 2) * math.sin(rad)
    base2_y = y - size * math.sin(rad) + (size / 2) * math.cos(rad)
    msp.add_lwpolyline(
        [(tip_x, tip_y), (base1_x, base1_y), (base2_x, base2_y), (tip_x, tip_y)],
        dxfattribs={"layer": _LAYER_SIGNAL, "closed": True},
    )


def write_block_diagram_dxf(project: ProjectModel, out_path: Path) -> Path:
    """Write all BlockDiagram sheets to a single DXF file."""
    doc = ezdxf.new("R2018", setup=True)
    _setup_layers(doc)
    msp = doc.modelspace()

    for bd in project.block_diagrams:
        _write_block_diagram(msp, bd)

    doc.saveas(str(out_path))
    return out_path


def _write_block_diagram(msp, bd: BlockDiagram) -> None:
    import math

    # ── LRU boxes ────────────────────────────────────────────────────
    for lru in bd.lru_blocks:
        w, h = lru.size if isinstance(lru.size, tuple) else (60.0, 30.0)
        cx, cy = lru.position.x, lru.position.y
        x0, y0 = cx - w / 2, cy - h / 2
        x1, y1 = cx + w / 2, cy + h / 2

        # Box outline
        msp.add_lwpolyline(
            [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)],
            dxfattribs={"layer": _LAYER_LRU, "lineweight": 30},
        )

        # Centred name label
        msp.add_mtext(
            lru.name or lru.ref,
            dxfattribs={
                "layer": _LAYER_TEXT,
                "char_height": 3.0,
                "insert": (cx, cy + 4),
            },
        )
        # Ref designator top-left
        if lru.ref:
            msp.add_text(
                lru.ref,
                dxfattribs={"layer": _LAYER_TEXT, "height": 2.5, "insert": (x0 + 2, y1 - 4)},
            )
        # ATA chapter bottom-right
        if lru.ata_chapter:
            msp.add_text(
                f"ATA {lru.ata_chapter}",
                dxfattribs={"layer": _LAYER_TEXT, "height": 2.0, "insert": (x1 - 12, y0 + 2)},
            )

    # ── Signal paths ──────────────────────────────────────────────────
    for sp in bd.signal_paths:
        color = _SIGNAL_COLORS.get(sp.signal_type, 7)

        # Build polyline points from waypoints
        pts = []
        # Estimate start/end from LRU positions
        from_lru = next((l for l in bd.lru_blocks if l.id == sp.from_lru_id), None)
        to_lru   = next((l for l in bd.lru_blocks if l.id == sp.to_lru_id),   None)
        if from_lru:
            pts.append((from_lru.position.x, from_lru.position.y))
        pts.extend([(w.x, w.y) for w in sp.waypoints])
        if to_lru:
            pts.append((to_lru.position.x, to_lru.position.y))

        if len(pts) >= 2:
            msp.add_lwpolyline(
                pts,
                dxfattribs={"layer": _LAYER_SIGNAL, "color": color, "lineweight": 18},
            )
            # Arrowhead at destination
            ex, ey = pts[-1]
            px, py = pts[-2]
            angle = math.degrees(math.atan2(ey - py, ex - px))
            _add_arrowhead(msp, ex, ey, angle)

        # Label at midpoint
        if pts and sp.path_id:
            mid_idx = len(pts) // 2
            mx = (pts[mid_idx - 1][0] + pts[mid_idx][0]) / 2 if mid_idx > 0 else pts[0][0]
            my = (pts[mid_idx - 1][1] + pts[mid_idx][1]) / 2 if mid_idx > 0 else pts[0][1]
            label = sp.path_id
            if sp.voltage:
                label += f" / {sp.voltage}"
            msp.add_text(
                label,
                dxfattribs={"layer": _LAYER_TEXT, "height": 2.5, "insert": (mx, my + 2), "color": color},
            )

    # ── Power buses ────────────────────────────────────────────────────
    for bus in bd.power_buses:
        wpts = [(p["x"], p["y"]) for p in bus.get("waypoints", [])]
        if len(wpts) >= 2:
            msp.add_lwpolyline(
                wpts,
                dxfattribs={"layer": _LAYER_BUS, "lineweight": 70, "color": 2},
            )
            mx = (wpts[0][0] + wpts[-1][0]) / 2
            my = (wpts[0][1] + wpts[-1][1]) / 2 + 3
            msp.add_text(
                bus.get("label", ""),
                dxfattribs={"layer": _LAYER_TEXT, "height": 3.0, "insert": (mx, my), "color": 2},
            )
