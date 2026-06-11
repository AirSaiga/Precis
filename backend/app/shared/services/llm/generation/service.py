"""
@fileoverview AI 配置生成服务

功能概述:
- 基于 AI 分析数据文件自动生成 Precis 项目配置
- 支持生成 Schema、Constraint、Regex Node 等多种配置
- 数据画像：采样数据特征并生成统计摘要
- 支持进度回调和取消操作

架构设计:
- 与 Provider 架构联动：通过 loader 读取配置并创建 Provider 实例
- 分阶段生成：数据画像 -> Prompt 构建 -> AI 调用 -> 结果解析 -> 配置保存
- 错误处理：GenerationParseError、CancelledError 等自定义异常

输入示例:
    service = ConfigGenerationService(provider_id="openai")
    result = await service.generate(
        file_paths=["data/users.xlsx", "data/orders.xlsx"],
        project_name="电商数据校验",
        project_id="ecommerce",
        generation_options=GenerationOptions(generate_schemas=True, generate_constraints=True),
        progress_callback=lambda stage, progress: print(f"{stage}: {progress}%")
    )

输出示例:
    {
        "schemas": [{"id": "users", "name": "users", "columns": [...]}],
        "constraints": [{"id": "unique_email", "type": "Unique", ...}],
        "regex_nodes": [],
        "profiling": {"tables": {...}}
    }
"""

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

from ..config import loader
from ..providers import ChatMessage, ChatRequest, create
from .config_builder import build_config
from .prompt_builder import build_prompt


@dataclass
class ProfilingOptions:
    """数据画像选项"""

    sample_rows: int = 100
    sample_values_per_column: int = 100
    max_files: int = 50
    max_cell_chars: int = 500


@dataclass
class GenerationOptions:
    """生成选项"""

    generate_schemas: bool = True
    generate_constraints: bool = True
    generate_regex_nodes: bool = True
    keep_existing: bool = True


class GenerationParseError(Exception):
    """LLM 响应解析失败"""

    def __init__(self, message: str, raw_content: str = ""):
        super().__init__(message)
        self.raw_content = raw_content


class CancelledError(Exception):
    """生成被取消"""

    pass


