//! What code reads from a message's bytes: the fields a list shows, the keys
//! that join it to a thread, its parts and its text.
//!
//! Everything here is recomputed from the log and never edited (the
//! specification's sections 4.3 and 6): what a list, a thread and a search
//! need, and the evidence of section 6.1. The visible text is the HTML with
//! what a person cannot see removed ([`crate::html`]), or the plain part when
//! there is no HTML; hidden text is counted and kept out of the snippet and
//! the index. The limits of section 6.4 are checked before work is done.

use std::panic::{AssertUnwindSafe, catch_unwind};

use mail_parser::{MessageParser, MessagePart, PartKind};
use sha2::{Digest, Sha256};

/// The version of this derivation. A row records the version that wrote it,
/// so that a later version can tell which rows to recompute.
///
/// 2: the evidence of the specification's section 6.1, and the visible text
/// in place of the plain part.
pub const PARSER_VERSION: u32 = 2;

/// The key of a Message-ID in the thread table: the first 16 bytes of its
/// SHA-256.
pub type ThreadKey = [u8; 16];

/// The longest subject kept, in characters.
const SUBJECT_LIMIT: usize = 400;
/// The longest sender name or address kept, in characters.
const SENDER_LIMIT: usize = 320;
/// The longest snippet kept, in characters.
const SNIPPET_LIMIT: usize = 200;
/// How many Message-IDs of a message's References are read.
const REFERENCES_LIMIT: usize = 200;
/// The most text of one message handed to the search index, in bytes.
const TEXT_LIMIT: usize = 1024 * 1024;
/// How many parts of one message are read (the specification's 6.4).
pub(crate) const PARTS_LIMIT: usize = 1000;
/// How deeply parts may nest (6.4).
pub(crate) const DEPTH_LIMIT: usize = 20;
/// The largest header block read (6.4).
pub const HEADER_LIMIT: usize = 1024 * 1024;
/// The largest message read (6.4). A message the engine holds whole is at
/// most 1 MiB on IMAP; this bounds what a provider can make it parse.
pub const MESSAGE_LIMIT: usize = 64 * 1024 * 1024;
/// The largest part hashed and sniffed for its type.
const SNIFF_LIMIT: usize = 32 * 1024 * 1024;
/// The longest list id or header token kept.
const TOKEN_LIMIT: usize = 255;

/// What a header block says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HeaderFields {
    /// The Date header, in milliseconds since the epoch.
    pub sent_at: Option<i64>,
    /// The first address of From, in lower case; empty when there is none.
    pub sender_address: String,
    /// The name beside it; empty when there is none.
    pub sender_name: String,
    /// The subject, decoded.
    pub subject: String,
    /// The keys of the message's own Message-ID and of every id its
    /// References and In-Reply-To name, each once.
    pub keys: Vec<ThreadKey>,
    /// The list it came through: the id inside `List-Id`, in lower case.
    pub list_id: String,
    /// How it can be unsubscribed from: 0 not at all, 1 a
    /// `List-Unsubscribe` header, 2 that and a one-click
    /// `List-Unsubscribe-Post`.
    pub unsubscribe: u8,
    /// `Precedence`, in lower case.
    pub precedence: String,
    /// `Auto-Submitted`, in lower case; empty when absent or `no`.
    pub auto_submitted: String,
    /// The first address of `Reply-To`, in lower case.
    pub reply_to: String,
    /// The first half of the template key ([`template_head`]).
    pub template_head: [u8; 16],
    /// What the topmost `Authentication-Results` headers say: the last
    /// server's, and when that is a known provider's, every header of the run
    /// its servers wrote at the top. Whether that is the account's provider is
    /// decided by who reads it ([`trusted_authentication`]).
    pub authentication: Option<Authentication>,
    /// Why the block could not be read, when it could not.
    pub unparsed: Option<&'static str>,
}

/// What an `Authentication-Results` header says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Authentication {
    /// The server that wrote it (its `authserv-id`), in lower case.
    pub server: String,
    /// The SPF result: `pass`, `fail`, `softfail`, `neutral`, `none`,
    /// `temperror`, `permerror`, or `other`; empty when not given.
    pub spf: String,
    /// The DKIM result, in the same words.
    pub dkim: String,
    /// The DMARC result, in the same words.
    pub dmarc: String,
}

/// One part of a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartFound {
    /// Its place, as IMAP numbers it: `1`, `1.2`.
    pub place: String,
    /// Its type, in lower case: `text/plain`.
    pub content_type: String,
    /// Its file name; empty when it has none.
    pub name: String,
    /// The length of its content once decoded.
    pub size: u64,
    /// Whether it is offered as an attachment.
    pub attachment: bool,
    /// Its type as its bytes show it, when they show one: `application/pdf`.
    pub detected: String,
    /// Whether its bytes show another kind of file than its name or type
    /// says: an executable named `invoice.pdf`.
    pub type_differs: bool,
    /// The SHA-256 of its decoded content.
    pub hash: Option<[u8; 32]>,
}

/// What a whole message's body says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BodyFields {
    /// The start of the text, on one line.
    pub snippet: String,
    /// The text, for the search index.
    pub text: String,
    /// The parts, in order.
    pub parts: Vec<PartFound>,
    /// How many of them are attachments.
    pub attachments: u32,
    /// How many characters of text a person would not see.
    pub hidden_chars: u32,
    /// The links, with the host the text shown for each names.
    pub links: Vec<Link>,
    /// The body's shape: its HTML skeleton, or its plain text's line shapes
    /// (the specification's 6.3).
    pub body_shape: Option<[u8; 16]>,
    /// Its MIME structure: the parts' types in order, then the multiparts'.
    pub structure: String,
    /// Why the message could not be read, when it could not.
    pub unparsed: Option<&'static str>,
}

pub use crate::html::Link;

/// Reads a header block. Bytes that cannot be read give empty fields and the
/// reason; this never fails and never panics.
#[must_use]
pub fn header_fields(header_block: &[u8]) -> HeaderFields {
    let read = catch_unwind(AssertUnwindSafe(|| read_header(header_block)));
    match read {
        Ok(Some(fields)) => fields,
        Ok(None) => HeaderFields {
            unparsed: Some("no header block"),
            ..HeaderFields::default()
        },
        Err(_) => HeaderFields {
            unparsed: Some("the parser failed on the headers"),
            ..HeaderFields::default()
        },
    }
}

/// Reads a whole message. Bytes that cannot be read give empty fields and
/// the reason; this never fails and never panics.
#[must_use]
pub fn body_fields(whole: &[u8]) -> BodyFields {
    let read = catch_unwind(AssertUnwindSafe(|| read_body(whole)));
    match read {
        Ok(Some(fields)) => fields,
        Ok(None) => BodyFields {
            unparsed: Some("not a message"),
            ..BodyFields::default()
        },
        Err(_) => BodyFields {
            unparsed: Some("the parser failed on the body"),
            ..BodyFields::default()
        },
    }
}

