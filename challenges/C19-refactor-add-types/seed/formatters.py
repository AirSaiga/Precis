"""C19 seed — 4 个未注解的格式化/校验辅助函数。任务：补完整类型注解，不改行为。"""


def _conditional_pre_check(df, column, kwargs):
    """条件预检：如果 kwargs 含 'enabled' 且为 False，返回跳过原因字符串；否则 None。"""
    if kwargs.get("enabled") is False:
        return f"列 '{column}' 的条件检查被禁用"
    if column not in df.columns:
        return f"列 '{column}' 不存在"
    return None


def _conditional_error_formatter(err):
    """把条件错误 dict 格式化为带前缀的新 dict。"""
    return {
        "type": "conditional",
        "original": err,
        "message": f"条件失败: {err.get('reason', '未知')}",
    }


def _fk_datasets_builder(df, column, kwargs):
    """构建外键校验用的数据集 dict。"""
    related = kwargs.get("related_table")
    if related is None:
        return {}
    return {
        "main": df,
        "foreign": {column: df[column].tolist()},
        "related_name": related,
    }


def _scripted_error_formatter(err):
    """把脚本错误 dict 格式化为标准错误格式。"""
    severity = err.get("severity", "error")
    return {
        "error_type": "ScriptedViolation",
        "severity": severity,
        "message": err.get("message", ""),
        "row_index": err.get("row", -1),
    }
