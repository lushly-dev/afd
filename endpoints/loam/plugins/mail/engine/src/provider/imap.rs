//! The provider interface over IMAP (the specification's section 5.2).
//!
//! `async-imap` frames the connection and `imap-proto` parses each response;
//! the engine writes its own commands and reads every response itself, so
//! that nothing the server says is set aside unread. Only these commands are
//! sent: `CAPABILITY`, `LOGIN`, `ENABLE`, `LIST`, `EXAMINE`, `UID SEARCH`,
//! `UID FETCH` with `BODY.PEEK`, and `LOGOUT`. None of them can change a
//! mailbox: a mailbox is opened with `EXAMINE`, never `SELECT`, and a message
//! is read with `BODY.PEEK`, which leaves `\Seen` as it was.

use std::collections::HashSet;
use std::fmt;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use async_imap::imap_proto::{
    AttributeValue, Capability, MailboxDatum, MessageSection, NameAttribute, Response,
    ResponseCode, SectionPath, Status,
};
use async_imap::{Client, Session};
use async_trait::async_trait;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;

use super::{
    Changes, Connector, Fetched, FlagsSeen, Gone, Listing, Opened, Provider, ProviderError,
    RemoteMailbox, Since,
};
use crate::store::{AccountRow, HeaderSeen, Role};

/// Where a provider's IMAP server listens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    /// The host name.
    pub host: String,
    /// The port.
    pub port: u16,
    /// Whether the connection starts with TLS. Only the test doubles do
    /// without.
    pub tls: bool,
}

impl Endpoint {
    /// iCloud's IMAP server.
    #[must_use]
    pub fn icloud() -> Self {
        Self {
            host: "imap.mail.me.com".to_string(),
            port: 993,
            tls: true,
        }
    }
}

/// iCloud's mailboxes that carry no special-use flag, by the names iCloud
/// gives them (the specification's section 5.1). It flags only its sent and
/// trash mailboxes; the census saw the rest.
pub const ICLOUD_NAMES: &[(&str, Role)] = &[
    ("Sent Messages", Role::Sent),
    ("Deleted Messages", Role::Trash),
    ("Junk", Role::Junk),
    ("Archive", Role::Archive),
];

/// A sign-in. Its `Debug` hides the password.
#[derive(Clone, PartialEq, Eq)]
pub struct Credentials {
    /// The user name the server expects: for iCloud, the address.
    pub user: String,
    /// The password: for iCloud, an app-specific password.
    pub password: String,
}

impl fmt::Debug for Credentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Credentials").finish_non_exhaustive()
    }
}

/// How long the engine waits for the server to say anything before it
/// takes the connection for dead.
const SILENCE: Duration = Duration::from_secs(120);

/// How long it waits to connect.
const CONNECT: Duration = Duration::from_secs(30);

/// The most ids one reply may name once its ranges are spelled out. A
/// mailbox with more is beyond anything the engine was measured on.
const MOST_IDS: usize = 5_000_000;

/// A connection to an IMAP server, signed in.
pub struct Imap {
    session: Session<Stream>,
    condstore: bool,
    qresync: bool,
    names: &'static [(&'static str, Role)],
    open: Option<Examined>,
}

impl fmt::Debug for Imap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Imap")
            .field("condstore", &self.condstore)
            .field("qresync", &self.qresync)
            .finish_non_exhaustive()
    }
}

/// What `EXAMINE` said about the open mailbox.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Examined {
    key: String,
    validity: u32,
    uid_next: Option<u32>,
    modseq: Option<u64>,
}

