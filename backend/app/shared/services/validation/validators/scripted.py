"""
@fileoverview 脚本校验器

功能概述:
- 通过自定义脚本表达式对数据进行动态校验
- 支持用户定义的任意校验逻辑,以脚本形式执行

架构设计:
- 脚本执行引擎: 结合 ScriptedConstraint 实现动态脚本执行
- 安全隔离: 支持安全模式和沙箱执行模式
- 表达式解析: 将用户脚本解析为可执行的校验规则

依赖:
- pandas: DataFrame 数据处理
- ScriptedConstraint: 脚本约束模型
- ValidationResult: 校验结果数据类型

设计决策:
- 委托模式: 将脚本执行逻辑委托给 ScriptedConstraint 类处理
- 安全优先: 默认不允许不安全执行,避免代码注入风险
- 表达式灵活: 支持多种表达式语法,如 "value > 100", "price * quantity == total"
"""

import time

import pandas as pd

from app.shared.domain import ScriptedConstraint

from ..types import ValidationResult
from .base import BaseValidator


class ScriptedValidator(BaseValidator):
    """
    @classdesc 脚本校验器

    通过自定义脚本/表达式对数据进行动态校验，允许用户定义
    任意复杂的校验逻辑。适用于标准校验器无法满足的复杂场景。

    业务场景：
    - 验证订单总额 = 单价 × 数量
    - 验证会员积分 = 消费金额 × 积分比例
    - 验证年龄大于等于 0 且小于 150
    - 验证多个字段的复杂业务规则组合

    设计原则：
    - 动态执行：支持用户定义的任意校验表达式
    - 安全控制：提供安全模式和沙箱执行选项
    - 灵活表达：支持多种脚本语法和表达式格式

    示例：
        validator = ScriptedValidator()

        # 简单表达式：值必须大于 100
        result = validator.validate(
            df, "price",
            script="value > 100",
            script_name="price_check"
        )

        # 复杂逻辑：多字段组合校验
        result = validator.validate(
            df, "total",
            script="value == price * quantity",
            script_name="total_calculation"
        )
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行脚本校验

        使用用户定义的脚本表达式对 DataFrame 中指定列进行动态校验。
        支持自定义表达式,实现标准校验器无法覆盖的复杂规则。

        @param df: 待校验的 DataFrame 对象
        @param column: 待校验的列名
        @param kwargs: 校验参数:
            - script: 脚本表达式内容(字符串)
            - script_name: 脚本名称(用于标识,默认 "custom_script")
            - allow_unsafe_eval: 是否允许不安全执行(默认 False)

        @return ValidationResult: 标准化校验结果,包含:
            - is_valid: 校验是否通过
            - error_count: 错误行数
            - total_rows: 总行数
            - error_rows: 错误详情列表

        @sideeffect:
            - 读取 DataFrame 列数据
            - 执行用户提供的脚本表达式
            - 可能存在代码注入风险(除非 allow_unsafe_eval=False)

        @raises ValueError: 列名不存在或脚本为空

        处理流程:
            Step 1: 初始化计时器,记录校验开始时间
            Step 2: 获取并验证脚本内容
            Step 3: 检查脚本非空,空脚本返回错误
            Step 4: 构建 ScriptedConstraint 对象
            Step 5: 执行脚本约束验证
            Step 6: 格式化错误结果并返回

        示例流程:
            输入: df = pd.DataFrame({"price": [100, 50], "total": [200, 150]})
            参数: script="value == price * quantity", script_name="check_total"
            注意: 需要确保 DataFrame 中有 price 和 quantity 列
            输出: is_valid=False, error_rows=[{row_index: 1, value: "150", message: "校验失败"}]
        """
        # Step 1: 记录校验开始时间
        # 目的: 用于计算校验耗时,帮助性能监控和优化
        start_time = time.time()

        # Step 2: 获取脚本参数
        # 数据流: 从 kwargs 中提取脚本配置
        # 关键参数:
        #   - script: 核心校验逻辑,以字符串形式传入
        #   - script_name: 脚本标识,方便日志追踪和调试
        #   - allow_unsafe_eval: 安全开关,控制是否允许危险操作
        script = kwargs.get("script", "")
        script_name = kwargs.get("script_name", "custom_script")
        allow_unsafe_eval = kwargs.get("allow_unsafe_eval", False)

        # Step 3: 验证脚本非空
        # 防御性检查: 空脚本无法执行任何校验,直接返回错误
        # 这是必要的验证,避免后续创建无效的约束对象
        if not script:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[{"row_index": 0, "cell_value": None, "error_message": "脚本内容为空"}],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # Step 4: 构建脚本约束对象
        # 委托模式: 将脚本执行委托给 ScriptedConstraint 类
        # 参数说明:
        #   - table: 临时表名,约束内部用于标识数据源
        #   - name: 脚本名称,用于日志和调试
        #   - expression: 脚本表达式,即校验逻辑
        #   - column: 待校验的列名,表达式中的 value 变量代表此列的值
        constraint = ScriptedConstraint(table="temp", name=script_name, expression=script, column=column)

        def _error_formatter(err):
            # 处理 row_index,确保为整数类型
            # 原因: 某些情况下约束可能返回非标准格式的 row_index
            row_index = err.get("row_index")
            if row_index is None:
                row_index = 0
            try:
                row_index = int(row_index)
            except (TypeError, ValueError):
                # 转换失败时使用默认值 0
                row_index = 0
            return {
                "row_index": row_index,
                "cell_value": str(err.get("value", "")),
                "error_message": err.get("message", ""),
            }

        # 委托给基类的通用委托方法执行校验
        return self._delegate_validation(
            df,
            column,
            constraint,
            error_formatter=_error_formatter,
            constraint_kwargs={"allow_unsafe_eval": allow_unsafe_eval},
        )
