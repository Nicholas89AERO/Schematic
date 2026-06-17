/**
 * TemplatePreviewSVG — renders a scaled thumbnail of a drawing sheet template.
 *
 * Shows: sheet outline · inner border · zone markers · title block grid ·
 *        layer-specific placeholder scene (block diagram / schematic / harness)
 */
import React, { createContext, useContext } from 'react';
import type { DrawingLayer } from '../types/project';
import { useTheme } from '../theme/ThemeContext';

// ─── types ────────────────────────────────────────────────────────────────────

export interface TemplateProps {
  layer: DrawingLayer;
  sheetSize: string;
  orientation: 'landscape' | 'portrait';
  titleBlockHeightMm: number;
  borderMarginMm: number;
  zoneColumns: number;
  zoneRows: number;
  showZoneMarkers: boolean;
  showRevisionTable: boolean;
  showApprovalBlock: boolean;
  /** harness-only extras */
  showFormboardArea?: boolean;
  showWireListTable?: boolean;
  showConnectorDetails?: boolean;
}

// ─── sheet dimensions (mm) ─────────────────────────────────────────────────────

const SHEET_MM: Record<string, [number, number]> = {
  A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210],
};

// ─── colour palettes ──────────────────────────────────────────────────────────

const DARK_PALETTE = {
  bg:          '#131826',
  sheet:       '#1a2236',
  border:      '#2a3550',
  inner:       '#1e293b',
  zone:        '#2a3550',
  zoneText:    '#3d5070',
  titleBg:     '#111827',
  titleLine:   '#2a3550',
  titleText:   '#3d5070',
  blockFill:   '#1c2a42',
  l1Orange:    '#f59e0b',
  l2Blue:      '#00d4ff',
  l3Green:     '#22c55e',
  dim:         '#374151',
  dimText:     '#4b5563',
  accent:      '#6366f1',
};

const LIGHT_PALETTE = {
  bg:          '#f0f2f5',
  sheet:       '#ffffff',
  border:      '#c8d0d8',
  inner:       '#fafbfc',
  zone:        '#d0d7de',
  zoneText:    '#656d76',
  titleBg:     '#f6f8fa',
  titleLine:   '#d0d7de',
  titleText:   '#57606a',
  blockFill:   '#eef2f7',
  l1Orange:    '#f59e0b',
  l2Blue:      '#0969da',
  l3Green:     '#1a7f37',
  dim:         '#8c959f',
  dimText:     '#656d76',
  accent:      '#6366f1',
};

type Palette = typeof DARK_PALETTE;

const PaletteContext = createContext<Palette>(DARK_PALETTE);

function usePalette(): Palette {
  return useContext(PaletteContext);
}

// ─── arrowhead marker ─────────────────────────────────────────────────────────

function Defs() {
  const C = usePalette();
  return (
    <defs>
      <marker id="arr-bd" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
        <path d="M0,0 L5,2.5 L0,5 Z" fill={C.l1Orange} />
      </marker>
      <marker id="arr-sch" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
        <path d="M0,0 L5,2.5 L0,5 Z" fill={C.l2Blue} />
      </marker>
      <marker id="arr-hrn" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
        <path d="M0,0 L5,2.5 L0,5 Z" fill={C.l3Green} />
      </marker>
    </defs>
  );
}

// ─── zone markers ─────────────────────────────────────────────────────────────

