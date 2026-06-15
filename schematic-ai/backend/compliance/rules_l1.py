"""
Layer 1 — Block Diagram compliance rules (BD001–BD007).
"""

from __future__ import annotations

import re

from models.compliance import ComplianceReport, RuleResult, RuleSeverity, RuleStatus
from models.project import DrawingLayer, ProjectModel

_SP_FORMAT = re.compile(r'^SP-\d{3,}$')


def check_l1(project: ProjectModel, report: ComplianceReport) -> None:
    layer = DrawingLayer.BLOCK_DIAGRAM.value

    for bd in project.block_diagrams:
        for lru in bd.lru_blocks:

            # BD001: Every LRU block has a reference designator
            report.add_result(RuleResult(
                rule_id="BD001", rule_title="LRU has reference designator",
                severity=RuleSeverity.ERROR,
                status=RuleStatus.PASS if lru.ref else RuleStatus.FAIL,
                message="" if lru.ref else f"LRU '{lru.name or lru.id}' missing reference designator",
                element_id=lru.id, element_ref=lru.ref or lru.name,
                layer=layer, sheet=lru.sheet,
                fix_available=True, fix_description="Add a reference designator (e.g. ECU-1)",
            ))

            # BD002: Every LRU block has an ATA chapter number
            report.add_result(RuleResult(
                rule_id="BD002", rule_title="LRU has ATA chapter",
                severity=RuleSeverity.WARNING,
                status=RuleStatus.PASS if lru.ata_chapter else RuleStatus.FAIL,
                message="" if lru.ata_chapter else f"LRU '{lru.ref}' missing ATA chapter",
                element_id=lru.id, element_ref=lru.ref,
                layer=layer, sheet=lru.sheet,
                fix_available=True, fix_description="Add the ATA chapter number (e.g. '73')",
            ))

            # BD007: Every LRU block has an installation drawing reference
            report.add_result(RuleResult(
                rule_id="BD007", rule_title="LRU has installation drawing reference",
                severity=RuleSeverity.WARNING,
                status=RuleStatus.PASS if lru.installation_dwg else RuleStatus.FAIL,
                message="" if lru.installation_dwg else f"LRU '{lru.ref}' missing installation drawing",
                element_id=lru.id, element_ref=lru.ref,
                layer=layer, sheet=lru.sheet,
                fix_available=False,
            ))

        for sp in bd.signal_paths:

            # BD003: Every signal path has a unique path ID in SP-NNN format
            fmt_ok = bool(sp.path_id and _SP_FORMAT.match(sp.path_id))
            report.add_result(RuleResult(
                rule_id="BD003", rule_title="Signal path has valid SP-NNN identifier",
                severity=RuleSeverity.ERROR,
                status=RuleStatus.PASS if fmt_ok else RuleStatus.FAIL,
                message="" if fmt_ok else f"Signal path '{sp.path_id}' is not in SP-NNN format",
                element_id=sp.id, element_ref=sp.path_id,
                layer=layer, sheet=sp.sheet,
                fix_available=True, fix_description="Assign a unique SP-NNN identifier",
            ))

            # BD004: Every signal path has a signal type declared
            has_type = sp.signal_type.value != "unknown"
            report.add_result(RuleResult(
                rule_id="BD004", rule_title="Signal path has signal type",
                severity=RuleSeverity.WARNING,
                status=RuleStatus.PASS if has_type else RuleStatus.FAIL,
                message="" if has_type else f"Signal path '{sp.path_id}' has unknown signal type",
                element_id=sp.id, element_ref=sp.path_id,
                layer=layer, sheet=sp.sheet,
                fix_available=True, fix_description="Set the signal type (e.g. ARINC429, POWER_DC)",
            ))

            # BD005: Every signal path has a cross-reference to at least one L2 sheet
            has_l2 = any(
                cr.target_layer == DrawingLayer.SCHEMATIC
                for cr in sp.cross_refs
            )
            report.add_result(RuleResult(
                rule_id="BD005", rule_title="Signal path references L2 schematic sheet",
                severity=RuleSeverity.ERROR,
                status=RuleStatus.PASS if has_l2 else RuleStatus.FAIL,
                message="" if has_l2 else f"Signal path '{sp.path_id}' has no L2 schematic reference",
                element_id=sp.id, element_ref=sp.path_id,
                layer=layer, sheet=sp.sheet,
                fix_available=False,
            ))

        for bus in bd.power_buses:
            # BD006: Power bus voltage declared
            has_voltage = bool(bus.get("voltage"))
            report.add_result(RuleResult(
                rule_id="BD006", rule_title="Power bus has voltage declared",
                severity=RuleSeverity.WARNING,
                status=RuleStatus.PASS if has_voltage else RuleStatus.FAIL,
                message="" if has_voltage else f"Power bus '{bus.get('label', '?')}' missing voltage",
                element_id=bus.get("id", ""), element_ref=bus.get("label", ""),
                layer=layer, sheet=bus.get("sheet", 1),
                fix_available=True, fix_description="Add voltage label (e.g. 28VDC)",
            ))
