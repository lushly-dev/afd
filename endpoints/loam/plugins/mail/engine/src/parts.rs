//! A message held in parts (the specification's M20): one over 1 MiB on
//! IMAP is fetched as its header block, its MIME structure, the parts that
//! hold its text, and a file when someone opens it.
//!
//! Its text is derived as a whole message's is: the text parts held are put
//! back in their places inside a message the engine writes from the
//! structure, with an empty body for every other part, and that message is
//! read by the same code that reads a whole one. So the parts, the text, the
//! links, the hidden text and the template key come out as they would for
//! the whole message. Its files are never put in that message: each one
//! held is decoded and read for what it is on its own, so a message's size
//! never grows with the files someone opened. A file not fetched has no
//! hash and no type read from its bytes, and its size is estimated from the
//! size the structure gives.
//!
//! The structure comes from the provider, and its names and types from the
//! message, a stranger's. Nothing of it is written into the message the
//! engine builds except as a token it checks, a quoted string it escapes,
//! or an RFC 2231 value it checks, so it can add no header and no boundary
//! of its own.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use mail_parser::{Encoding, MessageParser, MessagePart, PartKind};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::derive::{self, BodyFields};

/// One part as the structure describes it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Leaf {
    /// Its type, in lower case: `text/plain`.
    pub content_type: String,
    /// Its type's parameters as the provider gives them, names in lower
    /// case and values as written: `charset`, `name`, `format`, an RFC 2231
    /// `name*`.
    pub params: Vec<(String, String)>,
    /// Its disposition, in lower case: `attachment`, `inline`, or empty.
    pub disposition: String,
    /// Its disposition's parameters, as its type's are: `filename`.
    pub disposition_params: Vec<(String, String)>,
    /// Its transfer encoding, in lower case: `base64`.
    pub encoding: String,
    /// Its size as sent, encoded.
    pub size: u64,
}

/// A part of a message's structure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    /// A part with content of its own.
    Leaf(Leaf),
    /// A multipart: its subtype, in lower case, and its parts.
    Multipart {
        /// `mixed`, `alternative`.
        subtype: String,
        /// Its parts, in order.
        children: Vec<Node>,
    },
    /// A message carried inside this one, and its own structure.
    Message {
        /// The part that carries it.
        leaf: Leaf,
        /// The structure of the message carried.
        body: Box<Node>,
    },
}

/// A limit of the specification's 6.4 the structure broke.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Limit {
    /// More than 1 000 parts.
    Parts,
    /// Parts nested deeper than 20.
    Depth,
}

impl Limit {
    /// Why the message is not read, in the words a whole message's reading
    /// uses.
    #[must_use]
    pub fn reason(self) -> &'static str {
        match self {
            Self::Parts => "the message has more than 1 000 parts, the most the engine reads",
            Self::Depth => "the message's parts nest deeper than the engine reads",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Parts => "parts",
            Self::Depth => "depth",
        }
    }
}

/// A message's MIME structure, as its provider describes it: IMAP's
/// `BODYSTRUCTURE`. A structure past a limit is kept up to the limit, with
/// the limit it broke.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Structure {
    /// The message's body.
    pub root: Node,
    /// The limit it broke, when it broke one.
    pub limit: Option<Limit>,
}

/// The most parts a structure keeps, and the deepest it nests: one past the
/// limits, so that a structure that breaks one is told from one that meets
/// it.
pub const MOST_PARTS: usize = derive::PARTS_LIMIT + 1;
/// See [`MOST_PARTS`].
pub const DEEPEST: usize = derive::DEPTH_LIMIT + 1;

/// The most parameters a part keeps, the longest name of one, and the
/// longest value.
pub const MOST_PARAMS: usize = 30;
/// See [`MOST_PARAMS`].
pub const PARAM_NAME_LIMIT: usize = 60;
/// See [`MOST_PARAMS`].
pub const PARAM_VALUE_LIMIT: usize = 1024;

/// The largest text part fetched with a message held in parts, as sent. The
/// engine reads at most 4 MiB of HTML; one larger than this is left out of
/// the text, and can still be opened as a file.
pub const TEXT_PART_LIMIT: u64 = 16 * 1024 * 1024;

/// The most nodes a structure read back may hold: its parts, and the
/// multiparts around them. One the engine wrote holds fewer.
const MOST_NODES: usize = 4 * MOST_PARTS;

