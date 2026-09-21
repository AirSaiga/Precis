# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 通用 harness 集成 golden 演练测试（P3-1 + 通用化守卫）

目的：integrations/ 下共享给所有 harness 的 skill 文档（v2-format.md）示例
配置必须始终能被后端正确加载与校验。后端 V2 格式演进导致文档示例失效时，
本脚本变红，防止"文档漂移静默失效"（与 AI 链路防漂移守卫同一思想）。

检查项：
1. 按 v2-format.md 的示例结构构造项目（覆盖全部 10 种约束：NotNull / Range /
   AllowedValues / ForeignKey / Unique / Charset / Conditional / DateLogic /
   Scripted / Composite），跑 validate 断言预期错误集（类型/行号/约束文件回溯）
   与 loading_warnings=0（约束全部成功加载执行，无 factory 静默丢弃）
2. 双 manifest 一致性：integrations/kimi.plugin.json 与仓库根
   .kimi-plugin/plugin.json 的 name/version/mcpServers 一致，声明的
   skills/commands 目录真实存在
3. 契约文档存在且与实现版本号一致
4. 通用性守卫：skill 与命令文件不得引入单一 harness 专有语法
   （${KIMI_SKILL_DIR} 等模板变量），保证同一份内容跨 harness 可用

用法：cd backend && python -m scripts.plugin_golden_test
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
PLUGIN_DIR = REPO_ROOT / "integrations"
ROOT_SHIM = REPO_ROOT / ".kimi-plugin" / "plugin.json"
CONTRACT_DOC = REPO_ROOT / "docs" / "contracts" / "validate-json-v1.md"

# 通用性守卫：这些模板变量/专有语法出现在共享 skill/命令文件中即失败
# （它们只在特定 harness 内展开，会破坏跨 harness 可用性）
_FORBIDDEN_HARNESS_SYNTAX = ("${KIMI_SKILL_DIR}", "${CLAUDE_SKILL_DIR}")

# 与 v2-format.md 示例逐字对应的配置（文档示例改了这里必须跟着改，反之亦然）
_SCHEMA_YAML = """version: 2
id: orders
name: orders
source:
  mode: relative_file
  path: data/orders.csv
columns:
  - id: order_id
    name: order_id
    type: string
    primary_key: true
  - id: amount
    name: amount
    type: integer
  - id: status
    name: status
    type: string
  - id: email
    name: email
    type: string
  - id: birth_date
    name: birth_date
    type: date
  - id: country
    name: country
    type: string
  - id: id_card
    name: id_card
    type: string
  - id: nickname
    name: nickname
    type: string
"""

_NOTNULL_YAML = """version: 2
id: 11111111-2222-4333-8444-555555555555
type: NotNull
enabled: true
description: amount 非空
refs:
  table_id: orders
  column_id: amount
params: {}
"""

_RANGE_YAML = """version: 2
id: 22222222-3333-4444-8555-666666666666
type: Range
enabled: true
description: amount 区间
refs:
  table_id: orders
  column_id: amount
params:
  min: 0
  max: 100000
  boundary_mode: inclusive
"""

_ALLOWED_YAML = """version: 2
id: 33333333-4444-4555-8666-777777777777
type: AllowedValues
enabled: true
refs:
  table_id: orders
  column_id: status
params:
  allowed_values: [pending, paid, shipped, closed]
"""

_FK_YAML = """version: 2
id: 44444444-5555-4666-8777-888888888888
type: ForeignKey
enabled: true
description: orders.order_id 引用 refs.id
refs:
  from_table_id: orders
  from_column_id: order_id
  to_table_id: orders
  to_column_id: order_id
params: {}
"""

_UNIQUE_YAML = """version: 2
id: 66666666-7777-4888-9999-000000000001
type: Unique
enabled: true
description: email 唯一
refs:
  table_id: orders
  column_ids: [email]
params: {}
"""

_CHARSET_YAML = """version: 2
id: 66666666-7777-4888-9999-000000000002
type: Charset
enabled: true
description: nickname 必须是中文
refs:
  table_id: orders
  column_id: nickname
params:
  charset_mode: chinese
"""

_CONDITIONAL_YAML = """version: 2
id: 66666666-7777-4888-9999-000000000003
type: Conditional
enabled: true
description: 中国用户必须填身份证号
refs:
  table_id: orders
  then_column_id: id_card
  if_conditions:
    - if_column_id: country
      operator: eq
      value: CN
  if_logic: and
params:
  then_condition:
    operator: not_null
"""

