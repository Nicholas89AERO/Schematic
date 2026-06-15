"""
ChangeSet Applier — applies a ChangeSet to a ProjectModel and returns the modified model.
"""

from __future__ import annotations

import copy
import dataclasses
import uuid
from typing import Any

from models.changes import ChangeOperation, ChangeSet, ElementKind, OperationType
from models.project import (
    BlockDiagram, Component, ComponentType, ConnectorDetail, ConnectorPin,
    ConnectorShell, DrawingLayer, HarnessAssembly, LRUBlock, Point,
    ProjectModel, SchematicSheet, SignalPath, SignalType, Splice, WireRecord,
    WireSegment,
)


def _dict_to_point(d: dict) -> Point:
    return Point(x=d.get("x", 0.0), y=d.get("y", 0.0))


def _apply_add(model: ProjectModel, op: ChangeOperation) -> None:
    data = op.after or {}

    if op.element_kind == ElementKind.LRU_BLOCK:
        if not model.block_diagrams:
            model.block_diagrams.append(BlockDiagram())
        bd = model.block_diagrams[-1]
        pos = data.get("position", {})
        bd.lru_blocks.append(LRUBlock(
            id=data.get("id") or str(uuid.uuid4()),
            ref=data.get("ref", ""),
            name=data.get("name", ""),
            ata_chapter=data.get("ata_chapter", ""),
            part_number=data.get("part_number", ""),
            installation_dwg=data.get("installation_dwg", ""),
            position=_dict_to_point(pos),
            sheet=data.get("sheet", 1),
        ))

    elif op.element_kind == ElementKind.SIGNAL_PATH:
        if not model.block_diagrams:
            model.block_diagrams.append(BlockDiagram())
        bd = model.block_diagrams[-1]
        try:
            st = SignalType(data.get("signal_type", "unknown"))
        except ValueError:
            st = SignalType.UNKNOWN
        bd.signal_paths.append(SignalPath(
            id=data.get("id") or str(uuid.uuid4()),
            path_id=data.get("path_id", ""),
            signal_type=st,
            from_lru_id=data.get("from_lru_id", ""),
            to_lru_id=data.get("to_lru_id", ""),
            voltage=data.get("voltage"),
            current_rating=data.get("current_rating"),
            sheet=data.get("sheet", 1),
        ))

    elif op.element_kind == ElementKind.COMPONENT:
        sheet = _get_or_create_schematic_sheet(model, op.sheet or 1)
        try:
            ct = ComponentType(data.get("type", "unknown"))
        except ValueError:
            ct = ComponentType.UNKNOWN
        pos = data.get("position", {})
        sheet.components.append(Component(
            id=data.get("id") or str(uuid.uuid4()),
            ref=data.get("ref", ""),
            type=ct,
            position=_dict_to_point(pos),
            rotation=data.get("rotation", 0.0),
            sheet=op.sheet or 1,
            attributes=data.get("attributes", {}),
        ))

    elif op.element_kind == ElementKind.CONNECTOR_SHELL:
        sheet = _get_or_create_schematic_sheet(model, op.sheet or 1)
        pos = data.get("position", {})
        pins = [ConnectorPin(**p) for p in data.get("pins", [])]
        sheet.connectors.append(ConnectorShell(
            id=data.get("id") or str(uuid.uuid4()),
            ref=data.get("ref", ""),
            part_number=data.get("part_number", ""),
            mating_ref=data.get("mating_ref", ""),
            shell_class=data.get("shell_class", ""),
            insert_arrangement=data.get("insert_arrangement", ""),
            backshell_pn=data.get("backshell_pn", ""),
            potting_required=data.get("potting_required", False),
            pins=pins,
            position=_dict_to_point(pos),
            sheet=op.sheet or 1,
        ))

    elif op.element_kind == ElementKind.WIRE_SEGMENT:
        sheet = _get_or_create_schematic_sheet(model, op.sheet or 1)
        try:
            st = SignalType(data.get("signal_type", "unknown"))
        except ValueError:
            st = SignalType.UNKNOWN
        sheet.wires.append(WireSegment(
            id=data.get("id") or str(uuid.uuid4()),
            label=data.get("label", ""),
            start=_dict_to_point(data.get("start", {})),
            end=_dict_to_point(data.get("end", {})),
            sheet=op.sheet or 1,
            cross_section_mm2=data.get("cross_section_mm2"),
            color=data.get("color"),
            voltage=data.get("voltage"),
            signal_type=st,
            shielded=data.get("shielded", False),
            shield_drain_ref=data.get("shield_drain_ref", ""),
        ))

    elif op.element_kind == ElementKind.WIRE_RECORD:
        asm = _get_or_create_harness_assembly(model, op.sheet or 1)
        try:
            st = SignalType(data.get("signal_type", "unknown"))
        except ValueError:
            st = SignalType.UNKNOWN
        asm.wires.append(WireRecord(
            id=data.get("id") or str(uuid.uuid4()),
            wire_label=data.get("wire_label", ""),
            from_connector=data.get("from_connector", ""),
            from_pin=data.get("from_pin", ""),
            to_connector=data.get("to_connector", ""),
            to_pin=data.get("to_pin", ""),
            length_m=data.get("length_m"),
            cross_section_mm2=data.get("cross_section_mm2"),
            color=data.get("color", ""),
            material_spec=data.get("material_spec", ""),
            signal_type=st,
        ))

    elif op.element_kind == ElementKind.CONNECTOR_DETAIL:
        asm = _get_or_create_harness_assembly(model, op.sheet or 1)
        asm.connectors.append(ConnectorDetail(
            id=data.get("id") or str(uuid.uuid4()),
            ref=data.get("ref", ""),
            part_number=data.get("part_number", ""),
            cage_code=data.get("cage_code", ""),
            shell_class=data.get("shell_class", ""),
            backshell_pn=data.get("backshell_pn", ""),
            airframe_zone=data.get("airframe_zone", ""),
        ))

    elif op.element_kind == ElementKind.SPLICE:
        asm = _get_or_create_harness_assembly(model, op.sheet or 1)
        asm.splices.append(Splice(
            id=data.get("id") or str(uuid.uuid4()),
            ref=data.get("ref", ""),
            splice_type=data.get("splice_type", "crimp"),
            part_number=data.get("part_number", ""),
            location_description=data.get("location_description", ""),
            airframe_zone=data.get("airframe_zone", ""),
        ))


