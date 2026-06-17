/**
 * ToolGhosts — semi-transparent SVG previews that follow the cursor
 * during element placement mode. Each ghost matches the canvas symbol style.
 */
import React from 'react';
import type { ToolType } from '../../state/reducer';
import type { CanvasPalette } from '../../theme/canvasPalette';
import { useCanvasPalette } from '../../theme/canvasPalette';

interface GhostProps {
  /** cursor position in canvas (world) coordinates */
  x: number;
  y: number;
  /** for two-point tools: the first-click anchor */
  pendingStart?: { x: number; y: number };
  toolType: ToolType;
}

const ALPHA = 0.55;

// ─── individual ghost renderers ──────────────────────────────────────────────

function LRUGhost({ x, y, p }: { x: number; y: number; p: CanvasPalette }) {
  return (
    <g opacity={ALPHA}>
      <rect x={x - 60} y={y - 30} width={120} height={60} rx={4}
        fill={p.ghostFill} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5,3" />
      <text x={x} y={y - 6} textAnchor="middle" fill="#f59e0b" fontSize={10} fontFamily="JetBrains Mono,monospace" fontWeight="600">LRU</text>
      <text x={x} y={y + 8} textAnchor="middle" fill={p.ghostMuted} fontSize={9} fontFamily="Inter,sans-serif">New Block</text>
    </g>
  );
}

function ExternalIfaceGhost({ x, y, p }: { x: number; y: number; p: CanvasPalette }) {
  return (
    <g opacity={ALPHA}>
      <rect x={x - 50} y={y - 25} width={100} height={50} rx={2}
        fill={p.ghostFill} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5,3" />
      <text x={x} y={y + 4} textAnchor="middle" fill="#f59e0b" fontSize={9} fontFamily="JetBrains Mono,monospace">EXT I/F</text>
    </g>
  );
}

function PowerBusGhost({ x, y, pendingStart }: { x: number; y: number; pendingStart?: { x: number; y: number } }) {
  if (pendingStart) {
    const py = pendingStart.y; // bus is always horizontal
    return (
      <g opacity={ALPHA}>
        <circle cx={pendingStart.x} cy={py} r={5} fill="#f59e0b" />
        <line x1={pendingStart.x} y1={py} x2={x} y2={py}
          stroke="#f59e0b" strokeWidth={4} strokeDasharray="8,4" />
        <text x={x + 10} y={py - 6} fill="#f59e0b" fontSize={9} fontFamily="JetBrains Mono,monospace">+28VDC</text>
      </g>
    );
  }
  return (
    <g opacity={ALPHA}>
      <line x1={x - 80} y1={y} x2={x + 80} y2={y}
        stroke="#f59e0b" strokeWidth={4} strokeDasharray="8,4" />
      <text x={x} y={y - 7} textAnchor="middle" fill="#f59e0b" fontSize={9} fontFamily="JetBrains Mono,monospace">Click start, then end</text>
    </g>
  );
}

function CircuitBreakerGhost({ x, y, p }: { x: number; y: number; p: CanvasPalette }) {
  return (
    <g opacity={ALPHA}>
      <rect x={x - 10} y={y - 10} width={20} height={20} rx={2}
        fill={p.ghostFill} stroke="#7dd3fc" strokeWidth={1.2} strokeDasharray="4,2" />
      <line x1={x - 8} y1={y + 8} x2={x + 8} y2={y - 8} stroke="#7dd3fc" strokeWidth={0.8} />
      <text x={x} y={y - 14} textAnchor="middle" fill="#7dd3fc" fontSize={8} fontFamily="JetBrains Mono,monospace">CB?</text>
    </g>
  );
}

function RelayCoilGhost({ x, y, p }: { x: number; y: number; p: CanvasPalette }) {
  return (
    <g opacity={ALPHA}>
      <circle cx={x} cy={y} r={12} fill={p.ghostFill} stroke="#7dd3fc" strokeWidth={1.2} strokeDasharray="4,2" />
      <text x={x} y={y + 4} textAnchor="middle" fill="#7dd3fc" fontSize={8} fontFamily="JetBrains Mono,monospace">K?</text>
      <text x={x} y={y - 17} textAnchor="middle" fill="#7dd3fc" fontSize={7} fontFamily="JetBrains Mono,monospace">RELAY</text>
    </g>
  );
}

function GroundGhost({ x, y }: { x: number; y: number }) {
  return (
    <g opacity={ALPHA}>
      <line x1={x} y1={y - 12} x2={x} y2={y} stroke="#7dd3fc" strokeWidth={1} />
      <line x1={x - 10} y1={y} x2={x + 10} y2={y} stroke="#7dd3fc" strokeWidth={1.5} />
      <line x1={x - 6} y1={y + 4} x2={x + 6} y2={y + 4} stroke="#7dd3fc" strokeWidth={1} />
      <line x1={x - 2} y1={y + 8} x2={x + 2} y2={y + 8} stroke="#7dd3fc" strokeWidth={0.8} />
      <text x={x} y={y - 16} textAnchor="middle" fill="#7dd3fc" fontSize={7} fontFamily="JetBrains Mono,monospace">GND</text>
    </g>
  );
}

function FuseGhost({ x, y, p }: { x: number; y: number; p: CanvasPalette }) {
  return (
    <g opacity={ALPHA}>
      <rect x={x - 14} y={y - 6} width={28} height={12} rx={6}
        fill={p.ghostFill} stroke="#7dd3fc" strokeWidth={1.2} strokeDasharray="4,2" />
      <line x1={x - 14} y1={y} x2={x - 20} y2={y} stroke="#7dd3fc" strokeWidth={1} />
      <line x1={x + 14} y1={y} x2={x + 20} y2={y} stroke="#7dd3fc" strokeWidth={1} />
      <text x={x} y={y - 10} textAnchor="middle" fill="#7dd3fc" fontSize={7} fontFamily="JetBrains Mono,monospace">F?</text>
    </g>
  );
}

