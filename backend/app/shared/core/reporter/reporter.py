"""@fileoverview 校验结果多渠道报告服务主入口

功能概述:
- ReportService 统一管理和调度所有激活的报告者策略
- 支持本地文件、邮件、企业微信、飞书、钉钉等多种报告渠道
- 从 YAML 配置文件读取报告器配置，动态加载和初始化

架构设计:
- 注册表模式: _reporter_registry 将配置名称映射到具体报告器类
- 配置驱动: 通过 reporting_config.yaml 控制启用哪些报告器
- 全局配置注入: 自动将全局配置（如 log_dir）合并到各报告器的配置中
- 故障隔离: 单个报告器配置失败不影响其他报告器的正常工作

输入示例:
    YAML 配置文件 (reporting_config.yaml):
    reporters:
      local_file:
        enabled: true
      email:
        enabled: true
        smtp_server: "smtp.example.com"
        smtp_port: 587
        sender_email: "precis@example.com"
        sender_password: "secret"
        receiver_email: "admin@example.com"

    调用代码:
    report_service = ReportService(base_dir="/path/to/project")
    report_service.report(errors)

输出示例:
    控制台输出:
    报告服务已初始化。
    正在配置报告者: 'local_file'...
    [LocalFileReporter] 日志目录已创建: /path/to/project/logs
    正在配置报告者: 'email'...
    [EmailReporter] ✓ 邮件服务配置验证成功，发件人: precis@example.com
    报告服务配置完成，共激活 2 个报告者。
    --- 开始报告 5 个错误 ---
    [LocalFileReporter] ✓ 成功将错误报告写入本地日志: ...
    [EmailReporter] ✓ 成功发送错误报告邮件至 admin@example.com。
    --- 报告流程结束 ---
"""

import json
import logging
import os

import yaml

from .reporters import (
    DingTalkAppReporter,
    EmailReporter,
    FeishuReporter,
    LocalFileReporter,
    Reporter,
    WeComAppReporter,
)

logger = logging.getLogger(__name__)

# ==============================================================================
# 报告服务中心
# ==============================================================================


class ReportService:
    """
    @classdesc 报告服务中心类。

    负责管理和调度所有激活的报告者策略。
    在初始化时从配置文件加载需要启用的报告者，
    在报告时将错误信息发送给所有激活的报告者。

    【属性说明】
    - base_dir: 项目根目录路径
    - config_path: 报告配置文件完整路径
    - _reporter_registry: 报告者注册表（名称到类的映射）
    - _active_reporters: 已激活的报告者实例列表

    【使用示例】
    >>> report_service = ReportService(base_dir='/path/to/project')
    >>> errors = [{'error_type': 'ValidationError', 'message': '数据校验失败'}]
    >>> report_service.report(errors)
    """

    def __init__(self, base_dir: str, config_filename: str = "reporting_config.yaml"):
        """
        初始化报告服务中心。

        【初始化流程】
        1. 设置项目根目录和配置文件路径
        2. 初始化报告者注册表
        3. 调用 _load_and_configure_reporters 加载配置

        :param base_dir: 项目根目录路径
        :param config_filename: 配置文件名，默认 'reporting_config.yaml'
        """
        self.base_dir = base_dir
        self.config_path = os.path.join(base_dir, config_filename)

        # 报告者注册表：将配置中的名称映射到对应的报告者类
        self._reporter_registry: dict[str, type[Reporter]] = {
            "local_file": LocalFileReporter,
            "email": EmailReporter,
            "wecom": WeComAppReporter,
            "feishu": FeishuReporter,
            "dingtalk": DingTalkAppReporter,
        }

        # 激活的报告者实例列表
        self._active_reporters: list[Reporter] = []
        logger.info("报告服务已初始化。")
        self._load_and_configure_reporters()

    def _load_and_configure_reporters(self):
        """
        @methoddesc 从配置文件加载并配置所有需要启用的报告者。

        【处理流程】
        1. 检查配置文件是否存在
        2. 读取并解析 YAML 配置文件
        3. 遍历配置中的 reporters 节点
        4. 对每个启用的报告者进行实例化和配置
        5. 将配置成功的报告者添加到激活列表

        【配置合并规则】
        - 全局配置（如 log_dir）会被自动注入
        - 报告者特定配置会覆盖全局配置
        """
        # 检查配置文件是否存在
        if not os.path.exists(self.config_path):
            logger.warning("报告配置文件 '%s' 未找到, 将不启用任何报告服务。", self.config_path)
            return

        try:
            # 读取并解析 YAML 配置文件
            with open(self.config_path, encoding="utf-8") as f:
                config = yaml.safe_load(f) or {}
        except Exception as e:
            logger.error("读取报告配置文件失败: %s", e)
            return

        # 全局配置，可被所有报告者共享
        global_config = {"log_dir": os.path.join(self.base_dir, "logs")}

        # 遍历配置文件中定义的 reporters
        for reporter_name, reporter_config in config.get("reporters", {}).items():
            # 检查报告者是否启用
            if not reporter_config.get("enabled", False):
                logger.info("报告者 '%s' 未启用，跳过。", reporter_name)
                continue

            # 检查报告者是否在注册表中
            if reporter_name in self._reporter_registry:
                reporter_class = self._reporter_registry[reporter_name]
                reporter_instance = reporter_class()

                # 合并全局配置和特定配置
                full_config = {**global_config, **reporter_config}

                logger.info("正在配置报告者: '%s'...", reporter_name)
                if reporter_instance.configure(**full_config):
                    self._active_reporters.append(reporter_instance)
                else:
                    logger.warning("报告者 '%s' 配置失败，将不被激活。", reporter_name)
            else:
                logger.warning("在报告者注册表中未找到名为 '%s' 的报告者。", reporter_name)

        logger.info("报告服务配置完成，共激活 %d 个报告者。", len(self._active_reporters))

    def report(self, errors: list[dict]):
        """
        @methoddesc 执行总报告流程。
        遍历所有激活的报告者并调用它们的 report 方法。

        【处理逻辑】
        1. 如果错误列表为空，直接返回（无需报告）
        2. 如果没有激活的报告者，将错误打印到控制台
        3. 否则，遍历所有激活的报告者发送报告

        :param errors: 错误信息字典列表
        """
        # 无错误时直接返回
        if not errors:
            logger.info("未发现错误，无需报告。")
            return

        # 无激活报告者时，打印到控制台作为后备（保留 print 确保错误在低日志级别下仍可见）
        if not self._active_reporters:
            logger.warning("无激活的报告者，错误将不会被报告。仅在控制台显示:")
            print(json.dumps(errors, indent=2, ensure_ascii=False))
            return

        # 遍历所有激活的报告者发送报告
        logger.info("--- 开始报告 %d 个错误 ---", len(errors))
        for reporter in self._active_reporters:
            reporter.report(errors)
        logger.info("--- 报告流程结束 ---")
