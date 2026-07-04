"""@fileoverview 向后兼容垫片（deprecated）

本模块已重命名为 ``pending_interaction_store``。新代码请直接 import 新模块。
此文件仅为 apply_actions / orchestrator / stream 等旧调用方保留，
避免改名期间破坏 import 链；Task 2 迁移完所有引用后可删除本文件。

所有符号从 ``pending_interaction_store`` 透传/别名：
- ConfirmController / InteractionController: 直接透传
- InMemoryPendingApplyStore: 旧名别名 → InMemoryPendingInteractionStore
- PendingApplyStore: 旧名别名 → PendingInteractionStore
- get_global_pending_store: 旧名别名 → get_global_pending_interaction_store
"""

from __future__ import annotations

from app.shared.services.ai.streaming.pending_interaction_store import (
    ConfirmController,
    InMemoryPendingInteractionStore,
    InteractionController,
    PendingInteractionStore,
    get_global_pending_interaction_store,
)

# 向后兼容别名（apply_actions 仍用旧名）
InMemoryPendingApplyStore = InMemoryPendingInteractionStore
PendingApplyStore = PendingInteractionStore


def get_global_pending_store() -> PendingInteractionStore:
    """旧名别名 → get_global_pending_interaction_store（deprecated）。"""
    return get_global_pending_interaction_store()


__all__ = [
    "ConfirmController",
    "InteractionController",
    "InMemoryPendingApplyStore",
    "InMemoryPendingInteractionStore",
    "PendingApplyStore",
    "PendingInteractionStore",
    "get_global_pending_interaction_store",
    "get_global_pending_store",
]
