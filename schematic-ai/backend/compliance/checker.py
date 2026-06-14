"""
Compliance Checker — orchestrates all rule modules and returns a ComplianceReport.
"""

from __future__ import annotations

from typing import Optional

from ..models.compliance import ComplianceReport
from ..models.project import DrawingLayer, ProjectModel
from .rules_l1 import check_l1
from .rules_l2 import check_l2
from .rules_l3 import check_l3
from .rules_cross import check_cross_layer


def run_compliance(
    project: ProjectModel,
    layer: Optional[DrawingLayer] = None,
) -> ComplianceReport:
    """
    Run all applicable compliance rules for the specified layer (or all layers).

    Args:
        project: The full ProjectModel.
        layer: If provided, only run rules for that layer. If None, run all rules.

    Returns:
        A populated ComplianceReport with score 0-100.
    """
    report = ComplianceReport(
        project_id=project.project_id,
        layer=layer.value if layer else None,
    )

    run_all = layer is None

    if run_all or layer == DrawingLayer.BLOCK_DIAGRAM:
        if project.block_diagrams:
            check_l1(project, report)

    if run_all or layer == DrawingLayer.SCHEMATIC:
        if project.schematic_sheets:
            check_l2(project, report)

    if run_all or layer == DrawingLayer.HARNESS:
        if project.harness_sheets:
            check_l3(project, report)

    if run_all:
        # Cross-layer rules only make sense when all layers are present
        if project.block_diagrams or project.schematic_sheets or project.harness_sheets:
            check_cross_layer(project, report)

    # Build summary
    pass_count  = sum(1 for r in report.results if r.status.value == "pass")
    fail_errors = sum(1 for r in report.results if r.status.value == "fail" and r.severity.value == "error")
    fail_warns  = sum(1 for r in report.results if r.status.value == "fail" and r.severity.value == "warning")

    report.summary = (
        f"{pass_count} passed, {fail_errors} errors, {fail_warns} warnings "
        f"— score {report.score}/100"
    )

    return report
