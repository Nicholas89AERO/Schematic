import React, { createContext, useContext, useEffect, useReducer } from 'react';
import {
  reducer,
  initialState,
  AI_PANEL_STORAGE_KEY,
  readAiPanelOpen,
  type AppState,
  type Action,
} from './reducer';

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(
    reducer,
    initialState,
    (s) => ({ ...s, aiPanelOpen: readAiPanelOpen() }),
  );

  useEffect(() => {
    try {
      localStorage.setItem(AI_PANEL_STORAGE_KEY, state.aiPanelOpen ? 'open' : 'closed');
    } catch {
      /* ignore */
    }
  }, [state.aiPanelOpen]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
