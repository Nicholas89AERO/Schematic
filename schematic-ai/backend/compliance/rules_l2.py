"""
Layer 2 — Schematic compliance rules (SCH001–SCH007).
"""

from __future__ import annotations

from models.compliance import ComplianceReport, RuleResult, RuleSeverity, RuleStatus
from models.project import DrawingLayer, ProjectModel, SignalType

TOLERANCE_MM = 1.5  # snap tolerance for dangling wire check


def _wires_have_endpoints_connected(sheet) -> list[str]:
    """Return list of wire IDs with dangling endpoints (not near any component/connector)."""
    all_positions = (
        [(c.position.x, c.position.y) for c in sheet.components]
        + [(c.position.x, c.position.y) for c in sheet.connectors]
    )
    dangling = []
    for wire in sheet.wires:
        for ep in (wire.start, wire.end):
            connected = any(
                ((ep.x - px) ** 2 + (ep.y - py) ** 2) ** 0.5 < TOLERANCE_MM
                for px, py in all_positions
            )
            # Also check if endpoint connects to another wire
            if not connected:
                wire_connected = any(
                    (
                        ((ep.x - w.start.x) ** 2 + (ep.y - w.start.y) ** 2) ** 0.5 < TOLERANCE_MM
                        or ((ep.x - w.end.x) ** 2 + (ep.y - w.end.y) ** 2) ** 0.5 < TOLERANCE_MM
                    )
                    for w in sheet.wires
                    if w.id != wire.id
                )
                if not wire_connected:
                    dangling.append(wire.id)
                    break
    return dangling


def check_l2(project: ProjectModel, report: ComplianceReport) -> None:
    layer = DrawingLayer.SCHEMATIC.value

    for sheet in project.schematic_sheets:

        # SCH001: Every connector shell has a part number
        for conn in sheet.connectors:
            report.add_result(RuleResult(
                rule_id="SCH001", rule_title="Connector has part number",
                severity=RuleSeverity.ERROR,
                status=RuleStatus.PASS if conn.part_number else RuleStatus.FAIL,
                message="" if conn.part_number else f"Connector '{conn.ref}' missing part number",
                element_id=conn.id, element_ref=conn.ref,
                layer=layer, sheet=sheet.number,
                fix_available=True, fix_description="Add connector part number (e.g. MS27467T17B35P)",
            ))

            # SCH002: Every connector pin has a wire label assigned
            for pin in conn.pins:
                report.add_result(RuleResult(
                    rule_id="SCH002", rule_title="Connector pin has wire label",
                    severity=RuleSeverity.WARNING,
                    status=RuleStatus.PASS if pin.wire_id else RuleStatus.FAIL,
                    message="" if pin.wire_id else f"{conn.ref} pin {pin.pin_number} has no wire label",
                    element_id=conn.id, element_ref=f"{conn.ref}:{pin.pin_number}",
                    layer=layer, sheet=sheet.number,
                    fix_available=True, fix_description="Assign a wire label (W###-###)",
                ))

            # SCH004: Mating connector references are consistent
            if conn.mating_ref:
                mating = next(
                    (c for s in project.schematic_sheets for c in s.connectors
                     if c.ref == conn.mating_ref),
                    None,
                )
                if mating and mating.mating_ref != conn.ref:
                    report.add_result(RuleResult(
                        rule_id="SCH004", rule_title="Mating connector references are consistent",
                        severity=RuleSeverity.ERROR,
                        status=RuleStatus.FAIL,
                        message=f"{conn.ref} mates {conn.mating_ref} but {conn.mating_ref} does not reference {conn.ref} back",
                        element_id=conn.id, element_ref=conn.ref,
                        layer=layer, sheet=sheet.number,
                        fix_available=True, fix_description="Update mating connector back-reference",
                    ))

        # SCH003: No unconnected wire endpoints
        dangling_ids = _wires_have_endpoints_connected(sheet)
        for wire in sheet.wires:
            if wire.id in dangling_ids:
                report.add_result(RuleResult(
                    rule_id="SCH003", rule_title="No dangling wire endpoints",
                    severity=RuleSeverity.WARNING,
                    status=RuleStatus.FAIL,
                    message=f"Wire '{wire.label or wire.id[:8]}' has a dangling endpoint",
                    element_id=wire.id, element_ref=wire.label,
                    layer=layer, sheet=sheet.number,
                    fix_available=False,
                ))

        # SCH005: Shield drain wire references a ground point
        for wire in sheet.wires:
            if wire.shielded and not wire.shield_drain_ref:
                report.add_result(RuleResult(
                    rule_id="SCH005", rule_title="Shield drain references ground point",
                    severity=RuleSeverity.ERROR,
                    status=RuleStatus.FAIL,
                    message=f"Shielded wire '{wire.label}' has no shield drain ground reference",
                    element_id=wire.id, element_ref=wire.label,
                    layer=layer, sheet=sheet.number,
                    fix_available=True, fix_description="Add shield_drain_ref pointing to a GND symbol",
                ))

        # SCH006: ARINC429 and MIL-STD-1553 must be shielded
        for wire in sheet.wires:
            bus_type = wire.signal_type in (SignalType.ARINC429, SignalType.MIL_STD_1553)
            if bus_type and not wire.shielded:
                report.add_result(RuleResult(
                    rule_id="SCH006", rule_title="ARINC429/1553 wires are shielded",
                    severity=RuleSeverity.ERROR,
                    status=RuleStatus.FAIL,
                    message=f"Wire '{wire.label}' ({wire.signal_type.value}) must use shielded cable",
                    element_id=wire.id, element_ref=wire.label,
                    layer=layer, sheet=sheet.number,
                    fix_available=True, fix_description="Set shielded=True and add shield drain reference",
                ))

        # SCH007: Each schematic sheet references its parent L1 signal path
        report.add_result(RuleResult(
            rule_id="SCH007", rule_title="Schematic sheet references L1 signal path",
            severity=RuleSeverity.WARNING,
            status=RuleStatus.PASS if sheet.signal_path_id else RuleStatus.FAIL,
            message="" if sheet.signal_path_id else f"Sheet {sheet.number} has no L1 signal path reference",
            element_id=None, element_ref=f"Sheet {sheet.number}",
            layer=layer, sheet=sheet.number,
            fix_available=True, fix_description="Add signal_path_id linking to the L1 SP-NNN",
        ))
