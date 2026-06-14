import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SchematicSheet, Component, ConnectorShell, WireSegment } from '../../types/project';
import { useApp } from '../../state/AppContext';
import DrawingSheet from './DrawingSheet';
import ToolGhost from './ToolGhosts';
import ContextMenu, { type MenuSection } from '../ContextMenu';

const COMPONENT_SYMBOLS: Record<string, string> = {
  circuit_breaker: '⊞',
  contactor:       'K',
  relay_coil:      '○',
  relay_contact:   '/',
  terminal:        'TB',
  fuse:            '⊟',
  ground:          '⏚',
  connector_shell: '□',
  sensor:          'S',
  motor:           'M',
  diode:           '▷',
  plc_block:       'PLC',
  unknown:         '?',
};

interface Props {
  sheets: SchematicSheet[];
  activeSheet?: number;
}

function ComponentSymbol({ comp }: { comp: Component; selected: boolean }) {
  const symbol = COMPONENT_SYMBOLS[comp.type] || '?';
  const { x, y } = comp.position;
  return (
    <g transform={`translate(${x},${y}) rotate(${comp.rotation})`}>
      <rect x="-8" y="-8" width="16" height="16" rx="2"
        fill="#161b22" stroke="#58a6ff" strokeWidth="0.8" />
      <text x="0" y="4" textAnchor="middle" fill="#c9d1d9" fontSize="7" fontFamily="Inter">
        {symbol}
      </text>
      {comp.ref && (
        <text x="0" y="-12" textAnchor="middle" fill="#79c0ff" fontSize="7" fontFamily="JetBrains Mono, monospace">
          {comp.ref}
        </text>
      )}
    </g>
  );
}

function ConnectorBlock({ conn, selected, onClick }: { conn: ConnectorShell; selected: boolean; onClick: () => void }) {
  const { x, y } = conn.position;
  const pinH = 8;
  const boxH = Math.max(conn.pins.length, 1) * pinH + 10;
  const boxW = 50;
  return (
    <g transform={`translate(${x},${y})`} onClick={onClick} style={{ cursor: 'pointer' }}>
      <rect x="0" y="0" width={boxW} height={boxH} rx="2"
        fill="#0d1117"
        stroke={selected ? '#58a6ff' : '#30363d'}
        strokeWidth={selected ? 2 : 1}
      />
      <text x={boxW / 2} y="-3" textAnchor="middle" fill="#79c0ff" fontSize="8" fontFamily="JetBrains Mono, monospace" fontWeight="600">
        {conn.ref}
      </text>
      {conn.part_number && (
        <text x={boxW / 2} y={boxH + 7} textAnchor="middle" fill="#6e7681" fontSize="6" fontFamily="Inter">
          {conn.part_number}
        </text>
      )}
      {conn.pins.slice(0, 8).map((pin, i) => (
        <g key={pin.pin_number} transform={`translate(2, ${5 + i * pinH})`}>
          <text fill="#8b949e" fontSize="6" fontFamily="JetBrains Mono, monospace">{pin.pin_number}</text>
          <text x="8" fill="#c9d1d9" fontSize="6" fontFamily="Inter">{pin.signal_name}</text>
          {conn.pins.length > 8 && i === 7 && (
            <text x="8" fill="#6e7681" fontSize="5">+{conn.pins.length - 8} more</text>
          )}
        </g>
      ))}
      {/* Cross-ref indicator */}
      {conn.cross_refs.length > 0 && (
        <circle cx={boxW - 4} cy="4" r="3" fill="#3fb950" opacity="0.8" />
      )}
    </g>
  );
}

function WireLine({ wire, selected, onClick }: { wire: WireSegment; selected: boolean; onClick: () => void }) {
  const SIGNAL_COLORS: Record<string, string> = {
    power_dc: '#f0883e', power_ac: '#f85149', arinc429: '#58a6ff',
    discrete: '#8b949e', analog: '#3fb950', ground: '#3fb950', unknown: '#6e7681',
  };
  const color = SIGNAL_COLORS[wire.signal_type] || '#6e7681';
  const { start: s, end: e } = wire;

  // Orthogonal L-shape: horizontal first then vertical
  const pts = `${s.x},${s.y} ${e.x},${s.y} ${e.x},${e.y}`;
  // Label at elbow corner
  const labelX = e.x;
  const labelY = (s.y + e.y) / 2;

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={selected ? '#ffffff' : color}
        strokeWidth={selected ? 2 : 1}
        strokeDasharray={wire.shielded ? '4,2' : undefined}
        strokeLinejoin="round"
      />
      {/* Wider transparent hit area */}
      <polyline points={pts} fill="none" stroke="transparent" strokeWidth="10" />
      {wire.label && (
        <text x={labelX + 3} y={labelY} fill={color}
          fontSize="7" fontFamily="JetBrains Mono, monospace">
          {wire.label}
        </text>
      )}
    </g>
  );
}

