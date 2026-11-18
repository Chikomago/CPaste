use sha2::{Digest, Sha256};
/// Preserve the capture fingerprint format for edits and history replay too.
pub(crate) fn calculate(
    kind: &str,
    text: &str,
    html: Option<&str>,
    rtf: Option<&str>,
    files: &[String],
    image: Option<&[u8]>,
) -> String {
    let mut hash = Sha256::new();
    hash.update(kind.as_bytes());
    hash.update(text.as_bytes());
    if let Some(html) = html {
        hash.update(html.as_bytes());
    }
    if let Some(rtf) = rtf {
        hash.update(rtf.as_bytes());
    }
    for file in files {
        hash.update(file.as_bytes());
    }
    if let Some(image) = image {
        hash.update(image);
    }
    hex::encode(hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_capture_format_with_all_clipboard_representations() {
        let mut old = Sha256::new();
        for part in [
            b"image".as_slice(),
            b"caption",
            b"<b>caption</b>",
            b"rtf caption",
            b"/tmp/a.png",
            b"png bytes",
        ] {
            old.update(part);
        }
        assert_eq!(
            calculate(
                "image",
                "caption",
                Some("<b>caption</b>"),
                Some("rtf caption"),
                &["/tmp/a.png".into()],
                Some(b"png bytes")
            ),
            hex::encode(old.finalize())
        );
    }
}
