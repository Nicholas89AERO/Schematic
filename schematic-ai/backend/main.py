"""
SchematicAI — FastAPI backend entry point.

Endpoints:
  Parse & Detect:      POST /detect-layer, POST /parse, GET /parse/{job_id}/status
                       GET /parse/{job_id}/model, WS /ws/{job_id}
  Project Management:  GET /project/{id}, POST /project/merge,
                       DELETE /project/{id}/layer/{layer}
  Export:              POST /export/dxf, POST /export/pdf, POST /export/wire-list
                       POST /export/bom, POST /export/pin-table
  AI:                  POST /ai/modify, POST /ai/generate, POST /ai/explain,
                       POST /ai/propagate
  Compliance:          POST /compliance/check, POST /compliance/fix,
                       POST /validate/consistency
"""

from __future__ import annotations

import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import (
    BackgroundTasks, FastAPI, File, Form, HTTPException,
    UploadFile, WebSocket, WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database import get_project, init_db, save_project
from linkers.cross_ref_builder import build_cross_references
from models.project import DrawingLayer, ProjectModel
from parsers.dxf_parser import parse_dxf
from parsers.layer_detector import detect_layer
from parsers.pdf_parser import parse_pdf
from serialization import (
    dict_to_block_diagram,
    dict_to_harness_sheet,
    dict_to_schematic_sheet,
    model_to_dict,
)

# ─────────────────────────────────────────────
# App setup
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="SchematicAI",
    description="Aerospace electrical drawing intelligence platform",
    version="1.0.0",
    lifespan=lifespan,
)

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE_MB", "50")) * 1024 * 1024

# ─────────────────────────────────────────────
# In-memory stores
# ─────────────────────────────────────────────

# parse jobs:  job_id → { status, layer, warnings, model_fragment, detection }
_parse_jobs: dict[str, dict] = {}
# ws connections: job_id → list[WebSocket]
_ws_clients: dict[str, list[WebSocket]] = {}

