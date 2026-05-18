"""@fileoverview 约束 ID 生成模块"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


def _generate_constraint_id(constraint_type: str, table_name: str, column_name: str) -> str:
    type_prefix = constraint_type.lower()

    if re.match(r"^[\u4e00-\u9fff]+$", column_name):
        safe_column = _chinese_to_abbr(column_name) or "col"
    else:
        safe_column = re.sub(r"[^a-zA-Z0-9_]", "_", column_name).strip("_")

    if re.match(r"^[\u4e00-\u9fff]+$", table_name):
        table_abbr = _chinese_to_abbr(table_name)
    else:
        safe_table = re.sub(r"[^a-zA-Z0-9_]", "_", table_name).strip("_")
        table_abbr = safe_table[:10] if len(safe_table) > 10 else safe_table

    if table_abbr:
        return f"{type_prefix}_{table_abbr}_{safe_column}"
    else:
        return f"{type_prefix}_{safe_column}"


def _chinese_to_abbr(text: str) -> str:
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

    for cn, en in mappings.items():
        if cn in text:
            return en

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
        return "".join([pinyin_map.get(c, c) for c in text[:5]])
    else:
        return "".join([c[0] for c in text.split("_") if c])[:5]
