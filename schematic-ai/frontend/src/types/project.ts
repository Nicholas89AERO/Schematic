// TypeScript mirrors of backend Python dataclasses

export type DrawingLayer = 'block_diagram' | 'schematic' | 'harness';

export type SignalType =
  | 'power_dc' | 'power_ac' | 'arinc429' | 'arinc664'
  | 'mil_std_1553' | 'discrete' | 'analog' | 'rs422'
  | 'can' | 'ground' | 'unknown';

export type ComponentType =
  | 'lru' | 'power_bus' | 'external_iface'
  | 'circuit_breaker' | 'contactor' | 'relay_coil' | 'relay_contact'
  | 'terminal' | 'fuse' | 'pushbutton_no' | 'pushbutton_nc'
  | 'transformer' | 'ground' | 'plc_block' | 'connector_shell'
  | 'sensor' | 'motor' | 'diode'
  | 'harness_assembly' | 'splice' | 'backshell' | 'unknown';

export interface Point { x: number; y: number; }

export interface CrossRef {
  target_layer: DrawingLayer;
  target_sheet: number;
  target_element_id: string;
  label: string;
  ref_type: string;
}

// ── Layer 1 ──────────────────────────────────────────────────────────

export interface LRUBlock {
  id: string;
  ref: string;
  name: string;
  ata_chapter: string;
  part_number: string;
  installation_dwg: string;
  position: Point;
  size: [number, number];
  sheet: number;
  cross_refs: CrossRef[];
}

export interface SignalPath {
  id: string;
  path_id: string;
  signal_type: SignalType;
  from_lru_id: string;
  to_lru_id: string;
  from_pin: string;
  to_pin: string;
  voltage: string | null;
  current_rating: number | null;
  spec_reference: string;
  sheet: number;
  waypoints: Point[];
  cross_refs: CrossRef[];
}

export interface BlockDiagram {
  sheet_number: number;
  title: string;
  lru_blocks: LRUBlock[];
  signal_paths: SignalPath[];
  power_buses: PowerBus[];
}

export interface PowerBus {
  id: string;
  label: string;
  voltage: string | null;
  sheet: number;
  waypoints: Point[];
}

// ── Layer 2 ──────────────────────────────────────────────────────────

export interface Component {
  id: string;
  ref: string;
  type: ComponentType;
  position: Point;
  rotation: number;
  sheet: number;
  attributes: Record<string, string>;
  cross_refs: CrossRef[];
}

export interface ConnectorPin {
  pin_number: string;
  signal_name: string;
  wire_id: string;
  mating_connector_ref: string;
  mating_pin: string;
}

export interface ConnectorShell {
  id: string;
  ref: string;
  part_number: string;
  mating_ref: string;
  shell_class: string;
  insert_arrangement: string;
  backshell_pn: string;
  potting_required: boolean;
  pins: ConnectorPin[];
  position: Point;
  sheet: number;
  cross_refs: CrossRef[];
}

export interface WireSegment {
  id: string;
  label: string;
  start: Point;
  end: Point;
  sheet: number;
  layer: string;
  cross_section_mm2: number | null;
  awg: number | null;
  color: string | null;
  voltage: string | null;
  signal_type: SignalType;
  shielded: boolean;
  shield_drain_ref: string;
  cross_sheet_ref: string | null;
  cross_refs: CrossRef[];
}

export interface Connection {
  component_id: string;
  pin: string;
  wire_id: string;
}

export interface SchematicSheet {
  number: number;
  title: string;
  signal_path_id: string;
  lru_refs: string[];
  components: Component[];
  connectors: ConnectorShell[];
  wires: WireSegment[];
  connections: Connection[];
}

// ── Layer 3 ──────────────────────────────────────────────────────────

export interface WireRecord {
  id: string;
  wire_label: string;
  from_connector: string;
  from_pin: string;
  to_connector: string;
  to_pin: string;
  length_m: number | null;
  cross_section_mm2: number | null;
  awg: number | null;
  color: string;
  material_spec: string;
  signal_name: string;
  signal_type: SignalType;
  shielded: boolean;
  shield_id: string;
  cross_refs: CrossRef[];
}

export interface ConnectorDetail {
  id: string;
  ref: string;
  part_number: string;
  cage_code: string;
  shell_class: string;
  insert_arrangement: string;
  contact_pn: string;
  backshell_pn: string;
  backshell_angle: string;
  potting_compound: string;
  safety_wired: boolean;
  airframe_zone: string;
  cross_refs: CrossRef[];
}

export interface Splice {
  id: string;
  ref: string;
  splice_type: string;
  part_number: string;
  wire_ids: string[];
  location_description: string;
  airframe_zone: string;
}

export interface HarnessBreakout {
  id: string;
  ref: string;
  position_from_ref: string;
  branch_ids: string[];
}

export interface HarnessAssembly {
  id: string;
  assembly_number: string;
  assembly_title: string;
  ata_chapter: string;
  airframe_zone: string;
  routing_codes: string[];
  overall_diameter_mm: number | null;
  overall_length_m: number | null;
  sleeving_spec: string;
  wires: WireRecord[];
  connectors: ConnectorDetail[];
  splices: Splice[];
  breakouts: HarnessBreakout[];
  schematic_sheet_refs: string[];
  cross_refs: CrossRef[];
}

export interface HarnessSheet {
  number: number;
  title: string;
  assemblies: HarnessAssembly[];
  wire_list: WireRecord[];
  connector_table: ConnectorDetail[];
}

// ── Project Root ──────────────────────────────────────────────────────

export interface TitleBlock {
  project_number: string;
  drawing_number: string;
  drawing_title: string;
  revision: string;
  date: string;
  drawn_by: string;
  checked_by: string;
  approved_by: string;
  standard: string;
  ata_chapter: string;
  sheet_count: number;
  company: string;
  aircraft_type: string;
  certification_basis: string;
}

export interface ProjectModel {
  project_id: string;
  project_number: string;
  aircraft_type: string;
  ata_chapter: string;
  certification_basis: string;
  title_block: TitleBlock;
  block_diagrams: BlockDiagram[];
  schematic_sheets: SchematicSheet[];
  harness_sheets: HarnessSheet[];
  all_signal_paths: Record<string, SignalPath>;
  all_wire_labels: Record<string, Record<string, string>>;
  all_connector_refs: Record<string, Record<string, string>>;
  parse_warnings: string[];
  consistency_warnings: string[];
}

// ── API Response Types ────────────────────────────────────────────────

export interface LayerDetectionResult {
  detected_layer: DrawingLayer;
  confidence: number;
  reason: string;
  requires_user_confirmation: boolean;
}

export interface ParseJob {
  job_id: string;
  status: 'queued' | 'detecting' | 'parsing' | 'linking' | 'complete' | 'error';
  layer: DrawingLayer | null;
  warnings: string[];
  error: string | null;
  detection: LayerDetectionResult | null;
}

export interface ConsistencyResult {
  warnings: string[];
  errors: string[];
  score: number;
}
