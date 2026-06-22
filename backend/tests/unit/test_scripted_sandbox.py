"""
Scripted 约束沙箱安全测试

测试 simpleeval 沙箱对各类攻击向量的防御能力。
simpleeval 1.0.7 + SimpleEval 配置（非 EvalWithCompoundTypes）。
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.shared.domain.constraints.scripted import ScriptedConstraint


@pytest.fixture
def sample_df():
    return pd.DataFrame(
        {
            "name": ["Alice", "Bob", "Charlie"],
            "age": [30, 25, 35],
            "email": ["alice@test.com", "bob@test.com", "charlie@test.com"],
        }
    )


@pytest.fixture
def datasets(sample_df):
    return {"users": sample_df}


@pytest.fixture
def make_constraint():
    def _make(expression: str, column: str | None = None, table: str = "users"):
        return ScriptedConstraint(table=table, name="test_rule", expression=expression, column=column)

    return _make


class TestSandboxIntrospection:
    """测试内省链攻击防御"""

    def test_dunder_class_chain(self, make_constraint, datasets):
        c = make_constraint("().__class__.__bases__[0].__subclasses__()")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_dunder_bases(self, make_constraint, datasets):
        c = make_constraint("int.__bases__")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_dunder_subclasses(self, make_constraint, datasets):
        c = make_constraint("str.__subclasses__()")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_dunder_class_on_value(self, make_constraint, datasets):
        c = make_constraint("value.__class__", column="name")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_dunder_class_on_bool(self, make_constraint, datasets):
        c = make_constraint("True.__class__")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])


class TestSandboxImport:
    """测试导入绕过防御"""

    def test_import_os(self, make_constraint, datasets):
        c = make_constraint("__import__('os').system('echo pwned')")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_import_sys(self, make_constraint, datasets):
        c = make_constraint("__import__('sys').modules")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])


class TestSandboxBuiltinBypass:
    """测试内置函数绕过防御"""

    def test_getattr(self, make_constraint, datasets):
        c = make_constraint("getattr(value, '__class__')", column="name")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_type(self, make_constraint, datasets):
        c = make_constraint("type(value)", column="name")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_eval(self, make_constraint, datasets):
        c = make_constraint("eval('1+1')")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_exec(self, make_constraint, datasets):
        c = make_constraint("exec('x=1')")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_globals(self, make_constraint, datasets):
        c = make_constraint("globals()")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_locals(self, make_constraint, datasets):
        c = make_constraint("locals()")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_open(self, make_constraint, datasets):
        c = make_constraint("open('/etc/passwd')")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_compile(self, make_constraint, datasets):
        c = make_constraint("compile('1+1', '<string>', 'eval')")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_isinstance(self, make_constraint, datasets):
        c = make_constraint("isinstance(value, str)", column="name")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_repr(self, make_constraint, datasets):
        c = make_constraint("repr(value)", column="name")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])


class TestSandboxAttributeAccess:
    """测试属性访问防御"""

    def test_format_blocked(self, make_constraint, datasets):
        c = make_constraint("'{0}'.format(1)")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_mro_blocked(self, make_constraint, datasets):
        c = make_constraint("int.__mro__")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_builtins_blocked(self, make_constraint, datasets):
        c = make_constraint("__builtins__")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])


class TestSandboxSyntaxRestrictions:
    """测试语法限制"""

    def test_lambda_blocked(self, make_constraint, datasets):
        c = make_constraint("(lambda x: x + 1)(5)")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_list_comprehension_blocked(self, make_constraint, datasets):
        c = make_constraint("[x for x in range(10)]")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_dict_comprehension_blocked(self, make_constraint, datasets):
        c = make_constraint("{k: v for k, v in [(1, 2)]}")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_walrus_blocked(self, make_constraint, datasets):
        c = make_constraint("(x := 42)")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_tuple_literal_blocked(self, make_constraint, datasets):
        c = make_constraint("(1, 2, 3)")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_set_literal_blocked(self, make_constraint, datasets):
        c = make_constraint("{1, 2, 3}")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])

    def test_dict_literal_blocked(self, make_constraint, datasets):
        c = make_constraint("{'a': 1}")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckExecutionError" for e in result["errors"])


class TestSandboxAllowedOperations:
    """测试允许的安全操作（不应被误封）"""

    def test_basic_comparison(self, make_constraint, datasets):
        c = make_constraint("value > 0", column="age")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert result["errors"] == []

    def test_string_methods(self, make_constraint, datasets):
        c = make_constraint("value.lower() == 'alice'", column="name")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert len([e for e in result["errors"] if e["error_type"] != "BusinessLogicViolation"]) == 0

    def test_re_match(self, make_constraint, datasets):
        c = make_constraint(r"re_match(r'^[a-z]+@.*\.com$', str(value))", column="email")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert result["errors"] == []

    def test_len_function(self, make_constraint, datasets):
        c = make_constraint("len(str(value)) > 0", column="name")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert result["errors"] == []

    def test_row_dict_access(self, make_constraint, datasets):
        c = make_constraint("row['age'] > 0")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert result["errors"] == []

    def test_boolean_logic(self, make_constraint, datasets):
        c = make_constraint("value > 0 and value < 100", column="age")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert result["errors"] == []

    def test_ternary(self, make_constraint, datasets):
        c = make_constraint("'yes' if value > 0 else 'no'", column="age")
        result = c.validate(datasets, allow_unsafe_eval=True)
        assert all(e["error_type"] == "ScriptCheckDefinitionError" for e in result["errors"])

    def test_fstring(self, make_constraint, datasets):
        c = make_constraint("f'name is {value}' == 'name is Alice'", column="name")
        result = c.validate(datasets, allow_unsafe_eval=True)
        # f-string 比较返回 bool，只有非 Alice 行是 BusinessLogicViolation
        biz_errors = [e for e in result["errors"] if e["error_type"] == "BusinessLogicViolation"]
        assert len(biz_errors) == 2  # Bob 和 Charlie


class TestSandboxRowMutation:
    """测试行数据变异（低风险，但应知晓）"""

    def test_row_pop_allowed_but_isolated(self, make_constraint, datasets):
        """row.pop() 可以修改当行的 dict 副本，但不影响其他行或原始 DataFrame"""
        c = make_constraint("row.pop('age') is not None")
        result = c.validate(datasets, allow_unsafe_eval=True)
        # pop 返回被删除的值（truthy），所以表达式返回 True（bool）
        # 但 row dict 变异只影响当前迭代的副本，不影响 DataFrame
        execution_errors = [e for e in result["errors"] if e["error_type"] == "ScriptCheckExecutionError"]
        assert len(execution_errors) == 0  # 不应报执行错误

    def test_row_get_is_safe(self, make_constraint, datasets):
        c = make_constraint("row.get('name') == 'Alice'")
        result = c.validate(datasets, allow_unsafe_eval=True)
        # 第一行 Alice 应通过，其他行应失败（BusinessLogicViolation）
        biz_errors = [e for e in result["errors"] if e["error_type"] == "BusinessLogicViolation"]
        assert len(biz_errors) == 2  # Bob 和 Charlie 失败


class TestSandboxPermissionCheck:
    """测试 allow_unsafe_eval 权限控制"""

    def test_requires_allow_unsafe_eval(self, make_constraint, datasets):
        c = make_constraint("value > 0", column="age")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "PermissionError"

    def test_rejects_numpy_bool(self, make_constraint, datasets):
        """安全加固：is True 严格检查，防止 numpy bool 绕过"""
        import numpy as np

        c = make_constraint("value > 0", column="age")
        result = c.validate(datasets, allow_unsafe_eval=np.bool_(True))
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "PermissionError"
