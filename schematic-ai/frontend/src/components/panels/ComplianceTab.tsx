import React from 'react';
import type { RuleResult } from '../../types/compliance';
import { useApp } from '../../state/AppContext';
import { runCompliance, fixCompliance } from '../../api/client';

const SEVERITY_ICONS = { error: '✗', warning: '⚠', info: 'ℹ' };
const SEVERITY_COLORS = {
  error:   'text-aero-red border-aero-red/30 bg-aero-red/5',
  warning: 'text-aero-yellow border-aero-yellow/30 bg-aero-yellow/5',
  info:    'text-aero-accent border-aero-accent/30 bg-aero-accent/5',
};

function ScoreRing({ score }: { score: number }) {
  const r = 30;
  const circumference = 2 * Math.PI * r;
  const progress = (score / 100) * circumference;
  const color = score >= 80 ? '#3fb950' : score >= 50 ? '#d29922' : '#f85149';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#21262d" strokeWidth="8" />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${progress} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
        />
        <text x="40" y="45" textAnchor="middle" fill={color} fontSize="16" fontWeight="700" fontFamily="JetBrains Mono, monospace">
          {score}
        </text>
      </svg>
      <span className="text-xs text-gray-500">Compliance Score</span>
    </div>
  );
}

function RuleRow({ result, onFix }: { result: RuleResult; onFix: (id: string) => void }) {
  const { dispatch } = useApp();
  if (result.status === 'pass') return null;
  const colorClass = SEVERITY_COLORS[result.severity] || SEVERITY_COLORS.info;

  return (
    <div className={`rounded border p-2 text-xs ${colorClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5">
          <span className="font-bold mt-0.5">{SEVERITY_ICONS[result.severity]}</span>
          <div>
            <div className="font-mono text-xs opacity-60">{result.rule_id}</div>
            <div className="font-medium">{result.message || result.rule_title}</div>
            {result.element_ref && (
              <button
                className="text-aero-accent hover:underline mt-0.5"
                onClick={() => result.layer && dispatch({
                  type: 'NAVIGATE_TO',
                  layer: result.layer as any,
                  elementId: result.element_id || undefined,
                  sheet: result.sheet || undefined,
                  label: result.element_ref || '',
                })}
              >
                {result.element_ref} →
              </button>
            )}
          </div>
        </div>
        {result.fix_available && (
          <button
            onClick={() => onFix(result.rule_id)}
            className="text-xs px-2 py-0.5 bg-aero-green/10 border border-aero-green/30 text-aero-green rounded hover:bg-aero-green/20 whitespace-nowrap"
          >
            Auto-fix
          </button>
        )}
      </div>
    </div>
  );
}

export default function ComplianceTab() {
  const { state, dispatch } = useApp();
  const [loading, setLoading] = React.useState(false);

  const runCheck = async () => {
    if (!state.projectId) return;
    setLoading(true);
    try {
      const report = await runCompliance(state.projectId, state.activeLayer);
      dispatch({ type: 'SET_COMPLIANCE', report });
    } finally {
      setLoading(false);
    }
  };

  const handleFix = async (ruleId: string) => {
    if (!state.projectId) return;
    const result = await fixCompliance(state.projectId, ruleId);
    if (result.updated_project) {
      dispatch({ type: 'SET_PROJECT', project: result.updated_project, projectId: state.projectId });
    }
    await runCheck();
  };

  const report = state.compliance;
  const failing = report?.results.filter(r => r.status === 'fail') || [];

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-aero-border flex items-center justify-between">
        <button
          onClick={runCheck}
          disabled={!state.projectId || loading}
          className="px-3 py-1.5 text-xs bg-aero-panel border border-aero-border rounded hover:border-aero-accent text-gray-300 disabled:opacity-40"
        >
          {loading ? 'Checking...' : 'Run Compliance Check'}
        </button>
        {report && <span className="text-xs text-gray-500">{report.summary}</span>}
      </div>

      {report && (
        <div className="flex justify-center py-3 border-b border-aero-border">
          <ScoreRing score={report.score} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {failing.length === 0 && report && (
          <div className="text-center text-aero-green text-sm mt-4">
            ✓ All compliance rules passing for {state.activeLayer.replace('_', ' ')}
          </div>
        )}
        {failing.map(result => (
          <RuleRow key={result.rule_id + result.element_id} result={result} onFix={handleFix} />
        ))}
        {!report && (
          <div className="text-center text-gray-600 text-sm mt-8">
            Run a compliance check to see results.
          </div>
        )}
      </div>
    </div>
  );
}
