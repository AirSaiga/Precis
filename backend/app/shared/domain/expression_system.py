"""
@fileoverview 表达式解析模块

功能概述:
- 提供灵活的表达式解析功能，将格式化字符串解析为结构化数据
- 支持类型转换器字典（TYPE_CASTERS）实现字符串到目标类型的转换
- 提供模板解析器工厂函数和表达式注册表
- 主要应用于数据验证场景

架构设计:
- TYPE_CASTERS: 类型转换器字典，将字符串转换为目标类型
- create_tempated_parser: 创建模板解析器工厂函数
- ExpressionPattern: 表达式模式数据类
- ExpressionRegistry: 表达式注册表

输入示例:
    template = {"type": "phone_cn", "value": "{value:int}"}
    parser = create_tempated_parser(template)
    result = parser({"value": "13800138000"})

输出示例:
    {"type": "phone_cn", "value": 13800138000}
"""

# 1. 标准库导入
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Optional

# ============================================================================
# 类型转换器
# ============================================================================
# 将字符串转换为目标类型
# 使用示例：
#   "" -> str (默认字符串)
#   "int" -> int (整数)
#   "float" -> float (浮点数)
#   "date" -> date (日期格式 YYYYMMDD)
#   "bool" -> bool (布尔值)

# 类型转换器字典：键为类型名称，值为对应的转换函数
# 在模板解析时，根据 {name:type} 中的 type 查找对应的转换器，将字符串捕获组转换为目标类型
TYPE_CASTERS: dict[str, Callable[[str], Any]] = {
    "": str,  # 默认类型：保持字符串原样
    "str": str,  # 字符串类型：显式声明，效果同默认
    "int": int,  # 整数类型：调用 int() 转换
    "float": float,  # 浮点数类型：调用 float() 转换
    "date": lambda s: datetime.strptime(s, "%Y%m%d").date(),  # 日期类型：按 YYYYMMDD 格式解析
    "bool": lambda s: s.lower() in ["true", "1", "t", "y", "yes"],  # 布尔类型：支持多种真值表示
}