/// The key of one Message-ID.
#[must_use]
pub fn thread_key(message_id: &str) -> ThreadKey {
    let digest = Sha256::digest(message_id.trim().as_bytes());
    let mut key = [0_u8; 16];
    key.copy_from_slice(&digest[..16]);
    key
}

fn read_header(header_block: &[u8]) -> Option<HeaderFields> {
    if header_block.len() > HEADER_LIMIT {
        return Some(HeaderFields {
            unparsed: Some("the header block is over 1 MiB, the most the engine reads"),
            ..HeaderFields::default()
        });
    }
    let message = MessageParser::new().parse_headers(header_block)?;
    let headers = message.headers();
    let raw = |name: &str| -> Option<String> {
        headers
            .get(name)
            .map(|header| one_line(&String::from_utf8_lossy(header.raw_value()), 4096))
    };
    let list_id = raw("List-Id")
        .map(|value| {
            let inside = value
                .rsplit_once('<')
                .and_then(|(_, rest)| rest.split_once('>'))
                .map_or(value.as_str(), |(id, _)| id);
            one_line(&inside.trim().to_lowercase(), TOKEN_LIMIT)
        })
        .unwrap_or_default();
    let unsubscribe = match (
        headers.contains("List-Unsubscribe"),
        raw("List-Unsubscribe-Post")
            .is_some_and(|value| value.to_lowercase().contains("list-unsubscribe=one-click")),
    ) {
        (false, _) => 0,
        (true, false) => 1,
        (true, true) => 2,
    };
    let token = |value: Option<String>| {
        value
            .map(|value| one_line(&value.trim().to_lowercase(), TOKEN_LIMIT))
            .unwrap_or_default()
    };
    let auto_submitted = token(raw("Auto-Submitted").map(|value| {
        value
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_string()
    }));
    let reply_to = message
        .reply_to()
        .and_then(|list| {
            list.first()
                .and_then(|mailbox| mailbox.address().map(str::to_lowercase))
        })
        .map(|address| one_line(&address, SENDER_LIMIT))
        .unwrap_or_default();
    let fields: Vec<Field> = headers
        .iter()
        .take(400)
        .filter_map(|header| {
            let name = header.raw_name();
            let value = || String::from_utf8_lossy(header.raw_value()).into_owned();
            if name.eq_ignore_ascii_case("Received") {
                Some(Field::Received(received_by(&value())))
            } else if name.eq_ignore_ascii_case("Authentication-Results") {
                Some(Field::Results(authentication(&value())))
            } else {
                None
            }
        })
        .collect();
    let authentication = provider_results(fields);
    let sender = message.from().and_then(|from| from.first());
    let mut keys: Vec<ThreadKey> = Vec::new();
    let mut add = |id: &str| {
        let id = id.trim();
        if !id.is_empty() {
            let key = thread_key(id);
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
    };
    if let Some(own) = message.message_id() {
        add(own);
    }
    if let Some(named) = message.in_reply_to() {
        named.iter().take(REFERENCES_LIMIT).for_each(&mut add);
    }
    if let Some(named) = message.references() {
        // The last ids are the nearest ancestors, so a long list keeps its end.
        let skip = named.len().saturating_sub(REFERENCES_LIMIT);
        named.iter().skip(skip).for_each(&mut add);
    }
    Some(HeaderFields {
        sent_at: message
            .date()
            .filter(mail_parser::DateTime::is_valid)
            .map(|date| date.to_timestamp().saturating_mul(1000)),
        sender_address: sender
            .and_then(|mailbox| mailbox.address())
            .map(|address| one_line(&address.to_lowercase(), SENDER_LIMIT))
            .unwrap_or_default(),
        sender_name: sender
            .and_then(|mailbox| mailbox.name())
            .map(|name| one_line(name, SENDER_LIMIT))
            .unwrap_or_default(),
        subject: message
            .subject()
            .map(|subject| one_line(subject, SUBJECT_LIMIT))
            .unwrap_or_default(),
        keys,
        list_id,
        unsubscribe,
        precedence: token(raw("Precedence")),
        auto_submitted: if auto_submitted == "no" {
            String::new()
        } else {
            auto_submitted
        },
        reply_to,
        template_head: template_head(
            &raw("List-Id")
                .map(|value| value.trim().to_lowercase())
                .unwrap_or_default(),
            &sender
                .and_then(|mailbox| mailbox.address())
                .map(str::to_lowercase)
                .unwrap_or_default(),
            message.subject().unwrap_or_default(),
        ),
        authentication,
        unparsed: None,
    })
}

/// The servers each provider writes `Authentication-Results` headers and
/// `Received` fields from, by the domains their names end in (the
/// specification's 6.1). Data: seen on the owner's iCloud account by step
/// B4, where iCloud writes one header for each check (`spf.icloud.com`,
/// `dkim-verifier.icloud.com`, `dmarc.icloud.com`, `bimi.icloud.com`, and in
/// older mail servers under `me.com`, `mac.com` and `apple.com`). Gmail's is
/// step B6's to confirm.
pub const AUTHENTICATING: &[(&str, &[&str])] = &[
    ("icloud", &["icloud.com", "me.com", "mac.com", "apple.com"]),
    ("gmail", &["google.com"]),
];

/// The domains a provider's servers are named under.
fn family_of(server: &str) -> Option<&'static [&'static str]> {
    AUTHENTICATING
        .iter()
        .map(|(_, domains)| *domains)
        .find(|domains| under(server, domains))
}

fn under(server: &str, domains: &[&str]) -> bool {
    domains
        .iter()
        .any(|domain| server == *domain || server.ends_with(&format!(".{domain}")))
}

/// Whether results written by `server` are the account's own provider's,
/// and so the engine's fact rather than content (the specification's 6.1).
#[must_use]
pub fn trusted_authentication(provider: &str, server: &str) -> bool {
    AUTHENTICATING
        .iter()
        .any(|(name, domains)| *name == provider && under(server, domains))
}

/// The header fields the provider's results are found among.
enum Field {
    /// A `Received` field: the host that took the message.
    Received(String),
    /// An `Authentication-Results` field.
    Results(Authentication),
}

/// What the provider's own servers say. A provider writes its `Received`
/// fields at the top, the one where the message came in from outside among
/// them, then its `Authentication-Results` fields; below them is what the
/// message carried when it arrived, starting with the sender's own
/// `Received` fields. So the provider's results are the
/// `Authentication-Results` fields from the first one down to the next
/// `Received` field, written by servers of the provider the first one names;
/// each check's first result is taken. Seen on the owner's iCloud account by
/// step B4. With no known provider's server writing the first one, the
/// engine vouches for nothing.
fn provider_results(fields: Vec<Field>) -> Option<Authentication> {
    let mut family: Option<&[&str]> = None;
    let mut found: Option<Authentication> = None;
    for field in fields {
        match field {
            Field::Received(by) => {
                if family.is_some() {
                    break;
                }
                // Above its results, a provider's fields are taken by its own
                // servers, named under its domains or by an internal name
                // with none. One taken by a server with any other domain is
                // the sender's: what follows the provider did not write.
                if by.contains('.') && family_of(&by).is_none() {
                    return None;
                }
            }
            Field::Results(next) => {
                let family = match family {
                    Some(family) => family,
                    None => {
                        let named = family_of(&next.server)?;
                        family = Some(named);
                        named
                    }
                };
                if !under(&next.server, family) {
                    continue;
                }
                match found.as_mut() {
                    None => found = Some(next),
                    Some(found) => {
                        for (slot, result) in [
                            (&mut found.spf, next.spf),
                            (&mut found.dkim, next.dkim),
                            (&mut found.dmarc, next.dmarc),
                        ] {
                            if slot.is_empty() {
                                *slot = result;
                            }
                        }
                    }
                }
            }
        }
    }
    found
}

