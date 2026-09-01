//! 统一图标字典 — 所有 UI 字符集中定义，全部单宽几何符号
//!
//! 规则：
//! - 不用 emoji（双宽、渲染不一致）
//! - 不用 ⚙（双宽破坏对齐）
//! - 同一语义只用同一字符（如选中标记统一用 ▸）

/// Tab 导航图标（每个 tab 独特单宽几何符号）
pub mod tab {
    pub const DASHBOARD: &str = "◈"; // 首页 - 双层菱形
    pub const VALIDATION: &str = "◇"; // 校验 - 单菱形
    pub const PROVIDER: &str = "◆"; // Provider - 实心菱形
    pub const CONFIG: &str = "◉"; // 配置 - 同心圆
    pub const CHAT: &str = "◎"; // AI 对话 - 双环
}

/// 状态指示符
pub mod status {
    pub const CONNECTED: &str = "●"; // 已连接/已打开
    pub const DISCONNECTED: &str = "○"; // 未连接/未打开
}

/// 成功/失败
pub mod result {
    pub const PASS: &str = "✓";
    pub const FAIL: &str = "✗";
    pub const WARN: &str = "!"; // 不用 ⚠（部分终端双宽）
}

/// 选中/高亮标记
pub const SELECTED: &str = "▸"; // 统一的选中前缀

/// 行首强调竖条（选中行 / 消息气泡角色条）
pub const BAR: &str = "▌";
/// 细强调竖条（消息气泡内容缩进）
pub const BAR_THIN: &str = "▎";

/// Tab 指示条字符
pub const INDICATOR: &str = "━";
/// 分隔线字符
pub const RULE: &str = "─";

/// 主题装饰符（徽标 / hero）
pub mod motif {
    pub const SAKURA: &str = "❀"; // 樱花
    pub const SNOW: &str = "❆"; // 雪花
}

/// 生成动态宽度的分隔线
pub fn divider(width: usize) -> String {
    RULE.repeat(width)
}

/// braille spinner 帧（传入 frame_count，内部取模，10 帧完整循环）
pub fn spinner(frame: u64) -> &'static str {
    match frame % 10 {
        0 => "⠋",
        1 => "⠙",
        2 => "⠹",
        3 => "⠸",
        4 => "⠼",
        5 => "⠴",
        6 => "⠦",
        7 => "⠧",
        8 => "⠇",
        _ => "⠏",
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

/// 单字符显示宽度：ASCII 1 cell，其余（CJK 等全宽字符）2 cell
/// （与 widgets::display_width 的宽度哲学一致，作为宽度计算的单一事实源）
pub fn char_width(c: char) -> usize {
    if c.is_ascii() {
        1
    } else {
        2
    }
}

/// 按显示宽度截断字符串并加省略号
/// `max` 语义为终端 cell 预算（CJK 占 2 cell）：显示宽 ≤ max 原样返回；
/// 超预算时截取到 max-1 个 cell 后追加 `…`。
/// `…` 按 1 cell 计（主流终端单宽渲染；这样纯 ASCII 行为与旧实现逐字节一致）
pub fn truncate(s: &str, max: usize) -> String {
    let total: usize = s.chars().map(char_width).sum();
    if total <= max {
        return s.to_string();
    }
    // … 按 1 cell 计（主流终端单宽渲染；保持纯 ASCII 行为与旧实现一致）
    let budget = max.saturating_sub(1);
    let mut out = String::new();
    let mut used = 0usize;
    for c in s.chars() {
        let cw = char_width(c);
        if used + cw > budget {
            break;
        }
        out.push(c);
        used += cw;
    }
    format!("{}…", out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spinner_cycles() {
        assert_eq!(spinner(0), "⠋");
        assert_eq!(spinner(5), "⠴");
        assert_eq!(spinner(9), "⠏");
        assert_eq!(spinner(10), "⠋");
        assert_eq!(spinner(21), "⠙");
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

    #[test]
    fn test_truncate_cjk_by_display_width() {
        // 9 字 = 18 cell > 8：截 3 字（6 cell）+ … = 7 ≤ 8
        assert_eq!(truncate("字段存在空值违反约束", 8), "字段存…");
    }

    #[test]
    fn test_truncate_cjk_narrow_budget() {
        // 5 字 = 10 cell > 6：截 2 字（4 cell）+ … = 5 ≤ 6
        assert_eq!(truncate("订单明细表", 6), "订单…");
    }

    #[test]
    fn test_truncate_cjk_exact_budget_returns_as_is() {
        // 4 字 = 8 cell 恰好等于预算：不截断、无省略号
        assert_eq!(truncate("订单明细", 8), "订单明细");
    }

    #[test]
    fn test_truncate_mixed_ascii_cjk() {
        // "users 表" = 5 + 1 + 2 = 8 cell ≤ 10：原样返回
        assert_eq!(truncate("users 表", 10), "users 表");
    }
}
