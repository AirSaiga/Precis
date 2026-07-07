"""
@fileoverview Transform 全量配置链路测试

测试内容:
1. FullConfigV2Request 接受 transforms 字段
2. write_v2_full_config 写入 transform 文件到磁盘
3. get_v2_full_config 读取并返回 transforms
4. _merge_manifest_references 合并 transforms 引用

测试策略:
- 单元测试: 使用临时目录隔离，避免污染真实项目
- 验证点: 文件存在性、YAML 内容正确性、Pydantic 模型校验
"""

import os
import sys
import tempfile
from pathlib import Path

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest
import yaml

from app.api.routers.project.full_config_writer import write_v2_full_config
from app.api.routers.project.models import FullConfigV2Request
from app.shared.core.project.manifest.types import (
    ProjectInfoV2,
    ProjectManifestV2,
    ProjectSettingsV2,
    TransformRefV2,
)
from app.shared.core.project.transform.types import TransformFileV2


class TestFullConfigV2RequestTransforms:
    """测试 FullConfigV2Request 接受 transforms 字段"""

    def test_accepts_transforms_field(self):
        """验证 FullConfigV2Request 可以包含 transforms 字典"""
        manifest = ProjectManifestV2(
            version=2,
            project=ProjectInfoV2(id="test", name="test"),
            settings=ProjectSettingsV2(),
            schemas=[],
            constraints=[],
            regex_nodes=[],
            transforms=[TransformRefV2(id="t1", path="transforms/t1.transform.yaml")],
        )

        request = FullConfigV2Request(
            manifest=manifest,
            transforms={
                "t1": TransformFileV2(
                    id="t1",
                    type="StringSplit",
                    output_columns=["area"],
                    params={"strategy": "fixed_position"},
                )
            },
        )

        assert "t1" in request.transforms
        assert request.transforms["t1"].type == "StringSplit"

    def test_transforms_defaults_to_empty_dict(self):
        """验证 transforms 字段默认为空字典"""
        manifest = ProjectManifestV2(
            version=2,
            project=ProjectInfoV2(id="test", name="test"),
            settings=ProjectSettingsV2(),
        )

        request = FullConfigV2Request(manifest=manifest)

        assert request.transforms == {}

    def test_transforms_type_literal_validation(self):
        """验证 transforms 中的 type 字段必须符合 Literal 类型"""
        manifest = ProjectManifestV2(
            version=2,
            project=ProjectInfoV2(id="test", name="test"),
            settings=ProjectSettingsV2(),
        )

        # 有效的 transform 类型
        valid = TransformFileV2(
            id="t1",
            type="StringSplit",
            output_columns=["a"],
        )
        request = FullConfigV2Request(manifest=manifest, transforms={"t1": valid})
        assert request.transforms["t1"].type == "StringSplit"

        # 无效的 transform 类型应抛出 ValidationError
        with pytest.raises(Exception):
            TransformFileV2(
                id="t2",
                type="InvalidType",  # 不在 Literal 中
                output_columns=["a"],
            )


class TestWriteV2FullConfigTransforms:
    """测试 write_v2_full_config 写入 transform 文件"""

    def test_writes_transform_files(self):
        """验证 transforms 被写入磁盘"""
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest = ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="test", name="test"),
                settings=ProjectSettingsV2(),
                schemas=[],
                constraints=[],
                regex_nodes=[],
                transforms=[TransformRefV2(id="split_name", path="transforms/split_name.transform.yaml")],
            )

            payload = FullConfigV2Request(
                manifest=manifest,
                transforms={
                    "split_name": TransformFileV2(
                        id="split_name",
                        type="StringSplit",
                        enabled=True,
                        description="Split full name",
                        input_from_node="users_schema",
                        input_column="full_name",
                        params={
                            "strategy": "delimiter",
                            "delimiter": " ",
                        },
                        output_columns=["first_name", "last_name"],
                    )
                },
            )

            result = write_v2_full_config(payload, tmpdir)
            assert result["message"] == "V2 全量配置已保存。"

            # 验证 manifest 文件存在
            manifest_path = Path(tmpdir) / "project.precis.yaml"
            assert manifest_path.exists()

            # 验证 transform 文件存在
            transform_path = Path(tmpdir) / "transforms" / "split_name.transform.yaml"
            assert transform_path.exists()

            # 验证 YAML 内容正确
            with open(transform_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)

            assert data["id"] == "split_name"
            assert data["type"] == "StringSplit"
            assert data["output_columns"] == ["first_name", "last_name"]
            assert data["params"]["strategy"] == "delimiter"
            assert data["input_from_node"] == "users_schema"
            assert "version" in data

    def test_skips_missing_transform_payload(self):
        """验证 manifest 引用了 transform 但 payload 中没有时跳过"""
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest = ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="test", name="test"),
                settings=ProjectSettingsV2(),
                transforms=[TransformRefV2(id="missing", path="transforms/missing.transform.yaml")],
            )

            payload = FullConfigV2Request(
                manifest=manifest,
                transforms={},  # 空，但 manifest 引用了
            )

            result = write_v2_full_config(payload, tmpdir)
            assert result["message"] == "V2 全量配置已保存。"

            # manifest 应被写入
            assert (Path(tmpdir) / "project.precis.yaml").exists()

            # missing transform 文件不应被创建
            assert not (Path(tmpdir) / "transforms" / "missing.transform.yaml").exists()

    def test_manifest_includes_transform_refs(self):
        """验证写入的 manifest 包含 transforms 引用"""
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest = ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="test", name="test"),
                settings=ProjectSettingsV2(),
                transforms=[TransformRefV2(id="t1", path="transforms/t1.transform.yaml")],
            )

            payload = FullConfigV2Request(
                manifest=manifest,
                transforms={
                    "t1": TransformFileV2(
                        id="t1",
                        type="UpperCase",
                        output_columns=["name_upper"],
                    )
                },
            )

            write_v2_full_config(payload, tmpdir)

            with open(Path(tmpdir) / "project.precis.yaml", encoding="utf-8") as f:
                manifest_data = yaml.safe_load(f)

            assert "transforms" in manifest_data
            assert len(manifest_data["transforms"]) == 1
            assert manifest_data["transforms"][0]["id"] == "t1"
            assert manifest_data["transforms"][0]["path"] == "transforms/t1.transform.yaml"


