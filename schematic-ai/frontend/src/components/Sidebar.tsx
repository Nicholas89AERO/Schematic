import React, { useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { detectLayer, startParse, getParseStatus, mergeFragment, connectParseWebSocket, getProject, startConvert, getConvertStatus, downloadConvertedDxf } from '../api/client';
import type { ConvertJob } from '../api/client';
import type { ParseJob, DrawingLayer } from '../types/project';
import FolderTree, { useTreeAddDrawing } from './FolderTree';
import NewDrawingDialog from './NewDrawingDialog';

type SidebarTab = 'explorer' | 'project';

export default function Sidebar() {
  const { state, dispatch } = useApp();
  const fileRef  = useRef<HTMLInputElement>(null);
  const treeFileRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab]       = useState<SidebarTab>('explorer');
  const [uploading, setUploading]       = useState(false);
  const [newDrawingOpen, setNewDrawingOpen] = useState(false);
  const [pendingDetection, setPendingDetection] = useState<{
    file: File;
    detected_layer: string;
    confidence: number;
    reason: string;
  } | null>(null);
  const [pendingConvert, setPendingConvert] = useState<{
    file: File;
    reason: string;
  } | null>(null);
  const [convertJob, setConvertJob] = useState<ConvertJob | null>(null);
  const convertPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addDrawingToTree = useTreeAddDrawing();

  // ── Parse helpers ──────────────────────────────────────────────────

  const uploadAndParse = async (file: File, layer: string) => {
    setUploading(true);
    setPendingDetection(null);
    try {
      const { job_id } = await startParse(file, layer as DrawingLayer, state.projectId || undefined);
      const initialJob: ParseJob = {
        job_id,
        status: 'queued',
        layer: null,
        warnings: [],
        error: null,
        detection: null,
      };
      dispatch({ type: 'SET_PARSE_JOB', jobId: job_id, job: initialJob });

      // WebSocket progress
      connectParseWebSocket(job_id, async (msg: any) => {
        if (msg.event === 'complete') {
          const result = await mergeFragment(job_id, msg.layer, state.projectId || undefined);
          const project = await getProject(result.project_id);
          dispatch({ type: 'SET_PROJECT', project, projectId: result.project_id });
          dispatch({ type: 'SET_ACTIVE_LAYER', layer: msg.layer });

          const sheetCount =
            msg.layer === 'block_diagram' ? project.block_diagrams.length :
            msg.layer === 'schematic'     ? project.schematic_sheets.length :
                                            project.harness_sheets.length;
          addDrawingToTree(file.name, result.project_id, msg.layer, sheetCount);
        }
      });

      // Polling fallback
      const poll = setInterval(async () => {
        const job = await getParseStatus(job_id);
        dispatch({ type: 'SET_PARSE_JOB', jobId: job_id, job });
        if (job.status === 'complete' || job.status === 'error') {
          clearInterval(poll);
          if (job.status === 'complete' && job.layer) {
            const result = await mergeFragment(job_id, job.layer, state.projectId || undefined);
            const project = await getProject(result.project_id);
            dispatch({ type: 'SET_PROJECT', project, projectId: result.project_id });
            dispatch({ type: 'SET_ACTIVE_LAYER', layer: job.layer });

            const sheetCount =
              job.layer === 'block_diagram' ? project.block_diagrams.length :
              job.layer === 'schematic'     ? project.schematic_sheets.length :
                                              project.harness_sheets.length;
            addDrawingToTree(file.name, result.project_id, job.layer, sheetCount);
          }
        }
      }, 2000);
    } finally {
      setUploading(false);
    }
  };

  const startConvertAndDownload = async (file: File) => {
    setPendingConvert(null);
    setConvertJob(null);
    if (convertPollRef.current) clearInterval(convertPollRef.current);
    try {
      const { job_id } = await startConvert(file);
      setConvertJob({ job_id, status: 'queued', warnings: [], error: null });
      setActiveTab('project');
      convertPollRef.current = setInterval(async () => {
        try {
          const job = await getConvertStatus(job_id);
          setConvertJob(job);
          if (job.status === 'complete' || job.status === 'error') {
            clearInterval(convertPollRef.current!);
            if (job.status === 'complete') downloadConvertedDxf(job_id);
          }
        } catch { clearInterval(convertPollRef.current!); }
      }, 1200);
    } catch (err: any) {
      setConvertJob({ job_id: '', status: 'error', warnings: [], error: err?.response?.data?.detail || err?.message || 'Conversion failed' });
    }
  };

  const handleFile = async (file: File) => {
    const suffix = file.name.split('.').pop()?.toLowerCase();

    // DWG files: always offer convert-or-try-parse choice
    if (suffix === 'dwg') {
      setPendingConvert({ file, reason: 'DWG files need conversion to DXF for full fidelity. Convert now to download as DXF, or attempt direct import (may fail without ODA File Converter).' });
      setActiveTab('project');
      return;
    }

    setUploading(true);
    try {
      const detection = await detectLayer(file);
      if (detection.requires_user_confirmation) {
        setPendingDetection({ file, ...detection });
        setActiveTab('project');
        return;
      }
      await uploadAndParse(file, detection.detected_layer);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // Used by context menu "Add Drawing here"
  const handleTreeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrawingOpen = async (projectId: string, layer: DrawingLayer) => {
    dispatch({ type: 'SET_ACTIVE_LAYER', layer });
    // If this is a different project from what's currently loaded, fetch it
    if (projectId && projectId !== state.projectId) {
      try {
        const project = await getProject(projectId);
        dispatch({ type: 'SET_PROJECT', project, projectId });
      } catch (err) {
        console.error('Failed to load project:', err);
      }
    }
  };

  const handleNewDrawingCreated = (
    projectId: string,
    layer: DrawingLayer,
    name: string,
    sheetCount: number,
  ) => {
    addDrawingToTree(name, projectId, layer, sheetCount);
  };

  const activeJobs = Object.values(state.parseJobs).filter(
    j => j.status !== 'complete' && j.status !== 'error'
  );

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <>
    <div className="h-full bg-aero-panel border-r border-aero-border flex flex-col overflow-hidden">

      {/* Hidden file inputs */}
      <input ref={fileRef} id="sidebar-file-upload" type="file"
        className="hidden" accept=".dxf,.dwg,.pdf"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <input ref={treeFileRef} id="tree-file-upload" type="file"
        className="hidden" accept=".dxf,.dwg,.pdf"
        onChange={handleTreeFileChange} />

      {/* Tab bar */}
      <div className="flex border-b border-aero-border shrink-0">
        {(['explorer', 'project'] as SidebarTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium tracking-wide capitalize transition-colors ${
              activeTab === tab
                ? 'text-aero-accent border-b-2 border-aero-accent bg-aero-accent/5'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab === 'explorer' ? '◈ Explorer' : '⊞ Project'}
          </button>
        ))}
      </div>

      {/* ── EXPLORER TAB ──────────────────────────────────────────── */}
      {activeTab === 'explorer' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Action strip */}
          <div className="flex gap-1.5 mx-2 mt-2 mb-1">
            <button
              onClick={() => setNewDrawingOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border border-aero-accent/50 bg-aero-accent/5 text-aero-accent text-xs font-medium hover:bg-aero-accent/10 transition-colors"
            >
              ✦ New Drawing
            </button>
            <div
              title="Import DXF / PDF"
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded border border-dashed border-aero-border/60 text-gray-600 text-xs cursor-pointer hover:border-aero-accent/50 hover:text-gray-400 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
            >
              {uploading
                ? <span className="animate-pulse text-aero-accent">…</span>
                : '↑ Import'}
            </div>
          </div>

          {/* Active parse jobs banner */}
          {activeJobs.length > 0 && (
            <div className="mx-2 mb-1 px-2 py-1 bg-aero-dark border border-aero-border rounded flex items-center gap-2 text-xs">
              <span className="animate-spin text-aero-accent">↻</span>
              <span className="text-gray-400">{activeJobs.length} job{activeJobs.length > 1 ? 's' : ''} parsing…</span>
            </div>
          )}

          {/* Tree */}
          <div className="flex-1 overflow-hidden">
            <FolderTree
              onDrawingOpen={handleDrawingOpen}
              onNewDrawing={() => setNewDrawingOpen(true)}
            />
          </div>
        </div>
      )}

      {/* ── PROJECT TAB ───────────────────────────────────────────── */}
      {activeTab === 'project' && (
        <div className="flex flex-col flex-1 overflow-y-auto">

          {/* Upload zone */}
          <div
            className="m-3 border-2 border-dashed border-aero-border rounded-lg p-4 text-center cursor-pointer hover:border-aero-accent transition-colors"
            onClick={() => fileRef.current?.click()}
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
          >
            <div className="text-2xl mb-1">📁</div>
            <div className="text-xs text-gray-500">Drop DXF, DWG, or PDF</div>
            <div className="text-xs text-gray-700 mt-0.5">or click to browse</div>
          </div>

          {/* Layer confirmation dialog */}
          {pendingDetection && (
            <div className="mx-3 mb-3 p-3 bg-aero-yellow/10 border border-aero-yellow/30 rounded text-xs">
              <div className="font-medium text-aero-yellow mb-1">Confirm Layer</div>
              <div className="text-gray-400 mb-1">
                Detected: <strong>{pendingDetection.detected_layer}</strong>
                {' '}({(pendingDetection.confidence * 100).toFixed(0)}%)
              </div>
              <div className="text-gray-500 mb-2 text-xs">{pendingDetection.reason}</div>
              <div className="flex gap-1 flex-wrap">
                {['block_diagram', 'schematic', 'harness'].map(layer => (
                  <button
                    key={layer}
                    onClick={() => uploadAndParse(pendingDetection.file, layer)}
                    className={`px-2 py-0.5 rounded border text-xs ${
                      layer === pendingDetection.detected_layer
                        ? 'bg-aero-yellow/20 border-aero-yellow text-aero-yellow'
                        : 'border-aero-border text-gray-400 hover:border-aero-accent'
                    }`}
                  >
                    {layer.replace('_', ' ')}
                  </button>
                ))}
                <button
                  onClick={() => setPendingDetection(null)}
                  className="px-2 py-0.5 rounded border border-aero-border text-gray-500 text-xs ml-auto"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* DWG convert-or-import choice */}
          {pendingConvert && (
            <div className="mx-3 mb-3 p-3 bg-aero-orange/10 border border-aero-orange/30 rounded text-xs">
              <div className="font-medium text-aero-orange mb-1">⇄ DWG File Detected</div>
              <div className="text-gray-400 mb-3">{pendingConvert.reason}</div>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => startConvertAndDownload(pendingConvert.file)}
                  className="w-full py-1.5 rounded border border-aero-orange/60 text-aero-orange hover:bg-aero-orange/10 font-medium text-xs"
                >
                  ⇄ Convert to DXF and download
                </button>
                <button
                  onClick={async () => {
                    setPendingConvert(null);
                    setUploading(true);
                    try {
                      const detection = await detectLayer(pendingConvert.file);
                      if (detection.requires_user_confirmation) {
                        setPendingDetection({ file: pendingConvert.file, ...detection });
                      } else {
                        await uploadAndParse(pendingConvert.file, detection.detected_layer);
                      }
                    } catch (e) { console.error(e); }
                    finally { setUploading(false); }
                  }}
                  className="w-full py-1.5 rounded border border-aero-border text-gray-400 hover:text-gray-200 text-xs"
                >
                  ↑ Try import directly (requires ODA File Converter)
                </button>
                <button
                  onClick={() => setPendingConvert(null)}
                  className="text-gray-600 hover:text-gray-400 text-xs text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Convert job progress */}
          {convertJob && (
            <div className={`mx-3 mb-3 p-2 rounded border text-xs ${
              convertJob.status === 'error'    ? 'bg-aero-red/10 border-aero-red/30'    :
              convertJob.status === 'complete' ? 'bg-aero-green/10 border-aero-green/30' :
              'bg-aero-dark border-aero-border'
            }`}>
              <div className="flex items-center gap-2">
                {convertJob.status === 'complete' ? (
                  <span className="text-aero-green">✓</span>
                ) : convertJob.status === 'error' ? (
                  <span className="text-aero-red">✕</span>
                ) : (
                  <span className="animate-spin text-aero-orange">↻</span>
                )}
                <span className={
                  convertJob.status === 'complete' ? 'text-aero-green' :
                  convertJob.status === 'error'    ? 'text-aero-red'   : 'text-gray-400'
                }>
                  {convertJob.status === 'queued'     ? 'Queued…'                        :
                   convertJob.status === 'converting' ? 'Converting to DXF…'             :
                   convertJob.status === 'complete'   ? 'Converted — DXF downloading'    :
                   convertJob.error || 'Conversion failed'}
                </span>
                {(convertJob.status === 'complete' || convertJob.status === 'error') && (
                  <button onClick={() => setConvertJob(null)} className="ml-auto text-gray-600 hover:text-gray-300">✕</button>
                )}
              </div>
              {convertJob.warnings.length > 0 && (
                <div className="mt-1 text-gray-600 text-[10px] space-y-0.5">
                  {convertJob.warnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Active jobs */}
          {activeJobs.map(job => (
            <div key={job.job_id} className="mx-3 mb-2 p-2 bg-aero-dark border border-aero-border rounded text-xs">
              <div className="flex items-center gap-2">
                <span className="animate-spin text-aero-accent">↻</span>
                <span className="text-gray-400 capitalize">{job.status}…</span>
              </div>
            </div>
          ))}

          {/* Layer summary */}
          {state.project && (
            <div className="px-3 py-2 flex flex-col gap-1.5 border-b border-aero-border">
              <div className="text-xs text-gray-600 font-semibold uppercase tracking-wider mb-1">Layers</div>
              {[
                { layer: 'block_diagram', label: 'L1 Block Diagram', count: state.project.block_diagrams.length },
                { layer: 'schematic',     label: 'L2 Schematic',     count: state.project.schematic_sheets.length },
                { layer: 'harness',       label: 'L3 Harness',       count: state.project.harness_sheets.length },
              ].map(({ layer, label, count }) => (
                <button
                  key={layer}
                  onClick={() => dispatch({ type: 'SET_ACTIVE_LAYER', layer: layer as DrawingLayer })}
                  className={`flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${
                    state.activeLayer === layer
                      ? 'bg-aero-accent/10 text-aero-accent border border-aero-accent/30'
                      : 'text-gray-400 hover:bg-aero-dark hover:text-gray-200'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`font-mono ${count > 0 ? 'text-aero-green' : 'text-gray-600'}`}>
                    {count} sheet{count !== 1 ? 's' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Parse warnings */}
          {state.project?.parse_warnings && state.project.parse_warnings.length > 0 && (
            <div className="mx-3 mt-2 mb-3">
              <div className="text-xs text-aero-yellow font-semibold mb-1">
                Parse Warnings ({state.project.parse_warnings.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {state.project.parse_warnings.map((w, i) => (
                  <div key={i} className="text-xs text-gray-500 bg-aero-yellow/5 border border-aero-yellow/20 rounded px-2 py-1">
                    {w}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    <NewDrawingDialog
      open={newDrawingOpen}
      onClose={() => setNewDrawingOpen(false)}
      onCreated={handleNewDrawingCreated}
    />
    </>
  );
}