function ConnectorGhost({ x, y, p }: { x: number; y: number; p: CanvasPalette }) {
  const pins = [0, 1, 2, 3];
  const h = pins.length * 10 + 10;
  return (
    <g opacity={ALPHA}>
      <rect x={x - 25} y={y - h / 2} width={50} height={h} rx={2}
        fill={p.ghostFill} stroke="#6366f1" strokeWidth={1.2} strokeDasharray="4,2" />
      {pins.map(i => (
        <circle key={i} cx={x} cy={y - h / 2 + 10 + i * 10} r={2.5}
          fill="#6366f1" fillOpacity={0.6} />
      ))}
      <text x={x} y={y - h / 2 - 5} textAnchor="middle" fill="#6366f1" fontSize={8} fontFamily="JetBrains Mono,monospace">J?</text>
    </g>
  );
}

function TerminalBlockGhost({ x, y, p }: { x: number; y: number; p: CanvasPalette }) {
  return (
    <g opacity={ALPHA}>
      <rect x={x - 20} y={y - 8} width={40} height={16} rx={2}
        fill={p.ghostFill} stroke="#7dd3fc" strokeWidth={1.2} strokeDasharray="4,2" />
      <text x={x} y={y + 4} textAnchor="middle" fill="#7dd3fc" fontSize={8} fontFamily="JetBrains Mono,monospace">TB?</text>
    </g>
  );
}

function JunctionGhost({ x, y }: { x: number; y: number }) {
  return (
    <g opacity={ALPHA}>
      <circle cx={x} cy={y} r={5} fill="#00d4ff" fillOpacity={0.6} />
      <circle cx={x} cy={y} r={5} fill="none" stroke="#00d4ff" strokeWidth={1} strokeDasharray="3,2" />
    </g>
  );
}

function WireGhost({ x, y, pendingStart }: { x: number; y: number; pendingStart?: { x: number; y: number } }) {
  if (pendingStart) {
    const px = pendingStart.x, py = pendingStart.y;
    // L-shape: horizontal from start to x, then vertical to y
    const pts = `${px},${py} ${x},${py} ${x},${y}`;
    return (
      <g opacity={ALPHA}>
        <circle cx={px} cy={py} r={4} fill="#00d4ff" />
        <polyline points={pts} fill="none" stroke="#00d4ff" strokeWidth={1.5}
          strokeDasharray="6,3" strokeLinejoin="round" />
        <circle cx={x} cy={y} r={3} fill="none" stroke="#00d4ff" strokeWidth={1} />
        {/* Elbow dot */}
        <circle cx={x} cy={py} r={2} fill="#00d4ff" fillOpacity={0.5} />
      </g>
    );
  }
  return (
    <g opacity={ALPHA}>
      <line x1={x - 30} y1={y} x2={x + 30} y2={y} stroke="#00d4ff" strokeWidth={1.5} strokeDasharray="6,3" />
      <circle cx={x} cy={y} r={3} fill="#00d4ff" fillOpacity={0.6} />
      <text x={x} y={y - 8} textAnchor="middle" fill="#00d4ff" fontSize={7} fontFamily="JetBrains Mono,monospace">
        Click start, then end
      </text>
    </g>
  );
}

// ─── cursor label ─────────────────────────────────────────────────────────────

function CursorLabel({ x, y, label, p }: { x: number; y: number; label: string; p: CanvasPalette }) {
  return (
    <g>
      <rect x={x + 14} y={y - 8} width={label.length * 6 + 8} height={14} rx={3}
        fill={p.ghostFill} stroke={p.ghostStroke} strokeWidth={0.5} fillOpacity={0.9} />
      <text x={x + 18} y={y + 1} fill={p.ghostLabel} fontSize={8} fontFamily="JetBrains Mono,monospace">{label}</text>
    </g>
  );
}

// ─── main export ─────────────────────────────────────────────────────────────

export default function ToolGhost({ x, y, pendingStart, toolType }: GhostProps) {
  const p = useCanvasPalette();
  return (
    <g style={{ pointerEvents: 'none' }}>
      {toolType === 'lru_block'       && <LRUGhost x={x} y={y} p={p} />}
      {toolType === 'external_iface'  && <ExternalIfaceGhost x={x} y={y} p={p} />}
      {toolType === 'power_bus'       && <PowerBusGhost x={x} y={y} pendingStart={pendingStart} />}
      {toolType === 'circuit_breaker' && <CircuitBreakerGhost x={x} y={y} p={p} />}
      {toolType === 'relay_coil'      && <RelayCoilGhost x={x} y={y} p={p} />}
      {toolType === 'ground'          && <GroundGhost x={x} y={y} />}
      {toolType === 'fuse'            && <FuseGhost x={x} y={y} p={p} />}
      {toolType === 'connector'       && <ConnectorGhost x={x} y={y} p={p} />}
      {toolType === 'terminal_block'  && <TerminalBlockGhost x={x} y={y} p={p} />}
      {toolType === 'junction'        && <JunctionGhost x={x} y={y} />}
      {toolType === 'wire'            && <WireGhost x={x} y={y} pendingStart={pendingStart} />}
      <CursorLabel x={x} y={y} label={toolType.replace(/_/g, ' ')} p={p} />
    </g>
  );
}
