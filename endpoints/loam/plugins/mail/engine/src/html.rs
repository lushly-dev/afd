//! What code reads from a message's HTML (the specification's sections 6.1
//! and 6.2): the text a person would see, the text they would not, the links
//! with the text shown for them, and the skeleton that is the body's shape.
//!
//! Nothing is loaded: no image, no style sheet, no font. The styles read are
//! the element's own and the message's `<style>` blocks, matched by simple
//! selectors (a tag, a class, an id, or a tag with a class or an id); a rule
//! with any other selector, or inside an at-rule such as `@media`, is not
//! applied. `!important` is honoured. What hides text is the [`HIDING`]
//! table, which grows with each case found.
//!
//! Hostile HTML is bounded before it is parsed: past [`TAG_LIMIT`] tags or
//! [`NESTING_LIMIT`] open elements the rest is not read, and at most
//! [`RULES_LIMIT`] style rules are kept.

use std::collections::HashMap;
use std::rc::Rc;

use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use sha2::{Digest, Sha256};

/// The most HTML read, in bytes. A larger body is read up to here.
pub const HTML_LIMIT: usize = 4 * 1024 * 1024;

/// The most tags read; the HTML after them is not read. A newsletter has a
/// few thousand; the HTML parser slows on hostile documents with tens of
/// thousands.
pub const TAG_LIMIT: usize = 10_000;

/// The most elements open at once that are read; the HTML past the point
/// where more are open is not read.
pub const NESTING_LIMIT: usize = 256;

/// The most style rules kept from a message.
pub const RULES_LIMIT: usize = 1_000;

/// The most text kept of either kind, in bytes.
const TEXT_LIMIT: usize = 1024 * 1024;

/// The most links kept.
const LINKS_LIMIT: usize = 500;

/// Whether a character is one a person cannot see: zero-width characters,
/// bidirectional controls, tag characters and the rest of Unicode's
/// default-ignorable code points. They are removed from visible text, where
/// they would split words or carry text no one sees, and counted as hidden.
#[must_use]
pub fn invisible(c: char) -> bool {
    matches!(
        u32::from(c),
        0x00AD
            | 0x034F
            | 0x061C
            | 0x115F..=0x1160
            | 0x17B4..=0x17B5
            | 0x180B..=0x180F
            | 0x200B..=0x200F
            | 0x202A..=0x202E
            | 0x2060..=0x206F
            | 0x3164
            | 0xFE00..=0xFE0F
            | 0xFEFF
            | 0xFFA0
            | 0xFFF0..=0xFFF8
            | 0x1BCA0..=0x1BCA3
            | 0x1D173..=0x1D17A
            | 0xE0000..=0xE0FFF
    )
}

/// One link and the text shown for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    /// Where it goes, as written.
    pub target: String,
    /// The host of the target, as a browser reads it; empty when it has none.
    pub target_host: String,
    /// The host the shown text names, when the text is an address.
    pub text_host: String,
    /// Whether the shown text names a host the target does not go to, or is
    /// an address while the target's host cannot be read.
    pub mismatched: bool,
}

/// What the HTML says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HtmlReading {
    /// The text a person would see.
    pub visible: String,
    /// The text in the body a person would not see. Kept apart: never in a
    /// snippet or the search index's text. What is never rendered (the head,
    /// scripts, style sheets) is not text and is not here.
    pub hidden: String,
    /// Characters removed from the visible text because no one can see them.
    pub invisible_chars: usize,
    /// The links, in order.
    pub links: Vec<Link>,
    /// The hash of the start tags in order, a run of one tag counted once:
    /// the body's shape, without its text or attributes.
    pub skeleton: [u8; 16],
    /// Whether the HTML was longer than the engine reads, and its end left
    /// unread.
    pub cut: bool,
}

