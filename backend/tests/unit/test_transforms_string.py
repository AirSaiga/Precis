"""测试字符串相关 Transform 运行器"""

from __future__ import annotations

import pandas as pd
import pytest

from app.shared.domain.transforms.concat import ConcatRunner
from app.shared.domain.transforms.lower_case import LowerCaseRunner
from app.shared.domain.transforms.regex_extract import RegexExtractRunner
from app.shared.domain.transforms.replace import ReplaceRunner
from app.shared.domain.transforms.string_split import StringSplitRunner
from app.shared.domain.transforms.strip import StripRunner
from app.shared.domain.transforms.substring import SubstringRunner
from app.shared.domain.transforms.upper_case import UpperCaseRunner


class TestStringSplitRunner:
    def test_basic_split(self):
        runner = StringSplitRunner()
        df = pd.DataFrame({"name": ["John Doe", "Jane Smith"]})
        result = runner.execute(df, "name", {"delimiter": " "}, ["first", "last"])
        assert result["first"].tolist() == ["John", "Jane"]
        assert result["last"].tolist() == ["Doe", "Smith"]

    def test_split_with_maxsplit(self):
        runner = StringSplitRunner()
        df = pd.DataFrame({"path": ["a/b/c", "x/y/z"]})
        result = runner.execute(df, "path", {"delimiter": "/", "maxsplit": 1}, ["p1", "p2"])
        assert result["p1"].tolist() == ["a", "x"]
        assert result["p2"].tolist() == ["b/c", "y/z"]

    def test_missing_column_raises(self):
        runner = StringSplitRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])

    def test_more_outputs_than_splits(self):
        runner = StringSplitRunner()
        df = pd.DataFrame({"name": ["John"]})
        result = runner.execute(df, "name", {"delimiter": " "}, ["a", "b", "c"])
        assert result["a"][0] == "John"
        assert pd.isna(result["b"][0])
        assert pd.isna(result["c"][0])


class TestRegexExtractRunner:
    def test_basic_extraction(self):
        runner = RegexExtractRunner()
        df = pd.DataFrame({"text": ["abc123", "def456"]})
        result = runner.execute(df, "text", {"pattern": r"([a-z]+)(\d+)"}, ["letters", "digits"])
        assert result["letters"].tolist() == ["abc", "def"]
        assert result["digits"].tolist() == ["123", "456"]

    def test_no_match_returns_none(self):
        runner = RegexExtractRunner()
        df = pd.DataFrame({"text": ["!!!"]})
        result = runner.execute(df, "text", {"pattern": r"(\d+)"}, ["num"])
        assert pd.isna(result["num"][0])

    def test_ignorecase_flag(self):
        runner = RegexExtractRunner()
        df = pd.DataFrame({"text": ["HELLO"]})
        result = runner.execute(df, "text", {"pattern": r"(hello)", "flags": "i"}, ["word"])
        assert result["word"][0] == "HELLO"

    def test_empty_pattern_raises(self):
        runner = RegexExtractRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要 pattern 参数"):
            runner.execute(df, "a", {}, ["x"])

    def test_missing_column_raises(self):
        runner = RegexExtractRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {"pattern": r"(.*)"}, ["x"])


class TestStripRunner:
    def test_default_strip_whitespace(self):
        runner = StripRunner()
        df = pd.DataFrame({"text": ["  hello  ", "\tworld\n"]})
        result = runner.execute(df, "text", {}, ["clean"])
        assert result["clean"].tolist() == ["hello", "world"]

    def test_custom_chars(self):
        runner = StripRunner()
        df = pd.DataFrame({"text": ["xxhelloxx"]})
        result = runner.execute(df, "text", {"chars": "x"}, ["clean"])
        assert result["clean"][0] == "hello"

    def test_missing_column_raises(self):
        runner = StripRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])

    def test_empty_output_raises(self):
        runner = StripRunner()
        df = pd.DataFrame({"a": ["x"]})
        with pytest.raises(ValueError, match="需要至少一个 output_columns"):
            runner.execute(df, "a", {}, [])


