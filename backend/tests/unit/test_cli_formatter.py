"""
@fileoverview CLI formatter 和其他模块覆盖补充测试

测试范围:
- Formatter: 颜色输出、格式化方法
- Spinner: 加载动画
- _supports_unicode: Unicode 检测
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


from app.shared.services.llm.yaml_io import FileLock, YamlUpdateError


class TestFormatter:
    def test_colorize(self):
        from app.cli.shell.formatter import Colors, Formatter

        result = Formatter.colorize("hello", Colors.RED)
        assert "hello" in result
        assert Colors.RED in result
        assert Colors.RESET in result

    def test_success(self):
        from app.cli.shell.formatter import Colors, Formatter

        result = Formatter.success("done")
        assert "done" in result
        assert Colors.GREEN in result

    def test_error(self):
        from app.cli.shell.formatter import Colors, Formatter

        result = Formatter.error("fail")
        assert "fail" in result
        assert Colors.RED in result

    def test_warning(self):
        from app.cli.shell.formatter import Colors, Formatter

        result = Formatter.warning("warn")
        assert "warn" in result
        assert Colors.YELLOW in result

    def test_info(self):
        from app.cli.shell.formatter import Colors, Formatter

        result = Formatter.info("info")
        assert "info" in result
        assert Colors.CYAN in result

    def test_header(self):
        from app.cli.shell.formatter import Colors, Formatter

        result = Formatter.header("title")
        assert "title" in result
        assert Colors.BOLD in result

    def test_dim(self):
        from app.cli.shell.formatter import Colors, Formatter

        result = Formatter.dim("text")
        assert "text" in result
        assert Colors.DIM in result

    def test_print_header(self, capsys):
        from app.cli.shell.formatter import Formatter

        Formatter.print_header("Test Header", width=30)
        captured = capsys.readouterr()
        assert "Test Header" in captured.out

    def test_print_welcome(self, capsys):
        from app.cli.shell.formatter import Formatter

        Formatter.print_welcome()
        captured = capsys.readouterr()
        # Welcome message should produce some output
        assert len(captured.out) > 0

    def test_format_validation_result_empty(self):
        from app.cli.shell.formatter import Formatter

        result = Formatter.format_validation_result([])
        assert isinstance(result, str)
        assert "通过" in result or "OK" in result

    def test_format_validation_result_with_errors(self):
        from app.cli.shell.formatter import Formatter

        errors = [
            {
                "error_type": "NotNullViolation",
                "message": "null value",
                "table": "users",
                "column": "email",
                "row_index": 1,
                "value": None,
            },
            {
                "error_type": "UniqueViolation",
                "message": "duplicate",
                "table": "users",
                "column": "id",
                "row_index": 5,
                "value": "dup",
            },
        ]
        result = Formatter.format_validation_result(errors, detailed=True)
        assert isinstance(result, str)
        assert "2" in result  # 2 errors

    def test_format_validation_result_no_detail(self):
        from app.cli.shell.formatter import Formatter

        errors = [{"error_type": "TestError", "message": "test"}]
        result = Formatter.format_validation_result(errors, detailed=False)
        assert isinstance(result, str)

    # ------------------------------------------------------------------
    # format_validation_summary：校验摘要（证明 validate 确实执行了检查）
    # ------------------------------------------------------------------

    def test_format_validation_summary_all_passed(self):
        """全部通过时应展示表/行数、约束数与各项 ✓。"""
        from app.cli.shell.formatter import Formatter

        class _DF(list):
            """模拟 pandas DataFrame 的 len() 行为。"""

        details = {
            "format_checks": [
                {"table": "users", "source_file": "data/users.csv"},
                {"table": "orders", "source_file": "data/orders.csv"},
            ],
            "constraint_checks": [
                {
                    "constraint_type": "NotNullConstraint",
                    "table": "users",
                    "description": "非空约束: users.email",
                    "error_count": 0,
                    "passed": True,
                },
                {
                    "constraint_type": "UniqueConstraint",
                    "table": "users",
                    "description": "唯一性约束: users.email",
                    "error_count": 0,
                    "passed": True,
                },
            ],
        }
        # 用 _DF 模拟 DataFrame，len() 返回 5
        raw = {"users": _DF([1, 2, 3, 4, 5]), "orders": _DF([1, 2, 3, 4, 5])}

        result = Formatter.format_validation_summary(details, raw)
        assert isinstance(result, str)
        # 表与行数
        assert "2 个" in result
        assert "users: 5 行" in result
        assert "data/users.csv" in result
        # 约束统计
        assert "2 项" in result
        assert "全部通过" in result
        # 逐项约束标签出现
        assert "非空约束: users.email" in result
        assert "唯一性约束: users.email" in result

    def test_format_validation_summary_with_failures(self):
        """有失败项时应展示「N 通过 / M 失败」并标注每项错误数。"""
        from app.cli.shell.formatter import Formatter

        details = {
            "format_checks": [{"table": "users"}],
            "constraint_checks": [
                {
                    "constraint_type": "NotNullConstraint",
                    "table": "users",
                    "description": "非空约束: users.email",
                    "error_count": 0,
                    "passed": True,
                },
                {
                    "constraint_type": "RangeConstraint",
                    "table": "users",
                    "description": "区间约束: users.age",
                    "error_count": 2,
                    "passed": False,
                },
            ],
        }

        result = Formatter.format_validation_summary(details, None)
        assert "1 通过 / 1 失败" in result
        # 失败项应显示错误数
        assert "2 错误" in result

    def test_format_validation_summary_empty_details(self):
        """validation_details 为空时应返回兜底提示，而非崩溃。"""
        from app.cli.shell.formatter import Formatter

        result = Formatter.format_validation_summary(None, None)
        assert isinstance(result, str)
        assert "未返回校验明细" in result

    def test_format_validation_summary_missing_rows(self):
        """raw_datasets 缺少某表时，行数降级显示为 '-'。"""
        from app.cli.shell.formatter import Formatter

        details = {
            "format_checks": [{"table": "users", "source_file": "data/users.csv"}],
            "constraint_checks": [],
        }
        # raw_datasets 不含 users 键
        result = Formatter.format_validation_summary(details, {})
        assert "users: - 行" in result

    def test_print_table(self, capsys):
        from app.cli.shell.formatter import Formatter

        Formatter.print_table(["Name", "Age"], [["Alice", "30"], ["Bob", "25"]])
        captured = capsys.readouterr()
        assert "Alice" in captured.out
        assert "Bob" in captured.out

    def test_print_table_empty(self, capsys):
        from app.cli.shell.formatter import Formatter

        Formatter.print_table(["A", "B"], [])
        captured = capsys.readouterr()
        # Should still print headers
        assert "A" in captured.out

    def test_format_project_info(self):
        from app.cli.shell.formatter import Formatter

        info = {
            "name": "Test Project",
            "version": "2",
            "schemas": [{"name": "users"}],
            "constraints": [{"type": "NotNull"}],
        }
        result = Formatter.format_project_info(info)
        assert isinstance(result, str)

    def test_print_error(self, capsys):
        from app.cli.shell.formatter import Formatter

        Formatter.print_error("something went wrong")
        captured = capsys.readouterr()
        assert "something went wrong" in captured.err

    def test_print_warning(self, capsys):
        from app.cli.shell.formatter import Formatter

        Formatter.print_warning("be careful")
        captured = capsys.readouterr()
        assert "be careful" in captured.out

    def test_print_success(self, capsys):
        from app.cli.shell.formatter import Formatter

        Formatter.print_success("all good")
        captured = capsys.readouterr()
        assert "all good" in captured.out

    def test_print_info(self, capsys):
        from app.cli.shell.formatter import Formatter

        Formatter.print_info("fyi")
        captured = capsys.readouterr()
        assert "fyi" in captured.out


class TestSpinner:
    def test_init(self):
        from app.cli.shell.formatter import Spinner

        s = Spinner("Loading")
        assert s.message == "Loading"

    def test_start_stop(self):
        from app.cli.shell.formatter import Spinner

        s = Spinner("test")
        s.start()
        import time

        time.sleep(0.2)
        s.stop(success=True)

    def test_stop_error(self):
        from app.cli.shell.formatter import Spinner

        s = Spinner("test")
        s.start()
        import time

        time.sleep(0.2)
        s.stop(success=False)


class TestSupportsUnicode:
    def test_returns_bool(self):
        from app.cli.shell.formatter import _supports_unicode

        result = _supports_unicode()
        assert isinstance(result, bool)


class TestFileLock:
    def test_init(self, tmp_path):
        lock_file = tmp_path / "test.lock"
        lock_file.write_text("")
        fl = FileLock(str(lock_file), timeout=1.0)
        assert fl.file_path == str(lock_file)
        assert fl.timeout == 1.0

    def test_context_manager(self, tmp_path):
        lock_file = tmp_path / "test.lock"
        lock_file.write_text("data")
        fl = FileLock(str(lock_file), timeout=1.0)
        with fl:
            pass  # Should not raise


class TestYamlUpdateErrorException:
    def test_creation(self):
        e = YamlUpdateError("test msg")
        assert str(e) == "test msg"
        assert isinstance(e, Exception)
