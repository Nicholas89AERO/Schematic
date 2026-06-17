import type { DrawingLayer, ProjectModel, ParseJob, ConsistencyResult } from '../types/project';
import type { ComplianceReport } from '../types/compliance';

// ─────────────────────────────────────────────
// Folder Tree types
// ─────────────────────────────────────────────

export type TreeNodeType = 'project' | 'folder' | 'drawing';

export interface DrawingMeta {
  projectId: string;       // backend ProjectModel id
  layer: DrawingLayer;
  sheets: number;
  filename: string;
}

export interface TreeNode {
  id: string;
  name: string;
  type: TreeNodeType;
  parentId: string | null;
  childIds: string[];
  expanded: boolean;
  drawing?: DrawingMeta;  // only set when type === 'drawing'
}

export type TreeMap = Record<string, TreeNode>;

// ─────────────────────────────────────────────

export interface BreadcrumbItem {
  layer: DrawingLayer;
  label: string;
  elementId?: string;
  sheet?: number;
}

// ─────────────────────────────────────────────
// Active placement tool
// ─────────────────────────────────────────────

export type ToolType =
  // L1 Block Diagram
  | 'lru_block' | 'power_bus' | 'external_iface' | 'signal_path'
  // L2 Schematic
  | 'circuit_breaker' | 'relay_coil' | 'ground' | 'fuse'
  | 'connector' | 'terminal_block' | 'wire' | 'junction'
  // L3 Harness
  | 'wire_record' | 'splice' | 'breakout';

export interface ActiveTool {
  type: ToolType;
  /** cursor label shown next to pointer */
  label: string;
  /** for two-point tools (wire, power_bus, signal_path): first click coords */
  pendingStart?: { x: number; y: number };
}

export interface AppState {
  project: ProjectModel | null;
  projectId: string | null;
  activeLayer: DrawingLayer;
  selectedElementId: string | null;
  breadcrumb: BreadcrumbItem[];
  parseJobs: Record<string, ParseJob>;
  compliance: ComplianceReport | null;
  consistency: ConsistencyResult | null;
  aiLoading: boolean;
  aiMessages: ChatMessage[];
  lastChangeset: unknown | null;
  sidebarOpen: boolean;
  aiPanelOpen: boolean;
  activeAiTab: 'chat' | 'compliance' | 'diff' | 'consistency';
  // Active placement tool
  activeTool: ActiveTool | null;
  // Draw options
  gridSnap: boolean;
  orthoMode: boolean;
  // Clipboard for copy/paste
  clipboard: { elementType: string; data: unknown } | null;
  // Undo / redo history (stores project snapshots)
  projectHistory: (ProjectModel | null)[];
  projectFuture:  (ProjectModel | null)[];
  // Folder tree
  treeNodes: TreeMap;
  treeRoots: string[];          // ordered ids of top-level Project nodes
  selectedTreeNodeId: string | null;
  renamingNodeId: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  changeset?: unknown;
}

// ─────────────────────────────────────────────
// Tree helpers
// ─────────────────────────────────────────────

function genId(): string {
  return crypto.randomUUID();
}

function addNode(nodes: TreeMap, node: TreeNode): TreeMap {
  return { ...nodes, [node.id]: node };
}

function removeSubtree(nodes: TreeMap, roots: string[], nodeId: string): [TreeMap, string[]] {
  const toDelete = new Set<string>();
  const collect = (id: string) => {
    toDelete.add(id);
    (nodes[id]?.childIds || []).forEach(collect);
  };
  collect(nodeId);

  const next: TreeMap = {};
  for (const [k, v] of Object.entries(nodes)) {
    if (!toDelete.has(k)) {
      next[k] = { ...v, childIds: v.childIds.filter(c => !toDelete.has(c)) };
    }
  }
  return [next, roots.filter(r => !toDelete.has(r))];
}

// ─────────────────────────────────────────────
// Initial demo tree
// ─────────────────────────────────────────────

const _rootId = genId();

