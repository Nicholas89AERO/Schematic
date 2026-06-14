import React from 'react';
import { useApp } from '../../state/AppContext';
import { validateConsistency } from '../../api/client';
import type { DrawingLayer } from '../../types/project';

function ConsistencyItem({ message, type, onNavigate }: {
  message: string;
  type: 'error' | 'warning';
  onNavigate?: () => void;
}) {
  const isError = type === 'error';
  return (
    <div className={`flex items-start gap-2 p-2 rounded border text-xs ${
      isError
        ? 'bg-aero-red/5 border-aero-red/20 text-aero-red'
        : 'bg-aero-yellow/5 border-aero-yellow/20 text-aero-yellow'
    }`}>
      <span className="mt-0.5 font-bold">{isError ? '✗' : '⚠'}</span>
      <div className="flex-1">
        <span>{message}</span>
        {onNavigate && (
          <button className="ml-2 text-aero-accent hover:underline" onClick={onNavigate}>→</button>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-aero-green' : score >= 50 ? 'bg-aero-yellow' : 'bg-aero-red';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-aero-dark rounded overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-mono font-bold" style={{ color: score >= 80 ? '#3fb950' : score >= 50 ? '#d29922' : '#f85149' }}>
        {score}/100
      </span>
    </div>
  );
}

function _layerFromMessage(msg: string): DrawingLayer | null {
  if (msg.includes('L3') || msg.includes('harness') || msg.includes('Harness')) return 'harness';
  if (msg.includes('L2') || msg.includes('schematic') || msg.includes('Schematic')) return 'schematic';
  if (msg.includes('L1') || msg.includes('block') || msg.includes('signal path')) return 'block_diagram';
  return null;
}

export default function ConsistencyTab() {
  const { state, dispatch } = useApp();
  const [loading, setLoading] = React.useState(false);
  const consistency = state.consistency;

  const runCheck = async () => {
    if (!state.projectId) return;
    setLoading(true);
    try {
      const result = await validateConsistency(state.projectId);
      dispatch({ type: 'SET_CONSISTENCY', result });
    } finally {
      setLoading(false);
    }
  };

  const allWarnings = consistency ? [
    ...consistency.errors.map(m => ({ message: m, type: 'error' as const })),
    ...consistency.warnings.map(m => ({ message: m, type: 'warning' as const })),
  ] : [];

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-aero-border flex items-center justify-between gap-2">
        <button
          onClick={runCheck}
          disabled={!state.projectId || loading}
          className="px-3 py-1.5 text-xs bg-aero-panel border border-aero-border rounded hover:border-aero-accent text-gray-300 disabled:opacity-40"
        >
          {loading ? 'Checking...' : 'Run Consistency Check'}
        </button>
        {consistency && (
          <span className="text-xs text-gray-500">
            {consistency.errors.length} errors, {consistency.warnings.length} warnings
          </span>
        )}
      </div>

      {consistency && (
        <div className="p-3 border-b border-aero-border">
          <ScoreBar score={consistency.score} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {allWarnings.length === 0 && consistency && (
          <div className="text-center text-aero-green text-sm mt-4">
            ✓ All cross-layer consistency checks passing
          </div>
        )}
        {allWarnings.map((item, i) => {
          const targetLayer = _layerFromMessage(item.message);
          return (
            <ConsistencyItem
              key={i}
              message={item.message}
              type={item.type}
              onNavigate={targetLayer
                ? () => dispatch({ type: 'SET_ACTIVE_LAYER', layer: targetLayer })
                : undefined
              }
            />
          );
        })}
        {!consistency && (
          <div className="text-center text-gray-600 text-sm mt-8">
            <p>Run a consistency check to validate cross-layer references.</p>
            <p className="text-xs mt-1 text-gray-700">Checks run automatically after each AI modification.</p>
          </div>
        )}
      </div>
    </div>
  );
}