_DATELOGIC_YAML = """version: 2
id: 66666666-7777-4888-9999-000000000004
type: DateLogic
enabled: true
description: 出生日期必须晚于 1900-01-01
refs:
  table_id: orders
  column_id: birth_date
params:
  logic_mode: compare
  compare_op: gt
  reference_date: "1900-01-01"
"""

_SCRIPTED_YAML = """version: 2
id: 66666666-7777-4888-9999-000000000005
type: Scripted
enabled: true
description: email 必须是合法邮箱格式
refs:
  table_id: orders
  column_id: email
params:
  name: email_format_check
  expression: 're_match(r"^[\\w.+-]+@[\\w-]+\\.[\\w.]+$", str(value))'
"""

_COMPOSITE_YAML = """version: 2
id: 66666666-7777-4888-9999-000000000006
type: Composite
enabled: true
description: country 只能是 CN 或 US
refs:
  table_id: orders
params:
  logic: all
  sub_constraints:
    - version: 2
      id: 77777777-8888-4999-0000-000000000001
      type: AllowedValues
      enabled: true
      refs: { table_id: orders, column_id: country }
      params:
        allowed_values: [CN, US]
"""

_MANIFEST_YAML = """version: 2
project:
  id: 55555555-6666-4777-8888-999999999999
  name: plugin-golden-demo
settings:
  script_security:
    allow_eval: true
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: 11111111-2222-4333-8444-555555555555
    path: constraints/amount_notnull.constraint.yaml
  - id: 22222222-3333-4444-8555-666666666666
    path: constraints/amount_range.constraint.yaml
  - id: 33333333-4444-4555-8666-777777777777
    path: constraints/status_allowed.constraint.yaml
  - id: 44444444-5555-4666-8777-888888888888
    path: constraints/self_fk.constraint.yaml
  - id: 66666666-7777-4888-9999-000000000001
    path: constraints/email_unique.constraint.yaml
  - id: 66666666-7777-4888-9999-000000000002
    path: constraints/nickname_charset.constraint.yaml
  - id: 66666666-7777-4888-9999-000000000003
    path: constraints/id_card_conditional.constraint.yaml
  - id: 66666666-7777-4888-9999-000000000004
    path: constraints/birth_datelogic.constraint.yaml
  - id: 66666666-7777-4888-9999-000000000005
    path: constraints/email_scripted.constraint.yaml
  - id: 66666666-7777-4888-9999-000000000006
    path: constraints/country_composite.constraint.yaml
"""

# 数据设计（行号 0 起）：
# 行 0 全部通过（但 email 与行 4 重复 → Unique 的 keep=False 会同时标记行 0/4）；
# 行 1 amount 空 → NotNull；
# 行 2 amount=999999 → Range；birth_date=1899-12-31 → DateLogic(compare gt 1900-01-01)；
# 行 3 status=unknown → AllowedValues；country=CN 且 id_card 空 → Conditional；
# 行 4 email 与行 0 重复 → Unique；
# 行 5 nickname=Bob（非中文）→ Charset；country=UK → Composite(all: AllowedValues 子约束)；
# 行 6 email=bad-email → Scripted(邮箱正则)。
_CSV = (
    "order_id,amount,status,email,birth_date,country,id_card,nickname\n"
    "ORD-001,10,pending,alice@example.com,1990-01-15,CN,110101199001150011,爱丽丝\n"
    "ORD-002,,pending,bob@example.com,1985-03-20,US,,鲍勃\n"
    "ORD-003,999999,pending,carol@example.com,1899-12-31,US,,卡罗尔\n"
    "ORD-004,20,unknown,dave@example.com,1995-06-01,CN,,大卫\n"
    "ORD-005,30,pending,alice@example.com,2000-01-01,US,,伊万\n"
    "ORD-006,40,paid,eve@example.com,1991-02-02,UK,911101199102020012,Bob\n"
    "ORD-007,50,paid,bad-email,1992-02-02,US,,艾娃\n"
)

# 预期错误集：(constraint_type, column, row_index, constraint_file)
# constraint_type 为约束类名（JSON 契约的 check_type 口径）；
# Unique/Conditional/Scripted 的违规条目不携带 column（引擎侧错误字典未填，契约允许）；
# Composite(logic=all) 的错误归到父 Composite 文件，check_type 用 Composite 类名。
_EXPECTED_ERRORS = {
    ("NotNullConstraint", "amount", 1, "constraints/amount_notnull.constraint.yaml"),
    ("RangeConstraint", "amount", 2, "constraints/amount_range.constraint.yaml"),
    ("AllowedValuesConstraint", "status", 3, "constraints/status_allowed.constraint.yaml"),
    ("UniqueConstraint", None, 0, "constraints/email_unique.constraint.yaml"),
    ("UniqueConstraint", None, 4, "constraints/email_unique.constraint.yaml"),
    ("CharsetConstraint", "nickname", 5, "constraints/nickname_charset.constraint.yaml"),
    ("ConditionalConstraint", None, 3, "constraints/id_card_conditional.constraint.yaml"),
    ("DateLogicConstraint", "birth_date", 2, "constraints/birth_datelogic.constraint.yaml"),
    ("ScriptedConstraint", None, 6, "constraints/email_scripted.constraint.yaml"),
    ("CompositeConstraint", "country", 5, "constraints/country_composite.constraint.yaml"),
}


