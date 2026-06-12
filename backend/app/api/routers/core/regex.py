"""
@fileoverview 正则表达式 API 路由模块

功能概述:
- 将可视化模式片段解析为可执行的正则表达式
- 执行正则表达式测试并返回匹配结果和命名组
- 批量验证数据并提取命名组结果（用于前端正则节点预览）

架构设计:
- 模式解析：支持 static 和 param 两种片段类型，映射为对应正则
- 正则验证：使用 Python re 模块编译和执行匹配
- 提取模式：支持 full/partial/extract 三种匹配模式

输入示例:
    POST /utils/parse-pattern
    {"parts": [{"type": "static", "text": "ID_"}, {"type": "param", "name": "id", "param_type": "int"}]}

输出示例:
    {"regex": "ID_(?P<id>\\d+)", "params": {"id": "int"}}
"""

import re
from typing import Literal, Optional, Union

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/latest/utils", tags=["Utilities"])


class PatternPart(BaseModel):
    """正则模式片段模型

    用于描述正则表达式的组成部分，每个片段可以是固定文本（static）
    或参数占位符（param）。

    字段说明:
        type: 片段类型，"static" 表示固定文本，"param" 表示参数占位符
        text: 固定文本内容（仅 static 类型使用）
        name: 参数名称（仅 param 类型使用，用于生成命名捕获组）
        param_type: 参数数据类型（仅 param 类型使用，决定正则片段）
    """

    type: Literal["static", "param"]
    text: Union[str, None] = None
    name: Union[str, None] = None
    param_type: Union[str, None] = None


class ParsePatternRequest(BaseModel):
    """解析模式请求模型

    接收前端传来的模式片段列表，将其组合成完整的正则表达式。

    字段说明:
        parts: 模式片段列表，按顺序组合
    """

    parts: list[PatternPart]


class ParsePatternResponse(BaseModel):
    """解析模式响应模型

    返回组合后的正则表达式和提取的参数信息。

    字段说明:
        regex: 组合后的完整正则表达式字符串
        params: 参数名称到参数类型的映射字典
    """

    regex: str
    params: dict[str, str]


# 参数类型到正则片段的映射表
# 根据参数类型选择对应的正则表达式片段
PARAM_TYPE_REGEX_MAP = {
    "int": r"\d+",  # 整数：一个或多个数字
    "float": r"-?\d+(?:\.\d+)?",  # 浮点数：可选负号 + 数字 + 可选的小数部分
    "str": r"\w+",  # 字符串：一个或多个单词字符
    "word": r"\w+",  # 单词：与 str 相同
    "non_space": r"\S+",  # 非空白字符：一个或多个非空白字符
    "anything": r".+",  # 任意字符：一个或多个任意字符
}


