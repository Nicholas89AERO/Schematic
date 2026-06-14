import React from 'react';
import { useApp } from '../../state/AppContext';

export default function DiffTab() {
  const { state } = useApp();
  const changeset = state.lastChangeset as any;

  if (!changeset) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        No changes yet. Use the AI chat to modify your drawing.
      </div>
    );
  }

  const ops = changeset.operations || [];

  return (
    <div className="p-3 overflow-y-auto h-full">
      <div className="text-xs text-gray-500 mb-3 font-mono">
        Changeset {changeset.changeset_id?.slice(0, 8)} — {ops.length} operation(s)
      </div>
      <div className="space-y-3">
        {ops.map((op: any, i: number) => (
          <div key={i} className={`rounded border text-xs font-mono p-2 ${
            op.operation === 'add'    ? 'bg-aero-green/5 border-aero-green/20 text-aero-green' :
            op.operation === 'delete' ? 'bg-aero-red/5 border-aero-red/20 text-aero-red' :
                                        'bg-aero-accent/5 border-aero-accent/20 text-aero-accent'
          }`}>
            <div className="font-bold mb-1">
              {op.operation.toUpperCase()} {op.element_kind} [{op.layer}]
              {op.sheet && ` sheet ${op.sheet}`}
            </div>
            {op.description && <div className="text-gray-400 mb-1">{op.description}</div>}
            {op.before && (
              <div className="mb-1">
                <div className="text-red-400 opacity-70">− Before:</div>
                <pre className="text-xs overflow-x-auto opacity-60">
                  {JSON.stringify(op.before, null, 2)}
                </pre>
              </div>
            )}
            {op.after && (
              <div>
                <div className="text-green-400 opacity-70">+ After:</div>
                <pre className="text-xs overflow-x-auto opacity-70">
                  {JSON.stringify(op.after, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