class TestUpperCaseRunner:
    def test_basic(self):
        runner = UpperCaseRunner()
        df = pd.DataFrame({"name": ["alice", "BoB"]})
        result = runner.execute(df, "name", {}, ["upper"])
        assert result["upper"].tolist() == ["ALICE", "BOB"]

    def test_missing_column_raises(self):
        runner = UpperCaseRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])


class TestLowerCaseRunner:
    def test_basic(self):
        runner = LowerCaseRunner()
        df = pd.DataFrame({"name": ["ALICE", "BoB"]})
        result = runner.execute(df, "name", {}, ["lower"])
        assert result["lower"].tolist() == ["alice", "bob"]

    def test_missing_column_raises(self):
        runner = LowerCaseRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])


class TestReplaceRunner:
    def test_replace_all(self):
        runner = ReplaceRunner()
        df = pd.DataFrame({"text": ["hello world", "foo bar foo"]})
        result = runner.execute(df, "text", {"old": "foo", "new": "baz"}, ["replaced"])
        assert result["replaced"].tolist() == ["hello world", "baz bar baz"]

    def test_replace_limited(self):
        runner = ReplaceRunner()
        df = pd.DataFrame({"text": ["foo bar foo"]})
        result = runner.execute(df, "text", {"old": "foo", "new": "baz", "count": 1}, ["replaced"])
        assert result["replaced"][0] == "baz bar foo"

    def test_missing_column_raises(self):
        runner = ReplaceRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {"old": "a"}, ["x"])

    def test_empty_output_raises(self):
        runner = ReplaceRunner()
        df = pd.DataFrame({"a": ["x"]})
        with pytest.raises(ValueError, match="需要至少一个 output_columns"):
            runner.execute(df, "a", {"old": "x"}, [])


class TestSubstringRunner:
    def test_start_only(self):
        runner = SubstringRunner()
        df = pd.DataFrame({"text": ["hello world"]})
        result = runner.execute(df, "text", {"start": 6}, ["sub"])
        assert result["sub"][0] == "world"

    def test_start_and_length(self):
        runner = SubstringRunner()
        df = pd.DataFrame({"text": ["hello world"]})
        result = runner.execute(df, "text", {"start": 0, "length": 5}, ["sub"])
        assert result["sub"][0] == "hello"

    def test_start_and_end(self):
        runner = SubstringRunner()
        df = pd.DataFrame({"text": ["hello world"]})
        result = runner.execute(df, "text", {"start": 0, "end": 5}, ["sub"])
        assert result["sub"][0] == "hello"

    def test_missing_column_raises(self):
        runner = SubstringRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])


class TestConcatRunner:
    def test_basic_concat(self):
        runner = ConcatRunner()
        df = pd.DataFrame({"first": ["John"], "last": ["Doe"]})
        result = runner.execute(df, "first", {"columns": "first,last", "separator": " "}, ["full"])
        assert result["full"][0] == "John Doe"

    def test_columns_as_list(self):
        """前端 TagsRenderer 产出数组格式，后端必须兼容"""
        runner = ConcatRunner()
        df = pd.DataFrame({"first": ["John"], "last": ["Doe"]})
        result = runner.execute(df, "first", {"columns": ["first", "last"], "separator": " "}, ["full"])
        assert result["full"][0] == "John Doe"

    def test_columns_as_list_single(self):
        runner = ConcatRunner()
        df = pd.DataFrame({"name": ["John"]})
        result = runner.execute(df, "name", {"columns": ["name"]}, ["out"])
        assert result["out"][0] == "John"

    def test_single_column(self):
        runner = ConcatRunner()
        df = pd.DataFrame({"name": ["John"]})
        result = runner.execute(df, "name", {"columns": "name"}, ["out"])
        assert result["out"][0] == "John"

    def test_missing_column_raises(self):
        runner = ConcatRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="列不存在"):
            runner.execute(df, "a", {"columns": "a,b"}, ["x"])

    def test_empty_columns_raises(self):
        runner = ConcatRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要 columns 参数"):
            runner.execute(df, "a", {}, ["x"])

    def test_output_column_param(self):
        runner = ConcatRunner()
        df = pd.DataFrame({"a": ["1"], "b": ["2"]})
        result = runner.execute(df, "a", {"columns": "a,b", "output_column": "custom"}, [])
        assert result["custom"][0] == "12"