impl Imap {
    /// Connects, signs in, and turns on what the engine uses of the
    /// server's extensions.
    ///
    /// # Errors
    /// [`ProviderError::SignIn`] when the server refuses the credentials, and
    /// [`ProviderError::Unavailable`] when it cannot be reached.
    pub async fn connect(
        endpoint: &Endpoint,
        credentials: &Credentials,
        names: &'static [(&'static str, Role)],
    ) -> Result<Self, ProviderError> {
        let tcp = within(
            CONNECT,
            TcpStream::connect((endpoint.host.as_str(), endpoint.port)),
        )
        .await
        .map_err(|_| ProviderError::Unavailable("the server could not be reached"))?;
        let stream = if endpoint.tls {
            Stream::Tls(Box::new(tls(&endpoint.host, tcp).await?))
        } else {
            Stream::Plain(tcp)
        };
        let mut client = Client::new(stream);
        match within(SILENCE, client.read_response()).await {
            Ok(Some(greeting)) if greets(greeting.parsed()) => {}
            _ => return Err(ProviderError::Unavailable("the server did not greet")),
        }
        let session = match within(SILENCE, async {
            client
                .login(&credentials.user, &credentials.password)
                .await
                .map_err(|(error, _)| error)
        })
        .await
        {
            Ok(session) => session,
            Err(None) => return Err(ProviderError::Unavailable("the server stopped answering")),
            // The reply is read for its code only; its text is never kept.
            Err(Some(async_imap::error::Error::No(reply))) if reply.contains("[UNAVAILABLE]") => {
                return Err(ProviderError::Unavailable(
                    "the server is not taking sign-ins now",
                ));
            }
            Err(Some(async_imap::error::Error::No(_))) => return Err(ProviderError::SignIn),
            Err(Some(async_imap::error::Error::Bad(_))) => {
                return Err(ProviderError::Refused("the server refused to sign in"));
            }
            Err(Some(_)) => return Err(ProviderError::Unavailable("the connection failed")),
        };
        let mut imap = Self {
            session,
            condstore: false,
            qresync: false,
            names,
            open: None,
        };
        let (mut condstore, mut qresync) = (false, false);
        imap.command("CAPABILITY", "listing its capabilities", |response| {
            if let Response::Capabilities(list) = response {
                for capability in list {
                    if let Capability::Atom(atom) = capability {
                        condstore |= atom.eq_ignore_ascii_case("CONDSTORE");
                        qresync |= atom.eq_ignore_ascii_case("QRESYNC");
                    }
                }
            }
        })
        .await?;
        // QRESYNC implies CONDSTORE (RFC 7162, section 3.2.3).
        imap.condstore = condstore || qresync;
        imap.qresync = qresync;
        if qresync {
            imap.command("ENABLE QRESYNC", "turning on QRESYNC", |_| {})
                .await?;
        }
        Ok(imap)
    }

    /// Whether the server offers CONDSTORE and QRESYNC.
    #[must_use]
    pub fn extensions(&self) -> (bool, bool) {
        (self.condstore, self.qresync)
    }

    /// Sends one command and hands every untagged response to it to `each`,
    /// up to its tagged completion. `what` names the command in an error.
    async fn command(
        &mut self,
        command: &str,
        what: &'static str,
        mut each: impl FnMut(&Response<'_>) + Send,
    ) -> Result<(), ProviderError> {
        let tag = within(SILENCE, self.session.run_command(command))
            .await
            .map_err(|_| ProviderError::Unavailable("the connection failed"))?;
        loop {
            let response = match within(SILENCE, self.session.read_response()).await {
                Ok(Some(response)) => response,
                Ok(None) => {
                    return Err(ProviderError::Unavailable(
                        "the server closed the connection",
                    ));
                }
                Err(None) => {
                    return Err(ProviderError::Unavailable("the server stopped answering"));
                }
                Err(Some(_)) => return Err(ProviderError::Unavailable("the connection failed")),
            };
            match response.parsed() {
                Response::Done {
                    tag: done, status, ..
                } if *done == tag => {
                    return match status {
                        Status::Ok => Ok(()),
                        Status::No => Err(ProviderError::Refused(what)),
                        _ => Err(ProviderError::Protocol(what)),
                    };
                }
                Response::Data {
                    status: Status::Bye,
                    ..
                } => return Err(ProviderError::Unavailable("the server ended the session")),
                parsed => each(parsed),
            }
        }
    }

    /// The open mailbox, or an error when none is.
    fn examined(&self) -> Result<Examined, ProviderError> {
        self.open
            .clone()
            .ok_or(ProviderError::Protocol("no mailbox is open"))
    }

    /// `EXAMINE` with `parameters` after the name, and what the server said.
    async fn examine(&mut self, key: &str, parameters: &str) -> Result<Reply, ProviderError> {
        let command = format!("EXAMINE {}{parameters}", quoted(key)?);
        let mut reply = Reply::default();
        self.command(&command, "opening a mailbox", |response| {
            reply.read(response);
        })
        .await?;
        Ok(reply)
    }

    /// `UID FETCH` of `items` for the messages `ids` names, handing each
    /// `FETCH` response's attributes to `each` with the UIDs asked for.
    async fn fetch(
        &mut self,
        ids: &[String],
        items: &str,
        what: &'static str,
        mut each: impl FnMut(&HashSet<u32>, &[AttributeValue<'_>]) + Send,
    ) -> Result<(), ProviderError> {
        let mut uids = Vec::with_capacity(ids.len());
        for id in ids {
            uids.push(
                id.parse::<u32>()
                    .map_err(|_| ProviderError::Protocol("an id is not a UID"))?,
            );
        }
        if uids.is_empty() {
            return Ok(());
        }
        let wanted: HashSet<u32> = uids.iter().copied().collect();
        let command = format!("UID FETCH {} {items}", uid_set(&mut uids));
        self.command(&command, what, |response| {
            if let Response::Fetch(_, attributes) = response {
                each(&wanted, attributes);
            }
        })
        .await
    }

    /// `UID SEARCH` with `criteria`, as UIDs.
    async fn search(&mut self, criteria: &str) -> Result<Vec<u32>, ProviderError> {
        let mut uids = Vec::new();
        self.command(
            &format!("UID SEARCH {criteria}"),
            "listing a mailbox",
            |response| {
                if let Response::MailboxData(MailboxDatum::Search(found)) = response {
                    uids.extend_from_slice(found);
                }
            },
        )
        .await?;
        Ok(uids)
    }

    /// The flags of the UIDs below `next` that a `UID FETCH ... (UID FLAGS)`
    /// returns.
    async fn changed_flags(
        &mut self,
        command: &str,
        next: u32,
    ) -> Result<Vec<FlagsSeen>, ProviderError> {
        let mut reply = Reply::default();
        self.command(command, "reading flags", |response| reply.read(response))
            .await?;
        Ok(reply.flags_below(next))
    }
}

#[async_trait]
impl Provider for Imap {
    async fn mailboxes(&mut self) -> Result<Vec<RemoteMailbox>, ProviderError> {
        let mut listed: Vec<(String, Option<Role>)> = Vec::new();
        self.command("LIST \"\" \"*\"", "listing mailboxes", |response| {
            let Response::MailboxData(MailboxDatum::List(list)) = response else {
                return;
            };
            let mut role = None;
            let mut selectable = true;
            for attribute in &list.name_attributes {
                match attribute {
                    NameAttribute::NoSelect => selectable = false,
                    NameAttribute::Extension(name)
                        if name.eq_ignore_ascii_case("\\NonExistent") =>
                    {
                        selectable = false;
                    }
                    NameAttribute::All => role = Some(Role::All),
                    NameAttribute::Archive => role = Some(Role::Archive),
                    NameAttribute::Junk => role = Some(Role::Junk),
                    NameAttribute::Sent => role = Some(Role::Sent),
                    NameAttribute::Trash => role = Some(Role::Trash),
                    _ => {}
                }
            }
            if selectable {
                listed.push((list.name.to_string(), role));
            }
        })
        .await?;
        Ok(listed
            .into_iter()
            .map(|(key, role)| {
                let name = decode_mailbox_name(&key).unwrap_or_else(|| key.clone());
                let role = if key == "INBOX" {
                    Role::Inbox
                } else {
                    role.or_else(|| {
                        self.names
                            .iter()
                            .find(|(known, _)| known.eq_ignore_ascii_case(&name))
                            .map(|(_, role)| *role)
                    })
                    .unwrap_or(Role::None)
                };
                RemoteMailbox { key, name, role }
            })
            .collect())
    }

    async fn open(&mut self, mailbox: &str) -> Result<Opened, ProviderError> {
        self.open = None;
        // With QRESYNC turned on, the server reports mod-sequences on any
        // EXAMINE; with CONDSTORE alone, the parameter asks for them.
        let parameters = if self.condstore && !self.qresync {
            " (CONDSTORE)"
        } else {
            ""
        };
        let examined = self.examine(mailbox, parameters).await?.examined(mailbox)?;
        let validity = examined.validity.to_string();
        self.open = Some(examined);
        Ok(Opened { validity })
    }

    async fn list(&mut self) -> Result<Listing, ProviderError> {
        let examined = self.examined()?;
        let mut uids = self.search("ALL").await?;
        uids.sort_unstable_by(|a, b| b.cmp(a));
        uids.dedup();
        let next = examined
            .uid_next
            .unwrap_or_else(|| uids.first().map_or(1, |uid| uid.saturating_add(1)));
        Ok(Listing {
            ids: uids.iter().map(u32::to_string).collect(),
            cursor: cursor(next, examined.modseq),
        })
    }

    async fn changes(&mut self, since: &str) -> Result<Since, ProviderError> {
        let Some((next, modseq)) = parse_cursor(since) else {
            return Ok(Since::TooOld);
        };
        let mut examined = self.examined()?;
        // What the cursor covered: every UID below `next`.
        let covered = next > 1;
        let (gone, flags) = match (modseq, examined.modseq) {
            (Some(modseq), Some(_)) if self.qresync => {
                // Open the mailbox again, asking for what changed and what
                // vanished since the cursor (RFC 7162, section 3.2.5).
                let parameters = format!(" (QRESYNC ({} {modseq}))", examined.validity);
                let reply = self.examine(&examined.key, &parameters).await?;
                let again = reply.examined(&examined.key)?;
                if again.validity != examined.validity {
                    self.open = None;
                    return Ok(Since::NewGeneration);
                }
                let mut vanished = Vec::new();
                spell_out(&reply.vanished, next, &mut vanished)?;
                let flags = reply.flags_below(next);
                self.open = Some(again.clone());
                examined = again;
                (Gone::Named(vanished), flags)
            }
            (Some(modseq), Some(_)) if covered => {
                let flags = self
                    .changed_flags(
                        &format!(
                            "UID FETCH 1:{} (UID FLAGS) (CHANGEDSINCE {modseq})",
                            next - 1
                        ),
                        next,
                    )
                    .await?;
                // What remains is every UID the mailbox holds.
                let remaining = self.search("ALL").await?;
                (
                    Gone::Remaining(remaining.iter().map(u32::to_string).collect()),
                    flags,
                )
            }
            _ => {
                // No mod-sequences: read every message's flags. What remains
                // is what a search lists: a message the server lists and
                // never returns is missing from a FETCH, and has not left.
                let flags = self.flags().await?;
                let flags = flags
                    .into_iter()
                    .filter(|seen| seen.provider_id.parse::<u32>().is_ok_and(|uid| uid < next))
                    .collect();
                let remaining = self.search("ALL").await?;
                (
                    Gone::Remaining(remaining.iter().map(u32::to_string).collect()),
                    flags,
                )
            }
        };
        let added = if examined.uid_next.is_some_and(|now| now <= next) {
            Vec::new()
        } else {
            // `n:*` names the highest UID even when it is below `n`.
            let mut uids: Vec<u32> = self
                .search(&format!("UID {next}:*"))
                .await?
                .into_iter()
                .filter(|uid| *uid >= next)
                .collect();
            uids.sort_unstable_by(|a, b| b.cmp(a));
            uids.dedup();
            uids
        };
        let next_now = examined.uid_next.unwrap_or_else(|| {
            added
                .first()
                .map_or(next, |uid| uid.saturating_add(1).max(next))
        });
        Ok(Since::Changes(Changes {
            added: added.iter().map(u32::to_string).collect(),
            gone,
            flags,
            cursor: cursor(next_now, examined.modseq),
        }))
    }

    async fn flags(&mut self) -> Result<Vec<FlagsSeen>, ProviderError> {
        let examined = self.examined()?;
        let last = examined
            .uid_next
            .map_or(u32::MAX, |next| next.saturating_sub(1));
        if last == 0 {
            return Ok(Vec::new());
        }
        let mut reply = Reply::default();
        self.command(
            &format!("UID FETCH 1:{last} (UID FLAGS)"),
            "reading flags",
            |response| reply.read(response),
        )
        .await?;
        Ok(reply.flags_below(u32::MAX))
    }

    async fn headers(&mut self, ids: &[String]) -> Result<Vec<HeaderSeen>, ProviderError> {
        let mut seen = HashSet::new();
        let mut headers = Vec::new();
        self.fetch(
            ids,
            "(UID RFC822.SIZE INTERNALDATE FLAGS BODY.PEEK[HEADER])",
            "reading headers",
            |wanted, attributes| {
                let mut uid = None;
                let mut size = None;
                let mut date = None;
                let mut flags = Vec::new();
                let mut block = None;
                for attribute in attributes {
                    match attribute {
                        AttributeValue::Uid(value) => uid = Some(*value),
                        AttributeValue::Rfc822Size(value) => size = Some(*value),
                        AttributeValue::InternalDate(value) => date = internal_date(value),
                        AttributeValue::Flags(values) => flags = normal_flags(values),
                        AttributeValue::BodySection {
                            section: Some(SectionPath::Full(MessageSection::Header)),
                            data: Some(data),
                            ..
                        } => block = Some(data.to_vec()),
                        _ => {}
                    }
                }
                // A response without every item asked for is a flag update
                // the server sent on its own, not an answer.
                if let (Some(uid), Some(size), Some(block)) = (uid, size, block)
                    && wanted.contains(&uid)
                    && seen.insert(uid)
                {
                    headers.push(HeaderSeen {
                        provider_id: uid.to_string(),
                        provider_thread: None,
                        reported_size: u64::from(size),
                        internal_date: date,
                        flags,
                        header_block: block,
                    });
                }
            },
        )
        .await?;
        Ok(headers)
    }

    async fn messages(&mut self, ids: &[String]) -> Result<Vec<Fetched>, ProviderError> {
        let mut seen = HashSet::new();
        let mut messages = Vec::new();
        self.fetch(
            ids,
            "(UID BODY.PEEK[])",
            "reading messages",
            |wanted, attributes| {
                let mut uid = None;
                let mut bytes = None;
                for attribute in attributes {
                    match attribute {
                        AttributeValue::Uid(value) => uid = Some(*value),
                        AttributeValue::BodySection {
                            section: None,
                            data: Some(data),
                            ..
                        } => bytes = Some(data.to_vec()),
                        _ => {}
                    }
                }
                if let (Some(uid), Some(bytes)) = (uid, bytes)
                    && wanted.contains(&uid)
                    && seen.insert(uid)
                {
                    messages.push(Fetched {
                        provider_id: uid.to_string(),
                        bytes,
                    });
                }
            },
        )
        .await?;
        Ok(messages)
    }

    async fn close(&mut self) {
        let _ = within(
            Duration::from_secs(5),
            self.command("LOGOUT", "signing out", |_| {}),
        )
        .await;
    }
}

/// What the server said in reply to `EXAMINE` or a `FETCH` of flags.
#[derive(Debug, Default)]
struct Reply {
    validity: Option<u32>,
    uid_next: Option<u32>,
    modseq: Option<u64>,
    vanished: Vec<std::ops::RangeInclusive<u32>>,
    flags: Vec<(u32, Vec<String>)>,
}

impl Reply {
    fn read(&mut self, response: &Response<'_>) {
        match response {
            Response::Data { outcome, .. } => match outcome.code {
                Some(ResponseCode::UidValidity(value)) => self.validity = Some(value),
                Some(ResponseCode::UidNext(value)) => self.uid_next = Some(value),
                Some(ResponseCode::HighestModSeq(value)) => self.modseq = Some(value),
                _ => {}
            },
            Response::Vanished { uids, .. } => self.vanished.extend(uids.iter().cloned()),
            Response::Fetch(_, attributes) => {
                let mut uid = None;
                let mut flags = None;
                for attribute in attributes {
                    match attribute {
                        AttributeValue::Uid(value) => uid = Some(*value),
                        AttributeValue::Flags(values) => flags = Some(normal_flags(values)),
                        _ => {}
                    }
                }
                if let (Some(uid), Some(flags)) = (uid, flags) {
                    self.flags.push((uid, flags));
                }
            }
            _ => {}
        }
    }

    /// The open mailbox this reply describes. A mailbox without a
    /// generation cannot be synced.
    fn examined(&self, key: &str) -> Result<Examined, ProviderError> {
        Ok(Examined {
            key: key.to_string(),
            validity: self
                .validity
                .ok_or(ProviderError::Protocol("the mailbox has no UIDVALIDITY"))?,
            uid_next: self.uid_next,
            modseq: self.modseq,
        })
    }

    /// The flags of the UIDs below `next`, once each.
    fn flags_below(self, next: u32) -> Vec<FlagsSeen> {
        let mut seen = HashSet::new();
        self.flags
            .into_iter()
            .filter(|(uid, _)| *uid < next && seen.insert(*uid))
            .map(|(uid, flags)| FlagsSeen {
                provider_id: uid.to_string(),
                flags,
            })
            .collect()
    }
}

/// Finds the sign-in for an account.
pub type CredentialsFor = Box<dyn Fn(&AccountRow) -> Option<Credentials> + Send + Sync>;

/// Opens IMAP connections to accounts, with the credentials a function
/// supplies.
pub struct ImapConnector {
    endpoint: Endpoint,
    names: &'static [(&'static str, Role)],
    credentials: CredentialsFor,
}