impl Structure {
    /// The structure of a message whose `BODYSTRUCTURE` nests deeper than
    /// the engine reads: nothing of it is known but that.
    #[must_use]
    pub fn too_deep() -> Self {
        Self {
            root: Node::Leaf(Leaf::default()),
            limit: Some(Limit::Depth),
        }
    }

    /// The structure as the store keeps it.
    #[must_use]
    pub fn to_json(&self) -> String {
        json!({
            "root": node_json(&self.root),
            "limit": self.limit.map(Limit::as_str),
        })
        .to_string()
    }

    /// The structure the store kept, or `None` when the text is not one.
    #[must_use]
    pub fn from_json(text: &str) -> Option<Self> {
        let value: Value = serde_json::from_str(text).ok()?;
        let limit = match value.get("limit").and_then(Value::as_str) {
            Some("parts") => Some(Limit::Parts),
            Some("depth") => Some(Limit::Depth),
            _ => None,
        };
        let mut nodes = 0;
        Some(Self {
            root: node_of(value.get("root")?, 0, &mut nodes)?,
            limit,
        })
    }

    /// Every part and its place, numbered as IMAP numbers them and as
    /// [`derive::body_fields`] numbers a whole message's parts: a message
    /// that is one part is `1`; the parts of a multipart are `1`, `2`; the
    /// parts of a message carried inside another are numbered under it.
    #[must_use]
    pub fn places(&self) -> Vec<(String, &Node)> {
        let mut places = Vec::new();
        number(&self.root, "", &mut places);
        places
    }

    /// The part at `place`, with content of its own.
    #[must_use]
    pub fn leaf(&self, place: &str) -> Option<&Leaf> {
        self.places()
            .into_iter()
            .find(|(at, _)| at == place)
            .and_then(|(_, node)| match node {
                Node::Leaf(leaf) | Node::Message { leaf, .. } => Some(leaf),
                Node::Multipart { .. } => None,
            })
    }
}

fn params_json(params: &[(String, String)]) -> Value {
    params
        .iter()
        .map(|(name, value)| json!([name, value]))
        .collect()
}

fn leaf_json(leaf: &Leaf) -> Value {
    json!({
        "type": leaf.content_type,
        "params": params_json(&leaf.params),
        "disposition": leaf.disposition,
        "dispositionParams": params_json(&leaf.disposition_params),
        "encoding": leaf.encoding,
        "size": leaf.size,
    })
}

fn node_json(node: &Node) -> Value {
    match node {
        Node::Leaf(leaf) => json!({ "leaf": leaf_json(leaf) }),
        Node::Multipart { subtype, children } => json!({
            "multipart": subtype,
            "children": children.iter().map(node_json).collect::<Vec<_>>(),
        }),
        Node::Message { leaf, body } => json!({
            "message": leaf_json(leaf),
            "body": node_json(body),
        }),
    }
}

fn params_of(value: &Value) -> Option<Vec<(String, String)>> {
    value
        .as_array()?
        .iter()
        .take(MOST_PARAMS)
        .map(|pair| {
            let pair = pair.as_array()?;
            Some((
                pair.first()?.as_str()?.to_string(),
                pair.get(1)?.as_str()?.to_string(),
            ))
        })
        .collect()
}

fn leaf_of(value: &Value) -> Option<Leaf> {
    let text = |name: &str| -> Option<String> { Some(value.get(name)?.as_str()?.to_string()) };
    Some(Leaf {
        content_type: text("type")?,
        params: params_of(value.get("params")?)?,
        disposition: text("disposition")?,
        disposition_params: params_of(value.get("dispositionParams")?)?,
        encoding: text("encoding")?,
        size: value.get("size")?.as_u64()?,
    })
}

fn node_of(value: &Value, depth: usize, nodes: &mut usize) -> Option<Node> {
    *nodes += 1;
    if depth > DEEPEST + 1 || *nodes > MOST_NODES {
        return None;
    }
    if let Some(leaf) = value.get("leaf") {
        return Some(Node::Leaf(leaf_of(leaf)?));
    }
    if let Some(leaf) = value.get("message") {
        return Some(Node::Message {
            leaf: leaf_of(leaf)?,
            body: Box::new(node_of(value.get("body")?, depth + 1, nodes)?),
        });
    }
    let subtype = value.get("multipart")?.as_str()?.to_string();
    let children = value
        .get("children")?
        .as_array()?
        .iter()
        .map(|child| node_of(child, depth + 1, nodes))
        .collect::<Option<Vec<_>>>()?;
    Some(Node::Multipart { subtype, children })
}

