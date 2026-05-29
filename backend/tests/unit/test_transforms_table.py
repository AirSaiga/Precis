"""测试表格操作相关 Transform 运行器"""

from __future__ import annotations

import pandas as pd
import pytest

from app.shared.domain.transforms.aggregate import AggregateRunner
from app.shared.domain.transforms.conditional_assign import ConditionalAssignRunner
from app.shared.domain.transforms.date_format import DateFormatRunner
from app.shared.domain.transforms.drop_duplicates import DropDuplicatesRunner
from app.shared.domain.transforms.filter_rows import FilterRowsRunner
from app.shared.domain.transforms.lookup import LookupRunner
from app.shared.domain.transforms.sort_rows import SortRowsRunner


class TestSortRowsRunner:
    def test_single_column_asc(self):
        runner = SortRowsRunner()
        df = pd.DataFrame({"a": [3, 1, 2], "b": ["x", "y", "z"]})
        result = runner.execute(df, "a", {"sort_by": [{"column": "a", "order": "asc"}]}, [])
        assert result["a"].tolist() == [1, 2, 3]

    def test_single_column_desc(self):
        runner = SortRowsRunner()
        df = pd.DataFrame({"a": [3, 1, 2]})
        result = runner.execute(df, "a", {"sort_by": [{"column": "a", "order": "desc"}]}, [])
        assert result["a"].tolist() == [3, 2, 1]

    def test_multi_column_sort(self):
        runner = SortRowsRunner()
        df = pd.DataFrame({"a": [2, 1, 2], "b": ["z", "y", "x"]})
        result = runner.execute(
            df, "a", {"sort_by": [{"column": "a", "order": "asc"}, {"column": "b", "order": "asc"}]}, []
        )
        assert result["b"].tolist() == ["y", "x", "z"]

    def test_empty_sort_by(self):
        runner = SortRowsRunner()
        df = pd.DataFrame({"a": [3, 1, 2]})
        result = runner.execute(df, "a", {"sort_by": []}, [])
        assert result["a"].tolist() == [3, 1, 2]

    def test_missing_sort_column_raises(self):
        runner = SortRowsRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="排序列不存在"):
            runner.execute(df, "a", {"sort_by": [{"column": "missing"}]}, [])


class TestFilterRowsRunner:
    def test_eq_filter(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"status": ["active", "inactive", "active"]})
        result = runner.execute(df, "status", {"conditions": [{"column": "status", "op": "eq", "value": "active"}]}, [])
        assert len(result) == 2
        assert result["status"].tolist() == ["active", "active"]

    def test_gt_filter(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"age": [20, 30, 40]})
        result = runner.execute(df, "age", {"conditions": [{"column": "age", "op": "gt", "value": 25}]}, [])
        assert result["age"].tolist() == [30, 40]

    def test_contains_filter(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"name": ["Alice", "Bob", "Charlie"]})
        result = runner.execute(df, "name", {"conditions": [{"column": "name", "op": "contains", "value": "li"}]}, [])
        assert result["name"].tolist() == ["Alice", "Charlie"]

    def test_is_null_filter(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"value": [1, None, 3]})
        result = runner.execute(df, "value", {"conditions": [{"column": "value", "op": "is_null"}]}, [])
        assert len(result) == 1
        assert pd.isna(result["value"].iloc[0])

    def test_is_not_null_filter(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"value": [1, None, 3]})
        result = runner.execute(df, "value", {"conditions": [{"column": "value", "op": "is_not_null"}]}, [])
        assert result["value"].tolist() == [1, 3]

    def test_in_filter(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"type": ["a", "b", "c"]})
        result = runner.execute(df, "type", {"conditions": [{"column": "type", "op": "in", "value": ["a", "c"]}]}, [])
        assert result["type"].tolist() == ["a", "c"]

    def test_not_in_filter(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"type": ["a", "b", "c"]})
        result = runner.execute(
            df, "type", {"conditions": [{"column": "type", "op": "not_in", "value": ["a", "c"]}]}, []
        )
        assert result["type"].tolist() == ["b"]

    def test_and_logic(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"age": [20, 30, 40], "status": ["active", "active", "inactive"]})
        result = runner.execute(
            df,
            "age",
            {
                "conditions": [
                    {"column": "age", "op": "gt", "value": 25},
                    {"column": "status", "op": "eq", "value": "active"},
                ],
                "logic": "and",
            },
            [],
        )
        assert result["age"].tolist() == [30]

    def test_or_logic(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"age": [20, 30, 40]})
        result = runner.execute(
            df,
            "age",
            {
                "conditions": [
                    {"column": "age", "op": "lt", "value": 25},
                    {"column": "age", "op": "gt", "value": 35},
                ],
                "logic": "or",
            },
            [],
        )
        assert result["age"].tolist() == [20, 40]

    def test_no_conditions_returns_all(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"a": [1, 2, 3]})
        result = runner.execute(df, "a", {"conditions": []}, [])
        assert len(result) == 3

    def test_missing_column_in_condition(self):
        runner = FilterRowsRunner()
        df = pd.DataFrame({"a": [1, 2]})
        result = runner.execute(df, "a", {"conditions": [{"column": "missing", "op": "eq", "value": "x"}]}, [])
        assert len(result) == 0


