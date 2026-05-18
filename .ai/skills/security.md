---
name: "security"
description: "Precis 安全开发规范。适用于前后端的输入验证、路径安全、脚本沙箱、敏感信息处理、CORS 配置等。"
scope: ["backend/**/*.py", "frontend/**/*.ts", "electron/**/*.ts"]
---

# Precis 安全开发规范

## 适用范围

- 后端输入验证与清洗
- 文件路径安全检查
- 脚本约束沙箱执行
- 敏感信息（API Key、密钥）处理
- CORS 与请求安全
- Electron 主进程安全

## 输入验证原则

### 1. 不信任任何外部输入

所有来自客户端的数据都必须经过验证：

```python
from pydantic import BaseModel, Field, field_validator
import re

class ProjectCreateRequest(BaseModel):
    """创建项目请求"""
    
    id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        pattern=r'^[a-z0-9_-]+$'
    )
    name: str = Field(..., max_length=128)
    
    @field_validator('name')
    @classmethod
    def sanitize_name(cls, v: str) -> str:
        """清理名称中的潜在危险字符"""
        # 去除控制字符
        v = re.sub(r'[\x00-\x1f\x7f]', '', v)
        # 去除 HTML 标签
        v = re.sub(r'<[^>]+>', '', v)
        return v.strip()
```

### 2. 路径遍历防护

```python
from pathlib import Path

class PathWhitelist:
    """路径白名单校验"""
    
    def __init__(self, allowed_paths: list[str]):
        self._allowed = [Path(p).resolve() for p in allowed_paths]
    
    def is_allowed(self, target_path: str) -> bool:
        """检查路径是否在白名单内"""
        try:
            target = Path(target_path).resolve()
        except (OSError, ValueError):
            return False
        
        # 禁止路径遍历
        if '..' in target.parts:
            return False
        
        # 检查是否在允许的路径下
        for allowed in self._allowed:
            try:
                target.relative_to(allowed)
                return True
            except ValueError:
                continue
        
        return False
    
    def sanitize_path(self, path: str) -> str:
        """清理并规范化路径"""
        # 移除 null 字节
        path = path.replace('\x00', '')
        # 解析为绝对路径
        resolved = Path(path).resolve()
        return str(resolved)
```

## 脚本约束沙箱

Scripted 约束允许用户编写表达式，必须严格沙箱化：

```python
import ast
import operator
from typing import Any

class ScriptSandbox:
    """脚本执行沙箱
    
    安全限制:
    - 禁止 eval/exec
    - 禁止导入模块
    - 禁止访问文件系统/网络
    - 超时控制
    """
    
    # 允许的操作符
    ALLOWED_OPERATORS = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Eq: operator.eq,
        ast.NotEq: operator.ne,
        ast.Lt: operator.lt,
        ast.LtE: operator.le,
        ast.Gt: operator.gt,
        ast.GtE: operator.ge,
        ast.And: operator.and_,
        ast.Or: operator.or_,
    }
    
    # 允许的内置函数
    ALLOWED_NAMES = {
        'len': len,
        'abs': abs,
        'min': min,
        'max': max,
        'sum': sum,
        'round': round,
        'str': str,
        'int': int,
        'float': float,
        'bool': bool,
    }
    
    @classmethod
    def validate_expression(cls, expression: str) -> bool:
        """验证表达式是否安全"""
        try:
            tree = ast.parse(expression, mode='eval')
        except SyntaxError:
            return False
        
        for node in ast.walk(tree):
            # 禁止导入
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                return False
            
            # 禁止调用（除允许的内置函数外）
            if isinstance(node, ast.Call):
                if not isinstance(node.func, ast.Name):
                    return False
                if node.func.id not in cls.ALLOWED_NAMES:
                    return False
            
            # 禁止属性访问（防止 __import__ 等）
            if isinstance(node, ast.Attribute):
                if node.attr.startswith('_'):
                    return False
            
            # 禁止危险名称
            if isinstance(node, ast.Name):
                if node.id in ('__import__', 'eval', 'exec', 'compile', 'open'):
                    return False
        
        return True
    
    @classmethod
    def evaluate(cls, expression: str, context: dict, timeout: float = 5.0) -> Any:
        """安全执行表达式
        
        Args:
            expression: 表达式字符串
            context: 变量上下文
            timeout: 执行超时时间（秒）
            
        Returns:
            表达式执行结果
            
        Raises:
            SecurityError: 表达式不安全或执行超时
        """
        if not cls.validate_expression(expression):
            raise SecurityError("表达式包含不安全的内容")
        
        # 使用 signal 或 threading 实现超时控制
        # ...
        
        try:
            tree = ast.parse(expression, mode='eval')
            result = cls._eval_node(tree.body, context)
            return result
        except Exception as e:
            raise SecurityError(f"表达式执行失败: {e}")
    
    @classmethod
    def _eval_node(cls, node: ast.AST, context: dict) -> Any:
        """递归求值 AST 节点"""
        if isinstance(node, ast.Constant):
            return node.value
        elif isinstance(node, ast.Name):
            if node.id in context:
                return context[node.id]
            if node.id in cls.ALLOWED_NAMES:
                return cls.ALLOWED_NAMES[node.id]
            raise NameError(f"未定义的变量: {node.id}")
        elif isinstance(node, ast.BinOp):
            left = cls._eval_node(node.left, context)
            right = cls._eval_node(node.right, context)
            op_type = type(node.op)
            if op_type not in cls.ALLOWED_OPERATORS:
                raise TypeError(f"不允许的操作符: {op_type.__name__}")
            return cls.ALLOWED_OPERATORS[op_type](left, right)
        # ... 其他节点类型
        else:
            raise TypeError(f"不支持的表达式类型: {type(node).__name__}")

class SecurityError(Exception):
    """安全错误"""
    pass
```

