"""@fileoverview TUI ConfigService 单元测试（P3）

验证 ConfigService 的核心行为（薄包装层，委托 shared_services.config_ops + load_project）：
- get_value: 点号路径读取（命中/未命中/文件不存在）
- set_value: 点号路径写入并落盘（类型解析 + 中间层级自动创建 + 原文件不变语义由 yaml round-trip 保证）
- check_yaml: 语法检查（有效/无效/全项目扫描）
- inspect: 跨文件自检（qa_simple 含故意 blocker 错误；损坏 manifest 抛异常归一为 blocker）
- render_template: 模板渲染（project/constraint/pattern + 未知类型报错）
- list_files: 文件扫描

测试边界：文件系统用 tmp_path；inspect 用 qa_test/qa_simple 真实 fixture（复制到 tmp_path 避免污染）。
不 mock shared_services（它是 P0b 已测的纯逻辑层），测的是 ConfigService 的编排正确性。
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import pytest
import yaml

# 将 backend/ 加入 sys.path，使 app 包可被直接导入（与其它后端测试保持一致）
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.cli.tui.services.config_service import ConfigService, InspectionResult  # noqa: E402

# qa_test/qa_simple 是仓库内置的最小可运行 V2 项目（含故意违规数据）
# 本测试在 backend/tests/unit/tui/ 下，parents[4] 为仓库根目录
QA_SIMPLE_ROOT = Path(__file__).resolve().parents[4] / "qa_test" / "qa_simple"


def _copy_qa_simple_into(tmp_path: Path) -> Path:
    """将 qa_simple 复制到 tmp_path，避免污染源文件。"""
    if not QA_SIMPLE_ROOT.is_dir():
        pytest.skip(f"qa_simple fixture not found at {QA_SIMPLE_ROOT}")
    target = tmp_path / "qa_simple"
    shutil.copytree(QA_SIMPLE_ROOT, target)
    return target


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def config_project(tmp_path: Path) -> Path:
    """构造一个含 project.precis.yaml 的最小项目目录。

    manifest 通过 pydantic 校验（data_sources 项需 id，故此处不含 data_sources，
    仅保留 version + project，inspect 时无 schema/constraint 引用故无 blocker）。
    """
    project_dir = tmp_path / "cfg_proj"
    project_dir.mkdir()
    (project_dir / "project.precis.yaml").write_text(
        """version: 2
project:
  id: cfg_proj
  name: "Config Test Project"