function ZoneMarkers({
  bx, by, bw, bh, cols, rows, markerW,
}: {
  bx: number; by: number; bw: number; bh: number;
  cols: number; rows: number; markerW: number;
}) {
  const C = usePalette();
  const colW = bw / cols;
  const rowH = bh / rows;
  const fs = Math.min(markerW * 0.45, 5);

  const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return (
    <g>
      {/* horizontal ticks top */}
      {Array.from({ length: cols }, (_, i) => (
        <g key={`ct${i}`}>
          <line x1={bx + colW * i} y1={by - markerW} x2={bx + colW * i} y2={by} stroke={C.zone} strokeWidth={0.5} />
          <text x={bx + colW * (i + 0.5)} y={by - markerW * 0.3} textAnchor="middle" dominantBaseline="middle"
            fill={C.zoneText} fontSize={fs} fontFamily="monospace">
            {colLetters[cols - 1 - i] || ''}
          </text>
        </g>
      ))}
      {/* horizontal ticks bottom */}
      {Array.from({ length: cols }, (_, i) => (
        <text key={`cb${i}`} x={bx + colW * (i + 0.5)} y={by + bh + markerW * 0.7} textAnchor="middle" dominantBaseline="middle"
          fill={C.zoneText} fontSize={fs} fontFamily="monospace">
          {colLetters[cols - 1 - i] || ''}
        </text>
      ))}
      {/* vertical ticks left */}
      {Array.from({ length: rows }, (_, i) => (
        <g key={`rl${i}`}>
          <line x1={bx - markerW} y1={by + rowH * i} x2={bx} y2={by + rowH * i} stroke={C.zone} strokeWidth={0.5} />
          <text x={bx - markerW * 0.3} y={by + rowH * (i + 0.5)} textAnchor="middle" dominantBaseline="middle"
            fill={C.zoneText} fontSize={fs} fontFamily="monospace">
            {i + 1}
          </text>
        </g>
      ))}
      {/* vertical ticks right */}
      {Array.from({ length: rows }, (_, i) => (
        <text key={`rr${i}`} x={bx + bw + markerW * 0.7} y={by + rowH * (i + 0.5)} textAnchor="middle" dominantBaseline="middle"
          fill={C.zoneText} fontSize={fs} fontFamily="monospace">
          {i + 1}
        </text>
      ))}
    </g>
  );
}

// ─── title block ──────────────────────────────────────────────────────────────

function TitleBlock({
  tx, ty, tw, th,
  showRevision, showApproval,
}: {
  tx: number; ty: number; tw: number; th: number;
  showRevision: boolean; showApproval: boolean;
}) {
  const C = usePalette();
  const fs = Math.min(th * 0.12, 4);
  // Divide width: title 35% | dwg# 20% | rev 10% | scale 10% | sheet 10% | std/approval 15%
  const cols = [tw*0.35, tw*0.20, tw*0.10, tw*0.10, tw*0.10, tw*0.15];
  const labels = ['TITLE', 'DRAWING NO.', 'REV', 'SCALE', 'SHEET', 'STANDARD'];
  let cx = tx;
  return (
    <g>
      <rect x={tx} y={ty} width={tw} height={th} fill={C.titleBg} />
      <rect x={tx} y={ty} width={tw} height={th} fill="none" stroke={C.titleLine} strokeWidth={0.8} />
      {/* top row: labels */}
      {cols.map((cw, i) => {
        const x = cx;
        const r = (
          <g key={i}>
            <line x1={x} y1={ty} x2={x} y2={ty + th} stroke={C.titleLine} strokeWidth={0.5} />
            <text x={x + 2} y={ty + fs + 1.5} fill={C.titleText} fontSize={fs * 0.75} fontFamily="monospace"
              fontWeight="600">{labels[i]}</text>
            {/* mid line */}
            <line x1={x} y1={ty + th * 0.38} x2={x + cw} y2={ty + th * 0.38} stroke={C.titleLine} strokeWidth={0.3} />
          </g>
        );
        cx += cw;
        return r;
      })}
      {/* revision block on the right if enabled */}
      {showRevision && (
        <g>
          <rect x={tx + tw - tw*0.15} y={ty - th * 0.5} width={tw*0.15} height={th * 0.5}
            fill={C.titleBg} stroke={C.titleLine} strokeWidth={0.5} />
          <text x={tx + tw - tw*0.075} y={ty - th * 0.25} textAnchor="middle" dominantBaseline="middle"
            fill={C.titleText} fontSize={fs * 0.75} fontFamily="monospace">REV TABLE</text>
        </g>
      )}
    </g>
  );
}

// ─── layer scenes ─────────────────────────────────────────────────────────────

