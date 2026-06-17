import React, { useEffect, useState } from 'react';
import { useApp } from './state/AppContext';
import Ribbon from './components/Ribbon';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import AIPanel from './components/panels/AIPanel';
import BlockDiagramCanvas from './components/canvas/BlockDiagramCanvas';
import SchematicCanvas from './components/canvas/SchematicCanvas';
import HarnessCanvas from './components/canvas/HarnessCanvas';
import NewDrawingDialog from './components/NewDrawingDialog';
import LibraryPanel from './components/LibraryPanel';
import { useTreeAddDrawing } from './components/FolderTree';
import type { DrawingLayer } from './types/project';

export default function App() {
  const { state, dispatch } = useApp();
  const [newDrawingOpen, setNewDrawingOpen]   = useState(false);
  const [libraryOpen,    setLibraryOpen]      = useState(false);
  const addDrawingToTree = useTreeAddDrawing();

  const handleChipClick = (chip: string) => {
    dispatch({ type: 'SET_AI_TAB', tab: 'chat' });
    if (!state.aiPanelOpen) dispatch({ type: 'TOGGLE_AI_PANEL' });
    window.dispatchEvent(new CustomEvent('ai-chip', { detail: chip }));
  };

  // ── Global keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      // Ignore when typing in an input/textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }); }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); dispatch({ type: 'REDO' }); }
      if (ctrl && e.key === 'c') { e.preventDefault(); dispatch({ type: 'COPY_ELEMENT' }); }
      if (ctrl && e.key === 'x') {
        e.preventDefault();
        dispatch({ type: 'COPY_ELEMENT' });
        if (state.selectedElementId) dispatch({ type: 'DELETE_ELEMENT', elementId: state.selectedElementId });
      }
      if (ctrl && e.key === 'v') {
        e.preventDefault();
        dispatch({ type: 'PASTE_ELEMENT', x: 200, y: 200 });
      }
      if (ctrl && e.key === 'a') { e.preventDefault(); /* select-all: open AI with summary prompt */ handleChipClick('List all components on the current drawing'); }
      if (e.key === 'Escape') dispatch({ type: 'SET_ACTIVE_TOOL', tool: null });
      if (e.key === 'Delete' && state.selectedElementId) dispatch({ type: 'DELETE_ELEMENT', elementId: state.selectedElementId });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, state.selectedElementId]);

  const handleNewDrawingCreated = (
    projectId: string,
    layer: DrawingLayer,
    name: string,
    sheetCount: number,
  ) => {
    addDrawingToTree(name, projectId, layer, sheetCount);
  };

  return (
    <div className="h-screen flex flex-col bg-aero-dark text-gray-200 overflow-hidden">

      {/* Ribbon (replaces Nav + LayerTabs) */}
      <Ribbon
        onChipClick={handleChipClick}
        onNewDrawing={() => setNewDrawingOpen(true)}
        onOpenLibrary={() => setLibraryOpen(true)}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        {state.sidebarOpen && (
          <div className="w-64 shrink-0 overflow-hidden">
            <Sidebar />
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 overflow-hidden relative">
          {state.activeLayer === 'block_diagram' && (
            <BlockDiagramCanvas blockDiagrams={state.project?.block_diagrams || []} />
          )}
          {state.activeLayer === 'schematic' && (
            <SchematicCanvas sheets={state.project?.schematic_sheets || []} />
          )}
          {state.activeLayer === 'harness' && (
            <HarnessCanvas sheets={state.project?.harness_sheets || []} />
          )}

          {/* Empty state */}
          {!state.project && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <div className="text-6xl mb-4 opacity-20">✈</div>
              <h2 className="text-xl font-semibold text-gray-400 mb-2">SchematicAI</h2>
              <p className="text-sm text-gray-600 max-w-sm">
                Use <strong className="text-gray-500">File › New Drawing</strong> to create a blank sheet, or
                drop a DXF / DWG / PDF into the Explorer sidebar to import.
              </p>
            </div>
          )}
        </div>

        {/* AI Panel expand strip (collapsed) */}
        {!state.aiPanelOpen && (
          <button
            type="button"
            className="w-7 shrink-0 flex flex-col items-center justify-center gap-1 bg-aero-panel border-l border-aero-border text-gray-500 hover:text-aero-accent hover:bg-aero-border/40 transition-colors"
            onClick={() => dispatch({ type: 'TOGGLE_AI_PANEL' })}
            aria-label="Expand AI panel"
            title="Expand AI panel"
          >
            <span className="text-sm leading-none">‹</span>
            <span className="text-[10px] font-semibold tracking-widest [writing-mode:vertical-rl] rotate-180">
              AI
            </span>
          </button>
        )}

        {/* AI Panel */}
        {state.aiPanelOpen && (
          <div className="w-80 shrink-0 overflow-hidden">
            <AIPanel />
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* New Drawing dialog */}
      <NewDrawingDialog
        open={newDrawingOpen}
        onClose={() => setNewDrawingOpen(false)}
        onCreated={handleNewDrawingCreated}
      />

      {/* Library panel */}
      <LibraryPanel
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onTemplateUsed={(projectId, layer, name) => {
          addDrawingToTree(name, projectId, layer, 1);
          setLibraryOpen(false);
        }}
      />
    </div>
  );
}
