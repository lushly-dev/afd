//! Sending mail over SMTP (the specification's 9.5).
//!
//! Speaks SMTP submission (RFC 5321, RFC 4954) over STARTTLS (iCloud's port
//! 587), implicit TLS, or plain TCP on loopback for tests. Every error is in
//! the engine's own words: no text from the server's reply is kept, because
//! a reply may quote a recipient or a header.
//!
//! A send that ends before the final dot (`\r\n.\r\n`) is handed over, or
//! that the server refuses with a 4xx or 5xx reply, is [`SendOutcome::Failed`]:
//! nothing was sent, and the draft stays open. A connection that drops or
//! times out after the final dot is handed over is [`SendOutcome::Unknown`]:
//! the message may or may not have gone, and the engine never retries it.

use std::fmt;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, ReadBuf};
use tokio::net::TcpStream;

use super::ProviderError;
use super::imap::{Credentials, tls};
use crate::store::AccountRow;

/// How long the engine waits to connect to the SMTP server.
const CONNECT: Duration = Duration::from_secs(30);
/// How long the engine waits for a reply line from the SMTP server.
const SILENCE: Duration = Duration::from_secs(60);
/// The most lines read for one multiline SMTP reply, so a hostile server
/// cannot hold memory or spin forever.
const MOST_REPLY_LINES: usize = 64;
/// The longest single SMTP reply line read.
const MOST_LINE_BYTES: usize = 4096;

/// How an SMTP connection uses TLS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsMode {
    /// Plain TCP, for the scripted SMTP server on loopback only.
    Plain,
    /// Connects plain and upgrades with `STARTTLS` before authentication
    /// (iCloud's port 587).
    StartTls,
    /// Starts TLS immediately (implicit TLS, port 465).
    Implicit,
}

/// Where a provider's SMTP submission server listens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmtpEndpoint {
    /// The host name.
    pub host: String,
    /// The port.
    pub port: u16,
    /// How the connection uses TLS.
    pub tls: TlsMode,
}

impl SmtpEndpoint {
    /// iCloud's SMTP submission server (`smtp.mail.me.com:587` with STARTTLS).
    #[must_use]
    pub fn icloud() -> Self {
        Self {
            host: "smtp.mail.me.com".to_string(),
            port: 587,
            tls: TlsMode::StartTls,
        }
    }

    /// A plain TCP endpoint on `host:port`, for tests on loopback.
    #[must_use]
    pub fn plain(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
            tls: TlsMode::Plain,
        }
    }
}

/// The outcome of handing one message to an SMTP server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutcome {
    /// The server accepted the message (2xx after `DATA`).
    Sent,
    /// The message was definitely not sent: the server refused it, or the
    /// connection failed before handover.
    Failed(ProviderError),
    /// The connection ended or timed out after the message was handed over:
    /// whether it was sent is not known, and it is never retried.
    Unknown(&'static str),
}

/// Sends an assembled RFC 5322 message for an account.
#[async_trait]
pub trait MailSender: Send + Sync {
    /// Sends `message` for `account` from `envelope_from` to every address
    /// in `envelope_to`.
    async fn send(
        &self,
        account: &AccountRow,
        envelope_from: &str,
        envelope_to: &[String],
        message: &[u8],
    ) -> SendOutcome;
}

/// Looks up credentials for an account when sending.
type Lookup = Arc<dyn Fn(&AccountRow) -> Result<Credentials, ProviderError> + Send + Sync>;

/// Sends mail for an account over SMTP using [`SmtpEndpoint`].
pub struct SmtpSender {
    endpoint: SmtpEndpoint,
    credentials: Lookup,
}

impl fmt::Debug for SmtpSender {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SmtpSender")
            .field("endpoint", &self.endpoint)
            .finish_non_exhaustive()
    }
}

impl SmtpSender {
    /// Builds an SMTP sender to `endpoint`, reading each account's sign-in
    /// through `credentials`.
    #[must_use]
    pub fn new(
        endpoint: SmtpEndpoint,
        credentials: impl Fn(&AccountRow) -> Result<Credentials, ProviderError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            endpoint,
            credentials: Arc::new(credentials),
        }
    }
}

#[async_trait]
impl MailSender for SmtpSender {
    async fn send(
        &self,
        account: &AccountRow,
        envelope_from: &str,
        envelope_to: &[String],
        message: &[u8],
    ) -> SendOutcome {
        if account.provider != "icloud" {
            return SendOutcome::Failed(ProviderError::Refused(
                "sending is not built for this provider yet",
            ));
        }
        let credentials = match (self.credentials)(account) {
            Ok(credentials) => credentials,
            Err(error) => return SendOutcome::Failed(error),
        };
        send_smtp(
            &self.endpoint,
            &credentials,
            envelope_from,
            envelope_to,
            message,
        )
        .await
    }
}