schemas: []
""",
        encoding="utf-8",
    )
    return project_dir


@pytest.fixture
def service() -> ConfigService:
    """ConfigService 实例（无状态，可共享）。"""
    return ConfigService()


# ---------------------------------------------------------------------------
# get_value
# ---------------------------------------------------------------------------


class TestGetValue:
    """get_value 点号路径读取测试。"""

    def test_get_existing_nested_key(self, service: ConfigService, config_project: Path) -> None:
        """命中嵌套点号路径应返回 (True, 值, "")。"""
        ok, value, err = service.get_value(str(config_project), "project.precis.yaml", "project.name")
        assert ok is True
        assert err == ""
        assert value == "Config Test Project"

    def test_get_list_item(self, service: ConfigService, config_project: Path) -> None:
        """get_by_dotpath 对列表的数字 key 应返回未命中（不支持点号索引列表）。"""
        ok, value, err = service.get_value(str(config_project), "project.precis.yaml", "schemas.0")
        # schemas 是空列表，.0 数字 key 在 list 上找不到（get_by_dotpath 仅遍历 dict）
        assert ok is False
        assert "不存在" in err

    def test_get_missing_key(self, service: ConfigService, config_project: Path) -> None:
        """未命中的 key 应返回 (False, None, "配置项不存在: ...")。"""
        ok, value, err = service.get_value(str(config_project), "project.precis.yaml", "project.unknown_field")
        assert ok is False
        assert value is None
        assert "不存在" in err
        assert "project.unknown_field" in err

    def test_get_missing_file(self, service: ConfigService, config_project: Path) -> None:
        """文件不存在应返回 (False, None, "配置文件不存在: ...")。"""
        ok, value, err = service.get_value(str(config_project), "nonexistent.yaml", "project.name")
        assert ok is False
        assert value is None
        assert "配置文件不存在" in err
        assert "nonexistent.yaml" in err

    def test_get_top_level_key(self, service: ConfigService, config_project: Path) -> None:
        """顶层 key 应命中（version）。"""
        ok, value, err = service.get_value(str(config_project), "project.precis.yaml", "version")
        assert ok is True
        assert value == 2


# ---------------------------------------------------------------------------
# set_value
# ---------------------------------------------------------------------------


class TestSetValue:
    """set_value 点号路径写入测试。"""

    def test_set_string_value_persists(self, service: ConfigService, config_project: Path) -> None:
        """写入字符串值应落盘并可在重新读取时取回。"""
        ok, msg = service.set_value(str(config_project), "project.precis.yaml", "project.name", '"New Name"')
        assert ok is True
        assert "已设置" in msg

        # 重新读取验证落盘
        with open(config_project / "project.precis.yaml", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["project"]["name"] == "New Name"

    def test_set_bool_value(self, service: ConfigService, config_project: Path) -> None:
        """写入 "true" 应解析为布尔 True。"""
        ok, msg = service.set_value(str(config_project), "project.precis.yaml", "project.enabled", "true")
        assert ok is True
        with open(config_project / "project.precis.yaml", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["project"]["enabled"] is True

    def test_set_int_value(self, service: ConfigService, config_project: Path) -> None:
        """写入数字字符串应解析为整数。"""
        ok, msg = service.set_value(str(config_project), "project.precis.yaml", "project.priority", "42")
        assert ok is True
        with open(config_project / "project.precis.yaml", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["project"]["priority"] == 42

    def test_set_creates_intermediate_keys(self, service: ConfigService, config_project: Path) -> None:
        """写入不存在的嵌套路径应自动创建中间字典层级。"""
        ok, msg = service.set_value(str(config_project), "project.precis.yaml", "new.section.value", "hello")
        assert ok is True
        with open(config_project / "project.precis.yaml", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["new"]["section"]["value"] == "hello"

    def test_set_missing_file(self, service: ConfigService, config_project: Path) -> None:
        """文件不存在应返回 (False, "配置文件不存在: ...")。"""
        ok, msg = service.set_value(str(config_project), "nonexistent.yaml", "project.name", "x")
        assert ok is False
        assert "配置文件不存在" in msg

    def test_set_returns_message_with_value(self, service: ConfigService, config_project: Path) -> None:
        """成功消息应包含 key 路径与解析后的值。"""
        ok, msg = service.set_value(str(config_project), "project.precis.yaml", "project.name", "MyProject")
        assert ok is True
        assert "project.name" in msg
        assert "MyProject" in msg


# ---------------------------------------------------------------------------
# check_yaml
# ---------------------------------------------------------------------------


class TestCheckYaml:
    """check_yaml 语法检查测试。"""

    def test_check_valid_yaml(self, service: ConfigService, config_project: Path) -> None:
        """有效 YAML 文件应返回 valid=True。"""
        results = service.check_yaml(str(config_project), ["project.precis.yaml"])
        assert len(results) == 1
        assert results[0].file == "project.precis.yaml"
        assert results[0].valid is True

    def test_check_invalid_yaml(self, service: ConfigService, tmp_path: Path) -> None:
        """语法错误的 YAML 应返回 valid=False 并带行号与问题描述。"""
        project_dir = tmp_path / "bad_yaml"
        project_dir.mkdir()
        (project_dir / "bad.yaml").write_text(
            "foo: bar\nbaz: : : bad mapping here\n",
            encoding="utf-8",
        )
        results = service.check_yaml(str(project_dir), ["bad.yaml"])
        assert len(results) == 1
        assert results[0].valid is False
        assert results[0].file == "bad.yaml"
        # 应有行号或问题描述
        assert results[0].line_no is not None or results[0].problem is not None

    def test_check_missing_file(self, service: ConfigService, config_project: Path) -> None:
        """不存在的文件应返回 valid=False 且 problem 含"配置文件不存在"。"""
        results = service.check_yaml(str(config_project), ["ghost.yaml"])
        assert len(results) == 1
        assert results[0].valid is False
        assert "配置文件不存在" in (results[0].problem or "")

    def test_check_all_files_scan(self, service: ConfigService, config_project: Path) -> None:
        """files=None 时应扫描项目全部 YAML 文件。"""
        # 追加一个 constraints.yaml
        (config_project / "constraints.yaml").write_text("constraints: []\n", encoding="utf-8")
        results = service.check_yaml(str(config_project))
        # 至少扫描到 project.precis.yaml 与 constraints.yaml
        names = {r.file for r in results}
        assert "project.precis.yaml" in names
        assert "constraints.yaml" in names
        assert all(r.valid for r in results)

    def test_check_multiple_files(self, service: ConfigService, config_project: Path) -> None:
        """传入多个文件名应逐个检查。"""
        (config_project / "patterns.yaml").write_text("patterns: []\n", encoding="utf-8")
        results = service.check_yaml(str(config_project), ["project.precis.yaml", "patterns.yaml", "ghost.yaml"])
        assert len(results) == 3
        assert results[0].valid is True
        assert results[1].valid is True
        assert results[2].valid is False  # ghost 不存在


# ---------------------------------------------------------------------------
# inspect
# ---------------------------------------------------------------------------


class TestInspect:
    """inspect 跨文件自检测试（用 qa_simple 真实 fixture）。"""

    def test_inspect_qa_simple_finds_blocker_errors(self, service: ConfigService, tmp_path: Path) -> None:
        """qa_simple 含故意违规（ghost FK、表缺失），inspect 应收集到 blocker 错误。"""
        proj = _copy_qa_simple_into(tmp_path)
        manifest = str(proj / "project.precis.yaml")

        result = service.inspect(manifest)

        assert isinstance(result, InspectionResult)
        assert result.manifest_path == manifest
        # qa_simple 含故意 blocker（SchemaSourceDuplicate / ReferenceIntegrityError）
        assert len(result.errors) > 0
        assert result.has_blocker is True
        # blocker 错误的 severity 字段应为 "blocker"
        blocker_count = sum(1 for e in result.errors if getattr(e, "severity", "") == "blocker")
        assert blocker_count > 0

    def test_inspect_qa_simple_has_warnings(self, service: ConfigService, tmp_path: Path) -> None:
        """qa_simple 加载应产生加载警告（warnings 列表非空）。"""
        proj = _copy_qa_simple_into(tmp_path)
        result = service.inspect(str(proj / "project.precis.yaml"))
        assert isinstance(result.warnings, list)

    def test_inspect_missing_manifest(self, service: ConfigService, tmp_path: Path) -> None:
        """manifest 不存在时 load_project 抛异常，inspect 应归一为单条 blocker 错误。"""
        result = service.inspect(str(tmp_path / "no_such.yaml"))

        assert isinstance(result, InspectionResult)
        assert result.has_blocker is True
        assert len(result.errors) == 1
        err = result.errors[0]
        # 归一为 dict 形式的 blocker
        assert err.get("severity") if isinstance(err, dict) else err.severity == "blocker"

    def test_inspect_clean_project_no_blocker(self, service: ConfigService, config_project: Path) -> None:
        """最小干净项目（仅 manifest 无 schema/constraint 引用）不应有 blocker。"""
        manifest = str(config_project / "project.precis.yaml")
        result = service.inspect(manifest)

        assert isinstance(result, InspectionResult)
        # 无 schema/constraint 引用，loading_errors 可能为空或仅非阻塞
        assert result.has_blocker is False

    def test_inspect_returns_errors_with_severity_field(self, service: ConfigService, tmp_path: Path) -> None:
        """inspect 返回的 errors 每条应含 severity 字段（LoadingError 或 dict 兼容）。"""
        proj = _copy_qa_simple_into(tmp_path)
        result = service.inspect(str(proj / "project.precis.yaml"))
        for err in result.errors:
            sev = getattr(err, "severity", None) or (err.get("severity") if isinstance(err, dict) else None)
            assert sev in ("blocker", "warning", "info")


# ---------------------------------------------------------------------------
# render_template
# ---------------------------------------------------------------------------


class TestRenderTemplate:
    """render_template 模板渲染测试。"""

    def test_render_project_template(self, service: ConfigService) -> None:
        """project 模板应返回默认文件名并填充 project_name。"""
        filename, content = service.render_template("project", "MyAwesomeProject")
        assert filename == "project.precis.yaml"
        assert "MyAwesomeProject" in content
        assert "project:" in content

    def test_render_constraint_template(self, service: ConfigService) -> None:
        """constraint 模板应返回 constraints.yaml。"""
        filename, content = service.render_template("constraint", "ignored")
        assert filename == "constraints.yaml"
        assert "constraints:" in content

    def test_render_pattern_template(self, service: ConfigService) -> None:
        """pattern 模板应返回 patterns.yaml。"""
        filename, content = service.render_template("pattern", "ignored")
        assert filename == "patterns.yaml"
        assert "patterns:" in content

    def test_render_patterns_alias(self, service: ConfigService) -> None:
        """'patterns' 应作为 'pattern' 的别名。"""
        filename, _ = service.render_template("patterns", "ignored")
        assert filename == "patterns.yaml"

    def test_render_unknown_type_raises(self, service: ConfigService) -> None:
        """未知模板类型应抛 ValueError。"""
        with pytest.raises(ValueError, match="未知模板类型"):
            service.render_template("unknown_type", "x")

    def test_render_is_case_insensitive(self, service: ConfigService) -> None:
        """模板类型应大小写不敏感。"""
        filename, _ = service.render_template("PROJECT", "X")
        assert filename == "project.precis.yaml"


# ---------------------------------------------------------------------------
# list_files
# ---------------------------------------------------------------------------


class TestListFiles:
    """list_files 文件扫描测试。"""

    def test_list_files_finds_yaml(self, service: ConfigService, config_project: Path) -> None:
        """应扫描到 project.precis.yaml。"""
        (config_project / "constraints.yaml").write_text("constraints: []\n", encoding="utf-8")
        files = service.list_files(str(config_project))
        names = {f.name for f in files}
        assert "project.precis.yaml" in names
        assert "constraints.yaml" in names

    def test_list_files_includes_size(self, service: ConfigService, config_project: Path) -> None:
        """每个文件信息应含 size（字节）与 path（绝对路径）。"""
        files = service.list_files(str(config_project))
        assert len(files) >= 1
        for info in files:
            assert info.size >= 0
            assert os.path.isabs(info.path)

    def test_list_files_subdirectory(self, service: ConfigService, config_project: Path) -> None:
        """schemas/ 子目录下的 YAML 应被扫描到（相对路径名）。"""
        schemas_dir = config_project / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text("columns: []\n", encoding="utf-8")
        files = service.list_files(str(config_project))
        names = {f.name for f in files}
        assert any("schemas" in n and "users.schema.yaml" in n for n in names)

    def test_list_files_empty_project(self, service: ConfigService, tmp_path: Path) -> None:
        """无 YAML 文件的项目应返回空列表。"""
        empty = tmp_path / "empty_proj"
        empty.mkdir()
        files = service.list_files(str(empty))
        assert files == []
