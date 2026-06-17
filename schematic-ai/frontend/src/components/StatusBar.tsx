import React from 'react';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme/ThemeContext';

const LAYER_LABEL = {
  block_diagram: 'L1 Block Diagram',
  schematic:     'L2 Schematic',
  harness:       'L3 Harness',
};

const LAYER_COLOR = {
  block_diagram: 'text-aero-orange',
  schematic:     'text-aero-accent',
  harness:       'text-aero-green',
};

export default function StatusBar() {
  const { state, dispatch } = useApp();
  const { theme, toggleTheme } = useTheme();
  const consistency = state.consistency;
  const compliance  = state.compliance;

  return (
    <div className="h-7 bg-aero-panel border-t border-aero-border flex items-center px-3 gap-4 text-xs font-mono shrink-0">
      <div className="flex items-center gap-4 flex-1 min-w-0 overflow-hidden">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 overflow-hidden">
          {state.breadcrumb.length === 0 ? (
            <span className={`font-semibold ${LAYER_COLOR[state.activeLayer]}`}>
              {LAYER_LABEL[state.activeLayer]}
            </span>
          ) : (
            state.breadcrumb.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-gray-600">›</span>}
                <button
                  className={`hover:underline ${LAYER_COLOR[crumb.layer]} truncate max-w-32`}
                  onClick={() => {
                    dispatch({ type: 'SET_ACTIVE_LAYER', layer: crumb.layer });
                    if (crumb.elementId) {
                      dispatch({ type: 'SELECT_ELEMENT', elementId: crumb.elementId, layer: crumb.layer });
                    }
                  }}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))
          )}
          {state.breadcrumb.length > 0 && (
            <button onClick={() => dispatch({ type: 'CLEAR_BREADCRUMB' })}
              className="ml-2 text-gray-600 hover:text-gray-400">✕</button>
          )}
        </div>

        {/* Selected element */}
        {state.selectedElementId && (
          <span className="text-gray-500 truncate max-w-40">
            ID: {state.selectedElementId.slice(0, 8)}
          </span>
        )}

        {/* Consistency score */}
        {consistency && (
          <span className={
            consistency.errors.length > 0 ? 'text-aero-red' :
            consistency.warnings.length > 0 ? 'text-aero-yellow' : 'text-aero-green'
          }>
            Consistency {consistency.score}/100
          </span>
        )}

        {/* Compliance score */}
        {compliance && (
          <span className={compliance.errors > 0 ? 'text-aero-red' : compliance.warnings > 0 ? 'text-aero-yellow' : 'text-aero-green'}>
            Compliance {compliance.score}/100
          </span>
        )}

        {/* AI loading */}
        {state.aiLoading && (
          <span className="text-aero-accent animate-pulse">AI processing...</span>
        )}
      </div>

      <button
        type="button"
        className="ml-auto shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded border border-aero-border hover:border-aero-accent text-gray-400 hover:text-aero-accent transition-colors"
        onClick={toggleTheme}
        aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      >
        {theme === 'light' ? '☾ Dark' : '☀ Light'}
      </button>
    </div>
  );
}