def _apply_modify(model: ProjectModel, op: ChangeOperation) -> None:
    """Patch an existing element by ID, updating only keys present in op.after."""
    if not op.element_id or not op.after:
        return

    for obj in _iter_all_elements(model):
        if hasattr(obj, "id") and obj.id == op.element_id:
            for key, val in op.after.items():
                if hasattr(obj, key):
                    setattr(obj, key, val)
            return


def _apply_delete(model: ProjectModel, op: ChangeOperation) -> None:
    """Remove an element by ID from whichever list it lives in."""
    if not op.element_id:
        return

    for bd in model.block_diagrams:
        bd.lru_blocks    = [e for e in bd.lru_blocks    if e.id != op.element_id]
        bd.signal_paths  = [e for e in bd.signal_paths  if e.id != op.element_id]

    for sheet in model.schematic_sheets:
        sheet.components = [e for e in sheet.components if e.id != op.element_id]
        sheet.connectors = [e for e in sheet.connectors if e.id != op.element_id]
        sheet.wires      = [e for e in sheet.wires      if e.id != op.element_id]

    for hs in model.harness_sheets:
        for asm in hs.assemblies:
            asm.wires      = [e for e in asm.wires      if e.id != op.element_id]
            asm.connectors = [e for e in asm.connectors if e.id != op.element_id]
            asm.splices    = [e for e in asm.splices    if e.id != op.element_id]


def _iter_all_elements(model: ProjectModel):
    for bd in model.block_diagrams:
        yield from bd.lru_blocks
        yield from bd.signal_paths
    for sheet in model.schematic_sheets:
        yield from sheet.components
        yield from sheet.connectors
        yield from sheet.wires
    for hs in model.harness_sheets:
        for asm in hs.assemblies:
            yield from asm.wires
            yield from asm.connectors
            yield from asm.splices


def _get_or_create_schematic_sheet(model: ProjectModel, sheet_num: int) -> SchematicSheet:
    for sheet in model.schematic_sheets:
        if sheet.number == sheet_num:
            return sheet
    sheet = SchematicSheet(number=sheet_num)
    model.schematic_sheets.append(sheet)
    return sheet


def _get_or_create_harness_assembly(model: ProjectModel, sheet_num: int) -> HarnessAssembly:
    for hs in model.harness_sheets:
        if hs.number == sheet_num:
            if hs.assemblies:
                return hs.assemblies[0]
            asm = HarnessAssembly()
            hs.assemblies.append(asm)
            return asm
    from models.project import HarnessSheet
    asm = HarnessAssembly()
    hs = HarnessSheet(number=sheet_num, assemblies=[asm])
    model.harness_sheets.append(hs)
    return asm


def apply_changeset(model: ProjectModel, changeset: ChangeSet) -> ProjectModel:
    """
    Apply a ChangeSet to a ProjectModel and return the modified copy.
    Does not modify the original model in-place.
    """
    updated = copy.deepcopy(model)

    for op in changeset.operations:
        if op.operation == OperationType.ADD:
            _apply_add(updated, op)
        elif op.operation == OperationType.MODIFY:
            _apply_modify(updated, op)
        elif op.operation == OperationType.DELETE:
            _apply_delete(updated, op)

    changeset.applied = True
    return updated
