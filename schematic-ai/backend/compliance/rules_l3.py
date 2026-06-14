"""
Layer 3 — Harness compliance rules (HRN001–HRN010).
"""

from __future__ import annotations

from ..models.compliance import ComplianceReport, RuleResult, RuleSeverity, RuleStatus
from ..models.project import DrawingLayer, ProjectModel

_HIGH_TEMP_KEYWORDS = {"engine", "exhaust", "nacelle", "turbine", "bleed", "hot"}


def _is_high_temp_zone(zone: str) -> bool:
    return any(kw in zone.lower() for kw in _HIGH_TEMP_KEYWORDS)


def check_l3(project: ProjectModel, report: ComplianceReport) -> None:
    layer = DrawingLayer.HARNESS.value

    for hs in project.harness_sheets:
        for asm in hs.assemblies:

            # HRN008: Harness assemblies have routing codes (airframe zone)
            report.add_result(RuleResult(
                rule_id="HRN008", rule_title="Harness has routing codes",
                severity=RuleSeverity.WARNING,
                status=RuleStatus.PASS if asm.routing_codes else RuleStatus.FAIL,
                message="" if asm.routing_codes else f"Harness '{asm.assembly_number}' has no routing codes",
                element_id=asm.id, element_ref=asm.assembly_number,
                layer=layer, sheet=hs.number,
                fix_available=True, fix_description="Add airframe routing zone codes (e.g. STA-230, FR-18-21)",
            ))

            # HRN009: Sleeving spec for high-temperature zones
            if _is_high_temp_zone(asm.airframe_zone or " ".join(asm.routing_codes)):
                report.add_result(RuleResult(
                    rule_id="HRN009", rule_title="High-temp harness has sleeving spec",
                    severity=RuleSeverity.ERROR,
                    status=RuleStatus.PASS if asm.sleeving_spec else RuleStatus.FAIL,
                    message="" if asm.sleeving_spec else f"Harness '{asm.assembly_number}' in high-temp zone '{asm.airframe_zone}' missing sleeving spec",
                    element_id=asm.id, element_ref=asm.assembly_number,
                    layer=layer, sheet=hs.number,
                    fix_available=True, fix_description="Add sleeving spec (e.g. M23053/5-103-0)",
                ))

            for wr in asm.wires:
                ref = wr.wire_label

                # HRN001: Every wire has from/to connector and pin
                has_routing = bool(wr.from_connector and wr.from_pin and wr.to_connector and wr.to_pin)
                report.add_result(RuleResult(
                    rule_id="HRN001", rule_title="Wire has complete from/to routing",
                    severity=RuleSeverity.ERROR,
                    status=RuleStatus.PASS if has_routing else RuleStatus.FAIL,
                    message="" if has_routing else f"Wire '{ref}' missing connector/pin data",
                    element_id=wr.id, element_ref=ref,
                    layer=layer, sheet=hs.number,
                    fix_available=True, fix_description="Specify from_connector, from_pin, to_connector, to_pin",
                ))

                # HRN002: Every wire has a material spec
                report.add_result(RuleResult(
                    rule_id="HRN002", rule_title="Wire has material specification",
                    severity=RuleSeverity.ERROR,
                    status=RuleStatus.PASS if wr.material_spec else RuleStatus.FAIL,
                    message="" if wr.material_spec else f"Wire '{ref}' missing material spec",
                    element_id=wr.id, element_ref=ref,
                    layer=layer, sheet=hs.number,
                    fix_available=True, fix_description="Add spec (e.g. M22759/16-20-9)",
                ))

                # HRN003: Wire lengths specified
                has_length = wr.length_m is not None and wr.length_m > 0
                report.add_result(RuleResult(
                    rule_id="HRN003", rule_title="Wire length is specified",
                    severity=RuleSeverity.WARNING,
                    status=RuleStatus.PASS if has_length else RuleStatus.FAIL,
                    message="" if has_length else f"Wire '{ref}' missing length",
                    element_id=wr.id, element_ref=ref,
                    layer=layer, sheet=hs.number,
                    fix_available=True, fix_description="Specify wire length in metres",
                ))

                # HRN010: Shield drain wires have ground reference
                if wr.shielded and not wr.shield_id:
                    report.add_result(RuleResult(
                        rule_id="HRN010", rule_title="Shielded wire has shield drain reference",
                        severity=RuleSeverity.ERROR,
                        status=RuleStatus.FAIL,
                        message=f"Shielded wire '{ref}' has no shield_id",
                        element_id=wr.id, element_ref=ref,
                        layer=layer, sheet=hs.number,
                        fix_available=True, fix_description="Set shield_id to the drain wire ID",
                    ))

            # Check pin uniqueness per connector
            for cd in asm.connectors:
                # HRN004: Connector has part number and cage code
                report.add_result(RuleResult(
                    rule_id="HRN004", rule_title="Connector has part number and cage code",
                    severity=RuleSeverity.ERROR,
                    status=RuleStatus.PASS if (cd.part_number and cd.cage_code) else RuleStatus.FAIL,
                    message="" if (cd.part_number and cd.cage_code) else f"Connector '{cd.ref}' missing PN or cage code",
                    element_id=cd.id, element_ref=cd.ref,
                    layer=layer, sheet=hs.number,
                    fix_available=True, fix_description="Add part number and CAGE code",
                ))

                # HRN005: Connector has backshell part number
                report.add_result(RuleResult(
                    rule_id="HRN005", rule_title="Connector has backshell part number",
                    severity=RuleSeverity.ERROR,
                    status=RuleStatus.PASS if cd.backshell_pn else RuleStatus.FAIL,
                    message="" if cd.backshell_pn else f"Connector '{cd.ref}' missing backshell PN",
                    element_id=cd.id, element_ref=cd.ref,
                    layer=layer, sheet=hs.number,
                    fix_available=True, fix_description="Add backshell part number",
                ))

            # HRN006: Pin assignments unique per connector
            # Build from-pin map
            from_pins: dict[str, set[str]] = {}  # connector_ref → set of pins used
            for wr in asm.wires:
                if wr.from_connector and wr.from_pin:
                    from_pins.setdefault(wr.from_connector, set())
                    if wr.from_pin in from_pins[wr.from_connector]:
                        report.add_result(RuleResult(
                            rule_id="HRN006", rule_title="Pin assignments are unique per connector",
                            severity=RuleSeverity.ERROR,
                            status=RuleStatus.FAIL,
                            message=f"Connector '{wr.from_connector}' pin {wr.from_pin} used by multiple wires",
                            element_id=wr.id, element_ref=wr.wire_label,
                            layer=layer, sheet=hs.number,
                        ))
                    from_pins[wr.from_connector].add(wr.from_pin)

            # HRN007: Splices have part number and location description
            for sp in asm.splices:
                has_sp_data = bool(sp.part_number and sp.location_description)
                report.add_result(RuleResult(
                    rule_id="HRN007", rule_title="Splice has part number and location",
                    severity=RuleSeverity.WARNING,
                    status=RuleStatus.PASS if has_sp_data else RuleStatus.FAIL,
                    message="" if has_sp_data else f"Splice '{sp.ref}' missing PN or location",
                    element_id=sp.id, element_ref=sp.ref,
                    layer=layer, sheet=hs.number,
                    fix_available=True, fix_description="Add splice part number and location description",
                ))
