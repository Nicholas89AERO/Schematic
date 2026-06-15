"""
PDF Writer — exports a drawing layer to PDF via ReportLab.

Renders a simplified text-and-table PDF for wire lists and title blocks.
For full graphical export, DXF is the primary format; PDF is supplementary.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from models.project import DrawingLayer, ProjectModel

_OUT_DIR = Path("/tmp/schematic_exports")
_OUT_DIR.mkdir(parents=True, exist_ok=True)

_MM = 2.8346  # points per mm


def write_pdf(project: ProjectModel, layer: DrawingLayer) -> Path:
    """Generate a PDF report for the specified layer."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A3, landscape
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
        )
    except ImportError:
        raise RuntimeError("reportlab not installed — PDF export unavailable")

    stem = f"{project.project_number or project.project_id}_{layer.value}_{uuid.uuid4().hex[:6]}"
    out_path = _OUT_DIR / f"{stem}.pdf"

    doc = SimpleDocTemplate(str(out_path), pagesize=landscape(A3))
    styles = getSampleStyleSheet()
    story = []

    title = f"SchematicAI Export — {layer.value.replace('_', ' ').title()}"
    story.append(Paragraph(title, styles["Title"]))
    story.append(Spacer(1, 6 * mm))

    if layer == DrawingLayer.HARNESS:
        story.extend(_render_wire_list(project, styles, mm))
    elif layer == DrawingLayer.SCHEMATIC:
        story.extend(_render_schematic_summary(project, styles, mm))
    elif layer == DrawingLayer.BLOCK_DIAGRAM:
        story.extend(_render_block_diagram_summary(project, styles, mm))

    doc.build(story)
    return out_path


def _render_wire_list(project, styles, mm):
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

    story = []
    headers = ["Wire No.", "From", "Pin", "To", "Pin", "Length(m)", "CS(mm²)", "Color", "Spec", "Signal"]
    col_widths = [30*mm, 25*mm, 12*mm, 25*mm, 12*mm, 20*mm, 18*mm, 18*mm, 40*mm, 25*mm]

    for hs in project.harness_sheets:
        for asm in hs.assemblies:
            if asm.assembly_number:
                story.append(Paragraph(f"Harness Assembly: {asm.assembly_number}", styles["Heading2"]))
            data = [headers]
            for wr in asm.wires:
                data.append([
                    wr.wire_label,
                    wr.from_connector,
                    wr.from_pin,
                    wr.to_connector,
                    wr.to_pin,
                    f"{wr.length_m:.2f}" if wr.length_m else "",
                    str(wr.cross_section_mm2 or ""),
                    wr.color,
                    wr.material_spec,
                    wr.signal_type.value,
                ])
            t = Table(data, colWidths=col_widths, repeatRows=1)
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
                ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
                ("FONTSIZE",   (0, 0), (-1, -1), 7),
                ("GRID",       (0, 0), (-1, -1), 0.25, colors.black),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.lightyellow]),
            ]))
            story.append(t)
            story.append(Spacer(1, 5 * mm))
    return story


def _render_schematic_summary(project, styles, mm):
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

    story = []
    for sheet in project.schematic_sheets:
        story.append(Paragraph(f"Sheet {sheet.number}: {sheet.title}", styles["Heading2"]))
        data = [["Ref", "Type", "Part Number"]]
        for comp in sheet.components:
            data.append([comp.ref, comp.type.value, comp.attributes.get("PART_NUMBER", "")])
        for conn in sheet.connectors:
            data.append([conn.ref, "connector", conn.part_number])
        t = Table(data, colWidths=[30*mm, 40*mm, 60*mm], repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTSIZE",   (0, 0), (-1, -1), 8),
            ("GRID",       (0, 0), (-1, -1), 0.25, colors.black),
        ]))
        story.append(t)
        story.append(Spacer(1, 5 * mm))
    return story


def _render_block_diagram_summary(project, styles, mm):
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

    story = []
    for bd in project.block_diagrams:
        story.append(Paragraph(f"Block Diagram Sheet {bd.sheet_number}: {bd.title}", styles["Heading2"]))
        data = [["LRU Ref", "Name", "ATA", "Installation DWG"]]
        for lru in bd.lru_blocks:
            data.append([lru.ref, lru.name, lru.ata_chapter, lru.installation_dwg])
        t = Table(data, colWidths=[25*mm, 60*mm, 20*mm, 50*mm], repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTSIZE",   (0, 0), (-1, -1), 8),
            ("GRID",       (0, 0), (-1, -1), 0.25, colors.black),
        ]))
        story.append(t)
        story.append(Spacer(1, 5 * mm))
    return story