const _initialTree: TreeMap = {
  [_rootId]: {
    id: _rootId,
    name: 'My Project',
    type: 'project',
    parentId: null,
    childIds: [],
    expanded: true,
  },
};

// ─────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────

export type Action =
  | { type: 'SET_PROJECT'; project: ProjectModel; projectId: string }
  | { type: 'SET_ACTIVE_LAYER'; layer: DrawingLayer }
  | { type: 'SELECT_ELEMENT'; elementId: string | null; layer?: DrawingLayer; sheet?: number; label?: string }
  | { type: 'NAVIGATE_TO'; layer: DrawingLayer; elementId?: string; sheet?: number; label?: string }
  | { type: 'CLEAR_BREADCRUMB' }
  | { type: 'SET_PARSE_JOB'; jobId: string; job: ParseJob }
  | { type: 'SET_COMPLIANCE'; report: ComplianceReport }
  | { type: 'SET_CONSISTENCY'; result: ConsistencyResult }
  | { type: 'SET_AI_LOADING'; loading: boolean }
  | { type: 'ADD_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'SET_LAST_CHANGESET'; changeset: unknown }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'TOGGLE_AI_PANEL' }
  | { type: 'SET_AI_TAB'; tab: AppState['activeAiTab'] }
  // Tool placement
  | { type: 'SET_ACTIVE_TOOL'; tool: ActiveTool | null }
  | { type: 'SET_TOOL_PENDING_START'; x: number; y: number }
  | { type: 'PLACE_ELEMENT'; toolType: ToolType; x: number; y: number; x2?: number; y2?: number; sheetIndex?: number }
  | { type: 'DELETE_ELEMENT'; elementId: string }
  | { type: 'TOGGLE_GRID_SNAP' }
  | { type: 'TOGGLE_ORTHO_MODE' }
  | { type: 'COPY_ELEMENT' }
  | { type: 'PASTE_ELEMENT'; x: number; y: number; sheetIndex?: number }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  // Tree actions
  | { type: 'TREE_ADD_PROJECT'; name?: string }
  | { type: 'TREE_ADD_FOLDER'; parentId: string; name?: string }
  | { type: 'TREE_ADD_DRAWING'; parentId: string; drawing: DrawingMeta; name: string }
  | { type: 'TREE_RENAME_NODE'; nodeId: string; name: string }
  | { type: 'TREE_DELETE_NODE'; nodeId: string }
  | { type: 'TREE_TOGGLE_EXPAND'; nodeId: string }
  | { type: 'TREE_SELECT_NODE'; nodeId: string | null }
  | { type: 'TREE_START_RENAME'; nodeId: string }
  | { type: 'TREE_MOVE_NODE'; nodeId: string; newParentId: string };

export const AI_PANEL_STORAGE_KEY = 'schematic-ai-panel';

export function readAiPanelOpen(): boolean {
  try {
    const stored = localStorage.getItem(AI_PANEL_STORAGE_KEY);
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
  } catch {
    /* ignore */
  }
  return false;
}

export const initialState: AppState = {
  project: null,
  projectId: null,
  activeLayer: 'schematic',
  selectedElementId: null,
  breadcrumb: [],
  parseJobs: {},
  compliance: null,
  consistency: null,
  aiLoading: false,
  aiMessages: [],
  lastChangeset: null,
  sidebarOpen: true,
  aiPanelOpen: false,
  activeAiTab: 'chat',
  activeTool: null,
  gridSnap: false,
  orthoMode: false,
  clipboard: null,
  projectHistory: [],
  projectFuture: [],
  treeNodes: _initialTree,
  treeRoots: [_rootId],
  selectedTreeNodeId: null,
  renamingNodeId: null,
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const MAX_HISTORY = 30;

/** Push current project to history and clear future (called before mutations). */
function pushHistory(state: AppState): Pick<AppState, 'projectHistory' | 'projectFuture'> {
  return {
    projectHistory: [...state.projectHistory.slice(-MAX_HISTORY + 1), state.project],
    projectFuture: [],
  };
}

// ─────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {

    case 'SET_PROJECT':
      return { ...state, project: action.project, projectId: action.projectId };

    case 'SET_ACTIVE_LAYER':
      return { ...state, activeLayer: action.layer, selectedElementId: null, activeTool: null };

    case 'SET_ACTIVE_TOOL':
      return { ...state, activeTool: action.tool };

    case 'TOGGLE_GRID_SNAP':
      return { ...state, gridSnap: !state.gridSnap };

    case 'TOGGLE_ORTHO_MODE':
      return { ...state, orthoMode: !state.orthoMode };

    case 'SET_TOOL_PENDING_START':
      if (!state.activeTool) return state;
      return { ...state, activeTool: { ...state.activeTool, pendingStart: { x: action.x, y: action.y } } };

    case 'UNDO': {
      if (state.projectHistory.length === 0) return state;
      const prev = state.projectHistory[state.projectHistory.length - 1];
      return {
        ...state,
        project: prev,
        projectHistory: state.projectHistory.slice(0, -1),
        projectFuture: [state.project, ...state.projectFuture].slice(0, MAX_HISTORY),
        selectedElementId: null,
      };
    }

    case 'REDO': {
      if (state.projectFuture.length === 0) return state;
      const next = state.projectFuture[0];
      return {
        ...state,
        project: next,
        projectHistory: [...state.projectHistory, state.project].slice(-MAX_HISTORY),
        projectFuture: state.projectFuture.slice(1),
        selectedElementId: null,
      };
    }

    case 'COPY_ELEMENT': {
      if (!state.selectedElementId || !state.project) return state;
      const id = state.selectedElementId;
      // Search across all element types
      let found: { elementType: string; data: unknown } | null = null;
      for (const bd of state.project.block_diagrams) {
        const lru = bd.lru_blocks.find(e => e.id === id);
        if (lru) { found = { elementType: 'lru_block', data: JSON.parse(JSON.stringify(lru)) }; break; }
      }
      if (!found) for (const sh of state.project.schematic_sheets) {
        const comp = sh.components.find(e => e.id === id);
        if (comp) { found = { elementType: 'component', data: JSON.parse(JSON.stringify(comp)) }; break; }
        const conn = sh.connectors.find(e => e.id === id);
        if (conn) { found = { elementType: 'connector', data: JSON.parse(JSON.stringify(conn)) }; break; }
        const wire = sh.wires.find(e => e.id === id);
        if (wire) { found = { elementType: 'wire', data: JSON.parse(JSON.stringify(wire)) }; break; }
      }
      if (!found) return state;
      return { ...state, clipboard: found };
    }

    case 'PASTE_ELEMENT': {
      if (!state.clipboard || !state.project) return state;
      const proj = JSON.parse(JSON.stringify(state.project)) as ProjectModel;
      const newId = crypto.randomUUID();
      const si = action.sheetIndex ?? 0;
      const OFFSET = 30;
      const { elementType, data } = state.clipboard;

      if (elementType === 'lru_block') {
        const bd = proj.block_diagrams[si];
        if (!bd) return state;
        const el = data as any;
        const n = bd.lru_blocks.length + 1;
        bd.lru_blocks.push({ ...el, id: newId, ref: `${el.ref}_COPY${n}`,
          position: { x: el.position.x + OFFSET, y: el.position.y + OFFSET } });
      } else if (elementType === 'component') {
        const sh = proj.schematic_sheets[si];
        if (!sh) return state;
        const el = data as any;
        sh.components.push({ ...el, id: newId, ref: `${el.ref}_C`,
          position: { x: el.position.x + OFFSET, y: el.position.y + OFFSET } });
      } else if (elementType === 'connector') {
        const sh = proj.schematic_sheets[si];
        if (!sh) return state;
        const el = data as any;
        sh.connectors.push({ ...el, id: newId, ref: `${el.ref}_C`, pins: el.pins.map((p: any) => ({ ...p })),
          position: { x: el.position.x + OFFSET, y: el.position.y + OFFSET } });
      } else if (elementType === 'wire') {
        const sh = proj.schematic_sheets[si];
        if (!sh) return state;
        const el = data as any;
        sh.wires.push({ ...el, id: newId, label: `${el.label}_C`,
          start: { x: el.start.x + OFFSET, y: el.start.y + OFFSET },
          end:   { x: el.end.x   + OFFSET, y: el.end.y   + OFFSET } });
      }
      return { ...state, project: proj, ...pushHistory(state) };
    }

    case 'DELETE_ELEMENT': {
      if (!state.project) return state;
      const p = JSON.parse(JSON.stringify(state.project)) as ProjectModel;
      p.block_diagrams.forEach(bd => {
        bd.lru_blocks    = bd.lru_blocks.filter(e => e.id !== action.elementId);
        bd.signal_paths  = bd.signal_paths.filter(e => e.id !== action.elementId);
        bd.power_buses   = bd.power_buses.filter(e => e.id !== action.elementId);
      });
      p.schematic_sheets.forEach(sh => {
        sh.components = sh.components.filter(e => e.id !== action.elementId);
        sh.connectors = sh.connectors.filter(e => e.id !== action.elementId);
        sh.wires      = sh.wires.filter(e => e.id !== action.elementId);
      });
      return { ...state, project: p, selectedElementId: null, ...pushHistory(state) };
    }

    case 'PLACE_ELEMENT': {
      if (!state.project) return state;
      const proj = JSON.parse(JSON.stringify(state.project)) as ProjectModel;
      const id   = crypto.randomUUID();
      const si   = action.sheetIndex ?? 0;
      const { x, y, x2 = x + 200, y2 = y, toolType } = action;

      // ── L1 Block Diagram ──
      if (toolType === 'lru_block') {
        let bd = proj.block_diagrams[si];
        if (!bd) {
          bd = { sheet_number: 1, title: 'Sheet 1', lru_blocks: [], signal_paths: [], power_buses: [] };
          proj.block_diagrams.push(bd);
        }
        const n = bd.lru_blocks.length + 1;
        bd.lru_blocks.push({
          id, ref: `LRU${n}`, name: `LRU ${n}`, ata_chapter: '',
          part_number: '', installation_dwg: '',
          position: { x, y }, size: [120, 60], sheet: 1, cross_refs: [],
        });
      }

      else if (toolType === 'external_iface') {
        let bd = proj.block_diagrams[si];
        if (!bd) { bd = { sheet_number: 1, title: 'Sheet 1', lru_blocks: [], signal_paths: [], power_buses: [] }; proj.block_diagrams.push(bd); }
        const n = bd.lru_blocks.filter(b => (b as any).component_type === 'external_iface').length + 1;
        bd.lru_blocks.push({
          id, ref: `EXT${n}`, name: `Ext I/F ${n}`, ata_chapter: '',
          part_number: '', installation_dwg: '',
          position: { x, y }, size: [100, 50], sheet: 1, cross_refs: [],
        });
      }

      else if (toolType === 'power_bus') {
        let bd = proj.block_diagrams[si];
        if (!bd) { bd = { sheet_number: 1, title: 'Sheet 1', lru_blocks: [], signal_paths: [], power_buses: [] }; proj.block_diagrams.push(bd); }
        const n = bd.power_buses.length + 1;
        bd.power_buses.push({
          id, label: `+28VDC BUS ${n}`, voltage: '28VDC', sheet: 1,
          waypoints: [{ x, y }, { x: x2, y: y2 }],
        });
      }

      // ── L2 Schematic ──
      else if (['circuit_breaker','relay_coil','ground','fuse','terminal_block','junction'].includes(toolType)) {
        let sh = proj.schematic_sheets[si];
        if (!sh) { sh = { number: 1, title: 'Sheet 1', signal_path_id: '', lru_refs: [], components: [], connectors: [], wires: [], connections: [] }; proj.schematic_sheets.push(sh); }
        const prefix: Record<string, string> = {
          circuit_breaker: 'CB', relay_coil: 'K', ground: 'GND', fuse: 'F',
          terminal_block: 'TB', junction: 'J',
        };
        const pfx = prefix[toolType] || 'C';
        const n = sh.components.filter(c => c.type === (toolType as any)).length + 1;
        sh.components.push({
          id, ref: `${pfx}${n}`, type: toolType as any,
          position: { x, y }, rotation: 0, sheet: 1,
          attributes: {}, cross_refs: [],
        });
      }

      else if (toolType === 'connector') {
        let sh = proj.schematic_sheets[si];
        if (!sh) { sh = { number: 1, title: 'Sheet 1', signal_path_id: '', lru_refs: [], components: [], connectors: [], wires: [], connections: [] }; proj.schematic_sheets.push(sh); }
        const n = sh.connectors.length + 1;
        sh.connectors.push({
          id, ref: `J${n}`, part_number: '', mating_ref: '', shell_class: '',
          insert_arrangement: '', backshell_pn: '', potting_required: false,
          pins: [
            { pin_number: '1', signal_name: '', wire_id: '', mating_connector_ref: '', mating_pin: '' },
            { pin_number: '2', signal_name: '', wire_id: '', mating_connector_ref: '', mating_pin: '' },
          ],
          position: { x, y }, sheet: 1, cross_refs: [],
        });
      }

      else if (toolType === 'wire') {
        let sh = proj.schematic_sheets[si];
        if (!sh) { sh = { number: 1, title: 'Sheet 1', signal_path_id: '', lru_refs: [], components: [], connectors: [], wires: [], connections: [] }; proj.schematic_sheets.push(sh); }
        const n = sh.wires.length + 1;
        sh.wires.push({
          id, label: `W${String(n).padStart(3, '0')}`, start: { x, y }, end: { x: x2, y: y2 },
          sheet: 1, layer: 'WIRES', cross_section_mm2: null, awg: 22, color: 'white',
          voltage: null, signal_type: 'unknown', shielded: false,
          shield_drain_ref: '', cross_sheet_ref: null, cross_refs: [],
        });
      }

      const nextTool = state.activeTool?.pendingStart ? null : state.activeTool;
      return { ...state, project: proj, activeTool: nextTool, ...pushHistory(state) };
    }

    case 'SELECT_ELEMENT':
      return {
        ...state,
        selectedElementId: action.elementId,
        activeLayer: action.layer || state.activeLayer,
      };

    case 'NAVIGATE_TO': {
      const newCrumb: BreadcrumbItem = {
        layer: action.layer,
        label: action.label || action.layer,
        elementId: action.elementId,
        sheet: action.sheet,
      };
      const lastCrumb = state.breadcrumb[state.breadcrumb.length - 1];
      const isDuplicate = lastCrumb
        && lastCrumb.layer === action.layer
        && lastCrumb.elementId === action.elementId;
      return {
        ...state,
        activeLayer: action.layer,
        selectedElementId: action.elementId || null,
        breadcrumb: isDuplicate ? state.breadcrumb : [...state.breadcrumb, newCrumb],
      };
    }

    case 'CLEAR_BREADCRUMB':
      return { ...state, breadcrumb: [] };

    case 'SET_PARSE_JOB':
      return { ...state, parseJobs: { ...state.parseJobs, [action.jobId]: action.job } };

    case 'SET_COMPLIANCE':
      return { ...state, compliance: action.report };

    case 'SET_CONSISTENCY':
      return { ...state, consistency: action.result };

    case 'SET_AI_LOADING':
      return { ...state, aiLoading: action.loading };

    case 'ADD_CHAT_MESSAGE':
      return { ...state, aiMessages: [...state.aiMessages, action.message] };

    case 'SET_LAST_CHANGESET':
      return { ...state, lastChangeset: action.changeset };

    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };

    case 'TOGGLE_AI_PANEL':
      return { ...state, aiPanelOpen: !state.aiPanelOpen };

    case 'SET_AI_TAB':
      return { ...state, activeAiTab: action.tab };

    // ── Tree actions ──────────────────────────────────────────────────

    case 'TREE_ADD_PROJECT': {
      const id = genId();
      const node: TreeNode = {
        id, name: action.name || 'New Project',
        type: 'project', parentId: null,
        childIds: [], expanded: true,
      };
      return {
        ...state,
        treeNodes: addNode(state.treeNodes, node),
        treeRoots: [...state.treeRoots, id],
        renamingNodeId: id,
      };
    }

    case 'TREE_ADD_FOLDER': {
      const id = genId();
      const node: TreeNode = {
        id, name: action.name || 'New Folder',
        type: 'folder', parentId: action.parentId,
        childIds: [], expanded: true,
      };
      const parent = state.treeNodes[action.parentId];
      if (!parent) return state;
      return {
        ...state,
        treeNodes: {
          ...addNode(state.treeNodes, node),
          [action.parentId]: { ...parent, childIds: [...parent.childIds, id], expanded: true },
        },
        renamingNodeId: id,
      };
    }

    case 'TREE_ADD_DRAWING': {
      const id = genId();
      const node: TreeNode = {
        id, name: action.name,
        type: 'drawing', parentId: action.parentId,
        childIds: [], expanded: false,
        drawing: action.drawing,
      };
      const parent = state.treeNodes[action.parentId];
      if (!parent) return state;
      return {
        ...state,
        treeNodes: {
          ...addNode(state.treeNodes, node),
          [action.parentId]: { ...parent, childIds: [...parent.childIds, id], expanded: true },
        },
      };
    }

    case 'TREE_RENAME_NODE': {
      const node = state.treeNodes[action.nodeId];
      if (!node) return state;
      return {
        ...state,
        treeNodes: { ...state.treeNodes, [action.nodeId]: { ...node, name: action.name } },
        renamingNodeId: null,
      };
    }

    case 'TREE_DELETE_NODE': {
      const [nextNodes, nextRoots] = removeSubtree(state.treeNodes, state.treeRoots, action.nodeId);
      return {
        ...state,
        treeNodes: nextNodes,
        treeRoots: nextRoots,
        selectedTreeNodeId: state.selectedTreeNodeId === action.nodeId ? null : state.selectedTreeNodeId,
        renamingNodeId: state.renamingNodeId === action.nodeId ? null : state.renamingNodeId,
      };
    }

    case 'TREE_TOGGLE_EXPAND': {
      const node = state.treeNodes[action.nodeId];
      if (!node) return state;
      return {
        ...state,
        treeNodes: { ...state.treeNodes, [action.nodeId]: { ...node, expanded: !node.expanded } },
      };
    }

    case 'TREE_SELECT_NODE':
      return { ...state, selectedTreeNodeId: action.nodeId };

    case 'TREE_START_RENAME':
      return { ...state, renamingNodeId: action.nodeId };

    case 'TREE_MOVE_NODE': {
      const node = state.treeNodes[action.nodeId];
      if (!node || node.parentId === action.newParentId) return state;
      const newParent = state.treeNodes[action.newParentId];
      if (!newParent) return state;

      let nodes = { ...state.treeNodes };
      // Remove from old parent
      if (node.parentId && nodes[node.parentId]) {
        nodes[node.parentId] = {
          ...nodes[node.parentId],
          childIds: nodes[node.parentId].childIds.filter(c => c !== action.nodeId),
        };
      }
      // Add to new parent
      nodes[action.newParentId] = {
        ...newParent,
        childIds: [...newParent.childIds, action.nodeId],
        expanded: true,
      };
      nodes[action.nodeId] = { ...node, parentId: action.newParentId };

      const newRoots = node.parentId === null
        ? state.treeRoots.filter(r => r !== action.nodeId)
        : state.treeRoots;

      return { ...state, treeNodes: nodes, treeRoots: newRoots };
    }

    default:
      return state;
  }
}