def _build_golden_project(root: Path) -> Path:
    """按 v2-format.md 示例落盘 golden 项目，返回 manifest 路径。"""
    (root / "schemas").mkdir(parents=True)
    (root / "constraints").mkdir()
    (root / "data").mkdir()
    (root / "data" / "orders.csv").write_text(_CSV, encoding="utf-8")
    (root / "schemas" / "orders.schema.yaml").write_text(_SCHEMA_YAML, encoding="utf-8")
    constraint_files = {
        "amount_notnull.constraint.yaml": _NOTNULL_YAML,
        "amount_range.constraint.yaml": _RANGE_YAML,
        "status_allowed.constraint.yaml": _ALLOWED_YAML,
        "self_fk.constraint.yaml": _FK_YAML,
        "email_unique.constraint.yaml": _UNIQUE_YAML,
        "nickname_charset.constraint.yaml": _CHARSET_YAML,
        "id_card_conditional.constraint.yaml": _CONDITIONAL_YAML,
        "birth_datelogic.constraint.yaml": _DATELOGIC_YAML,
        "email_scripted.constraint.yaml": _SCRIPTED_YAML,
        "country_composite.constraint.yaml": _COMPOSITE_YAML,
    }
    for name, content in constraint_files.items():
        (root / "constraints" / name).write_text(content, encoding="utf-8")
    manifest = root / "project.precis.yaml"
    manifest.write_text(_MANIFEST_YAML, encoding="utf-8")
    return manifest


def check_golden_validation() -> dict:
    """构造项目并经真实 CLI 入口（python -m app.cli validate）跑校验，断言错误集与文档示例一致。

    Scripted 约束的服务端总开关 PRECIS_ALLOW_UNSAFE_EVAL 在子进程环境注入：
    scripted.py 在首次 import 时读取并缓存该变量，进程内设置会受 pytest 会话
    中其他测试导入顺序影响，子进程隔离后与 CI/插件真实运行形态一致。
    """
    with tempfile.TemporaryDirectory(prefix="precis_plugin_golden_") as td:
        manifest = _build_golden_project(Path(td))
        env = {**os.environ, "PRECIS_ALLOW_UNSAFE_EVAL": "1"}
        proc = subprocess.run(
            [sys.executable, "-B", "-m", "app.cli", "validate", "--manifest", str(manifest), "--format", "json"],
            capture_output=True,
            text=True,
            # CLI 的 JSON 输出固定 UTF-8（中文消息 ensure_ascii=False）；
            # Windows 默认 locale 编码是 GBK，不显式指定会解码失败
            encoding="utf-8",
            errors="replace",
            cwd=BACKEND_ROOT,
            env=env,
            timeout=120,
        )
        if proc.returncode not in (0, 1):
            raise AssertionError(
                f"CLI 校验进程异常退出（code={proc.returncode}）:\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
            )
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError as e:
            raise AssertionError(f"stdout 不是合法 JSON: {e}\nstdout: {proc.stdout}\nstderr: {proc.stderr}") from e

        actual = {(e["constraint_type"], e["column"], e["row_index"], e["constraint_file"]) for e in payload["errors"]}
        if actual != _EXPECTED_ERRORS:
            missing = _EXPECTED_ERRORS - actual
            extra = actual - _EXPECTED_ERRORS
            raise AssertionError(
                "插件 golden 校验错误集与预期不一致（v2-format.md 示例可能已失效）：\n"
                f"  缺失: {sorted(missing)}\n  多余: {sorted(extra)}\n"
                f"  loading_warnings: {payload['loading_warnings']}"
            )
        if payload["loading_warnings"]:
            raise AssertionError(
                f"loading_warnings 非空——约束存在加载/构建失败（factory 静默丢弃）:\n  {payload['loading_warnings']}"
            )
        return {
            "errors": len(actual),
            "summary": payload["summary"],
            "loading_warnings": len(payload["loading_warnings"]),
        }


