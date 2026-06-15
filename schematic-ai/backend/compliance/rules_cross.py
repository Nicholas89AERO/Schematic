"""
Cross-Layer compliance rules (XL001–XL010).
"""

from __future__ import annotations

from models.compliance import ComplianceReport, RuleResult, RuleSeverity, RuleStatus
from models.project import DrawingLayer, ProjectModel

# IEC 60364-5-52 current capacity table (A): cross_section_mm² → max current (A)
_IEC_CURRENT_CAPACITY = {
    0.5: 8, 0.75: 11, 1.0: 13, 1.5: 16, 2.5: 21, 4.0: 27, 6.0: 34,
    10.0: 46, 16.0: 61, 25.0: 80, 35.0: 99, 50.0: 119,
}


def _max_current_for_gauge(cross_section_mm2: float) -> float:
    """Return the IEC 60364-5-52 maximum current for a given cross-section."""
    best_cs = None
    for cs in sorted(_IEC_CURRENT_CAPACITY.keys()):
        if cs >= cross_section_mm2 * 0.9:
            best_cs = cs
            break
    if best_cs is None:
        best_cs = max(_IEC_CURRENT_CAPACITY.keys())
    return _IEC_CURRENT_CAPACITY[best_cs]


def check_cross_layer(project: ProjectModel, report: ComplianceReport) -> None:
    # Build lookup structures
    l2_wires_by_label: dict[str, object] = {}
    for sheet in project.schematic_sheets:
        for wire in sheet.wires:
            if wire.label:
                l2_wires_by_label[wire.label] = wire

    l2_conns_by_ref: dict[str, object] = {}
    for sheet in project.schematic_sheets:
        for conn in sheet.connectors:
            if conn.ref:
                l2_conns_by_ref[conn.ref.upper()] = conn

    l3_wires_by_label: dict[str, object] = {}
    l3_conns_by_ref: dict[str, object] = {}
    for hs in project.harness_sheets:
        for asm in hs.assemblies:
            for wr in asm.wires:
                if wr.wire_label:
                    l3_wires_by_label[wr.wire_label] = wr
            for cd in asm.connectors:
                if cd.ref:
                    l3_conns_by_ref[cd.ref.upper()] = cd

    # ── XL001: Every L2 wire has a matching L3 wire record ───────────
    for sheet in project.schematic_sheets:
        for wire in sheet.wires:
            if not wire.label:
                continue
            has_l3 = wire.label in l3_wires_by_label
            report.add_result(RuleResult(
                rule_id="XL001", rule_title="L2 wire has matching L3 wire record",
                severity=RuleSeverity.ERROR,
                status=RuleStatus.PASS if has_l3 else RuleStatus.FAIL,
                message="" if has_l3 else f"Wire '{wire.label}' in L2 has no matching L3 record",
                element_id=wire.id, element_ref=wire.label,
                layer=DrawingLayer.SCHEMATIC.value, sheet=sheet.number,
            ))

    # ── XL002: Wire cross-section consistent L2 ↔ L3 ────────────────
    for label, l2_w in l2_wires_by_label.items():
        l3_w = l3_wires_by_label.get(label)
        if not l3_w:
            continue
        if (l2_w.cross_section_mm2 is not None and l3_w.cross_section_mm2 is not None
                and abs(l2_w.cross_section_mm2 - l3_w.cross_section_mm2) > 0.01):
            report.add_result(RuleResult(
                rule_id="XL002", rule_title="Wire cross-section consistent L2↔L3",
                severity=RuleSeverity.ERROR,
                status=RuleStatus.FAIL,
                message=f"Wire '{label}': L2={l2_w.cross_section_mm2}mm² L3={l3_w.cross_section_mm2}mm²",
                element_id=l2_w.id, element_ref=label,
                layer=DrawingLayer.SCHEMATIC.value,
            ))

    # ── XL003: Wire colour consistent L2 ↔ L3 ────────────────────────
    for label, l2_w in l2_wires_by_label.items():
        l3_w = l3_wires_by_label.get(label)
        if not l3_w:
            continue
        if l2_w.color and l3_w.color and l2_w.color.upper() != l3_w.color.upper():
            report.add_result(RuleResult(
                rule_id="XL003", rule_title="Wire colour consistent L2↔L3",
                severity=RuleSeverity.WARNING,
                status=RuleStatus.FAIL,
                message=f"Wire '{label}': L2 color='{l2_w.color}' L3 color='{l3_w.color}'",
                element_id=l2_w.id, element_ref=label,
                layer=DrawingLayer.SCHEMATIC.value,
            ))

    # ── XL004: Every L2 connector has a matching L3 connector detail ─
    for ref, l2_c in l2_conns_by_ref.items():
        has_l3 = ref in l3_conns_by_ref
        report.add_result(RuleResult(
            rule_id="XL004", rule_title="L2 connector has matching L3 connector detail",
            severity=RuleSeverity.ERROR,
            status=RuleStatus.PASS if has_l3 else RuleStatus.FAIL,
            message="" if has_l3 else f"Connector '{ref}' in L2 has no matching L3 detail",
            element_id=l2_c.id, element_ref=ref,
            layer=DrawingLayer.SCHEMATIC.value,
        ))

    # ── XL005: Connector part numbers consistent L2 ↔ L3 ─────────────
    for ref, l2_c in l2_conns_by_ref.items():
        l3_c = l3_conns_by_ref.get(ref)
        if not l3_c:
            continue
        if (l2_c.part_number and l3_c.part_number
                and l2_c.part_number.upper() != l3_c.part_number.upper()):
            report.add_result(RuleResult(
                rule_id="XL005", rule_title="Connector part numbers consistent L2↔L3",
                severity=RuleSeverity.ERROR,
                status=RuleStatus.FAIL,
                message=f"Connector '{ref}': L2 PN='{l2_c.part_number}' L3 PN='{l3_c.part_number}'",
                element_id=l2_c.id, element_ref=ref,
                layer=DrawingLayer.SCHEMATIC.value,
            ))

    # ── XL006: Pin assignments consistent L2 ↔ L3 ────────────────────
    for ref, l2_c in l2_conns_by_ref.items():
        l3_c = l3_conns_by_ref.get(ref)
        if not l3_c:
            continue
        l3_pins_used: set[str] = set()
        for hs in project.harness_sheets:
            for asm in hs.assemblies:
                for wr in asm.wires:
                    if wr.from_connector.upper() == ref and wr.from_pin:
                        l3_pins_used.add(wr.from_pin)
                    if wr.to_connector.upper() == ref and wr.to_pin:
                        l3_pins_used.add(wr.to_pin)

        for pin in l2_c.pins:
            if pin.pin_number and l3_pins_used and pin.pin_number not in l3_pins_used:
                report.add_result(RuleResult(
                    rule_id="XL006", rule_title="Pin assignments consistent L2↔L3",
                    severity=RuleSeverity.WARNING,
                    status=RuleStatus.FAIL,
                    message=f"Connector '{ref}' pin {pin.pin_number} in L2 not found in L3 wire list",
                    element_id=l2_c.id, element_ref=f"{ref}:{pin.pin_number}",
                    layer=DrawingLayer.SCHEMATIC.value,
                ))

    # ── XL007: Every L1 signal path references at least one L2 sheet ─
    for bd in project.block_diagrams:
        for sp in bd.signal_paths:
            has_l2 = any(
                cr.target_layer == DrawingLayer.SCHEMATIC
                for cr in sp.cross_refs
            )
            report.add_result(RuleResult(
                rule_id="XL007", rule_title="L1 signal path references L2 sheet",
                severity=RuleSeverity.ERROR,
                status=RuleStatus.PASS if has_l2 else RuleStatus.FAIL,
                message="" if has_l2 else f"SP '{sp.path_id}' has no L2 sheet reference",
                element_id=sp.id, element_ref=sp.path_id,
                layer=DrawingLayer.BLOCK_DIAGRAM.value, sheet=sp.sheet,
            ))

    # ── XL008: Every L2 sheet references its parent L1 signal path ───
    for sheet in project.schematic_sheets:
        report.add_result(RuleResult(
            rule_id="XL008", rule_title="L2 sheet references parent L1 signal path",
            severity=RuleSeverity.WARNING,
            status=RuleStatus.PASS if sheet.signal_path_id else RuleStatus.FAIL,
            message="" if sheet.signal_path_id else f"Sheet {sheet.number} missing signal_path_id",
            element_id=None, element_ref=f"Sheet {sheet.number}",
            layer=DrawingLayer.SCHEMATIC.value, sheet=sheet.number,
        ))

    # ── XL009: L1 current rating vs L3 wire gauge (IEC 60364-5-52) ───
    for bd in project.block_diagrams:
        for sp in bd.signal_paths:
            if sp.current_rating is None or not sp.path_id:
                continue
            # Find L3 wires for this signal path via cross-refs
            for sheet in project.schematic_sheets:
                if sheet.signal_path_id != sp.path_id:
                    continue
                for wire in sheet.wires:
                    l3_w = l3_wires_by_label.get(wire.label)
                    if not l3_w or not l3_w.cross_section_mm2:
                        continue
                    max_current = _max_current_for_gauge(l3_w.cross_section_mm2)
                    if sp.current_rating > max_current:
                        report.add_result(RuleResult(
                            rule_id="XL009", rule_title="Current rating consistent with wire gauge (IEC 60364-5-52)",
                            severity=RuleSeverity.ERROR,
                            status=RuleStatus.FAIL,
                            message=(
                                f"SP '{sp.path_id}' requires {sp.current_rating}A but wire '{wire.label}' "
                                f"({l3_w.cross_section_mm2}mm²) rated at {max_current}A max"
                            ),
                            element_id=sp.id, element_ref=sp.path_id,
                            layer=DrawingLayer.BLOCK_DIAGRAM.value, sheet=sp.sheet,
                        ))

    # ── XL010: Signal type consistent L1 ↔ L2 ────────────────────────
    for bd in project.block_diagrams:
        for sp in bd.signal_paths:
            if sp.signal_type.value == "unknown":
                continue
            for sheet in project.schematic_sheets:
                if sheet.signal_path_id != sp.path_id:
                    continue
                for wire in sheet.wires:
                    if wire.signal_type.value not in ("unknown", sp.signal_type.value):
                        report.add_result(RuleResult(
                            rule_id="XL010", rule_title="Signal type consistent L1↔L2",
                            severity=RuleSeverity.WARNING,
                            status=RuleStatus.FAIL,
                            message=(
                                f"SP '{sp.path_id}' declares {sp.signal_type.value} "
                                f"but wire '{wire.label}' is {wire.signal_type.value}"
                            ),
                            element_id=wire.id, element_ref=wire.label,
                            layer=DrawingLayer.SCHEMATIC.value, sheet=sheet.number,
                        ))
