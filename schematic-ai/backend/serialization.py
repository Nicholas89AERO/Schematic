"""Serialize and deserialize ProjectModel for database storage."""

from __future__ import annotations

import dataclasses
import uuid
from typing import Any

from models.project import (
    BlockDiagram,
    Component,
    ComponentType,
    ConnectorDetail,
    ConnectorPin,
    ConnectorShell,
    HarnessAssembly,
    HarnessSheet,
    Point,
    ProjectModel,
    SchematicSheet,
    SignalType,
    TitleBlock,
    WireRecord,
    WireSegment,
)


def model_to_dict(obj: Any) -> Any:
    """Recursively convert dataclasses and enums to JSON-serialisable dicts."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: model_to_dict(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, list):
        return [model_to_dict(i) for i in obj]
    if isinstance(obj, dict):
        return {k: model_to_dict(v) for k, v in obj.items()}
    if hasattr(obj, "value"):
        return obj.value
    return obj


def dict_to_project(d: dict) -> ProjectModel:
    """Reconstruct a ProjectModel from a JSON-compatible dict."""
    tb_data = d.get("title_block", {})
    title_block = TitleBlock(
        project_number=tb_data.get("project_number", ""),
        drawing_number=tb_data.get("drawing_number", ""),
        drawing_title=tb_data.get("drawing_title", ""),
        revision=tb_data.get("revision", ""),
        date=tb_data.get("date", ""),
        drawn_by=tb_data.get("drawn_by", ""),
        checked_by=tb_data.get("checked_by", ""),
        approved_by=tb_data.get("approved_by", ""),
        standard=tb_data.get("standard", ""),
        ata_chapter=tb_data.get("ata_chapter", ""),
        sheet_count=tb_data.get("sheet_count", 1),
        company=tb_data.get("company", ""),
        aircraft_type=tb_data.get("aircraft_type", ""),
        certification_basis=tb_data.get("certification_basis", ""),
    )

    return ProjectModel(
        project_id=d.get("project_id", str(uuid.uuid4())),
        project_number=d.get("project_number", ""),
        aircraft_type=d.get("aircraft_type", ""),
        ata_chapter=d.get("ata_chapter", ""),
        certification_basis=d.get("certification_basis", ""),
        title_block=title_block,
        block_diagrams=[dict_to_block_diagram(bd) for bd in d.get("block_diagrams", [])],
        schematic_sheets=[dict_to_schematic_sheet(ss) for ss in d.get("schematic_sheets", [])],
        harness_sheets=[dict_to_harness_sheet(hs) for hs in d.get("harness_sheets", [])],
        all_signal_paths=d.get("all_signal_paths", {}),
        all_wire_labels=d.get("all_wire_labels", {}),
        all_connector_refs=d.get("all_connector_refs", {}),
        parse_warnings=d.get("parse_warnings", []),
        consistency_warnings=d.get("consistency_warnings", []),
    )


def dict_to_block_diagram(d: dict) -> BlockDiagram:
    from models.project import LRUBlock, SignalPath

    bd = BlockDiagram(
        sheet_number=d.get("sheet_number", 1),
        title=d.get("title", ""),
        power_buses=d.get("power_buses", []),
    )
    for lb in d.get("lru_blocks", []):
        pos = lb.get("position", {})
        bd.lru_blocks.append(LRUBlock(
            id=lb.get("id", str(uuid.uuid4())),
            ref=lb.get("ref", ""),
            name=lb.get("name", ""),
            ata_chapter=lb.get("ata_chapter", ""),
            part_number=lb.get("part_number", ""),
            installation_dwg=lb.get("installation_dwg", ""),
            position=Point(x=pos.get("x", 0), y=pos.get("y", 0)),
            sheet=lb.get("sheet", 1),
        ))
    for sp in d.get("signal_paths", []):
        try:
            st = SignalType(sp.get("signal_type", "unknown"))
        except ValueError:
            st = SignalType.UNKNOWN
        bd.signal_paths.append(SignalPath(
            id=sp.get("id", str(uuid.uuid4())),
            path_id=sp.get("path_id", ""),
            signal_type=st,
            from_lru_id=sp.get("from_lru_id", ""),
            to_lru_id=sp.get("to_lru_id", ""),
            voltage=sp.get("voltage"),
            sheet=sp.get("sheet", 1),
        ))
    return bd


def dict_to_schematic_sheet(d: dict) -> SchematicSheet:
    sheet = SchematicSheet(
        number=d.get("number", 1),
        title=d.get("title", ""),
        signal_path_id=d.get("signal_path_id", ""),
    )
    for c in d.get("components", []):
        try:
            ct = ComponentType(c.get("type", "unknown"))
        except ValueError:
            ct = ComponentType.UNKNOWN
        pos = c.get("position", {})
        sheet.components.append(Component(
            id=c.get("id", str(uuid.uuid4())),
            ref=c.get("ref", ""),
            type=ct,
            position=Point(x=pos.get("x", 0), y=pos.get("y", 0)),
            rotation=c.get("rotation", 0.0),
            sheet=c.get("sheet", 1),
            attributes=c.get("attributes", {}),
        ))
    for conn in d.get("connectors", []):
        pos = conn.get("position", {})
        pins = [ConnectorPin(**p) for p in conn.get("pins", [])]
        sheet.connectors.append(ConnectorShell(
            id=conn.get("id", str(uuid.uuid4())),
            ref=conn.get("ref", ""),
            part_number=conn.get("part_number", ""),
            mating_ref=conn.get("mating_ref", ""),
            pins=pins,
            position=Point(x=pos.get("x", 0), y=pos.get("y", 0)),
            sheet=conn.get("sheet", 1),
        ))
    for w in d.get("wires", []):
        try:
            st = SignalType(w.get("signal_type", "unknown"))
        except ValueError:
            st = SignalType.UNKNOWN
        sp = w.get("start", {})
        ep = w.get("end", {})
        sheet.wires.append(WireSegment(
            id=w.get("id", str(uuid.uuid4())),
            label=w.get("label", ""),
            start=Point(x=sp.get("x", 0), y=sp.get("y", 0)),
            end=Point(x=ep.get("x", 0), y=ep.get("y", 0)),
            sheet=w.get("sheet", 1),
            signal_type=st,
            cross_section_mm2=w.get("cross_section_mm2"),
            color=w.get("color"),
            voltage=w.get("voltage"),
        ))
    return sheet


def dict_to_harness_sheet(d: dict) -> HarnessSheet:
    sheet = HarnessSheet(
        number=d.get("number", 1),
        title=d.get("title", ""),
    )
    for asm in d.get("assemblies", []):
        assembly = HarnessAssembly(
            id=asm.get("id", str(uuid.uuid4())),
            assembly_number=asm.get("assembly_number", ""),
            assembly_title=asm.get("assembly_title", ""),
            ata_chapter=asm.get("ata_chapter", ""),
            airframe_zone=asm.get("airframe_zone", ""),
            routing_codes=asm.get("routing_codes", []),
            sleeving_spec=asm.get("sleeving_spec", ""),
        )
        for wr in asm.get("wires", []):
            try:
                st = SignalType(wr.get("signal_type", "unknown"))
            except ValueError:
                st = SignalType.UNKNOWN
            assembly.wires.append(WireRecord(
                id=wr.get("id", str(uuid.uuid4())),
                wire_label=wr.get("wire_label", ""),
                from_connector=wr.get("from_connector", ""),
                from_pin=wr.get("from_pin", ""),
                to_connector=wr.get("to_connector", ""),
                to_pin=wr.get("to_pin", ""),
                length_m=wr.get("length_m"),
                cross_section_mm2=wr.get("cross_section_mm2"),
                color=wr.get("color", ""),
                material_spec=wr.get("material_spec", ""),
                signal_type=st,
            ))
        for cd in asm.get("connectors", []):
            assembly.connectors.append(ConnectorDetail(
                id=cd.get("id", str(uuid.uuid4())),
                ref=cd.get("ref", ""),
                part_number=cd.get("part_number", ""),
                cage_code=cd.get("cage_code", ""),
                backshell_pn=cd.get("backshell_pn", ""),
                airframe_zone=cd.get("airframe_zone", ""),
            ))
        sheet.assemblies.append(assembly)
    return sheet
