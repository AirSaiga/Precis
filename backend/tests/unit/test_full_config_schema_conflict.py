"""@fileoverview get_v2_full_config 的 Schema ID 冲突防覆盖测试

覆盖范围:
- 两个 schema 文件 id 相同时，不应静默覆盖，而应记录到 schema_errors

测试原则:
- 测行为不测实现: 验证返回的 schemas dict 与 schema_errors
- 用临时目录构造真实的项目结构
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import yaml

from app.api.routers.project.full_config import get_v2_full_config


def _write_schema(path: Path, schema_id: str, name: str, col_id: str) -> None:
    """写入一个最小化的 schema 文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(
            {
                "version": 2,
                "id": schema_id,
                "name": name,
                "columns": [{"id": col_id, "name": col_id, "type": "string"}],
            },
            f,
            allow_unicode=True,
        )


def _write_manifest(path: Path, schemas: list[dict]) -> None:
    """写入 manifest，schemas 是 [{"id":..., "path":...}, ...]。"""
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(
            {
                "version": 2,
                "project": {"id": "p", "name": "P"},
                "schemas": schemas,
            },
            f,
            allow_unicode=True,
        )


class TestFullConfigSchemaIdConflict:
    """两个 schema 文件使用同一 id 时，get_v2_full_config 不应静默覆盖。"""

    def test_conflicting_ids_recorded_in_schema_errors(self):
        """两个文件 id 都是 'users' → schemas dict 只保留首个，schema_errors 记录冲突。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            # 第一个文件登记在 manifest
            _write_schema(tmp / "schemas" / "users.csv.schema.yaml", "users", "users", "email")
            # 孤儿文件（未登记），id 也是 users
            _write_schema(tmp / "schemas" / "users.schema.yaml", "users", "users_alt", "phone")
            _write_manifest(
                tmp / "project.precis.yaml",
                [{"id": "users", "path": "schemas/users.csv.schema.yaml"}],
            )

            result = get_v2_full_config(config_path=tmpdir)

            # schemas dict 仍只含一个 users（第一个胜出）
            assert "users" in result["schemas"]
            # 冲突应被记录到 schema_errors（而非静默覆盖）
            assert "users" in result["schema_errors"]
            assert "冲突" in result["schema_errors"]["users"] or "多个" in result["schema_errors"]["users"]

    def test_distinct_ids_no_conflict_error(self):
        """两个文件 id 不同 → 正常加载，无 schema_errors 记录。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_schema(tmp / "schemas" / "users.schema.yaml", "users", "users", "email")
            _write_schema(tmp / "schemas" / "orders.schema.yaml", "orders", "orders", "amount")
            _write_manifest(
                tmp / "project.precis.yaml",
                [
                    {"id": "users", "path": "schemas/users.schema.yaml"},
                    {"id": "orders", "path": "schemas/orders.schema.yaml"},
                ],
            )

            result = get_v2_full_config(config_path=tmpdir)

            assert "users" in result["schemas"]
            assert "orders" in result["schemas"]
            # 不应有冲突错误
            assert "users" not in result.get("schema_errors", {})
            assert "orders" not in result.get("schema_errors", {})

    def test_inspect_reports_blocker_on_conflict(self):
        """inspect=true 时，同 id 冲突应在 inspection.errors 中上报 blocker。

        回归场景:之前 inspect_schema_id_orphan_conflict 依赖 manifest 白名单
        判定孤儿，但 get_v2_full_config 传入的是 effective_manifest（已合并孤儿），
        导致检测失效、面板无 blocker 可显示。改用磁盘扫描后应稳定上报。
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            # 两个文件 id 都是 users，一个登记、一个孤儿
            _write_schema(tmp / "schemas" / "users.csv.schema.yaml", "users", "users", "email")
            _write_schema(tmp / "schemas" / "users.schema.yaml", "users", "users_alt", "phone")
            _write_manifest(
                tmp / "project.precis.yaml",
                [{"id": "users", "path": "schemas/users.csv.schema.yaml"}],
            )

            result = get_v2_full_config(config_path=tmpdir, inspect=True)

            assert "inspection" in result
            blockers = [
                e
                for e in result["inspection"]["errors"]
                if e.get("severity") == "blocker" and e.get("error_type") == "SchemaIdDuplicate"
            ]
            assert len(blockers) == 1
            assert "users" in blockers[0]["title"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
