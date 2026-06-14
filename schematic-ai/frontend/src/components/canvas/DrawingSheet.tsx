/**
 * DrawingSheet — renders a full-size engineering drawing frame as an SVG group.
 *
 * Included in every canvas as the bottom-most layer. Draws:
 *   • Sheet background fill
 *   • Outer + inner border
 *   • Zone reference markers  (A–H across, 1–6 down)
 *   • Title block (bottom)  with approval block on the right
 *   • Revision history block (right edge, vertical)
 *   • Grid dot pattern
 *
 * The caller places it inside an SVG <g> that already has pan/zoom applied.
 * All coordinates are in SVG user-units (px).  One mm ≈ 3.78 px at 96dpi,
 * but here we use a fixed 1 unit = 1 px at the chosen sheet scale.
 */
import React from 'react';
import type { DrawingLayer } from '../../types/project';

// ─── props ────────────────────────────────────────────────────────────────────

export interface DrawingSheetProps {
  /** Width of the sheet in px (after applying scale). Default A3 landscape = 1122 */
  width?: number;
  /** Height of the sheet in px. Default A3 landscape = 794 */
  height?: number;
  /** Drawing title shown in title block */
  title?: string;
  /** Drawing number */
  drawingNumber?: string;
  /** Revision letter */
  revision?: string;
  /** ATA chapter */
  ataChapter?: string;
  /** Aircraft type */
  aircraftType?: string;
  /** Standard string */
  standard?: string;
  /** Drawn-by name */
  drawnBy?: string;
  /** Layer type — affects accent colour and layer badge */
  layer?: DrawingLayer;
  /** Number of zone columns (default 8) */
  zoneColumns?: number;
  /** Number of zone rows (default 6) */
  zoneRows?: number;
  /** Show grid dots */
  showGrid?: boolean;
}

// ─── constants ────────────────────────────────────────────────────────────────

const LAYER_COLOR: Record<DrawingLayer, string> = {
  block_diagram: '#f59e0b',
  schematic:     '#00d4ff',
  harness:       '#22c55e',
};
const LAYER_BADGE: Record<DrawingLayer, string> = {
  block_diagram: 'L1',
  schematic:     'L2',
  harness:       'L3',
};

// ─── component ────────────────────────────────────────────────────────────────