const SCH_W = 1122;
const SCH_H = 794;

export default function SchematicCanvas({ sheets, activeSheet = 1 }: Props) {
  const { state, dispatch } = useApp();
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const [currentSheet, setCurrentSheet] = useState(activeSheet);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sections: MenuSection[] } | null>(null);

  const activeTool = state.activeTool;
  // Keep a ref so event handlers always read the latest value without stale closures
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const isPanningRef = useRef(false);

  const sheetIndex = Math.max(0, sheets.findIndex(s => s.number === currentSheet));

  const sheet = sheets.find(s => s.number === currentSheet) || sheets[0];
  const tb = (state.project as any)?.title_block ?? {};

  // ESC cancels active tool, Delete removes selected
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'SET_ACTIVE_TOOL', tool: null });
      if (e.key === 'Delete' && state.selectedElementId) {
        dispatch({ type: 'DELETE_ELEMENT', elementId: state.selectedElementId });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, state.selectedElementId]);

  // canvas-zoom events from Ribbon View tab
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === 'in')    setZoom(z => Math.min(8, z * 1.3));
      if (action === 'out')   setZoom(z => Math.max(0.2, z * 0.77));
      if (action === 'reset') { setZoom(1); setPan({ x: 40, y: 40 }); }
      if (action === 'fit')   { setZoom(0.85); setPan({ x: 40, y: 40 }); }
    };
    window.addEventListener('canvas-zoom', handler);
    return () => window.removeEventListener('canvas-zoom', handler);
  }, []);

  const toCanvasXY = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top  - pan.y) / zoom,
    };
  };

  const toCanvas = useCallback((e: React.MouseEvent) => toCanvasXY(e.clientX, e.clientY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pan, zoom]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.2, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
      return;
    }
    if (activeToolRef.current) setGhostPos(toCanvasXY(e.clientX, e.clientY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan, zoom]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.altKey) {
      isPanningRef.current = true;
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    // Left-click placement — read from ref to always get latest activeTool
    if (e.button !== 0) return;
    const tool = activeToolRef.current;
    if (!tool) return;
    e.stopPropagation();
    const { x, y } = toCanvasXY(e.clientX, e.clientY);
    const twoPoint = ['wire', 'power_bus', 'signal_path'].includes(tool.type);
    if (twoPoint) {
      if (!tool.pendingStart) {
        dispatch({ type: 'SET_TOOL_PENDING_START', x, y });
      } else {
        dispatch({
          type: 'PLACE_ELEMENT',
          toolType: tool.type,
          x: tool.pendingStart.x,
          y: tool.pendingStart.y,
          x2: x, y2: y,
          sheetIndex,
        });
      }
    } else {
      dispatch({ type: 'PLACE_ELEMENT', toolType: tool.type, x, y, sheetIndex });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan, zoom, dispatch, sheetIndex]);

  const onMouseUp = useCallback(() => {
    isPanningRef.current = false;
    setIsPanning(false);
  }, []);

  // Keep onClick as a no-op guard (prevents selection during tool mode)
  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (activeToolRef.current) e.stopPropagation();
  }, []);

  // ── Context menu builders ──────────────────────────────────────────────

  const openComponentCtx = (e: React.MouseEvent, comp: Component) => {
    e.preventDefault(); e.stopPropagation();
    dispatch({ type: 'SELECT_ELEMENT', elementId: comp.id, layer: 'schematic' });
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      sections: [
        { items: [
          { icon: '↗', label: 'Select',     onClick: () => dispatch({ type: 'SELECT_ELEMENT', elementId: comp.id, layer: 'schematic' }) },
          { icon: '⎘', label: 'Copy',       shortcut: 'Ctrl+C', onClick: () => dispatch({ type: 'COPY_ELEMENT' }) },
        ]},
        { items: [
          { icon: '↻', label: 'Rotate 90°', onClick: () => {
            // Update rotation in-place
            dispatch({ type: 'SELECT_ELEMENT', elementId: comp.id, layer: 'schematic' });
            // Rotation is handled visually; fire AI chip for now
            window.dispatchEvent(new CustomEvent('ai-chip', { detail: `Rotate component ${comp.ref} by 90 degrees` }));
          }},
          { icon: '✎', label: 'Properties', onClick: () => window.dispatchEvent(new CustomEvent('ai-chip', { detail: `Show properties of component ${comp.ref}` })) },
        ]},
        { items: [
          { icon: '✕', label: 'Delete', danger: true, shortcut: 'Del',
            onClick: () => dispatch({ type: 'DELETE_ELEMENT', elementId: comp.id }) },
        ]},
      ],
    });
  };

  const openWireCtx = (e: React.MouseEvent, wire: WireSegment) => {
    e.preventDefault(); e.stopPropagation();
    dispatch({ type: 'SELECT_ELEMENT', elementId: wire.id, layer: 'schematic' });
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      sections: [
        { items: [
          { icon: '↗', label: 'Select',       onClick: () => dispatch({ type: 'SELECT_ELEMENT', elementId: wire.id, layer: 'schematic' }) },
          { icon: '⎘', label: 'Copy',         shortcut: 'Ctrl+C', onClick: () => dispatch({ type: 'COPY_ELEMENT' }) },
          { icon: '✎', label: 'Properties',   onClick: () => window.dispatchEvent(new CustomEvent('ai-chip', { detail: `Show properties of wire ${wire.label}` })) },
        ]},
        { items: [
          { icon: '✕', label: 'Delete',       danger: true, shortcut: 'Del',
            onClick: () => dispatch({ type: 'DELETE_ELEMENT', elementId: wire.id }) },
        ]},
      ],
    });
  };

  const openConnCtx = (e: React.MouseEvent, conn: ConnectorShell) => {
    e.preventDefault(); e.stopPropagation();
    dispatch({ type: 'SELECT_ELEMENT', elementId: conn.id, layer: 'schematic' });
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      sections: [
        { items: [
          { icon: '↗', label: 'Select',       onClick: () => dispatch({ type: 'SELECT_ELEMENT', elementId: conn.id, layer: 'schematic' }) },
          { icon: '⎘', label: 'Copy',         shortcut: 'Ctrl+C', onClick: () => dispatch({ type: 'COPY_ELEMENT' }) },
          { icon: '→', label: 'Navigate → Harness', onClick: () => dispatch({ type: 'NAVIGATE_TO', layer: 'harness', elementId: conn.id, label: `Conn: ${conn.ref}` }) },
          { icon: '✎', label: 'Properties',   onClick: () => window.dispatchEvent(new CustomEvent('ai-chip', { detail: `Show properties of connector ${conn.ref}` })) },
        ]},
        { items: [
          { icon: '✕', label: 'Delete',       danger: true, shortcut: 'Del',
            onClick: () => dispatch({ type: 'DELETE_ELEMENT', elementId: conn.id }) },
        ]},
      ],
    });
  };

  const openCanvasCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    if (activeToolRef.current) return; // don't show during placement
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      sections: [
        { items: [
          { icon: '⎗', label: 'Paste',        shortcut: 'Ctrl+V',
            disabled: !state.clipboard,
            onClick: () => {
              const { x, y } = toCanvasXY(e.clientX, e.clientY);
              dispatch({ type: 'PASTE_ELEMENT', x, y, sheetIndex });
            }},
          { icon: '⊡', label: 'Select All',   shortcut: 'Ctrl+A',
            onClick: () => window.dispatchEvent(new CustomEvent('ai-chip', { detail: 'List all components on this sheet' })) },
        ]},
        { items: [
          { icon: '⊕', label: 'Zoom In',      shortcut: '+', onClick: () => setZoom(z => Math.min(8, z * 1.3)) },
          { icon: '⊖', label: 'Zoom Out',     shortcut: '-', onClick: () => setZoom(z => Math.max(0.2, z * 0.77)) },
          { icon: '⊡', label: 'Fit to Sheet', onClick: () => { setZoom(0.85); setPan({ x: 40, y: 40 }); } },
        ]},
        { items: [
          { icon: '✦', label: 'AI: Add component here', onClick: () => window.dispatchEvent(new CustomEvent('ai-chip', { detail: 'Add a circuit breaker to this schematic' })) },
        ]},
      ],
    });
  };

  const sheetEl = (s?: typeof sheet) => (
    <DrawingSheet
      width={SCH_W} height={SCH_H}
      layer="schematic"
      title={s?.title || tb.drawing_title || ''}
      drawingNumber={tb.drawing_number || ''}
      revision={tb.revision || 'A'}
      ataChapter={tb.ata_chapter || ''}
      aircraftType={tb.aircraft_type || ''}
      standard={tb.standard || ''}
      drawnBy={tb.drawn_by || ''}
    />
  );

  const cursor = activeTool ? 'crosshair' : isPanning ? 'grabbing' : 'default';

  function zoomControls() {
    return (
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button onClick={() => setZoom(z => Math.min(8, z * 1.2))}
          className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-lg rounded hover:bg-aero-border">+</button>
        <button onClick={() => setZoom(1)}
          className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-xs rounded hover:bg-aero-border">1:1</button>
        <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))}
          className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-lg rounded hover:bg-aero-border">−</button>
      </div>
    );
  }

  const canvas = (content: React.ReactNode) => (
    <div className="w-full h-full bg-[#0d1117] relative overflow-hidden select-none"
      onWheel={onWheel} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <svg ref={svgRef} className="w-full h-full" style={{ cursor }}
        onMouseDown={onMouseDown} onClick={onCanvasClick}
        onContextMenu={openCanvasCtx}>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {content}
          {/* Ghost preview */}
          {activeTool && ghostPos && (
            <ToolGhost
              x={ghostPos.x} y={ghostPos.y}
              toolType={activeTool.type}
              pendingStart={activeTool.pendingStart}
            />
          )}
        </g>
      </svg>
      {zoomControls()}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          sections={ctxMenu.sections}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );

  if (!sheet) {
    return canvas(
      <>
        {sheetEl()}
        <text x={SCH_W/2} y={SCH_H/2 - 80}
          fill="#2e3d52" fontSize={14} fontFamily="Inter,sans-serif" textAnchor="middle">
          {activeTool ? `Click to place: ${activeTool.label}` : 'Blank drawing — use the Insert tab to add components'}
        </text>
        <text x={SCH_W/2} y={SCH_H/2 - 60}
          fill="#263045" fontSize={11} fontFamily="JetBrains Mono,monospace" textAnchor="middle">
          or drop a DXF / PDF file into the Explorer sidebar to import
        </text>
      </>
    );
  }

  return (
    <div className="w-full h-full bg-[#0d1117] relative overflow-hidden select-none"
      onWheel={onWheel} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <svg ref={svgRef} className="w-full h-full" style={{ cursor }}
        onMouseDown={onMouseDown} onClick={onCanvasClick}
        onContextMenu={openCanvasCtx}>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {sheetEl(sheet)}

          {/* Wires */}
          {sheet.wires.map(wire => (
            <g key={wire.id} onContextMenu={(e) => openWireCtx(e, wire)}>
              <WireLine
                wire={wire}
                selected={state.selectedElementId === wire.id}
                onClick={() => {
                  if (activeTool) return;
                  dispatch({ type: 'SELECT_ELEMENT', elementId: wire.id, layer: 'schematic' });
                }}
              />
            </g>
          ))}

          {/* Components */}
          {sheet.components.map(comp => (
            <g key={comp.id}
              onClick={(e) => { if (activeTool) return; e.stopPropagation(); dispatch({ type: 'SELECT_ELEMENT', elementId: comp.id, layer: 'schematic' }); }}
              onContextMenu={(e) => openComponentCtx(e, comp)}
              style={{ cursor: activeTool ? 'crosshair' : 'pointer' }}>
              <ComponentSymbol comp={comp} selected={state.selectedElementId === comp.id} />
            </g>
          ))}

          {/* Connectors */}
          {sheet.connectors.map(conn => (
            <g key={conn.id} onContextMenu={(e) => openConnCtx(e, conn)}>
              <ConnectorBlock
                conn={conn}
                selected={state.selectedElementId === conn.id}
                onClick={() => {
                  if (activeTool) return;
                  dispatch({ type: 'SELECT_ELEMENT', elementId: conn.id, layer: 'schematic' });
                }}
              />
            </g>
          ))}

          {/* Ghost preview */}
          {activeTool && ghostPos && (
            <ToolGhost
              x={ghostPos.x} y={ghostPos.y}
              toolType={activeTool.type}
              pendingStart={activeTool.pendingStart}
            />
          )}
        </g>
      </svg>

      {/* Sheet selector */}
      {sheets.length > 1 && (
        <div className="absolute top-2 left-2 flex gap-1">
          {sheets.map(s => (
            <button key={s.number}
              className={`px-2 py-1 text-xs rounded border font-mono ${
                s.number === currentSheet
                  ? 'bg-aero-accent text-aero-dark border-aero-accent'
                  : 'bg-aero-panel text-gray-400 border-aero-border hover:border-aero-accent'
              }`}
              onClick={() => setCurrentSheet(s.number)}>
              Sheet {s.number}
            </button>
          ))}
        </div>
      )}

      {/* Sheet info badge */}
      <div className="absolute top-2 right-4 flex items-center gap-2">
        <span className="text-[10px] text-gray-600 font-mono bg-aero-dark/70 px-2 py-1 rounded border border-aero-border/30">
          {sheet.components.length} comp · {sheet.wires.length} wires · {sheet.connectors.length} conn
        </span>
      </div>

      {zoomControls()}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          sections={ctxMenu.sections}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
