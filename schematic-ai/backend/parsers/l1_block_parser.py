"""
Layer 1 — Block Diagram DXF Parser.

Extracts LRUBlock and SignalPath objects from a system-level block diagram DXF.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Optional

from ..models.project import (
    BlockDiagram, LRUBlock, Point, SignalPath, SignalType,
)
from .symbol_matcher import extract_signal_path_id, extract_voltage, infer_signal_type


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

_SP_RE      = re.compile(r'\bSP-\d{3,}\b')
_BUS_RE     = re.compile(r'\b(?:DC BUS|AC BUS|ESS BUS|BUS\s*\d+|DC\s*BUS\s*\d+|AC\s*ESS\s*BUS)\b', re.IGNORECASE)
_LRU_REF_RE = re.compile(r'\b([A-Z]{2,5}-\d+)\b')
_ATA_RE     = re.compile(r'\bATA\s*(\d{2})\b', re.IGNORECASE)


def _point(x: float, y: float) -> Point:
    return Point(x=round(x, 4), y=round(y, 4))


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


def _get_text(entity) -> str:
    kind = entity.dxftype()
    if kind == "TEXT":
        return entity.dxf.text or ""
    if kind == "MTEXT":
        raw = entity.text or ""
        return re.sub(r"\\[^;]+;|{|}|\\~", "", raw).strip()
    return ""


# ─────────────────────────────────────────────
# LRU block detection
# ─────────────────────────────────────────────

# Block diagram LRU blocks are typically large rectangular INSERTs or
# closed LWPOLYLINE rectangles with nearby text labels.

_LRU_BLOCK_NAMES = {
    "LRU", "LRU_BOX", "EQUIPMENT", "UNIT", "SUBSYSTEM", "SYSTEM_BOX",
    "ECU_BOX", "BLOCK", "SYS_BLOCK", "INTERFACE_BOX",
}


def _is_lru_block(block_name: str) -> bool:
    upper = block_name.upper()
    for name in _LRU_BLOCK_NAMES:
        if upper == name or upper.startswith(name):
            return True
    return False


def _extract_lru_blocks(msp, sheet_num: int, warnings: list[str]) -> list[LRUBlock]:
    blocks: list[LRUBlock] = []

    # Method 1: Named INSERT blocks
    for entity in msp:
        if entity.dxftype() != "INSERT":
            continue
        bname = entity.dxf.name or ""
        if not _is_lru_block(bname):
            continue

        attribs = _get_attribs(entity)
        ref = (
            attribs.get("REF") or attribs.get("ID") or
            attribs.get("REFDES") or attribs.get("LRU_ID") or ""
        )
        name = (
            attribs.get("NAME") or attribs.get("TITLE") or
            attribs.get("DESCRIPTION") or attribs.get("LABEL") or ""
        )
        ata = attribs.get("ATA") or attribs.get("ATA_CHAPTER") or ""
        pn = attribs.get("PART_NUMBER") or attribs.get("PN") or ""
        inst_dwg = attribs.get("INSTALLATION_DWG") or attribs.get("INST_DWG") or ""

        try:
            pos = entity.dxf.insert
            position = _point(pos.x, pos.y)
        except Exception:
            position = Point()

        block = LRUBlock(
            id=str(uuid.uuid4()),
            ref=ref,
            name=name,
            ata_chapter=ata,
            part_number=pn,
            installation_dwg=inst_dwg,
            position=position,
            sheet=sheet_num,
        )
        blocks.append(block)

    # Method 2: LWPOLYLINE rectangles with nearby text
    # Collect all text positions first
    text_map: list[tuple[Point, str]] = []
    for entity in msp:
        if entity.dxftype() in ("TEXT", "MTEXT"):
            t = _get_text(entity)
            if t.strip():
                try:
                    if entity.dxftype() == "TEXT":
                        p = entity.dxf.insert
                    else:
                        p = entity.dxf.insert
                    text_map.append((_point(p.x, p.y), t.strip()))
                except Exception:
                    pass

    for entity in msp:
        if entity.dxftype() != "LWPOLYLINE":
            continue
        try:
            pts = list(entity.get_points())
        except Exception:
            continue

        if len(pts) < 4:
            continue

        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        width  = max(xs) - min(xs)
        height = max(ys) - min(ys)

        # LRU boxes are typically wide rectangles (width > 30mm, aspect ratio 1.5–5)
        if width < 30 or height < 10:
            continue
        aspect = width / max(height, 1)
        if aspect < 1.2 or aspect > 8:
            continue

        cx = (max(xs) + min(xs)) / 2
        cy = (max(ys) + min(ys)) / 2

        # Find text inside/near this box
        nearby_texts = []
        for tp, tv in text_map:
            if (min(xs) - 5) <= tp.x <= (max(xs) + 5) and (min(ys) - 5) <= tp.y <= (max(ys) + 5):
                nearby_texts.append(tv)

        if not nearby_texts:
            continue

        # Skip if already captured as INSERT
        if any(
            abs(b.position.x - cx) < 5 and abs(b.position.y - cy) < 5
            for b in blocks
        ):
            continue

        combined = " ".join(nearby_texts)
        ref_m = _LRU_REF_RE.search(combined)
        ref = ref_m.group(1) if ref_m else ""
        ata_m = _ATA_RE.search(combined)
        ata = ata_m.group(1) if ata_m else ""

        block = LRUBlock(
            id=str(uuid.uuid4()),
            ref=ref,
            name=combined[:60],
            ata_chapter=ata,
            position=_point(cx, cy),
            size=(round(width, 1), round(height, 1)),
            sheet=sheet_num,
        )
        blocks.append(block)

    if not blocks:
        warnings.append(
            f"Sheet {sheet_num}: No LRU blocks detected. "
            "Verify block names match LRU_BOX pattern or polyline rectangles are present."
        )

    return blocks


# ─────────────────────────────────────────────
# Signal path extraction
# ─────────────────────────────────────────────

def _extract_signal_paths(
    msp,
    sheet_num: int,
    lru_blocks: list[LRUBlock],
) -> list[SignalPath]:
    """
    Extract SignalPath objects from polylines/lines that connect LRU blocks.
    """
    paths: list[SignalPath] = []
    text_map: list[tuple[Point, str]] = []

    for entity in msp:
        if entity.dxftype() in ("TEXT", "MTEXT"):
            t = _get_text(entity)
            if t.strip():
                try:
                    if entity.dxftype() == "TEXT":
                        p = entity.dxf.insert
                    else:
                        p = entity.dxf.insert
                    text_map.append((_point(p.x, p.y), t.strip()))
                except Exception:
                    pass

    # Build LRU bounding boxes for endpoint → LRU matching
    lru_rects = []
    for lru in lru_blocks:
        w, h = lru.size if isinstance(lru.size, tuple) else (60, 30)
        x0 = lru.position.x - w / 2
        x1 = lru.position.x + w / 2
        y0 = lru.position.y - h / 2
        y1 = lru.position.y + h / 2
        lru_rects.append((lru.id, x0, y0, x1, y1))

    def find_lru_at(x: float, y: float, margin: float = 10.0) -> str:
        for lru_id, x0, y0, x1, y1 in lru_rects:
            if (x0 - margin) <= x <= (x1 + margin) and (y0 - margin) <= y <= (y1 + margin):
                return lru_id
        return ""

    for entity in msp:
        kind = entity.dxftype()
        waypoints: list[Point] = []
        start_pt: Optional[Point] = None
        end_pt: Optional[Point] = None

        if kind == "LINE":
            try:
                s = entity.dxf.start
                e = entity.dxf.end
                length = ((e.x - s.x) ** 2 + (e.y - s.y) ** 2) ** 0.5
                if length < 20:
                    continue  # too short to be a signal path line
                start_pt = _point(s.x, s.y)
                end_pt   = _point(e.x, e.y)
            except Exception:
                continue

        elif kind == "LWPOLYLINE":
            try:
                pts = list(entity.get_points())
                if len(pts) < 2:
                    continue
                start_pt = _point(pts[0][0], pts[0][1])
                end_pt   = _point(pts[-1][0], pts[-1][1])
                waypoints = [_point(p[0], p[1]) for p in pts[1:-1]]
            except Exception:
                continue
        else:
            continue

        from_lru = find_lru_at(start_pt.x, start_pt.y)
        to_lru   = find_lru_at(end_pt.x, end_pt.y)

        # Only capture lines that connect two distinct LRUs
        if not from_lru and not to_lru:
            continue

        # Find nearest label text
        mid_x = (start_pt.x + end_pt.x) / 2
        mid_y = (start_pt.y + end_pt.y) / 2
        closest_text = ""
        closest_dist = 20.0
        for tp, tv in text_map:
            dist = ((tp.x - mid_x) ** 2 + (tp.y - mid_y) ** 2) ** 0.5
            if dist < closest_dist:
                closest_dist = dist
                closest_text = tv

        path_id  = extract_signal_path_id(closest_text) or ""
        voltage  = extract_voltage(closest_text)
        sig_type = infer_signal_type(closest_text)

        sp = SignalPath(
            id=str(uuid.uuid4()),
            path_id=path_id,
            signal_type=sig_type,
            from_lru_id=from_lru,
            to_lru_id=to_lru,
            voltage=voltage,
            sheet=sheet_num,
            waypoints=waypoints,
        )
        paths.append(sp)

    return paths


# ─────────────────────────────────────────────
# PUBLIC
# ─────────────────────────────────────────────

def parse_block_diagram_dxf(
    file_path: str | Path,
    sheet_number: int = 1,
    warnings: Optional[list[str]] = None,
) -> BlockDiagram:
    """
    Parse a DXF file as a Layer 1 block diagram.

    Returns:
        Populated BlockDiagram.
    """
    if warnings is None:
        warnings = []

    try:
        import ezdxf
    except ImportError:
        warnings.append("ezdxf not installed — cannot parse DXF")
        return BlockDiagram(sheet_number=sheet_number)

    try:
        doc = ezdxf.readfile(str(file_path))
    except Exception as exc:
        warnings.append(f"DXF read error: {exc}")
        return BlockDiagram(sheet_number=sheet_number)

    msp = doc.modelspace()

    # Sheet title
    sheet_title = Path(file_path).stem

    lru_blocks = _extract_lru_blocks(msp, sheet_number, warnings)
    signal_paths = _extract_signal_paths(msp, sheet_number, lru_blocks)

    # Power buses — scan for thick polylines labelled with BUS keywords
    power_buses: list[dict] = []
    text_map: list[tuple[Point, str]] = []
    for entity in msp:
        if entity.dxftype() in ("TEXT", "MTEXT"):
            t = _get_text(entity)
            if t.strip():
                try:
                    if entity.dxftype() == "TEXT":
                        p = entity.dxf.insert
                    else:
                        p = entity.dxf.insert
                    text_map.append((_point(p.x, p.y), t.strip()))
                except Exception:
                    pass

    for entity in msp:
        if entity.dxftype() not in ("LINE", "LWPOLYLINE"):
            continue
        try:
            lw = entity.dxf.lineweight
            if lw < 50:  # only thick lines (lineweight ≥ 50 = 0.50mm)
                continue
        except Exception:
            continue

        try:
            if entity.dxftype() == "LINE":
                s = entity.dxf.start
                pts = [_point(s.x, s.y)]
            else:
                raw = list(entity.get_points())
                pts = [_point(p[0], p[1]) for p in raw]
        except Exception:
            continue

        if not pts:
            continue

        mid_x = sum(p.x for p in pts) / len(pts)
        mid_y = sum(p.y for p in pts) / len(pts)
        closest_text = ""
        closest_dist = 25.0
        for tp, tv in text_map:
            dist = ((tp.x - mid_x) ** 2 + (tp.y - mid_y) ** 2) ** 0.5
            if dist < closest_dist:
                closest_dist = dist
                closest_text = tv

        if not _BUS_RE.search(closest_text):
            continue

        voltage = extract_voltage(closest_text)
        power_buses.append({
            "id": str(uuid.uuid4()),
            "label": closest_text[:40],
            "voltage": voltage,
            "sheet": sheet_number,
            "waypoints": [p.to_dict() for p in pts],
        })

    return BlockDiagram(
        sheet_number=sheet_number,
        title=sheet_title,
        lru_blocks=lru_blocks,
        signal_paths=signal_paths,
        power_buses=power_buses,
    )
