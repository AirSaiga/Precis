"""
@fileoverview Schema ID 生成与解析模块

功能概述:
- 提供 Schema ID 的生成、解析、编码、解码功能
- 支持从文件路径和工作表名自动生成稳定的 ID
- ID 使用 Base64 + XOR 编码保护原始路径信息

架构设计:
- 两步生成: raw_id (可读) -> encoded_id (稳定)
- ID 格式: sc_<base64-encoded>
- 兼容旧版: 支持从旧格式 ID (如 sc_xxx-table) 提取信息

原理说明:
    为什么需要编码 ID?
    1. 保护敏感路径信息不暴露在 ID 中
    2. 提供稳定的 ID，不随文件路径改变而改变
    3. 避免特殊字符问题

    编码流程:
    1. 构建 raw_id: "相对路径|工作表名" (如 "data/users.xlsx|Sheet1")
    2. XOR 混淆: 使用密钥对字节进行 XOR 操作
    3. Base64 编码: URL-safe 编码
    4. 添加前缀: sc_ 前缀标识

输入示例:
    file_path = "data/users.xlsx"
    sheet_name = "Sheet1"

    # 构建 raw_id
    raw_id = "data/users.xlsx|Sheet1"

    # 编码后的 ID
    encoded_id = "sc_xxxencodedstring..."

输出示例:
    # 编码
    generate_schema_id("data/users.xlsx", "Sheet1")
    # 结果: "sc_..."

    # 解码
    decode_schema_id("sc_...")
    # 结果: "data/users.xlsx|Sheet1"

    # 提取工作表名
    extract_sheet_from_id("sc_...")
    # 结果: "Sheet1"

    # 判断是否为 Excel 文件
    is_excel_schema("sc_...")
    # 结果: True
"""

from __future__ import annotations

# Schema ID 的固定前缀，用于标识这是一个 schema ID
SCHEMA_ID_PREFIX = "sc_"
# XOR 混淆使用的密钥，用于编码/解码时加解密原始路径信息
SCHEMA_ID_SECRET = "precis-schema-id-secret-v1"
# 源文件根目录测试值（用于路径标准化时裁剪前缀）
SCHEMA_SOURCE_ROOT_TEST = ""


def _normalize_rel_path_key(file_path: str) -> str:
    """@methoddesc 标准化相对路径，用于构建 raw_id

    处理流程：
    1. 将反斜杠替换为正斜杠，统一路径格式
    2. 去除开头的 "./" 前缀
    3. 如果是绝对路径，提取 data/ 之后的部分
    4. 如果配置了 SCHEMA_SOURCE_ROOT_TEST，裁剪该前缀
    5. 使用 pathlib 进一步标准化路径
    6. 转为小写，保证一致性

    参数说明:
        :param file_path: 原始文件路径（可能包含反斜杠、./ 等）
        :return: 标准化后的相对路径字符串

    示例:
        >>> _normalize_rel_path_key("data\\\\users.xlsx")
        'data/users.xlsx'
        >>> _normalize_rel_path_key("./data/users.xlsx")
        'data/users.xlsx'
        >>> _normalize_rel_path_key("D:/project/qa_test/qa_simple/data/orders.csv")
        'data/orders.csv'
    """
    from pathlib import Path, PurePosixPath

    # 将反斜杠统一替换为正斜杠，去除首尾空白
    p = str(file_path or "").replace("\\", "/").strip()
    # 去除开头的 "./" 前缀
    if p.startswith("./"):
        p = p[2:]

    # 绝对路径：提取 data/ 之后的部分，确保与相对路径生成相同 ID
    if p.startswith("/") or (len(p) > 1 and p[1] == ":"):
        parts = PurePosixPath(p.lower()).parts
        for i, part in enumerate(parts):
            if part == "data" and i + 1 < len(parts):
                p = str(PurePosixPath(*parts[i:]))
                break

    # 如果配置了源根目录，裁剪该前缀（用于统一不同环境的路径差异）
    root = str(SCHEMA_SOURCE_ROOT_TEST or "").replace("\\", "/").strip().rstrip("/")
    if root:
        p_lower = p.lower()
        root_lower = root.lower()
        # 如果路径完全等于根目录，返回空字符串
        if p_lower == root_lower:
            return ""
        # 如果路径以根目录开头，裁剪根目录前缀
        if p_lower.startswith(root_lower + "/"):
            p = p[len(root) + 1 :]

    # 使用 pathlib 进一步标准化路径（如处理 a/b/../c -> a/c）
    p = str(Path(p).as_posix())
    # 再次去除可能产生的 "./" 前缀
    if p.startswith("./"):
        p = p[2:]
    # 转为小写，保证同一文件的不同大小写写法生成相同 ID
    return p.lower()


