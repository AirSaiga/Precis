"""
@fileoverview ManualData 配置模块

功能概述:
- 定义 ManualData 节点的数据模型 (ManualDataFile)
- 用于持久化画布上的内联测试数据节点

架构设计:
- ManualDataFile 对应 manual_data/*.yaml 配置文件
- 在 manifest 中通过 ManualDataRef 引用
- 模板展开时，模板内 manualData 节点展开为 ManualDataFile
"""
