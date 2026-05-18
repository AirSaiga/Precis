"""
@fileoverview 条件校验器

功能概述:
- 根据条件逻辑对数据进行校验(IF-THEN 语义)
- 支持单条件和多条件组合的场景校验

架构设计:
- 条件组合模式: 结合 ConditionalConstraint 实现复杂条件逻辑
- 动态条件: 支持 AND/OR 逻辑组合多个条件
- 列引用: 允许基于其他列的值动态决定校验规则

依赖:
- pandas: DataFrame 数据处理
- ConditionalConstraint: 条件约束模型
- ValidationResult: 校验结果数据类型

设计决策:
- 条件与校验分离: 条件判断逻辑由 ConditionalConstraint 处理,解耦设计
- 简单/复杂条件双模式: 简单条件用单列匹配,复杂条件用条件列表
- 委托模式: 将校验逻辑委托给底层的 ConditionalConstraint 类
"""

import time

import pandas as pd

from app.shared.domain import ConditionalConstraint

from ..types import ValidationResult
from .base import BaseValidator


class ConditionalValidator(BaseValidator):
    """
    @classdesc 条件校验器

    实现条件触发式数据校验，类似于编程语言中的 IF-THEN 逻辑：
    当指定条件满足时，对目标列执行特定的校验规则。
    支持单条件简单场景和多条件组合复杂场景。

    业务场景：
    - 订单状态为"已完成"时，验收日期不能为空
    - 用户类型为 VIP 时，折扣金额必须大于等于 50
    - 当产品类别是"电子产品"且价格大于 5000 时，必须填写保修期

    设计原则：
    - 条件触发：仅对满足条件的行执行校验
    - 灵活条件：支持精确匹配和复杂条件表达式
    - 逻辑组合：支持 AND/OR 逻辑组合多个条件

    示例：
        # 简单条件：当 status 为 "active" 时，email 不能为空
        validator = ConditionalValidator()
        result = validator.validate(
            df, "email",
            if_column="status",
            if_value="active",
            then_condition="not_null"
        )
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行条件校验

        根据指定的条件逻辑对 DataFrame 中目标列进行校验。
        仅对满足触发条件的行执行校验规则。

        @param df: 待校验的 DataFrame 对象
        @param column: 待校验的目标列名(THEN 部分的校验列)
        @param kwargs: 校验参数:
            - if_column: 条件列名(IF 部分的触发列)
            - if_value: 条件列的期望值(精确匹配)
            - if_conditions: 复杂条件列表(多条件组合)
            - if_logic: 多条件逻辑("and" 或 "or")
            - then_condition: 触发后的校验规则
            - then_condition_config: 校验规则配置(别名)

        @return ValidationResult: 标准化校验结果,包含:
            - is_valid: 校验是否通过
            - error_count: 错误行数
            - total_rows: 总行数
            - error_rows: 错误详情列表

        @sideeffect:
            - 读取 DataFrame 列数据
            - 创建临时 ConditionalConstraint 对象
            - 可能抛出 ValueError(列不存在等)

        @raises ValueError: 列名不存在或配置不完整

        处理流程:
            Step 1: 初始化计时器,记录校验开始时间
            Step 2: 解析条件参数(if_column, if_value, if_conditions 等)
            Step 3: 验证 then_condition 存在,否则返回错误
            Step 4: 根据条件类型构建 ConditionalConstraint 对象
            Step 5: 执行条件约束验证
            Step 6: 格式化错误结果并返回

        示例流程:
            输入: df = pd.DataFrame({"status": ["active", "inactive"], "email": ["a@b.com", ""]})
            参数: if_column="status", if_value="active", then_condition="not_null"
            输出: is_valid=True (只校验第1行,第1行 email 不为空)
        """
        # Step 1: 记录校验开始时间
        # 目的: 用于计算校验耗时,帮助性能监控和优化
        start_time = time.time()

        # Step 2: 解析条件参数
        # 数据流: 从 kwargs 中提取条件配置,这些参数定义了"何时触发"校验
        # 关键参数说明:
        #   - if_column + if_value: 简单条件模式(单列精确匹配)
        #   - if_conditions + if_logic: 复杂条件模式(多条件组合)
        #   - then_condition: 触发后执行的校验规则
        if_column = kwargs.get("if_column", "")
        if_value = kwargs.get("if_value")
        if_conditions = kwargs.get("if_conditions") or []
        if_logic = kwargs.get("if_logic", "and")
        then_condition = kwargs.get("then_condition") or kwargs.get("then_condition_config")

        # Step 3: 验证 then_condition 存在
        # then_condition 是必需的,缺少则无法执行校验
        # 这是一个防御性检查,避免构建无效的约束对象
        if not then_condition:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[{"row_index": 0, "cell_value": None, "error_message": "条件校验配置不完整"}],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # Step 4: 根据条件类型构建 ConditionalConstraint
        # 核心逻辑: 将用户输入的参数转换为 ConditionalConstraint 对象
        # 设计模式: 委托模式 - 将具体校验逻辑委托给 ConditionalConstraint 类
        if if_conditions:
            # 复杂条件模式: 多条件组合(if_conditions 列表非空)
            # 业务规则: if_conditions 是一个条件列表,每个条件包含 column, operator, value
            # 逻辑组合: if_logic 决定是"全部满足"(and)还是"任一满足"(or)
            # 示例: [{"column": "type", "operator": "eq", "value": "vip"}, {"column": "amount", "operator": "gt", "value": 1000}]
            constraint = ConditionalConstraint(
                table="temp",
                if_conditions=if_conditions,
                if_logic=if_logic,
                then_column=column,
                then_condition=then_condition,
            )
        else:
            # 简单条件模式: 单条件精确匹配
            # 需要验证 if_column 存在
            # 业务规则: 当 if_column 列的值等于 if_value 时,触发对 column 列的校验
            if not if_column:
                return ValidationResult(
                    is_valid=False,
                    error_count=1,
                    total_rows=len(df),
                    error_rows=[{"row_index": 0, "cell_value": None, "error_message": "条件校验配置不完整"}],
                    validation_time=f"{time.time() - start_time:.3f}s",
                )
            # 构建简单条件约束
            # 参数说明:
            #   - table: 临时表名,用于约束内部标识
            #   - if_column: 条件判断列
            #   - if_value: 条件期望值
            #   - then_column: 需要校验的列
            #   - then_condition: 校验规则(如 "not_null", "gte:0", "eq:true" 等)
            constraint = ConditionalConstraint(
                table="temp", if_column=if_column, if_value=if_value, then_column=column, then_condition=then_condition
            )

        def _error_formatter(err):
            return {
                "row_index": err.get("row_index"),
                "cell_value": err.get("value"),
                "error_message": err.get("message"),
            }

        # 委托给基类的通用委托方法执行校验
        return self._delegate_validation(df, column, constraint, error_formatter=_error_formatter)