/// One SMTP stream: plain TCP or TLS.
enum SmtpStream {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

impl AsyncRead for SmtpStream {
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

impl AsyncWrite for SmtpStream {
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

/// An SMTP reply code and its lines (used only to read `EHLO` capabilities,
/// never returned in errors).
struct Reply {
    code: u16,
    lines: Vec<String>,
}

/// Reads one complete SMTP reply (single or multiline).
///
/// Parses the 3-digit status code and continuation marker directly from raw
/// bytes so malformed or non-UTF-8 network input can never panic on a UTF-8
/// char boundary.
async fn read_reply(reader: &mut BufReader<SmtpStream>) -> Result<Reply, ProviderError> {
    let mut code = None;
    let mut lines = Vec::new();
    for _ in 0..MOST_REPLY_LINES {
        let mut line = Vec::new();
        let read = tokio::time::timeout(SILENCE, read_bounded_line(reader, &mut line)).await;
        match read {
            Err(_) => return Err(ProviderError::Unavailable("the server stopped answering")),
            Ok(Err(_)) => return Err(ProviderError::Unavailable("the connection failed")),
            Ok(Ok(0)) => {
                return Err(ProviderError::Unavailable(
                    "the server closed the connection",
                ));
            }
            Ok(Ok(_)) => {}
        }
        let mut trimmed = line.as_slice();
        while let Some(&last) = trimmed.last() {
            if last == b'\r' || last == b'\n' {
                trimmed = &trimmed[..trimmed.len() - 1];
            } else {
                break;
            }
        }
        if trimmed.len() < 3 {
            return Err(ProviderError::Protocol(
                "the server's reply was too short to read",
            ));
        }
        if !trimmed[..3].iter().all(u8::is_ascii_digit) {
            return Err(ProviderError::Protocol(
                "the server's reply had no status code",
            ));
        }
        let parsed = u16::from(trimmed[0] - b'0') * 100
            + u16::from(trimmed[1] - b'0') * 10
            + u16::from(trimmed[2] - b'0');
        if let Some(expected) = code
            && parsed != expected
        {
            return Err(ProviderError::Protocol(
                "the server changed its status code mid-reply",
            ));
        }
        code = Some(parsed);
        let sep = trimmed.get(3).copied();
        let body = trimmed
            .get(4..)
            .map(|rest| String::from_utf8_lossy(rest).into_owned())
            .unwrap_or_default();
        lines.push(body);
        match sep {
            Some(b'-') => continue,
            Some(b' ') | None => {
                return Ok(Reply {
                    code: parsed,
                    lines,
                });
            }
            Some(_) => {
                return Err(ProviderError::Protocol(
                    "the server's reply could not be read",
                ));
            }
        }
    }
    Err(ProviderError::Protocol(
        "the server's reply had too many lines",
    ))
}

/// Reads up to `\n`, refusing lines longer than [`MOST_LINE_BYTES`] and
/// rejecting an EOF partway through a line without a terminating `\n`.
async fn read_bounded_line(
    reader: &mut BufReader<SmtpStream>,
    out: &mut Vec<u8>,
) -> std::io::Result<usize> {
    let mut total = 0;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if total == 0 {
                return Ok(0);
            }
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "truncated SMTP reply line",
            ));
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |pos| pos + 1);
        if total + take > MOST_LINE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "SMTP line too long",
            ));
        }
        out.extend_from_slice(&available[..take]);
        reader.consume(take);
        total += take;
        if newline.is_some() {
            return Ok(total);
        }
    }
}

/// Writes one command line and flushes.
async fn write_command(
    reader: &mut BufReader<SmtpStream>,
    command: &str,
) -> Result<(), ProviderError> {
    let stream = reader.get_mut();
    tokio::time::timeout(SILENCE, async {
        stream.write_all(command.as_bytes()).await?;
        stream.write_all(b"\r\n").await?;
        stream.flush().await
    })
    .await
    .map_err(|_| ProviderError::Unavailable("the server stopped answering"))?
    .map_err(|_| ProviderError::Unavailable("the connection failed"))
}