class TestDropDuplicatesRunner:
    def test_keep_first(self):
        runner = DropDuplicatesRunner()
        df = pd.DataFrame({"a": [1, 1, 2], "b": ["x", "x", "y"]})
        result = runner.execute(df, "a", {"subset": "a", "keep": "first"}, [])
        assert len(result) == 2
        assert result["a"].tolist() == [1, 2]

    def test_keep_false(self):
        runner = DropDuplicatesRunner()
        df = pd.DataFrame({"a": [1, 1, 2]})
        result = runner.execute(df, "a", {"subset": "a", "keep": "false"}, [])
        assert len(result) == 1
        assert result["a"].tolist() == [2]

    def test_keep_last(self):
        runner = DropDuplicatesRunner()
        df = pd.DataFrame({"a": [1, 1, 2]})
        result = runner.execute(df, "a", {"subset": "a", "keep": "last"}, [])
        assert result["a"].tolist() == [1, 2]

    def test_empty_subset(self):
        runner = DropDuplicatesRunner()
        df = pd.DataFrame({"a": [1, 1, 2], "b": ["x", "x", "y"]})
        result = runner.execute(df, "a", {"subset": ""}, [])
        assert len(result) == 2

    def test_subset_with_nonexistent_columns(self):
        runner = DropDuplicatesRunner()
        df = pd.DataFrame({"a": [1, 1, 2]})
        result = runner.execute(df, "a", {"subset": "a,missing"}, [])
        assert len(result) == 2


class TestAggregateRunner:
    def test_group_by_sum(self):
        runner = AggregateRunner()
        df = pd.DataFrame({"group": ["a", "a", "b"], "value": [1, 2, 3]})
        result = runner.execute(
            df,
            "value",
            {
                "aggregations": [{"column": "value", "func": "sum"}],
                "group_by": "group",
            },
            ["total"],
        )
        assert len(result) == 2
        assert result["total"].sum() == 6

    def test_group_by_count(self):
        runner = AggregateRunner()
        df = pd.DataFrame({"group": ["a", "a", "b"], "value": [1, 2, None]})
        result = runner.execute(
            df,
            "value",
            {
                "aggregations": [{"column": "value", "func": "count"}],
                "group_by": "group",
            },
            ["cnt"],
        )
        assert len(result) == 2

    def test_group_by_avg_min_max(self):
        runner = AggregateRunner()
        df = pd.DataFrame({"group": ["x", "x", "x"], "a": [10, 20, 30]})
        result = runner.execute(
            df,
            "a",
            {
                "aggregations": [
                    {"column": "a", "func": "avg"},
                    {"column": "a", "func": "min"},
                    {"column": "a", "func": "max"},
                ],
                "group_by": "group",
            },
            ["avg", "min", "max"],
        )
        assert result["avg"][0] == 20.0
        assert result["min"][0] == 10
        assert result["max"][0] == 30

    def test_group_by(self):
        runner = AggregateRunner()
        df = pd.DataFrame({"group": ["a", "a", "b"], "value": [1, 2, 3]})
        result = runner.execute(
            df,
            "value",
            {
                "aggregations": [{"column": "value", "func": "sum"}],
                "group_by": "group",
            },
            ["total"],
        )
        assert len(result) == 2

    def test_missing_aggregations_raises(self):
        runner = AggregateRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要至少一个 aggregation"):
            runner.execute(df, "a", {}, [])

    def test_missing_column_raises(self):
        runner = AggregateRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="聚合列不存在"):
            runner.execute(df, "a", {"aggregations": [{"column": "missing", "func": "sum"}]}, [])


