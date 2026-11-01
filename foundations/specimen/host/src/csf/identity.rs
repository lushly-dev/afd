//! Storybook's identity rules, ported from Storybook 10.6.2 (`storybook/internal/csf` and the
//! story index's auto-title), so discovered ids, titles and names match Storybook's index.

/// JavaScript's `\s`: Unicode white space and line terminators.
fn js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// One `String.prototype.replace` with a global regular expression matching `width`
/// consecutive characters, left to right without overlap.
fn replace_runs(
    text: &[char],
    width: usize,
    test: impl Fn(&[char]) -> bool,
    insert_at: usize,
) -> Vec<char> {
    let mut result = Vec::with_capacity(text.len() + 8);
    let mut index = 0;
    while index < text.len() {
        if index + width <= text.len() && test(&text[index..index + width]) {
            result.extend_from_slice(&text[index..index + insert_at]);
            result.push(' ');
            result.extend_from_slice(&text[index + insert_at..index + width]);
            index += width;
        } else {
            result.push(text[index]);
            index += 1;
        }
    }
    result
}

/// Storybook's `toStartCaseStr`, which `storyNameFromExport` applies to an export name.
pub fn story_name_from_export(key: &str) -> String {
    let text: Vec<char> = key
        .chars()
        .map(|c| if matches!(c, '_' | '-' | '.') { ' ' } else { c })
        .collect();
    // /([^\n])([A-Z])([a-z])/g → '$1 $2$3'
    let text = replace_runs(
        &text,
        3,
        |w| w[0] != '\n' && w[1].is_ascii_uppercase() && w[2].is_ascii_lowercase(),
        1,
    );
    // /([a-z])([A-Z])/g → '$1 $2'
    let text = replace_runs(
        &text,
        2,
        |w| w[0].is_ascii_lowercase() && w[1].is_ascii_uppercase(),
        1,
    );
    // /([a-z])([0-9])/gi and /([0-9])([a-z])/gi: ASCII letters only, as without the `u` flag.
    let text = replace_runs(
        &text,
        2,
        |w| w[0].is_ascii_alphabetic() && w[1].is_ascii_digit(),
        1,
    );
    let text = replace_runs(
        &text,
        2,
        |w| w[0].is_ascii_digit() && w[1].is_ascii_alphabetic(),
        1,
    );
    // /(\s|^)(\w)/g → upper-case the word character.
    let mut capitalized = Vec::with_capacity(text.len());
    let mut index = 0;
    while index < text.len() {
        let at_start = index == 0;
        if at_start && (text[0].is_ascii_alphanumeric() || text[0] == '_') {
            capitalized.push(text[0].to_ascii_uppercase());
            index += 1;
            continue;
        }
        if js_space(text[index])
            && index + 1 < text.len()
            && (text[index + 1].is_ascii_alphanumeric() || text[index + 1] == '_')
        {
            capitalized.push(text[index]);
            capitalized.push(text[index + 1].to_ascii_uppercase());
            index += 2;
            continue;
        }
        capitalized.push(text[index]);
        index += 1;
    }
    // / +/g → ' ', then trim().
    let mut collapsed = String::with_capacity(capitalized.len());
    for c in capitalized {
        if c == ' ' && collapsed.ends_with(' ') {
            continue;
        }
        collapsed.push(c);
    }
    collapsed.trim_matches(js_space).to_string()
}

/// Storybook's `sanitize`: lower case, punctuation to `-`, runs collapsed, ends trimmed.
pub fn sanitize(text: &str) -> String {
    const PUNCTUATION: &str = " ’–—―′¿'`~!@#$%^&*()_|+-=?;:'\",.<>{}[]\\/";
    let mut result = String::with_capacity(text.len());
    for c in text.to_lowercase().chars() {
        let c = if PUNCTUATION.contains(c) { '-' } else { c };
        if c == '-' && result.ends_with('-') {
            continue;
        }
        result.push(c);
    }
    result.trim_matches('-').to_string()
}

/// Storybook's `toId(kind, name)`; an empty sanitized part is an error, as `sanitizeSafe` throws.
pub fn to_id(kind: &str, name: &str) -> Result<String, String> {
    let safe = |value: &str, part: &str| {
        let sanitized = sanitize(value);
        if sanitized.is_empty() {
            Err(format!(
                "Invalid {part} '{value}', must include alphanumeric characters"
            ))
        } else {
            Ok(sanitized)
        }
    };
    let kind = safe(kind, "kind")?;
    if name.is_empty() {
        return Ok(kind);
    }
    Ok(format!("{kind}--{}", safe(name, "name")?))
}