/// Maps a non-2xx SMTP reply code to a [`ProviderError`] in the engine's words.
fn smtp_error(code: u16, what: &'static str) -> ProviderError {
    match code {
        530 | 534 | 535 => ProviderError::SignIn,
        452 => ProviderError::Limit("the provider's sending limit was reached"),
        552 => ProviderError::Refused("the message exceeded the provider's size or storage limit"),
        400..=499 => ProviderError::Unavailable(what),
        500..=599 => ProviderError::Refused(what),
        _ => ProviderError::Protocol(what),
    }
}

/// Whether `address` is safe inside an SMTP `<...>` reverse/forward path.
fn safe_path(address: &str) -> bool {
    !address.is_empty()
        && address.len() <= 254
        && address.contains('@')
        && address
            .bytes()
            .all(|byte| matches!(byte, 0x21..=0x7E) && !matches!(byte, b'<' | b'>'))
}

/// Parses `EHLO` lines for `STARTTLS` and `AUTH` mechanisms.
struct Capabilities {
    starttls: bool,
    auth_plain: bool,
    auth_login: bool,
}

fn parse_capabilities(lines: &[String]) -> Capabilities {
    let mut caps = Capabilities {
        starttls: false,
        auth_plain: false,
        auth_login: false,
    };
    for line in lines.iter().skip(1) {
        let upper = line.to_ascii_uppercase();
        let mut parts = upper.split_whitespace();
        match parts.next() {
            Some("STARTTLS") => caps.starttls = true,
            Some("AUTH") => {
                for mech in parts {
                    if mech == "PLAIN" {
                        caps.auth_plain = true;
                    } else if mech == "LOGIN" {
                        caps.auth_login = true;
                    }
                }
            }
            Some(first) if first.starts_with("AUTH=") => {
                for mech in first
                    .trim_start_matches("AUTH=")
                    .split_whitespace()
                    .chain(parts)
                {
                    if mech == "PLAIN" {
                        caps.auth_plain = true;
                    } else if mech == "LOGIN" {
                        caps.auth_login = true;
                    }
                }
            }
            _ => {}
        }
    }
    caps
}