class TestLookupRunner:
    def test_basic_lookup(self):
        runner = LookupRunner()
        df = pd.DataFrame({"code": ["A", "B", "C"]})
        result = runner.execute(df, "code", {"mapping": {"A": "Alpha", "B": "Beta"}}, ["name"])
        assert result["name"][0] == "Alpha"
        assert result["name"][1] == "Beta"
        assert pd.isna(result["name"][2])

    def test_lookup_with_default(self):
        runner = LookupRunner()
        df = pd.DataFrame({"code": ["A", "X"]})
        result = runner.execute(df, "code", {"mapping": {"A": "Alpha"}, "default": "Unknown"}, ["name"])
        assert result["name"].tolist() == ["Alpha", "Unknown"]

    def test_missing_column_raises(self):
        runner = LookupRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])

    def test_empty_output_raises(self):
        runner = LookupRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要至少一个 output_columns"):
            runner.execute(df, "a", {}, [])


class TestDateFormatRunner:
    def test_basic_format(self):
        runner = DateFormatRunner()
        df = pd.DataFrame({"date": ["2023-01-15"]})
        result = runner.execute(df, "date", {"input_format": "%Y-%m-%d", "output_format": "%Y/%m/%d"}, ["formatted"])
        assert result["formatted"][0] == "2023/01/15"

    def test_missing_column_raises(self):
        runner = DateFormatRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])

    def test_empty_output_raises(self):
        runner = DateFormatRunner()
        df = pd.DataFrame({"a": ["2023-01-01"]})
        with pytest.raises(ValueError, match="需要至少一个 output_columns"):
            runner.execute(df, "a", {}, [])


class TestConditionalAssignRunner:
    def test_basic_condition(self):
        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"score": [50, 80, 90]})
        result = runner.execute(
            df,
            "score",
            {
                "conditions": [{"column": "score", "op": "gte", "value": 60}],
                "then_value": "pass",
                "else_value": "fail",
            },
            ["result"],
        )
        assert result["result"].tolist() == ["fail", "pass", "pass"]

    def test_no_conditions(self):
        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"a": [1]})
        result = runner.execute(df, "a", {"then_value": "yes"}, ["result"])
        assert result["result"][0] == "yes"

    def test_and_logic(self):
        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"a": [5, 15], "b": [10, 5]})
        result = runner.execute(
            df,
            "a",
            {
                "conditions": [
                    {"column": "a", "op": "gt", "value": 10},
                    {"column": "b", "op": "lt", "value": 10},
                ],
                "then_value": "match",
                "else_value": "no",
            },
            ["result"],
        )
        assert result["result"].tolist() == ["no", "match"]

    def test_or_logic(self):
        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"a": [5, 15]})
        result = runner.execute(
            df,
            "a",
            {
                "conditions": [
                    {"column": "a", "op": "lt", "value": 10},
                    {"column": "a", "op": "gt", "value": 20},
                ],
                "logic": "or",
                "then_value": "match",
            },
            ["result"],
        )
        # 无 else_value 时保留原值
        assert result["result"].tolist() == ["match", 15]

    def test_missing_column_in_condition(self):
        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"a": [1, 2]})
        result = runner.execute(
            df,
            "a",
            {
                "conditions": [{"column": "missing", "op": "eq", "value": "x"}],
                "then_value": "yes",
            },
            ["result"],
        )
        # 条件列缺失时 combined 全 False，无 else_value 则保留 input_column
        assert result["result"].tolist() == [1, 2]

    def test_no_else_value(self):
        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"score": [50, 80]})
        result = runner.execute(
            df,
            "score",
            {
                "conditions": [{"column": "score", "op": "gte", "value": 60}],
                "then_value": "pass",
            },
            ["result"],
        )
        assert result["result"].tolist() == [50, "pass"]

    def test_empty_output_raises(self):
        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要至少一个 output_columns"):
            runner.execute(df, "a", {}, [])
