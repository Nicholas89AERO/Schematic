"""Async PostgreSQL persistence for ProjectModel."""

from __future__ import annotations

import os
from typing import Optional

from sqlalchemy import Column, DateTime, MetaData, Table, Text, func, select
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from models.project import ProjectModel
from serialization import dict_to_project, model_to_dict

_engine: Optional[AsyncEngine] = None
_memory_store: dict[str, ProjectModel] = {}

metadata = MetaData()

projects_table = Table(
    "projects",
    metadata,
    Column("project_id", Text, primary_key=True),
    Column("data", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()),
)


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


def _get_engine() -> Optional[AsyncEngine]:
    global _engine
    if _engine is not None:
        return _engine

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None

    _engine = create_async_engine(
        _normalize_database_url(database_url),
        echo=False,
    )
    return _engine


async def init_db() -> None:
    """Create the projects table if PostgreSQL is configured."""
    engine = _get_engine()
    if engine is None:
        return

    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)


async def get_project(project_id: str) -> Optional[ProjectModel]:
    engine = _get_engine()
    if engine is None:
        return _memory_store.get(project_id)

    async with engine.connect() as conn:
        result = await conn.execute(
            select(projects_table.c.data).where(projects_table.c.project_id == project_id)
        )
        row = result.first()
        if row is None:
            return None
        return dict_to_project(row.data)


async def save_project(project: ProjectModel) -> None:
    engine = _get_engine()
    if engine is None:
        _memory_store[project.project_id] = project
        return

    payload = model_to_dict(project)
    stmt = insert(projects_table).values(
        project_id=project.project_id,
        data=payload,
    ).on_conflict_do_update(
        index_elements=[projects_table.c.project_id],
        set_={
            "data": payload,
            "updated_at": func.now(),
        },
    )

    async with engine.begin() as conn:
        await conn.execute(stmt)


async def delete_project(project_id: str) -> bool:
    engine = _get_engine()
    if engine is None:
        return _memory_store.pop(project_id, None) is not None

    async with engine.begin() as conn:
        result = await conn.execute(
            projects_table.delete().where(projects_table.c.project_id == project_id)
        )
        return result.rowcount > 0
