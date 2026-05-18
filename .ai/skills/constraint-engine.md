---
name: "constraint-engine"
description: "Precis 数据校验引擎开发规范。适用于约束类型定义、校验器实现、约束工厂、配置读写等后端模块。"
scope: ["backend/app/shared/domain/constraints/**/*.py", "backend/app/shared/services/validation/**/*.py", "backend/app/shared/core/project/constraint/**/*.py"]
---

# Precis 数据校验引擎开发规范

## 适用范围

- 约束类型定义与扩展
- 校验器（Validator）实现
- 约束工厂（ConstraintFactory）
- 约束读写器（ConstraintReader / ConstraintWriter）
- 条件约束与脚本约束逻辑

## 约束类型体系

项目内置以下约束类型：

| 类型 | 说明 | 文件位置 |
|------|------|---------|
| `Unique` | 唯一性约束 | `validators/unique.py` |
| `NotNull` | 非空约束 | `validators/not_null.py` |
| `AllowedValues` | 允许值约束 | `validators/allowed_values.py` |
| `ForeignKey` | 外键约束 | `validators/foreign_key.py` |
| `Conditional` | 条件约束 | `validators/conditional.py` |
| `Scripted` | 脚本约束 | `validators/scripted.py` |
| `Range` | 区间约束 | `validators/range.py` |
| `Charset` | 字符集约束 | `validators/charset.py` |

## 校验器实现规范

所有校验器必须继承 `BaseValidator`：

```python
from app.shared.domain.constraints.base import BaseValidator
from app.shared.domain.validation_constraints import ValidationContext, ValidationResult

class UniqueValidator(BaseValidator):
    """唯一性约束校验器
    
    功能概述:
    - 校验指定列或多列组合的值是否唯一
    - 支持跨表唯一性校验（未来扩展）
    
    输入:
        - column_ids: 需要校验唯一性的列 ID 列表
        - data: DataFrame 数据
    
    输出:
        - ValidationResult: 包含重复值的位置和详情
    """
    
    def validate(
        self,
        context: ValidationContext,
        params: dict
    ) -> ValidationResult:
        """执行唯一性校验
        
        Args:
            context: 校验上下文（包含数据、Schema 等）
            params: 约束参数（Unique 类型无额外参数）
            
        Returns:
            ValidationResult: 校验结果
        """
        # ============================================================================
        # 数据准备
        # ============================================================================
        df = context.data
        column_ids = context.constraint.refs.column_ids
        
        # ============================================================================
        # 唯一性检测
        # ============================================================================
        duplicates = df[df.duplicated(subset=column_ids, keep=False)]
        
        if duplicates.empty:
            return ValidationResult.success()
        
        # 构建错误详情
        errors = []
        for idx, row in duplicates.iterrows():
            errors.append({
                "row_index": int(idx),
                "columns": {col: row[col] for col in column_ids},
                "message": f"重复值: {', '.join(f'{col}={row[col]}' for col in column_ids)}"
            })
        
        return ValidationResult.fail(errors=errors)
```

## 约束文件通用结构

约束采用 **refs（引用区）+ params（参数区）** 分离设计：

```yaml
version: 2

id: constraint_id
type: ConstraintType
enabled: true
description: "约束描述"

refs:
  table_id: table_name
  column_ids: [col1, col2]

params:
  # 约束特定参数
```

## 约束工厂注册

新增约束类型时，需要在工厂中注册：

```python
from app.shared.domain.constraints.base import BaseValidator
from app.shared.domain.constraints.unique import UniqueValidator
from app.shared.domain.constraints.not_null import NotNullValidator

class ConstraintFactory:
    """约束工厂
    
    功能概述:
    - 根据约束类型创建对应的校验器实例
    - 支持自定义约束扩展
    """
    
    _registry: dict[str, type[BaseValidator]] = {
        "Unique": UniqueValidator,
        "NotNull": NotNullValidator,
        "AllowedValues": AllowedValuesValidator,
        "ForeignKey": ForeignKeyValidator,
        "Conditional": ConditionalValidator,
        "Scripted": ScriptedValidator,
        "Range": RangeValidator,
        "Charset": CharsetValidator,
    }
    
    @classmethod
    def create(cls, constraint_type: str) -> BaseValidator:
        """创建校验器实例
        
        Args:
            constraint_type: 约束类型名称
            
        Returns:
            BaseValidator: 校验器实例
            
        Raises:
            ValueError: 未知的约束类型
        """
        validator_class = cls._registry.get(constraint_type)
        if validator_class is None:
            raise ValueError(f"未知的约束类型: {constraint_type}")
        return validator_class()
    
    @classmethod
    def register(cls, name: str, validator_class: type[BaseValidator]) -> None:
        """注册自定义校验器
        
        Args:
            name: 约束类型名称
            validator_class: 校验器类
        """
        cls._registry[name] = validator_class
```

## 条件约束逻辑

条件约束支持多条件组合（and/or）：

```python
class ConditionalValidator(BaseValidator):
    """条件约束校验器
    
    逻辑:
    - 当 if_conditions 全部（或任意）满足时，then_column 必须等于 then_value
    - if_logic 控制多条件组合方式: and / or
    """
    
    SUPPORTED_OPERATORS = {
        "eq": lambda a, b: a == b,
        "ne": lambda a, b: a != b,
        ">": lambda a, b: a > b,
        ">=": lambda a, b: a >= b,
        "<": lambda a, b: a < b,
        "<=": lambda a, b: a <= b,
        "in": lambda a, b: a in b,
        "not_in": lambda a, b: a not in b,
    }
    
    def validate(self, context: ValidationContext, params: dict) -> ValidationResult:
        df = context.data
        refs = context.constraint.refs
        
        # 评估条件
        condition_results = []
        for condition in refs.if_conditions:
            operator = self.SUPPORTED_OPERATORS[condition.operator]
            column_values = df[condition.if_column_id]
            condition_results.append(operator(column_values, condition.value))
        
        # 组合条件
        if refs.if_logic == "and":
            combined = condition_results[0]
            for result in condition_results[1:]:
                combined = combined & result
        else:
            combined = condition_results[0]
            for result in condition_results[1:]:
                combined = combined | result
        
        # 验证 then 列
        then_column = df[refs.then_column_id]
        then_value = params.get("then_value")
        
        violations = combined & (then_column != then_value)
        
        if violations.any():
            errors = []
            for idx in df[violations].index:
                errors.append({
                    "row_index": int(idx),
                    "column": refs.then_column_id,
                    "expected": then_value,
                    "actual": df.loc[idx, refs.then_column_id]
                })
            return ValidationResult.fail(errors=errors)
        
        return ValidationResult.success()
```

## 脚本约束安全限制

脚本约束必须启用沙箱模式：

```python
class ScriptedValidator(BaseValidator):
    """脚本约束校验器
    
    安全限制:
    - 禁止 eval() 和 exec()
    - 使用受限的执行环境
    - 超时控制（默认 10 秒）
    """
    
    def validate(self, context: ValidationContext, params: dict) -> ValidationResult:
        expression = params.get("expression", "")
        
        # 安全检查
        if "eval(" in expression or "exec(" in expression:
            return ValidationResult.fail(errors=[{
                "message": "脚本包含禁止的函数调用: eval/exec"
            }])
        
        # 沙箱执行
        # ...
```