/// Storybook's `combineTags`: in order, `!tag` removes a tag and anything else adds it once.
pub fn combine_tags<'t>(tags: impl IntoIterator<Item = &'t str>) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for tag in tags {
        if let Some(removed) = tag.strip_prefix('!') {
            result.retain(|existing| existing != removed);
        } else if !result.iter().any(|existing| existing == tag) {
            result.push(tag.to_string());
        }
    }
    result
}

/// `includeStories` / `excludeStories`: names, or a regular expression.
#[derive(Debug, Clone)]
pub enum Selector {
    Names(Vec<String>),
    Pattern(regex::Regex),
}

impl Selector {
    /// A JavaScript regular expression's source and flags, where the Rust engine accepts it.
    pub fn pattern(source: &str, flags: &str) -> Result<Selector, String> {
        let mut builder = regex::RegexBuilder::new(source);
        for flag in flags.chars() {
            match flag {
                'i' => {
                    builder.case_insensitive(true);
                }
                'm' => {
                    builder.multi_line(true);
                }
                's' => {
                    builder.dot_matches_new_line(true);
                }
                // `match` ignores these for a single test.
                'g' | 'y' | 'u' | 'd' | 'v' => {}
                other => return Err(format!("unsupported regular expression flag '{other}'")),
            }
        }
        builder.build().map(Selector::Pattern).map_err(|error| {
            format!("regular expression /{source}/{flags} is not supported here: {error}")
        })
    }

    fn matches(&self, key: &str) -> bool {
        match self {
            Selector::Names(names) => names.iter().any(|name| name == key),
            Selector::Pattern(pattern) => pattern.is_match(key),
        }
    }
}

/// Storybook's `isExportStory`.
pub fn is_export_story(key: &str, include: Option<&Selector>, exclude: Option<&Selector>) -> bool {
    key != "__esModule"
        && include.is_none_or(|selector| selector.matches(key))
        && exclude.is_none_or(|selector| !selector.matches(key))
}

