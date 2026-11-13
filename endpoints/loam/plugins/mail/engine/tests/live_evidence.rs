//! Two counts from a real iCloud account for the decisions the specification
//! leaves to step B4. Ignored: it runs only when asked, with the sign-in in
//! two files whose paths it is given, as `tests/live.rs` does.
//!
//! It reads the header blocks of every mailbox up to a size (the largest is
//! left out), with `EXAMINE` and `BODY.PEEK`, keeps nothing on the disk, and
//! reports counts only, with the names of the servers that wrote
//! `Authentication-Results` headers: no address, subject or text.
//!
//! - **Which `Authentication-Results` header is the provider's**
//!   (the specification's section 6.1): the server names (`authserv-id`) of
//!   the topmost such header in each message, and of the others.
//! - **Whether a shared subject may join a thread** (section 5.6): among
//!   messages whose `References` or `In-Reply-To` place them in a thread, how
//!   often two with the same subject are in different threads, which is how
//!   often joining by subject would be wrong; and how many messages name no
//!   other message at all, which is how many the rule would touch.
//!
//! ```text
//! LOAM_MAIL_LIVE_ADDRESS_FILE=... LOAM_MAIL_LIVE_PASSWORD_FILE=... \
//! LOAM_MAIL_LIVE_OUT=results.json \
//!   cargo test --release --test live_evidence -- --ignored --nocapture
//! ```

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::{BTreeMap, HashMap};

use loam_mail::provider::Provider;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, Imap};
use serde_json::json;

fn read_secret(variable: &str) -> String {
    let path = std::env::var(variable).unwrap_or_else(|_| panic!("{variable} names a file"));
    std::fs::read_to_string(path)
        .expect("the file can be read")
        .trim()
        .to_string()
}

/// A subject without the prefixes a reply or a forward adds, in lower case.
fn bare_subject(subject: &str) -> String {
    let mut rest = subject.trim().to_lowercase();
    loop {
        let trimmed = rest.trim_start();
        let stripped = ["re:", "fwd:", "fw:", "aw:", "wg:", "tr:"]
            .iter()
            .find_map(|prefix| trimmed.strip_prefix(prefix));
        match stripped {
            Some(after) => rest = after.to_string(),
            None => return trimmed.split_whitespace().collect::<Vec<_>>().join(" "),
        }
    }
}

/// The domain a server's name ends in: its last two labels.
fn domain(server: &str) -> String {
    let labels: Vec<&str> = server
        .split('.')
        .filter(|label| !label.is_empty())
        .collect();
    if labels.len() < 2 || server.contains('=') {
        return "no server named".to_string();
    }
    labels[labels.len() - 2..].join(".")
}

/// A count's bucket.
fn bucket(count: usize) -> &'static str {
    match count {
        0 => "0",
        1 => "1",
        2..=5 => "2-5",
        _ => "6+",
    }
}

/// The `authserv-id` of an `Authentication-Results` value: its first token.
fn authserv_id(value: &str) -> String {
    value
        .trim()
        .split(|c: char| c == ';' || c.is_whitespace())
        .next()
        .unwrap_or_default()
        .to_lowercase()
}

struct Threads {
    parent: Vec<usize>,
}

impl Threads {
    fn find(&mut self, at: usize) -> usize {
        let mut root = at;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        let mut walk = at;
        while self.parent[walk] != root {
            let next = self.parent[walk];
            self.parent[walk] = root;
            walk = next;
        }
        root
    }

    fn join(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.parent[a.max(b)] = a.min(b);
        }
    }
}

