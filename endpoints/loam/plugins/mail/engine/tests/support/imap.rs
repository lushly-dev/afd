//! A scripted IMAP server: the test double of the specification's section 14.
//!
//! It speaks as much IMAP4rev1 as the engine sends, with CONDSTORE and QRESYNC
//! when a test turns them on, over plain TCP on the loopback. A test holds
//! its [`World`] and changes it between passes: it adds and removes messages,
//! changes flags and `UIDVALIDITY`, names messages it lists and never returns,
//! and drops the connection after a number of `FETCH` responses. Every command
//! the engine sends is logged, without the password.

#![allow(dead_code, clippy::expect_used, clippy::unwrap_used)]

use std::collections::{BTreeMap, HashSet};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

/// The user name and password the server accepts.
pub const USER: &str = "person@example.com";
pub const PASSWORD: &str = "app-password";

/// One message in a mailbox.
#[derive(Debug, Clone)]
pub struct Message {
    pub flags: Vec<String>,
    pub modseq: u64,
    pub internal_date: String,
    pub bytes: Vec<u8>,
}

/// One mailbox.
#[derive(Debug, Clone)]
pub struct Mailbox {
    pub name: String,
    /// Special-use and other attributes, such as `\Sent`.
    pub attributes: Vec<String>,
    pub validity: u32,
    pub uid_next: u32,
    pub messages: BTreeMap<u32, Message>,
    /// UIDs expunged, with the mod-sequence at which they went.
    pub expunged: Vec<(u32, u64)>,
    /// UIDs it lists and never returns.
    pub never_return: HashSet<u32>,
    /// UIDs whose headers it returns and whose bodies it never does.
    pub never_return_body: HashSet<u32>,
    /// UIDs a `FETCH` breaks on: the server answers with bytes no IMAP
    /// reader can parse.
    pub poison: HashSet<u32>,
}

/// Everything the server holds, and what it was asked.
#[derive(Debug)]
pub struct World {
    pub condstore: bool,
    pub qresync: bool,
    pub mailboxes: Vec<Mailbox>,
    pub modseq: u64,
    /// Every command received, without its tag; `LOGIN` without its
    /// arguments.
    pub log: Vec<String>,
    /// Drop the connection after this many more `FETCH` responses.
    pub drop_after: Option<usize>,
    /// Drop the connection on receiving the command after this many more.
    pub drop_after_commands: Option<usize>,
    /// Whether a drop also takes the server down, as a stop would: it then
    /// closes every new connection unanswered until `down` is cleared.
    pub down_on_drop: bool,
    pub down: bool,
    /// Give a mailbox a new `UIDVALIDITY` when it is opened with QRESYNC, as
    /// if it changed between two openings.
    pub renumber_on_qresync: Option<String>,
    pub connections: usize,
}

impl World {
    fn new(condstore: bool, qresync: bool) -> Self {
        Self {
            condstore,
            qresync,
            mailboxes: Vec::new(),
            modseq: 1,
            log: Vec::new(),
            drop_after: None,
            drop_after_commands: None,
            down_on_drop: false,
            down: false,
            renumber_on_qresync: None,
            connections: 0,
        }
    }

    /// Adds an empty mailbox.
    pub fn mailbox(&mut self, name: &str, attributes: &[&str]) {
        self.mailboxes.push(Mailbox {
            name: name.to_string(),
            attributes: attributes.iter().map(ToString::to_string).collect(),
            validity: 1000 + u32::try_from(self.mailboxes.len()).unwrap(),
            uid_next: 1,
            messages: BTreeMap::new(),
            expunged: Vec::new(),
            never_return: HashSet::new(),
            never_return_body: HashSet::new(),
            poison: HashSet::new(),
        });
    }

    pub fn find(&mut self, name: &str) -> &mut Mailbox {
        self.mailboxes
            .iter_mut()
            .find(|mailbox| mailbox.name == name)
            .expect("the mailbox exists")
    }

