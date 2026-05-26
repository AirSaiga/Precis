"""
@fileoverview 校验类型定义模块

功能概述:
- 定义 ValidationType 校验类型常量类,涵盖所有支持的校验规则
- 定义 ValidationResult 校验结果数据类,统一校验返回格式
- 支持 REGEX、UNIQUE、NOT_NULL、ALLOWED_VALUES、RANGE、FOREIGN_KEY 等类型
- 所有校验结果字段均为可选,支持渐进式填充

架构设计:
- ValidationType 采用字符串常量类模式,便于 JSON 序列化和前端使用
- ValidationResult 采用数据类模式,提供清晰的校验结果封装
- 常量类设计便于扩展新类型,无需修改枚举定义

输入示例:
    # ValidationType 常量
    validation_type = ValidationType.REGEX  # "regex"

    # ValidationResult 对象
    result = ValidationResult(
        is_valid=True,
        error_count=0,
        total_rows=100,
        match_count=100,
        error_rows=[],
        validation_time="0.023s"
    )

输出示例:
    # 校验失败时的错误详情
    error_rows = [
        {
            "row_index": 5,
            "cell_value": "invalid",
            "error_message": "值不符合正则表达式模式"
        }
    ]
"""

from typing import Optional


class ValidationType:
    """
    @classdesc 校验类型枚举类

    定义系统支持的所有数据校验规则类型。每个类型对应一种特定的数据验证逻辑，
    可通过 UnifiedValidationService 注册相应的验证器实现。

    为什么要定义这些类型？
    - 提供类型安全的校验类型标识
    - 集中管理所有支持的校验类型，便于扩展
    - 前端可通过字符串类型选择校验方式

    扩展方式：
    1. 在此类中添加新的类型常量
    2. 在 service.py 中实现对应的验证器类
    3. 在验证器工厂中注册新验证器
    """

    # 正则表达式校验：验证数据是否符合指定的正则表达式模式
    # 适用场景：邮箱、手机号、身份证号等格式验证
    # 示例：验证 email 列是否符合邮箱格式 r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    REGEX = "regex"

    # 唯一性校验：验证列中是否存在重复值
    # 适用场景：主键、用户名、订单号等必须唯一的字段
    # 示例：验证 user_id 列的所有值是否唯一
    UNIQUE = "unique"

    # 非空校验：验证单元格是否为必填项
    # 适用场景：必填字段的强制性检查
    # 示例：验证 name 列是否存在空值
    NOT_NULL = "not_null"

    # 允许值校验：验证数据是否在预定义的允许值列表中
    # 适用场景：状态字段、类型字段等有限取值范围的验证
    # 示例：验证 status 列是否在 ["active", "inactive", "pending"] 中
    ALLOWED_VALUES = "allowed_values"

    # 范围校验：验证数值或日期是否在指定范围内
    # 适用场景：年龄、分数、日期区间等边界值验证
    # 示例：验证 age 列是否在 0-150 范围内
    RANGE = "range"

    # 外键校验：验证数据是否引用了另一个表中的有效记录
    # 适用场景：关联数据完整性验证
    # 示例：验证 user_id 列的值是否在 users 表的 id 列中存在
    FOREIGN_KEY = "foreign_key"

    # 条件校验：根据条件表达式动态决定校验规则
    # 适用场景：复杂业务规则验证
    # 示例：当 status="vip" 时，discount 必须 <= 500
    CONDITIONAL = "conditional"

    # 脚本校验：使用自定义脚本进行复杂业务逻辑验证
    # 适用场景：标准校验器无法满足的自定义规则
    # 示例：验证 total == price * quantity
    SCRIPTED = "scripted"

    # 字符集校验：验证字符串是否符合特定字符集要求
    # 适用场景：纯中文名、纯 ASCII 用户名等
    # 示例：验证 name 列是否只包含中文字符
    CHARSET = "charset"

    # 日期逻辑校验：验证日期之间的逻辑关系（如开始日期早于结束日期）
    # 适用场景：日期大小关系、年龄计算等
    # 示例：验证 birth_date 是否在 2000-01-01 之前
    DATE_LOGIC = "date_logic"

    # 复合约束校验：将多个子约束按逻辑策略聚合校验
    # 适用场景：需要同时满足多个条件的复杂业务规则
    # 示例：验证 email 既非空又唯一
    COMPOSITE = "composite"


