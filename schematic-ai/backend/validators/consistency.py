"""
Cross-Layer Consistency Validator.

A focused validator that produces human-readable warning strings and an overall
consistency score. Runs automatically after every parse, merge, or AI modification.
"""

from __future__ import annotations

from ..models.project import DrawingLayer, ProjectModel, SignalType


def run_consistency_checks(project: ProjectModel) -> dict:
    """
    Validate cross-layer consistency in a ProjectModel.

    Returns:
        {
            "warnings": list[str],
            "errors":   list[str],
            "score":    int,  # 0-100
        }
    """
    warnings: list[str] = []
    errors: list[str] = []

    # Build lookup maps
    l2_wire_labels: dict[str, object] = {
        wire.label: wire
        for sheet in project.schematic_sheets
        for wire in sheet.wires
        if wire.label
    }
    l2_connector_refs: dict[str, object] = {
        conn.ref.upper(): conn
        for sheet in project.schematic_sheets
        for conn in sheet.connectors
        if conn.ref
    }
    l3_wire_labels: dict[str, object] = {}
    l3_connector_refs: dict[str, object] = {}
    for hs in project.harness_sheets:
        for asm in hs.assemblies:
            for wr in asm.wires:
                if wr.wire_label:
                    l3_wire_labels[wr.wire_label] = wr
            for cd in asm.connectors:
                if cd.ref:
                    l3_connector_refs[cd.ref.upper()] = cd

    l1_signal_paths = {
        sp.path_id: sp
        for bd in project.block_diagrams
        for sp in bd.signal_paths
        if sp.path_id
    }

    # ── L1 → L2 ──────────────────────────────────────────────────────
    for sp_id, sp in l1_signal_paths.items():
        has_l2 = any(
            cr.target_layer == DrawingLayer.SCHEMATIC
            for cr in sp.cross_refs
        )
        if not has_l2:
            errors.append(f"L1 signal path '{sp_id}' has no reference to an L2 schematic sheet")

    for sheet in project.schematic_sheets:
        if not sheet.signal_path_id:
            warnings.append(f"L2 Sheet {sheet.number} ('{sheet.title}') has no parent L1 signal path reference")

    # ── L2 → L3 wires ────────────────────────────────────────────────
    for label, wire in l2_wire_labels.items():
        if label not in l3_wire_labels:
            warnings.append(f"Wire '{label}' in L2 Sheet {wire.sheet} has no matching record in L3")

    # ── L2 → L3 connectors ───────────────────────────────────────────
    for ref, conn in l2_connector_refs.items():
        if ref not in l3_connector_refs:
            errors.append(f"Connector '{ref}' in L2 Sheet {conn.sheet} has no matching detail in L3")

    # ── Cross-section consistency ─────────────────────────────────────
    for label in l2_wire_labels:
        l2_w = l2_wire_labels[label]
        l3_w = l3_wire_labels.get(label)
        if not l3_w:
            continue
        if (l2_w.cross_section_mm2 is not None and l3_w.cross_section_mm2 is not None
                and abs(l2_w.cross_section_mm2 - l3_w.cross_section_mm2) > 0.01):
            errors.append(
                f"Wire '{label}': cross-section mismatch — "
                f"L2={l2_w.cross_section_mm2}mm² vs L3={l3_w.cross_section_mm2}mm²"
            )

    # ── Colour consistency ────────────────────────────────────────────
    for label in l2_wire_labels:
        l2_w = l2_wire_labels[label]
        l3_w = l3_wire_labels.get(label)
        if not l3_w:
            continue
        if l2_w.color and l3_w.color and l2_w.color.upper() != l3_w.color.upper():
            warnings.append(
                f"Wire '{label}': colour mismatch — L2='{l2_w.color}' vs L3='{l3_w.color}'"
            )

    # ── Connector part number consistency ─────────────────────────────
    for ref in l2_connector_refs:
        l2_c = l2_connector_refs[ref]
        l3_c = l3_connector_refs.get(ref)
        if not l3_c:
            continue
        if (l2_c.part_number and l3_c.part_number
                and l2_c.part_number.upper() != l3_c.part_number.upper()):
            errors.append(
                f"Connector '{ref}': part number mismatch — "
                f"L2='{l2_c.part_number}' vs L3='{l3_c.part_number}'"
            )

    # ── Signal type consistency L1 ↔ L2 ──────────────────────────────
    for sp_id, sp in l1_signal_paths.items():
        if sp.signal_type == SignalType.UNKNOWN:
            continue
        for sheet in project.schematic_sheets:
            if sheet.signal_path_id != sp_id:
                continue
            for wire in sheet.wires:
                if wire.signal_type not in (SignalType.UNKNOWN, sp.signal_type):
                    warnings.append(
                        f"Signal type mismatch: L1 SP '{sp_id}' is {sp.signal_type.value} "
                        f"but L2 wire '{wire.label}' is {wire.signal_type.value}"
                    )

    # ── Score calculation ─────────────────────────────────────────────
    total_checks = max(
        len(l1_signal_paths) + len(l2_wire_labels) + len(l2_connector_refs) + len(project.schematic_sheets),
        1,
    )
    deductions = len(errors) * 5 + len(warnings) * 2
    score = max(0, 100 - min(deductions, 100))

    return {
        "warnings": warnings,
        "errors":   errors,
        "score":    score,
    }
