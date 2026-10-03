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
"""
@fileoverview CLI 界面文案 i18n 模块

与 tui-rust/src/i18n.rs 保持同族约定（co-located 词对 + 模块级当前语言），
但有一处关键差异：CLI 面向国际发布，locale 不明时**默认英文**
（TUI 默认中文）。

用法：各调用点用 ``tr("English text", "中文原文")`` 就地给出双语词对，
英文在前（默认语言在前），返回当前语言对应文案。入口函数应在最早期调用一次
``init_from_env()``，按 ``PRECIS_LANG`` → ``LC_ALL`` → ``LC_CTYPE`` → ``LANG``
顺序探测；测试中用 ``set_lang()`` 显式切换。
"""

import os
from collections.abc import Callable

# 语言常量（字符串而非枚举：tr 签名保持简单，且便于扩展第三种语言）
LANG_ZH = "zh"
LANG_EN = "en"

# 模块级当前语言状态（Python 无 thread_local 继承问题，CLI 单线程交互为主；
# 后台线程读该值仅取快照，不随 set_lang 热切换，与 TUI 语义一致）
_current_lang: str = LANG_EN


def _detect_lang(get: Callable[[str], str | None]) -> str:
    """纯函数便于测试：从环境变量查找结果推断语言。

    探测顺序：``PRECIS_LANG`` → ``LC_ALL`` → ``LC_CTYPE`` → ``LANG``；
    取顺序中第一个**已设置且非空**的变量（空串视同未设置，继续向下探测）。
    值小写后含 ``zh`` → 中文，含 ``en`` → 英文，其他值 → 默认英文
    （CLI 面向国际发布，locale 不明时默认英文，与 TUI 的关键差异）。

    Args:
        get: 环境变量读取函数（返回 None 表示未设置），便于测试注入

    Returns:
        语言标识（LANG_ZH / LANG_EN）
    """
    for key in ("PRECIS_LANG", "LC_ALL", "LC_CTYPE", "LANG"):
        value = get(key)
        # 空串视同未设置：PRECIS_LANG="" 不应遮蔽后续 LC_ALL/LANG 探测
        if value is None or value == "":
            continue
        v = value.lower()
        if "zh" in v:
            return LANG_ZH
        if "en" in v:
            return LANG_EN
        # 显式设置但无法识别（如 "C"/"POSIX"/"fr_FR"）→ 默认英文
        return LANG_EN
    # 全部未设置 → 默认英文
    return LANG_EN


def init_from_env() -> None:
    """启动时调用一次：按 os.environ 探测并设置当前语言。"""
    global _current_lang
    _current_lang = _detect_lang(os.environ.get)


def get_lang() -> str:
    """获取当前界面语言（LANG_ZH / LANG_EN）。"""
    return _current_lang


def set_lang(lang: str) -> None:
    """设置当前界面语言（主要供测试使用）。

    Args:
        lang: 语言标识（LANG_ZH / LANG_EN）
    """
    global _current_lang
    _current_lang = lang


def tr(en: str, zh: str) -> str:
    """co-located 词对：返回当前语言对应文案。

    Args:
        en: 英文文案（默认语言在前）
        zh: 中文文案

    Returns:
        当前语言对应的文案；含插值时由调用方 ``.format(...)`` 填充，
        两侧占位符名必须一致。
    """
    return zh if _current_lang == LANG_ZH else en
