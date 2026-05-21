"""
@fileoverview 可复用约束模板模块

功能概述:
- 定义模板数据模型 (TemplateFile)
- 提供模板 YAML 读取器 (reader)
- 提供模板展开器 (expander)

架构设计:
- 模板是配置层概念，在项目加载阶段展开为标准 TransformFile/ConstraintFile/RegexNodeFile
- 校验引擎（DAG Builder + Validator）无需任何修改
"""
