import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { HarnessSheet, HarnessAssembly, WireRecord } from '../../types/project';
import { useApp } from '../../state/AppContext';
import DrawingSheet from './DrawingSheet';
import { useCanvasPalette } from '../../theme/canvasPalette';

interface Props {
  sheets: HarnessSheet[];
}

function WireTable({ wires, selectedId, onSelect }: {
  wires: WireRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="bg-aero-panel text-gray-400 sticky top-0">
            {['Wire No.', 'From', 'Pin', 'To', 'Pin', 'Length (m)', 'CS (mm²)', 'Color', 'Spec', 'Signal'].map(h => (
              <th key={h} className="px-2 py-1 text-left border-b border-aero-border whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {wires.map(wr => (
            <tr
              key={wr.id}
              className={`border-b border-aero-border/30 cursor-pointer hover:bg-aero-border/20 ${
                selectedId === wr.id ? 'bg-aero-accent/10 border-aero-accent/30' : ''
              }`}
              onClick={() => onSelect(wr.id)}
            >
              <td className="px-2 py-1 text-aero-accent">{wr.wire_label}</td>
              <td className="px-2 py-1">{wr.from_connector}</td>
              <td className="px-2 py-1 text-gray-400">{wr.from_pin}</td>
              <td className="px-2 py-1">{wr.to_connector}</td>
              <td className="px-2 py-1 text-gray-400">{wr.to_pin}</td>
              <td className="px-2 py-1 text-aero-green">{wr.length_m?.toFixed(2) ?? '—'}</td>
              <td className="px-2 py-1">{wr.cross_section_mm2 ?? '—'}</td>
              <td className="px-2 py-1 text-aero-yellow">{wr.color || '—'}</td>
              <td className="px-2 py-1 text-gray-400 max-w-32 truncate">{wr.material_spec || '—'}</td>
              <td className="px-2 py-1 text-gray-500">{wr.signal_type}</td>
            </tr>
          ))}
          {wires.length === 0 && (
            <tr><td colSpan={10} className="px-2 py-4 text-center text-gray-600">No wire records</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HarnessTrunk({ assembly, selectedId, onWireSelect }: {
  assembly: HarnessAssembly;
  selectedId: string | null;
  onWireSelect: (id: string) => void;
}) {
  const p = useCanvasPalette();
  const SVG_W = 600;
  const SVG_H = 120;
  const trunkY = 60;
  const trunkX0 = 40;
  const trunkX1 = 560;
  const numBreakouts = assembly.breakouts.length;

  return (
    <svg width={SVG_W} height={SVG_H} className="block">
      {/* Trunk */}
      <line x1={trunkX0} y1={trunkY} x2={trunkX1} y2={trunkY}
        stroke={p.trunkStroke} strokeWidth="6" strokeLinecap="round" />

      {/* Left connector */}
      <circle cx={trunkX0} cy={trunkY} r="10" fill="none" stroke={p.accentStroke} strokeWidth="2" />
      {assembly.wires[0] && (
        <text x={trunkX0} y={trunkY + 22} textAnchor="middle" fill={p.mutedText} fontSize="9" fontFamily="JetBrains Mono, monospace">
          {assembly.wires[0].from_connector}
        </text>
      )}

      {/* Right connector */}
      <circle cx={trunkX1} cy={trunkY} r="10" fill="none" stroke={p.accentStroke} strokeWidth="2" />
      {assembly.wires[0] && (
        <text x={trunkX1} y={trunkY + 22} textAnchor="middle" fill={p.mutedText} fontSize="9" fontFamily="JetBrains Mono, monospace">
          {assembly.wires[0].to_connector}
        </text>
      )}

      {/* Assembly label */}
      <text x={(trunkX0 + trunkX1) / 2} y={trunkY - 16} textAnchor="middle"
        fill={p.symbolText} fontSize="11" fontFamily="Inter" fontWeight="600">
        {assembly.assembly_number}
        {assembly.airframe_zone && ` — ${assembly.airframe_zone}`}
      </text>

      {/* Breakouts */}
      {assembly.breakouts.map((bk, i) => {
        const bx = trunkX0 + (trunkX1 - trunkX0) * (i + 1) / (numBreakouts + 1);
        return (
          <g key={bk.id}>
            <line x1={bx} y1={trunkY} x2={bx} y2={trunkY + 40}
              stroke={p.mutedText} strokeWidth="2" strokeDasharray="4,2" />
            <text x={bx} y={trunkY + 52} textAnchor="middle" fill={p.mutedText}
              fontSize="8" fontFamily="JetBrains Mono, monospace">
              {bk.ref}
            </text>
          </g>
        );
      })}

      {/* Routing codes */}
      {assembly.routing_codes.slice(0, 3).map((code, i) => (
        <text key={code} x={trunkX0 + 20 + i * 80} y={trunkY + 14}
          fill={p.mutedText} fontSize="7" fontFamily="Inter">{code}</text>
      ))}
    </svg>
  );
}

const HRN_W = 1587;  // A2 landscape ~= 594mm → ~1587px
const HRN_H = 1123;

export default function HarnessCanvas({ sheets }: Props) {
  const { state, dispatch } = useApp();
  const p = useCanvasPalette();
  const [activeAssemblyIdx, setActiveAssemblyIdx] = useState(0);
  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  const tb = (state.project as any)?.title_block ?? {};

  // canvas-zoom events from Ribbon View tab
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === 'in')    setZoom(z => Math.min(4, z * 1.3));
      if (action === 'out')   setZoom(z => Math.max(0.2, z * 0.77));
      if (action === 'reset') { setZoom(1); setPan({ x: 40, y: 40 }); }
      if (action === 'fit')   { setZoom(0.7); setPan({ x: 40, y: 40 }); }
    };
    window.addEventListener('canvas-zoom', handler);
    return () => window.removeEventListener('canvas-zoom', handler);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.2, Math.min(4, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  }, []);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.altKey) {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  }, [pan]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  }, [isPanning]);
  const onMouseUp = useCallback(() => setIsPanning(false), []);

  const sheet = sheets[0];

  const sheetFrame = (title = '') => (
    <DrawingSheet
      width={HRN_W} height={HRN_H}
      layer="harness"
      title={title || tb.drawing_title || ''}
      drawingNumber={tb.drawing_number || ''}
      revision={tb.revision || 'A'}
      ataChapter={tb.ata_chapter || ''}
      aircraftType={tb.aircraft_type || ''}
      standard={tb.standard || 'MIL-STD-454 / ASME Y14.44'}
      drawnBy={tb.drawn_by || ''}
      zoneColumns={12} zoneRows={8}
    />
  );

  if (!sheet) {
    return (
      <div className="w-full h-full bg-aero-dark relative overflow-hidden select-none"
        onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
        <svg className="w-full h-full" style={{ cursor: isPanning ? 'grabbing' : 'default' }}>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {sheetFrame()}
            <text x={HRN_W/2} y={HRN_H/2 - 80}
              fill={p.emptyTitle} fontSize={14} fontFamily="Inter,sans-serif" textAnchor="middle">
              Blank harness drawing — use the Draw tab to add harness elements
            </text>
            <text x={HRN_W/2} y={HRN_H/2 - 58}
              fill={p.emptySubtitle} fontSize={11} fontFamily="JetBrains Mono,monospace" textAnchor="middle">
              or drop a DXF / PDF file into the Explorer sidebar to import
            </text>
          </g>
        </svg>
        {/* Zoom */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1">
          <button onClick={() => setZoom(z => Math.min(4, z * 1.2))} className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-lg rounded hover:bg-aero-border">+</button>
          <button onClick={() => setZoom(0.7)} className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-xs rounded hover:bg-aero-border">fit</button>
          <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-lg rounded hover:bg-aero-border">−</button>
        </div>
      </div>
    );
  }

  const assembly = sheet.assemblies[activeAssemblyIdx];

  const handleWireSelect = (id: string) => {
    dispatch({ type: 'NAVIGATE_TO', layer: 'schematic', elementId: id, label: `Wire → L2` });
  };

  if (!assembly) {
    return (
      <div className="w-full h-full bg-aero-dark relative overflow-hidden select-none"
        onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
        <svg className="w-full h-full" style={{ cursor: isPanning ? 'grabbing' : 'default' }}>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {sheetFrame(sheet.title)}
          </g>
        </svg>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-aero-dark flex flex-col overflow-hidden"
      onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      {/* Drawing canvas (top 55%) */}
      <div className="relative overflow-hidden" style={{ flex: '0 0 55%' }}>
        <svg className="w-full h-full" style={{ cursor: isPanning ? 'grabbing' : 'default' }}>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {sheetFrame(sheet.title)}
            {/* Harness assembly content — offset into drawing area */}
            <g transform="translate(60, 60)">
              <HarnessTrunk
                assembly={assembly}
                selectedId={state.selectedElementId}
                onWireSelect={handleWireSelect}
              />
            </g>
          </g>
        </svg>
        {/* Zoom */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1">
          <button onClick={() => setZoom(z => Math.min(4, z * 1.2))} className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-lg rounded hover:bg-aero-border">+</button>
          <button onClick={() => setZoom(0.7)} className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-xs rounded hover:bg-aero-border">fit</button>
          <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} className="w-8 h-8 bg-aero-panel border border-aero-border text-white text-lg rounded hover:bg-aero-border">−</button>
        </div>
      </div>

      {/* ── Bottom section: tabs + wire table ── */}
      <div className="flex flex-col overflow-hidden border-t border-aero-border" style={{ flex: '1 1 45%' }}>
        {/* Assembly tabs */}
        {sheet.assemblies.length > 1 && (
          <div className="flex gap-1 px-3 pt-2 border-b border-aero-border shrink-0">
            {sheet.assemblies.map((asm, i) => (
              <button key={asm.id}
                className={`px-3 py-1 text-xs rounded-t font-mono ${
                  i === activeAssemblyIdx
                    ? 'bg-aero-panel text-aero-accent border border-aero-border'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
                onClick={() => setActiveAssemblyIdx(i)}>
                {asm.assembly_number || `Assembly ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* Stats bar */}
        <div className="px-4 py-1.5 border-b border-aero-border flex gap-6 text-[10px] text-gray-500 font-mono shrink-0">
          <span>{assembly.wires.length} wires</span>
          <span>{assembly.connectors.length} connectors</span>
          <span>{assembly.splices.length} splices</span>
          {assembly.overall_length_m && <span>{assembly.overall_length_m.toFixed(1)}m total</span>}
          {assembly.sleeving_spec && <span>Sleeving: {assembly.sleeving_spec}</span>}
        </div>

        {/* Wire list table */}
        <div className="flex-1 overflow-auto">
          <WireTable
            wires={assembly.wires}
            selectedId={state.selectedElementId}
            onSelect={handleWireSelect}
          />
        </div>
      </div>
    </div>
  );
}
