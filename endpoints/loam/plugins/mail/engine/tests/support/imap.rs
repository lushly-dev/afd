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
    /// UIDs a `FETCH` of the whole message or of a part breaks on, as
    /// [`Mailbox::poison`]; their headers are returned.
    pub poison_body: HashSet<u32>,
    /// UIDs whose `BODYSTRUCTURE` nests 2 000 deep, as a server's might for
    /// a message built to.
    pub nested: HashSet<u32>,
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
    /// Take each new connection and never answer it, as a provider that
    /// hangs would.
    pub stall: bool,
    /// Answer `NO` to a search while this mailbox is open.
    pub refuse_search_in: Option<String>,
    /// Answer the opening of this mailbox with a reply nested 2 000 deep.
    pub nest_examine_of: Option<String>,
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
            stall: false,
            refuse_search_in: None,
            nest_examine_of: None,
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
            poison_body: HashSet::new(),
            nested: HashSet::new(),
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
    if world.lock().unwrap().stall {
        // The connection stays open, and nothing is ever written to it.
        let _held = &stream;
        let never: std::convert::Infallible = std::future::pending().await;
        match never {}
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
    if world.nest_examine_of.as_deref() == Some(name.as_str()) {
        session.open = None;
        text(out, format!("* FLAGS {}\r\n", "(".repeat(2_000)));
        return;
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
    if world.refuse_search_in.as_deref() == Some(open) {
        text(out, format!("{tag} NO search refused\r\n"));
        return;
    }
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
        let places = part_places(&items);
        if (items.contains("BODY.PEEK[]") || items.contains("BODYSTRUCTURE") || !places.is_empty())
            && mailbox.never_return_body.contains(uid)
        {
            continue;
        }
        let body_asked = items.contains("BODY.PEEK[]") || !places.is_empty();
        if (items.contains("BODY.PEEK") && mailbox.poison.contains(uid))
            || (body_asked && mailbox.poison_body.contains(uid))
        {
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
        if items.contains("BODYSTRUCTURE") {
            let structure = if mailbox.nested.contains(uid) {
                let mut body = "(\"TEXT\" \"PLAIN\" NIL NIL NIL \"7BIT\" 1 1)".to_string();
                for _ in 0..2_000 {
                    body = format!("({body} \"MIXED\")");
                }
                body
            } else {
                body_structure(&message.bytes)
            };
            response.extend(format!(" BODYSTRUCTURE {structure}").bytes());
        }
        for place in &places {
            if let Some(bytes) = part_bytes(&message.bytes, place) {
                response.extend(format!(" BODY[{place}] {{{}}}\r\n", bytes.len()).bytes());
                response.extend_from_slice(&bytes);
            }
        }
        response.extend_from_slice(b")\r\n");
        out.push(Chunk::Bytes(response));
    }
    if drop_after.is_some() {
        world.drop_after = drop_after;
    }
    text(out, format!("{tag} OK fetched\r\n"));
}

/// The places of the `BODY.PEEK[1.2]` items a `FETCH` asks for.
fn part_places(items: &str) -> Vec<String> {
    items
        .split("BODY.PEEK[")
        .skip(1)
        .filter_map(|after| after.split_once(']').map(|(place, _)| place.to_string()))
        .filter(|place| {
            !place.is_empty()
                && place
                    .split('.')
                    .all(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        })
        .collect()
}

/// A string as IMAP quotes it.
fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// A parameter list: `("NAME" "value" ...)` or `NIL`.
fn parameters(list: &[(&str, String)]) -> String {
    let present: Vec<String> = list
        .iter()
        .filter(|(_, value)| !value.is_empty())
        .map(|(name, value)| format!("{} {}", quoted(name), quoted(value)))
        .collect();
    if present.is_empty() {
        "NIL".to_string()
    } else {
        format!("({})", present.join(" "))
    }
}

/// A message's `BODYSTRUCTURE`, as a server writes it, read with
/// `mail-parser` independently of the engine's own reading.
pub fn body_structure(bytes: &[u8]) -> String {
    let message = mail_parser::MessageParser::new().parse(bytes).unwrap();
    structure_of(message.root_part())
}

/// A part's header value's parameters as the message wrote them, as a
/// server gives them: a quoted value unquoted, any other as it is.
fn raw_params(value: &str) -> Vec<(String, String)> {
    let mut params = Vec::new();
    let mut rest = value.split_once(';').map_or("", |(_, rest)| rest);
    loop {
        rest = rest.trim_start_matches([' ', '\t', ';']);
        let Some((name, after)) = rest.split_once('=') else {
            break;
        };
        let after = after.trim_start();
        let (value, next) = if let Some(quoted) = after.strip_prefix('"') {
            let mut value = String::new();
            let mut end = quoted.len();
            let mut chars = quoted.char_indices();
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
        params.push((name.trim().to_ascii_uppercase(), value));
        rest = next;
    }
    params
}

/// The raw value of a part's header, unfolded.
fn raw_header(part: &mail_parser::MessagePart<'_>, name: &str) -> Option<String> {
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

fn param_list(params: &[(String, String)]) -> String {
    let refs: Vec<(&str, String)> = params
        .iter()
        .filter(|(name, _)| name != "BOUNDARY")
        .map(|(name, value)| (name.as_str(), value.clone()))
        .collect();
    parameters(&refs)
}

fn structure_of(part: mail_parser::MessagePart<'_>) -> String {
    use mail_parser::PartKind;
    let content_type = part.content_type();
    let (main, sub) =
        content_type
            .as_ref()
            .map_or(("TEXT".to_string(), "PLAIN".to_string()), |content_type| {
                (
                    content_type.ctype().to_ascii_uppercase(),
                    content_type
                        .subtype()
                        .unwrap_or("PLAIN")
                        .to_ascii_uppercase(),
                )
            });
    let type_params = raw_header(&part, "content-type")
        .map(|value| raw_params(&value))
        .unwrap_or_default();
    let disposition = raw_header(&part, "content-disposition").map_or("NIL".to_string(), |value| {
        let kind = value
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_uppercase();
        format!("({} {})", quoted(&kind), param_list(&raw_params(&value)))
    });
    if let PartKind::Multipart = part.kind() {
        let children: String = part.children().map(structure_of).collect();
        return format!(
            "({children} {} {} {disposition} NIL NIL)",
            quoted(&sub),
            parameters(&[(
                "BOUNDARY",
                content_type
                    .as_ref()
                    .and_then(|content_type| content_type.attribute("boundary"))
                    .unwrap_or_default()
                    .to_string()
            )])
        );
    }
    let body = part.raw_body();
    let encoding = part
        .content_transfer_encoding()
        .unwrap_or("7BIT")
        .to_ascii_uppercase();
    let common = format!(
        "{} {} {} NIL NIL {} {}",
        quoted(&main),
        quoted(&sub),
        param_list(&type_params),
        quoted(&encoding),
        body.len()
    );
    let lines = body.iter().filter(|b| **b == b'\n').count();
    let extension = format!("NIL {disposition} NIL NIL");
    match part.kind() {
        PartKind::Message(nested) => format!(
            "({common} (NIL NIL NIL NIL NIL NIL NIL NIL NIL NIL) {} {lines} {extension})",
            structure_of(nested.root_part())
        ),
        PartKind::Text | PartKind::Html if main == "TEXT" => {
            format!("({common} {lines} {extension})")
        }
        _ => format!("({common} {extension})"),
    }
}

/// The body of the part at `place`, as a server returns `BODY[place]`.
pub fn part_bytes(bytes: &[u8], place: &str) -> Option<Vec<u8>> {
    let message = mail_parser::MessageParser::new().parse(bytes)?;
    find(message.root_part(), "", place)
}

fn find(part: mail_parser::MessagePart<'_>, place: &str, wanted: &str) -> Option<Vec<u8>> {
    use mail_parser::PartKind;
    let own = if place.is_empty() {
        "1".to_string()
    } else {
        place.to_string()
    };
    match part.kind() {
        PartKind::Multipart => part.children().enumerate().find_map(|(index, child)| {
            let at = if place.is_empty() {
                (index + 1).to_string()
            } else {
                format!("{place}.{}", index + 1)
            };
            find(child, &at, wanted)
        }),
        PartKind::Message(nested) => {
            if own == wanted {
                return Some(part.raw_body().to_vec());
            }
            let root = nested.root_part();
            if matches!(root.kind(), PartKind::Multipart) {
                find(root, &own, wanted)
            } else {
                find(root, &format!("{own}.1"), wanted)
            }
        }
        _ => (own == wanted).then(|| part.raw_body().to_vec()),
    }
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

/// A message of a text part, an HTML part and a PDF of `file` bytes: over
/// the size a test fetches whole when `file` is large.
pub fn large_message(id: u32, subject: &str, words: &str, file: usize) -> Vec<u8> {
    let mut pdf = b"%PDF-1.4\n".to_vec();
    pdf.resize(file.max(pdf.len()), b'x');
    let mut encoded = String::new();
    for chunk in pdf.chunks(57) {
        encoded.push_str(&base64(chunk));
        encoded.push_str("\r\n");
    }
    format!(
        "From: Sender {id} <sender{id}@example.org>\r\n\
         To: person@example.com\r\n\
         Subject: {subject}\r\n\
         Date: Mon, 2 Mar 2026 10:{:02}:00 +0000\r\n\
         Message-ID: <m{id}@example.org>\r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: multipart/mixed; boundary=\"outer\"\r\n\
         \r\n\
         --outer\r\n\
         Content-Type: multipart/alternative; boundary=\"inner\"\r\n\
         \r\n\
         --inner\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         \r\n\
         {words}\r\n\
         --inner\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         \r\n\
         <p>{words}</p><p style=\"display:none\">unseen</p>\r\n\
         --inner--\r\n\
         \r\n\
         --outer\r\n\
         Content-Type: application/octet-stream; name=\"plan.pdf\"\r\n\
         Content-Disposition: attachment; filename=\"plan.pdf\"\r\n\
         Content-Transfer-Encoding: base64\r\n\
         \r\n\
         {encoded}\
         --outer--\r\n",
        id % 60
    )
    .into_bytes()
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(TABLE[((n >> (18 - 6 * i)) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A message over a test's whole limit with a forwarded message inside it,
/// and file names as mail clients write them: an RFC 2047 encoded word and
/// an RFC 2231 value.
pub fn forwarding_message(id: u32, file: usize) -> Vec<u8> {
    let mut pdf = b"%PDF-1.4\n".to_vec();
    pdf.resize(file.max(pdf.len()), b'y');
    let mut encoded = String::new();
    for chunk in pdf.chunks(57) {
        encoded.push_str(&base64(chunk));
        encoded.push_str("\r\n");
    }
    format!(
        "From: Sender {id} <sender{id}@example.org>\r\n\
         To: person@example.com\r\n\
         Subject: Forwarded seeds\r\n\
         Date: Mon, 2 Mar 2026 10:{:02}:00 +0000\r\n\
         Message-ID: <f{id}@example.org>\r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: multipart/mixed; boundary=\"outer\"\r\n\
         \r\n\
         --outer\r\n\
         Content-Type: text/plain; charset=utf-8; format=flowed\r\n\
         \r\n\
         see the seed list below\r\n\
         --outer\r\n\
         Content-Type: application/pdf; name=\"=?UTF-8?B?w6l0w6kucGRm?=\"\r\n\
         Content-Disposition: attachment\r\n\
         Content-Transfer-Encoding: base64\r\n\
         \r\n\
         {encoded}\
         --outer\r\n\
         Content-Type: message/rfc822\r\n\
         Content-Disposition: attachment\r\n\
         \r\n\
         From: Grower <grower@example.org>\r\n\
         Subject: The list\r\n\
         Content-Type: multipart/mixed; boundary=\"inner\"\r\n\
         \r\n\
         --inner\r\n\
         Content-Type: text/plain\r\n\
         \r\n\
         tomatoes and beans\r\n\
         --inner\r\n\
         Content-Type: application/pdf\r\n\
         Content-Disposition: attachment; filename*=utf-8''%C3%A9t%C3%A9%20list.pdf\r\n\
         \r\n\
         %PDF-1.4 list\r\n\
         --inner--\r\n\
         \r\n\
         --outer--\r\n",
        id % 60
    )
    .into_bytes()
}