class TestMergeManifestReferencesTransforms:
    """测试 _merge_manifest_references 合并 transforms 引用"""

    def test_preserves_existing_transform_refs(self):
        """验证 payload 中 transforms 为空时保留现有 manifest 的 transforms"""
        from app.api.routers.project.full_config_writer import _merge_manifest_references

        existing_manifest = ProjectManifestV2(
            version=2,
            project=ProjectInfoV2(id="test", name="test"),
            settings=ProjectSettingsV2(),
            transforms=[TransformRefV2(id="old_t", path="transforms/old_t.transform.yaml")],
        )

        # B03 修复后：transforms 字段必须"未显式设置"才会触发合并。
        # 使用 model_construct 跳过默认值填充，保持 model_fields_set 为空。
        payload_manifest = ProjectManifestV2.model_construct(
            version=2,
            project=ProjectInfoV2(id="test", name="test"),
            settings=ProjectSettingsV2(),
        )
        payload = FullConfigV2Request.model_construct(manifest=payload_manifest)

        with tempfile.TemporaryDirectory() as tmpdir:
            result = _merge_manifest_references(payload, existing_manifest, tmpdir)

        assert len(result.transforms) == 1
        assert result.transforms[0].id == "old_t"

    def test_scans_transforms_directory(self):
        """验证 manifest 和 payload 都未设置 transforms 时扫描 transforms/ 目录"""
        from app.api.routers.project.full_config_writer import _merge_manifest_references

        # B03 修复后：transforms 未显式设置才会触发目录扫描。
        # 显式置为 [] 表示"清空"，不再扫描。
        payload_manifest = ProjectManifestV2.model_construct(
            version=2,
            project=ProjectInfoV2(id="test", name="test"),
            settings=ProjectSettingsV2(),
        )
        payload = FullConfigV2Request.model_construct(manifest=payload_manifest)

        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建模拟的 transform 文件
            transforms_dir = Path(tmpdir) / "transforms"
            transforms_dir.mkdir()
            (transforms_dir / "auto_discovered.transform.yaml").write_text(
                "id: auto_discovered\ntype: StringSplit\noutput_columns: [a]\n",
                encoding="utf-8",
            )

            result = _merge_manifest_references(payload, None, tmpdir)

        assert len(result.transforms) == 1
        assert result.transforms[0].id == "auto_discovered"
        assert result.transforms[0].path == "transforms/auto_discovered.transform.yaml"

    def test_explicit_empty_transforms_clears_references(self):
        """B03 回归：显式设置 transforms=[] 应清空现有引用，而非合并。"""
        from app.api.routers.project.full_config_writer import _merge_manifest_references

        existing_manifest = ProjectManifestV2(
            version=2,
            project=ProjectInfoV2(id="test", name="test"),
            settings=ProjectSettingsV2(),
            transforms=[TransformRefV2(id="old_t", path="transforms/old_t.transform.yaml")],
        )

        # 显式设置 transforms=[]（用户意图：清空）
        payload = FullConfigV2Request(
            manifest=ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="test", name="test"),
                settings=ProjectSettingsV2(),
                transforms=[],
            ),
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            result = _merge_manifest_references(payload, existing_manifest, tmpdir)

        # 显式置空应被尊重：transforms 为空，不合并现有
        assert len(result.transforms) == 0


class TestGetV2FullConfigTransforms:
    """测试 get_v2_full_config 返回 transforms"""

    def test_returns_transforms_in_response(self):
        """验证 get_v2_full_config 返回包含 transforms 的响应"""
        from app.api.routers.project.full_config import get_v2_full_config

        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建最小化项目结构
            manifest = ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="test", name="test"),
                settings=ProjectSettingsV2(),
                transforms=[TransformRefV2(id="t1", path="transforms/t1.transform.yaml")],
            )

            # 写入 manifest
            manifest_path = Path(tmpdir) / "project.precis.yaml"
            with open(manifest_path, "w", encoding="utf-8") as f:
                yaml.dump(manifest.model_dump(exclude_none=True), f, allow_unicode=True)

            # 写入 transform 文件
            transforms_dir = Path(tmpdir) / "transforms"
            transforms_dir.mkdir()
            transform_file = transforms_dir / "t1.transform.yaml"
            with open(transform_file, "w", encoding="utf-8") as f:
                yaml.dump(
                    {
                        "version": 2,
                        "id": "t1",
                        "type": "StringSplit",
                        "output_columns": ["first", "last"],
                        "params": {"delimiter": " "},
                    },
                    f,
                    allow_unicode=True,
                )

            # 模拟 get_project_config_path 返回 tmpdir
            result = get_v2_full_config(config_path=tmpdir)

            assert "transforms" in result
            assert "t1" in result["transforms"]
            assert result["transforms"]["t1"]["type"] == "StringSplit"
            assert result["transforms"]["t1"]["output_columns"] == ["first", "last"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
