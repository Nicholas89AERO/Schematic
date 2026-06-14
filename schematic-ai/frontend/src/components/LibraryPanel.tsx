/**
 * Library Panel — six-tab modal for browsing and editing all project libraries:
 *   Drawing Templates | Parts / Symbols | Wires | Cables | Manufacturer Parts | Circuit Templates
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getLibrary, addLibraryItem, updateLibraryItem, deleteLibraryItem, createFromTemplate } from '../api/client';
import type { LibraryType, DrawingTemplate } from '../api/client';
import { useApp } from '../state/AppContext';
import type { DrawingLayer } from '../types/project';

// ─────────────────────────────────────────────
// Tab config
// ─────────────────────────────────────────────

interface TabConfig {
  id: LibraryType;
  label: string;
  icon: string;
  color: string;
  description: string;
  columns: ColumnDef[];
  newItemTemplate: Record<string, unknown>;
}

interface ColumnDef {
  key: string;
  label: string;
  width?: string;
  render?: (val: unknown, row: Record<string, unknown>) => React.ReactNode;
}

const TABS: TabConfig[] = [
  {
    id: 'templates',
    label: 'Drawing Templates',
    icon: '▦',
    color: 'text-aero-accent',
    description: 'Pre-configured drawing sheets — sheet size, title block, layer type, and aerospace notes',
    columns: [
      { key: 'name',       label: 'Template Name', width: 'w-56' },
      { key: 'category',   label: 'Category',      width: 'w-28' },
      { key: 'layer',      label: 'Layer',         width: 'w-24',
        render: (v) => {
          const colors: Record<string, string> = { block_diagram: 'text-aero-orange', schematic: 'text-aero-accent', harness: 'text-aero-green' };
          const labels: Record<string, string> = { block_diagram: 'L1 Block', schematic: 'L2 Schematic', harness: 'L3 Harness' };
          return <span className={colors[String(v)] || 'text-gray-400'}>{labels[String(v)] || String(v)}</span>;
        }},
      { key: 'sheet_size', label: 'Sheet',         width: 'w-14' },
      { key: 'tags',       label: 'Tags',           width: 'w-48',
        render: (v) => Array.isArray(v)
          ? <span className="flex flex-wrap gap-0.5">{(v as string[]).slice(0,3).map(t => <span key={t} className="px-1 bg-white/8 rounded text-[10px] text-gray-400">{t}</span>)}</span>
          : '' },
    ],
    newItemTemplate: { name: '', layer: 'schematic', category: 'Schematic', sheet_size: 'A3', sheet_width_mm: 420, sheet_height_mm: 297, description: '', tags: [], title_block: {}, default_layers: [], notes: '' },
  },
  {
    id: 'symbols',
    label: 'Parts & Symbols',
    icon: '⎍',
    color: 'text-aero-accent',
    description: 'Schematic symbols mapped to DXF block names with pin metadata',
    columns: [
      { key: 'id',             label: 'Block Name',     width: 'w-28' },
      { key: 'description',    label: 'Description',    width: 'w-48' },
      { key: 'component_type', label: 'Type',           width: 'w-28' },
      { key: 'pin_count',      label: 'Pins',           width: 'w-12' },
    ],
    newItemTemplate: { id: '', description: '', component_type: 'unknown', pin_count: 2, pins: [], attributes: [] },
  },
  {
    id: 'wires',
    label: 'Wire Library',
    icon: '─',
    color: 'text-aero-green',
    description: 'Aerospace wire specifications — AWG, insulation, temperature, mil-spec',
    columns: [
      { key: 'part_number',     label: 'Part Number',   width: 'w-44' },
      { key: 'description',     label: 'Description',   width: 'w-52' },
      { key: 'awg',             label: 'AWG',           width: 'w-12' },
      { key: 'insulation',      label: 'Insulation',    width: 'w-24' },
      { key: 'voltage_rating_v',label: 'Vmax',          width: 'w-14',
        render: (v) => v ? `${v}V` : '' },
      { key: 'temp_rating_c',   label: 'Tmax',          width: 'w-14',
        render: (v) => v ? `${v}°C` : '' },
      { key: 'mil_spec',        label: 'Mil-Spec',      width: 'w-28' },
    ],
    newItemTemplate: { part_number: '', description: '', awg: 22, cross_section_mm2: 0.33, insulation: 'PTFE', insulation_color: 'white', voltage_rating_v: 600, temp_rating_c: 200, mil_spec: '', manufacturer: '', notes: '' },
  },
  {
    id: 'cables',
    label: 'Cable Library',
    icon: '⌁',
    color: 'text-aero-orange',
    description: 'Multi-conductor cables, coax, shielded pairs — for harness design',
    columns: [
      { key: 'part_number',    label: 'Part Number',   width: 'w-48' },
      { key: 'description',    label: 'Description',   width: 'w-52' },
      { key: 'cable_type',     label: 'Type',          width: 'w-24' },
      { key: 'conductors',     label: 'Cond.',         width: 'w-14' },
      { key: 'shielded',       label: 'Shield',        width: 'w-14',
        render: (v) => v ? <span className="text-aero-green">✓</span> : <span className="text-gray-600">—</span> },
      { key: 'impedance_ohm',  label: 'Ω',             width: 'w-12',
        render: (v) => v != null ? `${v}Ω` : '' },
      { key: 'mil_spec',       label: 'Spec',          width: 'w-28' },
    ],
    newItemTemplate: { part_number: '', description: '', cable_type: 'multipair', conductors: 2, shielded: false, jacket: 'PTFE', voltage_rating_v: 600, temp_rating_c: 200, mil_spec: '', manufacturer: '', notes: '' },
  },
  {
    id: 'parts',
    label: 'Manufacturer Parts',
    icon: '⊞',
    color: 'text-aero-yellow',
    description: 'Approved manufacturer catalog — CBs, relays, contactors, connectors',
    columns: [
      { key: 'manufacturer',    label: 'Manufacturer',  width: 'w-40' },
      { key: 'part_number',     label: 'Part Number',   width: 'w-48' },
      { key: 'description',     label: 'Description',   width: 'w-52' },
      { key: 'component_type',  label: 'Type',          width: 'w-24' },
      { key: 'rating_a',        label: 'Rating',        width: 'w-16',
        render: (v, r) => v ? `${v}A` : (r.contact_rating_a ? `${r.contact_rating_a}A` : '') },
      { key: 'voltage_v',       label: 'Voltage',       width: 'w-16',
        render: (v, r) => v ? `${v}V` : (r.coil_voltage_v ? `${r.coil_voltage_v}V` : '') },
      { key: 'part_status',     label: 'Status',        width: 'w-16',
        render: (v) => <span className={v === 'active' ? 'text-aero-green' : 'text-aero-red'}>{String(v)}</span> },
    ],
    newItemTemplate: { manufacturer: '', part_number: '', description: '', component_type: 'unknown', voltage_v: 28, part_status: 'active', approvals: [], notes: '' },
  },
  {
    id: 'circuits',
    label: 'Circuit Library',
    icon: '◈',
    color: 'text-purple-400',
    description: 'Pre-built circuit templates — power distribution, data bus, safety, signal conditioning',
    columns: [
      { key: 'name',        label: 'Circuit Name',   width: 'w-56' },
      { key: 'category',    label: 'Category',       width: 'w-32' },
      { key: 'layer',       label: 'Layer',          width: 'w-20' },
      { key: 'ata_chapter', label: 'ATA',            width: 'w-12' },
      { key: 'tags',        label: 'Tags',           width: 'w-48',
        render: (v) => Array.isArray(v)
          ? <span className="flex flex-wrap gap-0.5">{(v as string[]).slice(0,3).map(t => <span key={t} className="px-1 bg-white/8 rounded text-[10px] text-gray-400">{t}</span>)}</span>
          : '' },
    ],
    newItemTemplate: { name: '', category: '', layer: 'schematic', ata_chapter: '', description: '', tags: [], components: [], notes: '' },
  },
];

// ─────────────────────────────────────────────
// Detail / Edit drawer
// ─────────────────────────────────────────────

function DetailDrawer({
  item,
  onClose,
  onSave,
  onDelete,
  isNew,
}: {
  item: Record<string, unknown>;
  onClose: () => void;
  onSave: (updated: Record<string, unknown>) => void;
  onDelete: () => void;
  isNew: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...item });

  const set = (k: string, v: unknown) => setDraft(d => ({ ...d, [k]: v }));

  const renderField = (key: string, val: unknown) => {
    if (key === 'id' && !isNew) {
      return (
        <span className="text-gray-500 font-mono text-xs bg-aero-dark px-2 py-1 rounded">
          {String(val)}
        </span>
      );
    }
    if (typeof val === 'boolean') {
      return (
        <button
          type="button"
          onClick={() => set(key, !val)}
          className={`px-3 py-1 rounded text-xs font-medium border ${
            val ? 'border-aero-green text-aero-green bg-aero-green/10' : 'border-aero-border text-gray-500'
          }`}
        >
          {val ? 'Yes' : 'No'}
        </button>
      );
    }
    if (Array.isArray(val)) {
      return (
        <input
          value={(val as unknown[]).join(', ')}
          onChange={e => set(key, e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          className="w-full bg-aero-dark border border-aero-border rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-aero-accent"
          placeholder="comma-separated values"
        />
      );
    }
    if (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)) && val !== '')) {
      return (
        <input
          type="number"
          value={val === null || val === undefined ? '' : String(val)}
          onChange={e => set(key, e.target.value === '' ? null : Number(e.target.value))}
          className="w-full bg-aero-dark border border-aero-border rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-aero-accent"
        />
      );
    }
    if (key === 'notes' || key === 'description') {
      return (
        <textarea
          value={String(val ?? '')}
          onChange={e => set(key, e.target.value)}
          rows={2}
          className="w-full bg-aero-dark border border-aero-border rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-aero-accent resize-none"
        />
      );
    }
    return (
      <input
        value={String(val ?? '')}
        onChange={e => set(key, e.target.value)}
        className="w-full bg-aero-dark border border-aero-border rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-aero-accent"
      />
    );
  };

  return (
    <div className="w-80 shrink-0 border-l border-aero-border flex flex-col bg-aero-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b border-aero-border">
        <span className="text-xs font-semibold text-gray-300">
          {isNew ? 'New Entry' : 'Edit Entry'}
        </span>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-sm">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {Object.entries(draft)
          .filter(([k]) => !k.startsWith('_'))
          .map(([key, val]) => (
            <div key={key}>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">
                {key.replace(/_/g, ' ')}
              </label>
              {renderField(key, val)}
            </div>
          ))}
      </div>

      <div className="flex gap-2 px-3 py-2 border-t border-aero-border">
        <button
          onClick={() => onSave(draft)}
          className="flex-1 py-1.5 text-xs font-semibold rounded bg-aero-accent text-aero-dark hover:bg-aero-accent/80"
        >
          {isNew ? 'Add' : 'Save'}
        </button>
        {!isNew && (
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-xs rounded border border-aero-red/40 text-aero-red hover:bg-aero-red/10"
          >
            Delete
          </button>
        )}
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded border border-aero-border text-gray-500 hover:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Use Template dialog
// ─────────────────────────────────────────────

function UseTemplateDialog({
  template,
  onClose,
  onCreated,
}: {
  template: DrawingTemplate;
  onClose: () => void;
  onCreated: (projectId: string, layer: DrawingLayer, name: string) => void;
}) {
  const { dispatch } = useApp();
  const [name,           setName]           = useState(template.title_block?.drawing_title as string || template.name);
  const [drawingNumber,  setDrawingNumber]   = useState('');
  const [aircraftType,   setAircraftType]    = useState(template.title_block?.aircraft_type as string || '');
  const [drawnBy,        setDrawnBy]         = useState('');
  const [loading,        setLoading]         = useState(false);
  const [error,          setError]           = useState('');

  const LAYER_COLORS: Record<string, string> = {
    block_diagram: 'text-aero-orange', schematic: 'text-aero-accent', harness: 'text-aero-green',
  };
  const LAYER_LABELS: Record<string, string> = {
    block_diagram: 'L1 — Block Diagram', schematic: 'L2 — Schematic', harness: 'L3 — Harness',
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError('Drawing name is required.'); return; }
    setLoading(true); setError('');
    try {
      const result = await createFromTemplate(
        template.id, name.trim(), drawingNumber.trim(), aircraftType.trim(), drawnBy.trim()
      );
      dispatch({ type: 'SET_PROJECT', project: result, projectId: result.project_id });
      dispatch({ type: 'SET_ACTIVE_LAYER', layer: template.layer as DrawingLayer });
      onCreated(result.project_id, template.layer as DrawingLayer, name.trim());
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || 'Failed to create drawing.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-70 flex items-center justify-center p-6 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg bg-aero-panel border border-aero-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-aero-border bg-aero-dark/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-100">Use Template</h2>
                <p className={`text-xs mt-0.5 ${LAYER_COLORS[template.layer] || 'text-gray-500'}`}>
                  {LAYER_LABELS[template.layer] || template.layer} · {template.sheet_size}
                </p>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-lg shrink-0">✕</button>
            </div>
            {/* Template card */}
            <div className="mt-3 p-3 bg-aero-dark rounded border border-aero-border/50 text-xs text-gray-500">
              <div className="font-medium text-gray-300 mb-1">{template.name}</div>
              <div className="mb-2">{template.description}</div>
              {template.notes && (
                <div className="text-gray-600 text-[10px] italic border-t border-aero-border/30 pt-1 mt-1">
                  {template.notes}
                </div>
              )}
              <div className="flex flex-wrap gap-1 mt-2">
                {template.tags.map(t => (
                  <span key={t} className="px-1.5 py-0.5 bg-white/8 rounded text-[10px] text-gray-500">{t}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Fields */}
          <div className="px-5 py-4 flex flex-col gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">
                Drawing Name <span className="text-aero-red">*</span>
              </label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full bg-aero-dark border border-aero-border rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-aero-accent" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1">Drawing Number</label>
                <input value={drawingNumber} onChange={e => setDrawingNumber(e.target.value)}
                  placeholder="DWG-XX-001"
                  className="w-full bg-aero-dark border border-aero-border rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-aero-accent" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1">Aircraft Type</label>
                <input value={aircraftType} onChange={e => setAircraftType(e.target.value)}
                  placeholder="B737-800"
                  className="w-full bg-aero-dark border border-aero-border rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-aero-accent" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Drawn By</label>
              <input value={drawnBy} onChange={e => setDrawnBy(e.target.value)}
                placeholder="Your name"
                className="w-full bg-aero-dark border border-aero-border rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-aero-accent" />
            </div>
            {error && <div className="text-xs text-aero-red bg-aero-red/10 border border-aero-red/30 rounded px-3 py-2">{error}</div>}
          </div>

          {/* Footer */}
          <div className="flex gap-2 justify-end px-5 py-3 border-t border-aero-border bg-aero-dark/30">
            <button onClick={onClose} className="px-4 py-1.5 text-xs rounded border border-aero-border text-gray-400 hover:text-gray-200">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={loading || !name.trim()}
              className="px-5 py-1.5 text-xs font-semibold rounded bg-aero-accent text-aero-dark hover:bg-aero-accent/80 disabled:opacity-40">
              {loading ? 'Creating…' : 'Create Drawing'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// Main LibraryPanel
// ─────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onTemplateUsed?: (projectId: string, layer: DrawingLayer, name: string) => void;
}

export default function LibraryPanel({ open, onClose, onTemplateUsed }: Props) {
  const [activeTab, setActiveTab]         = useState<LibraryType>('templates');
  const [items, setItems]                 = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading]             = useState(false);
  const [search, setSearch]               = useState('');
  const [selected, setSelected]           = useState<Record<string, unknown> | null>(null);
  const [addingNew, setAddingNew]         = useState(false);
  const [error, setError]                 = useState('');
  const [usingTemplate, setUsingTemplate] = useState<DrawingTemplate | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const tab = TABS.find(t => t.id === activeTab)!;

  const load = useCallback(async (type: LibraryType) => {
    setLoading(true);
    setError('');
    setSelected(null);
    setAddingNew(false);
    try {
      const res = await getLibrary(type);
      setItems(res.items);
    } catch (e: any) {
      setError(e?.message || 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load(activeTab);
  }, [open, activeTab, load]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 60);
  }, [open]);

  if (!open) return null;

  const filtered = items.filter(item => {
    if (!search) return true;
    const q = search.toLowerCase();
    return Object.values(item).some(v =>
      typeof v === 'string' && v.toLowerCase().includes(q)
    );
  });

  const handleSave = async (updated: Record<string, unknown>) => {
    try {
      if (addingNew) {
        await addLibraryItem(activeTab, updated);
      } else {
        await updateLibraryItem(activeTab, String(updated.id ?? ''), updated);
      }
      await load(activeTab);
      setSelected(null);
      setAddingNew(false);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.part_number || selected.name || selected.id}"?`)) return;
    try {
      await deleteLibraryItem(activeTab, String(selected.id ?? ''));
      await load(activeTab);
      setSelected(null);
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-4 z-50 flex flex-col bg-aero-panel border border-aero-border rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-aero-border shrink-0 bg-aero-dark/40">
          <span className="text-aero-accent font-bold text-sm font-mono">⊞ Libraries</span>
          <span className="text-xs text-gray-600">|</span>
          <span className="text-xs text-gray-500">{tab.description}</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-lg leading-none px-1">✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-aero-border shrink-0 bg-aero-panel px-2 pt-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t transition-colors ${
                activeTab === t.id
                  ? `${t.color} bg-aero-dark border-x border-t border-aero-border -mb-px`
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <span className="text-sm">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Table area */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-aero-border shrink-0">
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${tab.label}…`}
                className="flex-1 bg-aero-dark border border-aero-border rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-700 outline-none focus:border-aero-accent"
              />
              <span className="text-xs text-gray-600 font-mono shrink-0">
                {filtered.length} / {items.length}
              </span>
              <button
                onClick={() => { setAddingNew(true); setSelected({ ...tab.newItemTemplate }); }}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded border border-aero-accent/50 text-aero-accent hover:bg-aero-accent/10"
              >
                + Add
              </button>
              <button
                onClick={() => load(activeTab)}
                title="Refresh"
                className="text-gray-500 hover:text-gray-300 px-1 text-sm"
              >↻</button>
            </div>

            {/* Error */}
            {error && (
              <div className="mx-3 mt-2 text-xs text-aero-red bg-aero-red/10 border border-aero-red/30 rounded px-2 py-1">
                {error}
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
                  <span className="animate-spin mr-2">↻</span> Loading…
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-700 text-sm">
                  <div className="text-3xl mb-2 opacity-30">{tab.icon}</div>
                  {search ? `No results for "${search}"` : 'Library is empty — click + Add to start'}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-aero-dark z-10">
                    <tr>
                      {tab.columns.map(col => (
                        <th key={col.key}
                          className={`text-left px-3 py-2 text-gray-500 font-medium border-b border-aero-border uppercase tracking-wider text-[10px] ${col.width || ''}`}>
                          {col.label}
                        </th>
                      ))}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item, i) => {
                      const isSelected = selected === item || (selected?.id && selected.id === item.id);
                      return (
                        <tr
                          key={String(item.id ?? i)}
                          onClick={() => { setSelected(item); setAddingNew(false); }}
                          className={`border-b border-aero-border/30 cursor-pointer transition-colors ${
                            isSelected ? 'bg-aero-accent/10' : 'hover:bg-white/4'
                          }`}
                        >
                          {tab.columns.map(col => (
                            <td key={col.key} className={`px-3 py-2 ${col.width || ''} truncate max-w-0`}>
                              {col.render
                                ? col.render(item[col.key], item)
                                : <span className={col.key === 'id' ? 'font-mono text-gray-400' : 'text-gray-300'}>
                                    {item[col.key] != null ? String(item[col.key]) : ''}
                                  </span>
                              }
                            </td>
                          ))}
                          <td className="px-2 flex items-center gap-1">
                            {activeTab === 'templates' && (
                              <button
                                onClick={e => { e.stopPropagation(); setUsingTemplate(item as unknown as DrawingTemplate); }}
                                className="px-1.5 py-0.5 text-[10px] rounded border border-aero-accent/50 text-aero-accent hover:bg-aero-accent/10 whitespace-nowrap"
                              >Use</button>
                            )}
                            <button
                              onClick={e => { e.stopPropagation(); setSelected(item); setAddingNew(false); }}
                              className="text-gray-600 hover:text-gray-300 text-xs"
                            >✎</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Detail drawer */}
          {(selected || addingNew) && (
            <DetailDrawer
              item={selected ?? { ...tab.newItemTemplate }}
              onClose={() => { setSelected(null); setAddingNew(false); }}
              onSave={handleSave}
              onDelete={handleDelete}
              isNew={addingNew}
            />
          )}
        </div>
      </div>

      {/* Use Template dialog */}
      {usingTemplate && (
        <UseTemplateDialog
          template={usingTemplate}
          onClose={() => setUsingTemplate(null)}
          onCreated={(projectId, layer, name) => {
            setUsingTemplate(null);
            onTemplateUsed?.(projectId, layer, name);
          }}
        />
      )}
    </>
  );
}
