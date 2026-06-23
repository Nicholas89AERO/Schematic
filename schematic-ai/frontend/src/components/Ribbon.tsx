/**
 * Windows-style Ribbon menu for SchematicAI.
 * Structure: thin title bar → tab row → command band (groups of buttons).
 * Collapses to tab row only on double-click of active tab.
 */
import React, { useState, useCallback, useRef } from 'react';
import { useApp } from '../state/AppContext';
import { exportDxf, exportPdf, exportWireList, downloadBlob, startConvert, getConvertStatus, downloadConvertedDxf } from '../api/client';
import type { ConvertJob } from '../api/client';
import type { DrawingLayer } from '../types/project';
import type { ToolType } from '../state/reducer';

// ─────────────────────────────────────────────
// Primitive button shapes
// ─────────────────────────────────────────────

interface LargeButtonProps {
  icon: string;
  label: string;
  sublabel?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  color?: string;
  style?: React.CSSProperties;
}

function LargeBtn({ icon, label, sublabel, shortcut, onClick, disabled, active, color = 'text-gray-300', style }: LargeButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${sublabel || label} (${shortcut})` : (sublabel || label)}
      style={style}
      className={`
        flex flex-col items-center justify-center gap-0.5
        w-14 h-14 rounded px-1 text-center transition-all
        ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:bg-white/8'}
        ${active ? 'bg-white/12 outline outline-1 outline-white/20' : ''}
        ${color}
      `}
    >
      <span className="text-xl leading-none select-none">{icon}</span>
      <span className="text-[10px] leading-tight font-medium whitespace-nowrap">{label}</span>
      {sublabel && <span className="text-[9px] leading-none text-gray-600 whitespace-nowrap">{sublabel}</span>}
    </button>
  );
}

interface SmallButtonProps {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}

function SmallBtn({ icon, label, onClick, disabled, active }: SmallButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`
        flex items-center gap-1.5 px-2 py-1 rounded text-left text-xs transition-all w-full
        ${disabled ? 'opacity-30 cursor-not-allowed text-gray-600' : 'text-gray-300 cursor-pointer hover:bg-white/8'}
        ${active ? 'bg-white/12' : ''}
      `}
    >
      <span className="text-sm leading-none select-none w-4 text-center shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────
// Group container
// ─────────────────────────────────────────────

interface GroupProps {
  title: string;
  children: React.ReactNode;
  layout?: 'row' | 'col' | 'grid2' | 'mixed';
}

function Group({ title, children, layout = 'row' }: GroupProps) {
  return (
    <div className="flex flex-col h-full border-r border-white/8 last:border-r-0 pr-2 mr-1">
      <div className={`
        flex-1 flex items-center gap-0.5
        ${layout === 'col'    ? 'flex-col items-stretch justify-center' : ''}
        ${layout === 'grid2'  ? 'flex-col items-stretch justify-center' : ''}
        ${layout === 'mixed'  ? 'flex-row items-center gap-1' : ''}
      `}>
        {children}
      </div>
      <div className="text-[9px] text-gray-600 text-center pt-0.5 uppercase tracking-widest select-none">
        {title}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Layer selector (mini toggle strip)
// ─────────────────────────────────────────────

function LayerStrip() {
  const { state, dispatch } = useApp();
  const layers: { value: DrawingLayer; badge: string; label: string; color: string }[] = [
    { value: 'block_diagram', badge: 'L1', label: 'Block Diagram', color: 'text-aero-orange border-aero-orange/60 bg-aero-orange/10' },
    { value: 'schematic',     badge: 'L2', label: 'Schematic',     color: 'text-aero-accent border-aero-accent/60 bg-aero-accent/10'  },
    { value: 'harness',       badge: 'L3', label: 'Harness',       color: 'text-aero-green border-aero-green/60 bg-aero-green/10'     },
  ];

  return (
    <div className="flex flex-col gap-0.5">
      {layers.map(l => (
        <button
          key={l.value}
          onClick={() => dispatch({ type: 'SET_ACTIVE_LAYER', layer: l.value })}
          className={`
            flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-all border
            ${state.activeLayer === l.value
              ? l.color
              : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-white/5'}
          `}
        >
          <span className="font-mono text-[10px]">{l.badge}</span>
          <span className="text-[10px]">{l.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab definitions
// ─────────────────────────────────────────────

type RibbonTab = 'file' | 'home' | 'insert' | 'draw' | 'annotate' | 'view' | 'ai' | 'compliance' | 'libraries';

const TAB_LABELS: Record<RibbonTab, string> = {
  file:       'File',
  home:       'Home',
  insert:     'Insert',
  draw:       'Draw',
  annotate:   'Annotate',
  view:       'View',
  ai:         'AI Tools',
  compliance: 'Compliance',
  libraries:  'Libraries',
};

// ─────────────────────────────────────────────
// Individual tab command bands
// ─────────────────────────────────────────────

function FileTab({ onNewDrawing }: { onNewDrawing: () => void }) {
  const { state } = useApp();
  const convertInputRef = useRef<HTMLInputElement>(null);
  const [convertJob, setConvertJob]   = useState<ConvertJob | null>(null);
  const [convertErr, setConvertErr]   = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleExport = async (format: 'dxf' | 'pdf' | 'wire-list') => {
    if (!state.projectId) return;
    try {
      let blob: Blob; let filename: string;
      if (format === 'dxf') {
        blob = await exportDxf(state.projectId, state.activeLayer);
        filename = `export_${state.activeLayer}.dxf`;
      } else if (format === 'pdf') {
        blob = await exportPdf(state.projectId, state.activeLayer);
        filename = `export_${state.activeLayer}.pdf`;
      } else {
        blob = await exportWireList(state.projectId);
        filename = 'wire_list.csv';
      }
      downloadBlob(blob, filename);
    } catch (err) { console.error('Export failed', err); }
  };

  const handleConvertFile = async (file: File) => {
    setConvertErr('');
    setConvertJob(null);
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const { job_id } = await startConvert(file);
      setConvertJob({ job_id, status: 'queued', warnings: [], error: null });
      pollRef.current = setInterval(async () => {
        try {
          const job = await getConvertStatus(job_id);
          setConvertJob(job);
          if (job.status === 'complete' || job.status === 'error') {
            clearInterval(pollRef.current!);
            if (job.status === 'complete') downloadConvertedDxf(job_id);
          }
        } catch { clearInterval(pollRef.current!); }
      }, 1200);
    } catch (err: any) {
      setConvertErr(err?.response?.data?.detail || err?.message || 'Conversion failed');
    }
  };

  const convertStatusLabel =
    convertJob?.status === 'queued'     ? 'Queued…'      :
    convertJob?.status === 'converting' ? 'Converting…'  :
    convertJob?.status === 'complete'   ? 'Done — saved' :
    convertJob?.status === 'error'      ? 'Error'        : '';

  const convertStatusColor =
    convertJob?.status === 'complete' ? 'text-aero-green' :
    convertJob?.status === 'error'    ? 'text-aero-red'   : 'text-gray-400';

  return (
    <>
      <input
        ref={convertInputRef} type="file" className="hidden"
        accept=".pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleConvertFile(f); e.target.value = ''; }}
      />

      <Group title="New">
        <LargeBtn icon="✦" label="New" sublabel="Drawing" onClick={onNewDrawing} color="text-aero-accent" />
      </Group>

      <Group title="Import">
        <LargeBtn icon="↑" label="Import" sublabel="DXF/PDF"
          onClick={() => document.getElementById('sidebar-file-upload')?.click()} />
      </Group>

      <Group title="Convert to DXF" layout="col">
        <SmallBtn icon="⇄" label="PDF → DXF"
          onClick={() => { setConvertErr(''); if (convertInputRef.current) { convertInputRef.current.accept = '.pdf'; convertInputRef.current.click(); } }} />
        <SmallBtn icon="⇄" label="DWG → DXF"
          onClick={() => { setConvertErr(''); if (convertInputRef.current) { convertInputRef.current.accept = '.dwg'; convertInputRef.current.click(); } }} />
        {(convertJob || convertErr) && (
          <span className={`text-[9px] leading-none px-1 truncate max-w-[6rem] ${convertStatusColor}`}>
            {convertErr || convertStatusLabel}
          </span>
        )}
      </Group>

      <Group title="Export" layout="col">
        <SmallBtn icon="⎆" label="Export DXF"
          disabled={!state.projectId} onClick={() => handleExport('dxf')} />
        <SmallBtn icon="⎙" label="Export PDF"
          disabled={!state.projectId} onClick={() => handleExport('pdf')} />
        <SmallBtn icon="⊞" label="Wire List CSV"
          disabled={!state.projectId || state.activeLayer !== 'harness'}
          onClick={() => handleExport('wire-list')} />
      </Group>
    </>
  );
}

function HomeTab({ onChipClick }: { onChipClick: (c: string) => void }) {
  const { state, dispatch } = useApp();

  return (
    <>
      <Group title="Layer">
        <LayerStrip />
      </Group>

      <Group title="Clipboard">
        <LargeBtn icon="⎘" label="Copy"  shortcut="Ctrl+C"
          disabled={!state.selectedElementId}
          onClick={() => dispatch({ type: 'COPY_ELEMENT' })} />
        <LargeBtn icon="⎗" label="Cut"   shortcut="Ctrl+X"
          disabled={!state.selectedElementId}
          onClick={() => { dispatch({ type: 'COPY_ELEMENT' }); if (state.selectedElementId) dispatch({ type: 'DELETE_ELEMENT', elementId: state.selectedElementId }); }} />
        <LargeBtn icon="⎙" label="Paste" shortcut="Ctrl+V"
          disabled={!state.clipboard}
          onClick={() => dispatch({ type: 'PASTE_ELEMENT', x: 200, y: 200 })} />
      </Group>

      <Group title="History">
        <LargeBtn icon="↩" label="Undo" shortcut="Ctrl+Z"
          disabled={state.projectHistory.length === 0}
          onClick={() => dispatch({ type: 'UNDO' })} />
        <LargeBtn icon="↪" label="Redo" shortcut="Ctrl+Y"
          disabled={state.projectFuture.length === 0}
          onClick={() => dispatch({ type: 'REDO' })} />
      </Group>

      <Group title="AI Quick Actions" layout="col">
        {state.activeLayer === 'block_diagram' && <>
          <SmallBtn icon="＋" label="Add LRU"         onClick={() => onChipClick('Add LRU')} />
          <SmallBtn icon="⇒" label="Add Signal Path"  onClick={() => onChipClick('Add signal path')} />
          <SmallBtn icon="⚡" label="Add Power Bus"    onClick={() => onChipClick('Add power bus')} />
        </>}
        {state.activeLayer === 'schematic' && <>
          <SmallBtn icon="⎋" label="Clone Circuit"    onClick={() => onChipClick('Clone circuit')} />
          <SmallBtn icon="⊕" label="Add Connector"    onClick={() => onChipClick('Add connector')} />
          <SmallBtn icon="⌀" label="Generate BOM"     onClick={() => onChipClick('Generate BOM')} />
        </>}
        {state.activeLayer === 'harness' && <>
          <SmallBtn icon="≡" label="Generate Wire List"   onClick={() => onChipClick('Generate wire list')} />
          <SmallBtn icon="✦" label="Add Splice"           onClick={() => onChipClick('Add splice')} />
          <SmallBtn icon="⍉" label="Harness Weight"       onClick={() => onChipClick('Calculate harness weight')} />
        </>}
      </Group>

      <Group title="Panels" layout="col">
        <SmallBtn icon="◧" label="Toggle Sidebar"
          onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
          active={state.sidebarOpen} />
        <SmallBtn icon="◨" label="Toggle AI Panel"
          onClick={() => dispatch({ type: 'TOGGLE_AI_PANEL' })}
          active={state.aiPanelOpen} />
      </Group>
    </>
  );
}

function InsertTab({ onChipClick }: { onChipClick: (c: string) => void }) {
  const { state, dispatch } = useApp();
  const activeTool = state.activeTool?.type;

  const setTool = (type: ToolType, label: string) => {
    if (activeTool === type) {
      dispatch({ type: 'SET_ACTIVE_TOOL', tool: null });
    } else {
      dispatch({ type: 'SET_ACTIVE_TOOL', tool: { type, label } });
    }
  };

  const toolBtn = (
    icon: string, label: string, sublabel: string | undefined,
    toolType: ToolType, color: string,
  ) => {
    const active = activeTool === toolType;
    return (
      <LargeBtn
        key={toolType}
        icon={icon}
        label={label}
        sublabel={sublabel}
        color={active ? 'text-white' : color}
        onClick={() => setTool(toolType, sublabel ? `${label} ${sublabel}` : label)}
        style={active ? { background: 'rgba(99,102,241,0.25)', borderColor: '#6366f1', borderRadius: 4 } : undefined}
      />
    );
  };

  return (
    <>
      {/* Active tool indicator strip */}
      {activeTool && (
        <div className="flex items-center gap-2 px-3 py-1 bg-aero-accent/10 border-b border-aero-accent/30 mr-2 rounded text-xs">
          <span className="text-aero-accent font-semibold">✦ Active:</span>
          <span className="text-gray-300 font-mono">{activeTool.replace(/_/g, ' ')}</span>
          <span className="text-gray-500">— click on canvas to place</span>
          <button onClick={() => dispatch({ type: 'SET_ACTIVE_TOOL', tool: null })}
            className="ml-2 text-gray-500 hover:text-gray-200 text-xs">[ESC]</button>
        </div>
      )}

      {state.activeLayer === 'block_diagram' && <>
        <Group title="Blocks">
          {toolBtn('▣', 'LRU', 'Block',     'lru_block',      'text-aero-orange')}
          {toolBtn('⚡', 'Power', 'Bus',     'power_bus',      'text-aero-orange')}
          {toolBtn('⊡', 'External', 'I/F',  'external_iface', 'text-aero-orange')}
        </Group>
        <Group title="Signals">
          {toolBtn('⇒', 'Signal', 'Path',   'signal_path',    'text-aero-orange')}
        </Group>
        <Group title="AI Assist">
          <LargeBtn icon="✦" label="AI" sublabel="Generate"   onClick={() => onChipClick('Generate a block diagram for this system')} color="text-purple-400" />
        </Group>
      </>}

      {state.activeLayer === 'schematic' && <>
        <Group title="Components">
          {toolBtn('○', 'Circuit', 'Breaker',  'circuit_breaker', 'text-aero-accent')}
          {toolBtn('◎', 'Relay',   'Coil',     'relay_coil',      'text-aero-accent')}
          {toolBtn('⏚', 'Ground',  undefined,  'ground',          'text-aero-accent')}
          {toolBtn('◇', 'Fuse',    undefined,  'fuse',            'text-aero-accent')}
        </Group>
        <Group title="Connectors">
          {toolBtn('⊓', 'Connector', 'Shell',  'connector',       'text-aero-accent')}
          {toolBtn('⊑', 'Terminal',  'Block',  'terminal_block',  'text-aero-accent')}
        </Group>
        <Group title="Wiring">
          {toolBtn('─', 'Wire',      undefined, 'wire',            'text-aero-accent')}
          {toolBtn('⊕', 'Junction',  undefined, 'junction',        'text-aero-accent')}
        </Group>
        <Group title="AI Assist">
          <LargeBtn icon="✦" label="AI" sublabel="Generate" onClick={() => onChipClick('Add a complete 28VDC circuit with circuit breaker and connector')} color="text-purple-400" />
        </Group>
      </>}

      {state.activeLayer === 'harness' && <>
        <Group title="Wires">
          {toolBtn('─', 'Wire',    'Record',   'wire_record', 'text-aero-green')}
          {toolBtn('⌁', 'Splice',  undefined,  'splice',      'text-aero-green')}
          {toolBtn('⊞', 'Breakout', undefined, 'breakout',    'text-aero-green')}
        </Group>
        <Group title="Connectors">
          {toolBtn('⊓', 'Connector', 'Detail', 'connector',   'text-aero-green')}
        </Group>
        <Group title="AI Assist">
          <LargeBtn icon="✦" label="AI" sublabel="Generate" onClick={() => onChipClick('Generate harness assembly with wire list')} color="text-purple-400" />
        </Group>
      </>}
    </>
  );
}

function DrawTab({ onChipClick }: { onChipClick: (c: string) => void }) {
  const { state, dispatch } = useApp();
  const isSelectActive = !state.activeTool;

  const tools = state.activeLayer === 'block_diagram' ? [
    { icon: '↗', label: 'Select', sublabel: 'Move', action: () => dispatch({ type: 'SET_ACTIVE_TOOL', tool: null }) },
    { icon: '▭', label: 'Rectangle', sublabel: undefined, action: () => onChipClick('Draw a rectangle annotation on the block diagram') },
    { icon: '─', label: 'Line', sublabel: undefined, action: () => onChipClick('Draw a line annotation on the block diagram') },
    { icon: '⤴', label: 'Arrow', sublabel: undefined, action: () => onChipClick('Draw an arrow annotation') },
  ] : state.activeLayer === 'schematic' ? [
    { icon: '↗', label: 'Select', sublabel: 'Move', action: () => dispatch({ type: 'SET_ACTIVE_TOOL', tool: null }) },
    { icon: '─', label: 'Wire', sublabel: undefined, action: () => dispatch({ type: 'SET_ACTIVE_TOOL', tool: { type: 'wire' as ToolType, label: 'Wire' } }) },
    { icon: '▭', label: 'Rectangle', sublabel: undefined, action: () => onChipClick('Draw a rectangle annotation on the schematic') },
    { icon: '◌', label: 'Circle', sublabel: undefined, action: () => onChipClick('Draw a circle annotation') },
    { icon: '⊕', label: 'Junction', sublabel: undefined, action: () => dispatch({ type: 'SET_ACTIVE_TOOL', tool: { type: 'junction' as ToolType, label: 'Junction' } }) },
  ] : [
    { icon: '↗', label: 'Select', sublabel: 'Move', action: () => dispatch({ type: 'SET_ACTIVE_TOOL', tool: null }) },
    { icon: '─', label: 'Trunk', sublabel: undefined, action: () => onChipClick('Add a harness trunk route') },
    { icon: '⤤', label: 'Branch', sublabel: undefined, action: () => onChipClick('Add a harness branch breakout') },
    { icon: '▭', label: 'Box', sublabel: undefined, action: () => onChipClick('Add a box annotation to the harness drawing') },
  ];

  const isWireActive = state.activeTool?.type === 'wire';
  const isJunctionActive = state.activeTool?.type === 'junction';

  return (
    <>
      <Group title="Drawing Tools">
        {tools.map(t => {
          const isActive = t.label === 'Select' ? isSelectActive
            : t.label === 'Wire' ? isWireActive
            : t.label === 'Junction' ? isJunctionActive
            : false;
          return (
            <LargeBtn key={t.label} icon={t.icon} label={t.label} sublabel={t.sublabel}
              active={isActive}
              onClick={t.action} />
          );
        })}
      </Group>

      <Group title="Snapping" layout="col">
        <SmallBtn icon="⊹" label="Grid Snap"
          active={state.gridSnap}
          onClick={() => dispatch({ type: 'TOGGLE_GRID_SNAP' })} />
        <SmallBtn icon="⊡" label="Ortho Mode"
          active={state.orthoMode}
          onClick={() => dispatch({ type: 'TOGGLE_ORTHO_MODE' })} />
        <SmallBtn icon="◎" label="Snap to Pin"
          onClick={() => onChipClick('Enable snap to pin mode')} />
      </Group>

      <Group title="Geometry" layout="col">
        <SmallBtn icon="⌖" label="Align Selected"
          onClick={() => onChipClick('Align selected elements horizontally')} />
        <SmallBtn icon="⇹" label="Distribute"
          onClick={() => onChipClick('Distribute selected elements evenly')} />
        <SmallBtn icon="⊟" label="Mirror"
          onClick={() => onChipClick('Mirror the selected element horizontally')} />
        <SmallBtn icon="↻" label="Rotate 90°"
          onClick={() => onChipClick('Rotate selected element 90 degrees clockwise')} />
      </Group>
    </>
  );
}

function AnnotateTab({ onChipClick }: { onChipClick: (c: string) => void }) {
  return (
    <>
      <Group title="Text">
        <LargeBtn icon="𝐓" label="Text"  sublabel="Label"   onClick={() => onChipClick('Add text label')} />
        <LargeBtn icon="𝑁" label="Note"  sublabel="Cloud"   onClick={() => onChipClick('Add note')} />
        <LargeBtn icon="⎵" label="Ref"   sublabel="Designator" onClick={() => onChipClick('Add reference designator')} />
      </Group>

      <Group title="Dimensions" layout="col">
        <SmallBtn icon="↔" label="Linear Dimension" />
        <SmallBtn icon="↕" label="Vertical Dimension" />
        <SmallBtn icon="⌀" label="Diameter" />
      </Group>

      <Group title="Title Block" layout="col">
        <SmallBtn icon="▦" label="Insert Title Block" onClick={() => onChipClick('Insert title block')} />
        <SmallBtn icon="✎" label="Edit Title Block"   onClick={() => onChipClick('Edit title block')} />
        <SmallBtn icon="⍰" label="Drawing Revision"  onClick={() => onChipClick('Update revision')} />
      </Group>

      <Group title="References" layout="col">
        <SmallBtn icon="→" label="Cross Reference"  onClick={() => onChipClick('Add cross reference')} />
        <SmallBtn icon="⊞" label="Sheet Reference"  onClick={() => onChipClick('Add sheet reference')} />
      </Group>
    </>
  );
}

function ViewTab() {
  const { state, dispatch } = useApp();
  const canvasZoom = (action: 'in' | 'out' | 'fit' | 'reset') =>
    window.dispatchEvent(new CustomEvent('canvas-zoom', { detail: action }));

  return (
    <>
      <Group title="Zoom">
        <LargeBtn icon="⊕" label="Zoom In"   onClick={() => canvasZoom('in')} />
        <LargeBtn icon="⊖" label="Zoom Out"  onClick={() => canvasZoom('out')} />
        <LargeBtn icon="⊡" label="Fit" sublabel="Page"   onClick={() => canvasZoom('fit')} />
        <LargeBtn icon="⊞" label="1:1" sublabel="Actual" onClick={() => canvasZoom('reset')} />
      </Group>

      <Group title="Display" layout="col">
        <SmallBtn icon="⊹" label="Toggle Grid"
          active={state.gridSnap}
          onClick={() => dispatch({ type: 'TOGGLE_GRID_SNAP' })} />
        <SmallBtn icon="─" label="Toggle Axes" onClick={() => canvasZoom('fit')} />
        <SmallBtn icon="◎" label="Show Pin Numbers" />
        <SmallBtn icon="⊟" label="Show Wire Labels" />
      </Group>

      <Group title="Panels" layout="col">
        <SmallBtn icon="◧" label="Sidebar"
          active={state.sidebarOpen}
          onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })} />
        <SmallBtn icon="◨" label="AI Panel"
          active={state.aiPanelOpen}
          onClick={() => dispatch({ type: 'TOGGLE_AI_PANEL' })} />
      </Group>

      <Group title="Windows" layout="col">
        <SmallBtn icon="▣" label="Split View" />
        <SmallBtn icon="□" label="Full Canvas"
          onClick={() => {
            if (state.sidebarOpen) dispatch({ type: 'TOGGLE_SIDEBAR' });
            if (state.aiPanelOpen) dispatch({ type: 'TOGGLE_AI_PANEL' });
          }} />
      </Group>
    </>
  );
}

function AiTab({ onChipClick }: { onChipClick: (c: string) => void }) {
  const { state, dispatch } = useApp();

  return (
    <>
      <Group title="Modify">
        <LargeBtn icon="✦" label="AI Modify" sublabel="Prompt"
          color="text-aero-accent"
          onClick={() => { dispatch({ type: 'TOGGLE_AI_PANEL' }); dispatch({ type: 'SET_AI_TAB', tab: 'chat' }); }}
          disabled={!state.projectId} />
        <LargeBtn icon="⊕" label="Generate" sublabel="Fragment"
          color="text-aero-accent"
          onClick={() => onChipClick('Generate a new fragment for this layer')}
          disabled={!state.projectId} />
      </Group>

      <Group title="Analyse" layout="col">
        <SmallBtn icon="⍰" label="Explain Element"
          onClick={() => onChipClick('Explain the selected element')}
          disabled={!state.selectedElementId} />
        <SmallBtn icon="⇌" label="Propagate Changes"
          onClick={() => dispatch({ type: 'SET_AI_TAB', tab: 'diff' })}
          disabled={!state.projectId} />
        <SmallBtn icon="⊟" label="View Last Diff"
          onClick={() => dispatch({ type: 'SET_AI_TAB', tab: 'diff' })} />
      </Group>

      <Group title="Layer Specific" layout="col">
        {state.activeLayer === 'block_diagram' && <>
          <SmallBtn icon="◎" label="Check ATA Refs"         onClick={() => onChipClick('Check ATA refs')} />
          <SmallBtn icon="⇒" label="Trace Signal Path"      onClick={() => onChipClick('Trace selected signal path')} />
        </>}
        {state.activeLayer === 'schematic' && <>
          <SmallBtn icon="⌀" label="Generate BOM"           onClick={() => onChipClick('Generate BOM')} />
          <SmallBtn icon="○" label="Check Wire Gauges"      onClick={() => onChipClick('Check wire gauges')} />
          <SmallBtn icon="⊕" label="Find Dangling Wires"    onClick={() => onChipClick('Find dangling wires')} />
        </>}
        {state.activeLayer === 'harness' && <>
          <SmallBtn icon="≡" label="Generate Wire List"     onClick={() => onChipClick('Generate wire list')} />
          <SmallBtn icon="⍉" label="Harness Weight"         onClick={() => onChipClick('Calculate harness weight')} />
          <SmallBtn icon="⊞" label="Check Pin Assignments"  onClick={() => onChipClick('Check pin assignments')} />
        </>}
      </Group>
    </>
  );
}

function ComplianceTab({ onChipClick }: { onChipClick: (c: string) => void }) {
  const { state, dispatch } = useApp();

  const exportComplianceReport = () => {
    if (!state.compliance) return;
    const text = [
      `SchematicAI Compliance Report`,
      `Project: ${state.projectId || 'unknown'}`,
      `Score: ${state.compliance.score}/100`,
      `Generated: ${new Date().toISOString()}`,
      '',
      '--- RULES ---',
      ...state.compliance.results.map((r) =>
        `[${r.severity.toUpperCase()}] ${r.rule_id}: ${r.message}` +
        (r.element_ref ? ` (${r.element_ref})` : '') +
        (r.fix_description ? `\n  Fix: ${r.fix_description}` : '')
      ),
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `compliance-report-${state.projectId || 'project'}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <Group title="Check">
        <LargeBtn icon="✓" label="Check" sublabel="All Rules"
          color="text-aero-green"
          disabled={!state.projectId}
          onClick={() => { if (!state.aiPanelOpen) dispatch({ type: 'TOGGLE_AI_PANEL' }); dispatch({ type: 'SET_AI_TAB', tab: 'compliance' }); }} />
        <LargeBtn icon="⊡" label="Check" sublabel="Layer"
          color="text-aero-green"
          disabled={!state.projectId}
          onClick={() => dispatch({ type: 'SET_AI_TAB', tab: 'compliance' })} />
        <LargeBtn icon="⊹" label="Consistency"
          color="text-aero-green"
          disabled={!state.projectId}
          onClick={() => dispatch({ type: 'SET_AI_TAB', tab: 'consistency' })} />
      </Group>

      <Group title="Fix" layout="col">
        <SmallBtn icon="✦" label="AI Auto-Fix Rule"
          onClick={() => onChipClick('Fix compliance issues')}
          disabled={!state.projectId} />
        <SmallBtn icon="⎙" label="Export Report"
          disabled={!state.compliance}
          onClick={exportComplianceReport} />
      </Group>

      <Group title="Standards" layout="col">
        <SmallBtn icon="▣" label="ATA 100 Checks"
          onClick={() => onChipClick('Run ATA 100 compliance checks on this drawing')} />
        <SmallBtn icon="◎" label="MIL-STD-454 Checks"
          onClick={() => onChipClick('Run MIL-STD-454 compliance checks')} />
        <SmallBtn icon="⊕" label="IEC 60617 Checks"
          onClick={() => onChipClick('Check IEC 60617 symbol compliance')} />
      </Group>

      <Group title="Score" layout="col">
        {state.compliance ? (
          <div className="flex flex-col items-center justify-center px-2">
            <span className={`text-2xl font-bold font-mono ${
              state.compliance.score >= 80 ? 'text-aero-green' :
              state.compliance.score >= 50 ? 'text-aero-yellow' : 'text-aero-red'
            }`}>
              {state.compliance.score}
            </span>
            <span className="text-[9px] text-gray-600 uppercase tracking-wider">Score</span>
            <span className={`text-[10px] mt-0.5 ${
              state.compliance.passed ? 'text-aero-green' : 'text-aero-red'
            }`}>
              {state.compliance.passed ? 'PASS' : 'FAIL'}
            </span>
          </div>
        ) : (
          <span className="text-xs text-gray-700 px-2">No report yet</span>
        )}
      </Group>
    </>
  );
}