/// A style that hides what it applies to.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Hiding {
    /// The property has exactly this value.
    Is(&'static str, &'static str),
    /// The property's value starts with this.
    Starts(&'static str, &'static str),
    /// The property is a number no larger than this (opacity).
    AtMost(&'static str, f64),
    /// The property is a font size too small to read.
    TinyText(&'static str),
    /// The property is zero, and `overflow` is `hidden`.
    Collapsed(&'static str),
    /// The property is a length far to the left or above the page.
    FarOff(&'static str),
}

/// The styles that hide text (the specification's 6.2): data, so that a
/// case found in mail is a line added here and a test.
pub const HIDING: &[Hiding] = &[
    Hiding::Is("display", "none"),
    Hiding::AtMost("opacity", 0.05),
    Hiding::TinyText("font-size"),
    Hiding::Collapsed("height"),
    Hiding::Collapsed("max-height"),
    Hiding::Collapsed("width"),
    Hiding::Collapsed("max-width"),
    Hiding::FarOff("left"),
    Hiding::FarOff("top"),
    Hiding::FarOff("text-indent"),
    Hiding::FarOff("margin-left"),
    Hiding::FarOff("margin-top"),
    Hiding::Starts("clip", "rect(0"),
    Hiding::Starts("clip-path", "inset(50%"),
    Hiding::Starts("transform", "scale(0"),
];

/// Elements whose content is never rendered: not text at all.
const UNRENDERED: &[&str] = &[
    "head", "script", "style", "title", "template", "noscript", "object", "iframe", "meta", "link",
];

/// Elements that start a new line in what a person sees.
const BLOCKS: &[&str] = &[
    "p",
    "div",
    "br",
    "li",
    "tr",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "section",
    "article",
    "header",
    "footer",
    "blockquote",
    "pre",
    "hr",
    "ul",
    "ol",
];

/// Elements that close themselves, which the nesting count leaves out.
const VOID: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr", "param",
];

/// One declaration: its value, and whether it is `!important`.
#[derive(Debug, Clone)]
struct Declared {
    value: String,
    important: bool,
}

/// A simple style rule from a `<style>` block.
#[derive(Debug, Clone)]
struct Rule {
    tag: Option<String>,
    class: Option<String>,
    id: Option<String>,
    declarations: Rc<Vec<(String, Declared)>>,
}

/// What is inherited down the tree.
#[derive(Debug, Clone, Default)]
struct Inherited {
    /// Hidden for good: nothing under it can show again.
    hidden: bool,
    /// `visibility`, which a descendant can set back to visible.
    invisible: bool,
    color: Option<String>,
    /// The colour behind the text; `None` when unknown, as under an image.
    background: Option<String>,
}

struct Reader {
    rules: Vec<Rule>,
    reading: HtmlReading,
    tags: Vec<String>,
}

/// Reads `html`. This never fails: what cannot be parsed reads as little.
#[must_use]
pub fn read(html: &str) -> HtmlReading {
    let (bounded, cut) = bound(cut_text(html, HTML_LIMIT));
    let dom =
        html5ever::parse_document(RcDom::default(), html5ever::ParseOpts::default()).one(bounded);
    let mut reader = Reader {
        rules: Vec::new(),
        reading: HtmlReading {
            cut: cut || html.len() > HTML_LIMIT,
            ..HtmlReading::default()
        },
        tags: Vec::new(),
    };
    collect_styles(&dom.document, &mut reader.rules, 0);
    reader.walk(&dom.document, &Inherited::default(), 0);
    let mut hasher = Sha256::new();
    hasher.update(reader.tags.join(" ").as_bytes());
    reader
        .reading
        .skeleton
        .copy_from_slice(&hasher.finalize()[..16]);
    let (visible, removed) = tidy(&reader.reading.visible);
    reader.reading.visible = visible;
    reader.reading.invisible_chars = removed;
    reader.reading.hidden = tidy(&reader.reading.hidden).0;
    reader.reading
}

/// Formatting elements, which the HTML parser makes again for each block
/// while they are open: the parser's costliest path.
const FORMATTING: &[&str] = &[
    "a", "b", "big", "code", "em", "font", "i", "nobr", "s", "small", "strike", "strong", "tt", "u",
];

/// The most formatting elements left open that are read.
pub const FORMATTING_LIMIT: usize = 16;

/// The start of `html` that is read: up to [`TAG_LIMIT`] tags, while no more
/// than [`NESTING_LIMIT`] elements are open and no more than
/// [`FORMATTING_LIMIT`] formatting elements. Open elements are tracked as
/// the parser does, roughly: an end tag closes the nearest open element of
/// its name, and one that closes nothing is ignored. Returns whether
/// anything was left out.
fn bound(html: &str) -> (&str, bool) {
    let bytes = html.as_bytes();
    let mut tags = 0usize;
    let mut open: Vec<String> = Vec::new();
    let mut at = 0;
    while let Some(found) = bytes[at..].iter().position(|b| *b == b'<') {
        let start = at + found;
        let next = bytes.get(start + 1).copied().unwrap_or(0);
        if next.is_ascii_alphabetic() || next == b'/' {
            tags += 1;
            let closing = next == b'/';
            let name_start = start + 1 + usize::from(closing);
            let name_end = bytes[name_start..]
                .iter()
                .position(|b| !b.is_ascii_alphanumeric())
                .map_or(bytes.len(), |end| name_start + end);
            let name = html[name_start..name_end].to_ascii_lowercase();
            if closing {
                if let Some(nearest) = open.iter().rposition(|other| *other == name) {
                    open.truncate(nearest);
                }
            } else if !VOID.contains(&name.as_str()) {
                open.push(name);
            }
            let formatting = open
                .iter()
                .filter(|name| FORMATTING.contains(&name.as_str()))
                .count();
            if tags > TAG_LIMIT || open.len() > NESTING_LIMIT || formatting > FORMATTING_LIMIT {
                return (&html[..start], true);
            }
        }
        at = start + 1;
    }
    (html, false)
}

impl Reader {
    fn walk(&mut self, node: &Handle, inherited: &Inherited, depth: usize) {
        if depth > NESTING_LIMIT + 8 {
            return;
        }
        match &node.data {
            NodeData::Text { contents } => {
                let text = contents.borrow();
                let hidden = inherited.hidden
                    || inherited.invisible
                    || same_colour(inherited.color.as_deref(), inherited.background.as_deref());
                let target = if hidden {
                    &mut self.reading.hidden
                } else {
                    &mut self.reading.visible
                };
                if target.len() < TEXT_LIMIT {
                    target.push_str(cut_text(&text, TEXT_LIMIT - target.len()));
                }
            }
            NodeData::Element { name, attrs, .. } => {
                let tag = name.local.to_string().to_ascii_lowercase();
                if self.tags.last() != Some(&tag) {
                    self.tags.push(tag.clone());
                }
                // What is never rendered is not text, shown or hidden.
                if UNRENDERED.contains(&tag.as_str()) {
                    return;
                }
                let attrs = attrs.borrow();
                let attribute = |wanted: &str| {
                    attrs
                        .iter()
                        .find(|attr| attr.name.local.to_string().eq_ignore_ascii_case(wanted))
                        .map(|attr| attr.value.to_string())
                };
                let mut here = inherited.clone();
                if attribute("hidden").is_some() {
                    here.hidden = true;
                }
                let declared = self.declarations(
                    &tag,
                    attribute("class").as_deref(),
                    attribute("id").as_deref(),
                    attribute("style").as_deref(),
                );
                let value = |property: &str| declared.get(property).map(|d| d.value.as_str());
                if let Some(color) = attribute("color") {
                    here.color = Some(normal_color(&color));
                }
                if let Some(color) = value("color") {
                    here.color = Some(normal_color(color));
                }
                if let Some(background) = attribute("bgcolor") {
                    here.background = Some(normal_color(&background));
                }
                if attribute("background").is_some() || value("background-image").is_some() {
                    here.background = None;
                }
                if let Some(background) = value("background-color").or_else(|| value("background"))
                {
                    if background.contains("url(") || background.contains("gradient(") {
                        here.background = None;
                    } else {
                        let colour = normal_color(background);
                        // A transparent background shows what is behind it.
                        if colour != TRANSPARENT {
                            here.background = Some(colour);
                        }
                    }
                }
                match value("visibility") {
                    Some("hidden" | "collapse") => here.invisible = true,
                    Some("visible") => here.invisible = false,
                    _ => {}
                }
                if hides(&declared) {
                    here.hidden = true;
                }
                let block = BLOCKS.contains(&tag.as_str());
                if block {
                    self.reading.visible.push('\n');
                    self.reading.hidden.push('\n');
                }
                if tag == "a"
                    && let Some(target) = attribute("href")
                {
                    let before_visible = self.reading.visible.len();
                    self.children(node, &here, depth);
                    let shown = self.reading.visible[before_visible..].to_string();
                    if !(here.hidden || here.invisible) {
                        self.link(&target, &shown);
                    }
                } else {
                    self.children(node, &here, depth);
                }
                if block {
                    self.reading.visible.push('\n');
                    self.reading.hidden.push('\n');
                }
            }
            _ => self.children(node, inherited, depth),
        }
    }

    fn children(&mut self, node: &Handle, inherited: &Inherited, depth: usize) {
        for child in node.children.borrow().iter() {
            self.walk(child, inherited, depth + 1);
        }
    }

    /// The declarations that apply to an element: the matching rules in
    /// order, then its own style, with an `!important` one kept against a
    /// later one that is not.
    fn declarations(
        &self,
        tag: &str,
        class: Option<&str>,
        id: Option<&str>,
        style: Option<&str>,
    ) -> HashMap<String, Declared> {
        let mut found: HashMap<String, Declared> = HashMap::new();
        let mut apply = |property: &String, declared: &Declared| {
            let keep = found
                .get(property)
                .is_some_and(|had| had.important && !declared.important);
            if !keep {
                found.insert(property.clone(), declared.clone());
            }
        };
        if !self.rules.is_empty() {
            let classes: Vec<&str> = class
                .map(|class| class.split_whitespace().collect())
                .unwrap_or_default();
            for rule in &self.rules {
                let tag_matches = rule.tag.as_deref().is_none_or(|wanted| wanted == tag);
                let class_matches = rule.class.as_deref().is_none_or(|wanted| {
                    classes
                        .iter()
                        .any(|class| class.eq_ignore_ascii_case(wanted))
                });
                let id_matches = rule
                    .id
                    .as_deref()
                    .is_none_or(|wanted| id.is_some_and(|id| id.eq_ignore_ascii_case(wanted)));
                if tag_matches && class_matches && id_matches {
                    for (property, declared) in rule.declarations.iter() {
                        apply(property, declared);
                    }
                }
            }
        }
        if let Some(style) = style {
            for (property, declared) in parse_declarations(cut_text(style, 16 * 1024)) {
                apply(&property, &declared);
            }
        }
        found
    }

    fn link(&mut self, target: &str, shown: &str) {
        if self.reading.links.len() >= LINKS_LIMIT {
            return;
        }
        let target = target.trim();
        let target_host = link_host(target);
        let shown = shown.trim();
        let text_host = if looks_like_address(shown) {
            address_host(shown).unwrap_or_default()
        } else {
            String::new()
        };
        let mismatched = !text_host.is_empty()
            && match &target_host {
                Some(target_host) => !same_site(&text_host, target_host),
                // The text is an address and where the link goes cannot be
                // told: that is the mismatch a person cannot see.
                None => !target.to_ascii_lowercase().starts_with("mailto:"),
            };
        self.reading.links.push(Link {
            target: cut_text(target, 2048).to_string(),
            target_host: target_host.unwrap_or_default(),
            text_host,
            mismatched,
        });
    }
}

/// A colour with no alpha, which shows what is behind it.
const TRANSPARENT: &str = "transparent";

/// Whether the text is the colour of what is behind it, or has no colour.
fn same_colour(color: Option<&str>, background: Option<&str>) -> bool {
    match (color, background) {
        (Some(TRANSPARENT), _) => true,
        (Some(color), Some(background)) => !color.is_empty() && color == background,
        _ => false,
    }
}

/// Whether the declarations hide what they apply to.
fn hides(declared: &HashMap<String, Declared>) -> bool {
    let value = |property: &str| declared.get(property).map(|d| d.value.as_str());
    let overflow_hidden = matches!(value("overflow"), Some("hidden" | "clip"));
    HIDING.iter().any(|rule| match *rule {
        Hiding::Is(property, wanted) => value(property).is_some_and(|found| found == wanted),
        Hiding::Starts(property, wanted) => {
            value(property).is_some_and(|found| found.replace(' ', "").starts_with(wanted))
        }
        Hiding::AtMost(property, limit) => value(property)
            .and_then(length)
            .is_some_and(|(number, _)| number <= limit),
        Hiding::TinyText(property) => value(property)
            .and_then(length)
            .is_some_and(|(number, unit)| tiny(number, &unit)),
        Hiding::Collapsed(property) => {
            overflow_hidden
                && value(property)
                    .and_then(length)
                    .is_some_and(|(number, _)| number <= 0.0)
        }
        Hiding::FarOff(property) => value(property)
            .and_then(length)
            .is_some_and(|(number, unit)| far_off(number, &unit)),
    })
}

/// Whether a font size is too small to read: under 2 pixels or points, or
/// under 0.15 of the inherited size.
fn tiny(number: f64, unit: &str) -> bool {
    match unit {
        "" | "px" | "pt" => number < 2.0,
        "em" | "rem" => number < 0.15,
        "%" => number < 15.0,
        _ => false,
    }
}

/// Whether a position puts its content off the page.
fn far_off(number: f64, unit: &str) -> bool {
    match unit {
        "" | "px" | "pt" => number <= -500.0,
        "em" | "rem" => number <= -50.0,
        _ => false,
    }
}

/// The number at the start of a CSS value, and its unit: `0`, `1px`,
/// `-9999px`, `.5em`.
fn length(value: &str) -> Option<(f64, String)> {
    let value = value.trim();
    let end = value
        .char_indices()
        .find(|(at, c)| {
            !(c.is_ascii_digit() || *c == '.' || (*at == 0 && (*c == '-' || *c == '+')))
        })
        .map_or(value.len(), |(at, _)| at);
    let number = value[..end].parse().ok()?;
    let unit: String = value[end..]
        .chars()
        .take_while(|c| c.is_ascii_alphabetic() || *c == '%')
        .collect();
    Some((number, unit.to_ascii_lowercase()))
}

/// Colours written one way: `#fff`, `#FFFFFF`, `white` and `rgb(255,255,255)`
/// are one colour; a colour with no alpha is [`TRANSPARENT`].
fn normal_color(value: &str) -> String {
    let value = value.trim().to_ascii_lowercase();
    // A `background` shorthand: its first word.
    let first = value.split_whitespace().next().unwrap_or_default();
    match first {
        "white" => return "#ffffff".to_string(),
        "black" => return "#000000".to_string(),
        "red" => return "#ff0000".to_string(),
        "transparent" => return TRANSPARENT.to_string(),
        _ => {}
    }
    if let Some(hex) = first.strip_prefix('#') {
        // Only hexadecimal digits make a colour; anything else, which can
        // be any character at all, is not one.
        if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return String::new();
        }
        return match hex.len() {
            3 => format!("#{}", hex.chars().flat_map(|c| [c, c]).collect::<String>()),
            4 if hex.ends_with('0') => TRANSPARENT.to_string(),
            6 => format!("#{hex}"),
            8 if hex.ends_with("00") => TRANSPARENT.to_string(),
            8 => format!("#{}", &hex[..6]),
            _ => String::new(),
        };
    }
    if let Some(inner) = value
        .strip_prefix("rgba(")
        .or_else(|| value.strip_prefix("rgb("))
        .and_then(|rest| rest.split(')').next())
    {
        let parts: Vec<&str> = inner
            .split([',', ' ', '/'])
            .filter(|part| !part.is_empty())
            .collect();
        if let Some(alpha) = parts.get(3) {
            let alpha = alpha.trim_end_matches('%').parse::<f64>().unwrap_or(1.0);
            if alpha <= 0.0 {
                return TRANSPARENT.to_string();
            }
        }
        let channels: Vec<u8> = parts
            .iter()
            .take(3)
            .filter_map(|part| part.parse().ok())
            .collect();
        if let [r, g, b] = channels[..] {
            return format!("#{r:02x}{g:02x}{b:02x}");
        }
    }
    String::new()
}

/// The rules of every `<style>` element, at most [`RULES_LIMIT`].
fn collect_styles(node: &Handle, rules: &mut Vec<Rule>, depth: usize) {
    if depth > NESTING_LIMIT + 8 || rules.len() >= RULES_LIMIT {
        return;
    }
    if let NodeData::Element { name, .. } = &node.data
        && name.local.to_string().eq_ignore_ascii_case("style")
    {
        let mut css = String::new();
        for child in node.children.borrow().iter() {
            if let NodeData::Text { contents } = &child.data {
                css.push_str(&contents.borrow());
            }
        }
        parse_rules(cut_text(&css, 256 * 1024), rules);
        return;
    }
    for child in node.children.borrow().iter() {
        collect_styles(child, rules, depth + 1);
    }
}

/// The simple rules of a style sheet. A rule inside an at-rule (`@media`,
/// `@font-face`), or with a selector that is not simple, is not applied.
fn parse_rules(css: &str, rules: &mut Vec<Rule>) {
    let css = strip_comments(css);
    let bytes = css.as_bytes();
    let mut at = 0;
    while at < bytes.len() && rules.len() < RULES_LIMIT {
        let Some(open) = bytes[at..].iter().position(|b| *b == b'{') else {
            return;
        };
        let open = at + open;
        let prelude = css[at..open].trim();
        // The block's end, counting the braces inside it.
        let mut level = 0usize;
        let mut close = None;
        for (offset, byte) in bytes[open..].iter().enumerate() {
            match byte {
                b'{' => level += 1,
                b'}' => {
                    level -= 1;
                    if level == 0 {
                        close = Some(open + offset);
                        break;
                    }
                }
                _ => {}
            }
        }
        let Some(close) = close else {
            return;
        };
        let body = &css[open + 1..close];
        at = close + 1;
        // A statement at-rule (`@import x;`) may come before a selector.
        let prelude = prelude.rsplit(';').next().unwrap_or_default().trim();
        if prelude.starts_with('@') || body.contains('{') {
            continue;
        }
        let declarations = Rc::new(parse_declarations(body));
        for selector in prelude.split(',') {
            if rules.len() >= RULES_LIMIT {
                return;
            }
            if let Some((tag, class, id)) = simple_selector(selector.trim()) {
                rules.push(Rule {
                    tag,
                    class,
                    id,
                    declarations: Rc::clone(&declarations),
                });
            }
        }
    }
}

fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// A simple selector's tag, class and id.
type Simple = (Option<String>, Option<String>, Option<String>);

/// `tag`, `.class`, `#id`, `tag.class`, `tag#id` or `*`; anything else is
/// not a simple selector.
fn simple_selector(selector: &str) -> Option<Simple> {
    if selector.is_empty()
        || selector
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '#' | '*')))
    {
        return None;
    }
    let (tag, rest) = match selector.find(['.', '#']) {
        Some(at) => (&selector[..at], &selector[at..]),
        None => (selector, ""),
    };
    let tag = (!tag.is_empty() && tag != "*").then(|| tag.to_ascii_lowercase());
    let mut class = None;
    let mut id = None;
    if let Some(name) = rest.strip_prefix('.') {
        if name.contains(['.', '#']) || name.is_empty() {
            return None;
        }
        class = Some(name.to_string());
    } else if let Some(name) = rest.strip_prefix('#') {
        if name.contains(['.', '#']) || name.is_empty() {
            return None;
        }
        id = Some(name.to_string());
    }
    Some((tag, class, id))
}

