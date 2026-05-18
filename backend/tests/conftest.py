"""pytest 共享 fixtures 和配置"""

import os
import sys

# 添加项目根目录到 Python 路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import pandas as pd
import pytest


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
