"""TUI service 层模块。

每个 service 是对应屏的后端逻辑薄包装：接收 UI 输入，调用 app.shared.* 或
app.cli.shared_services.*（P0b 产出）完成业务，返回结果给屏渲染。service 不持有
UI 引用，便于在 mock 边界的单元测试中独立测试。
"""
