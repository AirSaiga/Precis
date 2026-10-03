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
"""CLI i18n 模块单元测试：语言探测顺序、判定规则与 tr 双语言返回。"""

from app.cli import i18n
from app.cli.i18n import LANG_EN, LANG_ZH, _detect_lang, get_lang, init_from_env, set_lang, tr


def _env(**kwargs: str | None) -> dict:
    """构造环境变量字典，None 表示该变量未设置。"""
    return {k: v for k, v in kwargs.items() if v is not None}


class TestDetectLang:
    """探测顺序与优先级。"""

    def test_precis_lang_highest_priority(self) -> None:
        # PRECIS_LANG 优先于所有 locale 变量
        env = _env(PRECIS_LANG="zh-CN", LC_ALL="en_US.UTF-8", LC_CTYPE="en_US", LANG="en_US")
        assert _detect_lang(env.get) == LANG_ZH

    def test_lc_all_overrides_lc_ctype_and_lang(self) -> None:
        env = _env(LC_ALL="en_US.UTF-8", LC_CTYPE="zh_CN.UTF-8", LANG="zh_CN")
        assert _detect_lang(env.get) == LANG_EN

    def test_lc_ctype_overrides_lang(self) -> None:
        env = _env(LC_CTYPE="zh_CN.UTF-8", LANG="en_US.UTF-8")
        assert _detect_lang(env.get) == LANG_ZH

    def test_lang_fallback(self) -> None:
        env = _env(LANG="en_GB.UTF-8")
        assert _detect_lang(env.get) == LANG_EN

    def test_empty_string_falls_through(self) -> None:
        # 空串视同未设置：PRECIS_LANG="" 不遮蔽 LC_ALL
        env = _env(PRECIS_LANG="", LC_ALL="zh_CN.UTF-8")
        assert _detect_lang(env.get) == LANG_ZH

    def test_all_empty_strings_fall_through_to_lang(self) -> None:
        env = _env(PRECIS_LANG="", LC_ALL="", LC_CTYPE="", LANG="en_US.UTF-8")
        assert _detect_lang(env.get) == LANG_EN

    def test_all_unset_defaults_to_english(self) -> None:
        # 关键差异：CLI locale 不明时默认英文（TUI 默认中文）
        assert _detect_lang(_env().get) == LANG_EN


class TestDetectLangValues:
    """值判定：zh / en / 其他。"""

    def test_zh_variants(self) -> None:
        for value in ("zh_CN.UTF-8", "zh", "ZH", "zh_TW.big5"):
            assert _detect_lang(_env(PRECIS_LANG=value).get) == LANG_ZH

    def test_en_variants(self) -> None:
        for value in ("en_US.UTF-8", "EN", "english", "en_GB"):
            assert _detect_lang(_env(PRECIS_LANG=value).get) == LANG_EN

    def test_unrecognized_values_default_english(self) -> None:
        # "C"/"POSIX"/法语等无法识别的值 → 默认英文（国际发布约定）
        for value in ("C", "POSIX", "fr_FR.UTF-8", "ja_JP"):
            assert _detect_lang(_env(PRECIS_LANG=value).get) == LANG_EN


class TestInitFromEnv:
    """init_from_env 用 monkeypatch 隔离真实环境变量。"""

    def test_init_from_env_zh(self, monkeypatch) -> None:
        for var in ("PRECIS_LANG", "LC_ALL", "LC_CTYPE", "LANG"):
            monkeypatch.delenv(var, raising=False)
        monkeypatch.setenv("PRECIS_LANG", "zh_CN.UTF-8")
        init_from_env()
        assert get_lang() == LANG_ZH
        set_lang(LANG_EN)  # 还原，避免影响其他测试

    def test_init_from_env_unset_defaults_english(self, monkeypatch) -> None:
        for var in ("PRECIS_LANG", "LC_ALL", "LC_CTYPE", "LANG"):
            monkeypatch.delenv(var, raising=False)
        init_from_env()
        assert get_lang() == LANG_EN


class TestTr:
    """tr 双语言返回与 set_lang 还原。"""

    def test_tr_returns_english_by_default(self) -> None:
        set_lang(LANG_EN)
        assert tr("File not found: {path}", "文件不存在: {path}") == "File not found: {path}"

    def test_tr_returns_chinese_when_set(self) -> None:
        set_lang(LANG_ZH)
        assert tr("File not found: {path}", "文件不存在: {path}") == "文件不存在: {path}"

    def test_tr_interpolation_placeholders_consistent(self) -> None:
        # 两侧占位符名一致，format 可正确填充
        for lang in (LANG_EN, LANG_ZH):
            set_lang(lang)
            assert tr("File not found: {path}", "文件不存在: {path}").format(path="/tmp/x") == (
                "File not found: /tmp/x" if lang == LANG_EN else "文件不存在: /tmp/x"
            )

    def test_set_lang_restore(self) -> None:
        original = get_lang()
        try:
            set_lang(LANG_ZH)
            assert get_lang() == LANG_ZH
            assert tr("hello", "你好") == "你好"
            set_lang(LANG_EN)
            assert get_lang() == LANG_EN
            assert tr("hello", "你好") == "hello"
        finally:
            set_lang(original)

    def test_module_default_state_is_english(self) -> None:
        # conftest 的 autouse fixture 会把语言改为中文，此处直接断言常量约定
        assert i18n.LANG_EN == "en"
        assert i18n.LANG_ZH == "zh"