def create_tempated_parser(output_template: dict[str, Any]) -> Callable[[dict[str, str]], dict[str, Any]]:
    """
    创建模板解析器。

    ============================================================================
    输入数据示例 (这个函数接收什么数据)
    ============================================================================
    本函数接收一个输出模板字典：

    ```python
    # 简单模板
    template1 = {
        "type": "phone_cn",
        "prefix": "+86"
    }

    # 动态模板（带类型转换）
    template2 = {
        "type": "phone_cn",
        "value": "{value:int}",    # 将捕获组转换为整数
        "area_code": "{area:str}"  # 将捕获组转换为字符串
    }

    # 复杂模板
    template3 = {
        "type": "email",
        "username": "{username:str}",
        "domain": "{domain:str}",
        "is_business": "{isBiz:bool}"
    }
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 定义表达式解析规则
      当需要将符合特定格式的字符串解析为结构化数据时使用。

    - 场景2: 数据验证
      验证用户输入的数据格式，并转换为正确的类型。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - output_template: Dict[str, Any]，输出模板字典
        示例值: {"type": "phone", "value": "{value:int}"}

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 解析模板                                        │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: {"value": "{value:int}"}                         │
      │ 操作: 正则匹配 {name:type} 格式                        │
      │ 输出: [(value, dynamic, (value, int)), ...]             │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 2: 创建解析器函数                                 │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 解析后的模板规范                                  │
      │ 操作: 返回一个闭包函数                                  │
      │ 输出: parser 函数                                       │
      └─────────────────────────────────────────────────────────────┘

    最终输出: Callable[[Dict[str, str]], Dict[str, Any]]
      示例:
        parser = create_tempated_parser({"value": "{value:int}"})
        result = parser({"value": "123"})
        # 结果: {"value": 123}

    ============================================================================
    类型转换格式
    ============================================================================
    | 格式 | 说明 | 示例 |
    |------|------|------|
    | {name:} | 字符串（默认）| {value:} -> "123" |
    | {name:str} | 字符串 | {value:str} -> "123" |
    | {name:int} | 整数 | {value:int} -> 123 |
    | {name:float} | 浮点数 | {value:float} -> 123.45 |
    | {name:date} | 日期 (YYYYMMDD) | {value:date} -> date(2024,1,15) |
    | {name:bool} | 布尔值 | {value:bool} -> True |

    :param output_template: 输出模板字典
    :return: 解析器函数
    """
    # 预处理模板：将模板字典解析为结构化规范列表，便于后续快速执行
    # 每个元素为三元组：(输出键, 规则类型, 规则数据)
    # 规则类型为 "static" 表示静态值，"dynamic" 表示需要从捕获组动态提取并转换
    processed_spec: list[tuple[str, str, Any]] = []
    # 匹配 {name:type} 格式的模板占位符，如 {value:int}
    template_regex = re.compile(r"{(\w+):(\w*)}")

    for key, template_value in output_template.items():
        if isinstance(template_value, str):
            # 尝试匹配动态模板占位符
            match = template_regex.fullmatch(template_value)
            if match:
                group_name, type_name = match.groups()
                # 校验类型是否存在于转换器字典中，防止运行时因未知类型而失败
                if type_name not in TYPE_CASTERS:
                    raise ValueError(f"在类型转换器中未找到目标类型: '{type_name}'")
                # 记录动态规则：输出键 -> (捕获组名, 目标类型)
                processed_spec.append((key, "dynamic", (group_name, type_name)))
                continue
        # 非动态模板视为静态值，直接保留原值
        processed_spec.append((key, "static", template_value))

    def parser(regex_groups: dict[str, str]) -> dict[str, Any]:
        """
        解析正则捕获组。

        ============================================================================
        输入数据示例
        ============================================================================
        本函数接收正则捕获组字典：

        ```python
        # 假设模板是 {"value": "{value:int}", "type": "static_type"}
        regex_groups = {"value": "123"}
        ```

        最终输出:
            {"value": 123, "type": "static_type"}
        """
        # 根据预处理后的规范，将正则捕获组转换为结构化输出字典
        result_dict: dict[str, Any] = {}
        for key, rule_type, rule_data in processed_spec:
            if rule_type == "static":
                # 静态值直接复制到结果中
                result_dict[key] = rule_data
            elif rule_type == "dynamic":
                # 动态值需要从捕获组中提取并按指定类型转换
                group_name, type_name = rule_data
                # 校验捕获组是否存在，防止模板与正则表达式定义不一致导致 KeyError
                if group_name not in regex_groups:
                    raise KeyError(f"在正则捕获组中未找到名为 '{group_name}' 的组")
                raw_value = regex_groups[group_name]
                try:
                    # 查找并调用对应的类型转换器函数
                    caster_func = TYPE_CASTERS[type_name]
                    result_dict[key] = caster_func(raw_value)
                except (ValueError, TypeError) as e:
                    # 转换失败时抛出明确的错误信息，包含原始值和目标类型，便于定位问题
                    raise ValueError(f"转换捕获组 '{group_name}' 的值 '{raw_value}' 到类型 '{type_name}' 时失败: {e}")
        return result_dict

    return parser


# ============================================================================
# 解析器函数类型定义
# ============================================================================
# 输入: 正则捕获组字典
# 输出: 解析后的字典

ParserFunc = Callable[[dict[str, str]], dict[str, Any]]


