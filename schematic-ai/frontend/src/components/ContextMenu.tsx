/**
 * ContextMenu — floating right-click / Edit menu popup.
 * Positioned using fixed coordinates so it works inside any transform/scroll context.
 */
import React, { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  icon?: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuSection {
  items: MenuItem[];
}

interface Props {
  x: number;
  y: number;
  sections: MenuSection[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, sections, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Close on outside click or ESC — stable listener (no re-attach on every render)
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Keep menu on screen
  const clampedX = Math.min(x, window.innerWidth  - 220);
  const clampedY = Math.min(y, window.innerHeight - 300);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] w-52 rounded-md shadow-xl border border-aero-border bg-[#1a2233] overflow-hidden"
      style={{ left: clampedX, top: clampedY }}
    >
      {sections.map((section, si) => (
        <React.Fragment key={si}>
          {si > 0 && <div className="h-px bg-aero-border/50 mx-1" />}
          {section.items.map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => { item.onClick(); onClose(); }}
              className={`
                w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left
                transition-colors select-none
                ${item.disabled
                  ? 'text-gray-600 cursor-not-allowed'
                  : item.danger
                    ? 'text-red-400 hover:bg-red-500/15 cursor-pointer'
                    : 'text-gray-200 hover:bg-white/10 cursor-pointer'
                }
              `}
            >
              {item.icon && (
                <span className="w-4 text-center text-[11px] opacity-70 shrink-0">{item.icon}</span>
              )}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-[10px] text-gray-600 font-mono shrink-0">{item.shortcut}</span>
              )}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
