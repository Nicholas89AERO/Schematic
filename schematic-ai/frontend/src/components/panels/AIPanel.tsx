import React from 'react';
import { useApp } from '../../state/AppContext';
import ChatTab from './ChatTab';
import ComplianceTab from './ComplianceTab';
import DiffTab from './DiffTab';
import ConsistencyTab from './ConsistencyTab';
import type { AppState } from '../../state/reducer';

const TABS: { id: AppState['activeAiTab']; label: string }[] = [
  { id: 'chat',        label: 'AI Chat' },
  { id: 'compliance',  label: 'Compliance' },
  { id: 'diff',        label: 'Diff' },
  { id: 'consistency', label: 'Consistency' },
];

export default function AIPanel() {
  const { state, dispatch } = useApp();

  return (
    <div className="h-full flex bg-aero-panel border-l border-aero-border">
      <button
        type="button"
        className="w-7 shrink-0 flex items-center justify-center border-r border-aero-border text-gray-500 hover:text-aero-accent hover:bg-aero-border/40 transition-colors"
        onClick={() => dispatch({ type: 'TOGGLE_AI_PANEL' })}
        aria-label="Collapse AI panel"
        title="Collapse AI panel"
      >
        ›
      </button>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Tab bar */}
        <div className="flex border-b border-aero-border">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => dispatch({ type: 'SET_AI_TAB', tab: tab.id })}
              className={`
                flex-1 py-2 text-xs font-medium transition-colors
                ${state.activeAiTab === tab.id
                  ? 'text-aero-accent border-b-2 border-aero-accent'
                  : 'text-gray-500 hover:text-gray-300'}
              `}
            >
              {tab.label}
              {tab.id === 'consistency' && state.consistency && (
                state.consistency.errors.length > 0
                  ? <span className="ml-1 text-aero-red">{state.consistency.errors.length}</span>
                  : state.consistency.warnings.length > 0
                  ? <span className="ml-1 text-aero-yellow">{state.consistency.warnings.length}</span>
                  : <span className="ml-1 text-aero-green">✓</span>
              )}
              {tab.id === 'compliance' && state.compliance && state.compliance.errors > 0 && (
                <span className="ml-1 text-aero-red">{state.compliance.errors}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {state.activeAiTab === 'chat'        && <ChatTab />}
          {state.activeAiTab === 'compliance'  && <ComplianceTab />}
          {state.activeAiTab === 'diff'        && <DiffTab />}
          {state.activeAiTab === 'consistency' && <ConsistencyTab />}
        </div>
      </div>
    </div>
  );
}
