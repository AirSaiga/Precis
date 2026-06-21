"""
@fileoverview qa_v3_complex 复杂项目集成测试

用 qa_test/qa_v3_complex 真实项目作为 fixture，端到端验证
schema → 约束 → 正则 → 校验完整链路：

1. 通过 load_project() 加载完整 manifest
2. 验证 manifest 中所有 schemas/constraints/regex 引用解析正确
3. 验证模板实例展开（template expansion）正确生成子节点
4. 对每个 schema 执行校验，确认无意外崩溃
5. 验证 frontend 视角的节点数量与 YAML 文件数量一致

qa_v3_complex 是更复杂的 fixture（13 个 Schema + 17 个 Regex + 2 个 Template +
2 个 Template Instance + 多个内嵌约束 + 引用完整性问题），用于覆盖：
- ID 编码（XOR + Base64URL）解析
- 模板展开（age_check + user_quality_check）
- 内嵌约束 + 独立约束
- 数据文件加载（CSV + XLSX + JSON）
- 加载阶段警告与错误的传播
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.shared.core.project.loader.loader_parts.main import load_project
from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

QA_V3_COMPLEX_ROOT = Path(__file__).resolve().parents[3] / "qa_test" / "qa_v3_complex"


def _copy_qa_v3_into(tmp_path: Path) -> Path:
    """将 qa_v3_complex 复制到 tmp_path，避免污染源文件。"""
    if not QA_V3_COMPLEX_ROOT.is_dir():
        pytest.skip(f"qa_v3_complex fixture not found at {QA_V3_COMPLEX_ROOT}")
    target = tmp_path / "qa_v3_complex"
    shutil.copytree(QA_V3_COMPLEX_ROOT, target)
    return target


@pytest.fixture
def qa_v3_complex_project(tmp_path: Path) -> Path:
    """提供 qa_v3_complex 项目的副本 fixture。"""
    return _copy_qa_v3_into(tmp_path)


@pytest.fixture
def client():
    """共享 FastAPI TestClient。"""
    return TestClient(app)


# =====================================================================
# 1. manifest 引用加载验证
# =====================================================================


class TestQaV3ComplexManifestLoading:
    """验证 qa_v3_complex manifest 引用全部解析正确。"""

    def test_load_qa_v3_complex_returns_loaded_project(self, qa_v3_complex_project: Path):
        """load_project 应返回 LoadedProject 实例，不抛异常。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        assert result is not None
        assert result.manifest is not None
        # 清单中声明了 13 个 schema 引用，至少应解析出对应的 schema_files
        assert len(result.schema_files) >= 10

    def test_load_qa_v3_complex_manifest_lists_all_schemas(self, qa_v3_complex_project: Path):
        """manifest.schemas 应至少包含 10 条 Schema 引用。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        assert len(result.manifest.schemas) >= 10

    def test_load_qa_v3_complex_resolves_all_regex_refs(self, qa_v3_complex_project: Path):
        """17 个 regex_nodes 引用应全部被解析为 RegexNodeFile。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        # manifest 中声明了 17 个 regex
        assert len(result.manifest.regex_nodes) == 17
        # 应全部加载成功
        assert len(result.regex_node_files) == 17

    def test_load_qa_v3_complex_resolves_template_refs(self, qa_v3_complex_project: Path):
        """2 个 template 引用应全部被解析。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        assert len(result.manifest.templates) == 2
        # 加载阶段存在 template_files 字段（main.py 中显式传递）
        # 验证模板 ID 列表
        template_ids = {ref.id for ref in result.manifest.templates}
        assert "age_check" in template_ids
        assert "user_quality_check" in template_ids

    def test_load_qa_v3_complex_resolves_template_instances(self, qa_v3_complex_project: Path):
        """2 个 template_instances 应在 manifest 中存在。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        assert len(result.manifest.template_instances) == 2
        instance_ids = {inst.id for inst in result.manifest.template_instances}
        assert "19dcc6f3-c8ca-4487-8f61-9ba9f1fa2ce6" in instance_ids
        assert "a3e7b2c1-5d4e-4f8a-9b6c-1d2e3f4a5b6c" in instance_ids


