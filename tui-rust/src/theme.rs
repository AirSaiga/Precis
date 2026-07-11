//! 主题持久化 — 保存/加载到 ~/.precis/tui-theme.json

use crate::app::Theme;
use std::fs;
use std::io;

/// 主题配置文件路径：~/.precis/tui-theme.json
fn theme_file_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".precis").join("tui-theme.json"))
}

/// 保存主题到本地文件
pub fn save_theme(theme: Theme) {
    let Some(path) = theme_file_path() else {
        return;
    };
    // 确保目录存在
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let content = format!("{{\"theme\":{}}}", theme.idx());
    let _ = fs::write(&path, content);
}

/// 从本地文件加载主题，失败时默认 Sakura
pub fn load_theme() -> Theme {
    let Some(path) = theme_file_path() else {
        return Theme::Sakura;
    };
    match fs::read_to_string(&path) {
        Ok(content) => {
            // 简单解析 {"theme":N} — 不引入 serde 反序列化开销
            if let Some(idx) = parse_theme_idx(&content) {
                Theme::from_idx(idx)
            } else {
                Theme::Sakura
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Theme::Sakura,
        Err(_) => Theme::Sakura,
    }
}

/// 从 JSON 字符串中提取 theme 字段值
fn parse_theme_idx(content: &str) -> Option<usize> {
    // 简单正则-free 解析：找 "theme": 后面的数字
    let key = "\"theme\"";
    let pos = content.find(key)?;
    let after = &content[pos + key.len()..];
    // 跳过 : 和空白
    let after = after.trim_start();
    let after = after.strip_prefix(':')?;
    let after = after.trim_start();
    // 取连续数字
    let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid() {
        assert_eq!(parse_theme_idx("{\"theme\":0}"), Some(0));
        assert_eq!(parse_theme_idx("{\"theme\":1}"), Some(1));
        assert_eq!(parse_theme_idx("  { \"theme\" :  1  } "), Some(1));
    }

    #[test]
    fn test_parse_invalid() {
        assert_eq!(parse_theme_idx("{}"), None);
        assert_eq!(parse_theme_idx(""), None);
        assert_eq!(parse_theme_idx("not json"), None);
    }

    #[test]
    fn test_theme_roundtrip() {
        assert_eq!(Theme::from_idx(0), Theme::Sakura);
        assert_eq!(Theme::from_idx(1), Theme::Snow);
        assert_eq!(Theme::from_idx(99), Theme::Sakura); // 越界回退
    }
}