/// A `Received` field's `by` host, in lower case; empty when not given.
fn received_by(value: &str) -> String {
    let text = strip_comments_and_quotes(&value.replace(['\r', '\n'], " ")).to_lowercase();
    let words: Vec<&str> = text.split_whitespace().collect();
    let after = |keyword: &str| {
        words
            .iter()
            .position(|word| *word == keyword)
            .and_then(|at| words.get(at + 1))
            .map(|host| {
                let host = host
                    .trim_matches(|c: char| matches!(c, ';' | '(' | ')' | '[' | ']'))
                    .trim_end_matches('.');
                // An address is no domain at all.
                if host.parse::<std::net::IpAddr>().is_ok() {
                    String::new()
                } else {
                    one_line(host, TOKEN_LIMIT)
                }
            })
            .unwrap_or_default()
    };
    after("by")
}

/// A message's recipients, as its header block names them: each address in
/// lower case, with the name beside it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Recipients {
    /// `To`.
    pub to: Vec<(String, String)>,
    /// `Cc`.
    pub cc: Vec<(String, String)>,
    /// `Reply-To`.
    pub reply_to: Vec<(String, String)>,
}

/// The most recipients of one kind read.
const RECIPIENTS_LIMIT: usize = 100;

/// Who a message is addressed to. This never fails or panics.
#[must_use]
pub fn recipients(header_block: &[u8]) -> Recipients {
    if header_block.len() > HEADER_LIMIT {
        return Recipients::default();
    }
    catch_unwind(AssertUnwindSafe(|| {
        let Some(message) = MessageParser::new().parse_headers(header_block) else {
            return Recipients::default();
        };
        let list = |found: Option<mail_parser::AddressList<'_>>| -> Vec<(String, String)> {
            found
                .map(|list| {
                    list.mailboxes()
                        .take(RECIPIENTS_LIMIT)
                        .map(|mailbox| {
                            (
                                mailbox
                                    .address()
                                    .map(|address| one_line(&address.to_lowercase(), SENDER_LIMIT))
                                    .unwrap_or_default(),
                                mailbox
                                    .name()
                                    .map(|name| one_line(name, SENDER_LIMIT))
                                    .unwrap_or_default(),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        Recipients {
            to: list(message.to()),
            cc: list(message.cc()),
            reply_to: list(message.reply_to()),
        }
    }))
    .unwrap_or_default()
}

/// What a person reading a whole message is shown.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Reading {
    /// The text a person sees.
    pub visible: String,
    /// The text a person would not see.
    pub hidden: String,
    /// The HTML as written, when the message has some.
    pub html: Option<String>,
}

/// Reads a whole message for a person: its visible text, its hidden text,
/// and its HTML. This never fails or panics.
#[must_use]
pub fn reading(whole: &[u8]) -> Reading {
    if whole.len() > MESSAGE_LIMIT {
        return Reading::default();
    }
    catch_unwind(AssertUnwindSafe(|| {
        let Some(message) = MessageParser::new()
            .max_depth(DEPTH_LIMIT + 1)
            .max_parts(PARTS_LIMIT + 1)
            .parse(whole)
        else {
            return Reading::default();
        };
        let html: Vec<String> = message
            .html_body()
            .filter(|part| matches!(part.kind(), PartKind::Html))
            .filter_map(|part| part.text_prefix_bytes(crate::html::HTML_LIMIT))
            .map(|text| text.into_owned())
            .collect();
        if html.is_empty() {
            let visible = body_fields(whole)
                .text
                .replace("\r\n", "\n")
                .trim_end()
                .to_string();
            return Reading {
                visible,
                ..Reading::default()
            };
        }
        let mut reading = Reading {
            html: Some(html.join("\n")),
            ..Reading::default()
        };
        for part in &html {
            let read = crate::html::read(part);
            for (into, from) in [
                (&mut reading.visible, read.visible),
                (&mut reading.hidden, read.hidden),
            ] {
                if !from.is_empty() {
                    if !into.is_empty() {
                        into.push_str("\n\n");
                    }
                    into.push_str(prefix(&from, TEXT_LIMIT.saturating_sub(into.len())));
                }
            }
        }
        reading
    }))
    .unwrap_or_default()
}

/// The decoded content of the part at `place` in a whole message, numbered
/// as [`body_fields`] numbers parts. This never fails or panics.
#[must_use]
pub fn part_content(whole: &[u8], place: &str) -> Option<Vec<u8>> {
    if whole.len() > MESSAGE_LIMIT {
        return None;
    }
    catch_unwind(AssertUnwindSafe(|| {
        let message = MessageParser::new()
            .max_depth(DEPTH_LIMIT + 1)
            .max_parts(PARTS_LIMIT + 1)
            .parse(whole)?;
        find_part(message.root_part(), "", place, 0)
    }))
    .ok()
    .flatten()
}

/// The part at `wanted`, walked as [`walk`] walks.
fn find_part(part: MessagePart<'_>, place: &str, wanted: &str, depth: usize) -> Option<Vec<u8>> {
    if depth > DEPTH_LIMIT {
        return None;
    }
    let own = || {
        if place.is_empty() {
            "1".to_string()
        } else {
            place.to_string()
        }
    };
    match part.kind() {
        PartKind::Multipart => part.children().enumerate().find_map(|(index, child)| {
            let child_place = if place.is_empty() {
                (index + 1).to_string()
            } else {
                format!("{place}.{}", index + 1)
            };
            if wanted == child_place || wanted.starts_with(&format!("{child_place}.")) {
                find_part(child, &child_place, wanted, depth + 1)
            } else {
                None
            }
        }),
        PartKind::Message(nested) => {
            let own = own();
            if wanted == own {
                return Some(part.decoded().into_owned());
            }
            let root = nested.root_part();
            if matches!(root.kind(), PartKind::Multipart) {
                find_part(root, &own, wanted, depth + 1)
            } else {
                find_part(root, &format!("{own}.1"), wanted, depth + 1)
            }
        }
        PartKind::Text | PartKind::Html | PartKind::Binary | PartKind::InlineBinary => {
            (own() == wanted).then(|| part.decoded().into_owned())
        }
    }
}

/// The text without its comments (in parentheses, which may nest) and its
/// quoted strings, which carry no results (RFC 8601).
fn strip_comments_and_quotes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0usize;
    let mut quoted = false;
    let mut escaped = false;
    for c in text.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' if quoted || depth > 0 => escaped = true,
            '"' if depth == 0 => quoted = !quoted,
            '(' if !quoted => depth += 1,
            ')' if !quoted && depth > 0 => depth -= 1,
            _ if quoted || depth > 0 => {}
            other => out.push(other),
        }
    }
    out
}

/// The results in an `Authentication-Results` value: its server, then one
/// result for each method, each the first word of its part (RFC 8601).
fn authentication(value: &str) -> Authentication {
    let value = strip_comments_and_quotes(&value.replace(['\r', '\n'], " "));
    let mut parts = value.split(';');
    let server = parts
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .next()
        .unwrap_or_default();
    let mut found = Authentication {
        server: one_line(&server.to_lowercase(), TOKEN_LIMIT),
        ..Authentication::default()
    };
    for part in parts {
        let Some((method, result)) = part
            .split_whitespace()
            .next()
            .and_then(|token| token.split_once('='))
        else {
            continue;
        };
        let method = method.split('/').next().unwrap_or_default().to_lowercase();
        let result = match result.trim().to_lowercase().as_str() {
            known @ ("pass" | "fail" | "softfail" | "neutral" | "none" | "temperror"
            | "permerror") => known.to_string(),
            _ => "other".to_string(),
        };
        let slot = match method.as_str() {
            "spf" => &mut found.spf,
            "dkim" => &mut found.dkim,
            "dmarc" => &mut found.dmarc,
            _ => continue,
        };
        // The first result for a method is the one the server reached.
        if slot.is_empty() {
            *slot = result;
        }
    }
    found
}

fn read_body(whole: &[u8]) -> Option<BodyFields> {
    if whole.len() > MESSAGE_LIMIT {
        return Some(BodyFields {
            unparsed: Some("the message is over 64 MiB, the most the engine reads"),
            ..BodyFields::default()
        });
    }
    let message = MessageParser::new()
        .max_depth(DEPTH_LIMIT + 1)
        .max_parts(PARTS_LIMIT + 1)
        .parse(whole)?;
    let mut parts = Vec::new();
    let mut multiparts = Vec::new();
    let mut deepest = 0;
    walk(
        message.root_part(),
        "",
        0,
        &mut Walked {
            parts: &mut parts,
            multiparts: &mut multiparts,
            deepest: &mut deepest,
        },
    );
    if parts.len() > PARTS_LIMIT {
        return Some(BodyFields {
            unparsed: Some("the message has more than 1 000 parts, the most the engine reads"),
            ..BodyFields::default()
        });
    }
    if deepest > DEPTH_LIMIT {
        return Some(BodyFields {
            unparsed: Some("the message's parts nest deeper than the engine reads"),
            ..BodyFields::default()
        });
    }
    // What a person sees: the HTML when there is some, else the plain text.
    let html: Vec<String> = message
        .html_body()
        .filter(|part| matches!(part.kind(), PartKind::Html))
        .filter_map(|part| part.text_prefix_bytes(crate::html::HTML_LIMIT))
        .map(|text| text.into_owned())
        .collect();
    let mut text = String::new();
    let mut hidden_chars = 0usize;
    let mut links = Vec::new();
    let body_shape = if html.is_empty() {
        let mut first: Option<String> = None;
        for part in message.text_body() {
            if !matches!(part.kind(), PartKind::Text) || text.len() >= TEXT_LIMIT {
                continue;
            }
            let Some(plain) = part.text_prefix_bytes(TEXT_LIMIT - text.len()) else {
                continue;
            };
            let before = plain.chars().count();
            let plain: String = plain
                .chars()
                .filter(|c| !crate::html::invisible(*c))
                .collect();
            hidden_chars += before - plain.chars().count();
            links.extend(plain_links(&plain));
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(prefix(&plain, TEXT_LIMIT - text.len()));
            first.get_or_insert(plain);
        }
        first.map(|plain| shape_of(b'p', plain_shape(&plain).as_bytes()))
    } else {
        let mut skeleton = None;
        for html in &html {
            let reading = crate::html::read(html);
            skeleton.get_or_insert(reading.skeleton);
            hidden_chars += reading.hidden.chars().count() + reading.invisible_chars;
            links.extend(reading.links);
            if text.len() < TEXT_LIMIT {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(prefix(&reading.visible, TEXT_LIMIT - text.len()));
            }
        }
        skeleton.map(|skeleton| shape_of(b'h', &skeleton))
    };
    links.truncate(500);
    let attachments = parts.iter().filter(|part| part.attachment).count();
    let structure = structure_shape(&parts, &multiparts);

    Some(BodyFields {
        snippet: one_line(&text, SNIPPET_LIMIT),
        text,
        parts,
        attachments: u32::try_from(attachments).unwrap_or(u32::MAX),
        hidden_chars: u32::try_from(hidden_chars).unwrap_or(u32::MAX),
        links,
        body_shape,
        structure,
        unparsed: None,
    })
}

/// The 16 bytes of a body's shape, with what kind of body it is.
fn shape_of(kind: u8, shape: &[u8]) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update([kind]);
    hasher.update(shape);
    let mut out = [0u8; 16];
    out.copy_from_slice(&hasher.finalize()[..16]);
    out
}

