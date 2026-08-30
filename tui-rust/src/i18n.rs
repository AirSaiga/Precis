//! 界面文案 i18n — 中英双语，co-located 词对 + thread_local 当前语言（对齐 app.rs 主题的 thread_local 模式）
//!
//! 用法：各调用点用 `pick("中文原文", "English text")` 就地给出双语词对，
//! 返回当前语言对应的文案。默认中文；`main()` 启动最早期调用一次
//! [`init_from_env()`]，按 `PRECIS_LANG` → `LC_ALL` → `LC_CTYPE` → `LANG`
//! 顺序探测（值含 "en" 切英文）。
//!
//! 注意：thread_local 不随线程继承。多线程运行时的 worker 线程（tokio::spawn
//! 后台任务所在）由 `main.rs` 的 `build_runtime` 经 `on_thread_start` 注入同一
//! 语言；在其他运行时或裸线程上调用 `pick()` 将得到默认中文。

use std::cell::RefCell;

/// 界面语言
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Lang {
    /// 简体中文（默认）
    ZhCn,
    /// English（US）
    EnUs,
}

thread_local! {
    static LANG: RefCell<Lang> = RefCell::new(Lang::ZhCn);
}

/// 设置当前线程的界面语言
pub fn set_lang(lang: Lang) {
    LANG.with(|l| *l.borrow_mut() = lang);
}

/// 获取当前线程的界面语言
pub fn lang() -> Lang {
    LANG.with(|l| *l.borrow())
}

/// 纯函数便于测试：从环境变量查找结果推断语言。
/// 查找顺序：PRECIS_LANG → LC_ALL → LC_CTYPE → LANG；值含 "zh" → ZhCn，含 "en" → EnUs，其他/None → 默认 ZhCn
fn detect_lang(get: impl Fn(&str) -> Option<String>) -> Lang {
    for key in ["PRECIS_LANG", "LC_ALL", "LC_CTYPE", "LANG"] {
        if let Some(value) = get(key) {
            // 只看顺序中第一个已设置的变量；显式设置的其他值（如 "C"/"POSIX"）视为默认中文
            let v = value.to_lowercase();
            if v.contains("zh") {
                return Lang::ZhCn;
            }
            if v.contains("en") {
                return Lang::EnUs;
            }
            return Lang::ZhCn;
        }
    }
    Lang::ZhCn
}

/// 启动时调用一次：用 std::env::var 按上述顺序探测
pub fn init_from_env() {
    let detected = detect_lang(|key| std::env::var(key).ok());
    set_lang(detected);
}

/// co-located 词对：返回当前语言对应的文案
pub fn pick(zh: &'static str, en: &'static str) -> &'static str {
    match lang() {
        Lang::ZhCn => zh,
        Lang::EnUs => en,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 从 (变量名, 值) 列表构造探测闭包（未列出的变量视为 None，避免改进程环境变量）
    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
        }
    }

    #[test]
    fn detect_lang_defaults_to_zh_when_no_vars_set() {
        assert_eq!(detect_lang(|_| None), Lang::ZhCn);
    }

    #[test]
    fn detect_lang_precis_lang_takes_priority_over_lang() {
        let get = env(&[("PRECIS_LANG", "en-US"), ("LANG", "zh-CN")]);
        assert_eq!(detect_lang(get), Lang::EnUs);
        let get = env(&[("PRECIS_LANG", "zh-CN"), ("LANG", "en_US.UTF-8")]);
        assert_eq!(detect_lang(get), Lang::ZhCn);
    }

    #[test]
    fn detect_lang_recognizes_en_variants() {
        for value in ["en-US", "en_US", "en", "en_US.UTF-8"] {
            let pairs = [("LANG", value)];
            assert_eq!(detect_lang(env(&pairs)), Lang::EnUs, "value: {}", value);
        }
    }

    #[test]
    fn detect_lang_recognizes_zh_variants() {
        assert_eq!(detect_lang(env(&[("LANG", "zh-CN")])), Lang::ZhCn);
        assert_eq!(detect_lang(env(&[("LC_CTYPE", "zh_CN.UTF-8")])), Lang::ZhCn);
        assert_eq!(detect_lang(env(&[("LC_ALL", "zh")])), Lang::ZhCn);
    }

    #[test]
    fn detect_lang_irrelevant_value_falls_back_to_zh() {
        assert_eq!(detect_lang(env(&[("LANG", "fr-FR")])), Lang::ZhCn);
        assert_eq!(detect_lang(env(&[("LC_ALL", "C")])), Lang::ZhCn);
        assert_eq!(detect_lang(env(&[("LC_ALL", "POSIX")])), Lang::ZhCn);
    }

    #[test]
    fn detect_lang_falls_through_unset_vars_in_order() {
        // PRECIS_LANG 未设置时看 LC_ALL，再往下才看 LANG
        let get = env(&[("LC_ALL", "en_US"), ("LANG", "zh-CN")]);
        assert_eq!(detect_lang(get), Lang::EnUs);
        let get = env(&[("LC_CTYPE", "zh_CN"), ("LANG", "en_US")]);
        assert_eq!(detect_lang(get), Lang::ZhCn);
    }

    #[test]
    fn set_lang_lang_roundtrip() {
        set_lang(Lang::EnUs);
        assert_eq!(lang(), Lang::EnUs);
        set_lang(Lang::ZhCn);
        assert_eq!(lang(), Lang::ZhCn);
    }

    #[test]
    fn pick_returns_zh_side_by_default() {
        set_lang(Lang::ZhCn);
        assert_eq!(pick("首页", "Home"), "首页");
    }

    #[test]
    fn pick_returns_en_side_after_switch() {
        set_lang(Lang::EnUs);
        assert_eq!(pick("首页", "Home"), "Home");
        assert_eq!(pick("校验", "Check"), "Check");
        set_lang(Lang::ZhCn); // 还原本线程语言，避免影响同文件后续测试
    }
}
