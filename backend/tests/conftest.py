"""pytest 共享 fixtures 和配置"""

import os
import sys

# 添加项目根目录到 Python 路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import pandas as pd
import pytest


@pytest.fixture(autouse=True)
def _enable_scripted_eval_for_tests(monkeypatch):
    """B-sec6: 测试环境默认开启 scripted 约束的服务端总开关。

    生产代码中 PRECIS_ALLOW_UNSAFE_EVAL 默认关闭（scripted 约束不可执行），
    但大量 scripted 约束/沙箱测试本身就需要执行表达式来验证逻辑。
    此 fixture 在测试环境统一开启，使既有 scripted 测试无需逐个声明。
    需要显式测试"关闭"语义的用例（如 test_executor_script_security.TestScriptedServerGate）
    用自己的 monkeypatch 覆盖本 fixture 的设置。
    """
    from app.shared.domain.constraints import scripted as scripted_mod

    monkeypatch.setenv("PRECIS_ALLOW_UNSAFE_EVAL", "true")
    monkeypatch.setattr(
        scripted_mod,
        "_SERVER_ALLOW_UNSAFE_EVAL",
        scripted_mod._resolve_server_allow_unsafe_eval(),
    )


@pytest.fixture
def sample_project_config():
    """示例项目配置 fixture"""
    return {
        "version": 2,
        "project": {
            "id": "test-project",
            "name": "Test Project",
        },
        "schemas": [],
        "constraints": [],
    }


@pytest.fixture
def empty_datasets():
    """空数据集 fixture"""
    return {}


@pytest.fixture
def users_dataset():
    """用户表示例数据集"""
    return {
        "users": pd.DataFrame(
            {
                "id": [1, 2, 3, 4],
                "username": ["alice", "bob", "charlie", "alice"],
                "email": ["a@test.com", "b@test.com", "c@test.com", "a@test.com"],
                "age": [25, 30, 35, 40],
                "score": [85.5, 92.0, 78.5, 88.0],
            }
        )
    }


@pytest.fixture
def products_dataset():
    """产品表示例数据集（含价格列）"""
    return {
        "products": pd.DataFrame(
            {
                "id": [1, 2, 3, 4],
                "name": ["Apple", "Banana", "Cherry", "Date"],
                "price": [10.5, 25.0, 5.99, 150.0],
                "quantity": [100, 50, 200, 10],
            }
        )
    }
