# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# backend/app/cli/shell/commands/infer_schema.py
"""
@fileoverview CLI infer-schema 子命令模块

功能概述:
- 读取 CSV/Excel/JSON 数据文件头部，推断列类型并输出合法 schema YAML
- 默认输出到 stdout（管道友好），--output 写入指定文件
- 推断逻辑在 services 层（app.shared.services.schema_inference），本模块只做参数解析

使用示例:
    precis infer-schema data/orders.csv
    precis infer-schema data/orders.csv --output schemas/orders.schema.yaml
    precis infer-schema data/orders.csv --id <uuid> --name orders --source-path ../orders.csv
"""

from __future__ import annotations

from pathlib import Path

import yaml

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext

# 选项表：选项名 → 结果键
_INFER_OPTIONS: dict[str, str] = {
    "--output": "output",
    "-o": "output",
    "--id": "table_id",
    "--name": "table_name",
    "--source-path": "source_path",
    "--sample-rows": "sample_rows",
}


def _parse_infer_args(args: list[str]) -> dict:
    """解析 infer-schema 参数：选项及值剥离，剩余首个位置参数为数据文件路径。

    Args:
        args: 命令参数列表

    Returns:
        包含 data_file/output/table_id/table_name/source_path/sample_rows 的字典
    """
    result: dict[str, str | None] = {
        "data_file": None,
        "output": None,
        "table_id": None,
        "table_name": None,
        "source_path": None,
        "sample_rows": None,
    }
    positional: list[str] = []
    i = 0
    while i < len(args):
        arg = args[i]
        key = _INFER_OPTIONS.get(arg)
        if key and i + 1 < len(args):
            result[key] = args[i + 1]
            i += 2
        elif key:
            i += 1
        else:
            positional.append(arg)
            i += 1
    if positional:
        result["data_file"] = positional[0]
    return result


class InferSchemaCommand(Command):
    """schema 推断命令：从数据文件头部推断列类型，输出 schema YAML。"""

    def __init__(self) -> None:
        super().__init__("infer-schema", aliases=["infer"])

    @property
    def description(self) -> str:
        return "从数据文件推断 schema（列类型），输出 YAML 草稿"

    @property
    def usage(self) -> str:
        return (
            "infer-schema <数据文件> [--output <path>] [--id <uuid>] [--name <表名>] "
            "[--source-path <数据相对路径>] [--sample-rows <N>]"
        )

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行 schema 推断。

        Args:
            args: 命令参数（数据文件路径 + 选项）
            context: 命令上下文（本命令不依赖项目状态）

        Returns:
            成功时 data 携带推断结果字典；参数/文件错误返回 exit_code=2
        """
        parsed = _parse_infer_args(args)
        data_file = parsed["data_file"]

        if not data_file:
            return CommandResult.error("缺少数据文件路径参数", exit_code=2)

        sample_rows: int = 1000
        if parsed["sample_rows"] is not None:
            try:
                sample_rows = int(parsed["sample_rows"])  # type: ignore[arg-type]
                if sample_rows <= 0:
                    raise ValueError
            except ValueError:
                return CommandResult.error(f"--sample-rows 必须为正整数: {parsed['sample_rows']}", exit_code=2)

        from app.shared.services.schema_inference import infer_schema

        try:
            schema = infer_schema(
                data_file,
                sample_rows=sample_rows,
                table_id=parsed["table_id"],
                table_name=parsed["table_name"],
                source_path=parsed["source_path"],
            )
        except ValueError as e:
            return CommandResult.error(str(e), exit_code=2)

        yaml_text = yaml.safe_dump(schema, allow_unicode=True, sort_keys=False)

        if parsed["output"]:
            output_path = Path(parsed["output"])
            try:
                # 父目录不存在时创建，方便直接写入 <proj>/schemas/ 子路径
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(yaml_text, encoding="utf-8")
            except OSError as e:
                return CommandResult.error(f"写入输出文件失败: {e}", exit_code=2)
            return CommandResult.ok(
                f"schema 已写入: {output_path}", data={"schema": schema, "output": str(output_path)}
            )

        # stdout 输出纯 YAML（无 rich 装饰，管道/重定向友好）
        print(yaml_text, end="")
        return CommandResult.ok("", data={"schema": schema})