def _normalize_sheet_key(file_path: str, sheet_name: str | None) -> str:
    """@methoddesc 标准化工作表名，用于构建 raw_id

    对于 Excel 文件，使用实际的工作表名；
    对于其他文件（如 CSV），使用文件名（不含扩展名）作为 sheet_key。

    参数说明:
        :param file_path: 文件路径（用于判断文件类型）
        :param sheet_name: Excel 工作表名（仅 Excel 文件需要）
        :return: 标准化后的 sheet_key 字符串

    示例:
        >>> _normalize_sheet_key("data/users.xlsx", "Sheet1")
        'sheet1'
        >>> _normalize_sheet_key("data/users.csv", None)
        'users'
    """
    from pathlib import Path

    # 获取文件扩展名（小写）
    ext = Path(file_path or "").suffix.lower()
    # Excel 文件使用提供的工作表名
    if ext in [".xlsx", ".xls"]:
        return (sheet_name or "").strip().lower()
    # 非 Excel 文件使用文件名（不含扩展名）
    return Path(file_path or "").stem.strip().lower()


def _xor_bytes(data: bytes, secret: str) -> bytes:
    """@methoddesc 对字节数据进行 XOR 混淆

    使用密钥的 UTF-8 编码字节循环对数据进行 XOR 操作。
    XOR 是可逆运算，相同的密钥可以加密也可以解密。

    参数说明:
        :param data: 原始字节数据
        :param secret: 密钥字符串
        :return: XOR 混淆后的字节数据

    示例:
        >>> _xor_bytes(b"hello", "key")
        b'...'
        >>> _xor_bytes(_, "key")  # 再次 XOR 即可还原
        b'hello'
    """
    # 将密钥转换为字节序列
    key = secret.encode("utf-8")
    # 如果密钥为空，直接返回原始数据（不做混淆）
    if not key:
        return data
    # 循环使用密钥的每个字节对数据进行 XOR
    # i % len(key) 保证密钥可以循环使用（密钥比数据短也没关系）
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def encode_schema_raw_id(raw: str) -> str:
    """@methoddesc 将原始 ID 字符串编码为 Schema ID

    编码流程：
    1. 将原始字符串编码为 UTF-8 字节
    2. 使用 XOR 混淆字节数据（密钥为 SCHEMA_ID_SECRET）
    3. 使用 URL-safe Base64 编码混淆后的字节
    4. 去除 Base64 填充字符 "="
    5. 添加 "sc_" 前缀

    参数说明:
        :param raw: 原始 ID 字符串（如 "data/users.xlsx|sheet1"）
        :return: 编码后的 Schema ID（如 "sc_abc123..."）

    示例:
        >>> encode_schema_raw_id("data/users.xlsx|sheet1")
        'sc_abc123...'
    """
    import base64

    # 将原始字符串编码为 UTF-8 字节序列
    raw_bytes = (raw or "").encode("utf-8")
    # 使用 XOR 混淆字节数据，保护原始路径信息
    xored = _xor_bytes(raw_bytes, SCHEMA_ID_SECRET)
    # 使用 URL-safe Base64 编码（避免 + 和 / 字符，适合用在 URL 中）
    # 去除末尾的 "=" 填充字符，使 ID 更简洁
    b64 = base64.urlsafe_b64encode(xored).decode("ascii").rstrip("=")
    # 添加固定前缀，标识这是一个 Schema ID
    return f"{SCHEMA_ID_PREFIX}{b64}"


def decode_schema_id(schema_id: str) -> str | None:
    """@methoddesc 将 Schema ID 解码为原始字符串

    解码流程（编码的逆过程）：
    1. 检查 ID 是否以 "sc_" 开头
    2. 去除 "sc_" 前缀，获取 Base64 编码的载荷
    3. 补充 Base64 填充字符 "="（使其长度为 4 的倍数）
    4. URL-safe Base64 解码为字节
    5. 使用 XOR 解密（相同的密钥可逆）
    6. 将字节解码为 UTF-8 字符串

    参数说明:
        :param schema_id: 编码后的 Schema ID（如 "sc_abc123..."）
        :return: 原始字符串，如果解码失败返回 None

    示例:
        >>> decode_schema_id("sc_abc123...")
        'data/users.xlsx|sheet1'
        >>> decode_schema_id("invalid")
        None
    """
    import base64

    # 空值或前缀不匹配时，无法解码，返回 None
    if not schema_id or not schema_id.startswith(SCHEMA_ID_PREFIX):
        return None
    # 去除 "sc_" 前缀，获取 Base64 载荷
    payload = schema_id[len(SCHEMA_ID_PREFIX) :]
    # Base64 解码要求字符串长度为 4 的倍数，计算需要补充的 "=" 数量
    # (-len(payload)) % 4 等价于 (4 - len(payload) % 4) % 4
    pad_len = (-len(payload)) % 4
    payload_padded = payload + ("=" * pad_len)
    try:
        # URL-safe Base64 解码为原始字节
        decoded = base64.urlsafe_b64decode(payload_padded.encode("ascii"))
    except Exception:
        # 解码失败（如非法字符），返回 None
        return None
    # 使用相同的密钥进行 XOR 解密（XOR 运算的逆运算就是再次 XOR）
    raw = _xor_bytes(decoded, SCHEMA_ID_SECRET).decode("utf-8", errors="replace")
    return raw


