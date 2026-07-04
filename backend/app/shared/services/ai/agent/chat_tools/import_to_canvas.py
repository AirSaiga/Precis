"""@fileoverview import_to_canvas 工具

Chat mini-agent 可调用的工具：把项目配置中已存在的资源导入到画布。

与 apply_actions 不同，本工具**不修改项目文件**，只读取已有配置并生成前端渲染指令，
让对应节点出现在右侧画布上。专门解决"把 users 表拖到画布""显示 email 的约束"这类请求。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from app.shared.services.llm.constraints.frontend_instructions import (
    _generate_constraint_instruction,
    _generate_regex_instruction,
    _generate_schema_instruction,
)
from app.shared.services.llm.schema_resolver import _resolve_id_from_name

logger = logging.getLogger(__name__)


class ImportToCanvasTool:
    """@classdesc 导入已有资源到画布

    只读工具：扫描项目 schemas/、constraints/、regex_nodes/ 目录，
    把匹配的资源转换为前端可执行的 ADD_* 指令。
    """

    NAME = "import_to_canvas"

    def __init__(self, project_path: str):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径（也兼容传入 project.precis.yaml 文件路径）
        """
        self.project_path = self._resolve_project_root(project_path)

    @staticmethod
    def _resolve_project_root(project_path: str) -> str:
        """统一把项目路径解析为配置目录。

        兼容两种传入方式：
        - 项目配置目录（如 /path/to/project）
        - project.precis.yaml 文件路径（如 /path/to/project/project.precis.yaml）
        """
        if not project_path:
            return project_path
        p = Path(project_path)
        if p.is_file():
            return str(p.parent)
        return project_path

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "把项目配置中已存在的资源自动显示到画布上，替代用户的手动拖拽操作。"
                    "当用户说'把 X 拖到画布'、'拖入 X'、'在画布上显示 X'、'显示 X'、'放出来'、'拖到画布'时使用此工具。"
                    "支持 Schema（表）、独立约束、Regex 三种资源。"
                    "本工具只读取配置并生成前端渲染指令，不会修改项目文件；执行后对应节点会出现在右侧画布上。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "resource_type": {
                            "type": "string",
                            "description": "资源类型：schema（表）、constraint（独立约束）、regex（正则节点）",
                            "enum": ["schema", "constraint", "regex"],
                        },
                        "identifier": {
                            "type": "string",
                            "description": (
                                "资源标识符。schema 可用 schemaId 或表名；"
                                "constraint 可用 constraintId 或 '表名.列名'；"
                                "regex 可用 regexId 或正则名称。"
                            ),
                        },
                    },
                    "required": ["resource_type", "identifier"],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行导入

        参数:
            arguments: tool 参数，包含 resource_type 和 identifier

        返回:
            {"success": bool, "instructions": [...], "error": str}
            instructions 为前端渲染指令列表（可直接喂给 processFrontendInstructions）
        """
        resource_type = arguments.get("resource_type", "")
        identifier = arguments.get("identifier", "")

        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "instructions": []}

        if resource_type == "schema":
            return self._import_schema(identifier)
        if resource_type == "constraint":
            return self._import_constraint(identifier)
        if resource_type == "regex":
            return self._import_regex(identifier)

        return {"success": False, "error": f"不支持的资源类型: {resource_type}", "instructions": []}

    def _load_schemas(self) -> list[dict[str, Any]]:
        """加载项目下所有 schema 的简要信息（id, name, columns）。"""
        schemas: list[dict[str, Any]] = []
        if not self.project_path:
            return schemas
        schemas_dir = Path(self.project_path) / "schemas"
        if not schemas_dir.exists():
            return schemas
        for sf in schemas_dir.glob("*.yaml"):
            try:
                with open(sf, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                schemas.append(
                    {
                        "id": data.get("id", ""),
                        "name": data.get("name", ""),
                        "columns": data.get("columns", []),
                    }
                )
            except Exception:
                continue
        return schemas

    def _import_schema(self, identifier: str) -> dict[str, Any]:
        """读取 schemas/ 目录，生成 ADD_SCHEMA 指令。

        注意：与手动从资源树拖拽 Schema 的默认行为保持一致，只导入 Schema 节点及其内嵌约束，
        不自动连带导入引用该 Schema 的独立约束（那些需要用户明确请求，如"拖入 users 的约束"）。
        """
        schemas_dir = Path(self.project_path) / "schemas"
        if not schemas_dir.exists():
            return {"success": False, "error": "项目没有 Schema 目录", "instructions": []}

        for sf in schemas_dir.glob("*.yaml"):
            try:
                with open(sf, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                if data.get("id") == identifier or data.get("name") == identifier:
                    instruction = _generate_schema_instruction(
                        {
                            "actionType": "ADD_SCHEMA",
                            "schemaSpec": {
                                "schemaId": data.get("id", ""),
                                "name": data.get("name", ""),
                                "columns": data.get("columns", []),
                                "source": data.get("source"),
                            },
                        },
                        self.project_path,
                    )
                    return {"success": True, "instructions": [instruction], "error": None}
            except Exception as e:
                logger.debug(f"读取 schema 文件失败 {sf}: {e}")
                continue

        return {"success": False, "error": f"未找到 Schema: {identifier}", "instructions": []}

    def _import_constraint(self, identifier: str) -> dict[str, Any]:
        """读取 constraints/ 目录，生成 ADD_CONSTRAINT_NODE 指令。"""
        constraints_dir = Path(self.project_path) / "constraints"
        if not constraints_dir.exists():
            return {"success": False, "error": "项目没有约束目录", "instructions": []}

        # identifier 可能是 constraintId，或 "表名.列名"
        table_name = ""
        column_name = ""
        if "." in identifier:
            parts = identifier.split(".", 1)
            table_name = parts[0]
            column_name = parts[1]

        for cf in constraints_dir.glob("*.constraint.yaml"):
            try:
                with open(cf, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}

                if data.get("id") == identifier:
                    return self._build_constraint_instruction(data)

                # 按表名.列名匹配
                if table_name and column_name:
                    refs = data.get("refs") or {}
                    table_id, column_id = _resolve_id_from_name(self.project_path, table_name, column_name)
                    if refs.get("table_id") == table_id and refs.get("column_id") == column_id:
                        return self._build_constraint_instruction(data)
            except Exception as e:
                logger.debug(f"读取约束文件失败 {cf}: {e}")
                continue

        return {"success": False, "error": f"未找到约束: {identifier}", "instructions": []}

    def _build_constraint_instruction(self, data: dict[str, Any]) -> dict[str, Any]:
        """根据约束文件数据生成 ADD_CONSTRAINT_NODE 指令。"""
        refs = data.get("refs") or {}
        table_id = refs.get("table_id", "")
        column_id = refs.get("column_id", "")
        table_name = ""
        column_name = ""

        # 反向查找表名/列名（用于前端兜底匹配）
        schemas_dir = Path(self.project_path) / "schemas"
        if schemas_dir.exists() and table_id:
            for sf in schemas_dir.glob("*.yaml"):
                try:
                    with open(sf, encoding="utf-8") as f:
                        sdata = yaml.safe_load(f) or {}
                    if sdata.get("id") == table_id:
                        table_name = sdata.get("name", "")
                        for col in sdata.get("columns", []):
                            if col.get("id") == column_id:
                                column_name = col.get("name", "")
                                break
                        break
                except Exception:
                    continue

        instruction = _generate_constraint_instruction(
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": data.get("type", ""),
                    "targetNodeId": table_id,
                    "targetColumnId": column_id,
                    "tableName": table_name,
                    "targetColumn": column_name,
                    "constraintId": data.get("id", ""),
                    "isInline": False,
                    "params": data.get("params", {}),
                },
            },
            self.project_path,
        )
        return {"success": True, "instructions": [instruction], "error": None}

    def _import_regex(self, identifier: str) -> dict[str, Any]:
        """读取 regex_nodes/ 或 regex/ 目录，生成 ADD_REGEX 指令。"""
        for dirname in ("regex_nodes", "regex"):
            regex_dir = Path(self.project_path) / dirname
            if not regex_dir.exists():
                continue
            for rf in regex_dir.glob("*.yaml"):
                try:
                    with open(rf, encoding="utf-8") as f:
                        data = yaml.safe_load(f) or {}
                    if data.get("id") == identifier or data.get("name") == identifier:
                        instruction = _generate_regex_instruction(
                            {
                                "actionType": "ADD_REGEX",
                                "regexSpec": {
                                    "regexId": data.get("id", ""),
                                    "name": data.get("name", ""),
                                    "pattern": data.get("pattern", ""),
                                    "matchMode": data.get("match_mode", "full"),
                                    "caseSensitive": data.get("case_sensitive", False),
                                    "description": data.get("description"),
                                },
                            },
                            self.project_path,
                        )
                        return {"success": True, "instructions": [instruction], "error": None}
                except Exception as e:
                    logger.debug(f"读取 regex 文件失败 {rf}: {e}")
                    continue

        return {"success": False, "error": f"未找到 Regex: {identifier}", "instructions": []}
