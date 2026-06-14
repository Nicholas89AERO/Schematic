"""
Cross-Reference Builder.

After all three layers are parsed, this module walks the unified ProjectModel,
resolves references by matching IDs/labels, and populates:
  - CrossRef objects on individual elements
  - Global registries: all_signal_paths, all_wire_labels, all_connector_refs
"""

from __future__ import annotations

from ..models.project import (
    CrossRef, DrawingLayer, HarnessAssembly, ProjectModel,
    SchematicSheet, SignalPath,
)


# ─────────────────────────────────────────────
# Registry builders
# ─────────────────────────────────────────────

def _build_signal_path_registry(model: ProjectModel) -> None:
    """Index all SignalPaths by path_id."""
    model.all_signal_paths = {}
    for bd in model.block_diagrams:
        for sp in bd.signal_paths:
            if sp.path_id:
                model.all_signal_paths[sp.path_id] = sp


def _build_wire_label_registry(model: ProjectModel) -> None:
    """
    Index wire labels to their schematic sheet and harness assembly.
    Result: all_wire_labels[wire_label] = {"schematic_id": ..., "harness_id": ...}
    """
    model.all_wire_labels = {}

    # Index from schematic sheets
    for sheet in model.schematic_sheets:
        for wire in sheet.wires:
            if wire.label:
                entry = model.all_wire_labels.setdefault(wire.label, {})
                entry["schematic_id"] = wire.id
                entry["schematic_sheet"] = sheet.number

    # Index from harness assemblies
    for hs in model.harness_sheets:
        for assembly in hs.assemblies:
            for wr in assembly.wires:
                if wr.wire_label:
                    entry = model.all_wire_labels.setdefault(wr.wire_label, {})
                    entry["harness_id"] = wr.id
                    entry["harness_assembly"] = assembly.assembly_number


def _build_connector_ref_registry(model: ProjectModel) -> None:
    """
    Index connector references to their schematic sheet and harness assembly.
    Result: all_connector_refs[ref] = {"schematic_sheet": ..., "harness_assembly": ...}
    """
    model.all_connector_refs = {}

    for sheet in model.schematic_sheets:
        for conn in sheet.connectors:
            if conn.ref:
                entry = model.all_connector_refs.setdefault(conn.ref.upper(), {})
                entry["schematic_sheet"] = sheet.number
                entry["schematic_connector_id"] = conn.id

    for hs in model.harness_sheets:
        for assembly in hs.assemblies:
            for cd in assembly.connectors:
                if cd.ref:
                    entry = model.all_connector_refs.setdefault(cd.ref.upper(), {})
                    entry["harness_assembly"] = assembly.assembly_number
                    entry["harness_connector_id"] = cd.id


# ─────────────────────────────────────────────
# L1 → L2 CrossRef linking
# ─────────────────────────────────────────────

def _link_l1_to_l2(model: ProjectModel) -> None:
    """
    For each SignalPath in L1, find the matching SchematicSheet by signal_path_id
    and attach a CrossRef in both directions.
    """
    # Index schematic sheets by signal_path_id
    sheet_by_sp_id: dict[str, SchematicSheet] = {}
    for sheet in model.schematic_sheets:
        if sheet.signal_path_id:
            sheet_by_sp_id[sheet.signal_path_id] = sheet

    for bd in model.block_diagrams:
        for sp in bd.signal_paths:
            if not sp.path_id:
                continue
            matching_sheet = sheet_by_sp_id.get(sp.path_id)
            if matching_sheet:
                # L1 SP → L2 sheet
                sp.cross_refs.append(CrossRef(
                    target_layer=DrawingLayer.SCHEMATIC,
                    target_sheet=matching_sheet.number,
                    target_element_id=sp.path_id,
                    label=f"Sheet {matching_sheet.number}: {matching_sheet.title}",
                    ref_type="drills_to",
                ))
                # L2 sheet → L1 SP (back-reference)
                matching_sheet.lru_refs = list(set(
                    matching_sheet.lru_refs + [sp.from_lru_id, sp.to_lru_id]
                ))

        # Link LRU blocks to schematic connectors
        for lru in bd.lru_blocks:
            if not lru.ref:
                continue
            for sheet in model.schematic_sheets:
                for conn in sheet.connectors:
                    if conn.ref and lru.ref in conn.ref:
                        lru.cross_refs.append(CrossRef(
                            target_layer=DrawingLayer.SCHEMATIC,
                            target_sheet=sheet.number,
                            target_element_id=conn.id,
                            label=f"{conn.ref} on Sheet {sheet.number}",
                            ref_type="detailed_in",
                        ))


# ─────────────────────────────────────────────
# L2 → L3 CrossRef linking
# ─────────────────────────────────────────────