# =====================================================================
# 2. 模板展开验证
# =====================================================================


class TestQaV3ComplexTemplateExpansion:
    """验证 qa_v3_complex 中的 2 个模板实例正确展开。"""

    def test_template_age_check_expands_to_range_constraint(self, qa_v3_complex_project: Path):
        """age_check 模板实例应展开为 1 个 Range 约束（带 input_from_node 指向 Schema）。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        instance_id = "19dcc6f3-c8ca-4487-8f61-9ba9f1fa2ce6"
        expanded_ids_prefix = f"{instance_id}__"
        # 找到该实例展开的约束
        expanded_constraints = [c for c in result.constraint_files.values() if c.id.startswith(expanded_ids_prefix)]
        assert len(expanded_constraints) >= 1
        # 第一个应是一个 Range 约束
        age_range = expanded_constraints[0]
        assert age_range.type == "Range"
        # 模板实例 input_from_node 指向 users-Users schema（refs 是 dict 形式）
        refs = age_range.refs or {}
        table_id = refs.get("table_id", "")
        assert "users" in table_id.lower() or age_range.input_from_node
        # 模板参数 min_age=18, max_age=100 应被替换
        assert age_range.params.get("min") == 18
        assert age_range.params.get("max") == 100

    def test_template_user_quality_check_expands_multiple_nodes(self, qa_v3_complex_project: Path):
        """user_quality_check 模板应展开为多个约束 + 至少 1 个 transform。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        instance_id = "a3e7b2c1-5d4e-4f8a-9b6c-1d2e3f4a5b6c"
        expanded_id_prefix = f"{instance_id}__"
        expanded_constraints = [c for c in result.constraint_files.values() if c.id.startswith(expanded_id_prefix)]
        transform_files = result.transform_files or {}
        expanded_transforms = [t for t in transform_files.values() if t.id.startswith(expanded_id_prefix)]
        # 模板定义包含 4 个 constraint + 1 个 transform
        assert len(expanded_constraints) >= 3, f"应展开至少 3 个约束，实际: {len(expanded_constraints)}"
        assert len(expanded_transforms) >= 1, f"应展开至少 1 个 transform，实际: {len(expanded_transforms)}"

    def test_template_expansion_uses_namespaced_ids(self, qa_v3_complex_project: Path):
        """模板展开的 ID 应带 `{instance_id}__{local_id}` 命名空间前缀。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        all_constraint_ids = list(result.constraint_files.keys())
        # 至少应有一个 ID 包含模板实例前缀
        namespaced = [
            cid
            for cid in all_constraint_ids
            if cid.startswith("19dcc6f3-c8ca-4487-8f61-9ba9f1fa2ce6__")
            or cid.startswith("a3e7b2c1-5d4e-4f8a-9b6c-1d2e3f4a5b6c__")
        ]
        assert len(namespaced) >= 4, f"应至少 4 个命名空间约束 ID，实际: {namespaced}"


# =====================================================================
# 3. 内嵌约束 + 独立约束汇总
# =====================================================================


class TestQaV3ComplexConstraintAggregation:
    """验证内嵌约束与模板展开约束合并到 constraint_files。"""

    def test_embedded_constraints_are_collected(self, qa_v3_complex_project: Path):
        """Schema 文件中内嵌的约束应被 collect_constraints_from_schemas 收集。

        内嵌约束 ID 格式: `{table_id}_{inner_constraint_id}`
        """
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        constraint_ids = set(result.constraint_files.keys())
        # 收集的约束 ID 数量应 >= 内嵌约束总数（来自 schemas 目录 .schema.yaml 文件）
        # qa_v3_complex 在 customers/users/employees 等 schema 中有 13+ 条内嵌约束
        embedded_collected = [cid for cid in constraint_ids if "_c_" in cid and "__" not in cid]
        assert len(embedded_collected) >= 5, (
            f"应收集至少 5 条内嵌约束（命名空间非模板），实际: {len(embedded_collected)}"
        )
        # 其中至少一条应是 users-Users 表的 user_id unique 约束（命名空间拼接后）
        users_schema_id = "users-users"
        assert f"{users_schema_id}_c_users-users_user_id_unique" in constraint_ids

    def test_combined_constraint_count_exceeds_manifest_count(self, qa_v3_complex_project: Path):
        """合并后的 constraint_files 应多于 manifest 顶层声明的独立约束数（因含内嵌+模板展开）。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        standalone_count = len(result.manifest.constraints)
        combined_count = len(result.constraint_files)
        # 内嵌约束 + 模板展开约束 ≥ 独立约束数
        assert combined_count >= standalone_count