UPLOAD_DIR = Path("/tmp/schematic_uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────
# Project helpers
# ─────────────────────────────────────────────

async def _require_project(project_id: str) -> ProjectModel:
    project = await get_project(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


async def _broadcast(job_id: str, message: dict) -> None:
    """Send a message to all WebSocket clients watching a job."""
    for ws in _ws_clients.get(job_id, []):
        try:
            await ws.send_json(message)
        except Exception:
            pass


# ─────────────────────────────────────────────
# Background parse task
# ─────────────────────────────────────────────

async def _run_parse_job(job_id: str, file_path: Path, layer_hint: Optional[str]) -> None:
    job = _parse_jobs[job_id]
    warnings: list[str] = []

    try:
        job["status"] = "detecting"
        await _broadcast(job_id, {"event": "progress", "stage": "detecting", "progress": 10})

        hint = DrawingLayer(layer_hint) if layer_hint else None
        suffix = file_path.suffix.lower()

        job["status"] = "parsing"
        await _broadcast(job_id, {"event": "progress", "stage": "parsing", "progress": 30})

        if suffix in (".dxf", ".dwg"):
            detected_layer, fragment, detection = parse_dxf(
                file_path, layer_hint=hint, warnings=warnings
            )
        elif suffix == ".pdf":
            detected_layer, fragment, detection = parse_pdf(
                file_path, layer_hint=hint, warnings=warnings
            )
        else:
            raise ValueError(f"Unsupported file type: {suffix}")

        await _broadcast(job_id, {"event": "progress", "stage": "linking", "progress": 70})

        job["status"]       = "complete"
        job["layer"]        = detected_layer.value
        job["warnings"]     = warnings
        job["model_fragment"] = model_to_dict(fragment)
        job["detection"]    = {
            "detected_layer": detection.detected_layer.value,
            "confidence":     detection.confidence,
            "reason":         detection.reason,
            "requires_user_confirmation": detection.requires_user_confirmation,
        }

        await _broadcast(job_id, {
            "event":    "complete",
            "progress": 100,
            "layer":    detected_layer.value,
            "warnings": warnings,
            "requires_confirmation": detection.requires_user_confirmation,
        })

    except Exception as exc:
        job["status"] = "error"
        job["error"]  = str(exc)
        await _broadcast(job_id, {"event": "error", "message": str(exc)})

    finally:
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


# ─────────────────────────────────────────────
# Parse & Detect endpoints
# ─────────────────────────────────────────────

@app.post("/detect-layer")
async def detect_layer_endpoint(file: UploadFile = File(...)):
    """Detect which drawing layer a file belongs to without fully parsing it."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".dxf", ".dwg", ".pdf"):
        raise HTTPException(400, "Only DXF, DWG, and PDF files are supported")

    tmp_path = UPLOAD_DIR / f"{uuid.uuid4()}{suffix}"
    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, f"File exceeds {os.getenv('MAX_FILE_SIZE_MB', 50)} MB limit")

    tmp_path.write_bytes(content)
    try:
        result = detect_layer(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "detected_layer": result.detected_layer.value,
        "confidence":     result.confidence,
        "reason":         result.reason,
        "requires_user_confirmation": result.requires_user_confirmation,
    }


@app.post("/parse")
async def parse_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    layer_hint: Optional[str] = Form(None),
    project_id: Optional[str] = Form(None),
):
    """Upload a DXF or PDF file and start an async parse job."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".dxf", ".dwg", ".pdf"):
        raise HTTPException(400, "Only DXF, DWG, and PDF files are supported")

    if layer_hint and layer_hint not in [l.value for l in DrawingLayer]:
        raise HTTPException(400, f"Invalid layer_hint '{layer_hint}'")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "File too large")

    job_id = str(uuid.uuid4())
    tmp_path = UPLOAD_DIR / f"{job_id}{suffix}"
    tmp_path.write_bytes(content)

    _parse_jobs[job_id] = {
        "status":         "queued",
        "filename":       file.filename,
        "layer_hint":     layer_hint,
        "project_id":     project_id,
        "layer":          None,
        "warnings":       [],
        "model_fragment": None,
        "detection":      None,
        "error":          None,
    }

    background_tasks.add_task(_run_parse_job, job_id, tmp_path, layer_hint)
    return {"job_id": job_id, "status": "queued"}


@app.get("/parse/{job_id}/status")
async def get_parse_status(job_id: str):
    job = _parse_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "job_id":    job_id,
        "status":    job["status"],
        "layer":     job["layer"],
        "warnings":  job["warnings"],
        "error":     job["error"],
        "detection": job["detection"],
    }


@app.get("/parse/{job_id}/model")
async def get_parse_model(job_id: str):
    job = _parse_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "complete":
        raise HTTPException(409, f"Job status is '{job['status']}', not complete")
    return {"layer": job["layer"], "model_fragment": job["model_fragment"]}


@app.websocket("/ws/{job_id}")
async def ws_parse_progress(websocket: WebSocket, job_id: str):
    """WebSocket endpoint for real-time parse progress."""
    await websocket.accept()
    _ws_clients.setdefault(job_id, []).append(websocket)
    try:
        # Keep connection alive until client disconnects
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.get(job_id, []).remove(websocket)


# ─────────────────────────────────────────────
# Project Management endpoints
# ─────────────────────────────────────────────

@app.get("/project/{project_id}")
async def get_project_endpoint(project_id: str):
    project = await _require_project(project_id)
    return model_to_dict(project)


class NewDrawingRequest(BaseModel):
    layer: str                     # block_diagram | schematic | harness
    name: str = "New Drawing"
    drawing_number: str = ""
    revision: str = "A"
    ata_chapter: str = ""
    aircraft_type: str = ""
    project_number: str = ""
    drawn_by: str = ""


