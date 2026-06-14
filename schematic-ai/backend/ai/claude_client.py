"""
Claude API client — async wrapper for all AI endpoints.
"""

from __future__ import annotations

import dataclasses
import json
import os
import uuid
from typing import Any

from ..models.changes import ChangeSet
from ..models.project import DrawingLayer, ProjectModel
from .changeset_applier import apply_changeset
from .prompts import (
    EXPLAIN_PROMPT, FIX_PROMPT, PROPAGATION_PROMPT, SYSTEM_PROMPTS,
)

_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_MODEL = "claude-opus-4-5"
_MAX_TOKENS = 4096


def _get_client():
    import anthropic
    return anthropic.AsyncAnthropic(api_key=_ANTHROPIC_API_KEY)


def _model_to_json(obj: Any) -> str:
    """Serialise a dataclass model to a compact JSON string."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        d = dataclasses.asdict(obj)
    elif isinstance(obj, dict):
        d = obj
    else:
        d = str(obj)
    return json.dumps(d, default=str)


def _parse_changeset_from_response(text: str) -> ChangeSet:
    """
    Extract a ChangeSet JSON block from Claude's response.
    Falls back to an empty ChangeSet if parsing fails.
    """
    cs = ChangeSet(changeset_id=str(uuid.uuid4()), ai_generated=True)
    try:
        # Find JSON block
        start = text.find("{")
        end   = text.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(text[start:end])
            # Minimal hydration — operations are the key part
            for op_data in data.get("operations", []):
                from ..models.changes import ChangeOperation, ElementKind, OperationType
                try:
                    op = ChangeOperation(
                        operation=OperationType(op_data.get("operation", "add")),
                        element_kind=ElementKind(op_data.get("element_kind", "component")),
                        element_id=op_data.get("element_id"),
                        layer=DrawingLayer(op_data.get("layer", "schematic")),
                        sheet=op_data.get("sheet"),
                        before=op_data.get("before"),
                        after=op_data.get("after"),
                        description=op_data.get("description", ""),
                    )
                    cs.operations.append(op)
                except (ValueError, KeyError):
                    continue
    except (json.JSONDecodeError, Exception):
        pass
    return cs


async def modify_project(
    project: ProjectModel,
    layer: DrawingLayer,
    prompt: str,
) -> dict:
    """
    Send a natural-language modification request to Claude.
    Returns { updated_project, changeset, compliance }.
    """
    if not _ANTHROPIC_API_KEY:
        return {
            "updated_project": project,
            "changeset": {},
            "compliance": {},
            "error": "ANTHROPIC_API_KEY not set",
        }

    client = _get_client()
    system_prompt = SYSTEM_PROMPTS[layer]
    project_json = _model_to_json(project)

    user_message = (
        f"Current project state (JSON):\n```json\n{project_json[:8000]}\n```\n\n"
        f"User request: {prompt}\n\n"
        "Return a JSON ChangeSet with the required operations."
    )

    response = await client.messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    response_text = response.content[0].text
    changeset = _parse_changeset_from_response(response_text)
    updated_project = apply_changeset(project, changeset)

    return {
        "updated_project": updated_project,
        "changeset": dataclasses.asdict(changeset),
        "compliance": {},
        "raw_response": response_text,
    }


async def generate_fragment(
    template: str,
    parameters: dict,
    layer: DrawingLayer,
) -> dict:
    """Generate a project fragment from a template and parameters."""
    if not _ANTHROPIC_API_KEY:
        return {"error": "ANTHROPIC_API_KEY not set"}

    client = _get_client()
    system_prompt = SYSTEM_PROMPTS[layer]

    user_message = (
        f"Generate a project fragment for layer '{layer.value}' using template '{template}'.\n"
        f"Parameters: {json.dumps(parameters)}\n"
        "Return the fragment as a JSON object matching the ProjectModel schema."
    )

    response = await client.messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    return {"fragment": response.content[0].text, "layer": layer.value}


async def explain_element(
    project: ProjectModel,
    layer: DrawingLayer,
    element_id: str,
) -> dict:
    """Generate a plain-English explanation of an element."""
    if not _ANTHROPIC_API_KEY:
        return {"explanation": "ANTHROPIC_API_KEY not set"}

    # Find element in model
    element = None
    element_type = "unknown"
    for bd in project.block_diagrams:
        for lru in bd.lru_blocks:
            if lru.id == element_id:
                element = lru; element_type = "LRU Block"; break
        for sp in bd.signal_paths:
            if sp.id == element_id:
                element = sp; element_type = "Signal Path"; break

    for sheet in project.schematic_sheets:
        for comp in sheet.components:
            if comp.id == element_id:
                element = comp; element_type = "Component"; break
        for conn in sheet.connectors:
            if conn.id == element_id:
                element = conn; element_type = "Connector"; break
        for wire in sheet.wires:
            if wire.id == element_id:
                element = wire; element_type = "Wire Segment"; break

    if element is None:
        return {"explanation": f"Element {element_id} not found in project"}

    client = _get_client()
    element_json = _model_to_json(element)

    prompt = EXPLAIN_PROMPT.format(
        layer=layer.value,
        element_type=element_type,
        element_json=element_json,
    )
    response = await client.messages.create(
        model=_MODEL,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    return {"explanation": response.content[0].text, "element_type": element_type}


async def propagate_changes(
    project: ProjectModel,
    source_layer: DrawingLayer,
    changeset: dict,
) -> dict:
    """
    Ask Claude to identify cross-layer changes required after a source changeset.
    """
    if not _ANTHROPIC_API_KEY:
        return {"propagated_changesets": [], "error": "ANTHROPIC_API_KEY not set"}

    client = _get_client()

    prompt = PROPAGATION_PROMPT.format(source_layer=source_layer.value)
    user_message = (
        f"Source layer: {source_layer.value}\n"
        f"Applied changeset:\n```json\n{json.dumps(changeset, default=str)[:4000]}\n```\n\n"
        "What changes are required in the other layers to maintain full consistency?"
    )

    response = await client.messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        system=prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    text = response.content[0].text
    try:
        start = text.find("{")
        end   = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except json.JSONDecodeError:
        pass
    return {"propagated_changesets": [], "raw_response": text}


async def fix_compliance_rule(
    project: ProjectModel,
    rule_id: str,
) -> dict:
    """Generate and apply a fix for a specific compliance rule violation."""
    from ..compliance.checker import run_compliance
    report = run_compliance(project)
    failing = next(
        (r for r in report.results if r.rule_id == rule_id and r.status.value == "fail"),
        None,
    )
    if not failing:
        return {"updated_project": project, "changeset": {}, "message": f"Rule {rule_id} not failing"}

    if not _ANTHROPIC_API_KEY:
        return {"updated_project": project, "changeset": {}, "error": "ANTHROPIC_API_KEY not set"}

    client = _get_client()
    prompt = FIX_PROMPT.format(
        rule_id=failing.rule_id,
        rule_title=failing.rule_title,
        message=failing.message,
        element_ref=failing.element_ref or "",
        element_id=failing.element_id or "",
        layer=failing.layer or "",
    )
    response = await client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text
    changeset = _parse_changeset_from_response(text)
    updated_project = apply_changeset(project, changeset)

    return {
        "updated_project": updated_project,
        "changeset": dataclasses.asdict(changeset),
        "rule_id": rule_id,
    }
