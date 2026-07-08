# backend/app/shared/services/validation/progress.py
"""
@fileoverview 校验进度事件

功能概述:
- 定义 ProgressEvent 数据类，用于校验执行器向调用方（TUI/API）上抛进度。
- 作为旁路通道：不影响 ValidationResult，仅用于实时展示（sparkline/进度条）。
- 校验执行器在阶段切换/分块边界构造事件并回调 progress_callback。

设计要点:
- 纯数据 dataclass，无逻辑依赖，便于跨层传递与单测。
- rows_total 为预估值（无法预估时为 0），调用方需容忍 0。
- chunk_index 为 1-based（非分块模式恒为 0），与日志/错误中的 chunk_index 口径一致。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ProgressEvent:
    """校验进度事件（上抛给调用方用于实时展示）。

    Attributes:
        stage: 当前阶段，取值 "loading" | "validating" | "done"。
            - loading: 数据加载阶段（表粒度或加载完成）
            - validating: 校验执行阶段（分块粒度或整体前后）
            - done: 校验完成（含后处理）
        table: 当前处理的表名；loading 阶段未确定时可为 None。
        chunk_index: 当前分块序号（1-based）；非分块模式恒为 0。
        chunk_total: 总分块数；非分块模式恒为 0。
        rows_done: 累计已处理行数。
        rows_total: 总行数（预估，无法预估时为 0）。
        errors_so_far: 累计错误数。
        elapsed_ms: 已耗时（毫秒）。
    """

    stage: str
    table: str | None
    chunk_index: int
    chunk_total: int
    rows_done: int
    rows_total: int
    errors_so_far: int
    elapsed_ms: int


__all__ = ["ProgressEvent"]
