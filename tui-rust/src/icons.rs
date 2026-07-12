//! 统一图标字典 — 所有 UI 字符集中定义，全部单宽几何符号
//!
//! 规则：
//! - 不用 emoji（双宽、渲染不一致）
//! - 不用 ⚙（双宽破坏对齐）
//! - 同一语义只用同一字符（如选中标记统一用 ▸）

/// Tab 导航图标（每个 tab 独特单宽几何符号）
pub mod tab {
    pub const DASHBOARD: &str = "◈";   // 首页 - 双层菱形
    pub const VALIDATION: &str = "◇";  // 校验 - 单菱形
    pub const PROVIDER: &str = "◆";    // Provider - 实心菱形
    pub const CONFIG: &str = "◉";      // 配置 - 同心圆
    pub const CHAT: &str = "◎";        // AI 对话 - 双环
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

/// braille spinner 帧（传入 frame_count，内部取模）
pub fn spinner(frame: u64) -> &'static str {
    match frame % 6 {
        0 => "⠋",
        1 => "⠙",
        2 => "⠹",
        3 => "⠸",
        4 => "⠼",
        _ => "⠴",
    }
}

/// 生成进度条字符串（默认 10 格）
/// ratio: 0.0..=1.0，超出范围自动 clamp
pub fn progress_bar(ratio: f64) -> String {
    progress_bar_total(ratio, crate::app::layout::PROGRESS_BAR_TOTAL)
}

/// 生成指定格数的进度条
pub fn progress_bar_total(ratio: f64, total: usize) -> String {
    let ratio = ratio.clamp(0.0, 1.0);
    let filled = (ratio * total as f64).round() as usize;
    let empty = total.saturating_sub(filled);
    format!("{}{}", "▰".repeat(filled), "▱".repeat(empty))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spinner_cycles() {
        assert_eq!(spinner(0), "⠋");
        assert_eq!(spinner(5), "⠴");
        assert_eq!(spinner(6), "⠋");
        assert_eq!(spinner(12), "⠋");
    }

    #[test]
    fn test_progress_bar_full() {
        assert_eq!(progress_bar(1.0), "▰▰▰▰▰▰▰▰▰▰");
    }

    #[test]
    fn test_progress_bar_half() {
        assert_eq!(progress_bar(0.5), "▰▰▰▰▰▱▱▱▱▱");
    }

    #[test]
    fn test_progress_bar_zero() {
        assert_eq!(progress_bar(0.0), "▱▱▱▱▱▱▱▱▱▱");
    }

    #[test]
    fn test_progress_bar_clamp() {
        assert_eq!(progress_bar(1.5), "▰▰▰▰▰▰▰▰▰▰");
        assert_eq!(progress_bar(-0.5), "▱▱▱▱▱▱▱▱▱▱");
    }

    #[test]
    fn test_progress_bar_custom_total() {
        assert_eq!(progress_bar_total(0.3, 10), "▰▰▰▱▱▱▱▱▱▱");
    }

    #[test]
    fn test_truncate_short() {
        assert_eq!(truncate("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_exact() {
        assert_eq!(truncate("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_long() {
        assert_eq!(truncate("hello world", 8), "hello w…");
    }
}
