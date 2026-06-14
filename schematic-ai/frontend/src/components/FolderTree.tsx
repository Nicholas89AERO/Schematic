import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useApp } from '../state/AppContext';
import type { TreeNode } from '../state/reducer';
import type { DrawingLayer } from '../types/project';

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

function Icon({ name, className = '' }: { name: string; className?: string }) {
  const icons: Record<string, string> = {
    project:       '◈',
    folder_open:   '▾ 📂',
    folder_closed: '▸ 📁',
    drawing_bd:    '□',
    drawing_sch:   '⎍',
    drawing_hrn:   '⌁',
    drawing:       '⎔',
    add:           '+',
    rename:        '✎',
    delete:        '✕',
    chevron_right: '▸',
    chevron_down:  '▾',
  };
  return <span className={`select-none ${className}`}>{icons[name] ?? '·'}</span>;
}

const LAYER_ICON: Record<DrawingLayer, string> = {
  block_diagram: 'drawing_bd',
  schematic:     'drawing_sch',
  harness:       'drawing_hrn',
};
const LAYER_COLOR: Record<DrawingLayer, string> = {
  block_diagram: 'text-aero-orange',
  schematic:     'text-aero-accent',
  harness:       'text-aero-green',
};
const LAYER_LABEL: Record<DrawingLayer, string> = {
  block_diagram: 'L1',
  schematic:     'L2',
  harness:       'L3',
};

// ─────────────────────────────────────────────
// Context menu
// ─────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
  nodeType: TreeNode['type'];
}

