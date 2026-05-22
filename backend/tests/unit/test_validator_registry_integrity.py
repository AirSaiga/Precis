"""
@fileoverview 后端校验器注册完整性自检测试

核心职责：
- 确保 ValidationType 中定义的每个校验类型都在 UnifiedValidationService 中注册了对应的校验器
- 防止出现"前端发送 composite 校验请求，后端返回不支持的校验类型"的断裂

这是后端 API 层与领域模型同步的最小化自动检查。
"""

from app.shared.services.validation import UnifiedValidationService, ValidationType


class TestValidatorRegistryIntegrity:
    """校验器注册表完整性测试"""

    def test_all_validation_types_have_registered_validator(self):
        """
        检查 ValidationType 中定义的所有常量都在 UnifiedValidationService 中注册了校验器。

        如果某个类型在 ValidationType 中有定义，但 _validators 中没有对应实例，
        则调用 UnifiedValidationService.validate() 时会返回 "不支持的校验类型" 错误。
        """
        # 收集 ValidationType 中定义的所有常量值
        declared_types = set()
        for attr_name in dir(ValidationType):
            if attr_name.startswith("_"):
                continue
            value = getattr(ValidationType, attr_name)
            if isinstance(value, str):
                declared_types.add(value)

        # 收集 UnifiedValidationService 中已注册的校验器类型
        registered_types = set(UnifiedValidationService._validators.keys())

        missing = declared_types - registered_types
        extra = registered_types - declared_types

        assert missing == set(), f"以下 ValidationType 未注册校验器: {missing}"
        assert extra == set(), f"以下已注册校验器不在 ValidationType 中: {extra}"

    def test_all_registered_validators_are_callable(self):
        """
        检查所有已注册的校验器实例都实现了 validate 方法。

        防止注册时传入空对象或错误类型导致的运行时异常。
        """
        for vtype, validator in UnifiedValidationService._validators.items():
            assert hasattr(validator, "validate"), (
                f"校验器 '{vtype}' 缺少 validate 方法"
            )
            assert callable(getattr(validator, "validate")), (
                f"校验器 '{vtype}' 的 validate 不可调用"
            )
