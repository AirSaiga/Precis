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
顺序探测；四个环境变量全部未设置时兜底探测**操作系统 UI 语言**
（Windows 默认不设 POSIX locale 变量，无此兜底则中文系统误落英文）；
测试中用 ``set_lang()`` 显式切换。
"""

import locale
import os
import sys
from collections.abc import Callable

# 语言常量（字符串而非枚举：tr 签名保持简单，且便于扩展第三种语言）
LANG_ZH = "zh"
LANG_EN = "en"

# 模块级当前语言状态（Python 无 thread_local 继承问题，CLI 单线程交互为主；
# 后台线程读该值仅取快照，不随 set_lang 热切换，与 TUI 语义一致）
_current_lang: str = LANG_EN


def _detect_lang(
    get: Callable[[str], str | None],
    system_locale: Callable[[], str | None] | None = None,
) -> str:
    """纯函数便于测试：从环境变量查找结果推断语言。

    探测顺序：``PRECIS_LANG`` → ``LC_ALL`` → ``LC_CTYPE`` → ``LANG``；
    取顺序中第一个**已设置且非空**的变量（空串视同未设置，继续向下探测）。
    值小写后含 ``zh`` → 中文，含 ``en`` → 英文，其他值 → 默认英文
    （CLI 面向国际发布，locale 不明时默认英文，与 TUI 的关键差异）。

    四个环境变量全部未设置时，若提供了 ``system_locale`` 则兜底探测
    操作系统 UI 语言——Windows 默认不设 LC_ALL/LANG，无此兜底则中文
    系统一律误落英文（start-cli.bat 场景）。

    Args:
        get: 环境变量读取函数（返回 None 表示未设置），便于测试注入
        system_locale: 操作系统区域设置读取函数（返回 None 表示取不到），
            便于测试注入；为 None 时不做 OS 兜底

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
    # 环境变量全部未设置 → 兜底探测操作系统 UI 语言
    if system_locale is not None:
        value = system_locale()
        if value:
            if "zh" in value.lower():
                return LANG_ZH
            # 非中文系统（含取到但无法识别的值）→ 默认英文
            return LANG_EN
    # 无法确定 → 默认英文
    return LANG_EN


def _system_locale() -> str | None:
    """读取操作系统区域设置（环境变量全部缺失时的兜底）。

    Windows 经 ``GetUserDefaultLocaleName`` 取 BCP-47 标签（如 ``zh-CN``）；
    其他平台回退 ``locale.getlocale()``。任何失败一律返回 None（吞异常：
    语言探测失败不应阻断 CLI 启动）。
    """
    try:
        if sys.platform == "win32":
            import ctypes

            # LOCALE_NAME_MAX_LENGTH = 85
            buf = ctypes.create_unicode_buffer(85)
            if ctypes.windll.kernel32.GetUserDefaultLocaleName(buf, 85) > 0:
                return buf.value
            return None
        lang, _encoding = locale.getlocale()
        return lang
    except Exception:
        return None


def init_from_env() -> None:
    """启动时调用一次：按环境变量探测，全缺时兜底 OS 语言。"""
    global _current_lang
    _current_lang = _detect_lang(os.environ.get, _system_locale)


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
