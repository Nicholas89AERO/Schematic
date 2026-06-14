import axios from 'axios';
import type { DrawingLayer, LayerDetectionResult, ParseJob, ProjectModel, ConsistencyResult } from '../types/project';
import type { ComplianceReport } from '../types/compliance';

const BASE = '/api';

const api = axios.create({ baseURL: BASE });

// ── Parse & Detect ────────────────────────────────────────────────────

export async function detectLayer(file: File): Promise<LayerDetectionResult> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post<LayerDetectionResult>('/detect-layer', fd);
  return data;
}

export async function startParse(
  file: File,
  layerHint?: DrawingLayer,
  projectId?: string,
): Promise<{ job_id: string }> {
  const fd = new FormData();
  fd.append('file', file);
  if (layerHint) fd.append('layer_hint', layerHint);
  if (projectId) fd.append('project_id', projectId);
  const { data } = await api.post<{ job_id: string }>('/parse', fd);
  return data;
}

export async function getParseStatus(jobId: string): Promise<ParseJob> {
  const { data } = await api.get<ParseJob>(`/parse/${jobId}/status`);
  return data;
}

export async function getParseModel(jobId: string): Promise<{ layer: DrawingLayer; model_fragment: unknown }> {
  const { data } = await api.get(`/parse/${jobId}/model`);
  return data;
}

// ── Project Management ────────────────────────────────────────────────

export interface NewDrawingOptions {
  layer: DrawingLayer;
  name: string;
  drawing_number?: string;
  revision?: string;
  ata_chapter?: string;
  aircraft_type?: string;
  project_number?: string;
  drawn_by?: string;
}

export interface NewDrawingResult {
  project_id: string;
  layer: DrawingLayer;
  name: string;
  sheet_count: number;
}

export async function createNewDrawing(opts: NewDrawingOptions): Promise<NewDrawingResult & ProjectModel> {
  const { data } = await api.post<NewDrawingResult & ProjectModel>('/project/new', opts);
  return data;
}

export async function getProject(projectId: string): Promise<ProjectModel> {
  const { data } = await api.get<ProjectModel>(`/project/${projectId}`);
  return data;
}

export async function mergeFragment(
  jobId: string,
  layer: DrawingLayer,
  projectId?: string,
): Promise<{ project_id: string; consistency_warnings: string[]; consistency_errors: string[] }> {
  const { data } = await api.post('/project/merge', { job_id: jobId, layer, project_id: projectId });
  return data;
}

export async function clearLayer(projectId: string, layer: DrawingLayer): Promise<void> {
  await api.delete(`/project/${projectId}/layer/${layer}`);
}

// ── Export ────────────────────────────────────────────────────────────

export function exportDxfUrl(projectId: string, layer: DrawingLayer): string {
  return `${BASE}/export/dxf`;
}

export async function exportDxf(projectId: string, layer: DrawingLayer): Promise<Blob> {
  const { data } = await api.post('/export/dxf', { project_id: projectId, layer }, { responseType: 'blob' });
  return data;
}

export async function exportPdf(projectId: string, layer: DrawingLayer): Promise<Blob> {
  const { data } = await api.post('/export/pdf', { project_id: projectId, layer }, { responseType: 'blob' });
  return data;
}

export async function exportWireList(projectId: string): Promise<Blob> {
  const { data } = await api.post('/export/wire-list', { project_id: projectId }, { responseType: 'blob' });
  return data;
}

export async function exportBom(projectId: string, layer: DrawingLayer): Promise<Blob> {
  const { data } = await api.post('/export/bom', { project_id: projectId, layer }, { responseType: 'blob' });
  return data;
}

export async function exportPinTable(projectId: string, connectorRef: string): Promise<Blob> {
  const { data } = await api.post('/export/pin-table', { project_id: projectId, connector_ref: connectorRef }, { responseType: 'blob' });
  return data;
}

// ── AI ────────────────────────────────────────────────────────────────

export async function aiModify(
  projectId: string,
  layer: DrawingLayer,
  prompt: string,
): Promise<{ changeset: unknown; updated_project: ProjectModel; compliance: ComplianceReport; consistency: ConsistencyResult }> {
  const { data } = await api.post('/ai/modify', { project_id: projectId, layer, prompt });
  return data;
}

export async function aiGenerate(template: string, parameters: Record<string, unknown>, layer: DrawingLayer) {
  const { data } = await api.post('/ai/generate', { template, parameters, layer });
  return data;
}

export async function aiExplain(projectId: string, layer: DrawingLayer, elementId: string): Promise<{ explanation: string; element_type: string }> {
  const { data } = await api.post('/ai/explain', { project_id: projectId, layer, element_id: elementId });
  return data;
}

export async function aiPropagate(
  projectId: string,
  sourceLayer: DrawingLayer,
  changeset: unknown,
): Promise<{ propagated_changesets: unknown[]; consistency_impact: string[] }> {
  const { data } = await api.post('/ai/propagate', { project_id: projectId, source_layer: sourceLayer, changeset });
  return data;
}

// ── Compliance & Validation ───────────────────────────────────────────

export async function runCompliance(projectId: string, layer?: DrawingLayer): Promise<ComplianceReport> {
  const { data } = await api.post<ComplianceReport>('/compliance/check', { project_id: projectId, layer });
  return data;
}

export async function fixCompliance(projectId: string, ruleId: string) {
  const { data } = await api.post('/compliance/fix', { project_id: projectId, rule_id: ruleId });
  return data;
}

export async function validateConsistency(projectId: string): Promise<ConsistencyResult> {
  const { data } = await api.post<ConsistencyResult>('/validate/consistency', { project_id: projectId });
  return data;
}

// ── Library CRUD ─────────────────────────────────────────────────────

export type LibraryType = 'symbols' | 'wires' | 'cables' | 'parts' | 'circuits' | 'templates';

export interface DrawingTemplate {
  id: string;
  name: string;
  layer: string;
  category: string;
  sheet_size: string;
  sheet_width_mm: number;
  sheet_height_mm: number;
  description: string;
  tags: string[];
  title_block: Record<string, unknown>;
  default_layers: string[];
  notes: string;
}

export async function createFromTemplate(
  templateId: string,
  name: string,
  drawingNumber: string,
  aircraftType: string,
  drawnBy: string,
) {
  const { data } = await api.post('/project/from-template', {
    template_id: templateId,
    name, drawing_number: drawingNumber,
    aircraft_type: aircraftType, drawn_by: drawnBy,
  });
  return data;
}

export interface LibraryResponse {
  lib_type: LibraryType;
  items: Record<string, unknown>[];
  count: number;
}

export async function getLibrary(libType: LibraryType): Promise<LibraryResponse> {
  const { data } = await api.get<LibraryResponse>(`/library/${libType}`);
  return data;
}

export async function addLibraryItem(libType: LibraryType, item: Record<string, unknown>) {
  const { data } = await api.post(`/library/${libType}`, item);
  return data;
}

export async function updateLibraryItem(libType: LibraryType, itemId: string, item: Record<string, unknown>) {
  const { data } = await api.put(`/library/${libType}/${itemId}`, item);
  return data;
}

export async function deleteLibraryItem(libType: LibraryType, itemId: string) {
  const { data } = await api.delete(`/library/${libType}/${itemId}`);
  return data;
}

// ── WebSocket helper ──────────────────────────────────────────────────

export function connectParseWebSocket(
  jobId: string,
  onMessage: (msg: unknown) => void,
  onClose?: () => void,
): WebSocket {
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/${jobId}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  if (onClose) ws.onclose = onClose;
  return ws;
}

// ── Download helper ───────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