/// The place of the `index`th part under `place`.
fn under(place: &str, index: usize) -> String {
    if place.is_empty() {
        (index + 1).to_string()
    } else {
        format!("{place}.{}", index + 1)
    }
}

/// A part's own place: `1` for a message that is one part.
fn own(place: &str) -> String {
    if place.is_empty() {
        "1".to_string()
    } else {
        place.to_string()
    }
}

/// Numbers `node` at `place` and what is under it, as `derive`'s walk does.
fn number<'a>(node: &'a Node, place: &str, places: &mut Vec<(String, &'a Node)>) {
    match node {
        Node::Multipart { children, .. } => {
            for (index, child) in children.iter().enumerate() {
                number(child, &under(place, index), places);
            }
        }
        Node::Leaf(_) => places.push((own(place), node)),
        Node::Message { body, .. } => {
            let own = own(place);
            places.push((own.clone(), node));
            if matches!(**body, Node::Multipart { .. }) {
                number(body, &own, places);
            } else {
                number(body, &format!("{own}.1"), places);
            }
        }
    }
}

/// The places of the parts that hold the message's text: the plain and
/// HTML parts a reader of the whole message would show, each no larger than
/// [`TEXT_PART_LIMIT`]. Read from the structure alone, before any of them is
/// fetched.
#[must_use]
pub fn text_places(structure: &Structure) -> Vec<String> {
    if structure.limit.is_some() {
        return Vec::new();
    }
    let built = assemble(structure, &BTreeMap::new());
    let found = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Some(message) = MessageParser::new()
            .max_depth(derive::DEPTH_LIMIT + 1)
            .max_parts(derive::PARTS_LIMIT + 1)
            .parse(&built)
        else {
            return Vec::new();
        };
        let mut places = Vec::new();
        text_walk(message.root_part(), "", 0, &mut places);
        places
    }))
    .unwrap_or_default();
    found
        .into_iter()
        .filter(|place| {
            structure
                .leaf(place)
                .is_some_and(|leaf| leaf.size <= TEXT_PART_LIMIT)
        })
        .collect()
}

/// Collects the places of the top message's text parts, numbered as
/// [`number`] numbers them. A message carried inside is not entered: its
/// text is its own.
fn text_walk(part: MessagePart<'_>, place: &str, depth: usize, places: &mut Vec<String>) {
    if depth > derive::DEPTH_LIMIT {
        return;
    }
    match part.kind() {
        PartKind::Multipart => {
            for (index, child) in part.children().enumerate() {
                text_walk(child, &under(place, index), depth + 1, places);
            }
        }
        PartKind::Text | PartKind::Html if part.in_text_body() || part.in_html_body() => {
            places.push(own(place));
        }
        _ => {}
    }
}

/// The message the engine writes from `structure`, with the bytes `texts`
/// gives for each place and an empty body for every other part. A part is
/// written as the provider returned it, still in its transfer encoding.
#[must_use]
pub fn assemble(structure: &Structure, texts: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    // Each boundary is made from the hash of every byte written, so that no
    // part's bytes can hold one.
    let mut hasher = Sha256::new();
    for (place, bytes) in texts {
        hasher.update(place.as_bytes());
        hasher.update([0]);
        hasher.update(u64::try_from(bytes.len()).unwrap_or(u64::MAX).to_be_bytes());
        hasher.update(bytes);
    }
    let digest = hasher.finalize();
    let mut seed = String::with_capacity(32);
    for byte in &digest[..16] {
        let _ = write!(seed, "{byte:02x}");
    }
    let mut writer = Writer {
        out: Vec::new(),
        seed,
        boundaries: 0,
        texts,
    };
    writer.node(&structure.root, "", 0);
    writer.out
}

struct Writer<'a> {
    out: Vec<u8>,
    seed: String,
    boundaries: usize,
    texts: &'a BTreeMap<String, Vec<u8>>,
}