/// The shapes of a plain body's lines, a run of one shape counted once, as
/// the census measured them: blank, quoted, a link, short, long.
fn plain_shape(text: &str) -> String {
    let mut shapes = String::new();
    for line in text.lines().take(400) {
        let line = line.trim();
        let shape = if line.is_empty() {
            'b'
        } else if line.starts_with('>') {
            'q'
        } else if line.contains("http://") || line.contains("https://") {
            'u'
        } else if line.chars().count() < 40 {
            's'
        } else {
            'l'
        };
        if !shapes.ends_with(shape) {
            shapes.push(shape);
        }
    }
    shapes
}

/// The addresses written in plain text.
fn plain_links(text: &str) -> Vec<Link> {
    text.split_whitespace()
        .filter(|word| word.starts_with("http://") || word.starts_with("https://"))
        .take(500)
        .map(|word| {
            let target = word.trim_end_matches(['.', ',', ')', '>', ']', '"', '\'']);
            Link {
                target: prefix(target, 2048).to_string(),
                target_host: crate::html::host_of(target).unwrap_or_default(),
                text_host: String::new(),
                mismatched: false,
            }
        })
        .collect()
}

/// A subject with what differs between copies of one template removed,
/// exactly as the census measured it (`census.py`'s `subject_shape`, the
/// specification's 6.3): in lower case; the reply and forward prefixes
/// (`re`, `fw`, `fwd`, `aw`, `wg`, `tr`, with an optional `[n]`) removed;
/// each run of eight or more hexadecimal characters made `@`; each word
/// holding a digit made `#`; white space made single; the first 120
/// characters.
#[must_use]
pub fn subject_shape(subject: &str) -> String {
    let lower = subject.to_lowercase();
    let mut rest = lower.trim();
    // `^((re|fwd?|aw|wg|tr)\s*(\[\d+\])?:\s*)+`
    while let Some(after) = ["fwd", "re", "fw", "aw", "wg", "tr"]
        .iter()
        .find_map(|prefix| rest.strip_prefix(prefix))
    {
        let after = after.trim_start();
        let after = match after.strip_prefix('[') {
            Some(inner) => match inner.find(']') {
                Some(close) if close > 0 && inner[..close].chars().all(|c| c.is_ascii_digit()) => {
                    &inner[close + 1..]
                }
                _ => break,
            },
            None => after,
        };
        match after.strip_prefix(':') {
            Some(after) => rest = after.trim_start(),
            None => break,
        }
    }
    // `[0-9a-f]{8,}` -> `@`
    let mut hexless = String::with_capacity(rest.len());
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        if run.chars().count() >= 8 {
            out.push('@');
        } else {
            out.push_str(run);
        }
        run.clear();
    };
    for c in rest.chars() {
        if matches!(c, '0'..='9' | 'a'..='f') {
            run.push(c);
        } else {
            flush(&mut run, &mut hexless);
            hexless.push(c);
        }
    }
    flush(&mut run, &mut hexless);
    // `\b\w*\d\w*\b` -> `#`
    let word = |c: char| c.is_alphanumeric() || c == '_';
    let mut shaped = String::with_capacity(hexless.len());
    let mut current = String::new();
    let end_word = |current: &mut String, out: &mut String| {
        if current.chars().any(char::is_numeric) {
            out.push('#');
        } else {
            out.push_str(current);
        }
        current.clear();
    };
    for c in hexless.chars() {
        if word(c) {
            current.push(c);
        } else {
            end_word(&mut current, &mut shaped);
            shaped.push(c);
        }
    }
    end_word(&mut current, &mut shaped);
    // `\s+` -> ` `, then the first 120 characters.
    let mut collapsed = String::with_capacity(shaped.len());
    let mut space = false;
    for c in shaped.chars() {
        if c.is_whitespace() {
            space = true;
            continue;
        }
        if space && !collapsed.is_empty() {
            collapsed.push(' ');
        }
        if space && collapsed.is_empty() {
            // A leading run of space is kept as one, as the census's was.
            collapsed.push(' ');
        }
        space = false;
        collapsed.push(c);
    }
    if space {
        collapsed.push(' ');
    }
    collapsed.chars().take(120).collect()
}