@dataclass
class ExpressionPattern:
    """
    表达式模式数据类。

    ============================================================================
    配置文件示例 (这个类对应什么)
    ============================================================================
    本类对应 patterns/*.yaml 中的模式定义：

    ```yaml
    # patterns/phone.yaml
    name: phone_cn
    pattern: r'^1[3-9]\\d{9}$'
    template:
      type: phone_cn
      value: "{value:str}"
    ```
    """

    name: str  # 表达式名称，如 "phone_cn"
    regex: re.Pattern  # 编译后的正则表达式
    parser_func: ParserFunc  # 解析器函数


class ExpressionRegistry:
    r"""
    表达式注册表。

    ============================================================================
    配置文件示例 (这个类对应什么)
    ============================================================================
    本类用于管理多个表达式模式：

    ```python
    # 创建注册表
    registry = ExpressionRegistry()

    # 注册模式
    registry.register(ExpressionPattern(
        name="phone_cn",
        regex=re.compile(r'^1[3-9]\\d{9}$'),
        parser_func=create_tempated_parser({"type": "phone", "value": "{value:str}"})
    ))

    # 查找匹配
    result = registry.find_match("13800138000")
    # 返回: (ExpressionPattern, Match)
    ```

    ============================================================================
    业务场景 (什么情况下会使用这个类)
    ============================================================================
    - 场景1: 表达式模式管理
      管理多个预定义的表达式模式，供数据验证使用。

    - 场景2: 表达式匹配
      查找输入字符串匹配哪个预定义的表达式模式。

    ============================================================================
    使用示例
    ============================================================================
    【创建和注册】
    ```python
    registry = ExpressionRegistry()

    # 注册手机号模式
    phone_pattern = ExpressionPattern(
        name="phone_cn",
        regex=re.compile(r'^1[3-9]\\d{9}$'),
        parser_func=create_tempated_parser({"type": "phone", "value": "{value:str}"})
    )
    registry.register(phone_pattern)

    # 注册邮箱模式
    email_pattern = ExpressionPattern(
        name="email",
        regex=re.compile(r'^[\w\.-]+@[\w\.-]+\.\w+$'),
        parser_func=create_tempated_parser({"type": "email", "value": "{value:str}"})
    )
    registry.register(email_pattern)
    ```

    【匹配使用】
    ```python
    # 匹配手机号
    result = registry.find_match("13800138000")
    if result:
        pattern, match = result
        parsed = pattern.parser_func(match.groupdict())
        # parsed: {"type": "phone", "value": "13800138000"}
    ```
    """

    def __init__(self):
        # 使用列表存储已注册的表达式模式，保持注册顺序
        # 匹配时按注册顺序遍历，先注册的先匹配
        self._patterns: list[ExpressionPattern] = []

    def register(self, pattern: ExpressionPattern) -> None:
        """
        注册表达式模式。

        :param pattern: ExpressionPattern 实例
        """
        # 将模式追加到内部列表，后续 find_match 会按此顺序遍历
        self._patterns.append(pattern)

    def find_match(self, value: str) -> Optional[tuple[ExpressionPattern, re.Match]]:
        """
        查找匹配的模式。

        ============================================================================
        数据流 (输入如何变成输出)
        ============================================================================
        输入参数:
          - value: str，待匹配的字符串
            示例值: "13800138000"

        处理步骤:
          1. 遍历所有已注册的模式
          2. 对每个模式使用 fullmatch 尝试匹配
          3. 返回第一个匹配的模式和匹配结果

        最终输出: Optional[Tuple[ExpressionPattern, re.Match]]
          示例:
            find_match("13800138000")  # 返回 (phone_pattern, match)
            find_match("invalid")      # 返回 None
        """
        # 按注册顺序遍历所有模式，使用 fullmatch 确保整个字符串完全匹配
        # 先去掉输入字符串首尾空白，避免空格导致匹配失败
        for pattern in self._patterns:
            match = pattern.regex.fullmatch(value.strip())
            if match:
                # 返回第一个匹配成功的模式及其匹配结果对象
                return pattern, match
        # 没有任何模式匹配成功，返回 None
        return None


create_templated_parser = create_tempated_parser
