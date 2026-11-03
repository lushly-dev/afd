//! What `umbel-hook import` and `export` share (section 10.5): their arguments, the small YAML
//! subset a harness's memory file opens with, and the double-quoted strings an export writes.
//!
//! The subset reader takes only top-level `key: value` lines between a first line `---` and the
//! next `---`, each value plain, single-quoted or double-quoted. Anything else in the block is
//! ignored, and a file with no closing line has no frontmatter.

use std::ffi::OsString;
use std::path::PathBuf;

use crate::failure::Failure;

/// The arguments of `import <harness> <dir> [--project p] [--class c]` and `export <harness>
/// <dir> [--project p]`.
#[derive(Debug, Default)]
pub(crate) struct Args {
    pub(crate) harness: String,
    pub(crate) dir: PathBuf,
    pub(crate) project: Option<String>,
    pub(crate) class: Option<String>,
}

impl Args {
    /// Parse `args`, after the subcommand. `with_class` admits `--class`.
    pub(crate) fn parse(args: &[OsString], with_class: bool) -> Result<Self, Failure> {
        let usage = |message: &str| Failure::new("invalid-arguments", message);
        let mut positional = Vec::new();
        let mut parsed = Self::default();
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            let word = arg.to_string_lossy();
            let mut value = |name: &str| {
                iter.next()
                    .map(|value| value.to_string_lossy().into_owned())
                    .ok_or_else(|| usage(&format!("{name} takes a value")))
            };
            match word.as_ref() {
                "--project" => parsed.project = Some(value("--project")?),
                "--class" if with_class => {
                    let class = value("--class")?;
                    if !["episodic", "semantic", "procedural"].contains(&class.as_str()) {
                        return Err(usage("--class is episodic, semantic or procedural"));
                    }
                    parsed.class = Some(class);
                }
                other if other.starts_with("--") => {
                    return Err(usage(if with_class {
                        "the options are --project and --class"
                    } else {
                        "the only option is --project"
                    }));
                }
                _ => positional.push(arg.clone()),
            }
        }
        let [harness, dir] = positional.as_slice() else {
            return Err(usage("give the harness and the directory, in that order"));
        };
        parsed.harness = harness.to_string_lossy().into_owned();
        parsed.dir = PathBuf::from(dir);
        Ok(parsed)
    }
}

/// The frontmatter fields an import reads.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Front {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) kind: Option<String>,
}

/// Split a file into its frontmatter fields and its body.
pub(crate) fn frontmatter(text: &str) -> (Front, &str) {
    let mut front = Front::default();
    let mut lines = text.split_inclusive('\n');
    let is_fence = |line: &str| line.trim_end_matches(['\r', '\n']) == "---";
    if !lines.next().is_some_and(is_fence) {
        return (front, text);
    }
    let mut offset = text.find('\n').map_or(text.len(), |at| at + 1);
    let mut fields = Vec::new();
    let mut closed = false;
    for line in lines {
        offset += line.len();
        if is_fence(line) {
            closed = true;
            break;
        }
        fields.push(line.trim_end_matches(['\r', '\n']));
    }
    if !closed {
        return (Front::default(), text);
    }
    for line in fields {
        if line.starts_with([' ', '\t', '#']) {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = scalar(value.trim());
        match key.trim() {
            "name" => front.name = Some(value),
            "description" => front.description = Some(value),
            "type" => front.kind = Some(value),
            _ => {}
        }
    }
    (front, &text[offset..])
}

/// One YAML scalar on one line: double-quoted with its escapes, single-quoted with `''`, or plain
/// up to a ` #` comment.
pub(crate) fn scalar(value: &str) -> String {
    if let Some(rest) = value.strip_prefix('"') {
        return double_quoted(rest);
    }
    if let Some(rest) = value.strip_prefix('\'') {
        let mut out = String::new();
        let mut chars = rest.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\'' {
                if chars.peek() == Some(&'\'') {
                    chars.next();
                    out.push('\'');
                } else {
                    break;
                }
            } else {
                out.push(c);
            }
        }
        return out;
    }
    let plain = value.find(" #").map_or(value, |at| &value[..at]);
    plain.trim().to_owned()
}

fn double_quoted(rest: &str) -> String {
    let mut out = String::new();
    let mut chars = rest.chars();
    let hex = |chars: &mut std::str::Chars<'_>, n: usize| {
        let digits: String = chars.take(n).collect();
        u32::from_str_radix(&digits, 16)
            .ok()
            .and_then(char::from_u32)
    };
    while let Some(c) = chars.next() {
        match c {
            '"' => break,
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('0') => out.push('\0'),
                Some('x') => out.extend(hex(&mut chars, 2)),
                Some('u') => out.extend(hex(&mut chars, 4)),
                Some('U') => out.extend(hex(&mut chars, 8)),
                Some(other) => out.push(other),
                None => break,
            },
            other => out.push(other),
        }
    }
    out
}

/// `text` as a YAML double-quoted string: `\` and `"` escaped, and every control character, and
/// U+0085, U+2028 and U+2029, as `\uXXXX`, so the value stays on one line.
pub(crate) fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if c.is_control() || matches!(c, '\u{85}' | '\u{2028}' | '\u{2029}') => {
                out.push_str(&format!("\\u{:04x}", u32::from(c)));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_is_read_by_the_subset() {
        let text = "---\nname: \"Run the tests: first\"\ndescription: plain words # a comment\ntype: 'feedback'\nmetadata:\n  nested: ignored\n---\n\nThe body.\n";
        let (front, body) = frontmatter(text);
        assert_eq!(front.name.as_deref(), Some("Run the tests: first"));
        assert_eq!(front.description.as_deref(), Some("plain words"));
        assert_eq!(front.kind.as_deref(), Some("feedback"));
        assert_eq!(body, "\nThe body.\n");
        // No closing fence: no frontmatter.
        let (front, body) = frontmatter("---\nname: x\nno end");
        assert_eq!(front, Front::default());
        assert_eq!(body, "---\nname: x\nno end");
        let (front, body) = frontmatter("Just text.");
        assert_eq!((front, body), (Front::default(), "Just text."));
    }

    #[test]
    fn a_quoted_string_round_trips() {
        for text in [
            "plain",
            "with \"quotes\" and \\ backslash",
            "a: colon # and hash",
            "tab\tand\u{7}bell",
            "line\u{2028}separator",
            "é and 日本",
        ] {
            let quoted = quote(text);
            assert!(!quoted.contains('\n') && !quoted.contains('\u{2028}'));
            assert_eq!(scalar(&quoted), text, "{quoted}");
        }
        assert_eq!(scalar("'it''s'"), "it's");
    }
}