class ConfigGenerationService:
    """
    @classdesc AI 配置生成服务

    基于 AI 分析数据文件自动生成 Precis 项目配置。
    支持生成 Schema、Constraint、Regex Node 等多种配置。
    包含数据画像、Prompt 构建、AI 调用、结果解析和配置保存的完整流程。

    使用场景：
    - 新项目初始化时自动生成配置
    - 已有项目的增量配置更新
    """

    def __init__(self, provider_id: Optional[str] = None):
        """
        @methoddesc 初始化配置生成服务

        参数:
            provider_id: 指定 Provider ID，None 则使用默认
        """
        self.provider_id = provider_id
        self._provider = None
        self._cancelled = False

    def _get_provider(self):
        """
        @methoddesc 获取 Provider 实例

        懒加载：首次调用时从配置中查找并创建 Provider 实例。
        """
        if self._provider is None:
            config = loader.load()
            pid = self.provider_id or config.defaults.get("generate") or config.defaults.get("chat")
            if not pid:
                raise ValueError("No provider configured")

            provider_cfg = next((p for p in config.providers if p.id == pid), None)
            if not provider_cfg:
                raise ValueError(f"Provider not found: {pid}")

            self._provider = create(provider_cfg)
        return self._provider

    async def generate(
        self,
        file_paths: list[str],
        project_name: str,
        project_id: str,
        config_path: Optional[str] = None,
        profiling_options: ProfilingOptions = None,
        generation_options: GenerationOptions = None,
        progress_callback: Optional[Callable[[str, float], None]] = None,
    ) -> dict[str, Any]:
        """
        @methoddesc 生成配置

        完整流程：数据画像 -> 构建 Prompt -> 调用 LLM -> 解析响应 -> 构建最终配置。

        参数:
            file_paths: 数据文件路径列表
            project_name: 项目名称
            project_id: 项目标识
            config_path: 项目配置根目录（用于计算相对路径和 keep_existing 合并）
            profiling_options: 数据画像选项
            generation_options: 生成选项
            progress_callback: 进度回调 (stage, progress)

        返回:
            包含 manifest, schemas, constraints, regex_nodes 的字典
        """
        profiling_options = profiling_options or ProfilingOptions()
        generation_options = generation_options or GenerationOptions()

        # 阶段 1: 数据画像
        if progress_callback:
            progress_callback("profiling", 10)

        profiling_data = await self._profile_files(file_paths, profiling_options)

        if self._cancelled:
            raise CancelledError("Generation cancelled")

        # 阶段 2: 构建提示词（带长度预算和自动降级）
        if progress_callback:
            progress_callback("building_prompt", 20)

        prompt, prompt_warnings = build_prompt(profiling_data, project_name)

        # 阶段 3: 调用 LLM
        if progress_callback:
            progress_callback("generating", 40)

        provider = self._get_provider()

        chat_req = ChatRequest(
            messages=[
                ChatMessage(role="system", content="你是一个数据治理专家，擅长分析数据文件并生成数据验证配置。"),
                ChatMessage(role="user", content=prompt),
            ],
            temperature=0.3,  # 更确定的输出
        )

        response = await provider.chat(chat_req)

        if self._cancelled:
            raise CancelledError("Generation cancelled")

        # 阶段 4: 解析响应
        if progress_callback:
            progress_callback("parsing", 80)

        result = self._parse_response(response.content)

        # 阶段 5: 构建最终配置
        if progress_callback:
            progress_callback("finalizing", 95)

        existing_config = None
        if generation_options.keep_existing and config_path:
            existing_config = self._load_existing_config(config_path)

        config = build_config(
            project_id,
            project_name,
            config_path,
            profiling_data,
            result,
            generation_options,
            existing_config,
        )

        # 合并 prompt truncation 警告到结果
        config["warnings"] = config.get("warnings", []) + prompt_warnings

        if progress_callback:
            progress_callback("completed", 100)

        return config

    async def _profile_files(self, file_paths: list[str], options: ProfilingOptions) -> list[dict]:
        """
        @methoddesc 分析数据文件获取画像

        读取各类数据文件的前 N 行，提取列名、数据类型、空值数和样本值，
        供后续 AI 分析使用。

        支持格式:
        - Excel (.xlsx, .xls)
        - CSV (.csv)
        - JSON (.json, .jsonl)

        参数:
            file_paths: 数据文件路径列表
            options: 数据画像选项（采样行数、列样本数等）

        返回:
            每个文件的画像信息列表
        """
        import pandas as pd

        results = []

        # 限制最多处理的文件数量
        for path in file_paths[: options.max_files]:
            if not os.path.exists(path):
                continue

            ext = os.path.splitext(path)[1].lower()
            # 使用文件名（不含扩展名）作为默认表名
            table_name = os.path.splitext(os.path.basename(path))[0]

            try:
                # 根据文件类型读取数据
                sheet_name = None
                if ext in [".xlsx", ".xls"]:
                    # 读取第一个 sheet 的名称
                    xl = pd.ExcelFile(path)
                    sheet_name = xl.sheet_names[0] if xl.sheet_names else "Sheet1"
                    df = pd.read_excel(path, sheet_name=sheet_name, nrows=options.sample_rows)
                elif ext == ".csv":
                    df = pd.read_csv(path, nrows=options.sample_rows, encoding="utf-8")
                elif ext == ".json":
                    # JSON 文件处理
                    with open(path, encoding="utf-8") as f:
                        data = json.load(f)
                    # 处理嵌套结构
                    if isinstance(data, dict):
                        # 查找数据记录数组
                        records = self._find_json_records(data)
                        if records:
                            df = pd.json_normalize(records)
                        else:
                            df = pd.json_normalize([data])
                    elif isinstance(data, list):
                        df = pd.json_normalize(data)
                    else:
                        continue
                    # 限制行数
                    df = df.head(options.sample_rows)
                elif ext == ".jsonl":
                    # JSON Lines 文件处理
                    records = []
                    with open(path, encoding="utf-8") as f:
                        for i, line in enumerate(f):
                            if i >= options.sample_rows:
                                break
                            line = line.strip()
                            if line:
                                records.append(json.loads(line))
                    df = pd.json_normalize(records)
                else:
                    # 不支持的文件类型
                    continue

                # 分析列信息
                columns = []
                for col_name in df.columns:
                    col_data = df[col_name]

                    # 获取样本值（处理复杂类型如列表、字典）
                    sample_values = []
                    for v in col_data.dropna():
                        if len(sample_values) >= options.sample_values_per_column:
                            break
                        # 处理复杂类型
                        if isinstance(v, (list, dict)):
                            v_str = str(v)[: options.max_cell_chars]
                        else:
                            v_str = str(v)[: options.max_cell_chars]
                        if v_str not in sample_values:
                            sample_values.append(v_str)

                    columns.append(
                        {
                            "name": str(col_name),
                            "dtype": str(col_data.dtype),
                            "null_count": int(col_data.isna().sum()),
                            "sample_values": sample_values,
                        }
                    )

                result = {
                    "path": path,
                    "table_name": table_name,
                    "sheet_name": sheet_name,
                    "columns": columns,
                }
                results.append(result)

            except Exception as e:
                # 读取失败，记录警告并跳过，不影响其他文件的处理
                logger.warning(f"无法分析文件 {path}: {e}")
                continue

        return results

    def _find_json_records(self, data: dict) -> Optional[list[dict]]:
        """
        @methoddesc 在嵌套 JSON 对象中查找数据记录数组

        策略：递归遍历 JSON 的所有节点，找到最长的、元素为字典的数组，
        这通常就是实际的数据记录列表。

        参数:
            data: 解析后的 JSON 字典

        返回:
            找到的数据记录列表，如果没有则返回 None
        """
        best_array = None
        best_length = 0

        def search(obj):
            nonlocal best_array, best_length

            if isinstance(obj, dict):
                for key, value in obj.items():
                    if isinstance(value, list):
                        # 检查是否是数据记录数组（元素是字典）
                        if value and isinstance(value[0], dict):
                            if len(value) > best_length:
                                best_length = len(value)
                                best_array = value
                        # 继续搜索数组内部（处理嵌套列表）
                        for item in value:
                            if isinstance(item, (dict, list)):
                                search(item)
                    elif isinstance(value, (dict, list)):
                        search(value)
            elif isinstance(obj, list):
                for item in obj:
                    if isinstance(item, (dict, list)):
                        search(item)

        search(data)
        return best_array

    def _parse_response(self, content: str) -> dict:
        """
        @methoddesc 解析 LLM 返回的文本，提取其中的 JSON 配置

        处理步骤：
        1. 尝试提取 Markdown 代码块（```json ... ```）中的内容
        2. 通过大括号平衡计数找到最外层的 JSON 对象
        3. 使用 json.loads 解析

        参数:
            content: LLM 返回的原始文本

        返回:
            解析后的 JSON 字典

        异常:
            GenerationParseError: 当无法从响应中提取有效 JSON 时
        """
        original = content

        # 尝试找到 Markdown JSON 代码块
        match = re.search(r"```(?:json)?\s*(.*?)\s*```", content, re.DOTALL)
        if match:
            content = match.group(1).strip()

        # 通过大括号平衡计数找到最外层的 JSON 对象
        start = content.find("{")
        if start != -1:
            balance = 0
            for i, char in enumerate(content[start:], start=start):
                if char == "{":
                    balance += 1
                elif char == "}":
                    balance -= 1
                    if balance == 0:
                        content = content[start : i + 1]
                        break

        try:
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                raise GenerationParseError(
                    f"LLM 响应解析结果不是 JSON 对象，实际类型: {type(parsed).__name__}",
                    raw_content=original[:2000],
                )
            return parsed
        except json.JSONDecodeError as e:
            raise GenerationParseError(
                f"无法解析 LLM 响应为有效 JSON: {e}",
                raw_content=original[:2000],
            )

    def _load_existing_config(self, config_path: str) -> Optional[dict[str, Any]]:
        """
        @methoddesc 加载现有配置（用于 keep_existing 合并）

        读取项目清单文件以及引用的 schema、constraint、regex 文件。

        参数:
            config_path: 项目配置根目录

        返回:
            包含 manifest、schemas、constraints、regex_nodes 的字典，
            如果项目不存在则返回 None
        """
        from pathlib import Path

        from app.shared.core.io.yaml import read_yaml

        manifest_path = os.path.join(config_path, "project.precis.yaml")
        if not os.path.isfile(manifest_path):
            return None

        try:
            manifest_data = read_yaml(Path(manifest_path))
            if not isinstance(manifest_data, dict):
                return None

            existing = {
                "manifest": manifest_data,
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
            }

            # 读取现有 schema 文件
            for ref in manifest_data.get("schemas", []):
                schema_path = os.path.join(config_path, ref.get("path", ""))
                if os.path.isfile(schema_path):
                    try:
                        raw = read_yaml(Path(schema_path))
                        if isinstance(raw, dict):
                            existing["schemas"][ref["id"]] = raw
                    except Exception as e:
                        logger.warning(f"读取现有 schema 文件失败 {schema_path}: {e}")

            # 读取现有 constraint 文件
            for ref in manifest_data.get("constraints", []):
                constraint_path = os.path.join(config_path, ref.get("path", ""))
                if os.path.isfile(constraint_path):
                    try:
                        raw = read_yaml(Path(constraint_path))
                        if isinstance(raw, dict):
                            existing["constraints"][ref["id"]] = raw
                    except Exception as e:
                        logger.warning(f"读取现有 constraint 文件失败 {constraint_path}: {e}")

            # 读取现有 regex 文件
            for ref in manifest_data.get("regex_nodes", []):
                regex_path = os.path.join(config_path, ref.get("path", ""))
                if os.path.isfile(regex_path):
                    try:
                        raw = read_yaml(Path(regex_path))
                        if isinstance(raw, dict):
                            existing["regex_nodes"][ref["id"]] = raw
                    except Exception as e:
                        logger.warning(f"读取现有 regex 文件失败 {regex_path}: {e}")

            return existing
        except Exception as e:
            logger.warning(f"加载现有配置失败: {e}")
            return None

    def cancel(self):
        """
        @methoddesc 标记生成任务为已取消状态

        异步任务会在合适的检查点检测到取消标记并抛出 CancelledError。
        """
        self._cancelled = True
