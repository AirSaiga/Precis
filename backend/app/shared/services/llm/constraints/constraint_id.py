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
"""@fileoverview 约束 ID 生成模块"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


def _generate_constraint_id(constraint_type: str, table_name: str, column_name: str) -> str:
    """
    @methoddesc 生成符合命名规范的约束 ID

    业务用途:
    - 拼接 {type}_{table}_{column} 形式的 ID
    - 中文表/列名通过 _chinese_to_abbr 转拼音或内建映射

    参数:
        constraint_type: 约束类型（如 "NotNull" / "Unique"）
        table_name: 表名
        column_name: 列名

    返回:
        标准化后的约束 ID 字符串
    """
    type_prefix = constraint_type.lower()

    if re.match(r"^[\u4e00-\u9fff]+$", column_name):
        safe_column = _chinese_to_abbr(column_name) or "col"
    else:
        # 混合列名（如含全角括号的"月薪（元）"）不匹配纯中文正则，落此分支清洗；
        # 全部字符被替换为 "_" 再 strip 后可能为空——兜底 "col"，避免产出
        # "range_t1_" 这类尾随空段的 ID
        safe_column = re.sub(r"[^a-zA-Z0-9_]", "_", column_name).strip("_") or "col"

    if re.match(r"^[\u4e00-\u9fff]+$", table_name):
        table_abbr = _chinese_to_abbr(table_name)
    else:
        # §2.4: 不再截断到 10 字符——customers_eu_2024 与 customers_us_2024 截断后
        # 同前缀，同列同类型算出同一 ID，第二个约束静默覆盖第一个
        safe_table = re.sub(r"[^a-zA-Z0-9_]", "_", table_name).strip("_")
        table_abbr = safe_table

    if table_abbr:
        return f"{type_prefix}_{table_abbr}_{safe_column}"
    else:
        return f"{type_prefix}_{safe_column}"


def _chinese_to_abbr(text: str) -> str:
    """
    @methoddesc 中文文本到拼音/英文缩写

    业务用途:
    - 内建常用业务词映射（订单→order, 用户→user 等）
    - 不在内建表中的词使用 pypinyin 转换（若可用），否则返回原文本

    参数:
        text: 中文文本

    返回:
        拼音或英文缩写
    """
    mappings = {
        "订单": "order",
        "订单表": "order",
        "用户": "user",
        "用户表": "user",
        "产品": "prod",
        "产品表": "prod",
        "商品": "prod",
        "商品表": "prod",
        "分类": "cat",
        "分类表": "cat",
        "部门": "dept",
        "部门表": "dept",
        "员工": "emp",
        "员工表": "emp",
        "供应商": "supplier",
        "供应商表": "supplier",
        "客户": "customer",
        "客户表": "customer",
        "名称": "name",
        "姓名": "name",
        "邮箱": "email",
        "电子邮件": "email",
        "联系邮箱": "contact_email",
        "电话": "phone",
        "手机": "mobile",
        "地址": "address",
        "编码": "code",
        "编号": "code",
        "类型": "type",
        "状态": "status",
        "描述": "desc",
        "备注": "note",
        "创建时间": "created_at",
        "更新时间": "updated_at",
        "创建日期": "created_date",
        "更新日期": "updated_date",
        "金额": "amount",
        "价格": "price",
        "数量": "qty",
        "总数": "total",
        "用户名": "username",
    }

    if text in mappings:
        return mappings[text]

    # §2.4: 子串匹配删除——"订单" in "订单明细" 会把不同表缩写成同一 ID 前缀，
    # 命中错误映射还引入碰撞面。不在内建表中的词走下方首字母路径

    if re.match(r"^[\u4e00-\u9fff]+$", text):
        pinyin_map = {
            "供": "g",
            "应": "y",
            "商": "s",
            "表": "b",
            "用": "y",
            "户": "h",
            "订": "d",
            "单": "d",
            "产": "c",
            "品": "p",
            "库": "k",
            "存": "c",
            "交": "j",
            "易": "y",
            "员": "y",
            "工": "g",
            "部": "b",
            "门": "m",
            "名": "m",
            "称": "c",
            "邮": "y",
            "箱": "x",
            "电": "d",
            "话": "h",
            "地": "d",
            "址": "z",
            "编": "b",
            "码": "m",
            "类": "l",
            "型": "x",
            "状": "z",
            "态": "t",
            "描": "m",
            "述": "s",
            "备": "b",
            "注": "z",
            "价": "j",
            "格": "g",
            "数": "s",
            "量": "l",
        }
        # §2.4: 不限前 5 字——长中文名的前 5 字相同仍会碰撞，全名逐字转换
        return "".join([pinyin_map.get(c, c) for c in text])
    else:
        # §2.4: 同理不限前 5 段，全名首字母展开
        return "".join([c[0] for c in text.split("_") if c])