/** L1 Block Diagram scene */
function BlockDiagramScene({ cx, cy, cw, ch }: { cx:number; cy:number; cw:number; ch:number }) {
  const C = usePalette();
  const bw = cw * 0.14, bh = ch * 0.16;
  const boxes = [
    { x: cx + cw*0.04, y: cy + ch*0.28, lbl: 'SENSOR' },
    { x: cx + cw*0.26, y: cy + ch*0.12, lbl: 'LRU A' },
    { x: cx + cw*0.26, y: cy + ch*0.44, lbl: 'LRU B' },
    { x: cx + cw*0.52, y: cy + ch*0.12, lbl: 'LRU C' },
    { x: cx + cw*0.52, y: cy + ch*0.44, lbl: 'LRU D' },
    { x: cx + cw*0.76, y: cy + ch*0.28, lbl: 'OUTPUT' },
  ];
  const busY = cy + ch * 0.76;
  const busDrops = [0.33, 0.60];
  const fs = Math.min(bw * 0.22, 5);

  return (
    <g>
      {/* +28V Power bus */}
      <line x1={cx + cw*0.04} y1={busY} x2={cx + cw*0.92} y2={busY}
        stroke={C.l1Orange} strokeWidth={2.2} />
      <text x={cx + cw*0.05} y={busY - 3} fill={C.l1Orange} fontSize={fs*0.85} fontFamily="monospace">+28VDC BUS</text>
      {/* bus drop lines */}
      {busDrops.map((xf, i) => (
        <line key={i} x1={cx + cw*xf + bw/2} y1={busY} x2={cx + cw*xf + bw/2} y2={cy + ch*0.60 + bh}
          stroke={C.l1Orange} strokeWidth={0.6} strokeDasharray="2,1" />
      ))}

      {/* signal path lines */}
      {/* sensor → A, sensor → B */}
      <line x1={boxes[0].x + bw} y1={boxes[0].y + bh/2} x2={boxes[1].x} y2={boxes[1].y + bh/2}
        stroke={C.l1Orange} strokeWidth={0.8} markerEnd="url(#arr-bd)" />
      <line x1={boxes[0].x + bw/2} y1={boxes[0].y + bh} x2={boxes[2].x + bw/2} y2={boxes[2].y}
        stroke={C.l1Orange} strokeWidth={0.8} markerEnd="url(#arr-bd)" />
      {/* A → C, B → D */}
      <line x1={boxes[1].x + bw} y1={boxes[1].y + bh/2} x2={boxes[3].x} y2={boxes[3].y + bh/2}
        stroke={C.l1Orange} strokeWidth={0.8} markerEnd="url(#arr-bd)" />
      <line x1={boxes[2].x + bw} y1={boxes[2].y + bh/2} x2={boxes[4].x} y2={boxes[4].y + bh/2}
        stroke={C.l1Orange} strokeWidth={0.8} markerEnd="url(#arr-bd)" />
      {/* C,D → output */}
      <line x1={boxes[3].x + bw} y1={boxes[3].y + bh/2} x2={boxes[5].x} y2={boxes[5].y + bh/2 - ch*0.08}
        stroke={C.l1Orange} strokeWidth={0.8} markerEnd="url(#arr-bd)" />
      <line x1={boxes[4].x + bw} y1={boxes[4].y + bh/2} x2={boxes[5].x} y2={boxes[5].y + bh/2 + ch*0.08}
        stroke={C.l1Orange} strokeWidth={0.8} markerEnd="url(#arr-bd)" />

      {/* boxes */}
      {boxes.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={bw} height={bh}
            fill={C.blockFill} stroke={C.l1Orange} strokeWidth={0.7} rx={1.5} />
          <text x={b.x + bw/2} y={b.y + bh/2 + fs*0.35} fill="#d1a04a"
            fontSize={fs} fontFamily="monospace" textAnchor="middle">{b.lbl}</text>
        </g>
      ))}

      {/* redundancy annotation */}
      <text x={cx + cw*0.36} y={cy + ch*0.04} fill={C.dimText} fontSize={fs*0.8} fontFamily="monospace">
        DUAL CHANNEL ARCHITECTURE
      </text>
      <line x1={cx + cw*0.30} y1={cy + ch*0.06} x2={cx + cw*0.67} y2={cy + ch*0.06}
        stroke={C.dimText} strokeWidth={0.4} strokeDasharray="3,2" />
    </g>
  );
}