/// Sends one message over SMTP.
async fn send_smtp(
    endpoint: &SmtpEndpoint,
    credentials: &Credentials,
    envelope_from: &str,
    envelope_to: &[String],
    message: &[u8],
) -> SendOutcome {
    if !safe_path(envelope_from)
        || envelope_to.is_empty()
        || !envelope_to.iter().all(|addr| safe_path(addr))
    {
        return SendOutcome::Failed(ProviderError::Protocol(
            "an envelope address cannot be sent over SMTP",
        ));
    }
    if endpoint.tls == TlsMode::Plain {
        let loopback = endpoint
            .host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
        if !loopback {
            return SendOutcome::Failed(ProviderError::Refused(
                "plain SMTP without TLS is allowed only on a loopback address",
            ));
        }
    }

    let tcp = match tokio::time::timeout(
        CONNECT,
        TcpStream::connect((endpoint.host.as_str(), endpoint.port)),
    )
    .await
    {
        Ok(Ok(tcp)) => tcp,
        _ => {
            return SendOutcome::Failed(ProviderError::Unavailable(
                "the SMTP server could not be reached",
            ));
        }
    };

    let stream = match endpoint.tls {
        TlsMode::Implicit => match tls(&endpoint.host, tcp).await {
            Ok(tls_stream) => SmtpStream::Tls(Box::new(tls_stream)),
            Err(error) => return SendOutcome::Failed(error),
        },
        TlsMode::Plain | TlsMode::StartTls => SmtpStream::Plain(tcp),
    };

    let mut reader = BufReader::new(stream);

    // 1. Greeting.
    match read_reply(&mut reader).await {
        Ok(reply) if reply.code == 220 => {}
        Ok(reply) => {
            return SendOutcome::Failed(smtp_error(reply.code, "the SMTP server refused"));
        }
        Err(error) => return SendOutcome::Failed(error),
    }

    // 2. EHLO.
    if let Err(error) = write_command(&mut reader, "EHLO loam-mail.local").await {
        return SendOutcome::Failed(error);
    }
    let mut caps = match read_reply(&mut reader).await {
        Ok(reply) if reply.code == 250 => parse_capabilities(&reply.lines),
        Ok(reply) => {
            return SendOutcome::Failed(smtp_error(reply.code, "the SMTP server refused EHLO"));
        }
        Err(error) => return SendOutcome::Failed(error),
    };

    // 3. STARTTLS when configured.
    if endpoint.tls == TlsMode::StartTls {
        if !caps.starttls {
            return SendOutcome::Failed(ProviderError::Refused(
                "the SMTP server does not offer STARTTLS",
            ));
        }
        if let Err(error) = write_command(&mut reader, "STARTTLS").await {
            return SendOutcome::Failed(error);
        }
        match read_reply(&mut reader).await {
            Ok(reply) if reply.code == 220 => {}
            Ok(reply) => {
                return SendOutcome::Failed(smtp_error(
                    reply.code,
                    "the SMTP server refused STARTTLS",
                ));
            }
            Err(error) => return SendOutcome::Failed(error),
        }
        // RFC 3207: discard any buffered plaintext bytes (none should exist) and upgrade.
        if !reader.buffer().is_empty() {
            return SendOutcome::Failed(ProviderError::Protocol(
                "the SMTP server sent unexpected bytes before TLS",
            ));
        }
        let SmtpStream::Plain(tcp) = reader.into_inner() else {
            return SendOutcome::Failed(ProviderError::Protocol("TLS already active"));
        };
        let tls_stream = match tls(&endpoint.host, tcp).await {
            Ok(tls_stream) => tls_stream,
            Err(error) => return SendOutcome::Failed(error),
        };
        reader = BufReader::new(SmtpStream::Tls(Box::new(tls_stream)));
        if let Err(error) = write_command(&mut reader, "EHLO loam-mail.local").await {
            return SendOutcome::Failed(error);
        }
        caps = match read_reply(&mut reader).await {
            Ok(reply) if reply.code == 250 => parse_capabilities(&reply.lines),
            Ok(reply) => {
                return SendOutcome::Failed(smtp_error(
                    reply.code,
                    "the SMTP server refused EHLO after TLS",
                ));
            }
            Err(error) => return SendOutcome::Failed(error),
        };
    }

    // 4. AUTH (PLAIN preferred, LOGIN fallback).
    if let Err(error) = authenticate(&mut reader, &caps, credentials).await {
        return SendOutcome::Failed(error);
    }

    // 5. MAIL FROM.
    if let Err(error) = write_command(&mut reader, &format!("MAIL FROM:<{envelope_from}>")).await {
        return SendOutcome::Failed(error);
    }
    match read_reply(&mut reader).await {
        Ok(reply) if reply.code == 250 => {}
        Ok(reply) => {
            return SendOutcome::Failed(smtp_error(
                reply.code,
                "the SMTP server refused the sender",
            ));
        }
        Err(error) => return SendOutcome::Failed(error),
    }

    // 6. RCPT TO for each deduplicated recipient.
    for recipient in envelope_to {
        if let Err(error) = write_command(&mut reader, &format!("RCPT TO:<{recipient}>")).await {
            return SendOutcome::Failed(error);
        }
        match read_reply(&mut reader).await {
            Ok(reply) if matches!(reply.code, 250 | 251) => {}
            Ok(reply) => {
                return SendOutcome::Failed(smtp_error(
                    reply.code,
                    "the SMTP server refused a recipient",
                ));
            }
            Err(error) => return SendOutcome::Failed(error),
        }
    }

    // 7. DATA command -> 354.
    if let Err(error) = write_command(&mut reader, "DATA").await {
        return SendOutcome::Failed(error);
    }
    match read_reply(&mut reader).await {
        Ok(reply) if reply.code == 354 => {}
        Ok(reply) => {
            return SendOutcome::Failed(smtp_error(
                reply.code,
                "the SMTP server refused to take the message",
            ));
        }
        Err(error) => return SendOutcome::Failed(error),
    }

    // 8. Dot-stuffed body, then final terminator `.\r\n`.
    let stuffed = dot_stuff(message);
    let stream = reader.get_mut();
    let wrote_body = tokio::time::timeout(SILENCE, stream.write_all(&stuffed)).await;
    match wrote_body {
        Ok(Ok(())) => {}
        _ => {
            return SendOutcome::Failed(ProviderError::Unavailable(
                "the connection ended before the message was handed over",
            ));
        }
    }

    // Handover point: once we write `.\r\n`, any drop or timeout leaves the
    // outcome unknown (the specification's 9.5).
    let handed_over = tokio::time::timeout(SILENCE, async {
        stream.write_all(b".\r\n").await?;
        stream.flush().await
    })
    .await;
    if !matches!(handed_over, Ok(Ok(()))) {
        return SendOutcome::Unknown(
            "the connection ended as the message was handed over; whether it was sent is not known",
        );
    }

    let outcome = match read_reply(&mut reader).await {
        Ok(reply) if (200..=299).contains(&reply.code) => SendOutcome::Sent,
        Ok(reply) if (400..=599).contains(&reply.code) => SendOutcome::Failed(smtp_error(
            reply.code,
            "the SMTP server refused the message",
        )),
        Ok(_) => SendOutcome::Unknown(
            "the SMTP server gave an unexpected reply after handover; whether it was sent is not known",
        ),
        Err(_) => SendOutcome::Unknown(
            "the connection ended after the message was handed over; whether it was sent is not known",
        ),
    };

    // Polite QUIT, ignoring errors.
    let _ = tokio::time::timeout(Duration::from_secs(5), async {
        let _ = write_command(&mut reader, "QUIT").await;
        let _ = read_reply(&mut reader).await;
    })
    .await;

    outcome
}