    /// Adds a message to a mailbox and returns its UID.
    pub fn add(&mut self, mailbox: &str, bytes: Vec<u8>, flags: &[&str]) -> u32 {
        self.modseq += 1;
        let modseq = self.modseq;
        let mailbox = self.find(mailbox);
        let uid = mailbox.uid_next;
        mailbox.uid_next += 1;
        let day = 1 + (uid % 28);
        mailbox.messages.insert(
            uid,
            Message {
                flags: flags.iter().map(ToString::to_string).collect(),
                modseq,
                internal_date: format!("{day:2}-Mar-2026 10:{:02}:00 +0000", uid % 60),
                bytes,
            },
        );
        uid
    }

    pub fn set_flags(&mut self, mailbox: &str, uid: u32, flags: &[&str]) {
        self.modseq += 1;
        let modseq = self.modseq;
        let message = self
            .find(mailbox)
            .messages
            .get_mut(&uid)
            .expect("the message exists");
        message.flags = flags.iter().map(ToString::to_string).collect();
        message.modseq = modseq;
    }

    pub fn expunge(&mut self, mailbox: &str, uid: u32) {
        self.modseq += 1;
        let modseq = self.modseq;
        let mailbox = self.find(mailbox);
        mailbox.messages.remove(&uid);
        mailbox.expunged.push((uid, modseq));
    }

    /// Gives a mailbox a new `UIDVALIDITY` and renumbers its messages, as a
    /// server that rebuilt its index would.
    pub fn renumber(&mut self, mailbox: &str) {
        self.modseq += 1;
        let modseq = self.modseq;
        let mailbox = self.find(mailbox);
        mailbox.validity += 7;
        let messages: Vec<Message> = std::mem::take(&mut mailbox.messages)
            .into_values()
            .collect();
        mailbox.uid_next = 500;
        for mut message in messages {
            message.modseq = modseq;
            mailbox.messages.insert(mailbox.uid_next, message);
            mailbox.uid_next += 1;
        }
        mailbox.expunged.clear();
        mailbox.never_return.clear();
    }

    pub fn remove_mailbox(&mut self, name: &str) {
        self.mailboxes.retain(|mailbox| mailbox.name != name);
    }
}

/// The running server.
pub struct Server {
    pub address: SocketAddr,
    pub world: Arc<Mutex<World>>,
}

impl Server {
    /// Starts a server on the loopback, on a thread of its own.
    pub fn start(condstore: bool, qresync: bool) -> Self {
        let world = Arc::new(Mutex::new(World::new(condstore, qresync)));
        let std_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port");
        std_listener.set_nonblocking(true).expect("non-blocking");
        let address = std_listener.local_addr().expect("an address");
        let shared = Arc::clone(&world);
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("a runtime");
            runtime.block_on(async move {
                let listener = TcpListener::from_std(std_listener).expect("a listener");
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        return;
                    };
                    shared.lock().unwrap().connections += 1;
                    tokio::spawn(serve(stream, Arc::clone(&shared)));
                }
            });
        });
        Self { address, world }
    }

    pub fn world(&self) -> std::sync::MutexGuard<'_, World> {
        self.world.lock().unwrap()
    }

    /// The commands logged since the last call.
    pub fn take_log(&self) -> Vec<String> {
        std::mem::take(&mut self.world().log)
    }
}

/// What a connection has open.
struct Session {
    open: Option<String>,
    enabled_qresync: bool,
}

async fn serve(stream: TcpStream, world: Arc<Mutex<World>>) {
    if world.lock().unwrap().down {
        return;
    }
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read);
    if write
        .write_all(b"* OK scripted server ready\r\n")
        .await
        .is_err()
    {
        return;
    }
    let mut session = Session {
        open: None,
        enabled_qresync: false,
    };
    let mut line = String::new();
    loop {
        line.clear();
        match lines.read_line(&mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let command = line.trim_end_matches(['\r', '\n']).to_string();
        let Some((tag, rest)) = command.split_once(' ') else {
            continue;
        };
        let (output, close) = answer(tag, rest, &world, &mut session);
        for chunk in output {
            match chunk {
                Chunk::Bytes(bytes) => {
                    if write.write_all(&bytes).await.is_err() {
                        return;
                    }
                }
                Chunk::Drop => {
                    let _ = write.shutdown().await;
                    return;
                }
            }
        }
        if close {
            let _ = write.shutdown().await;
            return;
        }
    }
}

enum Chunk {
    Bytes(Vec<u8>),
    Drop,
}