/** L2 Schematic scene */
function SchematicScene({ cx, cy, cw, ch }: { cx:number; cy:number; cw:number; ch:number }) {
  const C = usePalette();
  const fs = Math.min(cw * 0.035, 4.5);
  const wireColor = C.l2Blue;
  const symColor  = '#7dd3fc';

  // Power rail top
  const railY = cy + ch * 0.08;
  const gndY  = cy + ch * 0.82;

  // Three parallel circuits side by side
  const circuits = [
    { x: cx + cw*0.12, lbl: 'CB1\n5A' },
    { x: cx + cw*0.40, lbl: 'CB2\n10A' },
    { x: cx + cw*0.68, lbl: 'CB3\n15A' },
  ];

  const cbH = ch * 0.10, cbW = cw * 0.06;
  const swH = ch * 0.10, swW = cw * 0.06;
  const loadH = ch * 0.14, loadW = cw * 0.08;

  return (
    <g>
      {/* Power rail */}
      <line x1={cx + cw*0.05} y1={railY} x2={cx + cw*0.95} y2={railY}
        stroke={wireColor} strokeWidth={2} />
      <text x={cx + cw*0.05} y={railY - 3} fill={wireColor} fontSize={fs} fontFamily="monospace">+28VDC</text>

      {/* Ground rail */}
      <line x1={cx + cw*0.05} y1={gndY} x2={cx + cw*0.95} y2={gndY}
        stroke={C.dim} strokeWidth={1.5} />
      {/* ground symbol lines */}
      {[0.2, 0.5, 0.8].map(xf => (
        <g key={xf}>
          <line x1={cx+cw*xf - cw*0.02} y1={gndY} x2={cx+cw*xf + cw*0.02} y2={gndY} stroke={C.dim} strokeWidth={1} />
          <line x1={cx+cw*xf - cw*0.013} y1={gndY+2} x2={cx+cw*xf + cw*0.013} y2={gndY+2} stroke={C.dim} strokeWidth={0.8} />
          <line x1={cx+cw*xf - cw*0.006} y1={gndY+4} x2={cx+cw*xf + cw*0.006} y2={gndY+4} stroke={C.dim} strokeWidth={0.6} />
        </g>
      ))}
      <text x={cx + cw*0.05} y={gndY + 7} fill={C.dimText} fontSize={fs*0.8} fontFamily="monospace">GND</text>

      {/* Per-circuit elements */}
      {circuits.map((ckt, i) => {
        const dropX = ckt.x;
        const cbY = railY + ch*0.08;
        const swY  = cbY + cbH + ch*0.06;
        const ldY  = swY + swH + ch*0.06;

        return (
          <g key={i}>
            {/* drop line from rail */}
            <line x1={dropX} y1={railY} x2={dropX} y2={cbY} stroke={wireColor} strokeWidth={0.7} />

            {/* Circuit breaker box */}
            <rect x={dropX - cbW/2} y={cbY} width={cbW} height={cbH}
              fill="#162032" stroke={symColor} strokeWidth={0.7} />
            {/* CB diagonal */}
            <line x1={dropX - cbW/2 + 1} y1={cbY + cbH - 1} x2={dropX + cbW/2 - 1} y2={cbY + 1}
              stroke={symColor} strokeWidth={0.5} />
            <text x={dropX} y={cbY + cbH + 3} fill={C.dimText} fontSize={fs*0.75} fontFamily="monospace" textAnchor="middle">
              {ckt.lbl.split('\n')[0]}
            </text>
            <text x={dropX} y={cbY + cbH + 3 + fs} fill={C.dimText} fontSize={fs*0.75} fontFamily="monospace" textAnchor="middle">
              {ckt.lbl.split('\n')[1]}
            </text>

            {/* wire cb → switch */}
            <line x1={dropX} y1={cbY + cbH} x2={dropX} y2={swY} stroke={wireColor} strokeWidth={0.7} />

            {/* Switch symbol (NO contact) */}
            <circle cx={dropX} cy={swY + swH*0.15} r={1.2} fill="none" stroke={symColor} strokeWidth={0.6} />
            <line x1={dropX - swW/2} y1={swY + swH*0.15} x2={dropX - swW/5} y2={swY + swH*0.15}
              stroke={symColor} strokeWidth={0.6} />
            <line x1={dropX - swW/5} y1={swY + swH*0.15} x2={dropX + swW/3} y2={swY - swH*0.08}
              stroke={symColor} strokeWidth={0.6} />
            <line x1={dropX + swW/3} y1={swY + swH*0.15} x2={dropX + swW/2} y2={swY + swH*0.15}
              stroke={symColor} strokeWidth={0.6} />

            {/* wire sw → load */}
            <line x1={dropX} y1={swY + swH*0.35} x2={dropX} y2={ldY} stroke={wireColor} strokeWidth={0.7} />

            {/* Load box */}
            <rect x={dropX - loadW/2} y={ldY} width={loadW} height={loadH}
              fill="#162032" stroke={symColor} strokeWidth={0.6} />
            <text x={dropX} y={ldY + loadH/2 + fs*0.35} fill={symColor} fontSize={fs*0.8} fontFamily="monospace" textAnchor="middle">
              LOAD
            </text>

            {/* wire load → gnd */}
            <line x1={dropX} y1={ldY + loadH} x2={dropX} y2={gndY} stroke={wireColor} strokeWidth={0.7} />

            {/* connector P at top */}
            <rect x={dropX - cbW*0.35} y={railY - ch*0.055} width={cbW*0.7} height={ch*0.045}
              fill="#162032" stroke="#6366f1" strokeWidth={0.5} rx={0.8} />
            <text x={dropX} y={railY - ch*0.025} fill="#6366f1" fontSize={fs*0.7} fontFamily="monospace" textAnchor="middle">
              P{i+1}
            </text>
          </g>
        );
      })}

      {/* wire label strip */}
      <text x={cx + cw*0.60} y={cy + ch*0.38} fill={C.dimText} fontSize={fs*0.75} fontFamily="monospace">W24-01-003</text>
      <text x={cx + cw*0.60} y={cy + ch*0.38 + fs + 1} fill={C.dimText} fontSize={fs*0.75} fontFamily="monospace">22AWG WHT</text>
    </g>
  );
}