/// Authenticates with `AUTH PLAIN` or `AUTH LOGIN`.
async fn authenticate(
    reader: &mut BufReader<SmtpStream>,
    caps: &Capabilities,
    credentials: &Credentials,
) -> Result<(), ProviderError> {
    if credentials.user.contains('\0') || credentials.password.contains('\0') {
        return Err(ProviderError::SignIn);
    }
    if caps.auth_plain || !caps.auth_login {
        let mut raw = Vec::with_capacity(credentials.user.len() + credentials.password.len() + 2);
        raw.push(0);
        raw.extend_from_slice(credentials.user.as_bytes());
        raw.push(0);
        raw.extend_from_slice(credentials.password.as_bytes());
        let encoded = base64_encode(&raw);
        write_command(reader, &format!("AUTH PLAIN {encoded}")).await?;
        let reply = read_reply(reader).await?;
        return match reply.code {
            235 => Ok(()),
            code => Err(smtp_error(code, "the SMTP server refused the sign-in")),
        };
    }
    write_command(reader, "AUTH LOGIN").await?;
    let reply = read_reply(reader).await?;
    if reply.code != 334 {
        return Err(smtp_error(reply.code, "the SMTP server refused AUTH LOGIN"));
    }
    write_command(reader, &base64_encode(credentials.user.as_bytes())).await?;
    let reply = read_reply(reader).await?;
    if reply.code != 334 {
        return Err(smtp_error(
            reply.code,
            "the SMTP server refused the sign-in",
        ));
    }
    write_command(reader, &base64_encode(credentials.password.as_bytes())).await?;
    let reply = read_reply(reader).await?;
    match reply.code {
        235 => Ok(()),
        code => Err(smtp_error(code, "the SMTP server refused the sign-in")),
    }
}

/// Dot-stuffs `message` for SMTP `DATA` (RFC 5321, 4.5.2) and guarantees it
/// ends with `\r\n`, ready for the final `.\r\n`.
#[must_use]
pub fn dot_stuff(message: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(message.len() + 32);
    let mut at_line_start = true;
    for &byte in message {
        if at_line_start && byte == b'.' {
            out.push(b'.');
        }
        out.push(byte);
        at_line_start = byte == b'\n';
    }
    if !out.ends_with(b"\r\n") {
        if out.ends_with(b"\n") {
            let len = out.len();
            out.insert(len - 1, b'\r');
        } else {
            out.extend_from_slice(b"\r\n");
        }
    }
    out
}

/// Inputs for assembling an RFC 5322 plain-text message from a draft.
#[derive(Debug, Clone)]
pub struct OutgoingMessage<'a> {
    /// Sender address (`From`).
    pub from: &'a str,
    /// `To` recipients.
    pub to: &'a [String],
    /// `Cc` recipients.
    pub cc: &'a [String],
    /// `Bcc` recipients (only emitted when `include_bcc` is true).
    pub bcc: &'a [String],
    /// Subject line (UTF-8, single line).
    pub subject: &'a str,
    /// Plain-text body (UTF-8).
    pub body: &'a str,
    /// Date in milliseconds since 1970-01-01T00:00:00Z.
    pub date_ms: i64,
    /// Message-ID without angle brackets (e.g. `abcd...@icloud.com`).
    pub message_id: &'a str,
    /// Optional `In-Reply-To` Message-ID (without angle brackets).
    pub in_reply_to: Option<&'a str>,
    /// Optional `References` Message-IDs (without angle brackets).
    pub references: &'a [String],
    /// Whether to include a `Bcc:` header (false for SMTP wire, true for Sent
    /// mailbox copy).
    pub include_bcc: bool,
}