@router.post(
    "/parse-pattern",
    response_model=ParsePatternResponse,
    summary="将可视化模式片段解析为正则表达式",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def parse_pattern_to_regex(request: ParsePatternRequest):
    """将可视化模式片段解析为正则表达式

    遍历请求中的每个片段：
    - static 类型：转义文本中的特殊正则字符后直接拼接
    - param 类型：根据 param_type 查找对应的正则片段，包装为命名捕获组 (?P<name>...)

    Args:
        request: 包含模式片段列表的请求对象

    Returns:
        包含组合后的正则表达式和参数信息的响应对象
    """
    regex_parts = []
    params = {}
    for part in request.parts:
        if part.type == "static" and part.text:
            # 对固定文本进行正则转义，防止特殊字符干扰正则语义
            regex_parts.append(re.escape(part.text))
        elif part.type == "param" and part.name and part.param_type:
            # 根据参数类型获取对应的正则片段，默认为 \w+
            regex_fragment = PARAM_TYPE_REGEX_MAP.get(part.param_type, r"\w+")
            # 构建命名捕获组，如 (?P<id>\d+)
            regex_parts.append(f"(?P<{part.name}>{regex_fragment})")
            params[part.name] = part.param_type

    final_regex = "".join(regex_parts)
    return {"regex": final_regex, "params": params}


class TestRegexRequest(BaseModel):
    """正则测试请求模型

    字段说明:
        regex: 待测试的正则表达式字符串
        test_string: 用于匹配测试的文本
    """

    regex: str
    test_string: str


class TestRegexResponse(BaseModel):
    """正则测试响应模型

    字段说明:
        is_match: 是否匹配成功
        groups: 捕获组结果字典（仅匹配成功时有值）
        error: 错误信息（正则无效时返回）
    """

    is_match: bool
    groups: dict[str, str] = Field(default_factory=dict)
    error: Union[str, None] = None


@router.post(
    "/test-regex",
    response_model=TestRegexResponse,
    summary="测试正则表达式匹配",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def test_regex_matching(request: TestRegexRequest):
    """测试正则表达式匹配

    编译用户提供的正则表达式，并在测试字符串中搜索匹配。
    返回是否匹配以及所有命名捕获组的内容。

    Args:
        request: 包含正则表达式和测试字符串的请求对象

    Returns:
        包含匹配结果、捕获组和错误信息的响应对象
    """
    if not request.regex:
        return {"is_match": False, "error": "正则表达式不能为空。"}
    try:
        # 编译正则表达式，如果格式错误会抛出 re.error
        compiled_regex = re.compile(request.regex)
        # 在测试字符串中搜索匹配（search 模式，不要求完全匹配）
        match = compiled_regex.search(request.test_string)
        if match:
            return {"is_match": True, "groups": match.groupdict()}
        else:
            return {"is_match": False, "groups": {}}
    except re.error as e:
        return {"is_match": False, "error": f"无效的正则表达式: {e}"}


class RegexValidateExtractRequest(BaseModel):
    """批量正则验证与提取请求模型

    对一批数据值执行正则匹配，并提取命名捕获组的结果。

    字段说明:
        regex_pattern: 正则表达式模式（必填）
        regex_flags: 正则标志字符串，如 "i" 表示忽略大小写
        case_sensitive: 是否区分大小写（默认 True）
        match_mode: 匹配模式，"full" 完全匹配，"partial" 部分匹配，"extract" 提取
        values: 待验证的数据值列表
    """

    regex_pattern: str = Field(min_length=1)
    regex_flags: str = ""
    case_sensitive: bool = True
    match_mode: Literal["full", "partial", "extract"] = "full"
    values: list[str] = Field(default_factory=list)


class RegexValidateExtractData(BaseModel):
    """批量正则验证与提取的结果数据模型

    字段说明:
        total_rows: 总数据行数
        match_count: 匹配成功的数量
        error_count: 匹配失败的数量
        group_names: 命名捕获组名称列表
        extracted_columns: 按组名组织的提取结果字典
    """

    total_rows: int
    match_count: int
    error_count: int
    group_names: list[str] = Field(default_factory=list)
    extracted_columns: dict[str, list[str]] = Field(default_factory=dict)


class RegexValidateExtractResponse(BaseModel):
    """批量正则验证与提取响应模型

    字段说明:
        success: 操作是否成功
        data: 验证和提取的详细结果
        error: 错误信息（失败时返回）
    """

    success: bool
    data: Optional[RegexValidateExtractData] = None
    error: Optional[str] = None


@router.post(
    "/regex/validate-extract",
    response_model=RegexValidateExtractResponse,
    summary="批量验证数据并提取正则命名组",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def validate_and_extract_regex(request: RegexValidateExtractRequest):
    """批量验证数据并提取正则命名组

    对输入的一批数据值执行正则匹配：
    - 根据 regex_flags 和 case_sensitive 设置编译标志
    - 根据 match_mode 选择 match（完全匹配）或 search（部分匹配）
    - 对每条数据执行匹配，统计成功/失败数量
    - 提取所有命名捕获组的结果，按列组织

    Args:
        request: 包含正则模式、匹配模式和数据值的请求对象

    Returns:
        包含匹配统计和提取结果的响应对象
    """
    try:
        # 初始化正则编译标志
        flags = 0
        if "i" in request.regex_flags.lower():
            flags |= re.IGNORECASE  # 忽略大小写
        if "m" in request.regex_flags.lower():
            flags |= re.MULTILINE  # 多行模式
        if "s" in request.regex_flags.lower():
            flags |= re.DOTALL  # 点号匹配换行符
        if not request.case_sensitive:
            flags |= re.IGNORECASE  # 不区分大小写覆盖

        # 编译正则表达式
        compiled = re.compile(request.regex_pattern, flags)
        # 获取所有命名捕获组的名称
        group_names = list(compiled.groupindex.keys())
        # 初始化提取结果字典，每个组名对应一个空列表
        extracted_columns: dict[str, list[str]] = {name: [] for name in group_names}

        match_count = 0
        error_count = 0

        # 遍历每条数据值进行匹配
        for value in request.values:
            value_str = "" if value is None else str(value)
            if request.match_mode == "full":
                # 完全匹配：从字符串开头开始匹配
                match = compiled.match(value_str)
            else:
                # 部分匹配：在字符串中搜索匹配
                match = compiled.search(value_str)

            if match:
                match_count += 1
                groups = match.groupdict()
                for name in group_names:
                    extracted_columns[name].append("" if groups.get(name) is None else str(groups.get(name)))
            else:
                error_count += 1
                # 未匹配时，该行的所有提取列填入空字符串
                for name in group_names:
                    extracted_columns[name].append("")

        return {
            "success": True,
            "data": {
                "total_rows": len(request.values),
                "match_count": match_count,
                "error_count": error_count,
                "group_names": group_names,
                "extracted_columns": extracted_columns,
            },
        }
    except re.error as e:
        return {"success": False, "error": f"无效的正则表达式: {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
