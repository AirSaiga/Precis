"""
L01 隐藏行为测试 — AI 生成全量配置时 settings 合并语义。

本文件由 challenges/L01-spec-merge-settings/verify.py 临时注入到
backend/tests/unit/test_l01_settings_merge.py 后以 pytest 运行，verify 完成后清理。

测试全部走真实链路 write_v2_full_config：
  1. 把"用户既有 manifest"（含自定义 settings）写入临时目录
  2. 构造 AI 生成的 payload（各种 settings 形态）
  3. 调用 write_v2_full_config 后读回 project.precis.yaml
  4. 断言最终 settings 的合并结果

注意：本测试只验证可观察行为（写入磁盘的最终配置），不依赖任何实现细节。
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import yaml

from app.api.routers.project.full_config_writer import write_v2_full_config
from app.api.routers.project.models import FullConfigV2Request
from app.shared.core.io.yaml import read_yaml
from app.shared.core.project.manifest.types import (
    FileProcessingSettingsV2,
    ProjectInfoV2,
    ProjectManifestV2,
    ProjectSettingsV2,
    ValidationSettingsV2,
)


def _write_existing_manifest(path: Path, settings_block: dict | None) -> None:
    """写入用户既有 manifest。settings_block 为 None 时不写 settings 键。"""
    manifest: dict = {
        "version": 2,
        "project": {"id": "p", "name": "P"},
        "schemas": [],
    }
    if settings_block is not None:
        manifest["settings"] = settings_block
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(manifest, f, allow_unicode=True)


# 用户既有自定义设置（四个叶子值都不是内置默认值）
_CUSTOM_SETTINGS = {
    "validation": {"strict_mode": True, "timeout_seconds": 60},
    "file_processing": {"csv_delimiter": ";"},
    "script_security": {"timeout_seconds": 20},
}


def _make_payload(settings=None) -> FullConfigV2Request:
    """构造 AI 生成的全量配置 payload。

    settings 传 None 表示"AI 完全没有提供 settings 键"（走模型默认值）；
    其余情况传构造好的 ProjectSettingsV2。
    """
    kwargs: dict = {
        "version": 2,
        "project": ProjectInfoV2(id="p", name="P"),
        "schemas": [],
    }
    if settings is not None:
        kwargs["settings"] = settings
    manifest = ProjectManifestV2(**kwargs)
    return FullConfigV2Request(manifest=manifest)


def _read_back_settings(tmpdir: str) -> dict:
    """读回写入后的 manifest 设置（转为普通 dict 便于断言）。"""
    data = read_yaml(Path(tmpdir) / "project.precis.yaml")
    return data.get("settings", {})


def test_preserves_custom_settings_when_ai_omits_settings():
    """AI 生成配置时若完全未提供 settings，用户既有自定义设置必须原样保留。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        _write_existing_manifest(Path(tmpdir) / "project.precis.yaml", _CUSTOM_SETTINGS)

        write_v2_full_config(_make_payload(settings=None), tmpdir)

        settings = _read_back_settings(tmpdir)
        assert settings["validation"]["strict_mode"] is True
        assert settings["validation"]["timeout_seconds"] == 60
        assert settings["file_processing"]["csv_delimiter"] == ";"
        assert settings["script_security"]["timeout_seconds"] == 20


def test_nested_merge_explicit_leaf_wins_rest_preserved():
    """AI 只显式给出某个叶子字段时：该叶子生效，其余叶子保留用户既有值。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        _write_existing_manifest(Path(tmpdir) / "project.precis.yaml", _CUSTOM_SETTINGS)

        # AI 只显式设置了 validation.strict_mode；file_processing / script_security 未提供
        payload_settings = ProjectSettingsV2(
            validation=ValidationSettingsV2(strict_mode=False),
        )
        write_v2_full_config(_make_payload(settings=payload_settings), tmpdir)

        settings = _read_back_settings(tmpdir)
        # AI 显式给出的叶子生效
        assert settings["validation"]["strict_mode"] is False
        # 用户既有、AI 未给出的叶子保留
        assert settings["validation"]["timeout_seconds"] == 60
        # AI 未提供的整个子设置保留用户值
        assert settings["file_processing"]["csv_delimiter"] == ";"
        assert settings["script_security"]["timeout_seconds"] == 20


def test_ai_explicit_value_overrides_user_default():
    """AI 显式给出的值覆盖用户未定制（默认值）的字段，同时用户显式值不受牵连。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        _write_existing_manifest(Path(tmpdir) / "project.precis.yaml", _CUSTOM_SETTINGS)

        payload_settings = ProjectSettingsV2(
            validation=ValidationSettingsV2(auto_validate=False),
            file_processing=FileProcessingSettingsV2(default_encoding="gbk"),
        )
        write_v2_full_config(_make_payload(settings=payload_settings), tmpdir)

        settings = _read_back_settings(tmpdir)
        # AI 显式值覆盖用户未定制的默认字段
        assert settings["validation"]["auto_validate"] is False
        assert settings["file_processing"]["default_encoding"] == "gbk"
        # 用户显式定制、AI 未给出的值不受牵连
        assert settings["validation"]["strict_mode"] is True
        assert settings["validation"]["timeout_seconds"] == 60
        assert settings["file_processing"]["csv_delimiter"] == ";"
        assert settings["script_security"]["timeout_seconds"] == 20


def test_ai_default_settings_do_not_wipe_user_customization():
    """AI 提供了 settings 键但内容全为默认值时，不得把用户自定义值冲掉。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        _write_existing_manifest(Path(tmpdir) / "project.precis.yaml", _CUSTOM_SETTINGS)

        # AI 侧：settings 键存在，但三个子设置都没有任何显式叶子（纯默认构造）
        payload_settings = ProjectSettingsV2()
        write_v2_full_config(_make_payload(settings=payload_settings), tmpdir)

        settings = _read_back_settings(tmpdir)
        assert settings["validation"]["strict_mode"] is True
        assert settings["validation"]["timeout_seconds"] == 60
        assert settings["file_processing"]["csv_delimiter"] == ";"
        assert settings["script_security"]["timeout_seconds"] == 20
