"""
Tests for the PDF import pipeline (parsers/pdf_parser.py).

Fixtures are generated on the fly with reportlab so no binary test assets are
needed. Each test builds a tiny PDF whose text cells mimic an aerospace drawing
and asserts the parser recovers the expected model data.
"""

from __future__ import annotations

import pytest

pytest.importorskip("reportlab")
pytest.importorskip("fitz")

from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas

from models.project import DrawingLayer
from parsers.pdf_parser import parse_pdf


def _make_pdf(path, pages):
    """
    Build a PDF at ``path``.

    ``pages`` is a list of pages; each page is a list of rows; each row is a list
    of text cells. Cells in a row share a baseline (same y) but sit at increasing
    x, exercising the coordinate-aware row reconstruction.
    """
    page_size = landscape(letter)
    width, height = page_size
    c = canvas.Canvas(str(path), pagesize=page_size)
    for page in pages:
        y = height - 60
        for row in page:
            x = 40
            for cell in row:
                c.drawString(x, y, str(cell))
                x += 78
            y -= 24
        c.showPage()
    c.save()
    return path


# ─────────────────────────────────────────────
# L3 — Harness wire list
# ─────────────────────────────────────────────

def test_harness_wire_list(tmp_path):
    pdf = _make_pdf(tmp_path / "harness.pdf", [[
        ["WIRE LIST"],
        ["DWG NO:", "H-1234"],
        ["TITLE:", "MAIN HARNESS"],
        ["W001-001", "P1001", "A", "J2001", "B", "2.5M", "M22759/16", "BLK", "AWG 20"],
        ["W001-002", "P1001", "C", "J2001", "D", "3.0M", "M22759/16", "RED", "AWG 22"],
    ]])

    layer, fragments, _ = parse_pdf(pdf, layer_hint=DrawingLayer.HARNESS)

    assert layer == DrawingLayer.HARNESS
    assert len(fragments) == 1
    sheet = fragments[0]
    assert sheet.title == "MAIN HARNESS"

    wires = sheet.wire_list
    assert len(wires) == 2

    w = wires[0]
    assert w.wire_label == "W001-001"
    assert w.from_connector == "P1001"
    assert w.to_connector == "J2001"
    assert w.from_pin == "A"
    assert w.to_pin == "B"
    assert w.length_m == 2.5
    assert w.color == "BLK"
    assert w.material_spec.startswith("M22759")
    assert w.awg == 20

    refs = {c.ref for c in sheet.connector_table}
    assert {"P1001", "J2001"}.issubset(refs)

    assert sheet.assemblies[0].assembly_number == "H-1234"


# ─────────────────────────────────────────────
# L1 — Block diagram
# ─────────────────────────────────────────────

def test_block_diagram(tmp_path):
    pdf = _make_pdf(tmp_path / "block.pdf", [[
        ["BLOCK DIAGRAM"],
        ["TITLE:", "POWER DISTRIBUTION"],
        ["ECU-1", "Engine", "Control", "Unit"],
        ["SP-001", "28VDC", "POWER"],
        ["PSU-2", "Power", "Supply"],
    ]])

    layer, fragments, _ = parse_pdf(pdf, layer_hint=DrawingLayer.BLOCK_DIAGRAM)

    assert layer == DrawingLayer.BLOCK_DIAGRAM
    bd = fragments[0]
    assert bd.title == "POWER DISTRIBUTION"

    refs = {b.ref for b in bd.lru_blocks}
    assert {"ECU-1", "PSU-2"}.issubset(refs)

    ecu = next(b for b in bd.lru_blocks if b.ref == "ECU-1")
    assert "Engine" in ecu.name

    sp = next((p for p in bd.signal_paths if p.path_id == "SP-001"), None)
    assert sp is not None
    assert sp.signal_type.value == "power_dc"
    assert sp.voltage == "28VDC"


# ─────────────────────────────────────────────
# L2 — Schematic
# ─────────────────────────────────────────────

def test_schematic(tmp_path):
    pdf = _make_pdf(tmp_path / "schematic.pdf", [[
        ["SCHEMATIC"],
        ["TITLE:", "CONTROL CIRCUIT"],
        ["CB1", "W001-001", "K1"],
        ["K1", "W001-002", "R1"],
        ["P100", "CONNECTOR"],
    ]])

    layer, fragments, _ = parse_pdf(pdf, layer_hint=DrawingLayer.SCHEMATIC)

    assert layer == DrawingLayer.SCHEMATIC
    sheet = fragments[0]
    assert sheet.title == "CONTROL CIRCUIT"

    comp_refs = {c.ref for c in sheet.components}
    assert {"CB1", "K1", "R1"}.issubset(comp_refs)

    conn_refs = {c.ref for c in sheet.connectors}
    assert "P100" in conn_refs

    wire_labels = {w.label for w in sheet.wires}
    assert {"W001-001", "W001-002"}.issubset(wire_labels)

    assert len(sheet.connections) >= 2

    cb1 = next(c for c in sheet.components if c.ref == "CB1")
    assert cb1.type.value == "circuit_breaker"


# ─────────────────────────────────────────────
# Multi-page → one sheet per page
# ─────────────────────────────────────────────

def test_multipage_harness(tmp_path):
    pdf = _make_pdf(tmp_path / "multi.pdf", [
        [["WIRE LIST"], ["W001-001", "P1001", "A", "J2001", "B"]],
        [["WIRE LIST"], ["W002-001", "P3001", "A", "J4001", "B"]],
    ])

    layer, fragments, _ = parse_pdf(pdf, layer_hint=DrawingLayer.HARNESS)

    assert layer == DrawingLayer.HARNESS
    assert len(fragments) == 2
    assert fragments[0].number == 1
    assert fragments[1].number == 2

    assert fragments[0].wire_list[0].wire_label == "W001-001"
    assert fragments[1].wire_list[0].wire_label == "W002-001"


# ─────────────────────────────────────────────
# No-text page → OCR fallback / clear warning
# ─────────────────────────────────────────────

def test_no_text_pdf_warns(tmp_path):
    # A page with no drawn text produces no extractable words.
    path = tmp_path / "blank.pdf"
    c = canvas.Canvas(str(path), pagesize=letter)
    c.showPage()
    c.save()

    layer, fragments, _ = parse_pdf(path, layer_hint=DrawingLayer.SCHEMATIC, warnings=(warnings := []))

    assert len(fragments) == 1
    assert not fragments[0].components
    # Either OCR is unavailable or it yielded nothing — both emit a clear warning.
    assert any("no extractable text" in w.lower() for w in warnings)