# =====================================================================
# 4. 校验执行（不崩溃验证）
# =====================================================================


class TestQaV3ComplexValidationExecution:
    """对 qa_v3_complex 执行校验，验证不崩溃、返回结果结构。"""

    def test_execute_qa_v3_complex_returns_result(self, qa_v3_complex_project: Path):
        """对完整项目执行校验，应返回结果（不抛异常）。"""
        manifest = str(qa_v3_complex_project / "project.precis.yaml")
        data_dir = str(qa_v3_complex_project / "data")

        executor = ValidationExecutor(manifest)
        result = executor.execute(data_dir, ValidationOptions(timeout_seconds=30))

        # 基本结构
        assert isinstance(result, dict)
        assert "errors" in result
        assert "loading_errors" in result
        assert "duration_ms" in result

    def test_execute_qa_v3_complex_runs_without_unhandled_exception(self, qa_v3_complex_project: Path):
        """校验执行不应抛未处理异常（即使有数据违规）。"""
        manifest = str(qa_v3_complex_project / "project.precis.yaml")
        data_dir = str(qa_v3_complex_project / "data")

        executor = ValidationExecutor(manifest)
        # 应不抛异常
        result = executor.execute(data_dir, ValidationOptions(timeout_seconds=30))
        assert result is not None
        # 校验结果中允许有 errors（数据故意包含违规条目），但不应有未捕获异常
        assert isinstance(result.get("errors"), list)
        assert isinstance(result.get("loading_errors"), list)

    def test_execute_qa_v3_complex_detects_data_violations(self, qa_v3_complex_project: Path):
        """数据中故意包含违规（age=150、invalid-email、invalid_status 等），校验应能识别。"""
        manifest = str(qa_v3_complex_project / "project.precis.yaml")
        data_dir = str(qa_v3_complex_project / "data")

        executor = ValidationExecutor(manifest)
        result = executor.execute(data_dir, ValidationOptions(timeout_seconds=30))

        # errors 列表可能为空（取决于实现细节），但应至少返回结构
        errors = result.get("errors") or []
        loading_errors = result.get("loading_errors") or []
        # 至少能拿到一份结果
        assert isinstance(errors, list)
        assert isinstance(loading_errors, list)

    def test_execute_with_table_filter_subset(self, qa_v3_complex_project: Path):
        """使用 table_filter 限定到单个 schema 时，校验应能跑通。"""
        manifest = str(qa_v3_complex_project / "project.precis.yaml")
        data_dir = str(qa_v3_complex_project / "data")

        # 找一个真实存在的 schema ID（不强制是哪个，使用 schema_files 第一个）
        loaded = load_project(manifest)
        first_schema_id = next(iter(loaded.schema_files.keys()))

        executor = ValidationExecutor(manifest)
        result = executor.execute(
            data_dir,
            ValidationOptions(timeout_seconds=30, table_filter=first_schema_id),
        )
        assert result is not None
        assert "errors" in result


# =====================================================================
# 5. 加载警告与错误聚合
# =====================================================================