impl fmt::Debug for ImapConnector {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ImapConnector")
            .field("endpoint", &self.endpoint)
            .finish_non_exhaustive()
    }
}

impl ImapConnector {
    /// A connector to `endpoint`, which knows the mailboxes `names` lists,
    /// signing in with what `credentials` returns for an account.
    pub fn new(
        endpoint: Endpoint,
        names: &'static [(&'static str, Role)],
        credentials: impl Fn(&AccountRow) -> Option<Credentials> + Send + Sync + 'static,
    ) -> Self {
        Self {
            endpoint,
            names,
            credentials: Box::new(credentials),
        }
    }
}

#[async_trait]
impl Connector for ImapConnector {
    async fn connect(&self, account: &AccountRow) -> Result<Box<dyn Provider>, ProviderError> {
        let credentials = (self.credentials)(account).ok_or(ProviderError::NoCredential)?;
        Ok(Box::new(
            Imap::connect(&self.endpoint, &credentials, self.names).await?,
        ))
    }
}

/// The connection, with or without TLS.
#[derive(Debug)]
enum Stream {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

impl AsyncRead for Stream {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_read(context, buffer),
            Self::Tls(stream) => Pin::new(stream.as_mut()).poll_read(context, buffer),
        }
    }
}

impl AsyncWrite for Stream {
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_write(context, bytes),
            Self::Tls(stream) => Pin::new(stream.as_mut()).poll_write(context, bytes),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_flush(context),
            Self::Tls(stream) => Pin::new(stream.as_mut()).poll_flush(context),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_shutdown(context),
            Self::Tls(stream) => Pin::new(stream.as_mut()).poll_shutdown(context),
        }
    }
}

