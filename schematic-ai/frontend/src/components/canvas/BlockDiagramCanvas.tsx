import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockDiagram, LRUBlock, SignalPath, SignalType } from '../../types/project';
import { useApp } from '../../state/AppContext';
import DrawingSheet from './DrawingSheet';
import ToolGhost from './ToolGhosts';
import ContextMenu, { type MenuSection } from '../ContextMenu';

const SIGNAL_COLORS: Record<SignalType, string> = {
  power_dc:     '#f0883e',
  power_ac:     '#f85149',
  arinc429:     '#58a6ff',
  arinc664:     '#79c0ff',
  mil_std_1553: '#c9d1d9',
  discrete:     '#8b949e',
  analog:       '#3fb950',
  rs422:        '#d2a8ff',
  can:          '#ffa657',
  ground:       '#3fb950',
  unknown:      '#6e7681',
};

interface Props {
  blockDiagrams: BlockDiagram[];
}

export default function BlockDiagramCanvas({ blockDiagrams }: Props) {
  const { state, dispatch } = useApp();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sections: MenuSection[] } | null>(null);

  const activeTool = state.activeTool;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const isPanningRef = useRef(false);

  const BD_W = 1122;
  const BD_H = 794;
  const SHEET_GAP = 60;
  const tb = (state.project as any)?.title_block ?? {};

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
      if (action === 'in')    setZoom(z => Math.min(5, z * 1.3));
      if (action === 'out')   setZoom(z => Math.max(0.2, z * 0.77));
      if (action === 'reset') { setZoom(1); setPan({ x: 0, y: 0 }); }
      if (action === 'fit')   { setZoom(1); setPan({ x: 0, y: 0 }); }
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

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.2, Math.min(5, z * (e.deltaY < 0 ? 1.1 : 0.9))));
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
    if (e.button !== 0) return;
    const tool = activeToolRef.current;
    if (!tool) return;
    e.stopPropagation();
    const { x, y } = toCanvasXY(e.clientX, e.clientY);
    const twoPoint = ['power_bus', 'signal_path'].includes(tool.type);
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
          sheetIndex: 0,
        });
      }
    } else {
      dispatch({ type: 'PLACE_ELEMENT', toolType: tool.type, x, y, sheetIndex: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan, zoom, dispatch]);

  const onMouseUp = useCallback(() => {
    isPanningRef.current = false;
    setIsPanning(false);
  }, []);

  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (activeToolRef.current) e.stopPropagation();
  }, []);

  const handleLRUClick = (lru: LRUBlock) => {
    if (activeTool) return;
    dispatch({ type: 'NAVIGATE_TO', layer: 'schematic', elementId: lru.id, label: `${lru.ref} → L2` });
  };

  const handleSignalPathClick = (sp: SignalPath) => {
    if (activeTool) return;
    dispatch({ type: 'NAVIGATE_TO', layer: 'schematic', elementId: sp.id, label: `SP: ${sp.path_id}` });
  };

  const openLRUCtx = (e: React.MouseEvent, lru: LRUBlock) => {
    e.preventDefault(); e.stopPropagation();
    dispatch({ type: 'SELECT_ELEMENT', elementId: lru.id, layer: 'block_diagram' });
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      sections: [
        { items: [
          { icon: '→', label: 'Navigate → L2 Schematic', onClick: () => dispatch({ type: 'NAVIGATE_TO', layer: 'schematic', elementId: lru.id, label: `${lru.ref} → L2` }) },
          { icon: '⎘', label: 'Copy',      shortcut: 'Ctrl+C', onClick: () => dispatch({ type: 'COPY_ELEMENT' }) },
          { icon: '✎', label: 'Properties', onClick: () => window.dispatchEvent(new CustomEvent('ai-chip', { detail: `Show properties of LRU block ${lru.ref}` })) },
        ]},
        { items: [
          { icon: '✕', label: 'Delete',    danger: true, shortcut: 'Del', onClick: () => dispatch({ type: 'DELETE_ELEMENT', elementId: lru.id }) },
        ]},
      ],
    });
  };

  const openCanvasBDCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    if (activeToolRef.current) return;
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      sections: [
        { items: [
          { icon: '⎗', label: 'Paste',         shortcut: 'Ctrl+V',
            disabled: !state.clipboard,
            onClick: () => {
              const { x, y } = toCanvasXY(e.clientX, e.clientY);
              dispatch({ type: 'PASTE_ELEMENT', x, y, sheetIndex: 0 });
            }},
        ]},
        { items: [
          { icon: '⊕', label: 'Zoom In',       onClick: () => setZoom(z => Math.min(5, z * 1.3)) },
          { icon: '⊖', label: 'Zoom Out',      onClick: () => setZoom(z => Math.max(0.2, z * 0.77)) },
          { icon: '⊡', label: 'Fit to Sheet',  onClick: () => { setZoom(1); setPan({ x: 0, y: 0 }); } },
        ]},
        { items: [
          { icon: '✦', label: 'AI: Add LRU block here', onClick: () => window.dispatchEvent(new CustomEvent('ai-chip', { detail: 'Add a new LRU block to the block diagram' })) },
        ]},
      ],
    });
  };

  const cursor = activeTool ? 'crosshair' : isPanning ? 'grabbing' : 'default';

  return (
    <div className="w-full h-full bg-aero-dark relative overflow-hidden select-none"
      onWheel={onWheel}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {activeTool && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-aero-accent/20 border border-aero-accent/40 text-aero-accent text-xs font-mono px-3 py-1 rounded pointer-events-none">
          ✦ {activeTool.label} — click to place · ESC to cancel
        </div>
      )}
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ cursor }}
        onMouseDown={onMouseDown}
        onClick={onCanvasClick}
        onContextMenu={openCanvasBDCtx}
      >
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {blockDiagrams.map((bd, bdIdx) => (
            <g key={bdIdx} transform={`translate(0, ${bdIdx * (BD_H + SHEET_GAP)})`}>
              {/* Sheet frame — always visible, even on blank drawings */}
              <DrawingSheet
                width={BD_W} height={BD_H}
                layer="block_diagram"
                title={bd.title || tb.drawing_title || ''}
                drawingNumber={tb.drawing_number || ''}
                revision={tb.revision || 'A'}
                ataChapter={tb.ata_chapter || ''}
                aircraftType={tb.aircraft_type || ''}
                standard={tb.standard || ''}
                drawnBy={tb.drawn_by || ''}
              />

              {/* Power buses */}
              {bd.power_buses.map((bus: any) => {
                const pts = bus.waypoints?.map((p: any) => `${p.x},${p.y}`).join(' ') || '';
                if (!pts) return null;
                return (
                  <g key={bus.id}>
                    <polyline points={pts} fill="none" stroke="#f0883e" strokeWidth="6" strokeLinecap="round" />
                    {bus.waypoints?.length > 0 && (
                      <text
                        x={bus.waypoints[0].x}
                        y={bus.waypoints[0].y - 8}
                        fill="#f0883e"
                        fontSize="11"
                        fontFamily="mono"
                        fontWeight="600"
                      >
                        {bus.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Signal paths */}
              {bd.signal_paths.map(sp => {
                const color = SIGNAL_COLORS[sp.signal_type] || '#6e7681';
                const isSelected = state.selectedElementId === sp.id;

                // Build points list
                const fromLRU = bd.lru_blocks.find(l => l.id === sp.from_lru_id);
                const toLRU   = bd.lru_blocks.find(l => l.id === sp.to_lru_id);
                if (!fromLRU && !toLRU) return null;

                const pts: [number, number][] = [];
                if (fromLRU) pts.push([fromLRU.position.x + fromLRU.size[0] / 2, fromLRU.position.y]);
                sp.waypoints.forEach(w => pts.push([w.x, w.y]));
                if (toLRU)   pts.push([toLRU.position.x - toLRU.size[0] / 2, toLRU.position.y]);

                const ptsStr = pts.map(p => `${p[0]},${p[1]}`).join(' ');
                if (!ptsStr) return null;

                const midPt = pts[Math.floor(pts.length / 2)];
                const label = [sp.path_id, sp.voltage].filter(Boolean).join(' / ');

                return (
                  <g key={sp.id} onClick={() => handleSignalPathClick(sp)} style={{ cursor: 'pointer' }}>
                    <polyline
                      points={ptsStr}
                      fill="none"
                      stroke={color}
                      strokeWidth={isSelected ? 3 : 1.5}
                      strokeDasharray={sp.signal_type === 'discrete' ? '6,3' : undefined}
                      opacity={isSelected ? 1 : 0.8}
                    />
                    {/* Arrowhead at last point */}
                    {pts.length >= 2 && (() => {
                      const [x1, y1] = pts[pts.length - 2];
                      const [x2, y2] = pts[pts.length - 1];
                      const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                      return (
                        <polygon
                          points="0,-4 8,0 0,4"
                          fill={color}
                          transform={`translate(${x2},${y2}) rotate(${angle})`}
                        />
                      );
                    })()}
                    {midPt && label && (
                      <text
                        x={midPt[0]}
                        y={midPt[1] - 6}
                        fill={color}
                        fontSize="9"
                        fontFamily="JetBrains Mono, monospace"
                        textAnchor="middle"
                      >
                        {label}
                      </text>
                    )}
                    {/* Invisible wider hit area */}
                    <polyline points={ptsStr} fill="none" stroke="transparent" strokeWidth="12" />
                  </g>
                );
              })}

              {/* LRU Blocks */}
              {bd.lru_blocks.map(lru => {
                const [w, h] = lru.size;
                const cx = lru.position.x;
                const cy = lru.position.y;
                const x = cx - w / 2;
                const y = cy - h / 2;
                const isSelected = state.selectedElementId === lru.id;

                return (
                  <g key={lru.id}
                    onClick={() => handleLRUClick(lru)}
                    onContextMenu={(e) => openLRUCtx(e, lru)}
                    style={{ cursor: 'pointer' }}>
                    <rect
                      x={x} y={y} width={w} height={h}
                      rx="4" ry="4"
                      fill="#161b22"
                      stroke={isSelected ? '#58a6ff' : '#30363d'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    {/* Ref designator top-left */}
                    <text x={x + 4} y={y + 12} fill="#58a6ff" fontSize="9" fontFamily="JetBrains Mono, monospace" fontWeight="600">
                      {lru.ref}
                    </text>
                    {/* Name centred */}
                    <text x={cx} y={cy + 4} fill="#c9d1d9" fontSize="10" fontFamily="Inter" textAnchor="middle">
                      {lru.name || lru.ref}
                    </text>
                    {/* ATA chapter bottom-right */}
                    {lru.ata_chapter && (
                      <text x={x + w - 4} y={y + h - 4} fill="#8b949e" fontSize="8" fontFamily="Inter" textAnchor="end">
                        ATA {lru.ata_chapter}
                      </text>
                    )}
                    {/* Cross-ref indicator */}
                    {lru.cross_refs.length > 0 && (
                      <circle cx={x + w - 6} cy={y + 6} r="4" fill="#58a6ff" opacity="0.7" />
                    )}
                  </g>
                );
              })}
            </g>
          ))}

          {blockDiagrams.length === 0 && (
            <g>
              <DrawingSheet
                width={BD_W} height={BD_H}
                layer="block_diagram"
                title={tb.drawing_title || 'NEW BLOCK DIAGRAM'}
                drawingNumber={tb.drawing_number || ''}
                revision={tb.revision || 'A'}
                ataChapter={tb.ata_chapter || ''}
                aircraftType={tb.aircraft_type || ''}
                standard={tb.standard || ''}
                drawnBy={tb.drawn_by || ''}
              />
              <text x={BD_W/2} y={BD_H/2 - 90}
                fill="#2e3d52" fontSize={14} fontFamily="Inter,sans-serif"
                textAnchor="middle">
                {activeTool ? `Click to place: ${activeTool.label}` : 'Blank drawing — use the Insert tab to add blocks'}
              </text>
              <text x={BD_W/2} y={BD_H/2 - 68}
                fill="#263045" fontSize={11} fontFamily="JetBrains Mono,monospace"
                textAnchor="middle">
                or drop a DXF / PDF file into the Explorer sidebar to import
              </text>
            </g>
          )}

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

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button onClick={() => setZoom(z => Math.min(5, z * 1.2))}
          className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-lg rounded hover:bg-aero-border">+</button>
        <button onClick={() => setZoom(1)}
          className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-xs rounded hover:bg-aero-border">1:1</button>
        <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))}
          className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-lg rounded hover:bg-aero-border">−</button>
      </div>

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
