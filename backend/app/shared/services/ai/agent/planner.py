"""@fileoverview Agent 分块规划器

功能概述:
- 根据数据文件数量、列数自动决定分块策略
- 输出 chunk 列表，每个 chunk 包含要处理的文件/列范围

架构设计:
- 简单启发式：文件数多按文件分，列数多按列分
- 每个 chunk 独立生成配置，最后合并
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Chunk:
    """单个分块"""

    chunk_id: str
    file_paths: list[str] = field(default_factory=list)
    table_names: list[str] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)
    reason: str = ""


@dataclass
class ChunkPlan:
    """分块计划"""

    chunks: list[Chunk] = field(default_factory=list)
    strategy: str = ""
    reason: str = ""


def build_chunk_plan(
    profiling_data: list[dict],
    file_paths: list[str],
    max_columns_per_chunk: int = 20,
    max_files_per_chunk: int = 5,
) -> ChunkPlan:
    """
    @methoddesc 构建分块计划

    参数:
        profiling_data: 数据画像
        file_paths: 所有文件路径
        max_columns_per_chunk: 每个 chunk 最大列数
        max_files_per_chunk: 每个 chunk 最大文件数

    返回:
        ChunkPlan 分块计划
    """
    total_files = len(profiling_data)
    total_columns = sum(len(item.get("columns", [])) for item in profiling_data)

    # 决定策略
    if total_files > max_files_per_chunk:
        strategy = "by_file"
        chunks = _chunk_by_file(profiling_data, max_files_per_chunk)
    elif total_columns > max_columns_per_chunk:
        strategy = "by_column"
        chunks = _chunk_by_column(profiling_data, max_columns_per_chunk)
    else:
        strategy = "single"
        chunks = [
            Chunk(
                chunk_id="single",
                file_paths=file_paths,
                table_names=[item.get("table_name", "") for item in profiling_data],
                reason="数据量较小，一次性处理",
            )
        ]

    reason = f"共 {total_files} 个文件、{total_columns} 列，采用 {strategy} 策略"
    return ChunkPlan(chunks=chunks, strategy=strategy, reason=reason)


def _chunk_by_file(profiling_data: list[dict], max_files_per_chunk: int) -> list[Chunk]:
    """按文件分块。"""
    chunks: list[Chunk] = []
    for i in range(0, len(profiling_data), max_files_per_chunk):
        group = profiling_data[i : i + max_files_per_chunk]
        chunk_id = f"files_{i // max_files_per_chunk + 1}"
        chunks.append(
            Chunk(
                chunk_id=chunk_id,
                file_paths=[item.get("path", "") for item in group],
                table_names=[item.get("table_name", "") for item in group],
                reason=f"处理第 {i + 1}-{min(i + max_files_per_chunk, len(profiling_data))} 个文件",
            )
        )
    return chunks


def _chunk_by_column(profiling_data: list[dict], max_columns_per_chunk: int) -> list[Chunk]:
    """按列分块（优先保持同文件列在一起，但单表列数超过限制时拆表）。"""
    chunks: list[Chunk] = []
    chunk_index = 1

    for item in profiling_data:
        table_name = item.get("table_name", "")
        path = item.get("path", "")
        columns = item.get("columns", [])
        col_names = [f"{table_name}.{col.get('name', '')}" for col in columns]

        # 如果单表列数超过限制，拆分该表
        if len(col_names) > max_columns_per_chunk:
            for i in range(0, len(col_names), max_columns_per_chunk):
                chunk = Chunk(
                    chunk_id=f"cols_{chunk_index}",
                    file_paths=[path],
                    table_names=[table_name],
                    columns=col_names[i : i + max_columns_per_chunk],
                    reason=f"表 {table_name} 列数过多，拆分为第 {i // max_columns_per_chunk + 1} 组",
                )
                chunks.append(chunk)
                chunk_index += 1
            continue

        # 否则尝试加入当前 chunk
        if chunks and len(chunks[-1].columns) + len(col_names) <= max_columns_per_chunk:
            current = chunks[-1]
            if path and path not in current.file_paths:
                current.file_paths.append(path)
            if table_name and table_name not in current.table_names:
                current.table_names.append(table_name)
            current.columns.extend(col_names)
            current.reason = f"按列分组，共 {len(current.columns)} 列"
        else:
            chunk = Chunk(
                chunk_id=f"cols_{chunk_index}",
                file_paths=[path],
                table_names=[table_name],
                columns=col_names,
                reason=f"按列分组，共 {len(col_names)} 列",
            )
            chunks.append(chunk)
            chunk_index += 1

    return chunks


def plan_to_dict(plan: ChunkPlan) -> dict[str, Any]:
    """将 ChunkPlan 转为可 JSON 序列化的字典。"""
    return {
        "strategy": plan.strategy,
        "reason": plan.reason,
        "chunks": [
            {
                "chunk_id": c.chunk_id,
                "file_paths": c.file_paths,
                "table_names": c.table_names,
                "columns": c.columns,
                "reason": c.reason,
            }
            for c in plan.chunks
        ],
    }


# ===== 按源(source)分块（迁移专用，不影响 generation 主路径）=====


@dataclass
class SourceChunk:
    """单个来源分片"""

    chunk_id: str
    source_names: list[str] = field(default_factory=list)
    source_indices: list[int] = field(default_factory=list)  # 指向 parsed_intents 原始列表
    reason: str = ""


@dataclass
class SourceChunkPlan:
    """来源分块计划"""

    chunks: list[SourceChunk] = field(default_factory=list)
    strategy: str = ""  # single | by_source
    reason: str = ""


def _estimate_intent_tokens(intent_text: str) -> int:
    """保守估算意图文本 token 数。"""
    return max(1, len(intent_text or "") // 3)


def build_source_chunk_plan(
    parsed_intents: list[dict],
    max_sources_per_chunk: int = 5,
    max_tokens_per_chunk: int = 8000,
) -> SourceChunkPlan:
    """
    @methoddesc 构建按源分块计划

    参数:
        parsed_intents: 解析后的来源意图列表，每个元素含 name/intent
        max_sources_per_chunk: 每个分片最大来源数
        max_tokens_per_chunk: 每个分片最大估算 token 数

    返回:
        SourceChunkPlan 分块计划
    """
    n = len(parsed_intents)
    if n == 0:
        return SourceChunkPlan(chunks=[], strategy="single", reason="无来源，无需分片")

    total_tokens = sum(_estimate_intent_tokens(it.get("intent", "")) for it in parsed_intents)
    if n <= max_sources_per_chunk and total_tokens <= max_tokens_per_chunk:
        return SourceChunkPlan(
            chunks=[
                SourceChunk(
                    chunk_id="source_single",
                    source_names=[it.get("name") or f"source_{idx + 1}" for idx, it in enumerate(parsed_intents)],
                    source_indices=list(range(n)),
                    reason=f"来源数 {n}、估算 {total_tokens} token，单次处理",
                )
            ],
            strategy="single",
            reason=f"共 {n} 个来源，单次处理",
        )

    chunks: list[SourceChunk] = []
    current = SourceChunk(chunk_id="source_chunk_1")
    current_tokens = 0
    for idx, it in enumerate(parsed_intents):
        it_tokens = _estimate_intent_tokens(it.get("intent", ""))
        over_sources = len(current.source_indices) >= max_sources_per_chunk
        over_tokens = current_tokens + it_tokens > max_tokens_per_chunk and current.source_indices
        if over_sources or over_tokens:
            current.reason = f"分片含 {len(current.source_indices)} 个来源，约 {current_tokens} token"
            chunks.append(current)
            current = SourceChunk(chunk_id=f"source_chunk_{len(chunks) + 1}")
            current_tokens = 0
        current.source_indices.append(idx)
        current.source_names.append(it.get("name", f"source_{idx + 1}"))
        current_tokens += it_tokens

    if current.source_indices:
        current.reason = f"分片含 {len(current.source_indices)} 个来源，约 {current_tokens} token"
        chunks.append(current)

    return SourceChunkPlan(
        chunks=chunks,
        strategy="by_source",
        reason=f"共 {n} 个来源、约 {total_tokens} token，按源拆分为 {len(chunks)} 个分片",
    )


def source_plan_to_dict(plan: SourceChunkPlan) -> dict[str, Any]:
    """将 SourceChunkPlan 转为可 JSON 序列化的字典。"""
    return {
        "strategy": plan.strategy,
        "reason": plan.reason,
        "chunks": [
            {
                "chunk_id": c.chunk_id,
                "source_names": c.source_names,
                "source_indices": c.source_indices,
                "reason": c.reason,
            }
            for c in plan.chunks
        ],
    }