/// The MIME structure as the census read it from `BODYSTRUCTURE`
/// (`census.py`'s `structure_shape`): the types of the parts of the eight
/// kinds it matched, in order, then the multiparts of the six kinds it
/// matched; the first 300 characters.
fn structure_shape(parts: &[PartFound], multiparts: &[String]) -> String {
    const KINDS: &[&str] = &[
        "text",
        "image",
        "application",
        "audio",
        "video",
        "message",
        "font",
        "model",
    ];
    const MULTIPARTS: &[&str] = &[
        "multipart/alternative",
        "multipart/mixed",
        "multipart/related",
        "multipart/signed",
        "multipart/report",
        "multipart/digest",
    ];
    let mut shape: Vec<&str> = parts
        .iter()
        .map(|part| part.content_type.as_str())
        .filter(|kind| {
            kind.split_once('/')
                .is_some_and(|(main, sub)| KINDS.contains(&main) && sub.chars().count() <= 60)
        })
        .collect();
    shape.extend(
        multiparts
            .iter()
            .map(String::as_str)
            .filter(|kind| MULTIPARTS.contains(kind)),
    );
    shape.join(",").chars().take(300).collect()
}

/// The first half of the template key, from the headers: where the message
/// came from (its `List-Id` as written, else its sender) and its subject's
/// shape.
#[must_use]
pub fn template_head(list_id_written: &str, sender: &str, subject: &str) -> [u8; 16] {
    let source = if list_id_written.is_empty() {
        sender
    } else {
        list_id_written
    };
    let mut hasher = Sha256::new();
    for piece in [source, &subject_shape(subject)] {
        hasher.update(piece.as_bytes());
        hasher.update([0]);
    }
    let mut out = [0u8; 16];
    out.copy_from_slice(&hasher.finalize()[..16]);
    out
}

/// The template key (the specification's 6.3): the head from the headers,
/// and the MIME structure from the body.
#[must_use]
pub fn template_key(head: &[u8; 16], structure: &str) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(head);
    hasher.update(structure.as_bytes());
    let mut out = [0u8; 16];
    out.copy_from_slice(&hasher.finalize()[..16]);
    out
}

/// What a walk of the parts collects.
struct Walked<'a> {
    parts: &'a mut Vec<PartFound>,
    multiparts: &'a mut Vec<String>,
    deepest: &'a mut usize,
}

/// Records `part` and what is under it, numbering places as IMAP does: the
/// children of a multipart are `1`, `2`; a message that is one part is `1`;
/// the parts of a message carried inside another are numbered under it.
fn walk(part: MessagePart<'_>, place: &str, depth: usize, walked: &mut Walked<'_>) {
    *walked.deepest = (*walked.deepest).max(depth);
    if walked.parts.len() > PARTS_LIMIT || depth > DEPTH_LIMIT {
        return;
    }
    let under = |number: usize| {
        if place.is_empty() {
            number.to_string()
        } else {
            format!("{place}.{number}")
        }
    };
    match part.kind() {
        PartKind::Multipart => {
            for (index, child) in part.children().enumerate() {
                walk(child, &under(index + 1), depth + 1, walked);
            }
            let subtype = part
                .content_type()
                .and_then(|content_type| content_type.subtype().map(str::to_lowercase))
                .unwrap_or_else(|| "mixed".to_string());
            walked
                .multiparts
                .push(one_line(&format!("multipart/{subtype}"), 60));
        }
        PartKind::Message(nested) => {
            let own = if place.is_empty() {
                "1".to_string()
            } else {
                place.to_string()
            };
            walked.parts.push(found(part, own.clone()));
            let root = nested.root_part();
            if matches!(root.kind(), PartKind::Multipart) {
                walk(root, &own, depth + 1, walked);
            } else {
                walk(root, &format!("{own}.1"), depth + 1, walked);
            }
        }
        PartKind::Text | PartKind::Html | PartKind::Binary | PartKind::InlineBinary => {
            let own = if place.is_empty() {
                "1".to_string()
            } else {
                place.to_string()
            };
            walked.parts.push(found(part, own));
        }
    }
}

