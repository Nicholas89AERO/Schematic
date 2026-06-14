import React from 'react';
import type { DrawingLayer } from '../types/project';
import { useApp } from '../state/AppContext';

const LAYER_CONFIG = {
  block_diagram: {
    label: 'Block Diagram',
    sublabel: 'L1',
    color: 'text-aero-orange',
    activeColor: 'bg-aero-orange/10 border-aero-orange text-aero-orange',
    chips: [
      'Add LRU', 'Add signal path', 'Add power bus', 'Check ATA refs',
    ],
  },
  schematic: {
    label: 'Schematic',
    sublabel: 'L2',
    color: 'text-aero-accent',
    activeColor: 'bg-aero-accent/10 border-aero-accent text-aero-accent',
    chips: [
      'Clone circuit', 'Add E-stop', 'Check wire gauges', 'Generate BOM', 'Add connector',
    ],
  },
  harness: {
    label: 'Harness',
    sublabel: 'L3',
    color: 'text-aero-green',
    activeColor: 'bg-aero-green/10 border-aero-green text-aero-green',
    chips: [
      'Generate wire list', 'Add splice', 'Calculate harness weight', 'Check pin assignments',
    ],
  },
} as const;

interface Props {
  onChipClick: (chip: string) => void;
}

export default function LayerTabs({ onChipClick }: Props) {
  const { state, dispatch } = useApp();
  const config = LAYER_CONFIG[state.activeLayer];

  return (
    <div className="border-b border-aero-border bg-aero-panel">
      {/* Layer tabs */}
      <div className="flex">
        {(Object.entries(LAYER_CONFIG) as [DrawingLayer, typeof LAYER_CONFIG[DrawingLayer]][]).map(([layer, cfg]) => (
          <button
            key={layer}
            onClick={() => dispatch({ type: 'SET_ACTIVE_LAYER', layer })}
            className={`
              px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${state.activeLayer === layer
                ? `border-current ${cfg.activeColor}`
                : `border-transparent text-gray-500 hover:text-gray-300 hover:border-aero-border`
              }
            `}
          >
            <span className="text-xs opacity-60 mr-1">{cfg.sublabel}</span>
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Quick action chips */}
      <div className="flex gap-1.5 px-3 py-1.5 overflow-x-auto">
        {config.chips.map(chip => (
          <button
            key={chip}
            onClick={() => onChipClick(chip)}
            className={`
              px-2.5 py-0.5 text-xs rounded-full border whitespace-nowrap transition-colors
              border-current/30 hover:border-current/60 opacity-70 hover:opacity-100
              ${config.color}
            `}
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