function LibrariesTab({ onOpen }: { onOpen: () => void }) {
  const LIBRARY_BTNS = [
    { icon: '▦', label: 'Drawing',   sublabel: 'Templates', color: 'text-aero-accent'  },
    { icon: '⎍', label: 'Parts &',   sublabel: 'Symbols',   color: 'text-aero-accent'  },
    { icon: '─', label: 'Wire',      sublabel: 'Library',   color: 'text-aero-green'   },
    { icon: '⌁', label: 'Cable',     sublabel: 'Library',   color: 'text-aero-orange'  },
    { icon: '⊞', label: 'Mfr.',     sublabel: 'Parts',     color: 'text-aero-yellow'  },
    { icon: '◈', label: 'Circuit',   sublabel: 'Templates', color: 'text-purple-400'   },
  ];
  return (
    <>
      <Group title="Open Library">
        {LIBRARY_BTNS.map(b => (
          <LargeBtn
            key={b.label}
            icon={b.icon}
            label={b.label}
            sublabel={b.sublabel}
            color={b.color}
            onClick={onOpen}
          />
        ))}
      </Group>
      <Group title="Actions" layout="col">
        <SmallBtn icon="↑" label="Import Library File" onClick={onOpen} />
        <SmallBtn icon="↓" label="Export Library File" onClick={onOpen} />
        <SmallBtn icon="⊕" label="Add New Entry"       onClick={onOpen} />
      </Group>
    </>
  );
}