def build_schema_raw_id(file_path: str, sheet_name: str | None) -> str:
    """@methoddesc 构建原始 ID 字符串（编码前的可读形式）

    将文件路径和工作表名组合为 "路径|工作表名" 的格式。
    路径和工作表名都会经过标准化处理。

    参数说明:
        :param file_path: 文件路径（相对或绝对）
        :param sheet_name: Excel 工作表名（非 Excel 文件可传 None）
        :return: 原始 ID 字符串（如 "data/users.xlsx|sheet1"）

    示例:
        >>> build_schema_raw_id("data/users.xlsx", "Sheet1")
        'data/users.xlsx|sheet1'
        >>> build_schema_raw_id("data/users.csv", None)
        'data/users.csv|users'
    """
    # 标准化文件路径
    rel_path_key = _normalize_rel_path_key(file_path)
    # 标准化工作表名
    sheet_key = _normalize_sheet_key(file_path, sheet_name)
    # 使用 "|" 分隔路径和工作表名，形成唯一的原始 ID
    return f"{rel_path_key}|{sheet_key}"


def generate_schema_id(file_path: str, sheet_name: str | None) -> str:
    """@methoddesc 生成 Schema ID

    这是生成 Schema ID 的主入口函数，封装了完整的编码流程：
    1. 构建原始 ID（build_schema_raw_id）
    2. 编码为 Schema ID（encode_schema_raw_id）

    参数说明:
        :param file_path: 数据文件路径
        :param sheet_name: Excel 工作表名（非 Excel 文件可传 None）
        :return: 编码后的 Schema ID（如 "sc_abc123..."）

    示例:
        >>> generate_schema_id("data/users.xlsx", "Sheet1")
        'sc_abc123...'
    """
    # 第一步：构建可读原始 ID
    raw = build_schema_raw_id(file_path, sheet_name)
    # 第二步：编码为最终的 Schema ID
    return encode_schema_raw_id(raw)


def extract_sheet_from_id(id: str) -> str | None:
    """@methoddesc 从 Schema ID 中提取工作表名

    解码 Schema ID 后，按 "|" 分割字符串，取后半部分作为工作表名。
    对于旧版 ID 格式（如 "sc_xxx-sheetname"），使用 "-" 分割提取。

    参数说明:
        :param id: Schema ID（编码后的字符串）
        :return: 工作表名，如果无法提取返回 None

    示例:
        >>> extract_sheet_from_id("sc_abc123...")  # 解码后为 "data/users.xlsx|sheet1"
        'sheet1'
        >>> extract_sheet_from_id("sc_xxx-orders")  # 旧版格式
        'orders'
    """
    # 尝试解码编码格式的 ID
    raw = decode_schema_id(id)
    if raw:
        # 编码格式："路径|工作表名"，按 "|" 分割
        parts = raw.split("|", 1)
        # 如果有两部分，返回第二部分（工作表名）
        return parts[1] if len(parts) == 2 else None
    # 解码失败时，尝试旧版格式 "前缀-工作表名"
    if "-" in id:
        return id.split("-", 1)[1]
    return None


def is_excel_schema(id: str) -> bool:
    """@methoddesc 判断 Schema ID 是否对应 Excel 文件

    解码 Schema ID 后，检查路径部分是否以 .xlsx 或 .xls 结尾。
    对于旧版 ID，只要有 "-" 就假设是 Excel（因为旧版 ID 含 sheet 名）。

    参数说明:
        :param id: Schema ID
        :return: True 表示对应 Excel 文件，False 表示其他格式

    示例:
        >>> is_excel_schema("sc_abc...")  # 解码后路径为 "data/users.xlsx"
        True
        >>> is_excel_schema("sc_abc...")  # 解码后路径为 "data/users.csv"
        False
    """
    # 尝试解码 ID 获取原始路径
    raw = decode_schema_id(id)
    if raw:
        # 按 "|" 分割，取第一部分（文件路径）
        rel_path = raw.split("|", 1)[0]
        # 检查文件扩展名是否为 Excel 格式
        return rel_path.lower().endswith(".xlsx") or rel_path.lower().endswith(".xls")
    # 无法解码时，使用旧版规则：有 "-" 的就是 Excel
    return "-" in id