@app.post("/project/new")
async def create_new_drawing(body: NewDrawingRequest):
    """Create a blank ProjectModel with a single empty sheet for the requested layer."""
    from models.project import (
        BlockDiagram, SchematicSheet, HarnessSheet, TitleBlock
    )
    try:
        layer = DrawingLayer(body.layer)
    except ValueError:
        raise HTTPException(400, f"Invalid layer '{body.layer}'")

    tb = TitleBlock(
        drawing_title=body.name,
        drawing_number=body.drawing_number,
        revision=body.revision or "A",
        ata_chapter=body.ata_chapter,
        aircraft_type=body.aircraft_type,
        sheet_count=1,
        drawn_by=body.drawn_by,
    )

    project = ProjectModel(
        project_number=body.project_number,
        aircraft_type=body.aircraft_type,
        ata_chapter=body.ata_chapter,
        title_block=tb,
    )

    if layer == DrawingLayer.BLOCK_DIAGRAM:
        project.block_diagrams.append(BlockDiagram(sheet_number=1, title=body.name))
    elif layer == DrawingLayer.SCHEMATIC:
        project.schematic_sheets.append(SchematicSheet(number=1, title=body.name))
    elif layer == DrawingLayer.HARNESS:
        project.harness_sheets.append(HarnessSheet(number=1, title=body.name))

    await save_project(project)

    sheet_count = (
        len(project.block_diagrams) if layer == DrawingLayer.BLOCK_DIAGRAM else
        len(project.schematic_sheets) if layer == DrawingLayer.SCHEMATIC else
        len(project.harness_sheets)
    )

    project_dict = model_to_dict(project)
    project_dict["layer"] = layer.value
    project_dict["name"] = body.name
    project_dict["sheet_count"] = sheet_count
    return project_dict


class NewFromTemplateRequest(BaseModel):
    template_id: str
    name: str = ""
    drawing_number: str = ""
    aircraft_type: str = ""
    drawn_by: str = ""
    properties: Optional[dict] = None  # resolved drawing properties from frontend


@app.post("/project/from-template")
async def create_from_template(body: NewFromTemplateRequest):
    """Create a new blank project pre-populated from a drawing template."""
    from models.project import BlockDiagram, SchematicSheet, HarnessSheet, TitleBlock

    # Load the template
    tpl_data = _read_library("templates")
    template = next(
        (t for t in tpl_data.get("templates", []) if t["id"] == body.template_id),
        None,
    )
    if not template:
        raise HTTPException(404, f"Template '{body.template_id}' not found")

    try:
        layer = DrawingLayer(template["layer"])
    except (KeyError, ValueError):
        raise HTTPException(400, "Template has invalid layer")

    tb_data = template.get("title_block", {})
    tb = TitleBlock(
        drawing_title=body.name or tb_data.get("drawing_title", template["name"]),
        drawing_number=body.drawing_number or tb_data.get("drawing_number", ""),
        revision=tb_data.get("revision", "A"),
        ata_chapter=tb_data.get("ata_chapter", ""),
        aircraft_type=body.aircraft_type or tb_data.get("aircraft_type", ""),
        certification_basis=tb_data.get("certification_basis", ""),
        standard=tb_data.get("standard", ""),
        drawn_by=body.drawn_by or tb_data.get("drawn_by", ""),
        checked_by=tb_data.get("checked_by", ""),
        approved_by=tb_data.get("approved_by", ""),
        company=tb_data.get("company", ""),
        sheet_count=1,
    )

    project = ProjectModel(
        ata_chapter=tb_data.get("ata_chapter", ""),
        aircraft_type=body.aircraft_type or tb_data.get("aircraft_type", ""),
        title_block=tb,
    )

    title = body.name or tb_data.get("drawing_title", template["name"])

    if layer == DrawingLayer.BLOCK_DIAGRAM:
        project.block_diagrams.append(BlockDiagram(sheet_number=1, title=title))
    elif layer == DrawingLayer.SCHEMATIC:
        project.schematic_sheets.append(SchematicSheet(number=1, title=title))
    elif layer == DrawingLayer.HARNESS:
        project.harness_sheets.append(HarnessSheet(number=1, title=title))

    await save_project(project)

    result = model_to_dict(project)
    # Merge template properties with any frontend overrides
    base_props = {}
    tpl_schema = template.get("properties", {})
    for key, field in tpl_schema.items():
        base_props[key] = field.get("value")
    if body.properties:
        base_props.update(body.properties)

    result["layer"] = layer.value
    result["name"] = title
    result["sheet_count"] = 1
    result["template_id"] = body.template_id
    result["sheet_size"] = base_props.get("sheet_size", template.get("sheet_size", "A3"))
    result["orientation"] = base_props.get("orientation", "landscape")
    result["template_notes"] = template.get("notes", "")
    result["drawing_properties"] = base_props
    return result