impl Writer<'_> {
    fn node(&mut self, node: &Node, place: &str, depth: usize) {
        if depth > DEEPEST {
            self.out
                .extend_from_slice(b"Content-Type: text/plain\r\n\r\n");
            return;
        }
        match node {
            Node::Multipart { subtype, children } => {
                self.boundaries += 1;
                let boundary = format!("=_loam_{}_{}", self.seed, self.boundaries);
                let subtype = if is_token(subtype) {
                    subtype.as_str()
                } else {
                    "mixed"
                };
                let _ = write!(
                    Text(&mut self.out),
                    "Content-Type: multipart/{subtype}; boundary=\"{boundary}\"\r\n\r\n"
                );
                for (index, child) in children.iter().enumerate() {
                    let _ = write!(Text(&mut self.out), "--{boundary}\r\n");
                    self.node(child, &under(place, index), depth + 1);
                    self.out.extend_from_slice(b"\r\n");
                }
                let _ = write!(Text(&mut self.out), "--{boundary}--\r\n");
            }
            Node::Leaf(leaf) => {
                self.headers(leaf);
                if let Some(bytes) = self.texts.get(&own(place)) {
                    self.out.extend_from_slice(bytes);
                }
            }
            Node::Message { leaf, body } => {
                self.headers(leaf);
                let own = own(place);
                if matches!(**body, Node::Multipart { .. }) {
                    self.node(body, &own, depth + 1);
                } else {
                    self.node(body, &format!("{own}.1"), depth + 1);
                }
            }
        }
    }

    /// A part's own headers, ended by the blank line.
    fn headers(&mut self, leaf: &Leaf) {
        let content_type = match leaf.content_type.split_once('/') {
            Some((main, sub)) if is_token(main) && is_token(sub) => leaf.content_type.as_str(),
            _ => "application/octet-stream",
        };
        let mut out = Text(&mut self.out);
        let _ = write!(out, "Content-Type: {content_type}");
        write_params(&mut out, &leaf.params);
        let _ = write!(out, "\r\n");
        if matches!(
            leaf.encoding.as_str(),
            "base64" | "quoted-printable" | "7bit" | "8bit" | "binary"
        ) {
            let _ = write!(out, "Content-Transfer-Encoding: {}\r\n", leaf.encoding);
        }
        if is_token(&leaf.disposition) || !leaf.disposition_params.is_empty() {
            let disposition = if is_token(&leaf.disposition) {
                leaf.disposition.as_str()
            } else {
                "attachment"
            };
            let _ = write!(out, "Content-Disposition: {disposition}");
            write_params(&mut out, &leaf.disposition_params);
            let _ = write!(out, "\r\n");
        }
        let _ = write!(out, "\r\n");
    }
}

/// Writes each parameter the provider gave as the message wrote it, so that
/// it is read as a whole message's would be: an RFC 2231 value (a name
/// ending in `*`) as it is, when it holds only what such a value may; any
/// other as a quoted string, with its quotes and backslashes escaped and no
/// control character. `boundary` is the engine's own, and a name that is
/// not a token is left out.
fn write_params(out: &mut Text<'_>, params: &[(String, String)]) {
    for (name, value) in params.iter().take(MOST_PARAMS) {
        let name_ok = !name.is_empty()
            && name.len() <= PARAM_NAME_LIMIT
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.!#$&+^`|~*".contains(&b));
        if !name_ok || name.eq_ignore_ascii_case("boundary") || value.len() > PARAM_VALUE_LIMIT {
            continue;
        }
        if name.ends_with('*') {
            let value_ok = value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.!#$&+^`|~%'".contains(&b));
            if value_ok {
                let _ = write!(out, "; {name}={value}");
            }
            continue;
        }
        let mut quoted = String::with_capacity(value.len() + 2);
        for c in value.chars() {
            match c {
                '"' | '\\' => {
                    quoted.push('\\');
                    quoted.push(c);
                }
                c if c.is_control() => {}
                c => quoted.push(c),
            }
        }
        let _ = write!(out, "; {name}=\"{quoted}\"");
    }
}

/// Lets `write!` append text to a byte buffer.
struct Text<'a>(&'a mut Vec<u8>);

impl std::fmt::Write for Text<'_> {
    fn write_str(&mut self, text: &str) -> std::fmt::Result {
        self.0.extend_from_slice(text.as_bytes());
        Ok(())
    }
}