fn text(out: &mut Vec<Chunk>, line: String) {
    out.push(Chunk::Bytes(line.into_bytes()));
}

/// Answers one command. Returns the output and whether to close.
fn answer(
    tag: &str,
    rest: &str,
    world: &Mutex<World>,
    session: &mut Session,
) -> (Vec<Chunk>, bool) {
    let mut world = world.lock().unwrap();
    if let Some(left) = world.drop_after_commands.as_mut() {
        if *left == 0 {
            world.drop_after_commands = None;
            world.down = world.down_on_drop;
            return (vec![Chunk::Drop], true);
        }
        *left -= 1;
    }
    let words = tokens(rest);
    let verb = words
        .first()
        .map(|w| w.to_ascii_uppercase())
        .unwrap_or_default();
    let logged = if verb == "LOGIN" {
        "LOGIN".to_string()
    } else {
        rest.to_string()
    };
    world.log.push(logged);
    let mut out = Vec::new();
    match verb.as_str() {
        "CAPABILITY" => {
            let mut capabilities = "IMAP4rev1 UIDPLUS".to_string();
            if world.condstore {
                capabilities.push_str(" CONDSTORE");
            }
            if world.qresync {
                capabilities.push_str(" QRESYNC ENABLE");
            }
            text(&mut out, format!("* CAPABILITY {capabilities}\r\n"));
            text(&mut out, format!("{tag} OK done\r\n"));
        }
        "LOGIN" => {
            if words.get(1).map(String::as_str) == Some(USER)
                && words.get(2).map(String::as_str) == Some(PASSWORD)
            {
                text(&mut out, format!("{tag} OK signed in\r\n"));
            } else {
                text(
                    &mut out,
                    format!("{tag} NO [AUTHENTICATIONFAILED] Authentication failed\r\n"),
                );
            }
        }
        "ENABLE" => {
            session.enabled_qresync = true;
            text(&mut out, "* ENABLED QRESYNC\r\n".to_string());
            text(&mut out, format!("{tag} OK enabled\r\n"));
        }
        "LIST" => {
            for mailbox in &world.mailboxes {
                let mut attributes = vec!["\\HasNoChildren".to_string()];
                attributes.extend(mailbox.attributes.iter().cloned());
                text(
                    &mut out,
                    format!(
                        "* LIST ({}) \"/\" \"{}\"\r\n",
                        attributes.join(" "),
                        mailbox.name
                    ),
                );
            }
            text(&mut out, format!("{tag} OK listed\r\n"));
        }
        "EXAMINE" => examine(tag, &words, &mut world, session, &mut out),
        "UID" => {
            let sub = words
                .get(1)
                .map(|w| w.to_ascii_uppercase())
                .unwrap_or_default();
            let Some(open) = session.open.clone() else {
                text(&mut out, format!("{tag} BAD nothing open\r\n"));
                return (out, false);
            };
            match sub.as_str() {
                "SEARCH" => search(tag, &words[2..], &mut world, &open, &mut out),
                "FETCH" => fetch(tag, rest, &words, &mut world, &open, &mut out),
                _ => text(&mut out, format!("{tag} BAD not scripted\r\n")),
            }
        }
        "NOOP" => text(&mut out, format!("{tag} OK\r\n")),
        "LOGOUT" => {
            text(&mut out, "* BYE\r\n".to_string());
            text(&mut out, format!("{tag} OK\r\n"));
            return (out, true);
        }
        _ => text(&mut out, format!("{tag} BAD not scripted\r\n")),
    }
    (out, false)
}