class MergeRequest(BaseModel):
    project_id: Optional[str] = None
    layer: str
    job_id: str  # The parse job whose fragment to merge


@app.post("/project/merge")
async def merge_fragment(body: MergeRequest):
    """
    Merge a parsed layer fragment into an existing project (or create a new one).
    Triggers cross-reference building and consistency validation.
    """
    from validators.consistency import run_consistency_checks

    job = _parse_jobs.get(body.job_id)
    if not job or job["status"] != "complete":
        raise HTTPException(409, f"Job {body.job_id} is not complete")

    # Resolve or create project
    project_id = body.project_id
    project = await get_project(project_id) if project_id else None
    if project is None:
        project = ProjectModel(project_id=project_id or str(uuid.uuid4()))

    layer = DrawingLayer(body.layer)
    fragment_dict = job["model_fragment"]

    # Merge fragment into project (simplified: append sheets)
    if layer == DrawingLayer.BLOCK_DIAGRAM:
        project.block_diagrams.append(dict_to_block_diagram(fragment_dict))
    elif layer == DrawingLayer.SCHEMATIC:
        project.schematic_sheets.append(dict_to_schematic_sheet(fragment_dict))
    elif layer == DrawingLayer.HARNESS:
        project.harness_sheets.append(dict_to_harness_sheet(fragment_dict))

    project.parse_warnings.extend(job["warnings"])

    # Rebuild cross-references
    build_cross_references(project)

    # Run consistency validation
    consistency_report = run_consistency_checks(project)
    project.consistency_warnings = consistency_report["warnings"]

    await save_project(project)

    return {
        "project_id": project.project_id,
        "consistency_warnings": consistency_report["warnings"],
        "consistency_errors":   consistency_report["errors"],
    }


@app.delete("/project/{project_id}/layer/{layer}")
async def clear_layer(project_id: str, layer: str):
    project = await _require_project(project_id)
    try:
        dl = DrawingLayer(layer)
    except ValueError:
        raise HTTPException(400, f"Invalid layer '{layer}'")

    if dl == DrawingLayer.BLOCK_DIAGRAM:
        project.block_diagrams.clear()
    elif dl == DrawingLayer.SCHEMATIC:
        project.schematic_sheets.clear()
    elif dl == DrawingLayer.HARNESS:
        project.harness_sheets.clear()

    build_cross_references(project)
    await save_project(project)
    return {"project_id": project_id, "cleared_layer": layer}


# ─────────────────────────────────────────────
# Export endpoints
# ─────────────────────────────────────────────

class ExportRequest(BaseModel):
    project_id: str
    layer: Optional[str] = None


@app.post("/export/dxf")
async def export_dxf(body: ExportRequest):
    project = await _require_project(body.project_id)
    from exporters.dxf_writer import write_dxf
    layer = DrawingLayer(body.layer) if body.layer else DrawingLayer.SCHEMATIC
    out_path = write_dxf(project, layer)
    return FileResponse(out_path, filename=f"{project.project_number or 'export'}_{layer.value}.dxf")


@app.post("/export/pdf")
async def export_pdf(body: ExportRequest):
    project = await _require_project(body.project_id)
    from exporters.pdf_writer import write_pdf
    layer = DrawingLayer(body.layer) if body.layer else DrawingLayer.SCHEMATIC
    out_path = write_pdf(project, layer)
    return FileResponse(out_path, filename=f"{project.project_number or 'export'}_{layer.value}.pdf")


@app.post("/export/wire-list")
async def export_wire_list(body: ExportRequest):
    project = await _require_project(body.project_id)
    from exporters.l3_harness_writer import write_wire_list_csv
    out_path = write_wire_list_csv(project)
    return FileResponse(out_path, filename="wire_list.csv")