fn path_join(parts: &[&str]) -> String {
    parts
        .iter()
        .flat_map(|part| part.split('/'))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

/// The last segment without `.stories.ext` / `.story.ext` / `.ext`, case-insensitively.
fn strip_extension(last: &str) -> String {
    let Some(dot) = last.rfind('.') else {
        return last.to_string();
    };
    if dot + 1 == last.len() {
        return last.to_string();
    }
    let stem = &last[..dot];
    let lower = stem.to_ascii_lowercase();
    for suffix in [".stories", ".story"] {
        if lower.ends_with(suffix) {
            return stem[..stem.len() - suffix.len()].to_string();
        }
    }
    stem.to_string()
}

/// Storybook's auto-title `sanitize` over path segments.
fn title_parts(parts: Vec<&str>) -> Vec<String> {
    let Some(last) = parts.last() else {
        return Vec::new();
    };
    let stripped = strip_extension(last);
    if parts.len() == 1 {
        return vec![stripped];
    }
    let next_to_last = parts[parts.len() - 2];
    let owned = |slice: &[&str]| {
        slice
            .iter()
            .map(|part| part.to_string())
            .collect::<Vec<_>>()
    };
    if !stripped.is_empty() && stripped.to_lowercase() == next_to_last.to_lowercase() {
        let mut result = owned(&parts[..parts.len() - 2]);
        result.push(stripped);
        return result;
    }
    // /^(story|stories)([.][^.]+)$/i
    let lower = last.to_ascii_lowercase();
    let story_file = ["story.", "stories."].iter().any(|prefix| {
        lower
            .strip_prefix(prefix)
            .is_some_and(|extension| !extension.is_empty() && !extension.contains('.'))
    });
    if !stripped.is_empty() && (story_file || stripped.eq_ignore_ascii_case("index")) {
        return owned(&parts[..parts.len() - 1]);
    }
    let mut result = owned(&parts[..parts.len() - 1]);
    result.push(stripped);
    result
}

/// Storybook's `userOrAutoTitleFromSpecifier` for a file the specifier matched: an explicit
/// title gets the prefix; otherwise the title comes from the path below the directory.
pub fn title(user_title: Option<&str>, relative_path: &str, title_prefix: &str) -> String {
    match user_title {
        Some(title) if !title_prefix.is_empty() => path_join(&[title_prefix, title]),
        Some(title) => title.to_string(),
        None => {
            let joined = path_join(&[title_prefix, relative_path]);
            title_parts(joined.split('/').collect()).join("/")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Generated with Storybook 10.6.2's own `storyNameFromExport`, `toId` and `sanitize`.
    #[test]
    fn names_match_storybook() {
        for (key, name, id) in [
            ("Primary", "Primary", "primary"),
            ("primary", "Primary", "primary"),
            (
                "WithURLAndH1Heading2x",
                "With URL And H 1 Heading 2 X",
                "with-url-and-h-1-heading-2-x",
            ),
            ("snake_case_name", "Snake Case Name", "snake-case-name"),
            ("HTMLElement", "HTML Element", "html-element"),
            ("XMLHttpRequest", "XML Http Request", "xml-http-request"),
            ("iOSDevice", "I OS Device", "i-os-device"),
            ("Size2xl", "Size 2 Xl", "size-2-xl"),
            ("A11yCheck", "A 11 Y Check", "a-11-y-check"),
            ("h1", "H 1", "h-1"),
            ("_private", "Private", "private"),
            ("__dunder__", "Dunder", "dunder"),
            ("ALLCAPS", "ALLCAPS", "allcaps"),
            ("ALL_CAPS_NAME", "ALL CAPS NAME", "all-caps-name"),
            ("Story10Items", "Story 10 Items", "story-10-items"),
            ("v2Beta", "V 2 Beta", "v-2-beta"),
            ("Ümlaut", "Ümlaut", "ümlaut"),
            ("émoji😀Name", "émoji😀 Name", "émoji😀-name"),
            ("Mixed123abc", "Mixed 123 Abc", "mixed-123-abc"),
            ("ABCdef", "AB Cdef", "ab-cdef"),
            ("aBC", "A BC", "a-bc"),
            ("$dollar", "$dollar", "dollar"),
            ("with$dollar", "With$dollar", "with-dollar"),
            ("iPhone12Pro", "I Phone 12 Pro", "i-phone-12-pro"),
            ("RGBColor", "RGB Color", "rgb-color"),
            ("Ünïcode_Ñame", "Ünïcode Ñame", "ünïcode-ñame"),
        ] {
            assert_eq!(story_name_from_export(key), name, "{key}");
            assert_eq!(
                to_id("Components/Button Group", &story_name_from_export(key)).unwrap(),
                format!("components-button-group--{id}"),
                "{key}"
            );
        }
    }

    #[test]
    fn sanitizes_like_storybook() {
        for (title, sanitized) in [
            (
                "Lushly/Settings/Display Settings",
                "lushly-settings-display-settings",
            ),
            ("a//b", "a-b"),
            ("  spaced  ", "spaced"),
            ("Ünïcode/Ñame", "ünïcode-ñame"),
            ("emoji 😀 title", "emoji-😀-title"),
            ("under_score/Title", "under-score-title"),
            ("dots.in.title", "dots-in-title"),
            ("x--y", "x-y"),
            ("ABC/DefGhi", "abc-defghi"),
        ] {
            assert_eq!(sanitize(title), sanitized, "{title}");
        }
        assert!(to_id("---", "x").is_err());
    }

    #[test]
    fn combines_tags_in_order() {
        assert_eq!(
            combine_tags(["dev", "test", "!test", "a", "!a", "a"]),
            ["dev", "a"]
        );
    }

    #[test]
    fn derives_titles_from_paths() {
        assert_eq!(
            title(None, "components/Button/Button.stories.ts", ""),
            "components/Button"
        );
        assert_eq!(
            title(None, "components/Button/index.stories.ts", ""),
            "components/Button"
        );
        assert_eq!(
            title(None, "components/Button/stories.ts", ""),
            "components/Button"
        );
        assert_eq!(
            title(None, "components/Button/Primary.story.tsx", "Lib"),
            "Lib/components/Button/Primary"
        );
        assert_eq!(title(None, "Button.stories.ts", ""), "Button");
        assert_eq!(
            title(Some("Explicit/Title"), "x.stories.ts", "Prefix/"),
            "Prefix/Explicit/Title"
        );
        assert_eq!(title(Some("Explicit"), "x.stories.ts", ""), "Explicit");
    }

    #[test]
    fn selects_story_exports() {
        let exclude = Selector::pattern("^(helper|internal)", "").unwrap();
        assert!(!is_export_story("helperData", None, Some(&exclude)));
        assert!(is_export_story("Primary", None, Some(&exclude)));
        let include = Selector::Names(vec!["Primary".into()]);
        assert!(!is_export_story("Secondary", Some(&include), None));
        assert!(!is_export_story("__esModule", None, None));
    }
}
