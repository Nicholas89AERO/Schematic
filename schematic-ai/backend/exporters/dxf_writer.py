"""
DXF Writer dispatcher — routes to the appropriate per-layer DXF writer.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from ..models.project import DrawingLayer, ProjectModel
from .l1_block_writer import write_block_diagram_dxf
from .l2_schema_writer import write_schematic_dxf
from .l3_harness_writer import write_harness_dxf

_OUT_DIR = Path("/tmp/schematic_exports")
_OUT_DIR.mkdir(parents=True, exist_ok=True)


def write_dxf(project: ProjectModel, layer: DrawingLayer) -> Path:
    """
    Write the specified layer of a ProjectModel to a DXF file.

    Returns the path to the generated file.
    """
    stem = f"{project.project_number or project.project_id}_{layer.value}_{uuid.uuid4().hex[:6]}"
    out_path = _OUT_DIR / f"{stem}.dxf"

    if layer == DrawingLayer.BLOCK_DIAGRAM:
        return write_block_diagram_dxf(project, out_path)
    elif layer == DrawingLayer.HARNESS:
        return write_harness_dxf(project, out_path)
    else:
        return write_schematic_dxf(project, out_path)
