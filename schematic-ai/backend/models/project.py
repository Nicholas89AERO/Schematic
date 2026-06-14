"""
ProjectModel — single source of truth for all three drawing layers.

Layer 1: Block Diagram (system-level single-line)
Layer 2: Schematic (detailed interconnection)
Layer 3: Harness (production packaging)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional
from enum import Enum
import uuid


# ─────────────────────────────────────────────
# SHARED ENUMERATIONS
# ─────────────────────────────────────────────

class DrawingLayer(str, Enum):
    BLOCK_DIAGRAM = "block_diagram"
    SCHEMATIC     = "schematic"
    HARNESS       = "harness"


class SignalType(str, Enum):
    POWER_DC      = "power_dc"
    POWER_AC      = "power_ac"
    ARINC429      = "arinc429"
    ARINC664      = "arinc664"
    MIL_STD_1553  = "mil_std_1553"
    DISCRETE      = "discrete"
    ANALOG        = "analog"
    RS422         = "rs422"
    CAN           = "can"
    GROUND        = "ground"
    UNKNOWN       = "unknown"


class ComponentType(str, Enum):
    # Layer 1
    LRU              = "lru"
    POWER_BUS        = "power_bus"
    EXTERNAL_IFACE   = "external_iface"
    # Layer 2
    CIRCUIT_BREAKER  = "circuit_breaker"
    CONTACTOR        = "contactor"
    RELAY_COIL       = "relay_coil"
    RELAY_CONTACT    = "relay_contact"
    TERMINAL         = "terminal"
    FUSE             = "fuse"
    PUSHBUTTON_NO    = "pushbutton_no"
    PUSHBUTTON_NC    = "pushbutton_nc"
    TRANSFORMER      = "transformer"
    GROUND           = "ground"
    PLC_BLOCK        = "plc_block"
    CONNECTOR_SHELL  = "connector_shell"
    SENSOR           = "sensor"
    MOTOR            = "motor"
    DIODE            = "diode"
    # Layer 3
    HARNESS_ASSEMBLY = "harness_assembly"
    SPLICE           = "splice"
    BACKSHELL        = "backshell"
    UNKNOWN          = "unknown"


# ─────────────────────────────────────────────
# SHARED PRIMITIVES
# ─────────────────────────────────────────────

@dataclass
class Point:
    x: float = 0.0
    y: float = 0.0

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y}


@dataclass
class CrossRef:
    """Bidirectional link between elements in different layers."""
    target_layer: DrawingLayer = DrawingLayer.SCHEMATIC
    target_sheet: int = 1
    target_element_id: str = ""
    label: str = ""
    ref_type: str = ""
    # ref_type: "drills_to" | "belongs_to" | "carried_by" | "detailed_in"


# ─────────────────────────────────────────────
# LAYER 1 — BLOCK DIAGRAM TYPES
# ─────────────────────────────────────────────

@dataclass
class LRUBlock:
    """A Line Replaceable Unit or equipment block on the block diagram."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    ref: str = ""
    name: str = ""
    ata_chapter: str = ""
    part_number: str = ""
    installation_dwg: str = ""
    position: Point = field(default_factory=Point)
    size: tuple = (60.0, 30.0)
    sheet: int = 1
    cross_refs: list[CrossRef] = field(default_factory=list)


@dataclass
class SignalPath:
    """A single-line connection on the block diagram."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    path_id: str = ""
    signal_type: SignalType = SignalType.UNKNOWN
    from_lru_id: str = ""
    to_lru_id: str = ""
    from_pin: str = ""
    to_pin: str = ""
    voltage: Optional[str] = None
    current_rating: Optional[float] = None
    spec_reference: str = ""
    sheet: int = 1
    waypoints: list[Point] = field(default_factory=list)
    cross_refs: list[CrossRef] = field(default_factory=list)


@dataclass
class BlockDiagram:
    sheet_number: int = 1
    title: str = ""
    lru_blocks: list[LRUBlock] = field(default_factory=list)
    signal_paths: list[SignalPath] = field(default_factory=list)
    power_buses: list[dict] = field(default_factory=list)


# ─────────────────────────────────────────────
# LAYER 2 — SCHEMATIC TYPES
# ─────────────────────────────────────────────

@dataclass
class Component:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    ref: str = ""
    type: ComponentType = ComponentType.UNKNOWN
    position: Point = field(default_factory=Point)
    rotation: float = 0.0
    sheet: int = 1
    attributes: dict = field(default_factory=dict)
    cross_refs: list[CrossRef] = field(default_factory=list)


@dataclass
class ConnectorPin:
    pin_number: str = ""
    signal_name: str = ""
    wire_id: str = ""
    mating_connector_ref: str = ""
    mating_pin: str = ""


@dataclass
class ConnectorShell:
    """A connector symbol in the schematic with full pin table."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    ref: str = ""
    part_number: str = ""
    mating_ref: str = ""
    shell_class: str = ""
    insert_arrangement: str = ""
    backshell_pn: str = ""
    potting_required: bool = False
    pins: list[ConnectorPin] = field(default_factory=list)
    position: Point = field(default_factory=Point)
    sheet: int = 1
    cross_refs: list[CrossRef] = field(default_factory=list)