export default function DrawingSheet({
  width       = 1122,
  height      = 794,
  title       = '',
  drawingNumber = '',
  revision    = 'A',
  ataChapter  = '',
  aircraftType = '',
  standard    = '',
  drawnBy     = '',
  layer       = 'schematic',
  zoneColumns = 8,
  zoneRows    = 6,
  showGrid    = true,
}: DrawingSheetProps) {

  const accent   = LAYER_COLOR[layer];
  const badge    = LAYER_BADGE[layer];

  // Layout metrics
  const outerMargin = 16;          // space between sheet edge and outer border
  const zoneMargin  = 26;          // zone marker band width
  const innerMargin = outerMargin + zoneMargin;

  const titleH    = 88;            // title block height
  const approvalW = 140;           // approval block width (right side of title block)
  const revW      = 22;            // revision table strip on the right edge

  // Inner drawing area (where actual content lives)
  const drawX = innerMargin;
  const drawY = innerMargin;
  const drawW = width  - 2 * innerMargin - revW;
  const drawH = height - 2 * innerMargin - titleH;

  // Title block origin
  const tbX = drawX;
  const tbY = drawY + drawH;
  const tbW = drawW;

  // Zone cell sizes
  const colW = drawW / zoneColumns;
  const rowH = drawH / zoneRows;
  const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const fs  = 10;   // zone marker font size
  const fsT = 9;    // title block label font size
  const fsV = 11;   // title block value font size

  const patId = `grid-${layer}`;

  return (
    <g className="drawing-sheet" style={{ pointerEvents: 'none' }}>

      {/* ── Sheet background ── */}
      <rect x={0} y={0} width={width} height={height}
        fill="#111827" />

      {/* ── Outer border ── */}
      <rect
        x={outerMargin} y={outerMargin}
        width={width - 2*outerMargin} height={height - 2*outerMargin}
        fill="none" stroke="#2a3550" strokeWidth={1.2} />

      {/* ── Inner drawing-area border ── */}
      <rect
        x={drawX} y={drawY}
        width={drawW} height={drawH + titleH}
        fill="#141e30" stroke="#2a3550" strokeWidth={1.5} />

      {/* ── Grid dots ── */}
      {showGrid && (
        <>
          <defs>
            <pattern id={patId} x={drawX} y={drawY} width={20} height={20} patternUnits="userSpaceOnUse">
              <circle cx={10} cy={10} r={0.8} fill="#1e2d42" />
            </pattern>
          </defs>
          <rect x={drawX} y={drawY} width={drawW} height={drawH}
            fill={`url(#${patId})`} />
        </>
      )}

      {/* ── Zone column markers (top) ── */}
      {Array.from({ length: zoneColumns }, (_, i) => {
        const cx = drawX + colW * (i + 0.5);
        const letter = colLetters[zoneColumns - 1 - i] || '';
        return (
          <g key={`zt${i}`}>
            <line x1={drawX + colW * i} y1={drawY - zoneMargin}
                  x2={drawX + colW * i} y2={drawY}
              stroke="#263045" strokeWidth={0.6} />
            <text x={cx} y={drawY - zoneMargin * 0.45}
              fill="#3a4d64" fontSize={fs} fontFamily="JetBrains Mono,monospace"
              textAnchor="middle" dominantBaseline="middle">{letter}</text>
            {/* bottom repeat */}
            <text x={cx} y={tbY + titleH + zoneMargin * 0.55}
              fill="#3a4d64" fontSize={fs} fontFamily="JetBrains Mono,monospace"
              textAnchor="middle" dominantBaseline="middle">{letter}</text>
          </g>
        );
      })}

      {/* ── Zone row markers (left) ── */}
      {Array.from({ length: zoneRows }, (_, i) => {
        const cy = drawY + rowH * (i + 0.5);
        return (
          <g key={`zr${i}`}>
            <line x1={drawX - zoneMargin} y1={drawY + rowH * i}
                  x2={drawX}              y2={drawY + rowH * i}
              stroke="#263045" strokeWidth={0.6} />
            <text x={drawX - zoneMargin * 0.45} y={cy}
              fill="#3a4d64" fontSize={fs} fontFamily="JetBrains Mono,monospace"
              textAnchor="middle" dominantBaseline="middle">{i + 1}</text>
            {/* right repeat */}
            <text x={drawX + drawW + zoneMargin * 0.5} y={cy}
              fill="#3a4d64" fontSize={fs} fontFamily="JetBrains Mono,monospace"
              textAnchor="middle" dominantBaseline="middle">{i + 1}</text>
          </g>
        );
      })}

      {/* ── Center marks (fold marks) ── */}
      {([
        [width / 2, outerMargin,      width / 2, outerMargin + 6       ],
        [width / 2, height - outerMargin - 6, width / 2, height - outerMargin],
        [outerMargin, height / 2,     outerMargin + 6, height / 2      ],
        [width - outerMargin - 6, height / 2, width - outerMargin, height / 2],
      ] as [number,number,number,number][]).map(([x1,y1,x2,y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="#2a3550" strokeWidth={1} />
      ))}

      {/* ── Revision table strip (right edge) ── */}
      <rect x={drawX + drawW} y={drawY}
        width={revW} height={drawH}
        fill="#0f1623" stroke="#2a3550" strokeWidth={0.8} />
      <text
        x={drawX + drawW + revW / 2}
        y={drawY + 16}
        fill="#3a4d64" fontSize={8} fontFamily="JetBrains Mono,monospace"
        textAnchor="middle">REV</text>
      {/* Revision rows */}
      {[0,1,2,3,4].map(i => (
        <g key={i}>
          <line x1={drawX+drawW} y1={drawY + 30 + i*24}
                x2={drawX+drawW+revW} y2={drawY + 30 + i*24}
            stroke="#1e2d42" strokeWidth={0.5} />
          <text x={drawX+drawW+revW/2} y={drawY + 42 + i*24}
            fill="#263045" fontSize={8} fontFamily="JetBrains Mono,monospace"
            textAnchor="middle">{String.fromCharCode(65 + i)}</text>
        </g>
      ))}

      {/* ── Title block background ── */}
      <rect x={tbX} y={tbY} width={tbW} height={titleH}
        fill="#0d1520" stroke="#2a3550" strokeWidth={1} />

      {/* ── Title block vertical dividers ── */}
      {/* Layout: [Title 35%][DWG# 20%][Rev 8%][Scale 8%][Sheet 8%][Std 10%][Approval 11%] */}
      {(() => {
        const cols = [tbW*0.35, tbW*0.20, tbW*0.08, tbW*0.08, tbW*0.08, tbW*0.10, approvalW];
        const labels = ['TITLE','DRAWING No.','REV','SCALE','SHEET No.','STANDARD',''];
        const values = [title, drawingNumber, revision, '1:1', '1', standard, ''];
        let x = tbX;
        return cols.map((cw, i) => {
          const rx = x;
          x += cw;
          return (
            <g key={i}>
              <line x1={rx} y1={tbY} x2={rx} y2={tbY+titleH} stroke="#2a3550" strokeWidth={0.7} />
              <text x={rx + 4} y={tbY + 10}
                fill="#2e3d52" fontSize={fsT} fontFamily="JetBrains Mono,monospace"
                fontWeight="600">{labels[i]}</text>
              <line x1={rx} y1={tbY + 16} x2={rx + cw} y2={tbY + 16} stroke="#1a2436" strokeWidth={0.5} />
              <text x={rx + 4} y={tbY + 28}
                fill={i === 0 ? '#c0cfe0' : '#8096af'}
                fontSize={i === 0 ? fsV + 1 : fsV}
                fontFamily={i === 0 ? 'Inter,sans-serif' : 'JetBrains Mono,monospace'}
                fontWeight={i === 0 ? '600' : '400'}>{values[i]}</text>
            </g>
          );
        });
      })()}

      {/* ── Title block: second row ── */}
      <line x1={tbX} y1={tbY+titleH*0.5} x2={tbX+tbW*0.35} y2={tbY+titleH*0.5}
        stroke="#1a2436" strokeWidth={0.5} />
      {/* ATA chapter */}
      <text x={tbX + 4} y={tbY + titleH*0.5 + 10}
        fill="#2e3d52" fontSize={fsT} fontFamily="JetBrains Mono,monospace">ATA CHAPTER</text>
      <text x={tbX + 4} y={tbY + titleH*0.5 + 22}
        fill="#8096af" fontSize={fsV} fontFamily="JetBrains Mono,monospace">{ataChapter || '—'}</text>
      {/* Aircraft type */}
      <text x={tbX + tbW*0.12} y={tbY + titleH*0.5 + 10}
        fill="#2e3d52" fontSize={fsT} fontFamily="JetBrains Mono,monospace">AIRCRAFT TYPE</text>
      <text x={tbX + tbW*0.12} y={tbY + titleH*0.5 + 22}
        fill="#8096af" fontSize={fsV} fontFamily="JetBrains Mono,monospace">{aircraftType || '—'}</text>

      {/* ── Approval block ── */}
      {(() => {
        const ax  = tbX + tbW - approvalW;
        const rows = ['DRAWN','CHECKED','APPROVED'] as const;
        const vals = [drawnBy, '', ''];
        return rows.map((lbl, i) => {
          const ry = tbY + i * (titleH / 3);
          return (
            <g key={lbl}>
              <line x1={ax} y1={ry + titleH/3} x2={ax + approvalW} y2={ry + titleH/3}
                stroke="#2a3550" strokeWidth={0.5} />
              <text x={ax + 4} y={ry + 10}
                fill="#2e3d52" fontSize={fsT} fontFamily="JetBrains Mono,monospace">{lbl}</text>
              <text x={ax + 50} y={ry + 24}
                fill="#6b7e96" fontSize={fsV} fontFamily="JetBrains Mono,monospace">{vals[i]}</text>
              {/* vertical line between label and value */}
              <line x1={ax+46} y1={ry} x2={ax+46} y2={ry+titleH/3}
                stroke="#1a2436" strokeWidth={0.4} />
            </g>
          );
        });
      })()}

      {/* ── Layer badge (top-left corner of drawing area) ── */}
      <rect x={drawX + 4} y={drawY + 4} width={28} height={16} rx={3}
        fill={accent} fillOpacity={0.15} stroke={accent} strokeWidth={0.8} />
      <text x={drawX + 18} y={drawY + 13}
        fill={accent} fontSize={9} fontFamily="JetBrains Mono,monospace"
        fontWeight="700" textAnchor="middle">{badge}</text>

      {/* ── Sheet name (top-right of drawing area) ── */}
      <text x={drawX + drawW - 8} y={drawY + 14}
        fill="#2e3d52" fontSize={9} fontFamily="JetBrains Mono,monospace"
        textAnchor="end">{title || 'UNTITLED'}</text>

      {/* ── Compass/north mark in top-right corner ── */}
      <text x={width - outerMargin - 4} y={outerMargin + 12}
        fill="#263045" fontSize={8} fontFamily="JetBrains Mono,monospace"
        textAnchor="end">SchematicAI</text>

    </g>
  );
}
