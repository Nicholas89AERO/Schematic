import React from 'react';
import { useApp } from '../state/AppContext';
import { exportDxf, exportPdf, exportWireList, downloadBlob } from '../api/client';

export default function Nav() {
  const { state, dispatch } = useApp();

  const handleExport = async (format: 'dxf' | 'pdf' | 'wire-list') => {
    if (!state.projectId) return;
    try {
      let blob: Blob;
      let filename: string;
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
    } catch (err) {
      console.error('Export failed', err);
    }
  };

  return (
    <nav className="h-12 bg-aero-panel border-b border-aero-border flex items-center px-4 gap-4 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-4">
        <span className="text-aero-accent font-bold text-sm font-mono">✈ SchematicAI</span>
      </div>

      {/* Project info */}
      {state.project && (
        <span className="text-xs text-gray-500 font-mono">
          {state.project.project_number || state.projectId?.slice(0, 8)}
          {state.project.aircraft_type && ` — ${state.project.aircraft_type}`}
          {state.project.title_block.revision && ` Rev. ${state.project.title_block.revision}`}
        </span>
      )}

      <div className="flex-1" />

      {/* Export buttons */}
      {state.projectId && (
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('dxf')}
            className="px-2.5 py-1 text-xs border border-aero-border text-gray-400 rounded hover:border-aero-accent hover:text-gray-200 font-mono transition-colors"
          >
            DXF
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="px-2.5 py-1 text-xs border border-aero-border text-gray-400 rounded hover:border-aero-accent hover:text-gray-200 font-mono transition-colors"
          >
            PDF
          </button>
          {state.activeLayer === 'harness' && (
            <button
              onClick={() => handleExport('wire-list')}
              className="px-2.5 py-1 text-xs border border-aero-border text-gray-400 rounded hover:border-aero-accent hover:text-gray-200 font-mono transition-colors"
            >
              Wire List
            </button>
          )}
        </div>
      )}

      {/* Toggle panels */}
      <button
        onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
        className="p-1.5 text-gray-500 hover:text-gray-300 rounded"
        title="Toggle sidebar"
      >☰</button>
    </nav>
  );
}