fn examine(
    tag: &str,
    words: &[String],
    world: &mut World,
    session: &mut Session,
    out: &mut Vec<Chunk>,
) {
    let Some(name) = words.get(1) else {
        text(out, format!("{tag} BAD no mailbox\r\n"));
        return;
    };
    let condstore = world.condstore;
    if words
        .get(2)
        .is_some_and(|word| word.starts_with("(QRESYNC"))
        && world.renumber_on_qresync.as_deref() == Some(name.as_str())
    {
        world.renumber_on_qresync = None;
        world.renumber(name);
    }
    let Some(mailbox) = world.mailboxes.iter().find(|mailbox| &mailbox.name == name) else {
        session.open = None;
        text(out, format!("{tag} NO no such mailbox\r\n"));
        return;
    };
    session.open = Some(name.clone());
    text(
        out,
        "* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n".to_string(),
    );
    text(out, format!("* {} EXISTS\r\n", mailbox.messages.len()));
    text(
        out,
        format!("* OK [UIDVALIDITY {}] ok\r\n", mailbox.validity),
    );
    text(out, format!("* OK [UIDNEXT {}] ok\r\n", mailbox.uid_next));
    if condstore {
        let highest = mailbox
            .messages
            .values()
            .map(|message| message.modseq)
            .chain(mailbox.expunged.iter().map(|(_, modseq)| *modseq))
            .max()
            .unwrap_or(1);
        text(out, format!("* OK [HIGHESTMODSEQ {highest}] ok\r\n"));
    }
    // `EXAMINE name (QRESYNC (validity modseq))`.
    let parameters = words[2..].join(" ");
    if session.enabled_qresync
        && let Some(inner) = parameters.strip_prefix("(QRESYNC (")
    {
        let numbers: Vec<u64> = inner
            .trim_end_matches(')')
            .split(' ')
            .filter_map(|word| word.trim_end_matches(')').parse().ok())
            .collect();
        if let [validity, since] = numbers[..]
            && validity == u64::from(mailbox.validity)
        {
            let vanished: Vec<String> = mailbox
                .expunged
                .iter()
                .filter(|(_, modseq)| *modseq > since)
                .map(|(uid, _)| uid.to_string())
                .collect();
            if !vanished.is_empty() {
                text(
                    out,
                    format!("* VANISHED (EARLIER) {}\r\n", vanished.join(",")),
                );
            }
            for (sequence, (uid, message)) in mailbox.messages.iter().enumerate() {
                if message.modseq > since {
                    text(
                        out,
                        format!(
                            "* {} FETCH (UID {uid} FLAGS ({}) MODSEQ ({}))\r\n",
                            sequence + 1,
                            message.flags.join(" "),
                            message.modseq
                        ),
                    );
                }
            }
        }
    }
    text(out, format!("{tag} OK [READ-ONLY] examined\r\n"));
}

fn search(tag: &str, criteria: &[String], world: &mut World, open: &str, out: &mut Vec<Chunk>) {
    let mailbox = world.find(open);
    let uids: Vec<u32> = match criteria {
        [all] if all.eq_ignore_ascii_case("ALL") => mailbox.messages.keys().copied().collect(),
        [uid, set] if uid.eq_ignore_ascii_case("UID") => {
            let highest = mailbox.messages.keys().max().copied().unwrap_or(0);
            mailbox
                .messages
                .keys()
                .copied()
                .filter(|candidate| in_set(set, *candidate, highest))
                .collect()
        }
        _ => {
            text(out, format!("{tag} BAD not scripted\r\n"));
            return;
        }
    };
    let listed: Vec<String> = uids.iter().map(u32::to_string).collect();
    text(
        out,
        format!("* SEARCH {}\r\n", listed.join(" ")).replace("SEARCH \r\n", "SEARCH\r\n"),
    );
    text(out, format!("{tag} OK searched\r\n"));
}