/// Generates a random RFC 5322 `Message-ID` (without angle brackets) under
/// `from`'s domain.
///
/// # Errors
/// When the operating system's random source fails.
pub fn new_message_id(from: &str) -> Result<String, &'static str> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "no random source for the message id")?;
    let mut hex = String::with_capacity(32);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    let domain = from
        .rsplit_once('@')
        .map(|(_, domain)| domain.to_ascii_lowercase())
        .filter(|domain| !domain.is_empty() && safe_msg_id_part(domain))
        .unwrap_or_else(|| "loam-mail.local".to_string());
    Ok(format!("{hex}@{domain}"))
}

/// Assembles an RFC 5322 plain-text message with CRLF line endings, RFC 2047
/// subject encoding when needed, and quoted-printable UTF-8 body.
#[must_use]
pub fn build_message(msg: &OutgoingMessage<'_>) -> Vec<u8> {
    let mut out = String::with_capacity(msg.body.len() + 512);
    out.push_str("From: ");
    out.push_str(msg.from);
    out.push_str("\r\n");
    if !msg.to.is_empty() {
        push_address_header(&mut out, "To", msg.to);
    }
    if !msg.cc.is_empty() {
        push_address_header(&mut out, "Cc", msg.cc);
    }
    if msg.include_bcc && !msg.bcc.is_empty() {
        push_address_header(&mut out, "Bcc", msg.bcc);
    }
    out.push_str("Date: ");
    out.push_str(&rfc5322_date(msg.date_ms));
    out.push_str("\r\n");
    out.push_str("Message-ID: <");
    out.push_str(msg.message_id);
    out.push_str(">\r\n");
    if let Some(reply_to) = msg.in_reply_to.and_then(clean_message_id) {
        out.push_str("In-Reply-To: <");
        out.push_str(&reply_to);
        out.push_str(">\r\n");
    }
    let refs: Vec<String> = msg
        .references
        .iter()
        .filter_map(|id| clean_message_id(id))
        .collect();
    if !refs.is_empty() {
        out.push_str("References:");
        let mut line_len = "References:".len();
        for (index, reference) in refs.iter().enumerate() {
            let token_len = reference.len() + 3; // ` <id>`
            if index > 0 && line_len + token_len > 78 {
                out.push_str("\r\n <");
                out.push_str(reference);
                out.push('>');
                line_len = reference.len() + 3;
            } else {
                out.push_str(" <");
                out.push_str(reference);
                out.push('>');
                line_len += token_len;
            }
        }
        out.push_str("\r\n");
    }
    out.push_str("Subject: ");
    out.push_str(&encode_subject(msg.subject));
    out.push_str("\r\n");
    out.push_str("MIME-Version: 1.0\r\n");
    out.push_str("Content-Type: text/plain; charset=utf-8\r\n");
    out.push_str("Content-Transfer-Encoding: quoted-printable\r\n");
    out.push_str("\r\n");
    out.push_str(&encode_quoted_printable(msg.body));
    out.into_bytes()
}

/// Writes an address header (`To`, `Cc`, `Bcc`), folding long lists cleanly.
fn push_address_header(out: &mut String, name: &str, addresses: &[String]) {
    out.push_str(name);
    out.push_str(": ");
    let mut line_len = name.len() + 2;
    for (index, address) in addresses.iter().enumerate() {
        if index > 0 {
            out.push(',');
            line_len += 1;
            if line_len + 1 + address.len() > 78 {
                out.push_str("\r\n ");
                line_len = 1;
            } else {
                out.push(' ');
                line_len += 1;
            }
        }
        out.push_str(address);
        line_len += address.len();
    }
    out.push_str("\r\n");
}