def _link_l2_to_l3(model: ProjectModel) -> None:
    """
    For each WireSegment in L2, find the matching WireRecord in L3 by wire_label.
    For each ConnectorShell in L2, find the matching ConnectorDetail in L3 by ref.
    Attach CrossRefs in both directions.
    """
    # Wire label → harness wire record
    harness_wires_by_label: dict[str, tuple[str, str]] = {}
    # key: wire_label → (assembly_number, wire_record_id)
    for hs in model.harness_sheets:
        for assembly in hs.assemblies:
            for wr in assembly.wires:
                if wr.wire_label:
                    harness_wires_by_label[wr.wire_label] = (assembly.assembly_number, wr.id)

    # Connector ref → harness connector detail
    harness_conns_by_ref: dict[str, tuple[str, str]] = {}
    for hs in model.harness_sheets:
        for assembly in hs.assemblies:
            for cd in assembly.connectors:
                if cd.ref:
                    harness_conns_by_ref[cd.ref.upper()] = (assembly.assembly_number, cd.id)

    for sheet in model.schematic_sheets:
        for wire in sheet.wires:
            if not wire.label:
                continue
            match = harness_wires_by_label.get(wire.label)
            if match:
                asm_num, wr_id = match
                wire.cross_refs.append(CrossRef(
                    target_layer=DrawingLayer.HARNESS,
                    target_sheet=1,
                    target_element_id=wr_id,
                    label=f"Harness {asm_num}: {wire.label}",
                    ref_type="carried_by",
                ))

        for conn in sheet.connectors:
            if not conn.ref:
                continue
            match = harness_conns_by_ref.get(conn.ref.upper())
            if match:
                asm_num, cd_id = match
                conn.cross_refs.append(CrossRef(
                    target_layer=DrawingLayer.HARNESS,
                    target_sheet=1,
                    target_element_id=cd_id,
                    label=f"Harness {asm_num}: {conn.ref}",
                    ref_type="detailed_in",
                ))


# ─────────────────────────────────────────────
# L3 → L2 back-references
# ─────────────────────────────────────────────

def _link_l3_to_l2(model: ProjectModel) -> None:
    """Attach back-references from L3 wire records to their L2 wire segments."""
    schematic_wires_by_label: dict[str, tuple[int, str]] = {}
    for sheet in model.schematic_sheets:
        for wire in sheet.wires:
            if wire.label:
                schematic_wires_by_label[wire.label] = (sheet.number, wire.id)

    schematic_conns_by_ref: dict[str, tuple[int, str]] = {}
    for sheet in model.schematic_sheets:
        for conn in sheet.connectors:
            if conn.ref:
                schematic_conns_by_ref[conn.ref.upper()] = (sheet.number, conn.id)

    for hs in model.harness_sheets:
        for assembly in hs.assemblies:
            schematic_sheets_for_asm: set[int] = set()

            for wr in assembly.wires:
                match = schematic_wires_by_label.get(wr.wire_label)
                if match:
                    sheet_num, wire_id = match
                    schematic_sheets_for_asm.add(sheet_num)
                    wr.cross_refs.append(CrossRef(
                        target_layer=DrawingLayer.SCHEMATIC,
                        target_sheet=sheet_num,
                        target_element_id=wire_id,
                        label=f"Schematic Sheet {sheet_num}: {wr.wire_label}",
                        ref_type="belongs_to",
                    ))

            for cd in assembly.connectors:
                match = schematic_conns_by_ref.get(cd.ref.upper())
                if match:
                    sheet_num, conn_id = match
                    schematic_sheets_for_asm.add(sheet_num)
                    cd.cross_refs.append(CrossRef(
                        target_layer=DrawingLayer.SCHEMATIC,
                        target_sheet=sheet_num,
                        target_element_id=conn_id,
                        label=f"Schematic Sheet {sheet_num}: {cd.ref}",
                        ref_type="belongs_to",
                    ))

            assembly.schematic_sheet_refs = [str(n) for n in sorted(schematic_sheets_for_asm)]


# ─────────────────────────────────────────────
# PUBLIC
# ─────────────────────────────────────────────

def build_cross_references(model: ProjectModel) -> ProjectModel:
    """
    Populate all CrossRef objects and global registries in a ProjectModel.

    Should be called after all three layers have been parsed and merged
    into the model. Modifies model in-place and returns it.
    """
    # Build registries first (used by linkers)
    _build_signal_path_registry(model)
    _build_wire_label_registry(model)
    _build_connector_ref_registry(model)

    # Directional cross-refs
    _link_l1_to_l2(model)
    _link_l2_to_l3(model)
    _link_l3_to_l2(model)

    return model
