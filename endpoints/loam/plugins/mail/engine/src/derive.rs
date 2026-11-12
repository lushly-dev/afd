//! What code reads from a message's bytes: the fields a list shows, the keys
//! that join it to a thread, its parts and its text.
//!
//! Everything here is recomputed from the log and never edited (the
//! specification's sections 4.3 and 6). This step reads what a list, a thread
//! and a search need. Hidden text, links, the template and the limits of the
//! specification's 6.4 arrive with step B4, which raises [`PARSER_VERSION`].

use std::panic::{AssertUnwindSafe, catch_unwind};

use mail_parser::{MessageParser, MessagePart, PartKind};
use sha2::{Digest, Sha256};

/// The version of this derivation. A row records the version that wrote it,
/// so that a later version can tell which rows to recompute.
pub const PARSER_VERSION: u32 = 1;

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
/// How many parts of one message are recorded.
const PARTS_LIMIT: usize = 1000;

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
    /// Why the block could not be read, when it could not.
    pub unparsed: Option<&'static str>,
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
    /// Why the message could not be read, when it could not.
    pub unparsed: Option<&'static str>,
}

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
    let message = MessageParser::new().parse_headers(header_block)?;
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
        unparsed: None,
    })
}

fn read_body(whole: &[u8]) -> Option<BodyFields> {
    let message = MessageParser::new().parse(whole)?;
    let mut text = String::new();
    for body in message.text_bodies() {
        if text.len() >= TEXT_LIMIT {
            break;
        }
        if !text.is_empty() {
            text.push('\n');
        }
        let room = TEXT_LIMIT - text.len();
        text.push_str(prefix(&body, room));
    }
    let mut parts = Vec::new();
    walk(message.root_part(), "", &mut parts);
    let attachments = parts.iter().filter(|part| part.attachment).count();
    Some(BodyFields {
        snippet: one_line(&text, SNIPPET_LIMIT),
        text,
        parts,
        attachments: u32::try_from(attachments).unwrap_or(u32::MAX),
        unparsed: None,
    })
}

/// Records `part` and what is under it, numbering places as IMAP does: the
/// children of a multipart are `1`, `2`; a message that is one part is `1`;
/// the parts of a message carried inside another are numbered under it.
fn walk(part: MessagePart<'_>, place: &str, parts: &mut Vec<PartFound>) {
    if parts.len() >= PARTS_LIMIT {
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
                walk(child, &under(index + 1), parts);
            }
        }
        PartKind::Message(nested) => {
            let own = if place.is_empty() {
                "1".to_string()
            } else {
                place.to_string()
            };
            parts.push(found(part, own.clone()));
            let root = nested.root_part();
            if matches!(root.kind(), PartKind::Multipart) {
                walk(root, &own, parts);
            } else {
                walk(root, &format!("{own}.1"), parts);
            }
        }
        PartKind::Text | PartKind::Html | PartKind::Binary | PartKind::InlineBinary => {
            let own = if place.is_empty() {
                "1".to_string()
            } else {
                place.to_string()
            };
            parts.push(found(part, own));
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
    PartFound {
        place,
        content_type: one_line(&content_type, 120),
        name: part
            .attachment_name()
            .map(|name| one_line(name, 255))
            .unwrap_or_default(),
        size: u64::try_from(part.decoded_len()).unwrap_or(u64::MAX),
        attachment: part.is_attachment(),
    }
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