/// Whether `text` is a MIME token: not empty, and only the characters a
/// token may hold.
fn is_token(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 120
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

/// What a message held in parts says, from its structure and the text parts
/// `texts` holds, as [`derive::body_fields`] says it of a whole message.
/// Every other part is left as not read: [`with_file`] reads a file held.
#[must_use]
pub fn body_fields(structure: &Structure, texts: &BTreeMap<String, Vec<u8>>) -> BodyFields {
    if let Some(limit) = structure.limit {
        return BodyFields {
            unparsed: Some(limit.reason()),
            ..BodyFields::default()
        };
    }
    let mut fields = derive::body_fields(&assemble(structure, texts));
    let places = structure.places();
    // The parts are the ones the provider described; a part the reader adds
    // to one written empty (a `message/global` read as a message) is not.
    fields
        .parts
        .retain(|part| places.iter().any(|(at, _)| *at == part.place));
    for part in &mut fields.parts {
        if texts.contains_key(&part.place) {
            continue;
        }
        // Nothing of a part not held was read: its size is estimated from
        // the one the structure gives, and its bytes say nothing yet.
        if let Some((_, Node::Leaf(leaf) | Node::Message { leaf, .. })) =
            places.iter().find(|(at, _)| *at == part.place)
        {
            part.size = decoded_size(leaf);
        }
        part.hash = None;
        part.detected = String::new();
        part.type_differs = false;
    }
    fields
}

/// Reads the file at `place`, held and decoded, into `fields`: its size, and
/// what its bytes say of it, as a whole message's reading would.
pub fn with_file(fields: &mut BodyFields, place: &str, decoded: &[u8]) {
    let Some(part) = fields.parts.iter_mut().find(|part| part.place == place) else {
        return;
    };
    part.size = u64::try_from(decoded.len()).unwrap_or(u64::MAX);
    let is_file = part.attachment
        || !part.name.is_empty()
        || !(part.content_type.starts_with("text/")
            || part.content_type.starts_with("message/")
            || part.content_type.starts_with("multipart/"));
    if is_file {
        let (detected, type_differs, hash) =
            derive::file_facts(decoded, &part.content_type, &part.name);
        part.detected = detected;
        part.type_differs = type_differs;
        part.hash = hash;
    }
}

/// About how large a part is once decoded, from its size as sent: base64
/// writes 57 bytes as a line of 76 characters and a line break.
fn decoded_size(leaf: &Leaf) -> u64 {
    if leaf.encoding == "base64" {
        leaf.size / 78 * 57 + (leaf.size % 78) * 3 / 4
    } else {
        leaf.size
    }
}

/// The decoded content of the part at `place`, from its bytes as the
/// provider returned them.
#[must_use]
pub fn decoded(structure: &Structure, place: &str, bytes: &[u8]) -> Option<Vec<u8>> {
    let leaf = structure.leaf(place)?;
    let encoding = match leaf.encoding.as_str() {
        "base64" => Encoding::Base64,
        "quoted-printable" => Encoding::QuotedPrintable,
        _ => Encoding::None,
    };
    Some(encoding.decode(bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A part's header value's parameters as written: the names in lower
    /// case, a quoted value unquoted, an RFC 2231 value as it is. What a
    /// server's `BODYSTRUCTURE` gives.
    fn raw_params(value: &str) -> Vec<(String, String)> {
        let mut params = Vec::new();
        let mut rest = value.split_once(';').map_or("", |(_, rest)| rest);
        loop {
            rest = rest.trim_start_matches([' ', '\t', '\r', '\n', ';']);
            let Some((name, after)) = rest.split_once('=') else {
                break;
            };
            let name = name.trim().to_ascii_lowercase();
            let after = after.trim_start();
            let (value, next) = if let Some(quoted) = after.strip_prefix('"') {
                let mut value = String::new();
                let mut chars = quoted.char_indices();
                let mut end = quoted.len();
                while let Some((at, c)) = chars.next() {
                    match c {
                        '\\' => {
                            if let Some((_, escaped)) = chars.next() {
                                value.push(escaped);
                            }
                        }
                        '"' => {
                            end = at + 1;
                            break;
                        }
                        c => value.push(c),
                    }
                }
                (value, &quoted[end..])
            } else {
                let end = after.find(';').unwrap_or(after.len());
                (after[..end].trim().to_string(), &after[end..])
            };
            params.push((name, value));
            rest = next;
        }
        params
    }

    /// The raw value of a part's header, unfolded.
    fn header(part: &MessagePart<'_>, name: &str) -> Option<String> {
        let raw = String::from_utf8_lossy(part.raw_headers())
            .replace("\r\n ", " ")
            .replace("\r\n\t", " ");
        raw.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case(name)
                .then(|| value.trim().to_string())
        })
    }

    /// A structure read from a whole message, as a server's `BODYSTRUCTURE`
    /// describes it: parameters as the message wrote them.
    fn structure_of(whole: &[u8]) -> Structure {
        let message = MessageParser::new().parse(whole).unwrap();
        Structure {
            root: node_from(message.root_part()),
            limit: None,
        }
    }

    fn node_from(part: MessagePart<'_>) -> Node {
        let leaf = || {
            let content_type = header(&part, "content-type");
            let disposition = header(&part, "content-disposition");
            Leaf {
                content_type: part.content_type().map_or_else(
                    || "text/plain".to_string(),
                    |content_type| {
                        format!(
                            "{}/{}",
                            content_type.ctype(),
                            content_type.subtype().unwrap_or("plain")
                        )
                        .to_lowercase()
                    },
                ),
                params: content_type.as_deref().map(raw_params).unwrap_or_default(),
                disposition: disposition
                    .as_deref()
                    .map(|d| d.split(';').next().unwrap_or("").trim().to_lowercase())
                    .unwrap_or_default(),
                disposition_params: disposition.as_deref().map(raw_params).unwrap_or_default(),
                encoding: part
                    .content_transfer_encoding()
                    .unwrap_or_default()
                    .to_lowercase(),
                size: u64::try_from(part.raw_body().len()).unwrap(),
            }
        };
        match part.kind() {
            PartKind::Multipart => Node::Multipart {
                subtype: part
                    .content_type()
                    .and_then(|c| c.subtype().map(str::to_lowercase))
                    .unwrap_or_else(|| "mixed".to_string()),
                children: part.children().map(node_from).collect(),
            },
            PartKind::Message(nested) => Node::Message {
                leaf: leaf(),
                body: Box::new(node_from(nested.root_part())),
            },
            _ => Node::Leaf(leaf()),
        }
    }

    /// Each place's bytes as the server returns them: the part's body,
    /// still encoded. A message carried is one place, not entered.
    fn raw_parts(whole: &[u8]) -> BTreeMap<String, Vec<u8>> {
        let message = MessageParser::new().parse(whole).unwrap();
        let mut held = BTreeMap::new();
        raw_walk(message.root_part(), "", &mut held);
        held
    }

    fn raw_walk(part: MessagePart<'_>, place: &str, held: &mut BTreeMap<String, Vec<u8>>) {
        match part.kind() {
            PartKind::Multipart => {
                for (index, child) in part.children().enumerate() {
                    raw_walk(child, &under(place, index), held);
                }
            }
            _ => {
                held.insert(own(place), part.raw_body().to_vec());
            }
        }
    }

    /// What a message held in parts says once it holds every one of its
    /// parts: its text parts, then each file read on its own.
    fn held_in_full(whole: &[u8]) -> BodyFields {
        let structure = structure_of(whole);
        let raw = raw_parts(whole);
        let places = text_places(&structure);
        let texts: BTreeMap<String, Vec<u8>> = raw
            .iter()
            .filter(|(place, _)| places.contains(place))
            .map(|(place, bytes)| (place.clone(), bytes.clone()))
            .collect();
        let mut fields = body_fields(&structure, &texts);
        for (place, bytes) in &raw {
            if !places.contains(place) {
                with_file(
                    &mut fields,
                    place,
                    &decoded(&structure, place, bytes).unwrap(),
                );
            }
        }
        fields
    }

    const MIXED: &[u8] = b"From: a@example.org\r\n\
Subject: the plan\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"outer\"\r\n\
\r\n\
--outer\r\n\
Content-Type: multipart/alternative; boundary=\"inner\"\r\n\
\r\n\
--inner\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
Content-Transfer-Encoding: quoted-printable\r\n\
\r\n\
The plan for the garden, see https://example.org/plan =E2=80=94 soon.\r\n\
--inner\r\n\
Content-Type: text/html; charset=utf-8\r\n\
\r\n\
<p>The plan for the <b>garden</b>, see <a href=\"https://example.org/plan\">the plan</a>.</p>\
<p style=\"display:none\">hidden words</p>\r\n\
--inner--\r\n\
\r\n\
--outer\r\n\
Content-Type: application/pdf; name=\"plan \\\"one\\\".pdf\"\r\n\
Content-Disposition: attachment; filename=\"plan \\\"one\\\".pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoK\r\n\
--outer\r\n\
Content-Type: message/rfc822\r\n\
\r\n\
From: b@example.org\r\n\
Subject: forwarded\r\n\
Content-Type: text/plain\r\n\
\r\n\
the forwarded words\r\n\
--outer--\r\n";

    /// Names as mail clients write them: an RFC 2047 encoded word, an
    /// RFC 2231 value, one in pieces; and a plain part sent flowed.
    const NAMED: &[u8] = b"From: a@example.org\r\n\
Content-Type: multipart/mixed; boundary=\"b\"\r\n\
\r\n\
--b\r\n\
Content-Type: text/plain; charset=utf-8; format=flowed; delsp=yes\r\n\
\r\n\
A line that goes on \r\n\
and on.\r\n\
--b\r\n\
Content-Type: application/pdf; name=\"=?UTF-8?B?w6l0w6kucGRm?=\"\r\n\
Content-Disposition: attachment\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
JVBERi0xLjQK\r\n\
--b\r\n\
Content-Type: application/pdf\r\n\
Content-Disposition: attachment; filename*=utf-8''%C3%A9t%C3%A9%20deux.pdf\r\n\
\r\n\
%PDF-1.4\r\n\
--b\r\n\
Content-Type: application/octet-stream\r\n\
Content-Disposition: attachment; filename*0*=utf-8''%C3%A9t; filename*1*=%C3%A9.bin\r\n\
\r\n\
data\r\n\
--b--\r\n";

    #[test]
    fn the_text_places_are_the_parts_a_reader_shows() {
        assert_eq!(text_places(&structure_of(MIXED)), ["1.1", "1.2"]);
        assert_eq!(text_places(&structure_of(NAMED)), ["1"]);
    }

    #[test]
    fn a_message_held_whole_and_one_held_in_parts_say_the_same() {
        for message in [MIXED, NAMED] {
            assert_eq!(held_in_full(message), derive::body_fields(message));
        }
        let whole = derive::body_fields(MIXED);
        assert!(whole.text.contains("the plan"));
        assert!(whole.hidden_chars > 0);
        assert_eq!(whole.parts[2].name, "plan \"one\".pdf");
        assert_eq!(whole.parts[2].detected, "application/pdf");
        let names: Vec<String> = derive::body_fields(NAMED)
            .parts
            .iter()
            .map(|part| part.name.clone())
            .collect();
        assert_eq!(names, ["", "été.pdf", "été deux.pdf", "été.bin"]);
    }

    #[test]
    fn its_text_alone_gives_the_text_and_leaves_the_files_unread() {
        let whole = derive::body_fields(MIXED);
        let structure = structure_of(MIXED);
        let texts: BTreeMap<String, Vec<u8>> = raw_parts(MIXED)
            .into_iter()
            .filter(|(place, _)| text_places(&structure).contains(place))
            .collect();
        let parts = body_fields(&structure, &texts);
        assert_eq!(parts.text, whole.text);
        assert_eq!(parts.snippet, whole.snippet);
        assert_eq!(parts.links, whole.links);
        assert_eq!(parts.hidden_chars, whole.hidden_chars);
        assert_eq!(parts.body_shape, whole.body_shape);
        assert_eq!(parts.structure, whole.structure);
        assert_eq!(parts.attachments, whole.attachments);
        let places: Vec<&str> = parts.parts.iter().map(|part| part.place.as_str()).collect();
        assert_eq!(places, ["1.1", "1.2", "2", "3", "3.1"]);
        let file = &parts.parts[2];
        assert_eq!(file.name, "plan \"one\".pdf");
        assert_eq!(file.hash, None);
        assert_eq!(file.detected, "");
        // 64 characters of base64 are 48 bytes.
        assert_eq!(file.size, 48);
    }

    #[test]
    fn a_file_is_read_on_its_own_however_large_and_the_text_stays() {
        let structure = Structure {
            root: Node::Multipart {
                subtype: "mixed".to_string(),
                children: vec![
                    Node::Leaf(Leaf {
                        content_type: "text/plain".to_string(),
                        size: 5,
                        ..Leaf::default()
                    }),
                    Node::Leaf(Leaf {
                        content_type: "application/octet-stream".to_string(),
                        disposition: "attachment".to_string(),
                        encoding: "binary".to_string(),
                        size: 70 << 20,
                        ..Leaf::default()
                    }),
                ],
            },
            limit: None,
        };
        let texts = BTreeMap::from([("1".to_string(), b"words".to_vec())]);
        let mut fields = body_fields(&structure, &texts);
        // Larger than the most a whole message is read up to, and than the
        // most a file is hashed up to.
        let file = vec![0u8; 70 << 20];
        with_file(&mut fields, "2", &file);
        assert_eq!(fields.unparsed, None);
        assert_eq!(fields.text, "words");
        assert_eq!(fields.parts[1].size, 70 << 20);
        assert_eq!(fields.parts[1].hash, None);
        // One within that is read for what it is.
        with_file(&mut fields, "2", b"%PDF-1.4");
        assert_eq!(fields.parts[1].detected, "application/pdf");
        assert!(fields.parts[1].hash.is_some());
    }

    #[test]
    fn a_file_is_decoded_from_its_bytes_as_returned() {
        let structure = structure_of(MIXED);
        let held = raw_parts(MIXED);
        assert_eq!(
            decoded(&structure, "2", &held["2"]),
            derive::part_content(MIXED, "2")
        );
        assert!(
            decoded(&structure, "2", &held["2"])
                .unwrap()
                .starts_with(b"%PDF")
        );
        assert_eq!(decoded(&structure, "9", b""), None);
    }

    #[test]
    fn a_structure_reads_back_from_what_the_store_keeps() {
        for message in [MIXED, NAMED] {
            let structure = structure_of(message);
            assert_eq!(Structure::from_json(&structure.to_json()), Some(structure));
        }
        assert_eq!(Structure::from_json("{"), None);
        assert_eq!(Structure::from_json("{\"root\": {}}"), None);
        let too_deep = Structure::too_deep();
        assert_eq!(Structure::from_json(&too_deep.to_json()), Some(too_deep));
    }

    #[test]
    fn names_and_types_from_the_message_add_no_header_or_boundary() {
        let pair = |name: &str, value: &str| (name.to_string(), value.to_string());
        let leaf = Leaf {
            content_type: "text/plain\r\nX-Injected: yes".to_string(),
            params: vec![
                pair("charset", "utf-8\"; boundary=\"x"),
                pair("name", "a\r\nContent-Type: text/html\\"),
                pair("boundary", "evil"),
                pair("x\r\ny", "z"),
                pair("name*", "utf-8''a\r\nX: y"),
            ],
            disposition: "attachment\r\nX: y".to_string(),
            disposition_params: vec![pair("filename", "\"\r\n\r\n--=_loam_")],
            encoding: "base64\r\nX: z".to_string(),
            size: 3,
        };
        let structure = Structure {
            root: Node::Multipart {
                subtype: "mixed\"; boundary=\"evil".to_string(),
                children: vec![Node::Leaf(leaf)],
            },
            limit: None,
        };
        let built = assemble(&structure, &BTreeMap::new());
        let text = String::from_utf8(built).unwrap();
        assert!(!text.contains("X-Injected"));
        assert!(!text.contains("evil"));
        assert!(!text.contains("X: "));
        assert!(!text.contains("\r\nContent-Type: text/html"));
        assert!(text.contains("Content-Type: application/octet-stream"));
        // Each header is one line: no value carries a line break.
        let fields = body_fields(&structure, &BTreeMap::new());
        assert_eq!(fields.parts.len(), 1);
        assert!(!fields.parts[0].name.contains('\n'));
    }

    #[test]
    fn a_structure_past_a_limit_is_not_read() {
        let structure = Structure {
            root: Node::Leaf(Leaf::default()),
            limit: Some(Limit::Parts),
        };
        assert_eq!(
            body_fields(&structure, &BTreeMap::new()).unparsed,
            Some(Limit::Parts.reason())
        );
        assert!(text_places(&structure).is_empty());
        assert_eq!(
            body_fields(&Structure::too_deep(), &BTreeMap::new()).unparsed,
            Some(Limit::Depth.reason())
        );
    }

    #[test]
    fn a_text_part_too_large_is_left_out_of_the_text() {
        let mut structure = structure_of(MIXED);
        if let Node::Multipart { children, .. } = &mut structure.root
            && let Node::Multipart { children, .. } = &mut children[0]
            && let Node::Leaf(html) = &mut children[1]
        {
            html.size = TEXT_PART_LIMIT + 1;
        }
        assert_eq!(text_places(&structure), ["1.1"]);
    }
}
