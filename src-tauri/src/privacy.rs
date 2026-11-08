use regex::Regex;

pub(crate) fn mask_sensitive(input: &str) -> String {
    static PATTERNS: std::sync::OnceLock<Vec<Regex>> = std::sync::OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            r#"(?i)(\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\b[\s"']*[:=]\s*["']?)([^\s"'&,;]{6,})"#,
            r"(?i)(\bBearer\s+)([A-Za-z0-9._~+/-]{12,})",
            r"(\b)(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",
            r"(\b)((?:sk-|sk_live_|sk_test_|ghp_|gho_|ghu_|ghs_|github_pat_|AKIA|ASIA)[A-Za-z0-9_-]{12,})",
            r"(?s)(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----).*?(-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)",
        ]
        .into_iter()
        .map(|pattern| Regex::new(pattern).expect("valid sensitive pattern"))
        .collect()
    });
    patterns
        .iter()
        .enumerate()
        .fold(input.to_owned(), |value, (index, pattern)| {
            if index == 4 {
                return pattern.replace_all(&value, "${1}******").into_owned();
            }
            pattern
                .replace_all(&value, |captures: &regex::Captures<'_>| {
                    let secret = captures
                        .get(2)
                        .map(|value| value.as_str())
                        .unwrap_or_default();
                    let characters: Vec<char> = secret.chars().collect();
                    let masked = if characters.len() > 6 {
                        format!(
                            "{}******{}",
                            characters[..3].iter().collect::<String>(),
                            characters[characters.len() - 3..]
                                .iter()
                                .collect::<String>()
                        )
                    } else {
                        "******".to_string()
                    };
                    format!(
                        "{}{}",
                        captures
                            .get(1)
                            .map(|value| value.as_str())
                            .unwrap_or_default(),
                        masked
                    )
                })
                .into_owned()
        })
}
pub(crate) fn contains_sensitive(
    text: &str,
    html: Option<&str>,
    rtf: Option<&str>,
    files: &[String],
) -> bool {
    mask_sensitive(text) != text
        || html.is_some_and(|value| mask_sensitive(value) != value)
        || rtf.is_some_and(|value| mask_sensitive(value) != value)
        || files.iter().any(|value| mask_sensitive(value) != *value)
}
