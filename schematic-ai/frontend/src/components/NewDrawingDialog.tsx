/**
 * New Drawing Dialog — template-first two-panel layout.
 *
 * Left:  Template picker (grouped by layer · Blank option per group)
 * Right:
 *   ① Live SVG preview that reacts to property changes
 *   ② Editable properties panel (sheet, layout, drawing settings)
 *   ③ Title-block form fields
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DrawingLayer } from '../types/project';
import { createNewDrawing, createFromTemplate, getLibrary } from '../api/client';
import type { DrawingTemplate } from '../api/client';
import { useApp } from '../state/AppContext';
import TemplatePreviewSVG from './TemplatePreviewSVG';
import type { TemplateProps } from './TemplatePreviewSVG';

// ─── drawing properties ───────────────────────────────────────────────────────

export interface DrawingProperties {
  sheet_size:             string;
  orientation:            'landscape' | 'portrait';
  border_margin_mm:       number;
  title_block_height_mm:  number;
  zone_columns:           number;
  zone_rows:              number;
  grid_size_mm:           number;
  snap_to_grid:           boolean;
  symbol_standard:        string;
  show_revision_table:    boolean;
  show_approval_block:    boolean;
  show_zone_markers:      boolean;
  line_weight_mm:         number;
  text_height_mm:         number;
  // schematic extras
  power_rail_voltage?:    string;
  wire_label_format?:     string;
  // harness extras
  show_formboard_area?:   boolean;
  show_wire_list_table?:  boolean;
  show_connector_details?: boolean;
  dimension_units?:       string;
  trunk_line_weight_mm?:  number;
  table_row_height_mm?:   number;
  // harness wire list extras
  sort_by?:               string;
  include_length_column?: boolean;
  include_spec_column?:   boolean;
  // connector detail extras
  show_face_view?:        boolean;
  pin_table_columns?:     string;
  bus_type?:              string;
  show_shield_grounds?:   boolean;
}

const DEFAULTS: DrawingProperties = {
  sheet_size: 'A3', orientation: 'landscape',
  border_margin_mm: 10, title_block_height_mm: 40,
  zone_columns: 8, zone_rows: 6,
  grid_size_mm: 5, snap_to_grid: true,
  symbol_standard: 'IEC 60617',
  show_revision_table: true, show_approval_block: true, show_zone_markers: true,
  line_weight_mm: 0.25, text_height_mm: 3.0,
};

// ─── property field schema type ───────────────────────────────────────────────

interface PropField {
  value: unknown;
  type: 'select' | 'number' | 'boolean' | 'text';
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  label: string;
}

type PropertiesSchema = Record<string, PropField>;

function schemaToProps(schema: PropertiesSchema): DrawingProperties {
  const result: Record<string, unknown> = { ...DEFAULTS };
  for (const [k, v] of Object.entries(schema)) {
    result[k] = v.value;
  }
  return result as unknown as DrawingProperties;
}

// ─── template / blank selection ───────────────────────────────────────────────

interface BlankSel   { kind: 'blank';    layer: DrawingLayer; }
interface TemplateSel{ kind: 'template'; template: DrawingTemplate; }
type Selection = BlankSel | TemplateSel | null;

type FilterTab = 'all' | DrawingLayer;

const LAYER_META = {
  block_diagram: { badge:'L1', label:'Block Diagram',  color:'text-aero-orange',  ring:'border-aero-orange/50 bg-aero-orange/5'  },
  schematic:     { badge:'L2', label:'Schematic',      color:'text-aero-accent',  ring:'border-aero-accent/50 bg-aero-accent/5'  },
  harness:       { badge:'L3', label:'Harness',        color:'text-aero-green',   ring:'border-aero-green/50 bg-aero-green/5'    },
};

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id:'all',           label:'All'          },
  { id:'block_diagram', label:'L1 Block'     },
  { id:'schematic',     label:'L2 Schematic' },
  { id:'harness',       label:'L3 Harness'   },
];

function layerOf(sel: Selection): DrawingLayer {
  if (!sel) return 'schematic';
  return sel.kind === 'blank' ? sel.layer : (sel.template.layer as DrawingLayer);
}

// ─── sub-components ──────────────────────────────────────────────────────────

function TemplateCard({ sel, onClick, layer, title, subtitle, badge, isBlank }: {
  sel: boolean; onClick:()=>void; layer: DrawingLayer;
  title: string; subtitle: string; badge?: string; isBlank?: boolean;
}) {
  const m = LAYER_META[layer];
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all mb-1 ${
        sel ? `${m.ring} border-current` : 'border-aero-border/40 hover:border-aero-border hover:bg-white/4'
      }`}>
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[10px] font-bold font-mono px-1 py-0.5 rounded border shrink-0 ${
            sel ? `${m.color} border-current` : 'text-gray-600 border-gray-700'
          }`}>{m.badge}</span>
          <span className={`text-xs font-medium truncate ${sel ? 'text-gray-100' : 'text-gray-300'}`}>{title}</span>
        </div>
        {badge   && <span className={`text-[10px] shrink-0 px-1 rounded ${sel ? 'text-gray-500 border border-gray-600' : 'text-gray-700'}`}>{badge}</span>}
        {isBlank && <span className="text-[10px] text-gray-700 italic shrink-0">blank</span>}
      </div>
      <p className={`text-[10px] mt-0.5 leading-snug line-clamp-2 ${sel ? 'text-gray-400' : 'text-gray-600'}`}>{subtitle}</p>
    </button>
  );
}

const INPUT = 'w-full bg-aero-dark border border-aero-border rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-700 outline-none focus:border-aero-accent transition-colors disabled:opacity-40';
const SELECT = INPUT + ' cursor-pointer';

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-h-[22px]">
      <span className="text-[10px] text-gray-500 w-32 shrink-0 leading-tight">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-400 font-medium mb-1">
        {label}{req && <span className="text-aero-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── props editor ─────────────────────────────────────────────────────────────

/** Groups properties by category for organised display */
const PROP_GROUPS: Record<string, { label: string; keys: string[] }> = {
  sheet:    { label: 'Sheet',           keys: ['sheet_size','orientation'] },
  layout:   { label: 'Layout',          keys: ['border_margin_mm','title_block_height_mm','zone_columns','zone_rows'] },
  drawing:  { label: 'Drawing',         keys: ['grid_size_mm','snap_to_grid','symbol_standard','line_weight_mm','text_height_mm'] },
  features: { label: 'Features',        keys: ['show_revision_table','show_approval_block','show_zone_markers'] },
  extras:   { label: 'Extras',          keys: ['power_rail_voltage','wire_label_format','bus_type','show_shield_grounds','dimension_units','trunk_line_weight_mm','show_formboard_area','show_wire_list_table','show_connector_details','table_row_height_mm','sort_by','include_length_column','include_spec_column','show_face_view','pin_table_columns'] },
};