/// Validates a Message-ID copied from an answered message so a hostile header
/// can never inject CR, LF or extra headers.
#[must_use]
pub fn clean_message_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches('<').trim_end_matches('>');
    if trimmed.is_empty() || trimmed.len() > 250 || !safe_msg_id_part(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

fn safe_msg_id_part(text: &str) -> bool {
    text.bytes()
        .all(|byte| matches!(byte, 0x21..=0x7E) && !matches!(byte, b'<' | b'>' | b'\\'))
}

/// Encodes a single-line UTF-8 subject for RFC 5322, using RFC 2047 UTF-8
/// Base64 encoded-words whenever it has non-ASCII characters, `=?`, or
/// exceeds 70 bytes.
#[must_use]
pub fn encode_subject(subject: &str) -> String {
    let plain_ascii = subject.len() <= 70
        && !subject.contains("=?")
        && subject
            .bytes()
            .all(|byte| byte == b'\t' || (0x20..=0x7E).contains(&byte));
    if plain_ascii {
        return subject.to_string();
    }
    // Each encoded-word is `=?UTF-8?B?<base64>?=` (12 bytes overhead).
    // 45 raw bytes -> 60 base64 chars -> 72 chars total (within RFC 2047's 75).
    let mut out = String::new();
    let mut start = 0;
    while start < subject.len() {
        let mut end = (start + 45).min(subject.len());
        while end > start && !subject.is_char_boundary(end) {
            end -= 1;
        }
        if !out.is_empty() {
            out.push_str("\r\n ");
        }
        out.push_str("=?UTF-8?B?");
        out.push_str(&base64_encode(&subject.as_bytes()[start..end]));
        out.push_str("?=");
        start = end;
    }
    out
}

/// Encodes a UTF-8 body with RFC 2045 quoted-printable, normalizing line
/// endings to CRLF and wrapping at 76 characters.
#[must_use]
pub fn encode_quoted_printable(body: &str) -> String {
    let mut out = String::with_capacity(body.len() + body.len() / 16 + 16);
    let normalized = body.replace("\r\n", "\n").replace('\r', "\n");
    for (index, line) in normalized.split('\n').enumerate() {
        if index > 0 {
            out.push_str("\r\n");
        }
        encode_qp_line(line.as_bytes(), &mut out);
    }
    if !out.ends_with("\r\n") {
        out.push_str("\r\n");
    }
    out
}

fn encode_qp_line(bytes: &[u8], out: &mut String) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut col = 0usize;
    for (index, &byte) in bytes.iter().enumerate() {
        let is_last = index + 1 == bytes.len();
        let is_first = col == 0;
        let must_encode = match byte {
            b'=' => true,
            b' ' | b'\t' => is_last,
            // Encode a leading `.` so SMTP dot-stuffing is never even tested by
            // relays that mishandle bare dots.
            b'.' if is_first => true,
            0x21..=0x7E => false,
            _ => true,
        };
        let need = if must_encode { 3 } else { 1 };
        // Keep room for a soft break `=` (75 content chars + `=` = 76).
        if col + need > 75 {
            out.push_str("=\r\n");
            col = 0;
        }
        if must_encode {
            out.push('=');
            out.push(char::from(HEX[usize::from(byte >> 4)]));
            out.push(char::from(HEX[usize::from(byte & 0x0F)]));
            col += 3;
        } else {
            out.push(char::from(byte));
            col += 1;
        }
    }
}