/// `property: value; ...` as pairs, properties and values in lower case,
/// with `!important` read off the value.
fn parse_declarations(text: &str) -> Vec<(String, Declared)> {
    text.split(';')
        .filter_map(|declaration| {
            let (property, value) = declaration.split_once(':')?;
            let property = property.trim().to_ascii_lowercase();
            let mut value = value.trim().to_ascii_lowercase();
            let important = match value.rfind('!') {
                Some(at) if value[at + 1..].trim() == "important" => {
                    value.truncate(at);
                    true
                }
                _ => false,
            };
            let value = value.trim().to_string();
            (!property.is_empty() && !value.is_empty())
                .then_some((property, Declared { value, important }))
        })
        .collect()
}

/// File names a shown text can end in that are not addresses, though their
/// endings are top-level domains too.
const FILE_ENDINGS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "jpg", "jpeg", "png", "gif",
    "zip", "html", "htm", "mov", "mp4", "mp3",
];

/// Whether shown text reads as an address a person would trust: a host, or
/// a URL.
fn looks_like_address(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() || text.contains(char::is_whitespace) {
        return false;
    }
    let lower = text.to_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .unwrap_or(&lower);
    let has_scheme = rest.len() != lower.len();
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let Some(tld) = host.rsplit('.').next() else {
        return false;
    };
    host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty() && label.chars().all(|c| c.is_alphanumeric() || c == '-')
        })
        && tld.chars().all(char::is_alphabetic)
        && tld.chars().count() >= 2
        && (has_scheme || !FILE_ENDINGS.contains(&tld))
}