## 敏感信息处理

### API Key 管理

```python
import os
from typing import Optional

class SecretManager:
    """密钥管理器
    
    原则:
    - 密钥不硬编码
    - 密钥不提交到版本控制
    - 密钥优先从环境变量读取
    - 支持 ${VAR_NAME} 语法引用环境变量
    """
    
    @staticmethod
    def get_secret(key: str, default: Optional[str] = None) -> Optional[str]:
        """获取密钥"""
        value = os.environ.get(key, default)
        if value and value.startswith('${') and value.endswith('}'):
            env_key = value[2:-1]
            value = os.environ.get(env_key)
        return value
    
    @staticmethod
    def mask_secret(value: str, visible_chars: int = 4) -> str:
        """脱敏显示密钥"""
        if len(value) <= visible_chars * 2:
            return '*' * len(value)
        return value[:visible_chars] + '*' * (len(value) - visible_chars * 2) + value[-visible_chars:]

# 使用示例
api_key = SecretManager.get_secret('OPENAI_API_KEY')
masked = SecretManager.mask_secret(api_key or '')
print(f"API Key: {masked}")  # 输出: sk-p...xYz1
```

### 配置文件中的环境变量引用

```yaml
# ai_providers.yaml
providers:
  - id: openai
    name: OpenAI
    type: openai
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}    # 从环境变量读取
    model: gpt-4
```

## CORS 配置

```python
from fastapi.middleware.cors import CORSMiddleware

# 开发环境
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite 开发服务器
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["*"],
)

# 生产环境（严格限制）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.precis.dev"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    max_age=3600
)
```

## 请求速率限制

```python
from fastapi import Request, HTTPException
from functools import wraps
import time
from collections import defaultdict

class RateLimiter:
    """简易速率限制器"""
    
    def __init__(self, max_requests: int = 100, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self.requests = defaultdict(list)
    
    def is_allowed(self, client_id: str) -> bool:
        now = time.time()
        window_start = now - self.window
        
        # 清理过期请求记录
        self.requests[client_id] = [
            req_time for req_time in self.requests[client_id]
            if req_time > window_start
        ]
        
        if len(self.requests[client_id]) >= self.max_requests:
            return False
        
        self.requests[client_id].append(now)
        return True

# 作为依赖使用
rate_limiter = RateLimiter(max_requests=100, window_seconds=60)

async def rate_limit(request: Request):
    client_id = request.client.host
    if not rate_limiter.is_allowed(client_id):
        raise HTTPException(
            status_code=429,
            detail={
                "code": "RATE_LIMITED",
                "message": "请求过于频繁，请稍后再试"
            }
        )

@app.get("/api/v2/ai/chat", dependencies=[Depends(rate_limit)])
async def chat(...):
    pass
```

## Electron 安全

### 上下文隔离

```typescript
// preload.ts
// 必须启用 contextIsolation
contextBridge.exposeInMainWorld('electronAPI', {
  // 只暴露必要的、受控的 API
})
```

### 禁止的 API

```typescript
// ❌ 永远不要这样做
contextBridge.exposeInMainWorld('nodeModules', {
  fs: require('fs'),      // 暴露 Node.js 模块
  exec: require('child_process').exec,  // 暴露系统命令
  env: process.env        // 暴露环境变量
})

// ✅ 正确做法
contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path)
})
```

### 内容安全策略（CSP）

```typescript
// main.ts
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self';
         script-src 'self';
         style-src 'self' 'unsafe-inline';
         img-src 'self' data:;
         connect-src 'self' http://localhost:8000;"
      ]
    }
  })
})
```

## 安全检查清单

- [ ] 所有用户输入经过 Pydantic/FastAPI 验证
- [ ] 文件路径经过白名单校验
- [ ] 脚本表达式在沙箱中执行
- [ ] API Key 从环境变量读取，不硬编码
- [ ] 生产环境启用严格的 CORS
- [ ] 敏感接口启用速率限制
- [ ] Electron 启用 contextIsolation
- [ ] 日志中不输出敏感信息（密钥、密码）
- [ ] SQL 查询使用参数化（如果涉及）
- [ ] 定期更新依赖（npm audit, pip audit）