@app.post("/export/bom")
async def export_bom(body: ExportRequest):
    project = await _require_project(body.project_id)
    layer = DrawingLayer(body.layer) if body.layer else DrawingLayer.SCHEMATIC
    from exporters.l2_schema_writer import write_bom_csv
    out_path = write_bom_csv(project, layer)
    return FileResponse(out_path, filename="bom.csv")


class PinTableRequest(BaseModel):
    project_id: str
    connector_ref: str


@app.post("/export/pin-table")
async def export_pin_table(body: PinTableRequest):
    project = await _require_project(body.project_id)
    from exporters.l2_schema_writer import write_pin_table_csv
    out_path = write_pin_table_csv(project, body.connector_ref)
    return FileResponse(out_path, filename=f"pin_table_{body.connector_ref}.csv")


# ─────────────────────────────────────────────
# AI endpoints
# ─────────────────────────────────────────────

class AIModifyRequest(BaseModel):
    project_id: str
    layer: str
    prompt: str


@app.post("/ai/modify")
async def ai_modify(body: AIModifyRequest):
    project = await _require_project(body.project_id)
    from ai.claude_client import modify_project
    from validators.consistency import run_consistency_checks
    result = await modify_project(project, DrawingLayer(body.layer), body.prompt)
    build_cross_references(result["updated_project"])
    consistency = run_consistency_checks(result["updated_project"])
    await save_project(result["updated_project"])
    return {
        "changeset":       result["changeset"],
        "updated_project": model_to_dict(result["updated_project"]),
        "compliance":      result.get("compliance", {}),
        "consistency":     consistency,
    }


class AIGenerateRequest(BaseModel):
    template: str
    parameters: dict
    layer: str
    project_id: Optional[str] = None


@app.post("/ai/generate")
async def ai_generate(body: AIGenerateRequest):
    from ai.claude_client import generate_fragment
    result = await generate_fragment(body.template, body.parameters, DrawingLayer(body.layer))
    return result


class AIExplainRequest(BaseModel):
    project_id: str
    layer: str
    element_id: str


@app.post("/ai/explain")
async def ai_explain(body: AIExplainRequest):
    project = await _require_project(body.project_id)
    from ai.claude_client import explain_element
    result = await explain_element(project, DrawingLayer(body.layer), body.element_id)
    return result


class AIPropagateRequest(BaseModel):
    project_id: str
    source_layer: str
    changeset: dict


@app.post("/ai/propagate")
async def ai_propagate(body: AIPropagateRequest):
    project = await _require_project(body.project_id)
    from ai.claude_client import propagate_changes
    result = await propagate_changes(project, DrawingLayer(body.source_layer), body.changeset)
    return result


# ─────────────────────────────────────────────
# Compliance & Validation endpoints
# ─────────────────────────────────────────────

class ComplianceCheckRequest(BaseModel):
    project_id: str
    layer: Optional[str] = None


@app.post("/compliance/check")
async def compliance_check(body: ComplianceCheckRequest):
    project = await _require_project(body.project_id)
    from compliance.checker import run_compliance
    layer = DrawingLayer(body.layer) if body.layer else None
    report = run_compliance(project, layer=layer)
    return model_to_dict(report)


class ComplianceFixRequest(BaseModel):
    project_id: str
    rule_id: str


@app.post("/compliance/fix")
async def compliance_fix(body: ComplianceFixRequest):
    project = await _require_project(body.project_id)
    from ai.claude_client import fix_compliance_rule
    result = await fix_compliance_rule(project, body.rule_id)
    await save_project(result["updated_project"])
    return result


class ConsistencyRequest(BaseModel):
    project_id: str


@app.post("/validate/consistency")
async def validate_consistency(body: ConsistencyRequest):
    project = await _require_project(body.project_id)
    from validators.consistency import run_consistency_checks
    result = run_consistency_checks(project)
    project.consistency_warnings = result["warnings"]
    await save_project(project)
    return result


# ─────────────────────────────────────────────
# Library endpoints
# ─────────────────────────────────────────────

