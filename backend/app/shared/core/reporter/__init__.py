"""
@fileoverview 校验结果多渠道报告器模块包入口

功能概述:
- 提供数据校验结果的多渠道报告能力
- 支持本地文件、邮件、企业微信、飞书、钉钉等多种报告渠道
- 通过 ReportService 统一管理和调度所有报告器

架构设计:
- 策略模式 (Strategy Pattern): 各报告器继承自 Reporter 抽象基类，实现统一的 configure() 和 report() 接口
- 注册表模式: ReportService 维护报告者注册表，根据配置动态激活对应的报告器
- 统一入口: 外部通过 ReportService 调用，无需关心底层具体报告器的实现细节

输入示例:
    通过 ReportService 传入错误列表:
    errors = [
        {
            "error_type": "TypeValidationError",
            "row_index": 2,
            "column": "age",
            "value": "abc",
            "error_message": "必须是整数"
        }
    ]

输出示例:
    各报告器将错误信息发送到对应渠道:
    - 本地文件: 生成 JSON 日志文件到 logs/error_report_20240115_143052.json
    - 邮件: 发送 HTML 格式邮件到指定收件箱
    - 企业微信/飞书/钉钉: 推送 Markdown/卡片消息到对应应用
"""