fn found(part: MessagePart<'_>, place: String) -> PartFound {
    let content_type = part.content_type().map_or_else(
        || "text/plain".to_string(),
        |content_type| match content_type.subtype() {
            Some(subtype) => format!("{}/{subtype}", content_type.ctype()).to_lowercase(),
            None => content_type.ctype().to_lowercase(),
        },
    );
    let name = part
        .attachment_name()
        .map(|name| one_line(name, 255))
        .unwrap_or_default();
    let size = part.decoded_len();
    // A file's bytes are read for what they are, whatever the part says it
    // is: a program can call itself text.
    let is_file = matches!(part.kind(), PartKind::Binary | PartKind::InlineBinary)
        || !name.is_empty()
        || part.is_attachment();
    let (detected, hash) = if is_file && size <= SNIFF_LIMIT {
        let bytes = part.decoded();
        let hash: [u8; 32] = Sha256::digest(&bytes).into();
        (sniff(&bytes).unwrap_or_default().to_string(), Some(hash))
    } else {
        (String::new(), None)
    };
    let type_differs = !detected.is_empty() && differs(&detected, &content_type, &name);
    PartFound {
        place,
        content_type: one_line(&content_type, 120),
        name,
        size: u64::try_from(size).unwrap_or(u64::MAX),
        attachment: part.is_attachment(),
        detected,
        type_differs,
        hash,
    }
}

/// File types told by their first bytes: data, so that a type found in mail
/// is a line added here.
const SIGNATURES: &[(&[u8], &str)] = &[
    (b"%PDF-", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"PK\x03\x04", "application/zip"),
    (b"\x1f\x8b", "application/gzip"),
    (b"Rar!\x1a\x07", "application/vnd.rar"),
    (b"7z\xbc\xaf\x27\x1c", "application/x-7z-compressed"),
    (b"MZ", "application/x-msdownload"),
    (b"\x7fELF", "application/x-executable"),
    (b"\xcf\xfa\xed\xfe", "application/x-mach-binary"),
    (
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
        "application/x-ole-storage",
    ),
    (b"BEGIN:VCALENDAR", "text/calendar"),
];

/// What a file's first bytes say it is.
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        // The container's brand says what is inside it.
        return Some(match &bytes[8..12] {
            b"heic" | b"heix" | b"hevc" | b"hevx" | b"mif1" | b"msf1" => "image/heic",
            b"avif" | b"avis" => "image/avif",
            b"qt  " => "video/quicktime",
            b"M4A " | b"M4B " => "audio/mp4",
            _ => "video/mp4",
        });
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    SIGNATURES
        .iter()
        .find(|(signature, _)| bytes.starts_with(signature))
        .map(|(_, kind)| *kind)
}

/// What a file's bytes should show for the ending of its name, or for its
/// declared type when the name has no ending the engine knows: data.
const EXPECTED: &[(&[&str], &[&str], &str)] = &[
    (&["pdf"], &["application/pdf"], "application/pdf"),
    (&["png"], &["image/png"], "image/png"),
    (&["jpg", "jpeg"], &["image/jpeg", "image/jpg"], "image/jpeg"),
    (&["gif"], &["image/gif"], "image/gif"),
    (&["webp"], &["image/webp"], "image/webp"),
    (
        &["heic", "heif"],
        &["image/heic", "image/heif"],
        "image/heic",
    ),
    (
        &["doc", "xls", "ppt", "msg"],
        &[
            "application/msword",
            "application/vnd.ms-excel",
            "application/vnd.ms-powerpoint",
        ],
        "application/x-ole-storage",
    ),
    (
        &[
            "docx", "xlsx", "pptx", "zip", "odt", "ods", "odp", "epub", "jar",
        ],
        &["application/zip", "application/vnd.openxmlformats"],
        "application/zip",
    ),
    (
        &["rar"],
        &["application/vnd.rar", "application/x-rar"],
        "application/vnd.rar",
    ),
    (
        &["7z"],
        &["application/x-7z-compressed"],
        "application/x-7z-compressed",
    ),
    (
        &["gz", "tgz"],
        &["application/gzip", "application/x-gzip"],
        "application/gzip",
    ),
    (&["ics"], &["text/calendar"], "text/calendar"),
    (&["mp4", "m4v"], &["video/mp4"], "video/mp4"),
    (&["mov"], &["video/quicktime"], "video/quicktime"),
];

/// The ending a file gets when the engine names it by what its bytes show:
/// only for a kind that one ending names, never for a container that holds
/// several kinds or for a program.
#[must_use]
pub fn ending(detected: &str) -> Option<&'static str> {
    EXPECTED
        .iter()
        .find(|(_, _, kind)| *kind == detected)
        .map(|(endings, _, _)| endings[0])
        .filter(|ending| !matches!(*ending, "doc" | "docx"))
}

/// The kinds of file that run as programs.
const PROGRAMS: &[&str] = &[
    "application/x-msdownload",
    "application/x-executable",
    "application/x-mach-binary",
];

/// The name endings and types that say a file is a program.
const PROGRAM_ENDINGS: &[&str] = &[
    "exe", "dll", "msi", "scr", "com", "bin", "so", "dylib", "app",
];

/// Whether what the bytes are differs from what the part says it is: a
/// program that says it is anything but a program, or a file whose bytes are
/// another kind than its name's ending, or failing that its type, says.
fn differs(detected: &str, declared: &str, name: &str) -> bool {
    let name = name.to_lowercase();
    let ending = name
        .rsplit_once('.')
        .map(|(_, ending)| ending.trim())
        .unwrap_or_default();
    if PROGRAMS.contains(&detected) {
        return !PROGRAM_ENDINGS.contains(&ending)
            && !(ending.is_empty()
                && (PROGRAMS.contains(&declared)
                    || declared == "application/x-dosexec"
                    || declared == "application/octet-stream"));
    }
    let by_ending = EXPECTED
        .iter()
        .find(|(endings, _, _)| endings.contains(&ending))
        .map(|(_, _, expected)| *expected);
    let by_type = || {
        EXPECTED
            .iter()
            .find(|(_, types, _)| types.iter().any(|kind| declared.starts_with(kind)))
            .map(|(_, _, expected)| *expected)
    };
    let expected = by_ending.or_else(by_type);
    // An office document is a zip; an older one is an OLE file.
    expected.is_some_and(|expected| expected != detected)
}

/// `text` on one line: runs of white space and control characters become one
/// space, and at most `limit` characters are kept.
fn one_line(text: &str, limit: usize) -> String {
    let mut line = String::new();
    let mut kept = 0;
    let mut gap = false;
    for character in text.chars() {
        if character.is_whitespace() || character.is_control() {
            gap = !line.is_empty();
            continue;
        }
        if kept + usize::from(gap) >= limit {
            break;
        }
        if gap {
            line.push(' ');
            kept += 1;
            gap = false;
        }
        line.push(character);
        kept += 1;
    }
    line
}