/// Starts TLS on `tcp`, checking the server's certificate against the
/// operating system's roots.
async fn tls(
    host: &str,
    tcp: TcpStream,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, ProviderError> {
    let mut roots = rustls::RootCertStore::empty();
    let found = rustls_native_certs::load_native_certs();
    for certificate in found.certs {
        // A root the library cannot read is one fewer to trust.
        let _ = roots.add(certificate);
    }
    if roots.is_empty() {
        return Err(ProviderError::Unavailable(
            "the system's certificates could not be read",
        ));
    }
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| ProviderError::Unavailable("TLS could not be set up"))?
    .with_root_certificates(roots)
    .with_no_client_auth();
    let name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|_| ProviderError::Unavailable("the server's name is not valid"))?;
    within(
        CONNECT,
        tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp),
    )
    .await
    .map_err(|_| ProviderError::Unavailable("TLS with the server failed"))
}

/// Runs `work` for at most `limit`. `Err(None)` is the limit passing,
/// `Err(Some(error))` the work's own error.
async fn within<T, E>(
    limit: Duration,
    work: impl Future<Output = Result<T, E>>,
) -> Result<T, Option<E>> {
    match tokio::time::timeout(limit, work).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(Some(error)),
        Err(_) => Err(None),
    }
}

/// Whether the server's first words let the engine go on.
fn greets(greeting: &Response<'_>) -> bool {
    matches!(
        greeting,
        Response::Data {
            status: Status::Ok | Status::PreAuth,
            ..
        }
    )
}

