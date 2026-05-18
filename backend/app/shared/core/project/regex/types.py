"""
@fileoverview 正则节点配置模块

功能概述:
- 定义 V2 正则节点的数据类型
- 支持直接模式和引用模式
- 使用 Pydantic BaseModel 进行数据验证

架构设计:
- 类型定义核心: Regex 节点配置的数据模型层
- 双模式设计: pattern 字段直接编写，uses_pattern 字段引用预定义模式
- 自定义验证: 使用 model_validator 实现业务级校验逻辑

输入示例:
    RegexNodeFile(
        version=2,
        id="phone",
        name="手机号校验",
        uses_pattern=PatternRef(registry="patterns", pattern_name="phone_cn"),
        match_mode="full",
        enabled=True,
    )

输出示例:
    data = node.model_dump(exclude_none=True)
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class RegexSourceRef(BaseModel):
    """
    @classdesc 上游表列引用。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.regex.yaml 中的 source_ref 字段：

    ```yaml
    # *.regex.yaml 中的 source_ref 配置
    source_ref:
      table_id: users           # 上游表的 ID
      column_id: phone         # 上游列的 ID
    ```

    ============================================================================
    字段映射说明
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 |
    |----------|------------|---------|------|
    | table_id | table_id | str | 上游表的 ID |
    | column_id | column_id | str | 上游列的 ID |

    ============================================================================
    业务场景 (这个类在什么地方被使用)
    ============================================================================
    - 场景1: 重建画布连线关系
      在 UI 上显示 Regex 节点与其他节点之间的连线时使用。

    - 场景2: 数据流追踪
      追踪数据的来源和走向。

    :param table_id: 上游表的 ID
    :param column_id: 上游列的 ID
    """

    # 上游表的 ID
    table_id: str
    # 上游列的 ID
    column_id: str


class PatternRef(BaseModel):
    """
    @classdesc 引用 patterns 中已注册的表达式模式。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.regex.yaml 中的 uses_pattern 字段：

    ```yaml
    # *.regex.yaml 中的 uses_pattern 配置
    uses_pattern:
      registry: patterns           # 注册表类型
      pattern_name: email_validation  # 引用的表达式名称
      as_alias: personal_email    # 可选的别名
    ```

    ============================================================================
    字段映射说明
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 | 示例值 |
    |----------|------------|---------|------|-------|
    | registry | registry | Literal | 注册表类型 | "patterns" |
    | pattern_name | pattern_name | str | 表达式名称 | "email_validation" |
    | as_alias | as_alias | Optional[str] | 可选别名 | "personal_email" |

    ============================================================================
    业务场景 (这个类在什么地方被使用)
    ============================================================================
    - 场景1: 复用预定义表达式
      使用已注册的表达式模式，避免重复定义。

    - 场景2: 统一管理
      所有表达式在一个地方管理，方便修改。

    :param registry: 注册表类型
    :param pattern_name: 引用的表达式名称
    :param as_alias: 可选别名
    """

    # 注册表类型，目前固定为 patterns
    # patterns 是存放预定义正则表达式的目录
    registry: Literal["patterns"] = Field(..., description="注册表类型：patterns（表达式模式）")
    # 引用的表达式名称，对应 YAML 文件中的 name 字段
    # 在 patterns/ 目录下的各个 YAML 文件中定义
    pattern_name: str = Field(..., description="引用的表达式名称（对应 YAML 中的 name 字段）")
    # 可选的别名，用于在当前节点中二次命名
    # 当需要在同一节点中多次使用同一模式，但参数不同时使用
    as_alias: str | None = Field(None, description="可选的别名，用于在当前节点中二次命名")


class RegexNodeFile(BaseModel):
    r"""
    @classdesc 单条 Regex 节点文件内容（前端画布 Regex 节点落盘）。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应整个 *.regex.yaml 文件：

    ```yaml
    # ============================================================
    # 正则节点配置文件 (*.regex.yaml)
    # ============================================================
    # Regex 节点用于定义数据校验规则，通过正则表达式匹配数据
    # 支持两种配置模式：引用模式（推荐）和直接模式

    # 配置版本号，固定为 2
    version: 2

    # Regex 节点 ID（稳定的唯一标识符）
    id: phone_number

    # Regex 节点名称（展示用）
    name: 手机号校验

    # 节点的描述信息
    description: "校验中国大陆手机号格式"

    # ========== 引用模式（推荐使用）==========
    uses_pattern:
      registry: patterns
      pattern_name: phone_cn

    # 对引用表达式的覆盖配置
    pattern_overrides:
      flags: "i"

    # ========== 直接模式（兼容使用）==========
    # pattern: "^1[3-9]\\d{9}$"

    # ========== 通用配置 ==========
    match_mode: full              # full: 完全匹配 / partial: 部分匹配 / extract: 提取
    case_sensitive: false         # 是否区分大小写
    flags: ""                     # 正则 flags 字符串
    enabled: true                 # 是否启用该节点
    parameters: []                # 参数列表（保留字段）
    rules: []                     # 规则列表（前端 RegexDesign 结构）

    # 上游表列引用（用于重建画布中的连线关系）
    source_ref:
      table_id: users
      column_id: phone

    # 上游列名（兼容/展示用）
    source_column_name: phone
    ```

    ============================================================================
    字段映射说明 (YAML 如何变成 Python 对象)
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 | 示例值 |
    |----------|------------|---------|------|-------|
    | version | version | int | 配置版本号 | 2 |
    | id | id | str | Regex 节点 ID | "phone_number" |
    | name | name | str | 节点名称 | "手机号校验" |
    | description | description | Optional[str] | 节点描述 | "校验手机号格式" |
    | uses_pattern | uses_pattern | Optional[PatternRef] | 引用模式 | PatternRef(...) |
    | pattern_overrides | pattern_overrides | Dict[str, Any] | 覆盖配置 | {"flags": "i"} |
    | pattern | pattern | Optional[str] | 直接模式 | "^1[3-9]\\d{9}$" |
    | match_mode | match_mode | Literal | 匹配模式 | "full" |
    | case_sensitive | case_sensitive | bool | 大小写敏感 | false |
    | flags | flags | str | 正则 flags | "i" |
    | enabled | enabled | bool | 是否启用 | true |
    | parameters | parameters | List[Dict] | 参数列表 | [] |
    | rules | rules | List[Dict] | 规则列表 | [] |
    | source_ref | source_ref | Optional[RegexSourceRef] | 上游引用 | RegexSourceRef(...) |
    | source_column_name | source_column_name | Optional[str] | 上游列名 | "phone" |

    ============================================================================
    业务场景 (这个类在什么地方被使用)
    ============================================================================
    - 场景1: 创建正则校验节点
      用户在 UI 上创建一个正则校验节点，配置校验规则。

    - 场景2: 加载正则节点配置
      系统读取 *.regex.yaml 文件，解析为 RegexNodeFile 对象。

    - 场景3: 保存正则节点配置
      用户修改正则节点配置后，将 RegexNodeFile 对象写回 YAML 文件。

    ============================================================================
    两种模式对比
    ============================================================================
    模式1: 引用模式（uses_pattern）
    优点：
      - 复用性：同一表达式可在多个节点中使用
      - 可维护性：修改表达式定义后，所有引用自动更新
      - 灵活性：通过 pattern_overrides 支持局部配置覆盖
      - 可追踪：方便了解表达式的来源和用途

    模式2: 直接模式（pattern）
    优点：
      - 简单快捷：无需预先定义表达式
      - 适合一次性场景

    缺点：
      - 难以复用
      - 修改需遍历所有使用位置

    推荐：优先使用引用模式

    ============================================================================
    验证器说明
    ============================================================================
    1. _validate_pattern_mode:
       - 功能：验证必须使用引用模式或直接模式之一
       - 触发时机：模型验证阶段（mode="after"）
       - 目的：确保模式配置正确
       - 异常：ValueError - 当两种模式同时使用或都未使用时

    ============================================================================
    使用示例
    ============================================================================
    【创建引用模式节点】
    ```python
    from app.shared.core.project.regex.types import RegexNodeFile, PatternRef, RegexSourceRef

    node = RegexNodeFile(
        version=2,
        id="phone_number",
        name="手机号校验",
        description="校验中国大陆手机号格式",
        uses_pattern=PatternRef(
            registry="patterns",
            pattern_name="phone_cn"
        ),
        pattern_overrides={"flags": "i"},
        match_mode="full",
        source_ref=RegexSourceRef(
            table_id="users",
            column_id="phone"
        )
    )
    ```

    【创建直接模式节点】
    ```python
    node = RegexNodeFile(
        id="email_direct",
        name="邮箱校验",
        pattern=r"^[\w\.-]+@[\w\.-]+\.\w+$",
        match_mode="full"
    )
    ```

    【从 YAML 加载】
    ```python
    raw = read_yaml(Path("regex_nodes/phone_number.regex.yaml"))
    node = RegexNodeFile.model_validate(raw)
    ```
    """

    # 配置版本号，固定为 2
    version: int = Field(2, description="配置版本号（固定为 2）")
    # Regex 节点 ID，稳定的唯一标识符
    id: str = Field(..., description="Regex 节点 ID（稳定标识）")
    # Regex 节点名称，用于展示和识别
    name: str = Field(..., description="Regex 节点名称（展示用）")
    # 节点的描述信息，说明节点的用途
    description: str | None = Field(None, description="描述")

    # ========== 引用模式（推荐使用） ==========
    # 引用已注册的表达式模式，便于复用和管理
    # 当使用此字段时，pattern 字段应为空
    uses_pattern: PatternRef | None = Field(None, description="引用已注册的表达式模式（推荐使用，便于复用和管理）")
    # 对引用表达式的覆盖配置
    # 允许在引用时修改原始表达式的某些参数
    # 支持的配置项：flags（正则标志）、case_sensitive（大小写敏感）等
    pattern_overrides: dict[str, Any] | None = Field(
        default_factory=dict, description="对引用表达式的覆盖配置（如 flags、case_sensitive 等）"
    )

    # ========== 直接模式（兼容使用） ==========
    # 直接编写正则表达式字符串
    # 建议使用 uses_pattern 引用模式，便于维护
    pattern: str | None = Field(None, description="直接的正则表达式（建议使用 uses_pattern 引用模式）")

    # ========== 通用配置 ==========
    # 匹配模式，决定如何应用正则表达式
    # - full: 完全匹配（整个字符串符合正则）
    # - partial: 部分匹配（字符串包含符合正则的部分）
    # - extract: 提取模式（提取匹配的部分）
    match_mode: Literal["full", "partial", "extract"] = Field("full", description="匹配模式")
    # 是否区分大小写
    case_sensitive: bool = Field(False, description="是否区分大小写")
    # 正则 flags 字符串
    # 支持：i (ignorecase), m (multiline), s (dotall) 等
    flags: str = Field("", description="正则 flags 字符串")
    # 是否启用该节点
    # 禁用时在数据校验中会跳过该节点
    enabled: bool = Field(True, description="是否启用")
    # 参数列表，保留字段，用于前端扩展
    parameters: list[dict[str, Any]] = Field(default_factory=list, description="参数列表（保留）")
    # 规则列表，存储前端的 RegexDesign 结构
    # 用于可视化编辑时的数据持久化
    rules: list[dict[str, Any]] = Field(default_factory=list, description="规则列表（前端 RegexDesign 结构）")
    # 数据流输入接口（新增）
    # 若存在，优先于 source_ref 使用
    input_from_node: str | None = Field(None, description="上游数据流节点 ID（优先于 source_ref）")
    input_column: str | None = Field(None, description="上游节点中的目标列名")

    # Extract 模式专用配置
    # 当 match_mode="extract" 时，定义捕获组到输出列的映射
    capture_groups: list[dict[str, Any]] = Field(
        default_factory=list, description="Extract 模式下的捕获组定义 [{name, group_index}]"
    )
    output_columns: list[str] = Field(default_factory=list, description="Extract 模式下的输出列名列表")

    # 上游表列引用，用于重建画布中的连线关系
    source_ref: RegexSourceRef | None = Field(None, description="上游表列引用（用于重建连线）")
    # 上游列名，兼容/展示用
    source_column_name: str | None = Field(None, description="上游列名（兼容/展示用）")

    @model_validator(mode="after")
    def _validate_pattern_mode(self) -> RegexNodeFile:
        """
        @methoddesc 验证必须使用引用模式或直接模式之一。

        处理流程：
        1. 检查 uses_pattern 字段是否有值（引用模式）
        2. 检查 pattern 字段是否有值（直接模式）
        3. 验证两种模式的互斥关系：
           - 不能同时使用两者
           - 必须至少使用其中之一

        :return: 验证通过的 RegexNodeFile 对象
        :raises ValueError: 当模式配置不符合要求时
        """
        # 检查是否使用了引用模式
        has_ref = self.uses_pattern is not None
        # 检查是否使用了直接模式（需要非空且非空白字符串）
        has_direct = self.pattern is not None and self.pattern.strip() != ""

        # 验证：不能同时使用两种模式
        if has_ref and has_direct:
            raise ValueError("不能同时使用 'uses_pattern' 引用模式和 'pattern' 直接模式，请选择其一")

        # 验证：必须至少使用一种模式
        if not has_ref and not has_direct:
            raise ValueError("必须使用 'uses_pattern' 引用模式或 'pattern' 直接模式之一")

        return self


# 兼容别名
# 提供 V2 版本标识的别名，便于后续版本升级时的迁移
RegexSourceRefV2 = RegexSourceRef
PatternRefV2 = PatternRef
RegexNodeFileV2 = RegexNodeFile