// ─────────────────────────────────────────────
// PUBLIC: Ribbon
// ─────────────────────────────────────────────

interface RibbonProps {
  onChipClick: (chip: string) => void;
  onNewDrawing: () => void;
  onOpenLibrary: () => void;
}

export default function Ribbon({ onChipClick, onNewDrawing, onOpenLibrary }: RibbonProps) {
  const { state } = useApp();

  const [activeTab, setActiveTab] = useState<RibbonTab>('home');
  const [collapsed,  setCollapsed] = useState(false);

  const handleTabClick = useCallback((tab: RibbonTab) => {
    if (tab === activeTab) {
      setCollapsed(v => !v);   // double-click same tab toggles collapse
    } else {
      setActiveTab(tab);
      setCollapsed(false);
    }
  }, [activeTab]);

  // The layer colour for the contextual Insert/Draw tab underline
  const layerAccent =
    state.activeLayer === 'block_diagram' ? 'aero-orange' :
    state.activeLayer === 'harness'       ? 'aero-green'  : 'aero-accent';

  const contextualTabs: RibbonTab[] = ['insert', 'draw', 'annotate'];

  return (
    <div className="shrink-0 bg-aero-panel border-b border-aero-border select-none">

      {/* Title bar */}
      <div className="flex items-center px-3 h-7 border-b border-aero-border/50 bg-aero-dark/40">
        <span className="text-aero-accent font-bold text-xs font-mono mr-4">✈ SchematicAI</span>

        {/* Quick access */}
        <div className="flex items-center gap-0.5">
          {[
            { icon: '✦', label: 'New',       action: onNewDrawing },
            { icon: '↑', label: 'Open',      action: () => document.getElementById('sidebar-file-upload')?.click() },
            { icon: '⊞', label: 'Libraries', action: onOpenLibrary },
          ].map(btn => (
            <button key={btn.label} onClick={btn.action} title={btn.label}
              className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-gray-200 hover:bg-white/8 rounded text-xs transition-colors">
              {btn.icon}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Project info */}
        {state.project && (
          <span className="text-[10px] text-gray-600 font-mono mr-4">
            {state.project.project_number || state.projectId?.slice(0, 8)}
            {state.project.aircraft_type && ` · ${state.project.aircraft_type}`}
            {state.project.title_block.revision && ` Rev. ${state.project.title_block.revision}`}
          </span>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand ribbon' : 'Collapse ribbon'}
          className="text-gray-600 hover:text-gray-300 text-xs ml-1"
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </div>

      {/* Tab row */}
      <div className="flex items-end px-1 h-7">
        {(Object.entries(TAB_LABELS) as [RibbonTab, string][]).map(([tab, label]) => {
          const isContextual = contextualTabs.includes(tab);
          const isActive = activeTab === tab;

          return (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              className={`
                relative px-3 h-7 text-[11px] font-medium transition-colors rounded-t
                ${isActive && !collapsed
                  ? 'text-gray-100 bg-aero-dark border-x border-t border-aero-border -mb-px z-10'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}
                ${isContextual ? `border-b-2 border-${layerAccent}` : ''}
              `}
            >
              {label}
              {isContextual && (
                <span className={`absolute bottom-0 left-0 right-0 h-0.5 bg-${layerAccent} rounded-t`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Command band */}
      {!collapsed && (
        <div className="flex items-stretch gap-0 px-2 py-1 h-20 overflow-x-auto bg-aero-dark/20">
          {activeTab === 'file'       && <FileTab onNewDrawing={onNewDrawing} />}
          {activeTab === 'home'       && <HomeTab onChipClick={onChipClick} />}
          {activeTab === 'insert'     && <InsertTab onChipClick={onChipClick} />}
          {activeTab === 'draw'       && <DrawTab onChipClick={onChipClick} />}
          {activeTab === 'annotate'   && <AnnotateTab onChipClick={onChipClick} />}
          {activeTab === 'view'       && <ViewTab />}
          {activeTab === 'ai'         && <AiTab onChipClick={onChipClick} />}
          {activeTab === 'compliance' && <ComplianceTab onChipClick={onChipClick} />}
          {activeTab === 'libraries'  && <LibrariesTab onOpen={onOpenLibrary} />}
        </div>
      )}
    </div>
  );
}