#[test]
#[ignore = "reads a real iCloud account; run with the sign-in files named"]
fn evidence_counts_on_icloud() {
    let credentials = Credentials {
        user: read_secret("LOAM_MAIL_LIVE_ADDRESS_FILE"),
        password: read_secret("LOAM_MAIL_LIVE_PASSWORD_FILE"),
    };
    let skip_over: usize = std::env::var("LOAM_MAIL_LIVE_SKIP_OVER")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(50_000);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let blocks: Vec<Vec<u8>> = runtime.block_on(async {
        let mut imap = Imap::connect(&Endpoint::icloud(), &credentials, ICLOUD_NAMES)
            .await
            .expect("signed in");
        let mut blocks = Vec::new();
        let mut skipped = 0;
        for mailbox in imap.mailboxes().await.expect("listed") {
            imap.open(&mailbox.key).await.expect("opened");
            let ids = imap.list().await.expect("listed").ids;
            if ids.len() > skip_over {
                skipped += 1;
                continue;
            }
            for batch in ids.chunks(250) {
                for seen in imap.headers(batch).await.expect("headers") {
                    blocks.push(seen.header_block);
                }
            }
        }
        imap.close().await;
        eprintln!(
            "{} header blocks; {skipped} mailbox(es) left out",
            blocks.len()
        );
        blocks
    });

    // Authentication-Results: the topmost header's server, and the others'.
    let mut topmost: BTreeMap<String, u64> = BTreeMap::new();
    let mut below: BTreeMap<String, u64> = BTreeMap::new();
    let mut with_none = 0u64;
    let mut with_several = 0u64;
    // Where the headers sit in the block.
    let mut first_field: BTreeMap<&str, u64> = BTreeMap::new();
    let mut fields_above: BTreeMap<&str, u64> = BTreeMap::new();
    let mut received_above: BTreeMap<&str, u64> = BTreeMap::new();
    let mut top_run_interrupted = 0u64;
    // What the engine's rule reads as the provider's own results.
    let mut engine_read = 0u64;
    let mut engine_none = 0u64;
    // For a message whose results the engine refuses: the domain of the
    // server that took the first Received field with a domain, above them.
    let mut refused_by: BTreeMap<String, u64> = BTreeMap::new();
    let mut engine_checks: BTreeMap<String, u64> = BTreeMap::new();
    let mut first_received_by: BTreeMap<String, u64> = BTreeMap::new();
    // The order of Received and Authentication-Results fields, as shapes:
    // iCloud's own hosts by domain, any other host as "other", "ip" or
    // "none". No other name is kept.
    let mut sequences: HashMap<String, u64> = HashMap::new();
    // Threads by their headers alone, for the subject question.
    let mut by_id: HashMap<String, usize> = HashMap::new();
    let mut threads = Threads { parent: Vec::new() };
    let mut subjects: Vec<String> = Vec::new();
    let mut names_none = 0u64;
    for block in &blocks {
        let parsed = mail_parser::MessageParser::new().parse_headers(&block[..]);
        let Some(message) = parsed else { continue };
        // In the order written: the topmost is the last server's.
        let results: Vec<String> = message
            .headers()
            .all("Authentication-Results")
            .map(|header| domain(&authserv_id(&String::from_utf8_lossy(header.raw_value()))))
            .collect();
        // Each field's kind and, for a result, its server's domain.
        let fields: Vec<(String, String)> = message
            .headers()
            .iter()
            .map(|header| {
                let name = header.raw_name().to_ascii_lowercase();
                let server = if name == "authentication-results" {
                    domain(&authserv_id(&String::from_utf8_lossy(header.raw_value())))
                } else {
                    String::new()
                };
                (name, server)
            })
            .collect();
        if !results.is_empty() {
            let derived = loam_mail::derive::header_fields(block);
            match derived.authentication {
                Some(found) => {
                    engine_read += 1;
                    for (check, result) in [
                        ("spf", found.spf),
                        ("dkim", found.dkim),
                        ("dmarc", found.dmarc),
                    ] {
                        if !result.is_empty() {
                            *engine_checks
                                .entry(format!("{check}={result}"))
                                .or_default() += 1;
                        }
                    }
                }
                None => {
                    engine_none += 1;
                    let mut first_by = "no received with a domain".to_string();
                    for header in message.headers().iter() {
                        let name = header.raw_name().to_ascii_lowercase();
                        if name == "authentication-results" {
                            break;
                        }
                        if name == "received" {
                            let text = String::from_utf8_lossy(header.raw_value()).to_lowercase();
                            let words: Vec<&str> = text.split_whitespace().collect();
                            if let Some(host) = words
                                .iter()
                                .position(|word| *word == "by")
                                .and_then(|at| words.get(at + 1))
                            {
                                let host = host
                                    .trim_matches(|c: char| {
                                        matches!(c, ';' | '(' | ')' | '[' | ']')
                                    })
                                    .trim_end_matches('.');
                                if host.contains('.') && host.parse::<std::net::IpAddr>().is_err() {
                                    first_by = domain(host);
                                    break;
                                }
                            }
                        }
                    }
                    *refused_by.entry(first_by).or_default() += 1;
                }
            }
            let by = message
                .headers()
                .all("Received")
                .next()
                .map(|header| {
                    let text = String::from_utf8_lossy(header.raw_value()).to_lowercase();
                    let words: Vec<&str> = text.split_whitespace().collect();
                    words
                        .iter()
                        .position(|word| *word == "by")
                        .and_then(|at| words.get(at + 1))
                        .map(|host| domain(host))
                        .unwrap_or_else(|| "no by".to_string())
                })
                .unwrap_or_else(|| "no received".to_string());
            *first_received_by.entry(by).or_default() += 1;
        }
        if !results.is_empty() {
            let class = |host: Option<&str>| -> String {
                match host {
                    None | Some("") => "none".to_string(),
                    Some(host)
                        if host.parse::<std::net::IpAddr>().is_ok() || host.starts_with('[') =>
                    {
                        "ip".to_string()
                    }
                    Some(host) if !host.contains('.') => "nodomain".to_string(),
                    Some(host) => {
                        let found = domain(host);
                        if ["icloud.com", "me.com", "mac.com", "apple.com"]
                            .contains(&found.as_str())
                        {
                            found
                        } else {
                            "other".to_string()
                        }
                    }
                }
            };
            let mut shape = Vec::new();
            for header in message.headers().iter().take(60) {
                let name = header.raw_name().to_ascii_lowercase();
                let value = String::from_utf8_lossy(header.raw_value()).to_lowercase();
                if name == "received" {
                    let words: Vec<&str> = value.split_whitespace().collect();
                    let after = |keyword: &str| {
                        words
                            .iter()
                            .position(|word| *word == keyword)
                            .and_then(|at| words.get(at + 1))
                            .map(|host| {
                                host.trim_matches(|c: char| c == ';' || c == '(' || c == ')')
                            })
                    };
                    let has_from = words.first() == Some(&"from");
                    shape.push(format!(
                        "R[{}>{}]",
                        if has_from {
                            class(after("from"))
                        } else {
                            "nofrom".to_string()
                        },
                        class(after("by"))
                    ));
                } else if name == "authentication-results" {
                    shape.push(format!("A[{}]", class(Some(&authserv_id(&value)))));
                }
                if shape.len() >= 14 {
                    break;
                }
            }
            *sequences.entry(shape.join(" ")).or_default() += 1;
        }
        if let Some(first_result) = fields
            .iter()
            .position(|(name, _)| name == "authentication-results")
        {
            let kind = match fields[0].0.as_str() {
                "authentication-results" => "authentication-results",
                "received" => "received",
                "arc-seal" | "arc-message-signature" | "arc-authentication-results" => "arc",
                "dkim-signature" => "dkim-signature",
                _ => "other",
            };
            *first_field.entry(kind).or_default() += 1;
            *fields_above.entry(bucket(first_result)).or_default() += 1;
            let received = fields[..first_result]
                .iter()
                .filter(|(name, _)| name == "received")
                .count();
            *received_above.entry(bucket(received)).or_default() += 1;
            // Does another kind of field come between two results written by
            // the topmost's domain?
            let top = fields[first_result].1.clone();
            let mut left_run = false;
            for (name, server) in &fields[first_result..] {
                if name == "authentication-results" && *server == top {
                    if left_run {
                        top_run_interrupted += 1;
                        break;
                    }
                } else {
                    left_run = true;
                }
            }
        }
        match results.as_slice() {
            [] => with_none += 1,
            [first, rest @ ..] => {
                *topmost.entry(first.clone()).or_default() += 1;
                if !rest.is_empty() {
                    with_several += 1;
                }
                for other in rest {
                    *below.entry(other.clone()).or_default() += 1;
                }
            }
        }
        let at = threads.parent.len();
        threads.parent.push(at);
        subjects.push(bare_subject(message.subject().unwrap_or_default()));
        let mut named = Vec::new();
        if let Some(id) = message.message_id() {
            named.push(id.to_string());
        }
        let mut names_other = false;
        for list in [message.in_reply_to(), message.references()]
            .into_iter()
            .flatten()
        {
            for id in list.iter() {
                named.push(id.to_string());
                names_other = true;
            }
        }
        if !names_other {
            names_none += 1;
        }
        for id in named {
            match by_id.get(&id) {
                Some(&other) => threads.join(at, other),
                None => {
                    by_id.insert(id, at);
                }
            }
        }
    }

    // A subject shared by messages in more than one thread is a subject that
    // would join threads that are not one.
    let mut by_subject: HashMap<&str, Vec<usize>> = HashMap::new();
    for (at, subject) in subjects.iter().enumerate() {
        if subject.chars().count() >= 4 {
            by_subject.entry(subject.as_str()).or_default().push(at);
        }
    }
    let (mut shared, mut one_thread, mut several_threads, mut messages_in_wrong_joins) =
        (0u64, 0u64, 0u64, 0u64);
    for members in by_subject.values() {
        if members.len() < 2 {
            continue;
        }
        shared += 1;
        let mut roots: Vec<usize> = members.iter().map(|at| threads.find(*at)).collect();
        roots.sort_unstable();
        roots.dedup();
        if roots.len() == 1 {
            one_thread += 1;
        } else {
            several_threads += 1;
            messages_in_wrong_joins += u64::try_from(members.len()).unwrap();
        }
    }
    // Domains seen often enough to be infrastructure, not one sender's; the
    // rest are counted together.
    let common = |counts: BTreeMap<String, u64>| -> BTreeMap<String, u64> {
        let mut kept = BTreeMap::new();
        for (domain, count) in counts {
            let key = if count >= 20 {
                domain
            } else {
                "others".to_string()
            };
            *kept.entry(key).or_default() += count;
        }
        kept
    };
    let mut common_orders: Vec<(String, u64)> = sequences.into_iter().collect();
    common_orders.sort_by_key(|order| std::cmp::Reverse(order.1));
    common_orders.truncate(12);
    let common_orders: Vec<serde_json::Value> = common_orders
        .into_iter()
        .map(|(order, messages)| json!({ "order": order, "messages": messages }))
        .collect();
    let results = json!({
        "run": "Step B4, the header blocks of the owner's iCloud account, its largest mailbox left out, read once and kept nowhere. Counts only; servers grouped by the domain their names end in, those seen fewer than 20 times together as others.",
        "headerBlocks": blocks.len(),
        "authenticationResults": {
            "messagesWithNone": with_none,
            "messagesWithSeveral": with_several,
            "topmostServerDomain": common(topmost),
            "otherServerDomain": common(below),
            "firstFieldOfTheBlock": first_field,
            "fieldsAboveTheFirstResult": fields_above,
            "receivedFieldsAboveTheFirstResult": received_above,
            "topmostDomainRunInterruptedByAnotherField": top_run_interrupted,
            "topmostReceivedByDomain": common(first_received_by),
            "theEngineReadsTheProvidersResults": engine_read,
            "theEngineReadsNone": engine_none,
            "refusedBelowAReceivedFieldTakenBy": common(refused_by),
            "theEngineReadsChecks": engine_checks,
            "commonFieldOrders": common_orders,
        },
        "sharedSubjects": {
            "messagesNamingNoOther": names_none,
            "subjectsSharedByTwoOrMore": shared,
            "ofThemInOneThread": one_thread,
            "ofThemInSeveralThreads": several_threads,
            "messagesUnderSubjectsInSeveralThreads": messages_in_wrong_joins,
        },
    });
    let rendered = serde_json::to_string_pretty(&results).unwrap();
    println!("{rendered}");
    if let Ok(out) = std::env::var("LOAM_MAIL_LIVE_OUT") {
        std::fs::write(out, rendered + "\n").unwrap();
    }
}