/** L3 Harness scene */
function HarnessScene({ cx, cy, cw, ch }: { cx:number; cy:number; cw:number; ch:number }) {
  const C = usePalette();
  const fs = Math.min(cw * 0.033, 4.5);
  const trunkColor = C.l3Green;
  const wireColor  = '#86efac';
  const cxColor    = '#a5f3fc';

  // Main trunk
  const trunkY   = cy + ch * 0.40;
  const trunkX1  = cx + cw * 0.06;
  const trunkX2  = cx + cw * 0.94;

  // Connector rectangles on left/right
  const cw2 = cw * 0.065, ch2 = ch * 0.22;
  const lCx = { x: trunkX1 - cw2, y: trunkY - ch2/2 };
  const rCx = { x: trunkX2,       y: trunkY - ch2/2 };

  // Breakout positions
  const breakouts = [
    { xf: 0.25, dir: -1, label: 'J101\n3-pin', pins: 3 },
    { xf: 0.50, dir:  1, label: 'J102\n5-pin', pins: 5 },
    { xf: 0.72, dir: -1, label: 'J103\n4-pin', pins: 4 },
  ];

  return (
    <g>
      {/* trunk shadow */}
      <line x1={trunkX1 + 1} y1={trunkY + 2} x2={trunkX2 + 1} y2={trunkY + 2}
        stroke="#000" strokeWidth={3.5} strokeOpacity={0.3} />
      {/* trunk */}
      <line x1={trunkX1} y1={trunkY} x2={trunkX2} y2={trunkY}
        stroke={trunkColor} strokeWidth={3} />
      <text x={cx + cw*0.43} y={trunkY + 6} fill={trunkColor} fontSize={fs*0.8} fontFamily="monospace">
        TRUNK W24-HRN-001
      </text>

      {/* Left connector */}
      <rect x={lCx.x} y={lCx.y} width={cw2} height={ch2}
        fill="#162032" stroke={cxColor} strokeWidth={0.8} rx={1} />
      <text x={lCx.x + cw2/2} y={lCx.y - 2} fill={cxColor} fontSize={fs*0.8} fontFamily="monospace" textAnchor="middle">P1</text>
      {Array.from({length: 4}, (_, i) => (
        <circle key={i} cx={lCx.x + cw2 - 2} cy={lCx.y + ch2*(0.15 + i*0.22)} r={1.5}
          fill={cxColor} fillOpacity={0.5} />
      ))}

      {/* Right connector */}
      <rect x={rCx.x} y={rCx.y} width={cw2} height={ch2}
        fill="#162032" stroke={cxColor} strokeWidth={0.8} rx={1} />
      <text x={rCx.x + cw2/2} y={rCx.y - 2} fill={cxColor} fontSize={fs*0.8} fontFamily="monospace" textAnchor="middle">J1</text>
      {Array.from({length: 4}, (_, i) => (
        <circle key={i} cx={rCx.x + 2} cy={rCx.y + ch2*(0.15 + i*0.22)} r={1.5}
          fill={cxColor} fillOpacity={0.5} />
      ))}

      {/* Breakout branches */}
      {breakouts.map((b, i) => {
        const bx  = trunkX1 + (trunkX2 - trunkX1) * b.xf;
        const byE = trunkY + b.dir * ch * 0.28;
        const bConn = { x: bx - cw*0.05, y: byE - (b.dir > 0 ? 0 : ch*0.14) };

        return (
          <g key={i}>
            {/* breakout line */}
            <line x1={bx} y1={trunkY} x2={bx} y2={byE}
              stroke={wireColor} strokeWidth={1.2} />
            {/* small circle at trunk junction */}
            <circle cx={bx} cy={trunkY} r={1.8} fill={trunkColor} />
            {/* connector box */}
            <rect x={bConn.x} y={bConn.y} width={cw*0.10} height={ch*0.14}
              fill="#162032" stroke={cxColor} strokeWidth={0.7} rx={1} />
            {/* pin dots */}
            {Array.from({length: b.pins > 3 ? 3 : b.pins}, (_, pi) => (
              <circle key={pi} cx={bConn.x + cw*0.10 * (pi+1)/(b.pins > 3 ? 3 : b.pins + 1)} cy={bConn.y + ch*0.07}
                r={1.2} fill={cxColor} fillOpacity={0.6} />
            ))}
            <text x={bConn.x + cw*0.05} y={bConn.y - 2} fill={cxColor} fontSize={fs*0.8} fontFamily="monospace" textAnchor="middle">
              {b.label.split('\n')[0]}
            </text>
            {/* wire number label */}
            <text x={bx + 2} y={trunkY + b.dir * ch * 0.12} fill={C.dimText}
              fontSize={fs*0.75} fontFamily="monospace">
              W{String(i+1).padStart(3,'0')}
            </text>
          </g>
        );
      })}

      {/* Wire list table (bottom-right area) */}
      {(() => {
        const tx = cx + cw*0.60, ty = cy + ch*0.62, tw2 = cw*0.35, th2 = ch*0.25;
        const cols2 = [tw2*0.18, tw2*0.18, tw2*0.16, tw2*0.14, tw2*0.18, tw2*0.16];
        const hdrs  = ['WIRE', 'FROM', 'TO', 'AWG', 'COLOUR', 'LEN'];
        return (
          <g>
            <rect x={tx} y={ty} width={tw2} height={th2} fill={C.titleBg} stroke={C.titleLine} strokeWidth={0.5} />
            {/* header row */}
            <rect x={tx} y={ty} width={tw2} height={th2*0.22} fill="#1a2540" />
            {(() => {
              let x = tx;
              return cols2.map((cW, ci) => {
                const r = (
                  <g key={ci}>
                    <line x1={x} y1={ty} x2={x} y2={ty+th2} stroke={C.titleLine} strokeWidth={0.3} />
                    <text x={x + cW/2} y={ty + th2*0.12} fill={C.zoneText} fontSize={fs*0.7} fontFamily="monospace" textAnchor="middle">{hdrs[ci]}</text>
                  </g>
                );
                x += cW;
                return r;
              });
            })()}
            {/* data rows */}
            {[0,1,2,3].map(ri => (
              <g key={ri}>
                <line x1={tx} y1={ty + th2*(0.22 + ri*0.195)} x2={tx+tw2} y2={ty + th2*(0.22 + ri*0.195)} stroke={C.titleLine} strokeWidth={0.3} />
                <rect x={tx+1} y={ty + th2*(0.22 + ri*0.195) + 0.5} width={tw2*0.14} height={th2*0.16} fill={C.l3Green} fillOpacity={0.08} rx={0.5} />
              </g>
            ))}
          </g>
        );
      })()}
    </g>
  );
}