/// Formats `ms` (milliseconds since 1970-01-01T00:00:00Z) as an RFC 5322 UTC
/// date (`Fri, 20 Nov 2026 08:30:00 +0000`).
#[must_use]
pub fn rfc5322_date(ms: i64) -> String {
    const WEEKDAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let secs = ms.div_euclid(1_000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let hour = sod / 3_600;
    let minute = (sod % 3_600) / 60;
    let second = sod % 60;
    let weekday = WEEKDAYS[usize::try_from(days.rem_euclid(7)).unwrap_or(0)];
    let (year, month, day) = civil_from_days(days);
    let month_name = MONTHS[usize::try_from(month - 1).unwrap_or(0)];
    format!("{weekday}, {day:02} {month_name} {year:04} {hour:02}:{minute:02}:{second:02} +0000")
}

/// Howard Hinnant's civil-from-days algorithm: days since 1970-01-01 to
/// `(year, month 1..=12, day 1..=31)`.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Standard RFC 4648 base64 encoding with `=` padding.
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = u32::from(*chunk.get(1).unwrap_or(&0));
        let b2 = u32::from(*chunk.get(2).unwrap_or(&0));
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(char::from(TABLE[((triple >> 18) & 0x3F) as usize]));
        out.push(char::from(TABLE[((triple >> 12) & 0x3F) as usize]));
        if chunk.len() > 1 {
            out.push(char::from(TABLE[((triple >> 6) & 0x3F) as usize]));
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(char::from(TABLE[(triple & 0x3F) as usize]));
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn rfc5322_date_formats_known_timestamps() {
        assert_eq!(rfc5322_date(0), "Thu, 01 Jan 1970 00:00:00 +0000");
        // 2026-11-20T08:30:00Z is Friday.
        assert_eq!(
            rfc5322_date(1_795_163_400_000),
            "Fri, 20 Nov 2026 08:30:00 +0000"
        );
    }

    #[test]
    fn assembled_message_round_trips_through_parser_with_emoji_and_threading() {
        let to = vec!["ada@example.org".to_string()];
        let cc = vec!["bob@example.org".to_string()];
        let bcc = vec!["secret@example.org".to_string()];
        let refs = vec![
            "root@example.org".to_string(),
            "prev@example.org".to_string(),
        ];
        let subject = "Hello ❤️ 👨‍👩‍👧‍👦 café — meeting?";
        let body = "Line one with café & 100% = ok.\n.leading dot\nTrailing space   \nEmoji: ✈️";
        let wire = build_message(&OutgoingMessage {
            from: "me@icloud.com",
            to: &to,
            cc: &cc,
            bcc: &bcc,
            subject,
            body,
            date_ms: 1_795_163_400_000,
            message_id: "0123456789abcdef@icloud.com",
            in_reply_to: Some("prev@example.org"),
            references: &refs,
            include_bcc: false,
        });
        let wire_text = String::from_utf8(wire.clone()).unwrap();
        assert!(!wire_text.contains("Bcc:"), "{wire_text}");
        assert!(!wire_text.contains("secret@example.org"), "{wire_text}");

        let parsed = mail_parser::MessageParser::new().parse(&wire).unwrap();
        assert_eq!(parsed.subject(), Some(subject));
        assert_eq!(parsed.message_id(), Some("0123456789abcdef@icloud.com"));
        assert_eq!(
            parsed
                .body_text(0)
                .unwrap()
                .replace("\r\n", "\n")
                .trim_end_matches('\n'),
            body
        );
        let headers = crate::derive::header_fields(&wire);
        assert_eq!(headers.subject, subject);
        assert!(
            headers
                .keys
                .contains(&crate::derive::thread_key("prev@example.org"))
        );
        assert!(
            headers
                .keys
                .contains(&crate::derive::thread_key("root@example.org"))
        );

        let sent_copy = build_message(&OutgoingMessage {
            from: "me@icloud.com",
            to: &to,
            cc: &cc,
            bcc: &bcc,
            subject,
            body,
            date_ms: 1_795_163_400_000,
            message_id: "0123456789abcdef@icloud.com",
            in_reply_to: Some("prev@example.org"),
            references: &refs,
            include_bcc: true,
        });
        let sent_headers = crate::derive::header_fields(&sent_copy);
        assert!(
            sent_headers
                .recipients
                .contains(&"secret@example.org".to_string())
        );
    }

    #[test]
    fn clean_message_id_refuses_header_injection() {
        assert_eq!(
            clean_message_id("<ok@example.org>"),
            Some("ok@example.org".to_string())
        );
        assert_eq!(clean_message_id("bad\r\nBcc: evil@x.org"), None);
        assert_eq!(clean_message_id("has space@x.org"), None);
        assert_eq!(clean_message_id("a<b@x.org"), None);
    }

    #[test]
    fn dot_stuff_doubles_leading_dots_and_ends_crlf() {
        assert_eq!(
            dot_stuff(b".first\r\n..second\r\nok"),
            b"..first\r\n...second\r\nok\r\n"
        );
    }

    #[test]
    fn references_header_folds_long_chains() {
        let to = vec!["alice@example.org".to_string()];
        let refs: Vec<String> = (0..10)
            .map(|i| format!("msg-{i:02}-0123456789abcdef0123456789abcdef@example.org"))
            .collect();
        let bytes = build_message(&OutgoingMessage {
            from: "me@icloud.com",
            to: &to,
            cc: &[],
            bcc: &[],
            subject: "Re: long",
            body: "ok",
            date_ms: 1_795_163_400_000,
            message_id: "new@icloud.com",
            in_reply_to: Some(&refs[9]),
            references: &refs,
            include_bcc: false,
        });
        let text = String::from_utf8(bytes).unwrap();
        let header_block = text.split("\r\n\r\n").next().unwrap();
        for line in header_block.split("\r\n") {
            assert!(
                line.len() <= 998,
                "header line too long ({}): {line}",
                line.len()
            );
        }
        assert!(header_block.contains("References: <msg-00-"));
        assert!(header_block.contains("\r\n <msg-02-"));
    }

    #[tokio::test]
    async fn plain_tcp_refuses_non_loopback_host() {
        let sender = SmtpSender::new(SmtpEndpoint::plain("smtp.example.com", 587), |_| {
            Ok(Credentials {
                user: "u".to_string(),
                password: "p".to_string(),
            })
        });
        let account = AccountRow {
            id: crate::store::AccountId(1),
            provider: "icloud".to_string(),
            address: "me@icloud.com".to_string(),
        };
        let outcome = sender
            .send(
                &account,
                "me@icloud.com",
                &["a@example.org".to_string()],
                b"Subject: hi\r\n\r\nok",
            )
            .await;
        assert!(matches!(
            outcome,
            SendOutcome::Failed(ProviderError::Refused(_))
        ));
    }
}
