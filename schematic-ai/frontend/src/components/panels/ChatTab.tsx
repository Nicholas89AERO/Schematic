import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/AppContext';
import { aiModify, aiPropagate } from '../../api/client';
import type { ChatMessage } from '../../state/reducer';

const LAYER_PLACEHOLDERS = {
  block_diagram: 'Ask about system architecture, LRU blocks, signal paths...',
  schematic: 'Ask about wiring, connectors, components, wire gauges...',
  harness: 'Ask about wire lengths, routing, connector hardware...',
};

export default function ChatTab() {
  const { state, dispatch } = useApp();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Listen for ai-chip events dispatched by Ribbon/Sidebar quick-action buttons
  useEffect(() => {
    const handler = (e: Event) => {
      const chip = (e as CustomEvent<string>).detail;
      setInput(chip);
      setTimeout(() => textareaRef.current?.focus(), 50);
    };
    window.addEventListener('ai-chip', handler);
    return () => window.removeEventListener('ai-chip', handler);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || !state.projectId || state.aiLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };
    dispatch({ type: 'ADD_CHAT_MESSAGE', message: userMsg });
    setInput('');
    dispatch({ type: 'SET_AI_LOADING', loading: true });

    try {
      const result = await aiModify(state.projectId, state.activeLayer, userMsg.content);

      dispatch({ type: 'SET_PROJECT', project: result.updated_project, projectId: state.projectId });
      dispatch({ type: 'SET_COMPLIANCE', report: result.compliance });
      dispatch({ type: 'SET_CONSISTENCY', result: result.consistency });
      dispatch({ type: 'SET_LAST_CHANGESET', changeset: result.changeset });

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Changes applied to ${state.activeLayer.replace('_', ' ')}. Consistency score: ${result.consistency?.score ?? '—'}/100.`,
        timestamp: Date.now(),
        changeset: result.changeset,
      };
      dispatch({ type: 'ADD_CHAT_MESSAGE', message: assistantMsg });

      // Auto-propagate
      if (state.projectId) {
        const propagated = await aiPropagate(state.projectId, state.activeLayer, result.changeset);
        if (propagated.propagated_changesets.length > 0) {
          dispatch({ type: 'SET_AI_TAB', tab: 'consistency' });
          const propMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `${propagated.propagated_changesets.length} cross-layer change(s) suggested. Check the Consistency tab.`,
            timestamp: Date.now(),
          };
          dispatch({ type: 'ADD_CHAT_MESSAGE', message: propMsg });
        }
      }
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err?.response?.data?.detail || err.message || 'Unknown error'}`,
        timestamp: Date.now(),
      };
      dispatch({ type: 'ADD_CHAT_MESSAGE', message: errMsg });
    } finally {
      dispatch({ type: 'SET_AI_LOADING', loading: false });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {state.aiMessages.length === 0 && (
          <div className="text-center text-gray-600 text-sm mt-8">
            <div className="text-2xl mb-2">✈</div>
            <p>Ask me to modify your {state.activeLayer.replace('_', ' ')} drawing.</p>
            <p className="text-xs mt-1 text-gray-700">Changes propagate across all three layers automatically.</p>
          </div>
        )}
        {state.aiMessages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`
              max-w-[85%] rounded-lg px-3 py-2 text-sm
              ${msg.role === 'user'
                ? 'bg-aero-accent/20 text-gray-200 border border-aero-accent/30'
                : 'bg-aero-panel text-gray-300 border border-aero-border'
              }
            `}>
              {msg.content}
              {!!msg.changeset && (
                <button
                  onClick={() => dispatch({ type: 'SET_AI_TAB', tab: 'diff' })}
                  className="block mt-1 text-xs text-aero-accent hover:underline">
                  View diff →
                </button>
              )}
            </div>
          </div>
        ))}
        {state.aiLoading && (
          <div className="flex justify-start">
            <div className="bg-aero-panel border border-aero-border rounded-lg px-3 py-2 text-sm text-gray-500">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-aero-border">
        {!state.projectId && (
          <p className="text-xs text-aero-yellow mb-2 text-center">Upload a drawing file to enable AI modifications.</p>
        )}
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={LAYER_PLACEHOLDERS[state.activeLayer]}
            disabled={!state.projectId || state.aiLoading}
            rows={2}
            className="flex-1 bg-aero-dark border border-aero-border rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-aero-accent disabled:opacity-40"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !state.projectId || state.aiLoading}
            className="px-3 bg-aero-accent text-aero-dark rounded font-medium text-sm hover:bg-aero-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