function PropertiesEditor({
  schema,
  onUpdate,
}: {
  schema: PropertiesSchema;
  onUpdate: (key: string, value: unknown) => void;
}) {
  if (!schema || Object.keys(schema).length === 0) return null;

  const renderField = (key: string, field: PropField) => {
    const id = `prop-${key}`;
    if (field.type === 'boolean') {
      return (
        <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" id={id} checked={field.value as boolean}
            onChange={e => onUpdate(key, e.target.checked)}
            className="w-3 h-3 accent-aero-accent" />
          <span className="text-[10px] text-gray-400">{field.label}</span>
        </label>
      );
    }
    if (field.type === 'select') {
      return (
        <PropRow key={key} label={field.label}>
          <select id={id} value={field.value as string}
            onChange={e => onUpdate(key, e.target.value)}
            className={SELECT + ' py-1 text-[10px]'}>
            {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </PropRow>
      );
    }
    if (field.type === 'number') {
      return (
        <PropRow key={key} label={field.label}>
          <input type="number" id={id} value={field.value as number}
            min={field.min} max={field.max} step={field.step ?? 1}
            onChange={e => onUpdate(key, parseFloat(e.target.value) || field.min || 0)}
            className={INPUT + ' py-1 text-[10px]'} />
        </PropRow>
      );
    }
    // text
    return (
      <PropRow key={key} label={field.label}>
        <input type="text" id={id} value={field.value as string}
          onChange={e => onUpdate(key, e.target.value)}
          className={INPUT + ' py-1 text-[10px]'} />
      </PropRow>
    );
  };

  // Build group renderers
  const boolKeys  = Object.entries(schema).filter(([, f]) => f.type === 'boolean');
  const otherKeys = Object.entries(schema).filter(([, f]) => f.type !== 'boolean');

  return (
    <div className="flex flex-col gap-3">
      {/* Non-boolean fields grouped */}
      {Object.entries(PROP_GROUPS).map(([gid, g]) => {
        const relevant = otherKeys.filter(([k]) => g.keys.includes(k) && schema[k]);
        if (relevant.length === 0) return null;
        return (
          <div key={gid}>
            <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-1.5">{g.label}</div>
            <div className="flex flex-col gap-1.5">
              {relevant.map(([k, f]) => renderField(k, f))}
            </div>
          </div>
        );
      })}
      {/* Boolean toggles in a compact grid */}
      {boolKeys.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Toggles</div>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-3">
            {boolKeys.map(([k, f]) => renderField(k, f))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  defaultParentId?: string;
  onClose: () => void;
  onCreated: (projectId: string, layer: DrawingLayer, name: string, sheetCount: number) => void;
}

export default function NewDrawingDialog({ open, onClose, onCreated }: Props) {
  const { dispatch } = useApp();

  // ── template list ────────────────────────────────────────────────────────────
  const [templates,  setTemplates]  = useState<DrawingTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [filterTab,  setFilterTab]  = useState<FilterTab>('all');
  const [tplSearch,  setTplSearch]  = useState('');

  // ── selection ────────────────────────────────────────────────────────────────
  const [selection,  setSelection]  = useState<Selection>(null);

  // ── properties ───────────────────────────────────────────────────────────────
  const [propSchema, setPropSchema] = useState<PropertiesSchema>({});
  const [props,      setProps]      = useState<DrawingProperties>({ ...DEFAULTS });

  // ── title block form ─────────────────────────────────────────────────────────
  const [name,          setName]          = useState('');
  const [drawingNumber, setDrawingNumber] = useState('');
  const [revision,      setRevision]      = useState('A');
  const [ataChapter,    setAtaChapter]    = useState('');
  const [aircraftType,  setAircraftType]  = useState('');
  const [drawnBy,       setDrawnBy]       = useState('');

  // ── misc ─────────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [propOpen, setPropOpen] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);

  // ── load templates ───────────────────────────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    setTplLoading(true);
    try {
      const res = await getLibrary('templates');
      setTemplates(res.items as unknown as DrawingTemplate[]);
    } catch { /* ignore */ }
    setTplLoading(false);
  }, []);

  useEffect(() => { if (open) loadTemplates(); }, [open, loadTemplates]);

  // ── reset on open ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setSelection(null); setPropSchema({}); setProps({ ...DEFAULTS });
      setName(''); setDrawingNumber(''); setRevision('A');
      setAtaChapter(''); setAircraftType(''); setDrawnBy('');
      setError(''); setFilterTab('all'); setTplSearch('');
      setTimeout(() => nameRef.current?.focus(), 80);
    }
  }, [open]);

  // ── apply template selection ─────────────────────────────────────────────────
  const applySelection = (sel: Selection) => {
    setSelection(sel);
    if (!sel || sel.kind === 'blank') {
      setPropSchema({});
      setProps({ ...DEFAULTS });
      setName(''); setDrawingNumber(''); setRevision('A');
      setAtaChapter(''); setAircraftType(''); setDrawnBy('');
      return;
    }
    const t  = sel.template;
    const tb = (t.title_block as Record<string, string>) ?? {};

    // Apply template properties
    const schema = (t as any).properties as PropertiesSchema ?? {};
    setPropSchema(schema);
    setProps(schemaToProps(schema));

    // Fill title block
    setName(tb.drawing_title || t.name);
    setDrawingNumber(tb.drawing_number || '');
    setRevision(tb.revision || 'A');
    setAtaChapter(tb.ata_chapter || '');
    setAircraftType(tb.aircraft_type || '');
    setDrawnBy(tb.drawn_by || '');
    setTimeout(() => nameRef.current?.focus(), 60);
  };

  // ── update single property ───────────────────────────────────────────────────
  const updateProp = (key: string, value: unknown) => {
    // Update schema
    setPropSchema(prev => {
      if (!prev[key]) return prev;
      return { ...prev, [key]: { ...prev[key], value } };
    });
    // Update flattened props
    setProps(prev => ({ ...prev, [key]: value }));
  };

  // ── filter templates ─────────────────────────────────────────────────────────
  const filtered = templates.filter(t => {
    if (filterTab !== 'all' && t.layer !== filterTab) return false;
    if (tplSearch) {
      const q = tplSearch.toLowerCase();
      return t.name.toLowerCase().includes(q)
        || t.description?.toLowerCase().includes(q)
        || t.tags?.some(tg => tg.toLowerCase().includes(q));
    }
    return true;
  });

  const grouped: Record<string, DrawingTemplate[]> = {};
  filtered.forEach(t => { (grouped[t.layer] ??= []).push(t); });
  const LAYERS: DrawingLayer[] = ['block_diagram', 'schematic', 'harness'];

  // ── submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selection) { setError('Please select a template or blank drawing type.'); return; }
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Drawing name is required.'); return; }

    setLoading(true); setError('');
    try {
      let result: any;
      if (selection.kind === 'template') {
        result = await createFromTemplate(
          selection.template.id,
          trimmedName,
          drawingNumber.trim(),
          aircraftType.trim(),
          drawnBy.trim(),
        );
      } else {
        result = await createNewDrawing({
          layer: selection.layer,
          name: trimmedName,
          drawing_number: drawingNumber.trim(),
          revision: revision.trim() || 'A',
          ata_chapter: ataChapter.trim(),
          aircraft_type: aircraftType.trim(),
          drawn_by: drawnBy.trim(),
        });
      }
      const layer = layerOf(selection);
      dispatch({ type: 'SET_PROJECT', project: result, projectId: result.project_id });
      dispatch({ type: 'SET_ACTIVE_LAYER', layer });
      onCreated(result.project_id, layer, trimmedName, result.sheet_count ?? 1);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to create drawing.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const layer      = layerOf(selection);
  const layerMeta  = LAYER_META[layer];
  const hasSchema  = Object.keys(propSchema).length > 0;

  // Build preview props from current state
  const previewProps: TemplateProps = {
    layer,
    sheetSize:            props.sheet_size,
    orientation:          props.orientation as 'landscape' | 'portrait',
    titleBlockHeightMm:   props.title_block_height_mm,
    borderMarginMm:       props.border_margin_mm,
    zoneColumns:          props.zone_columns,
    zoneRows:             props.zone_rows,
    showZoneMarkers:      props.show_zone_markers,
    showRevisionTable:    props.show_revision_table,
    showApprovalBlock:    props.show_approval_block,
    showFormboardArea:    props.show_formboard_area,
    showWireListTable:    props.show_wire_list_table,
    showConnectorDetails: props.show_connector_details,
  };

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <form
          onSubmit={handleSubmit}
          onClick={e => e.stopPropagation()}
          className="pointer-events-auto w-full bg-aero-panel border border-aero-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxWidth: 1080, maxHeight: 'calc(100vh - 40px)' }}
        >
          {/* ── Header ───────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-aero-border bg-aero-dark/40 shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-gray-100">New Drawing</h2>
              <p className="text-xs text-gray-500 mt-0.5">Pick a template · adjust properties · fill title block</p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-200 text-lg">✕</button>
          </div>

          {/* ── Body ─────────────────────────────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden min-h-0">

            {/* ─ Left: Template picker ─────────────────────────────────────── */}
            <div className="w-60 shrink-0 flex flex-col border-r border-aero-border bg-aero-dark/30 overflow-hidden">
              <div className="px-2.5 py-2 border-b border-aero-border/40 shrink-0">
                <input value={tplSearch} onChange={e => setTplSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full bg-aero-dark border border-aero-border/50 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-aero-accent" />
              </div>
              <div className="flex border-b border-aero-border/40 shrink-0">
                {FILTER_TABS.map(tab => (
                  <button key={tab.id} type="button" onClick={() => setFilterTab(tab.id)}
                    className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${
                      filterTab === tab.id
                        ? 'text-aero-accent border-b-2 border-aero-accent -mb-px bg-aero-accent/5'
                        : 'text-gray-600 hover:text-gray-400'
                    }`}>{tab.label}</button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {tplLoading ? (
                  <p className="text-xs text-gray-600 text-center py-6">Loading…</p>
                ) : filterTab === 'all' ? (
                  LAYERS.map(lay => {
                    const grp = grouped[lay] || [];
                    if (grp.length === 0 && tplSearch) return null;
                    const m = LAYER_META[lay];
                    return (
                      <div key={lay}>
                        <div className={`text-[10px] font-semibold uppercase tracking-wider px-1 py-1 ${m.color}`}>
                          {m.badge} — {m.label}
                        </div>
                        {!tplSearch && (
                          <TemplateCard layer={lay} title="Blank Drawing"
                            subtitle="Empty sheet, no pre-filled fields"
                            isBlank
                            sel={selection?.kind==='blank' && selection.layer===lay}
                            onClick={() => applySelection({ kind:'blank', layer:lay })} />
                        )}
                        {grp.map(t => (
                          <TemplateCard key={t.id} layer={lay} title={t.name}
                            subtitle={t.description} badge={t.sheet_size}
                            sel={selection?.kind==='template' && selection.template.id===t.id}
                            onClick={() => applySelection({ kind:'template', template:t })} />
                        ))}
                        <div className="border-t border-aero-border/20 my-1.5" />
                      </div>
                    );
                  })
                ) : (
                  <>
                    {!tplSearch && (
                      <TemplateCard layer={filterTab as DrawingLayer} title="Blank Drawing"
                        subtitle="Empty sheet, no pre-filled fields" isBlank
                        sel={selection?.kind==='blank' && selection.layer===filterTab}
                        onClick={() => applySelection({ kind:'blank', layer: filterTab as DrawingLayer })} />
                    )}
                    {filtered.length === 0 && tplSearch && (
                      <p className="text-xs text-gray-600 text-center py-4">No match for "{tplSearch}"</p>
                    )}
                    {filtered.map(t => (
                      <TemplateCard key={t.id} layer={t.layer as DrawingLayer} title={t.name}
                        subtitle={t.description} badge={t.sheet_size}
                        sel={selection?.kind==='template' && selection.template.id===t.id}
                        onClick={() => applySelection({ kind:'template', template:t })} />
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* ─ Middle: Preview + Properties ──────────────────────────────── */}
            <div className="w-80 shrink-0 flex flex-col border-r border-aero-border overflow-hidden bg-aero-dark/10">

              {/* SVG preview */}
              <div className="px-3 pt-3 pb-2 shrink-0 border-b border-aero-border/40">
                <div className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold mb-2">Preview</div>
                {selection ? (
                  <div className="rounded-lg overflow-hidden border border-aero-border/40">
                    <TemplatePreviewSVG {...previewProps} className="w-full h-auto" />
                  </div>
                ) : (
                  <div className="h-36 rounded-lg border border-aero-border/30 bg-aero-dark/40 flex items-center justify-center">
                    <p className="text-xs text-gray-700">Select a template to preview</p>
                  </div>
                )}
              </div>

              {/* Properties editor */}
              <div className="flex-1 overflow-y-auto px-3 py-3">
                {!hasSchema ? (
                  <p className="text-[10px] text-gray-700 italic text-center py-4">
                    {selection?.kind === 'blank'
                      ? 'Blank drawings use default properties.'
                      : 'Select a template to edit its properties.'}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Properties</span>
                      <button type="button" onClick={() => setPropOpen(v => !v)}
                        className="text-[10px] text-gray-600 hover:text-gray-400">
                        {propOpen ? '▾ collapse' : '▸ expand'}
                      </button>
                    </div>
                    {propOpen && (
                      <PropertiesEditor schema={propSchema} onUpdate={updateProp} />
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ─ Right: Title block fields ──────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Selected banner */}
              <div className="px-4 py-2.5 border-b border-aero-border/40 shrink-0 bg-aero-dark/20">
                {!selection ? (
                  <p className="text-xs text-gray-600 italic">← Select a template or blank drawing</p>
                ) : selection.kind === 'blank' ? (
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${layerMeta.color} border-current`}>
                      {layerMeta.badge}</span>
                    <span className="text-xs text-gray-300">Blank {layerMeta.label}</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${layerMeta.color} border-current`}>
                      {layerMeta.badge}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-100 truncate">{selection.template.name}</span>
                        <span className="text-[10px] text-gray-600 shrink-0">{selection.template.sheet_size}</span>
                      </div>
                      {selection.template.notes && (
                        <p className="text-[10px] text-gray-600 mt-0.5 line-clamp-2 italic">{selection.template.notes}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Form fields */}
              <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
                <Field label="Drawing Name" req>
                  <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
                    placeholder={selection?.kind==='template' ? 'Override template name…' : `e.g. ATA24 Power Distribution`}
                    className={INPUT} disabled={!selection} />
                </Field>

                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Drawing Number">
                    <input value={drawingNumber} onChange={e => setDrawingNumber(e.target.value)}
                      placeholder="DWG-24-001" className={INPUT} disabled={!selection} />
                  </Field>
                  <Field label="Revision">
                    <input value={revision} onChange={e => setRevision(e.target.value)}
                      placeholder="A" maxLength={4} className={INPUT} disabled={!selection} />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="ATA Chapter">
                    <input value={ataChapter} onChange={e => setAtaChapter(e.target.value)}
                      placeholder="24" className={INPUT} disabled={!selection} />
                  </Field>
                  <Field label="Aircraft Type">
                    <input value={aircraftType} onChange={e => setAircraftType(e.target.value)}
                      placeholder="B737-800" className={INPUT} disabled={!selection} />
                  </Field>
                </div>

                <Field label="Drawn By">
                  <input value={drawnBy} onChange={e => setDrawnBy(e.target.value)}
                    placeholder="Your name" className={INPUT} disabled={!selection} />
                </Field>

                {/* Tags row */}
                {selection?.kind === 'template' && (selection.template.tags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {selection.template.tags.map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded-full bg-white/6 border border-aero-border/50 text-gray-500">{tag}</span>
                    ))}
                  </div>
                )}

                {/* Default layers */}
                {selection?.kind === 'template' && (selection.template.default_layers?.length ?? 0) > 0 && (
                  <div className="p-2.5 rounded border border-aero-border/40 bg-aero-dark/30">
                    <p className="text-[10px] text-gray-600 font-medium mb-1.5">Drawing layers included</p>
                    <div className="flex flex-wrap gap-1">
                      {selection.template.default_layers.map(l => (
                        <span key={l} className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 text-gray-500 font-mono">{l}</span>
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="text-xs text-aero-red bg-aero-red/10 border border-aero-red/30 rounded px-3 py-2">{error}</div>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer ───────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-aero-border bg-aero-dark/50 shrink-0">
            <div className="text-[10px] text-gray-600">
              {selection?.kind === 'template'
                ? `Template: ${selection.template.name} · ${props.sheet_size} ${props.orientation}`
                : selection?.kind === 'blank'
                ? `Blank ${LAYER_META[selection.layer].label} · ${props.sheet_size}`
                : 'No selection'}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded border border-aero-border hover:border-gray-500 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={loading || !selection || !name.trim()}
                className="px-5 py-1.5 text-xs font-semibold rounded bg-aero-accent text-aero-dark hover:bg-aero-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {loading ? 'Creating…' : 'Create Drawing'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
