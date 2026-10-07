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
"""@fileoverview 配置迁移能力评估套件（旧脚本/描述 → V2 配置）

链路真实性：完整走生产迁移服务 ConfigMigrationService.migrate_from_script——
真实数据文件画像（CSV 种子）→ ScriptParseTool 确定性解析规则意图 → 按源分片 →
_build_chunk_task_instructions + build_prompt（真实提示词）→ provider.chat（既有
Provider 抽象）→ build_config 归一化 → MergeResultsTool 合并。Provider 实例经
service._provider 直注（与生产 _get_provider 懒加载同一入口），其余零 mock。

任务输入 = 旧脚本（python pandas / SQL DDL / Excel 公式 / 自然语言）+ 种子数据文件；
期望产物 = V2 配置约束集合，程序化判分。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.shared.services.ai.migrate_service import ConfigMigrationService
from app.shared.services.llm.providers.base import BaseProvider

from .common import (
    EvalTask,
    TaskOutcome,
    check,
    check_constraint_present,
    check_no_constraint_on,
    find_constraints,
    iter_constraints,
    iter_regex_nodes,
)

# 种子数据：与脚本中引用的表/列一一对应（画像与意图解析的锚点）
_USERS_CSV = "id,name,nickname,age,email,user_id\n1,张三,小明,25,a@x.com,1\n2,李四,Tom2,40,b@y.org,2\n"
_ORDERS_CSV = (
    "order_id,user_id,amount,status\n501,1,99.5,pending\n502,2,199.0,shipped\n"
)


def _make_migration_task(
    task_id: str,
    kind: str,
    description: str,
    script_content: str,
    language: str,
    data_files: dict[str, str],
    checker,
    sources: list[dict[str, Any]] | None = None,
) -> EvalTask:
    """装配迁移任务：种子数据落盘 → 生产迁移服务全链路 → 程序化判分。"""

    async def run(provider: BaseProvider, workdir: Path) -> TaskOutcome:
        file_paths = []
        for fname, content in data_files.items():
            fpath = workdir / fname
            fpath.write_text(content, encoding="utf-8")
            file_paths.append(str(fpath))
        service = ConfigMigrationService()
        # 直注 provider：跳过用户级配置懒加载（评估框架自持实例），其余链路零改动
        service._provider = provider
        result = await service.migrate_from_script(
            script_content=script_content,
            language=language,
            file_paths=file_paths,
            project_name="eval_migration",
            project_id="eval_migration",
            config_path=None,
            sources=sources,
        )
        return TaskOutcome(actual={"result": result})

    return EvalTask(
        id=task_id, kind=kind, description=description, run=run, check=checker
    )


def _ok(outcome: TaskOutcome) -> check:
    """通用判分：迁移链路整体成功。"""
    return check(
        "migration success", bool(outcome.actual.get("result", {}).get("success"))
    )


# =============================================================================
# 任务定义（12 个：normal 8 / boundary 2 / adversarial 2）
# =============================================================================

TASKS: list[EvalTask] = []

# --- normal ---

TASKS.append(
    _make_migration_task(
        "mig-01-pandas-range",
        "normal",
        "pandas 范围检查脚本 → Range 约束",
        "import pandas as pd\ndf = pd.read_csv('users.csv')\nbad = df[df['age'] < 0]\nassert bad.empty\n",
        "python",
        {"users.csv": _USERS_CSV},
        lambda o: [
            _ok(o),
            check_constraint_present(
                o.actual["result"], "Range", "age", param_predicates={"min": ("ge", 0)}
            ),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-02-pandas-regex",
        "normal",
        "pandas 正则匹配脚本 → 正则校验（regex 节点或 Scripted 约束）",
        "import pandas as pd\ndf = pd.read_csv('users.csv')\nassert df['email'].str.match(r'^[^@]+@[^@]+$').all()\n",
        "python",
        {"users.csv": _USERS_CSV},
        lambda o: [
            _ok(o),
            check(
                "email format validation migrated",
                any(
                    (r.get("source_ref", {}) or {}).get("column_id", "").lower()
                    == "email"
                    for r in iter_regex_nodes(o.actual["result"])
                )
                or bool(find_constraints(o.actual["result"], "Scripted", "email")),
            ),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-03-pandas-isin",
        "normal",
        "pandas 枚举检查脚本 → AllowedValues 约束",
        "import pandas as pd\ndf = pd.read_csv('orders.csv')\nvalid = ['pending', 'shipped', 'done']\nassert df['status'].isin(valid).all()\n",
        "python",
        {"orders.csv": _ORDERS_CSV},
        lambda o: [
            _ok(o),
            check_constraint_present(
                o.actual["result"],
                "AllowedValues",
                "status",
                param_predicates={"allowed_values": ("contains", "pending")},
            ),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-04-pandas-unique-notna",
        "normal",
        "pandas 唯一 + 非空检查脚本 → Unique + NotNull 约束",
        "import pandas as pd\ndf = pd.read_csv('users.csv')\nassert df['id'].is_unique\nassert df['name'].notna().all()\n",
        "python",
        {"users.csv": _USERS_CSV},
        lambda o: [
            _ok(o),
            check_constraint_present(o.actual["result"], "Unique", "id"),
            check_constraint_present(o.actual["result"], "NotNull", "name"),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-05-sql-ddl",
        "normal",
        "SQL DDL（NOT NULL / CHECK / UNIQUE）→ 对应约束",
        "CREATE TABLE users (\n  id INT NOT NULL,\n  age INT CHECK (age > 0),\n  email VARCHAR(255) UNIQUE (email)\n);\n",
        "sql",
        {"users.csv": _USERS_CSV},
        lambda o: [
            _ok(o),
            check_constraint_present(o.actual["result"], "NotNull", "id"),
            check_constraint_present(
                o.actual["result"], "Range", "age", param_predicates={"min": ("ge", 0)}
            ),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-06-sql-fk",
        "normal",
        "SQL 外键声明 → ForeignKey 约束",
        "CREATE TABLE orders (\n  order_id INT NOT NULL,\n  user_id INT,\n  FOREIGN KEY (user_id) REFERENCES users(id)\n);\n",
        "sql",
        {"users.csv": _USERS_CSV, "orders.csv": _ORDERS_CSV},
        lambda o: [
            _ok(o),
            check(
                "ForeignKey migrated",
                any(
                    c["type"] == "ForeignKey"
                    for c in iter_constraints(o.actual["result"])
                ),
            ),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-07-excel-formula",
        "normal",
        "Excel 数据验证（列表 + 范围公式）→ 至少迁移出一条对应约束",
        "数据验证: allow='list' formula1='pending,shipped,done'\n单元格校验: =AND(B1>0, B1<1000000)\n",
        "excel_formula",
        {"orders.csv": _ORDERS_CSV},
        lambda o: [
            _ok(o),
            check(
                "at least one constraint migrated",
                bool(
                    (o.actual["result"].get("constraints") or {})
                    or any(
                        isinstance(doc, dict) and doc.get("constraints")
                        for doc in (o.actual["result"].get("schemas") or {}).values()
                    )
                ),
            ),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-08-natural-language",
        "normal",
        "中文自然语言规则描述 → Charset + NotNull（FakeProvider 剧本兼容，dry-run 可过）",
        "昵称 nickname 列必须是中文混合字符集，姓名 name 不能为空。",
        "natural_language",
        {"users.csv": _USERS_CSV},
        lambda o: [
            _ok(o),
            check_constraint_present(
                o.actual["result"],
                "Charset",
                "nickname",
                param_predicates={"charset_mode": "chinese_mixed"},
            ),
            check_constraint_present(o.actual["result"], "NotNull", "name"),
        ],
    )
)

# --- boundary ---

TASKS.append(
    _make_migration_task(
        "mig-09-no-rules",
        "boundary",
        "无可解析规则的脚本：干净失败，不幻觉约束",
        "import pandas as pd\ndf = pd.read_csv('users.csv')\nprint(df.shape)\n",
        "python",
        {"users.csv": _USERS_CSV},
        lambda o: [
            check(
                "clean failure without hallucinated constraints",
                (not o.actual["result"].get("success"))
                or not (
                    (o.actual["result"].get("constraints") or {})
                    or any(
                        isinstance(doc, dict) and doc.get("constraints")
                        for doc in (o.actual["result"].get("schemas") or {}).values()
                    )
                ),
                f"success={o.actual['result'].get('success')}, error={o.actual['result'].get('error')}",
            ),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-10-multi-source-merge",
        "boundary",
        "多来源分片合并：两条脚本规则都保留",
        "",
        "python",
        {"users.csv": _USERS_CSV, "orders.csv": _ORDERS_CSV},
        lambda o: [
            _ok(o),
            check_constraint_present(
                o.actual["result"], "Range", "age", param_predicates={"min": ("ge", 0)}
            ),
            check_constraint_present(
                o.actual["result"],
                "AllowedValues",
                "status",
                param_predicates={"allowed_values": ("contains", "pending")},
            ),
        ],
        sources=[
            {
                "name": "age_check.py",
                "language": "python",
                "content": "import pandas as pd\ndf = pd.read_csv('users.csv')\nassert (df['age'] >= 0).all()\n",
            },
            {
                "name": "status_check.py",
                "language": "python",
                "content": "import pandas as pd\ndf = pd.read_csv('orders.csv')\nassert df['status'].isin(['pending', 'shipped', 'done']).all()\n",
            },
        ],
    )
)

# --- adversarial ---

TASKS.append(
    _make_migration_task(
        "mig-11-nonexistent-column",
        "adversarial",
        "脚本引用数据中不存在的列：不得为幻觉列生成约束",
        "import pandas as pd\ndf = pd.read_csv('users.csv')\nassert (df['salary'] > 0).all()\n",
        "python",
        {"users.csv": _USERS_CSV},
        lambda o: [
            check_no_constraint_on(o.actual["result"], "Range", "salary"),
        ],
    )
)

TASKS.append(
    _make_migration_task(
        "mig-12-conflicting-rules",
        "adversarial",
        "两来源规则冲突（age 0-120 vs age 0-200）：合并不崩溃且边界一致",
        "",
        "python",
        {"users.csv": _USERS_CSV},
        lambda o: [
            check(
                "merge completed without crash",
                isinstance(o.actual["result"], dict)
                and ("success" in o.actual["result"]),
                f"error={o.actual['result'].get('error') if isinstance(o.actual['result'], dict) else o.error}",
            ),
            check_constraint_present(
                o.actual["result"], "Range", "age", param_predicates={"min": ("ge", 0)}
            ),
        ],
        sources=[
            {
                "name": "rule_a.py",
                "language": "python",
                "content": "import pandas as pd\ndf = pd.read_csv('users.csv')\nassert df['age'].between(0, 120).all()\n",
            },
            {
                "name": "rule_b.py",
                "language": "python",
                "content": "import pandas as pd\ndf = pd.read_csv('users.csv')\nassert df['age'].between(0, 200).all()\n",
            },
        ],
    )
)

SUITE_NAME = "migration"