fn fetch(
    tag: &str,
    rest: &str,
    words: &[String],
    world: &mut World,
    open: &str,
    out: &mut Vec<Chunk>,
) {
    let Some(set) = words.get(2) else {
        text(out, format!("{tag} BAD no set\r\n"));
        return;
    };
    let items = rest.to_ascii_uppercase();
    let changed_since: Option<u64> = items
        .split("CHANGEDSINCE ")
        .nth(1)
        .and_then(|after| after.trim_end_matches(')').trim().parse().ok());
    let mut drop_after = world.drop_after;
    let mailbox = world.find(open).clone();
    let highest = mailbox.messages.keys().max().copied().unwrap_or(0);
    for (sequence, (uid, message)) in mailbox.messages.iter().enumerate() {
        if !in_set(set, *uid, highest) || mailbox.never_return.contains(uid) {
            continue;
        }
        if items.contains("BODY.PEEK[]") && mailbox.never_return_body.contains(uid) {
            continue;
        }
        if items.contains("BODY.PEEK") && mailbox.poison.contains(uid) {
            out.push(Chunk::Bytes(b"* 1 FETCH (UID ((( broken\r\n".to_vec()));
            out.push(Chunk::Drop);
            return;
        }
        if changed_since.is_some_and(|since| message.modseq <= since) {
            continue;
        }
        if let Some(left) = drop_after.as_mut() {
            if *left == 0 {
                world.drop_after = None;
                world.down = world.down_on_drop;
                out.push(Chunk::Drop);
                return;
            }
            *left -= 1;
        }
        let mut response = format!("* {} FETCH (UID {uid}", sequence + 1).into_bytes();
        if items.contains("RFC822.SIZE") {
            response.extend(format!(" RFC822.SIZE {}", message.bytes.len()).bytes());
        }
        if items.contains("INTERNALDATE") {
            response.extend(format!(" INTERNALDATE \"{}\"", message.internal_date).bytes());
        }
        if items.contains("FLAGS") {
            response.extend(format!(" FLAGS ({})", message.flags.join(" ")).bytes());
        }
        if items.contains("CHANGEDSINCE") || items.contains("MODSEQ") {
            response.extend(format!(" MODSEQ ({})", message.modseq).bytes());
        }
        if items.contains("BODY.PEEK[HEADER]") {
            let header = header_block(&message.bytes);
            response.extend(format!(" BODY[HEADER] {{{}}}\r\n", header.len()).bytes());
            response.extend_from_slice(header);
        }
        if items.contains("BODY.PEEK[]") {
            response.extend(format!(" BODY[] {{{}}}\r\n", message.bytes.len()).bytes());
            response.extend_from_slice(&message.bytes);
        }
        response.extend_from_slice(b")\r\n");
        out.push(Chunk::Bytes(response));
    }
    if drop_after.is_some() {
        world.drop_after = drop_after;
    }
    text(out, format!("{tag} OK fetched\r\n"));
}

/// The header block: up to and including the blank line.
fn header_block(bytes: &[u8]) -> &[u8] {
    bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map_or(bytes, |at| &bytes[..at + 4])
}

/// Whether `uid` is in an IMAP set such as `1:3,7,9:*`.
fn in_set(set: &str, uid: u32, highest: u32) -> bool {
    let number = |text: &str| -> u32 {
        if text == "*" {
            highest
        } else {
            text.parse().unwrap_or(0)
        }
    };
    set.split(',').any(|part| match part.split_once(':') {
        Some((low, high)) => {
            let (a, b) = (number(low), number(high));
            (a.min(b)..=a.max(b)).contains(&uid)
        }
        None => number(part) == uid,
    })
}

/// A command's words: atoms, quoted strings without their quotes, and a
/// parenthesised list as one word.
fn tokens(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(&next) = chars.peek() {
        if next == ' ' {
            chars.next();
            continue;
        }
        let mut word = String::new();
        if next == '"' {
            chars.next();
            while let Some(c) = chars.next() {
                match c {
                    '\\' => {
                        if let Some(escaped) = chars.next() {
                            word.push(escaped);
                        }
                    }
                    '"' => break,
                    other => word.push(other),
                }
            }
        } else {
            let mut depth = 0;
            while let Some(&c) = chars.peek() {
                if c == ' ' && depth == 0 {
                    break;
                }
                if c == '(' {
                    depth += 1;
                }
                if c == ')' {
                    depth -= 1;
                }
                word.push(c);
                chars.next();
            }
        }
        words.push(word);
    }
    words
}

/// A message of about `size` bytes with a subject and, when given, a reply
/// to another message's id.
pub fn message(id: u32, subject: &str, reply_to: Option<u32>, body: &str) -> Vec<u8> {
    let mut text = format!(
        "From: Sender {id} <sender{id}@example.org>\r\n\
         To: person@example.com\r\n\
         Subject: {subject}\r\n\
         Date: Mon, 2 Mar 2026 10:{:02}:00 +0000\r\n\
         Message-ID: <m{id}@example.org>\r\n",
        id % 60
    );
    if let Some(parent) = reply_to {
        text.push_str(&format!("In-Reply-To: <m{parent}@example.org>\r\n"));
    }
    text.push_str("Content-Type: text/plain; charset=utf-8\r\n\r\n");
    text.push_str(body);
    text.push_str("\r\n");
    text.into_bytes()
}