/// The host a link goes to, read as a browser reads it, without `www.`; or
/// `None` when it goes to no host a person could compare, or cannot be read.
fn link_host(target: &str) -> Option<String> {
    // A mail client has no page the link is relative to: an address is read
    // on its own, and only one with no scheme (`//host/path`) borrows one.
    let parsed = match url::Url::parse(target) {
        Ok(parsed) => parsed,
        Err(url::ParseError::RelativeUrlWithoutBase) => {
            let base = url::Url::parse("https://base.invalid/").ok()?;
            let joined = base.join(target).ok()?;
            if joined.host_str() == Some("base.invalid") {
                // A path with no host: nothing to compare.
                return None;
            }
            joined
        }
        Err(_) => return None,
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let host = parsed
        .host_str()?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    Some(strip_www(&host))
}

/// The host shown text names, written as a link's host is.
fn address_host(text: &str) -> Option<String> {
    let text = text.trim();
    let with_scheme = if text.contains("://") {
        text.to_string()
    } else {
        format!("https://{text}")
    };
    let parsed = url::Url::parse(&with_scheme).ok()?;
    let host = parsed
        .host_str()?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    Some(strip_www(&host))
}

/// The host without a leading `www.`, unless that leaves no domain.
fn strip_www(host: &str) -> String {
    match host.strip_prefix("www.") {
        Some(rest) if rest.contains('.') => rest.to_string(),
        _ => host.to_string(),
    }
}

/// The host of an address, as a link's is read; for plain text's links.
#[must_use]
pub fn host_of(address: &str) -> Option<String> {
    link_host(address.trim())
}

/// Whether two hosts are one site: one is the other, or a part of it that
/// is itself a domain.
fn same_site(a: &str, b: &str) -> bool {
    let within =
        |inner: &str, outer: &str| outer.contains('.') && inner.ends_with(&format!(".{outer}"));
    a == b || within(a, b) || within(b, a)
}

/// Text on its lines: invisible characters gone, each line's runs of space
/// made one, blank lines made one. Returns how many characters were removed
/// as invisible.
fn tidy(text: &str) -> (String, usize) {
    let mut out = String::with_capacity(text.len());
    let mut removed = 0;
    let mut blank = true;
    for line in text.lines() {
        let line: String = line
            .chars()
            .filter(|c| {
                let gone = invisible(*c);
                removed += usize::from(gone);
                !gone
            })
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if line.is_empty() {
            blank = true;
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
            if blank {
                out.push('\n');
            }
        }
        blank = false;
        out.push_str(&line);
    }
    (out, removed)
}

/// A message's HTML made safe to show (the specification's 6.4), and the
/// remote references it holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cleaned {
    /// The HTML with no script, form, frame or style sheet, and links that
    /// open apart from the page.
    pub html: String,
    /// The addresses of what the HTML would load from the network: images,
    /// backgrounds, video posters. Nothing is loaded; the caller decides.
    pub remote: Vec<String>,
}

