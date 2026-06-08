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
            {"error_type": "NotNullViolation", "message": "null value", "table": "users", "column": "email", "row_index": 1, "value": None},
            {"error_type": "UniqueViolation", "message": "duplicate", "table": "users", "column": "id", "row_index": 5, "value": "dup"},
        ]
        result = Formatter.format_validation_result(errors, detailed=True)
        assert isinstance(result, str)
        assert "2" in result  # 2 errors

    def test_format_validation_result_no_detail(self):
        from app.cli.shell.formatter import Formatter

        errors = [{"error_type": "TestError", "message": "test"}]
        result = Formatter.format_validation_result(errors, detailed=False)
        assert isinstance(result, str)

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