class ValidationResult:
    """
    @classdesc 校验结果数据类

    封装数据校验的执行结果，包含校验状态、错误统计和详细信息。
    该类用于统一各类型校验器的返回格式，便于调用方统一处理。

    数据流说明：
    调用方接收 ValidationResult 后，通常执行以下判断：
    1. 检查 is_valid 布尔值（推荐）
    2. 检查 error_count 数量
    3. 遍历 error_rows 获取详细错误信息

    Attributes:
        is_valid: 校验是否通过，True 表示所有数据均符合规则
        error_count: 错误行数，即不符合校验规则的记录数量
        total_rows: 总行数，即被校验的数据总行数
        match_count: 匹配行数，适用于唯一性等需要统计匹配数量的校验
        error_rows: 错误详情列表，每项包含行索引、单元格值和错误信息
        validation_time: 校验耗时，格式为秒（如 "0.123s"）
    """

    def __init__(
        self,
        is_valid: bool,
        error_count: int,
        total_rows: int,
        match_count: Optional[int] = None,
        error_rows: Optional[list[dict]] = None,
        validation_time: str = "0.000s",
    ):
        """
        @methoddesc 初始化校验结果实例

        Args:
            is_valid: 校验是否通过
                - True: 所有数据符合规则，error_count 应为 0
                - False: 存在不符合规则的数据
            error_count: 错误行数统计
                - 为 0 时表示校验通过
                - 大于 0 时表示存在错误
            total_rows: 被校验数据的总行数
                - 用于计算错误率
                - 前端可显示 "错误行数/总行数"
            match_count: 匹配行数（可选）
                - 仅在唯一性校验时有意义
                - 表示符合规则的数据行数
                - 计算公式：total_rows - error_count
            error_rows: 错误详情列表（可选）
                - 每个元素包含 row_index、cell_value、error_message
                - 默认为空列表，避免空引用异常
            validation_time: 校验耗时字符串（可选）
                - 格式为 "0.123s"（3位小数）
                - 用于性能监控和用户等待提示
        """
        # 校验是否通过标记
        # 【副作用】调用方通常首先检查此字段判断校验状态
        self.is_valid = is_valid

        # 错误行数统计
        # 【关键数据流】error_count > 0 时，is_valid 应为 False
        self.error_count = error_count

        # 总行数
        # 【用途】前端显示进度、计算错误率
        self.total_rows = total_rows

        # 匹配行数（可选）
        # 【用途】唯一性校验时显示唯一值数量
        self.match_count = match_count

        # 错误行详情列表，使用 or [] 处理 None 传入，避免后续遍历时空引用异常
        # 【关键数据流】包含错误位置的详细信息，供前端定位问题
        self.error_rows = error_rows or []

        # 校验耗时
        # 【副作用】可能用于性能监控和 UI 加载提示
        self.validation_time = validation_time


# ==============================================================================
# ValidationResult 使用示例
# ==============================================================================
# 示例 1: 校验通过
# result = ValidationResult(
#     is_valid=True,
#     error_count=0,
#     total_rows=100,
#     match_count=100,
#     error_rows=[],
#     validation_time="0.023s"
# )
# 解读：100 行数据全部通过校验，耗时 23 毫秒
#
# 示例 2: 校验失败
# result = ValidationResult(
#     is_valid=False,
#     error_count=3,
#     total_rows=100,
#     match_count=97,
#     error_rows=[
#         {"row_index": 5, "cell_value": "invalid_email", "error_message": "值 'invalid_email' 不符合正则表达式模式"},
#         {"row_index": 15, "cell_value": "bad@format", "error_message": "值 'bad@format' 不符合正则表达式模式"},
#         {"row_index": 88, "cell_value": "no_at_symbol", "error_message": "值 'no_at_symbol' 不符合正则表达式模式"}
#     ],
#     validation_time="0.015s"
# )
# 解读：100 行数据中有 3 行校验失败，分别在第 5、15、88 行
# ==============================================================================