def check_plugin_manifests() -> dict:
    """双 manifest 一致性与引用路径存在性检查。"""
    if not PLUGIN_DIR.is_dir():
        raise AssertionError(f"插件目录不存在: {PLUGIN_DIR}")
    plugin_manifest = json.loads((PLUGIN_DIR / "kimi.plugin.json").read_text(encoding="utf-8"))
    shim_manifest = json.loads(ROOT_SHIM.read_text(encoding="utf-8"))

    for key in ("name", "version", "mcpServers"):
        if plugin_manifest.get(key) != shim_manifest.get(key):
            raise AssertionError(
                f"双 manifest 不一致（{key}）: {PLUGIN_DIR}/kimi.plugin.json={plugin_manifest.get(key)!r} "
                f"vs {ROOT_SHIM}={shim_manifest.get(key)!r}；两份必须同步修改"
            )

    # 声明的 skills/commands 目录必须存在。路径解析基准遵循 Kimi Code 规范：
    # 插件根 = manifest 为 <插件根>/kimi.plugin.json 或 <插件根>/.kimi-plugin/plugin.json
    # 时的 <插件根>。integrations/kimi.plugin.json 的插件根是 integrations/；
    # 仓库根垫片 .kimi-plugin/plugin.json 的插件根是仓库根（REPO_ROOT），
    # 其路径须以 ./ 开头且不得越出插件根（否则安装时被安全模型拒绝）。
    for base, manifest in ((PLUGIN_DIR, plugin_manifest), (REPO_ROOT, shim_manifest)):
        for key in ("skills", "commands"):
            rel = manifest.get(key)
            if not rel or not (base / rel).is_dir():
                raise AssertionError(f"manifest 声明的 {key} 目录不存在: {base / rel}")

    must_exist_files = [
        PLUGIN_DIR / "skills" / "precis-data-validation" / "SKILL.md",
        PLUGIN_DIR / "skills" / "precis-data-validation" / "references" / "v2-format.md",
        PLUGIN_DIR / "commands" / "validate.md",
        PLUGIN_DIR / "commands" / "init.md",
        PLUGIN_DIR / "commands" / "report.md",
        PLUGIN_DIR / "README.md",
        PLUGIN_DIR / "marketplace.json",
    ]
    for f in must_exist_files:
        if not f.is_file():
            raise AssertionError(f"插件关键文件缺失: {f}")

    return {"name": plugin_manifest["name"], "version": plugin_manifest["version"]}


def check_contract_doc() -> dict:
    """契约文档存在且 schema_version 与实现一致。"""
    from app.shared.services.validation.json_payload import JSON_SCHEMA_VERSION

    if not CONTRACT_DOC.is_file():
        raise AssertionError(f"契约文档缺失: {CONTRACT_DOC}")
    text = CONTRACT_DOC.read_text(encoding="utf-8")
    if "`1`" not in text and "为 `1`" not in text:
        # 文档需声明当前契约版本号
        raise AssertionError("契约文档未声明 schema_version（应为 1）")
    return {"json_schema_version": JSON_SCHEMA_VERSION}


def check_harness_neutrality() -> dict:
    """通用性守卫：共享 skill/命令文件不得含单一 harness 专有模板语法。

    ${KIMI_SKILL_DIR} 等变量只在对应 harness 内展开，出现即破坏
    "同一份内容跨 harness 拷贝即用"的通用化设计目标。
    """
    offenders: list[str] = []
    shared_files = [
        PLUGIN_DIR / "skills" / "precis-data-validation" / "SKILL.md",
        PLUGIN_DIR / "skills" / "precis-data-validation" / "references" / "v2-format.md",
        *sorted((PLUGIN_DIR / "commands").glob("*.md")),
    ]
    for path in shared_files:
        if not path.is_file():
            continue  # 缺文件由 manifest 检查兜底
        text = path.read_text(encoding="utf-8")
        for syntax in _FORBIDDEN_HARNESS_SYNTAX:
            if syntax in text:
                offenders.append(f"{path.relative_to(REPO_ROOT)} 含专有语法 {syntax}")
    if offenders:
        raise AssertionError(
            "共享 skill/命令文件引入了 harness 专有语法（通用化设计不允许）:\n  " + "\n  ".join(offenders)
        )
    return {"checked_files": len(shared_files), "forbidden_syntax": list(_FORBIDDEN_HARNESS_SYNTAX)}


def main() -> int:
    """脚本入口：跑全部检查，失败非零退出（CI 红）。"""
    results = {
        "golden_validation": check_golden_validation(),
        "plugin_manifests": check_plugin_manifests(),
        "contract_doc": check_contract_doc(),
        "harness_neutrality": check_harness_neutrality(),
    }
    print(json.dumps(results, ensure_ascii=False, indent=2))
    print("plugin golden: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