/// A mailbox's name as an IMAP quoted string.
fn quoted(name: &str) -> Result<String, ProviderError> {
    if name.contains(['\r', '\n', '\0']) {
        return Err(ProviderError::Protocol("a mailbox's name cannot be sent"));
    }
    Ok(format!(
        "\"{}\"",
        name.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

/// The flags as the engine keeps them. The system flags are written one way
/// whatever case the server used, and `\Recent`, which belongs to a session
/// and not to the message, is left out.
fn normal_flags(values: &[std::borrow::Cow<'_, str>]) -> Vec<String> {
    let mut flags = Vec::with_capacity(values.len());
    for value in values {
        let Some(name) = value.strip_prefix('\\') else {
            flags.push(value.to_string());
            continue;
        };
        let canonical = match name.to_ascii_lowercase().as_str() {
            "recent" => continue,
            "seen" => "\\Seen",
            "answered" => "\\Answered",
            "flagged" => "\\Flagged",
            "deleted" => "\\Deleted",
            "draft" => "\\Draft",
            _ => {
                flags.push(value.to_string());
                continue;
            }
        };
        flags.push(canonical.to_string());
    }
    flags
}

/// Appends the UIDs below `next` in `ranges` to `ids`.
fn spell_out(
    ranges: &[std::ops::RangeInclusive<u32>],
    next: u32,
    ids: &mut Vec<String>,
) -> Result<(), ProviderError> {
    for range in ranges {
        let low = (*range.start()).min(*range.end()).max(1);
        let high = (*range.start())
            .max(*range.end())
            .min(next.saturating_sub(1));
        for uid in low..=high {
            if ids.len() >= MOST_IDS {
                return Err(ProviderError::Protocol("a reply named too many messages"));
            }
            ids.push(uid.to_string());
        }
    }
    Ok(())
}

/// UIDs as an IMAP set, with runs written as ranges: `1:3,7,9:12`.
fn uid_set(uids: &mut [u32]) -> String {
    uids.sort_unstable();
    let mut set = String::new();
    let mut index = 0;
    while index < uids.len() {
        let start = uids[index];
        let mut end = start;
        while index + 1 < uids.len() && uids[index + 1] <= end.saturating_add(1) {
            index += 1;
            end = uids[index];
        }
        if !set.is_empty() {
            set.push(',');
        }
        if start == end {
            set.push_str(&start.to_string());
        } else {
            set.push_str(&format!("{start}:{end}"));
        }
        index += 1;
    }
    set
}

/// The cursor: the next UID, and the highest mod-sequence when there is one.
fn cursor(next: u32, modseq: Option<u64>) -> String {
    match modseq {
        Some(modseq) => format!("{next} {modseq}"),
        None => format!("{next} -"),
    }
}

/// The cursor's parts, or `None` when it is not one this provider wrote.
fn parse_cursor(cursor: &str) -> Option<(u32, Option<u64>)> {
    let (next, modseq) = cursor.split_once(' ')?;
    let next = next.parse().ok()?;
    let modseq = match modseq {
        "-" => None,
        other => Some(other.parse().ok()?),
    };
    Some((next, modseq))
}

/// An `INTERNALDATE` (`17-Jul-1996 02:44:25 -0700`) in milliseconds since
/// the epoch.
fn internal_date(text: &str) -> Option<i64> {
    let text = text.trim();
    let (date, rest) = text.split_once(' ')?;
    let (time, zone) = rest.trim().split_once(' ')?;
    let mut date = date.split('-');
    let day: i64 = date.next()?.trim().parse().ok()?;
    let month = date.next()?;
    let year: i64 = date.next()?.parse().ok()?;
    let month = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ]
    .iter()
    .position(|name| name.eq_ignore_ascii_case(month))?;
    let mut time = time.split(':');
    let hour: i64 = time.next()?.parse().ok()?;
    let minute: i64 = time.next()?.parse().ok()?;
    let second: i64 = time.next()?.parse().ok()?;
    let (sign, zone) = match zone.as_bytes().first()? {
        b'+' => (1, &zone[1..]),
        b'-' => (-1, &zone[1..]),
        _ => return None,
    };
    if zone.len() != 4 || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let offset: i64 = zone[..2].parse::<i64>().ok()? * 60 + zone[2..].parse::<i64>().ok()?;
    let month = i64::try_from(month).ok()? + 1;
    let days = days_from_civil(year, month, day);
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second - sign * offset * 60;
    Some(seconds * 1_000)
}

/// Days since 1970-01-01 of a date in the proleptic Gregorian calendar.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// A mailbox's name decoded from IMAP's modified UTF-7 (RFC 3501, section
/// 5.1.3), or `None` when it is not valid.
fn decode_mailbox_name(name: &str) -> Option<String> {
    let mut decoded = String::with_capacity(name.len());
    let mut rest = name;
    while let Some(at) = rest.find('&') {
        decoded.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        let end = after.find('-')?;
        if end == 0 {
            decoded.push('&');
        } else {
            let units = modified_base64(&after[..end])?;
            decoded.push_str(&String::from_utf16(&units).ok()?);
        }
        rest = &after[end + 1..];
    }
    decoded.push_str(rest);
    Some(decoded)
}

/// UTF-16 code units from modified base64, which writes `,` for `/` and
/// leaves out the padding.
fn modified_base64(text: &str) -> Option<Vec<u16>> {
    let mut bits = 0u32;
    let mut count = 0;
    let mut bytes = Vec::new();
    for character in text.bytes() {
        let value = match character {
            b'A'..=b'Z' => character - b'A',
            b'a'..=b'z' => character - b'a' + 26,
            b'0'..=b'9' => character - b'0' + 52,
            b'+' => 62,
            b',' => 63,
            _ => return None,
        };
        bits = (bits << 6) | u32::from(value);
        count += 6;
        if count >= 8 {
            count -= 8;
            bytes.push(u8::try_from((bits >> count) & 0xff).ok()?);
        }
    }
    if bytes.len() % 2 != 0 {
        return None;
    }
    Some(
        bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_be_bytes(*pair))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_internal_date_is_read_with_its_zone() {
        // 1996-07-17T09:44:25Z.
        assert_eq!(
            internal_date("17-Jul-1996 02:44:25 -0700"),
            Some(837_596_665_000)
        );
        assert_eq!(
            internal_date(" 1-Jan-1970 00:00:00 +0000"),
            Some(0),
            "a day of one digit is written with a space"
        );
        assert_eq!(internal_date("1-Foo-1970 00:00:00 +0000"), None);
        assert_eq!(internal_date("nonsense"), None);
    }

    #[test]
    fn uids_are_written_as_ranges() {
        assert_eq!(uid_set(&mut [9, 1, 2, 3, 7, 10, 12, 11]), "1:3,7,9:12");
        assert_eq!(uid_set(&mut [5]), "5");
        assert_eq!(uid_set(&mut [4, 4, 5]), "4:5");
    }

    #[test]
    fn a_cursor_reads_back() {
        assert_eq!(parse_cursor(&cursor(41, Some(900))), Some((41, Some(900))));
        assert_eq!(parse_cursor(&cursor(41, None)), Some((41, None)));
        assert_eq!(parse_cursor("history 12"), None);
    }

    #[test]
    fn mailbox_names_are_decoded_from_modified_utf7() {
        assert_eq!(
            decode_mailbox_name("Entw&APw-rfe").as_deref(),
            Some("Entwürfe")
        );
        assert_eq!(decode_mailbox_name("A&-B").as_deref(), Some("A&B"));
        assert_eq!(decode_mailbox_name("&ZeVnLIqe-").as_deref(), Some("日本語"));
        assert_eq!(decode_mailbox_name("broken&abc"), None);
    }

    #[test]
    fn system_flags_are_written_one_way_and_recent_is_dropped() {
        let raw: Vec<std::borrow::Cow<'_, str>> = vec![
            "\\SEEN".into(),
            "\\Recent".into(),
            "$Junk".into(),
            "\\flagged".into(),
        ];
        assert_eq!(normal_flags(&raw), vec!["\\Seen", "$Junk", "\\Flagged"]);
    }

    #[test]
    fn vanished_ranges_stop_below_the_cursor() {
        let mut ids = Vec::new();
        spell_out(&[3..=5, 9..=40], 10, &mut ids).unwrap();
        assert_eq!(ids, vec!["3", "4", "5", "9"]);
    }
}