// ─── main export ─────────────────────────────────────────────────────────────

export default function TemplatePreviewSVG({
  layer,
  sheetSize,
  orientation,
  titleBlockHeightMm,
  borderMarginMm,
  zoneColumns,
  zoneRows,
  showZoneMarkers,
  showRevisionTable,
  showApprovalBlock,
  showFormboardArea,
  showWireListTable,
  className,
  style,
}: TemplateProps & { className?: string; style?: React.CSSProperties }) {
  const { theme } = useTheme();
  const palette = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;

  // Work in a 600×424 canvas (normalised A3 landscape)
  const W = 600, H = 424;

  // Compute inner sheet dimensions from orientation
  const [smW, smH] = SHEET_MM[sheetSize] ?? SHEET_MM['A3'];
  const [mmW, mmH] = orientation === 'landscape'
    ? [Math.max(smW, smH), Math.min(smW, smH)]
    : [Math.min(smW, smH), Math.max(smW, smH)];

  // Scale mm → canvas px
  const scale = Math.min(W / mmW, H / mmH) * 0.92;

  // Sheet rect centred in canvas
  const shW = mmW * scale, shH = mmH * scale;
  const shX = (W - shW) / 2, shY = (H - shH) / 2;

  // Border margin & zone marker area
  const zm    = borderMarginMm * scale;
  const zmMk  = zm * 0.6;  // zone marker band width
  const bx    = shX + zm + zmMk;
  const by    = shY + zm + zmMk;
  const bw    = shW - 2*zm - 2*zmMk;
  const tbH   = titleBlockHeightMm * scale;
  const bh    = shH - 2*zm - 2*zmMk - tbH;

  // Content area
  const cx = bx, cy = by, cw = bw, ch = bh;

  return (
    <PaletteContext.Provider value={palette}>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      <Defs />

      {/* Canvas background */}
      <rect x={0} y={0} width={W} height={H} fill={palette.bg} />

      {/* Sheet */}
      <rect x={shX} y={shY} width={shW} height={shH} fill={palette.sheet} rx={1} />

      {/* Outer border */}
      <rect x={shX + zm*0.3} y={shY + zm*0.3}
        width={shW - zm*0.6} height={shH - zm*0.6}
        fill="none" stroke={palette.border} strokeWidth={0.8} />

      {/* Inner border */}
      <rect x={bx} y={by} width={bw} height={bh + tbH}
        fill={palette.inner} stroke={palette.border} strokeWidth={1} />

      {/* Zone markers */}
      {showZoneMarkers && (
        <ZoneMarkers
          bx={bx} by={by} bw={bw} bh={bh}
          cols={zoneColumns} rows={zoneRows} markerW={zmMk}
        />
      )}

      {/* Layer-specific scene */}
      {layer === 'block_diagram' && (
        <BlockDiagramScene cx={cx} cy={cy} cw={cw} ch={ch} />
      )}
      {layer === 'schematic' && (
        <SchematicScene cx={cx} cy={cy} cw={cw} ch={ch} />
      )}
      {layer === 'harness' && (
        <HarnessScene cx={cx} cy={cy} cw={cw} ch={ch} />
      )}

      {/* Grid dot pattern overlay — subtle */}
      <pattern id="dots" x={cx} y={cy} width={16} height={16} patternUnits="userSpaceOnUse">
        <circle cx={8} cy={8} r={0.5} fill={palette.border} fillOpacity={0.4} />
      </pattern>
      <rect x={cx} y={cy} width={cw} height={ch} fill="url(#dots)" fillOpacity={0.6} />

      {/* Approval block (top-right of title block area) */}
      {showApprovalBlock && (
        <g>
          <rect x={bx + bw*0.75} y={by + bh} width={bw*0.25} height={tbH}
            fill={palette.titleBg} stroke={palette.titleLine} strokeWidth={0.5} />
          {(['DRAWN','CHECKED','APPROVED'] as const).map((lbl, i) => (
            <g key={lbl}>
              <line x1={bx + bw*0.75} y1={by + bh + tbH*(0.33*(i+1))}
                x2={bx + bw} y2={by + bh + tbH*(0.33*(i+1))}
                stroke={palette.titleLine} strokeWidth={0.3} />
              <text x={bx + bw*0.755} y={by + bh + tbH*(0.33*i + 0.18)}
                fill={palette.titleText} fontSize={Math.min(tbH*0.10, 4)} fontFamily="monospace">{lbl}</text>
            </g>
          ))}
        </g>
      )}

      {/* Title block */}
      <TitleBlock
        tx={bx} ty={by + bh}
        tw={showApprovalBlock ? bw*0.75 : bw}
        th={tbH}
        showRevision={showRevisionTable}
        showApproval={showApprovalBlock}
      />

      {/* Sheet size badge */}
      <text x={shX + shW - 6} y={shY + 9}
        fill={palette.zoneText} fontSize={6} fontFamily="monospace" textAnchor="end">{sheetSize}</text>
    </svg>
    </PaletteContext.Provider>
  );
}