/// The attributes whose address a client loads by itself.
const LOADED: &[&str] = &["src", "srcset", "background", "poster", "lowsrc", "dynsrc"];

/// The most remote references reported.
const REMOTE_LIMIT: usize = 200;

/// Cleans `html` for a person's client to show, with `ammonia`, and lists
/// every remote reference left in it.
///
/// A message has no page of its own to resolve a relative address against,
/// so relative addresses are removed. The references are then read from the
/// cleaned HTML itself, as a browser would parse it: every address an
/// element there would load, except a `cid:` part of the message, is
/// reported, however it is spelled.
#[must_use]
pub fn clean(html: &str) -> Cleaned {
    let (bounded, _) = bound(cut_text(html, HTML_LIMIT));
    let mut builder = ammonia::Builder::default();
    builder
        .link_rel(Some("noopener noreferrer nofollow"))
        .url_relative(ammonia::UrlRelative::Deny)
        // An image of the message itself, which the client shows from the
        // part it names.
        .add_url_schemes(&["cid"])
        .add_tag_attributes("img", &["width", "height", "alt"]);
    let html = builder.clean(bounded).to_string();
    let dom = html5ever::parse_document(RcDom::default(), html5ever::ParseOpts::default())
        .one(html.as_str());
    let mut remote = Vec::new();
    loading(&dom.document, &mut remote, 0);
    Cleaned { html, remote }
}

