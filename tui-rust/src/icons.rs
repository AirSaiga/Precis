//! 统一图标字典 — 所有 UI 字符集中定义，全部单宽几何符号
//!
//! 规则：
//! - 不用 emoji（双宽、渲染不一致）
//! - 不用 ⚙（双宽破坏对齐）
//! - 同一语义只用同一字符（如选中标记统一用 ▸）

/// Tab 导航图标（单宽几何符号）
pub mod tab {
    pub const DASHBOARD: &str = "◇";
    pub const VALIDATION: &str = "◇";
    pub const PROVIDER: &str = "◇";
    pub const CONFIG: &str = "◇";
    pub const CHAT: &str = "◇";
}

/// 状态指示符
pub mod status {
    pub const CONNECTED: &str = "●";   // 已连接/已打开
    pub const DISCONNECTED: &str = "○"; // 未连接/未打开
    pub const LOADING: &str = "◐";      // 加载中
}

/// 成功/失败
pub mod result {
    pub const PASS: &str = "✓";
    pub const FAIL: &str = "✗";
    pub const WARN: &str = "!";  // 不用 ⚠（部分终端双宽）
}

/// 选中/高亮标记
pub const SELECTED: &str = "▸";  // 统一的选中前缀

/// Logo 字符
pub const LOGO: &str = "◇";

/// 生成动态宽度的分隔线
pub fn divider(width: usize) -> String {
    "─".repeat(width)
}

/// 截断字符串并加省略号
pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{}…", truncated)
    }
}
