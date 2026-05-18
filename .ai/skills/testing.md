---
name: "testing"
description: "Precis 测试开发规范。适用于 backend/tests/ 下的单元测试、集成测试，以及前端测试策略。"
scope: ["backend/tests/**/*.py", "frontend/tests/**/*.{ts,vue}"]
---

# Precis 测试开发规范

## 适用范围

- Python 后端单元测试（pytest）
- Python 后端集成测试（API 测试）
- 前端单元/组件测试（Vitest / Vue Test Utils）
- 测试 fixtures 与共享工具

## 后端测试目录结构

```
backend/tests/
├── conftest.py              # 全局 fixtures 与配置
├── integration/             # 集成测试
│   └── test_api_health.py
└── unit/                    # 单元测试
    ├── test_allowed_values_constraint.py
    ├── test_conditional_constraint.py
    ├── test_data_engine.py
    └── ...
```

## 测试文件命名

| 类型 | 命名规范 | 示例 |
|------|---------|------|
| 单元测试 | `test_<模块名>.py` | `test_data_engine.py` |
| 集成测试 | `test_api_<资源>.py` | `test_api_health.py` |
| 测试类 | `Test<被测类名>` | `TestValidationEngine` |
| 测试方法 | `test_<场景>_<预期结果>` | `test_unique_constraint_finds_duplicates` |

## pytest 规范

### 基本结构

```python
import pytest
from app.shared.domain.data_engine import DataEngine
from app.shared.domain.constraints.unique import UniqueValidator

class TestUniqueValidator:
    """唯一性约束校验器测试"""
    
    def test_validate_finds_duplicates(self):
        """校验器应能发现重复值"""
        # Arrange
        validator = UniqueValidator()
        data = pd.DataFrame({
            "email": ["a@example.com", "b@example.com", "a@example.com"]
        })
        context = ValidationContext(data=data, constraint=...)
        
        # Act
        result = validator.validate(context, params={})
        
        # Assert
        assert not result.success
        assert len(result.errors) == 2
        assert result.errors[0]["row_index"] == 0
    
    def test_validate_passes_for_unique_values(self):
        """唯一值应通过校验"""
        validator = UniqueValidator()
        data = pd.DataFrame({
            "email": ["a@example.com", "b@example.com", "c@example.com"]
        })
        context = ValidationContext(data=data, constraint=...)
        
        result = validator.validate(context, params={})
        
        assert result.success
        assert result.errors == []
```

### Fixtures 使用

在 `conftest.py` 中定义共享 fixtures：

```python
import pytest
from fastapi.testclient import TestClient
from app.api.main import app

@pytest.fixture
def client():
    """FastAPI 测试客户端"""
    return TestClient(app)

@pytest.fixture
def sample_project_manifest():
    """标准项目清单 fixture"""
    return {
        "version": 2,
        "project": {
            "id": "test-project",
            "name": "Test Project"
        },
        "schemas": [],
        "constraints": []
    }

@pytest.fixture
def temp_data_dir(tmp_path):
    """临时数据目录"""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    return str(data_dir)
```

### Mock 与 Patch

```python
from unittest.mock import patch, MagicMock

class TestAIService:
    """AI 服务测试"""
    
    @patch("app.shared.services.llm.providers.openai.httpx.AsyncClient")
    async def test_chat_uses_configured_model(self, mock_client):
        """聊天应使用配置的模型"""
        # 配置 mock
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Hello"}}]
        }
        mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
        
        provider = OpenAICompatibleProvider(config=...)
        result = await provider.chat([ChatMessage(role="user", content="Hi")])
        
        assert result.message.content == "Hello"
```

## 集成测试规范

```python
class TestAPIHealth:
    """API 健康检查集成测试"""
    
    def test_health_endpoint_returns_200(self, client):
        """健康检查端点应返回 200"""
        response = client.get("/health")
        
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
    
    def test_api_v2_projects_crud(self, client, sample_project_manifest):
        """项目 CRUD 流程测试"""
        # Create
        response = client.post("/api/v2/projects", json=sample_project_manifest)
        assert response.status_code == 201
        project_id = response.json()["id"]
        
        # Read
        response = client.get(f"/api/v2/projects/{project_id}")
        assert response.status_code == 200
        
        # Update
        response = client.put(f"/api/v2/projects/{project_id}", json={...})
        assert response.status_code == 200
        
        # Delete
        response = client.delete(f"/api/v2/projects/{project_id}")
        assert response.status_code == 204
```

## 测试数据构造

优先使用工厂模式或 fixture 构造测试数据：

```python
class ConstraintFactory:
    """测试用的约束工厂"""
    
    @staticmethod
    def unique_constraint(table_id: str = "users", column_ids: list[str] = None):
        return {
            "version": 2,
            "id": "unique_test",
            "type": "Unique",
            "enabled": True,
            "refs": {
                "table_id": table_id,
                "column_ids": column_ids or ["email"]
            },
            "params": {}
        }
    
    @staticmethod
    def range_constraint(table_id: str = "products", column_id: str = "price", min_val: int = 0, max_val: int = 10000):
        return {
            "version": 2,
            "id": "range_test",
            "type": "Range",
            "enabled": True,
            "refs": {
                "table_id": table_id,
                "column_id": column_id
            },
            "params": {
                "min": min_val,
                "max": max_val
            }
        }
```

## 覆盖率要求

- 单元测试覆盖率目标：**≥ 80%**
- 核心校验引擎（validators）覆盖率目标：**≥ 90%**
- 集成测试覆盖主要 API 路径

运行测试命令：
```bash
cd backend
pytest --cov=app --cov-report=html --cov-report=term-missing
```

## 前端测试规范（Vitest）

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NodeCanvas from '@/components/canvas/NodeCanvas.vue'

describe('NodeCanvas', () => {
  it('renders toolbar when visible', () => {
    const wrapper = mount(NodeCanvas, {
      props: { visible: true }
    })
    expect(wrapper.find('.canvas-toolbar').exists()).toBe(true)
  })

  it('emits save event on Ctrl+S', async () => {
    const wrapper = mount(NodeCanvas)
    await wrapper.trigger('keydown', { key: 's', ctrlKey: true })
    expect(wrapper.emitted('save')).toBeTruthy()
  })
})
```

## 测试原则

1. **独立性**：每个测试应独立运行，不依赖其他测试的执行顺序
2. **可重复性**：测试应在任何环境下产生相同结果
3. **快速反馈**：单元测试应在毫秒级完成
4. **描述清晰**：测试名应描述场景和预期结果，而非被测方法名
5. **Arrange-Act-Assert**：保持三段式结构