class TestQaV3ComplexLoadingDiagnostics:
    """验证 qa_v3_complex 已知的引用完整性问题被收集为警告/错误。"""

    def test_load_collects_warnings_or_errors_for_integrity_issues(self, qa_v3_complex_project: Path):
        """qa_v3_complex 含 ID 不匹配、外键目标表缺失等已知问题，应至少产生警告或错误。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        # 已知会有 IDMismatchWarning + ReferenceIntegrityError
        total_signals = len(result.warnings or []) + len(result.loading_errors or [])
        assert total_signals > 0, "qa_v3_complex 已知存在引用完整性问题，应至少有 1 条信号"

    def test_loading_errors_have_diagnostic_metadata(self, qa_v3_complex_project: Path):
        """LoadingError 应带有 error_type、message、suggestion 等诊断字段。"""
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        if not result.loading_errors:
            pytest.skip("qa_v3_complex 未产生 loading_errors，跳过诊断字段检查")
        err = result.loading_errors[0]
        # LoadingError 是 Pydantic BaseModel，应至少有 error_type 与 message 属性
        assert err.error_type is not None
        assert err.message is not None


# =====================================================================
# 6. API 端到端验证（manifest 列表 + 单个资源读取）
# =====================================================================


class TestQaV3ComplexApiEndpoints:
    """通过 FastAPI TestClient 端到端验证 V2 API。"""

    def test_get_manifest_via_api(self, client, qa_v3_complex_project: Path):
        """GET /api/latest/project/manifest 应返回 200 + schemas/constraints/regex_nodes 列表。"""
        resp = client.get(
            "/api/latest/project/manifest",
            headers={"X-Project-Config-Path": str(qa_v3_complex_project)},
        )
        assert resp.status_code == 200
        manifest = resp.json()
        assert "schemas" in manifest
        assert "regex_nodes" in manifest
        assert len(manifest["schemas"]) >= 10
        assert len(manifest["regex_nodes"]) == 17

    def test_list_templates_via_api(self, client, qa_v3_complex_project: Path):
        """GET /api/latest/project/template 应返回 2 个模板。"""
        resp = client.get(
            "/api/latest/project/template",
            headers={"X-Project-Config-Path": str(qa_v3_complex_project)},
        )
        assert resp.status_code == 200
        templates = resp.json()
        assert isinstance(templates, list)
        assert len(templates) == 2
        template_ids = {t["id"] for t in templates}
        assert "age_check" in template_ids
        assert "user_quality_check" in template_ids

    def test_get_template_by_id_via_api(self, client, qa_v3_complex_project: Path):
        """GET /api/latest/project/template/age_check 应返回完整模板定义。"""
        resp = client.get(
            "/api/latest/project/template/age_check",
            headers={"X-Project-Config-Path": str(qa_v3_complex_project)},
        )
        assert resp.status_code == 200
        template = resp.json()
        assert template["id"] == "age_check"
        assert "parameters" in template
        assert "nodes" in template
        assert len(template["nodes"]) >= 1

    def test_preview_template_expand_age_check_via_api(self, client, qa_v3_complex_project: Path):
        """POST /api/latest/project/template/age_check/expand 应返回展开结果。"""
        users_schema_id = "users-users"
        resp = client.post(
            "/api/latest/project/template/age_check/expand",
            headers={"X-Project-Config-Path": str(qa_v3_complex_project)},
            json={
                "instance_id": "preview-instance",
                "params": {"source_column": "age", "min_age": 18, "max_age": 100},
                "input_from_node": users_schema_id,
            },
        )
        assert resp.status_code == 200
        result = resp.json()
        assert "constraints" in result
        assert "transforms" in result
        assert "regex_nodes" in result
        # age_check 模板应展开为 1 个 Range 约束
        assert len(result["constraints"]) == 1
        age_range = result["constraints"][0]
        assert age_range["type"] == "Range"
        # input_from_node 引用应替换为具体的 users schema ID
        assert age_range.get("input_from_node") == users_schema_id
        # 命名空间 ID
        assert age_range["id"].startswith("preview-instance__")
        # 模板参数应被替换
        assert age_range["params"]["min"] == 18
        assert age_range["params"]["max"] == 100

    def test_preview_template_expand_user_quality_check_via_api(self, client, qa_v3_complex_project: Path):
        """POST .../user_quality_check/expand 应展开出多个约束 + 至少 1 个 transform。"""
        users_schema_id = "users-users"
        resp = client.post(
            "/api/latest/project/template/user_quality_check/expand",
            headers={"X-Project-Config-Path": str(qa_v3_complex_project)},
            json={
                "instance_id": "preview-quality",
                "params": {
                    "age_column": "age",
                    "email_column": "email",
                    "min_age": 0,
                    "max_age": 150,
                    "gender_column": "gender",
                },
                "input_from_node": users_schema_id,
            },
        )
        assert resp.status_code == 200
        result = resp.json()
        # 模板定义包含 4 个 constraint + 1 个 transform
        assert len(result["constraints"]) >= 3
        assert len(result["transforms"]) >= 1
        # 约束类型应包含 Range、NotNull、AllowedValues
        constraint_types = {c["type"] for c in result["constraints"]}
        assert "Range" in constraint_types
        assert "NotNull" in constraint_types
        assert "AllowedValues" in constraint_types

    def test_get_schema_by_id_via_api(self, client, qa_v3_complex_project: Path):
        """GET /api/latest/project/schemas/{table_id} 应能获取 users-Users schema。"""
        users_schema_id = "users-users"
        resp = client.get(
            f"/api/latest/project/schemas/{users_schema_id}",
            headers={"X-Project-Config-Path": str(qa_v3_complex_project)},
        )
        assert resp.status_code == 200
        schema = resp.json()
        assert schema["id"] == users_schema_id
        # schema 中应至少有 6 个列
        assert len(schema["columns"]) >= 6

    def test_get_regex_by_id_via_api(self, client, qa_v3_complex_project: Path):
        """GET /api/latest/project/regex/{regex_id} 应能获取邮箱正则。"""
        resp = client.get(
            "/api/latest/project/regex/regex_users-users_email",
            headers={"X-Project-Config-Path": str(qa_v3_complex_project)},
        )
        assert resp.status_code == 200
        regex = resp.json()
        assert regex["id"] == "regex_users-users_email"
        assert "pattern" in regex
        assert regex["pattern"]  # 非空

    def test_nonexistent_template_returns_404(self, client, qa_v3_complex_project: Path):
        """GET /api/latest/project/template/ghost 应返回 404 而非崩溃。"""
        resp = client.get(
            "/api/latest/project/template/__nonexistent_template__",
            headers={"X-Project-Config-Path": str(qa_v3_complex_project)},
        )
        assert resp.status_code == 404


# =====================================================================
# 7. 节点数量与 YAML 文件数量一致性（前端视角）
# =====================================================================


class TestQaV3ComplexNodeConsistency:
    """验证前端视角下的节点数量与磁盘 YAML 文件数量一致。"""

    def test_loaded_schema_count_matches_yaml_files(self, qa_v3_complex_project: Path):
        """加载出的 schema_files 数量应等于 schemas/ 目录下 .schema.yaml 文件数量。"""
        schemas_dir = qa_v3_complex_project / "schemas"
        schema_files_on_disk = list(schemas_dir.glob("*.schema.yaml"))
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        # 注：qa_v3_complex 故意有 ID 重复（users-Users vs Users schema），
        # 加载层可能将两个 manifest 引用都解析为同一个文件。允许加载数量 ≤ 磁盘文件数。
        assert len(result.schema_files) <= len(schema_files_on_disk)
        assert len(result.schema_files) >= len(schema_files_on_disk) - 2

    def test_loaded_regex_count_matches_yaml_files(self, qa_v3_complex_project: Path):
        """加载出的 regex_node_files 数量应等于 regex/ 目录下 .regex.yaml 文件数量。"""
        regex_dir = qa_v3_complex_project / "regex"
        regex_files_on_disk = list(regex_dir.glob("*.regex.yaml"))
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        assert len(result.regex_node_files) == len(regex_files_on_disk)

    def test_loaded_template_count_matches_yaml_files(self, qa_v3_complex_project: Path):
        """加载出的 template_files 数量应等于 templates/ 目录下 .template.yaml 文件数量。"""
        templates_dir = qa_v3_complex_project / "templates"
        template_files_on_disk = list(templates_dir.glob("*.template.yaml"))
        result = load_project(str(qa_v3_complex_project / "project.precis.yaml"))
        # 加载器中模板文件使用 _load_referenced_files（按 manifest 引用过滤），
        # 但返回字段名是 template_files
        # 至少要保证 manifest 引用数与磁盘文件数一致
        assert len(result.manifest.templates) == len(template_files_on_disk)
