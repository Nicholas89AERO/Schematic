"""
ChangeSet — describes a set of model mutations produced by the AI or compliance fixer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from .project import DrawingLayer


class OperationType(str, Enum):
    ADD    = "add"
    MODIFY = "modify"
    DELETE = "delete"


class ElementKind(str, Enum):
    # Layer 1
    LRU_BLOCK      = "lru_block"
    SIGNAL_PATH    = "signal_path"
    POWER_BUS      = "power_bus"
    # Layer 2
    COMPONENT      = "component"
    CONNECTOR_SHELL = "connector_shell"
    CONNECTOR_PIN  = "connector_pin"
    WIRE_SEGMENT   = "wire_segment"
    CONNECTION     = "connection"
    # Layer 3
    WIRE_RECORD    = "wire_record"
    CONNECTOR_DETAIL = "connector_detail"
    SPLICE         = "splice"
    HARNESS_ASSEMBLY = "harness_assembly"
    HARNESS_BREAKOUT = "harness_breakout"
    # Shared
    CROSS_REF      = "cross_ref"
    TITLE_BLOCK    = "title_block"


@dataclass
class ChangeOperation:
    operation: OperationType = OperationType.ADD
    element_kind: ElementKind = ElementKind.COMPONENT
    element_id: Optional[str] = None       # existing element id for MODIFY/DELETE
    layer: DrawingLayer = DrawingLayer.SCHEMATIC
    sheet: Optional[int] = None
    before: Optional[dict] = None          # snapshot before change (for diff)
    after: Optional[dict] = None           # new/modified element as dict
    description: str = ""                  # human-readable description


@dataclass
class ChangeSet:
    """An ordered list of change operations to apply to a ProjectModel."""
    changeset_id: str = field(default_factory=lambda: __import__("uuid").uuid4().__str__())
    source_layer: Optional[DrawingLayer] = None
    prompt: str = ""
    rationale: str = ""
    operations: list[ChangeOperation] = field(default_factory=list)
    ai_generated: bool = False
    applied: bool = False

    def add(
        self,
        operation: OperationType,
        kind: ElementKind,
        layer: DrawingLayer,
        after: dict,
        element_id: Optional[str] = None,
        before: Optional[dict] = None,
        description: str = "",
        sheet: Optional[int] = None,
    ) -> None:
        self.operations.append(
            ChangeOperation(
                operation=operation,
                element_kind=kind,
                element_id=element_id,
                layer=layer,
                sheet=sheet,
                before=before,
                after=after,
                description=description,
            )
        )