@dataclass
class WireSegment:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    label: str = ""
    start: Point = field(default_factory=Point)
    end: Point = field(default_factory=Point)
    sheet: int = 1
    layer: str = ""
    cross_section_mm2: Optional[float] = None
    awg: Optional[int] = None
    color: Optional[str] = None
    voltage: Optional[str] = None
    signal_type: SignalType = SignalType.UNKNOWN
    shielded: bool = False
    shield_drain_ref: str = ""
    cross_sheet_ref: Optional[str] = None
    cross_refs: list[CrossRef] = field(default_factory=list)


@dataclass
class Connection:
    component_id: str = ""
    pin: str = ""
    wire_id: str = ""


@dataclass
class SchematicSheet:
    number: int = 1
    title: str = ""
    signal_path_id: str = ""
    lru_refs: list[str] = field(default_factory=list)
    components: list[Component] = field(default_factory=list)
    connectors: list[ConnectorShell] = field(default_factory=list)
    wires: list[WireSegment] = field(default_factory=list)
    connections: list[Connection] = field(default_factory=list)


# ─────────────────────────────────────────────
# LAYER 3 — HARNESS TYPES
# ─────────────────────────────────────────────

@dataclass
class WireRecord:
    """A single wire within a harness assembly."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    wire_label: str = ""
    from_connector: str = ""
    from_pin: str = ""
    to_connector: str = ""
    to_pin: str = ""
    length_m: Optional[float] = None
    cross_section_mm2: Optional[float] = None
    awg: Optional[int] = None
    color: str = ""
    material_spec: str = ""
    signal_name: str = ""
    signal_type: SignalType = SignalType.UNKNOWN
    shielded: bool = False
    shield_id: str = ""
    cross_refs: list[CrossRef] = field(default_factory=list)


@dataclass
class ConnectorDetail:
    """Full connector manufacturing detail in the harness drawing."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    ref: str = ""
    part_number: str = ""
    cage_code: str = ""
    shell_class: str = ""
    insert_arrangement: str = ""
    contact_pn: str = ""
    backshell_pn: str = ""
    backshell_angle: str = ""
    potting_compound: str = ""
    safety_wired: bool = False
    airframe_zone: str = ""
    cross_refs: list[CrossRef] = field(default_factory=list)


@dataclass
class Splice:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    ref: str = ""
    splice_type: str = ""
    part_number: str = ""
    wire_ids: list[str] = field(default_factory=list)
    location_description: str = ""
    airframe_zone: str = ""


@dataclass
class HarnessBreakout:
    """A branch point in the harness where the bundle splits."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    ref: str = ""
    position_from_ref: str = ""
    branch_ids: list[str] = field(default_factory=list)


@dataclass
class HarnessAssembly:
    """Top-level harness assembly — what the cable shop builds."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    assembly_number: str = ""
    assembly_title: str = ""
    ata_chapter: str = ""
    airframe_zone: str = ""
    routing_codes: list[str] = field(default_factory=list)
    overall_diameter_mm: Optional[float] = None
    overall_length_m: Optional[float] = None
    sleeving_spec: str = ""
    wires: list[WireRecord] = field(default_factory=list)
    connectors: list[ConnectorDetail] = field(default_factory=list)
    splices: list[Splice] = field(default_factory=list)
    breakouts: list[HarnessBreakout] = field(default_factory=list)
    schematic_sheet_refs: list[str] = field(default_factory=list)
    cross_refs: list[CrossRef] = field(default_factory=list)


@dataclass
class HarnessSheet:
    number: int = 1
    title: str = ""
    assemblies: list[HarnessAssembly] = field(default_factory=list)
    wire_list: list[WireRecord] = field(default_factory=list)
    connector_table: list[ConnectorDetail] = field(default_factory=list)


# ─────────────────────────────────────────────
# TITLE BLOCK
# ─────────────────────────────────────────────

@dataclass
class TitleBlock:
    project_number: str = ""
    drawing_number: str = ""
    drawing_title: str = ""
    revision: str = ""
    date: str = ""
    drawn_by: str = ""
    checked_by: str = ""
    approved_by: str = ""
    standard: str = ""
    ata_chapter: str = ""
    sheet_count: int = 1
    company: str = ""
    aircraft_type: str = ""
    certification_basis: str = ""


# ─────────────────────────────────────────────
# PROJECT ROOT
# ─────────────────────────────────────────────

@dataclass
class ProjectModel:
    """The complete three-layer project. Single source of truth."""
    project_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    project_number: str = ""
    aircraft_type: str = ""
    ata_chapter: str = ""
    certification_basis: str = ""
    title_block: TitleBlock = field(default_factory=TitleBlock)

    # Layer 1
    block_diagrams: list[BlockDiagram] = field(default_factory=list)

    # Layer 2
    schematic_sheets: list[SchematicSheet] = field(default_factory=list)

    # Layer 3
    harness_sheets: list[HarnessSheet] = field(default_factory=list)

    # Global registries for cross-reference lookups
    # key: path_id (e.g. "SP-042") → SignalPath
    all_signal_paths: dict = field(default_factory=dict)
    # key: wire_label (e.g. "W042-003") → { schematic_id, harness_id }
    all_wire_labels: dict = field(default_factory=dict)
    # key: connector_ref (e.g. "P042A") → { schematic_sheet, harness_assembly }
    all_connector_refs: dict = field(default_factory=dict)

    parse_warnings: list[str] = field(default_factory=list)
    consistency_warnings: list[str] = field(default_factory=list)