/// The start of `text`, at most `bytes` long, cut between characters.
fn prefix(text: &str, bytes: usize) -> &str {
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
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;

    #[test]
    fn a_header_block_gives_the_fields_a_list_shows() {
        let fields = header_fields(
            b"From: \"Ann  Example\" <Ann@Example.COM>\r\n\
              Subject: =?utf-8?q?caf=C3=A9?=\r\n  au lait\r\n\
              Date: Sat, 20 Nov 2021 14:22:01 -0800\r\n\
              Message-ID: <a@example.com>\r\n\
              In-Reply-To: <b@example.com>\r\n\
              References: <c@example.com> <b@example.com>\r\n\r\n",
        );
        assert_eq!(fields.sender_address, "ann@example.com");
        assert_eq!(fields.sender_name, "Ann Example");
        assert_eq!(fields.subject, "café au lait");
        assert_eq!(fields.sent_at, Some(1_637_446_921_000));
        assert_eq!(
            fields.keys,
            vec![
                thread_key("a@example.com"),
                thread_key("b@example.com"),
                thread_key("c@example.com")
            ]
        );
        assert_eq!(fields.unparsed, None);
    }

    #[test]
    fn only_the_provider_s_own_results_above_where_the_mail_came_in_are_read() {
        let block = |fields: &str| header_fields(format!("{fields}Subject: s\r\n\r\n").as_bytes());
        // iCloud's: its own hops, its results among other fields, then the
        // line where the message came in, then what the sender wrote.
        let fields = block(
            "Received: from p00-icloudmta-asmtp-us-west-2a-10.p00-icloudmta-asmtp-vip.icloud-mail-production.svc.kube.us-west-2.aws.cloud.apple.com by p132-mailgateway-smtp-1.icloud.com (Postfix); Mon\r\n\
             Received: from mr85p00im-dlb.me.com by p00-icloudmta-asmtp.icloud.com; Mon\r\n\
             Authentication-Results: bimi.icloud.com; bimi=skipped\r\n\
             X-ARC-Info: policy=fail\r\n\
             Authentication-Results: dmarc.icloud.com; dmarc=pass header.from=example.com\r\n\
             Authentication-Results: dkim-verifier.icloud.com; dkim=pass (2048-bit key) header.d=example.com\r\n\
             Authentication-Results: spf.icloud.com; spf=softfail smtp.mailfrom=\"a dkim=fail b\"@example.com\r\n\
             Received: from mail.sender.example (mail.sender.example [192.0.2.1]) by mr85p00im.me.com; Mon\r\n\
             Authentication-Results: spf.icloud.com; spf=pass\r\n\
             Authentication-Results: dmarc.icloud.com; dmarc=pass\r\n",
        );
        let found = fields.authentication.unwrap();
        assert_eq!(found.server, "bimi.icloud.com");
        assert_eq!(
            (
                found.spf.as_str(),
                found.dkim.as_str(),
                found.dmarc.as_str()
            ),
            ("softfail", "pass", "pass")
        );
        assert!(trusted_authentication("icloud", &found.server));
        assert!(!trusted_authentication("gmail", &found.server));
        assert!(!trusted_authentication(
            "icloud",
            "icloud.com.attacker.example"
        ));

        // iCloud wrote no results: the sender's, below the sender's own
        // Received field, are not taken for iCloud's.
        let fields = block(
            "Received: from mr85p00im.me.com by p00-icloudmta-asmtp.icloud.com; Mon\r\n\
             Received: from mail.sender.example by mr85p00im.me.com; Mon\r\n\
             X-Mailer: x\r\n\
             Received: from laptop by mail.sender.example; Mon\r\n\
             Authentication-Results: spf.icloud.com; spf=pass\r\n\
             Authentication-Results: dkim-verifier.icloud.com; dkim=pass\r\n",
        );
        assert_eq!(fields.authentication, None);

        // A server the engine does not know at the top vouches for nothing.
        let fields = block(
            "Received: from a.example by mx.other.example; Mon\r\n\
             Authentication-Results: mx.other.example; spf=pass\r\n",
        );
        assert_eq!(fields.authentication, None);
    }

    #[test]
    fn a_subject_s_shape_is_the_census_s() {
        // Each pair is a subject and what `census.py`'s `subject_shape` gave
        // for it.
        for (subject, census) in [
            ("RE [2]: Hello", "hello"),
            ("Re : Hello", "hello"),
            ("Invoice 2024-01", "invoice #-#"),
            ("Invoice INV-2024", "invoice inv-#"),
            ("Order #12345 shipped", "order ## shipped"),
            ("Fwd: Re: FW: news", "news"),
            ("Your code is deadbeef1234 now", "your code is @ now"),
            ("faceface cafe", "@ cafe"),
            ("  Re:   spaced   out  ", "spaced out"),
            ("Ünïcode 3rd café", "ünïcode # café"),
            ("Tr: aw: wg: hi", "hi"),
            ("re:[x] keep", "[x] keep"),
            ("build #4521 failed on main", "build ## failed on main"),
            ("Reminder: meeting on 5/12", "reminder: meeting on #/#"),
            ("abc_123 def", "# def"),
        ] {
            assert_eq!(subject_shape(subject), census, "{subject}");
        }
        let long = format!("Re: {}", "x".repeat(200));
        assert_eq!(subject_shape(&long), "x".repeat(120));
    }

    #[test]
    fn a_file_whose_bytes_are_another_kind_than_it_says_is_marked() {
        let exe = b"MZ\x90\x00rest";
        let zip = b"PK\x03\x04rest";
        let pdf = b"%PDF-1.7 rest";
        let ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest";
        for (bytes, declared, name, marked) in [
            (&exe[..], "application/octet-stream", "Invoice.xlsx", true),
            (&exe[..], "text/plain", "invoice.pdf", true),
            (&exe[..], "application/octet-stream", "setup.exe", false),
            (&exe[..], "application/octet-stream", "", false),
            (&exe[..], "image/png", "", true),
            (&zip[..], "application/pdf", "invoice.pdf", true),
            (&zip[..], "application/octet-stream", "report.docx", false),
            (&zip[..], "application/octet-stream", "files.zip", false),
            (&pdf[..], "application/octet-stream", "statement.pdf", false),
            (&pdf[..], "image/jpeg", "", true),
            (&ole[..], "application/msword", "old.doc", false),
            (&ole[..], "application/pdf", "", true),
        ] {
            let detected = sniff(bytes).unwrap();
            assert_eq!(
                differs(detected, declared, name),
                marked,
                "{detected} as {declared} named {name}"
            );
        }
        assert_eq!(
            sniff(b"\x00\x00\x00\x18ftypheic\x00\x00"),
            Some("image/heic")
        );
        assert_eq!(
            sniff(b"\x00\x00\x00\x18ftypisom\x00\x00"),
            Some("video/mp4")
        );

        // A program sent as text with a document's name is read for what it is.
        let whole = concat!(
            "Content-Type: multipart/mixed; boundary=\"b\"\r\n\r\n",
            "--b\r\nContent-Type: text/plain\r\n\r\nSee attached.\r\n",
            "--b\r\nContent-Type: text/plain; name=\"invoice.pdf\"\r\n",
            "Content-Disposition: attachment; filename=\"invoice.pdf\"\r\n\r\n",
            "MZ this is a program\r\n",
            "--b--\r\n",
        );
        let fields = body_fields(whole.as_bytes());
        let file = fields
            .parts
            .iter()
            .find(|part| part.name == "invoice.pdf")
            .unwrap();
        assert_eq!(file.detected, "application/x-msdownload");
        assert!(file.type_differs && file.hash.is_some());
    }

    #[test]
    fn a_part_is_found_by_its_place_and_a_reading_keeps_hidden_text_apart() {
        let whole = concat!(
            "To: Ann <Ann@Example.com>, b@example.com\r\n",
            "Content-Type: multipart/mixed; boundary=\"outer\"\r\n\r\n",
            "--outer\r\n",
            "Content-Type: multipart/alternative; boundary=\"inner\"\r\n\r\n",
            "--inner\r\nContent-Type: text/plain\r\n\r\nplain words\r\n",
            "--inner\r\nContent-Type: text/html\r\n\r\n",
            "<p>shown</p><p style=\"display:none\">secret</p>\r\n",
            "--inner--\r\n",
            "--outer\r\nContent-Type: application/pdf; name=\"a.pdf\"\r\n",
            "Content-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjc=\r\n",
            "--outer--\r\n",
        );
        assert_eq!(part_content(whole.as_bytes(), "2").unwrap(), b"%PDF-1.7");
        assert_eq!(
            part_content(whole.as_bytes(), "1.1").unwrap(),
            b"plain words"
        );
        assert_eq!(part_content(whole.as_bytes(), "3"), None);
        let read = reading(whole.as_bytes());
        assert_eq!(
            (read.visible.as_str(), read.hidden.as_str()),
            ("shown", "secret")
        );
        assert!(read.html.unwrap().contains("display:none"));
        let to = recipients(whole.as_bytes()).to;
        assert_eq!(to[0], ("ann@example.com".to_string(), "Ann".to_string()));
        assert_eq!(to.len(), 2);
    }

    #[test]
    fn a_part_inside_a_forwarded_message_is_found_by_the_place_the_list_gives() {
        let whole = concat!(
            "Content-Type: multipart/mixed; boundary=\"outer\"\r\n\r\n",
            "--outer\r\nContent-Type: text/plain\r\n\r\nsee below\r\n",
            "--outer\r\nContent-Type: message/rfc822\r\n\r\n",
            "Subject: inner\r\n",
            "Content-Type: multipart/mixed; boundary=\"inner\"\r\n\r\n",
            "--inner\r\nContent-Type: text/plain\r\n\r\ninner words\r\n",
            "--inner\r\nContent-Type: application/pdf; name=\"in.pdf\"\r\n",
            "Content-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjc=\r\n",
            "--inner--\r\n",
            "--outer\r\nContent-Type: application/pdf; name=\"out.pdf\"\r\n",
            "Content-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjc=\r\n",
            "--outer--\r\n",
        );
        let body = body_fields(whole.as_bytes());
        for named in ["in.pdf", "out.pdf"] {
            let part = body.parts.iter().find(|part| part.name == named).unwrap();
            assert_eq!(
                part_content(whole.as_bytes(), &part.place).unwrap(),
                b"%PDF-1.7",
                "{named} at {}",
                part.place
            );
        }
        assert_eq!(
            part_content(whole.as_bytes(), "2.1").unwrap(),
            b"inner words"
        );
        assert_eq!(ending("application/pdf"), Some("pdf"));
        assert_eq!(ending("application/zip"), None);
        assert_eq!(ending("application/x-msdownload"), None);
    }

    #[test]
    fn a_block_with_nothing_to_read_gives_empty_fields() {
        let fields = header_fields(b"\r\n");
        assert_eq!(fields.subject, "");
        assert!(fields.keys.is_empty());
        let fields = header_fields(b"");
        assert_eq!(fields.sender_address, "");
    }

    #[test]
    fn a_long_references_list_keeps_its_end() {
        let ids: Vec<String> = (0..300).map(|n| format!("<{n}@example.com>")).collect();
        let block = format!("References: {}\r\n\r\n", ids.join(" "));
        let fields = header_fields(block.as_bytes());
        assert_eq!(fields.keys.len(), REFERENCES_LIMIT);
        assert!(fields.keys.contains(&thread_key("299@example.com")));
        assert!(!fields.keys.contains(&thread_key("0@example.com")));
    }

    #[test]
    fn a_body_gives_a_snippet_text_and_parts_numbered_as_imap_does() {
        let whole = concat!(
            "Subject: s\r\n",
            "Content-Type: multipart/mixed; boundary=\"outer\"\r\n\r\n",
            "--outer\r\n",
            "Content-Type: multipart/alternative; boundary=\"inner\"\r\n\r\n",
            "--inner\r\n",
            "Content-Type: text/plain\r\n\r\n",
            "Hello\r\n   there,  world\r\n",
            "--inner\r\n",
            "Content-Type: text/html\r\n\r\n",
            "<p>Hello there, world</p>\r\n",
            "--inner--\r\n",
            "--outer\r\n",
            "Content-Type: application/pdf; name=\"bill.pdf\"\r\n",
            "Content-Disposition: attachment; filename=\"bill.pdf\"\r\n",
            "Content-Transfer-Encoding: base64\r\n\r\n",
            "AAECAwQF\r\n",
            "--outer--\r\n",
        );
        let fields = body_fields(whole.as_bytes());
        assert_eq!(fields.snippet, "Hello there, world");
        assert!(fields.text.contains("Hello"));
        let places: Vec<(&str, &str, bool)> = fields
            .parts
            .iter()
            .map(|part| {
                (
                    part.place.as_str(),
                    part.content_type.as_str(),
                    part.attachment,
                )
            })
            .collect();
        assert_eq!(
            places,
            vec![
                ("1.1", "text/plain", false),
                ("1.2", "text/html", false),
                ("2", "application/pdf", true)
            ]
        );
        assert_eq!(fields.parts[2].name, "bill.pdf");
        assert_eq!(fields.parts[2].size, 6);
        assert_eq!(fields.attachments, 1);
    }

    #[test]
    fn a_message_that_is_one_part_is_part_one() {
        let fields = body_fields(b"Subject: s\r\n\r\nJust text.\r\n");
        assert_eq!(fields.parts.len(), 1);
        assert_eq!(fields.parts[0].place, "1");
        assert_eq!(fields.snippet, "Just text.");
    }

    #[test]
    fn a_message_inside_a_message_is_numbered_under_it() {
        let whole = concat!(
            "Content-Type: multipart/mixed; boundary=\"b\"\r\n\r\n",
            "--b\r\n",
            "Content-Type: text/plain\r\n\r\n",
            "See below.\r\n",
            "--b\r\n",
            "Content-Type: message/rfc822\r\n\r\n",
            "Subject: inner\r\n",
            "Content-Type: text/plain\r\n\r\n",
            "Inner text.\r\n",
            "--b--\r\n",
        );
        let fields = body_fields(whole.as_bytes());
        let places: Vec<&str> = fields.parts.iter().map(|p| p.place.as_str()).collect();
        assert_eq!(places, vec!["1", "2", "2.1"]);
    }

    #[test]
    fn one_line_collapses_white_space_and_stops_at_its_limit() {
        assert_eq!(one_line("  a \r\n\t b\u{0}c  ", 10), "a b c");
        assert_eq!(one_line("abcdef", 3), "abc");
        assert_eq!(one_line("ab cd", 3), "ab");
        assert_eq!(prefix("héllo", 2), "h");
    }
}