function ContextMenu({
  menu,
  onClose,
  onAction,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onAction: (action: string, nodeId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const items: { label: string; action: string; danger?: boolean }[] = [];

  if (menu.nodeType === 'project' || menu.nodeType === 'folder') {
    items.push(
      { label: '✦ New Drawing', action: 'add_drawing' },
      { label: '+ New Folder', action: 'add_folder' },
      { label: 'Rename', action: 'rename' },
    );
  }
  if (menu.nodeType === 'drawing') {
    items.push({ label: 'Rename', action: 'rename' });
  }
  items.push({ label: 'Delete', action: 'delete', danger: true });

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-aero-panel border border-aero-border rounded shadow-xl py-1 min-w-36 text-xs"
      style={{ top: menu.y, left: menu.x }}
    >
      {items.map(item => (
        <button
          key={item.action}
          onClick={() => { onAction(item.action, menu.nodeId); onClose(); }}
          className={`w-full text-left px-3 py-1.5 hover:bg-aero-border/40 ${
            item.danger ? 'text-aero-red' : 'text-gray-300'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Single tree row
// ─────────────────────────────────────────────

function TreeRow({
  node,
  depth,
  isSelected,
  isRenaming,
  onSelect,
  onToggle,
  onContextMenu,
  onRenameCommit,
  onAddFolder,
  onAddProject,
  isRoot,
}: {
  node: TreeNode;
  depth: number;
  isSelected: boolean;
  isRenaming: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameCommit: (name: string) => void;
  onAddFolder: () => void;
  onAddProject: () => void;
  isRoot?: boolean;
}) {
  const renameRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(node.name);

  useEffect(() => {
    if (isRenaming) {
      setDraft(node.name);
      setTimeout(() => {
        renameRef.current?.focus();
        renameRef.current?.select();
      }, 30);
    }
  }, [isRenaming, node.name]);

  const commitRename = () => {
    const trimmed = draft.trim();
    onRenameCommit(trimmed || node.name);
  };

  const hasChildren = node.childIds.length > 0;
  const indent = depth * 14;

  // Icon for this node
  let iconName = 'drawing';
  if (node.type === 'project') iconName = 'project';
  else if (node.type === 'folder') iconName = node.expanded ? 'folder_open' : 'folder_closed';
  else if (node.drawing) iconName = LAYER_ICON[node.drawing.layer] || 'drawing';

  const textColor =
    node.type === 'project' ? 'text-aero-accent font-semibold' :
    node.type === 'folder'  ? 'text-gray-300 font-medium' :
    node.drawing             ? LAYER_COLOR[node.drawing.layer] : 'text-gray-400';

  return (
    <div
      className={`group flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer text-xs
        ${isSelected ? 'bg-aero-accent/15 outline outline-1 outline-aero-accent/30' : 'hover:bg-aero-border/20'}
      `}
      style={{ paddingLeft: `${indent + 4}px` }}
      onClick={onSelect}
      onDoubleClick={() => { if (node.type !== 'drawing') onToggle(); }}
      onContextMenu={onContextMenu}
    >
      {/* Expand chevron */}
      <span
        className="w-3 shrink-0 text-gray-600 hover:text-gray-300"
        onClick={e => { e.stopPropagation(); if (hasChildren || node.type !== 'drawing') onToggle(); }}
      >
        {(node.type !== 'drawing' || hasChildren) && (
          node.expanded ? '▾' : '▸'
        )}
      </span>

      {/* Node icon */}
      <span className={`shrink-0 text-xs ${textColor} leading-none`}>
        {node.type === 'project' && '◈'}
        {node.type === 'folder'  && (node.expanded ? '▾ 📂' : '▸ 📁').split(' ')[1]}
        {node.type === 'drawing' && (
          <span className={LAYER_COLOR[node.drawing?.layer || 'schematic']}>
            {LAYER_LABEL[node.drawing?.layer || 'schematic']}
          </span>
        )}
      </span>

      {/* Name / rename input */}
      {isRenaming ? (
        <input
          ref={renameRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') onRenameCommit(node.name);
            e.stopPropagation();
          }}
          onClick={e => e.stopPropagation()}
          className="flex-1 bg-aero-dark border border-aero-accent rounded px-1 py-0 text-xs text-gray-200 outline-none min-w-0"
        />
      ) : (
        <span className={`flex-1 truncate leading-5 ${textColor}`}>
          {node.name}
        </span>
      )}

      {/* Drawing badge */}
      {node.type === 'drawing' && node.drawing && !isRenaming && (
        <span className="shrink-0 text-gray-600 text-xs font-mono">
          {node.drawing.sheets}sh
        </span>
      )}

      {/* Inline action buttons (appear on hover) */}
      {!isRenaming && (
        <span className="shrink-0 hidden group-hover:flex gap-0.5 items-center">
          {node.type !== 'drawing' && (
            <button
              title="New Folder"
              onClick={e => { e.stopPropagation(); onAddFolder(); }}
              className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-aero-accent rounded"
            >+</button>
          )}
          <button
            title="More options"
            onClick={e => { e.stopPropagation(); onContextMenu(e); }}
            className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-200 rounded"
          >⋯</button>
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Recursive sub-tree renderer
// ─────────────────────────────────────────────

function SubTree({
  nodeId,
  depth,
  onContextMenu,
  onDrawingClick,
}: {
  nodeId: string;
  depth: number;
  onContextMenu: (e: React.MouseEvent, nodeId: string, type: TreeNode['type']) => void;
  onDrawingClick: (node: TreeNode) => void;
}) {
  const { state, dispatch } = useApp();
  const node = state.treeNodes[nodeId];
  if (!node) return null;

  const isSelected  = state.selectedTreeNodeId === nodeId;
  const isRenaming  = state.renamingNodeId === nodeId;

  const handleSelect = () => {
    dispatch({ type: 'TREE_SELECT_NODE', nodeId });
    if (node.type === 'drawing') onDrawingClick(node);
  };

  const handleToggle = () => dispatch({ type: 'TREE_TOGGLE_EXPAND', nodeId });

  const handleRenameCommit = (name: string) =>
    dispatch({ type: 'TREE_RENAME_NODE', nodeId, name });

  const handleAddFolder = () =>
    dispatch({ type: 'TREE_ADD_FOLDER', parentId: nodeId });

  return (
    <>
      <TreeRow
        node={node}
        depth={depth}
        isSelected={isSelected}
        isRenaming={isRenaming}
        onSelect={handleSelect}
        onToggle={handleToggle}
        onContextMenu={e => onContextMenu(e, nodeId, node.type)}
        onRenameCommit={handleRenameCommit}
        onAddFolder={handleAddFolder}
        onAddProject={() => {}}
      />
      {node.expanded && node.childIds.map(childId => (
        <SubTree
          key={childId}
          nodeId={childId}
          depth={depth + 1}
          onContextMenu={onContextMenu}
          onDrawingClick={onDrawingClick}
        />
      ))}
    </>
  );
}

// ─────────────────────────────────────────────
// PUBLIC: FolderTree
// ─────────────────────────────────────────────

interface Props {
  onDrawingOpen: (projectId: string, layer: DrawingLayer) => void;
  onNewDrawing?: () => void;
}

export default function FolderTree({ onDrawingOpen, onNewDrawing }: Props) {
  const { state, dispatch } = useApp();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const openContextMenu = useCallback((
    e: React.MouseEvent,
    nodeId: string,
    nodeType: TreeNode['type'],
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, nodeType });
  }, []);

  const handleContextAction = (action: string, nodeId: string) => {
    const node = state.treeNodes[nodeId];
    if (!node) return;
    switch (action) {
      case 'add_folder':
        dispatch({ type: 'TREE_ADD_FOLDER', parentId: nodeId });
        break;
      case 'rename':
        dispatch({ type: 'TREE_START_RENAME', nodeId });
        break;
      case 'delete':
        if (window.confirm(`Delete "${node.name}" and all its contents?`)) {
          dispatch({ type: 'TREE_DELETE_NODE', nodeId });
        }
        break;
      case 'add_drawing':
        dispatch({ type: 'TREE_SELECT_NODE', nodeId });
        onNewDrawing?.();
        break;
    }
  };

  const handleDrawingClick = (node: TreeNode) => {
    if (node.drawing) {
      onDrawingOpen(node.drawing.projectId, node.drawing.layer);
    }
  };

  // Selected parent for new drawings — walk up to find project/folder
  const getSelectedFolderId = (): string => {
    if (state.selectedTreeNodeId) {
      const n = state.treeNodes[state.selectedTreeNodeId];
      if (n && n.type !== 'drawing') return state.selectedTreeNodeId;
      if (n?.parentId) return n.parentId;
    }
    return state.treeRoots[0] || '';
  };

  return (
    <div className="flex flex-col h-full select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-aero-border">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Explorer</span>
        <div className="flex gap-1">
          <button
            title="New Project"
            onClick={() => dispatch({ type: 'TREE_ADD_PROJECT' })}
            className="text-xs px-1.5 py-0.5 rounded border border-aero-border text-gray-500 hover:border-aero-accent hover:text-aero-accent"
          >
            + Project
          </button>
          {state.selectedTreeNodeId && state.treeNodes[state.selectedTreeNodeId]?.type !== 'drawing' && (
            <button
              title="New Folder"
              onClick={() => dispatch({
                type: 'TREE_ADD_FOLDER',
                parentId: getSelectedFolderId(),
              })}
              className="text-xs px-1.5 py-0.5 rounded border border-aero-border text-gray-500 hover:border-aero-accent hover:text-aero-accent"
            >
              + Folder
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {state.treeRoots.length === 0 ? (
          <div className="text-center text-gray-600 text-xs mt-6 px-4">
            <div className="text-2xl mb-2 opacity-30">◈</div>
            <p>No projects yet.</p>
            <button
              onClick={() => dispatch({ type: 'TREE_ADD_PROJECT' })}
              className="mt-2 text-aero-accent hover:underline"
            >
              + Create a project
            </button>
          </div>
        ) : (
          state.treeRoots.map(rootId => (
            <SubTree
              key={rootId}
              nodeId={rootId}
              depth={0}
              onContextMenu={openContextMenu}
              onDrawingClick={handleDrawingClick}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />
      )}
    </div>
  );
}

// Export helper for Sidebar to add a drawing node after parse
export function useTreeAddDrawing() {
  const { state, dispatch } = useApp();

  return (
    filename: string,
    projectId: string,
    layer: DrawingLayer,
    sheets: number,
  ) => {
    // Find the selected folder, or fall back to the first root
    let parentId = state.selectedTreeNodeId || '';
    if (!parentId || state.treeNodes[parentId]?.type === 'drawing') {
      // Use the parent of the selected drawing, or first root
      const selectedNode = parentId ? state.treeNodes[parentId] : null;
      parentId = selectedNode?.parentId || state.treeRoots[0] || '';
    }

    if (!parentId) {
      // Auto-create a project if tree is empty
      const newProjectId = crypto.randomUUID();
      dispatch({ type: 'TREE_ADD_PROJECT', name: 'My Project' });
      // Wait for state update — add drawing on next tick
      setTimeout(() => {
        dispatch({
          type: 'TREE_ADD_DRAWING',
          parentId: newProjectId,
          name: filename,
          drawing: { projectId, layer, sheets, filename },
        });
      }, 50);
      return;
    }

    dispatch({
      type: 'TREE_ADD_DRAWING',
      parentId,
      name: filename,
      drawing: { projectId, layer, sheets, filename },
    });
  };
}