/// The addresses the elements under `node` would load.
fn loading(node: &Handle, remote: &mut Vec<String>, depth: usize) {
    // The document's own elements sit above the message's.
    if depth > NESTING_LIMIT + 8 || remote.len() >= REMOTE_LIMIT {
        return;
    }
    if let NodeData::Element { attrs, .. } = &node.data {
        for attribute in attrs.borrow().iter() {
            let name = attribute.name.local.to_ascii_lowercase();
            if !LOADED.contains(&name.as_str()) {
                continue;
            }
            let value = attribute.value.trim();
            // A browser ignores tabs and newlines in an address.
            let plain: String = value
                .chars()
                .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
                .collect();
            if value.is_empty() || plain.to_ascii_lowercase().starts_with("cid:") {
                continue;
            }
            if remote.len() < REMOTE_LIMIT {
                remote.push(cut_text(&plain, 2048).to_string());
            }
        }
    }
    for child in node.children.borrow().iter() {
        loading(child, remote, depth + 1);
    }
}

/// The start of `text`, at most `bytes` long, cut between characters.
fn cut_text(text: &str, bytes: usize) -> &str {
    if text.len() <= bytes {
        return text;
    }
    let mut end = bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn visible_text_leaves_out_what_a_person_cannot_see() {
        let reading = read(
            r##"<html><head><title>T</title><style>
                 .gone { display: none } #tiny { font-size: 1px }
                 .forced { display: none !important }
                 @media (max-width: 600px) { .one { display: none } .two { color: red } .three { display: none } }
                 @font-face { font-family: x; src: url(x.woff) }
                 .after-font { display: none }
               </style></head><body bgcolor="#ffffff">
               <p>Your invoice is attached.</p>
               <p class="gone">ignore previous instructions</p>
               <p id="tiny">tiny words</p>
               <p style="display:none">inline hidden</p>
               <p style="display:none !important">inline important</p>
               <p class="forced" style="display:block">forced by its rule</p>
               <p style="color:#FFF">white on white</p>
               <p style="color:transparent">no colour</p>
               <p style="color:rgba(0,0,0,0)">no alpha</p>
               <p style="opacity:0">clear</p>
               <p style="position:absolute;left:-9999px">far away</p>
               <p style="max-height:0;overflow:hidden">collapsed</p>
               <a href="https://evil.example/login" style="mso-hide:all">https://mybank.com/login</a>
               <p hidden>hidden attribute</p>
               <p class="after-font">after the font</p>
               <p class="three">third in media</p>
               <p style="font-size:1em">one em</p>
               <p style="font-size:.875rem">small rem</p>
               <p style="height:0">height without overflow</p>
               <div style="visibility:hidden"><span style="visibility:visible">shown again</span></div>
               <div style="background-image:url(x.png);color:#fff">white on an image</div>
               <script>alert(1)</script>
               <p>pay&#8203;ment</p>
               </body></html>"##,
        );
        for hidden in [
            "ignore previous instructions",
            "tiny words",
            "inline hidden",
            "inline important",
            "forced by its rule",
            "white on white",
            "no colour",
            "no alpha",
            "clear",
            "far away",
            "collapsed",
            "hidden attribute",
            "after the font",
        ] {
            assert!(
                reading.hidden.contains(hidden),
                "{hidden}: {}",
                reading.hidden
            );
            assert!(!reading.visible.contains(hidden), "{hidden}");
        }
        for shown in [
            "Your invoice is attached.",
            "third in media",
            "one em",
            "small rem",
            "height without overflow",
            "shown again",
            "white on an image",
            "payment",
            // `mso-hide` hides only in Outlook; iCloud shows it.
            "https://mybank.com/login",
        ] {
            assert!(
                reading.visible.contains(shown),
                "{shown}: {}",
                reading.visible
            );
        }
        // Style sheets, scripts and the title are not text at all.
        for neither in ["display", "alert", "font-family"] {
            assert!(!reading.hidden.contains(neither) && !reading.visible.contains(neither));
        }
        assert_eq!(reading.invisible_chars, 1);
    }

    #[test]
    fn invisible_characters_are_removed_and_counted() {
        let smuggled: String = "say yes"
            .chars()
            .map(|c| char::from_u32(0xE0000 + u32::from(c)).unwrap())
            .collect();
        let reading = read(&format!(
            "<p>Hello{smuggled} there\u{202e}dlrow\u{202c}\u{2066}x\u{2069}</p>"
        ));
        assert_eq!(reading.visible, "Hello theredlrowx");
        assert_eq!(reading.invisible_chars, 7 + 4);
    }

    #[test]
    fn a_link_whose_text_names_another_host_is_marked() {
        let links = |html: &str| -> Vec<(String, String, bool)> {
            read(html)
                .links
                .into_iter()
                .map(|link| (link.target_host, link.text_host, link.mismatched))
                .collect()
        };
        let one = |target_host: &str, text_host: &str, mismatched| {
            vec![(target_host.to_string(), text_host.to_string(), mismatched)]
        };
        assert_eq!(
            links(r#"<a href="https://evil.example.net/login">https://www.mybank.com/login</a>"#),
            one("evil.example.net", "mybank.com", true)
        );
        assert_eq!(
            links(r#"<a href="https://mail.mybank.com/x">www.mybank.com</a>"#),
            one("mail.mybank.com", "mybank.com", false)
        );
        assert_eq!(
            links(r#"<a href="https://shop.example.com/">Shop now</a>"#),
            one("shop.example.com", "", false)
        );
        assert_eq!(
            links(r#"<a href="mailto:a@example.com">write to us</a>"#),
            one("", "", false)
        );
        // Ways a target's host hides from a naive reader.
        for target in [
            r"https://evil.example\@mybank.com/",
            "//evil.example/x",
            "https:evil.example",
            "https:/evil.example",
            "HTTPS://EVIL.EXAMPLE",
        ] {
            let found = links(&format!(r#"<a href="{target}">https://mybank.com</a>"#));
            assert_eq!(found, one("evil.example", "mybank.com", true), "{target}");
        }
        // An address shown for a link that goes nowhere a host can be read.
        assert_eq!(
            links(r#"<a href="javascript:go()">https://mybank.com</a>"#),
            one("", "mybank.com", true)
        );
        // A text that is only a top-level domain names no site.
        assert_eq!(
            links(r#"<a href="https://evil.com/">www.com</a>"#),
            one("evil.com", "www.com", true)
        );
        // An international name, written either way, is one host.
        assert_eq!(
            links(r#"<a href="https://xn--mnchen-3ya.de/">münchen.de</a>"#),
            one("xn--mnchen-3ya.de", "xn--mnchen-3ya.de", false)
        );
        // A file's name is not an address.
        assert_eq!(
            links(r#"<a href="https://files.example.com/1">invoice-123.pdf</a>"#),
            one("files.example.com", "", false)
        );
    }

    #[test]
    fn the_skeleton_ignores_text_and_attributes() {
        let one = read(r#"<div class="a"><p>Hello Ann</p><p>Order 1</p></div>"#);
        let two = read(r#"<div class="b"><p>Hello Bob</p><p>Order 2</p></div>"#);
        let other = read(r"<table><tr><td>x</td></tr></table>");
        assert_eq!(one.skeleton, two.skeleton);
        assert_ne!(one.skeleton, other.skeleton);
    }

    #[test]
    fn hostile_html_is_bounded_before_it_is_parsed() {
        let timed = |html: &str| {
            let started = std::time::Instant::now();
            let reading = read(html);
            (reading, started.elapsed())
        };
        // Deep nesting, many tags, and the adoption agency's slow path.
        let deep = "<div>".repeat(40_000) + "deep";
        let (reading, took) = timed(&deep);
        assert!(reading.cut && !reading.visible.contains("deep"));
        assert!(took.as_secs() < 10, "{took:?}");
        let many = "<b id=i>".repeat(20_000) + &"<p>x".repeat(20_000);
        let (reading, took) = timed(&many);
        assert!(reading.cut);
        assert!(took.as_secs() < 10, "{took:?}");
        // A style sheet of a hundred thousand selectors, and many elements.
        let selectors: Vec<String> = (0..100_000).map(|n| format!(".c{n}")).collect();
        let sheet = format!(
            "<style>{} {{ color: red; font-size: 12px }}</style>{}",
            selectors.join(","),
            "<br>".repeat(9_000)
        );
        let (_, took) = timed(&sheet);
        assert!(took.as_secs() < 10, "{took:?}");
        // Formatting elements kept open by end tags that close nothing,
        // made again for each block.
        let kept_open: String = (0..3_000).map(|n| format!("<b id=a{n}></x>")).collect();
        let evading = format!("<div>{kept_open}</div>{}", "<div>x</div>".repeat(1_300));
        let (reading, took) = timed(&evading);
        assert!(reading.cut);
        assert!(took.as_secs() < 5, "{took:?}");
        // Broken HTML reads as little, and never fails.
        assert!(
            read("<p><b>unclosed <i>tags <div></p></span>")
                .visible
                .contains("unclosed")
        );
        let long = "<p>".to_string() + &"a".repeat(HTML_LIMIT + 10);
        assert!(read(&long).visible.len() <= TEXT_LIMIT);
    }

    #[test]
    fn inputs_the_fuzzer_found_read_without_failing() {
        // Each made the reader panic, slicing a colour inside a character.
        for found in [
            &include_bytes!("../fuzz/corpus/html/crash-colour-in-a-character")[..],
            &include_bytes!("../fuzz/corpus/html/crash-colour-before-a-null")[..],
        ] {
            let _ = read(&String::from_utf8_lossy(found));
        }
        assert_eq!(normal_color("#ff\u{fffd}ff"), "");
    }

    #[test]
    fn html_is_cleaned_and_its_remote_references_listed() {
        let cleaned = clean(
            r#"<p onclick="x()">Hi<script>steal()</script></p>
               <form action="https://evil.example/"><input name="password"></form>
               <iframe src="https://evil.example/frame"></iframe>
               <img src="https://tracker.example/pixel.gif" width="1">
               <img src="cid:logo@example.com">
               <a href="https://shop.example.com/">Shop</a>"#,
        );
        for gone in [
            "script", "steal", "onclick", "<form", "<input", "iframe", "frame",
        ] {
            assert!(!cleaned.html.contains(gone), "{gone}: {}", cleaned.html);
        }
        assert!(cleaned.html.contains("noopener"));
        assert_eq!(cleaned.remote, vec!["https://tracker.example/pixel.gif"]);
    }

    #[test]
    fn a_remote_reference_is_counted_however_it_is_spelled() {
        // Every spelling a browser would load is either removed or counted.
        let cleaned = clean(
            r#"<img src="ht&#9;tps://one.example/p.gif">
               <img src="\\two.example\p.gif">
               <img src="/\three.example/p.gif">
               <img src="//four.example/p.gif">
               <img src="HTTPS://FIVE.example/p.gif">
               <img src="relative/six.gif">
               <img src="data:image/gif;base64,R0lGOD">
               <video poster="https://seven.example/p.jpg"><source src="https://eight.example/v.mp4"></video>
               <table background="https://nine.example/bg.gif"><tr><td>x</td></tr></table>
               <img src="c&#9;id:logo@example.com">"#,
        );
        for host in [
            "two.", "three.", "four.", "six.", "seven.", "eight.", "nine.", "data:",
        ] {
            if cleaned.html.contains(host) {
                assert!(
                    cleaned
                        .remote
                        .iter()
                        .any(|reference| reference.contains(host)),
                    "{host} is left in the HTML and not counted: {}",
                    cleaned.html
                );
            }
        }
        for host in ["one.example", "FIVE.example"] {
            assert!(
                cleaned
                    .remote
                    .iter()
                    .any(|reference| reference.contains(host)),
                "{host}: {:?} {}",
                cleaned.remote,
                cleaned.html
            );
        }
        assert!(
            !cleaned
                .remote
                .iter()
                .any(|reference| reference.contains("logo@"))
        );
        assert!(
            clean(r#"<img src="cid:logo@example.com">"#)
                .html
                .contains("cid:logo@")
        );
    }

    #[test]
    fn colours_written_differently_are_one() {
        assert_eq!(normal_color("#FFF"), "#ffffff");
        assert_eq!(normal_color("white"), "#ffffff");
        assert_eq!(normal_color("rgb(255, 255, 255)"), "#ffffff");
        assert_eq!(normal_color("#ffffff url(x.png)"), "#ffffff");
        assert_eq!(normal_color("transparent"), TRANSPARENT);
        assert_eq!(normal_color("rgba(1, 2, 3, 0)"), TRANSPARENT);
        assert_eq!(normal_color("#11223300"), TRANSPARENT);
    }

    #[test]
    fn hosts_are_read_as_a_browser_reads_them() {
        assert_eq!(
            host_of("https://WWW.Example.com:8443/a?b").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            host_of("https://[2001:db8::1]/").as_deref(),
            Some("[2001:db8::1]")
        );
        assert_eq!(host_of("mailto:a@example.com"), None);
        assert_eq!(host_of("/relative/path"), None);
        assert!(looks_like_address("https://www.mybank.com/login"));
        assert!(!looks_like_address("Shop now"));
        assert!(!looks_like_address("v1.2"));
        assert!(!looks_like_address("report.pdf"));
    }
}