_LIBRARY_FILES = {
    "symbols":   Path(__file__).parent / "symbol_library.json",
    "wires":     Path(__file__).parent / "library" / "wire_library.json",
    "cables":    Path(__file__).parent / "library" / "cable_library.json",
    "parts":     Path(__file__).parent / "library" / "manufacturer_parts.json",
    "circuits":  Path(__file__).parent / "library" / "circuit_library.json",
    "templates": Path(__file__).parent / "library" / "drawing_templates.json",
}

_LIBRARY_ROOT_KEY = {
    "symbols":   "symbols",
    "wires":     "wires",
    "cables":    "cables",
    "parts":     "parts",
    "circuits":  "circuits",
    "templates": "templates",
}


def _read_library(lib_type: str) -> dict:
    path = _LIBRARY_FILES.get(lib_type)
    if not path or not path.exists():
        raise HTTPException(404, f"Library '{lib_type}' not found")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write_library(lib_type: str, data: dict) -> None:
    path = _LIBRARY_FILES[lib_type]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@app.get("/library/{lib_type}")
async def get_library(lib_type: str):
    """Return all entries in the specified library."""
    data = _read_library(lib_type)
    root_key = _LIBRARY_ROOT_KEY.get(lib_type, lib_type)
    items = data.get(root_key, data)
    # For symbols dict, convert to list
    if isinstance(items, dict):
        items = [{"id": k, **v} for k, v in items.items()]
    return {"lib_type": lib_type, "items": items, "count": len(items)}


@app.post("/library/{lib_type}")
async def add_library_item(lib_type: str, item: dict):
    """Add a new entry to a library. Auto-assigns an id if missing."""
    if lib_type not in _LIBRARY_FILES:
        raise HTTPException(400, f"Unknown library type '{lib_type}'")
    data = _read_library(lib_type)
    root_key = _LIBRARY_ROOT_KEY.get(lib_type, lib_type)

    if not item.get("id"):
        item["id"] = str(uuid.uuid4())

    if lib_type == "symbols":
        # Symbol library is a dict keyed by symbol name
        symbol_key = item.pop("id", item.get("part_number", str(uuid.uuid4())))
        data.setdefault("symbols", {})[symbol_key] = item
    else:
        data.setdefault(root_key, []).append(item)

    _write_library(lib_type, data)
    return {"added": item}


@app.put("/library/{lib_type}/{item_id}")
async def update_library_item(lib_type: str, item_id: str, item: dict):
    """Update an existing library entry by id."""
    if lib_type not in _LIBRARY_FILES:
        raise HTTPException(400, f"Unknown library type '{lib_type}'")
    data = _read_library(lib_type)
    root_key = _LIBRARY_ROOT_KEY.get(lib_type, lib_type)

    if lib_type == "symbols":
        if item_id not in data.get("symbols", {}):
            raise HTTPException(404, f"Symbol '{item_id}' not found")
        data["symbols"][item_id] = {**data["symbols"][item_id], **item}
    else:
        items = data.get(root_key, [])
        for i, entry in enumerate(items):
            if entry.get("id") == item_id:
                items[i] = {**entry, **item, "id": item_id}
                data[root_key] = items
                _write_library(lib_type, data)
                return {"updated": items[i]}
        raise HTTPException(404, f"Item '{item_id}' not found in {lib_type} library")

    _write_library(lib_type, data)
    return {"updated": item}


@app.delete("/library/{lib_type}/{item_id}")
async def delete_library_item(lib_type: str, item_id: str):
    """Delete a library entry by id."""
    if lib_type not in _LIBRARY_FILES:
        raise HTTPException(400, f"Unknown library type '{lib_type}'")
    data = _read_library(lib_type)
    root_key = _LIBRARY_ROOT_KEY.get(lib_type, lib_type)

    if lib_type == "symbols":
        if item_id not in data.get("symbols", {}):
            raise HTTPException(404, f"Symbol '{item_id}' not found")
        del data["symbols"][item_id]
    else:
        items = data.get(root_key, [])
        before = len(items)
        data[root_key] = [e for e in items if e.get("id") != item_id]
        if len(data[root_key]) == before:
            raise HTTPException(404, f"Item '{item_id}' not found in {lib_type} library")

    _write_library(lib_type, data)
    return {"deleted": item_id}
