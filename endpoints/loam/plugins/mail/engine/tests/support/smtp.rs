//! A scripted SMTP server on loopback for testing `mail-draft-send` (the
//! specification's 9.5 and 14).
//!
//! Speaks SMTP submission (`EHLO`, `AUTH PLAIN`, `AUTH LOGIN`, `MAIL FROM`,
//! `RCPT TO`, `DATA`, `QUIT`) over plain TCP on `127.0.0.1:0`. Records every
//! message received (envelope sender, envelope recipients, and unstuffed raw
//! RFC 5322 bytes) and supports fault injection before and after the `DATA`
//! handover dot so tests can verify both retryable failures and
//! `SEND_OUTCOME_UNKNOWN`.

#![allow(dead_code, clippy::expect_used, clippy::unwrap_used)]

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use super::imap::{PASSWORD, USER};

/// One message the scripted SMTP server received.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceivedMail {
    pub from: String,
    pub to: Vec<String>,
    pub data: Vec<u8>,
}

/// A fault to inject on the next connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SmtpFault {
    /// Close the connection before `DATA` (after `RCPT TO`).
    DropBeforeData,
    /// Accept `DATA` body + `.\r\n`, record it as received, and close the
    /// connection without sending `250 OK` (simulating a drop after handover).
    DropAfterHandover,
    /// Reply with `code` to `MAIL FROM` (e.g. `452` rate limit or `550`).
    RefuseMailFrom(u16),
    /// Reply with `code` to `DATA` after receiving `.\r\n` (e.g. `550` or `452`).
    RefuseAfterData(u16),
    /// Reject authentication with `535`.
    RefuseAuth,
    /// Only advertise `AUTH LOGIN` (not `AUTH PLAIN`).
    AuthLoginOnly,
    /// Accept `DATA` + `.\r\n`, record it, and stall indefinitely without replying
    /// (to exercise call timeouts / cancellation).
    StallAfterData,
    /// Write a partial status code without `\n` after `.\r\n` and close.
    TruncateAfterData,
    /// Reply with an unexpected non-2xx/4xx/5xx code (e.g. 354) after `.\r\n`.
    UnexpectedCodeAfterData(u16),
    /// Advertise `STARTTLS` and send extra plaintext bytes right after `220`.
    StartTlsInjectedBytes,
    /// Send invalid non-UTF8 bytes as the greeting (must not panic).
    NonUtf8Greeting,
}

/// Shared state of the scripted SMTP server.
#[derive(Debug, Default)]
pub struct SmtpWorld {
    pub received: Vec<ReceivedMail>,
    pub log: Vec<String>,
    pub fault: Option<SmtpFault>,
    pub connections: usize,
}

/// Running scripted SMTP server.
pub struct SmtpServer {
    pub address: SocketAddr,
    pub world: Arc<Mutex<SmtpWorld>>,
}

impl SmtpServer {
    /// Starts the scripted SMTP server on `127.0.0.1:0`.
    pub fn start() -> Self {
        let world = Arc::new(Mutex::new(SmtpWorld::default()));
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

    pub fn world(&self) -> std::sync::MutexGuard<'_, SmtpWorld> {
        self.world.lock().unwrap()
    }

    pub fn received(&self) -> Vec<ReceivedMail> {
        self.world().received.clone()
    }
}

async fn serve(stream: TcpStream, world: Arc<Mutex<SmtpWorld>>) {
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);
    let initial_fault = world.lock().unwrap().fault.clone();
    if initial_fault == Some(SmtpFault::NonUtf8Greeting) {
        let _ = write.write_all(&[0xff, 0xfe, 0x20, b'\r', b'\n']).await;
        let _ = write.shutdown().await;
        return;
    }
    if write
        .write_all(b"220 scripted.smtp ESMTP ready\r\n")
        .await
        .is_err()
    {
        return;
    }

    let mut authed = false;
    let mut from: Option<String> = None;
    let mut to: Vec<String> = Vec::new();
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let cmd = line.trim_end_matches(['\r', '\n']);
        let upper = cmd.to_ascii_uppercase();

        if upper.starts_with("EHLO ") || upper == "EHLO" {
            world.lock().unwrap().log.push("EHLO".to_string());
            let fault = world.lock().unwrap().fault.clone();
            let auth_line = if fault == Some(SmtpFault::AuthLoginOnly) {
                "250-AUTH LOGIN\r\n"
            } else {
                "250-AUTH PLAIN LOGIN\r\n"
            };
            let tls_line = if fault == Some(SmtpFault::StartTlsInjectedBytes) {
                "250-STARTTLS\r\n"
            } else {
                ""
            };
            let reply = format!("250-scripted.smtp\r\n{tls_line}{auth_line}250 OK\r\n");
            if write.write_all(reply.as_bytes()).await.is_err() {
                return;
            }
        } else if upper == "STARTTLS" {
            world.lock().unwrap().log.push("STARTTLS".to_string());
            let fault = world.lock().unwrap().fault.clone();
            if fault == Some(SmtpFault::StartTlsInjectedBytes) {
                let _ = write
                    .write_all(b"220 Ready to start TLS\r\n500 injected plaintext\r\n")
                    .await;
                let _ = write.shutdown().await;
                return;
            }
            let _ = write.write_all(b"502 STARTTLS not supported\r\n").await;
        } else if upper.starts_with("AUTH PLAIN ") {
            world.lock().unwrap().log.push("AUTH PLAIN".to_string());
            let refuse = world.lock().unwrap().fault == Some(SmtpFault::RefuseAuth);
            let encoded = cmd[11..].trim();
            let decoded = base64_decode(encoded);
            let expected = format!("\0{USER}\0{PASSWORD}").into_bytes();
            if !refuse && decoded.as_deref() == Some(expected.as_slice()) {
                authed = true;
                if write
                    .write_all(b"235 Authentication succeeded\r\n")
                    .await
                    .is_err()
                {
                    return;
                }
            } else if write
                .write_all(b"535 5.7.8 Authentication credentials invalid\r\n")
                .await
                .is_err()
            {
                return;
            }
        } else if upper == "AUTH LOGIN" {
            world.lock().unwrap().log.push("AUTH LOGIN".to_string());
            if write.write_all(b"334 VXNlcm5hbWU6\r\n").await.is_err() {
                return;
            }
            let mut u = String::new();
            if !matches!(reader.read_line(&mut u).await, Ok(n) if n > 0) {
                return;
            }
            if write.write_all(b"334 UGFzc3dvcmQ6\r\n").await.is_err() {
                return;
            }
            let mut p = String::new();
            if !matches!(reader.read_line(&mut p).await, Ok(n) if n > 0) {
                return;
            }
            let refuse = world.lock().unwrap().fault == Some(SmtpFault::RefuseAuth);
            let ok_user = base64_decode(u.trim()).as_deref() == Some(USER.as_bytes());
            let ok_pass = base64_decode(p.trim()).as_deref() == Some(PASSWORD.as_bytes());
            if !refuse && ok_user && ok_pass {
                authed = true;
                if write
                    .write_all(b"235 Authentication succeeded\r\n")
                    .await
                    .is_err()
                {
                    return;
                }
            } else if write
                .write_all(b"535 5.7.8 Authentication credentials invalid\r\n")
                .await
                .is_err()
            {
                return;
            }
        } else if upper.starts_with("MAIL FROM:") {
            world.lock().unwrap().log.push("MAIL FROM".to_string());
            if !authed {
                let _ = write.write_all(b"530 Authentication required\r\n").await;
                continue;
            }
            let fault = world.lock().unwrap().fault.clone();
            if let Some(SmtpFault::RefuseMailFrom(code)) = fault {
                let _ = write
                    .write_all(format!("{code} refused\r\n").as_bytes())
                    .await;
                continue;
            }
            let addr = cmd[10..]
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>');
            from = Some(addr.to_string());
            to.clear();
            if write.write_all(b"250 OK\r\n").await.is_err() {
                return;
            }
        } else if upper.starts_with("RCPT TO:") {
            world.lock().unwrap().log.push("RCPT TO".to_string());
            let addr = cmd[8..]
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>');
            to.push(addr.to_string());
            if write.write_all(b"250 OK\r\n").await.is_err() {
                return;
            }
        } else if upper == "DATA" {
            world.lock().unwrap().log.push("DATA".to_string());
            let drop_before = world.lock().unwrap().fault == Some(SmtpFault::DropBeforeData);
            if drop_before {
                let _ = write.shutdown().await;
                return;
            }
            if write
                .write_all(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                .await
                .is_err()
            {
                return;
            }
            let mut body = Vec::new();
            loop {
                let mut data_line = Vec::new();
                match reader.read_until(b'\n', &mut data_line).await {
                    Ok(0) | Err(_) => return,
                    Ok(_) => {}
                }
                if data_line == b".\r\n" || data_line == b".\n" {
                    break;
                }
                if data_line.starts_with(b"..") {
                    body.extend_from_slice(&data_line[1..]);
                } else {
                    body.extend_from_slice(&data_line);
                }
            }
            let fault = world.lock().unwrap().fault.clone();
            match fault {
                Some(SmtpFault::DropAfterHandover) => {
                    world.lock().unwrap().received.push(ReceivedMail {
                        from: from.clone().unwrap_or_default(),
                        to: to.clone(),
                        data: body,
                    });
                    let _ = write.shutdown().await;
                    return;
                }
                Some(SmtpFault::StallAfterData) => {
                    world.lock().unwrap().received.push(ReceivedMail {
                        from: from.clone().unwrap_or_default(),
                        to: to.clone(),
                        data: body,
                    });
                    // Wait until client disconnects or timeout drops the send.
                    let mut drain = Vec::new();
                    let _ = reader.read_until(b'\n', &mut drain).await;
                    return;
                }
                Some(SmtpFault::TruncateAfterData) => {
                    world.lock().unwrap().received.push(ReceivedMail {
                        from: from.clone().unwrap_or_default(),
                        to: to.clone(),
                        data: body,
                    });
                    let _ = write.write_all(b"550").await;
                    let _ = write.shutdown().await;
                    return;
                }
                Some(SmtpFault::UnexpectedCodeAfterData(code)) => {
                    world.lock().unwrap().received.push(ReceivedMail {
                        from: from.clone().unwrap_or_default(),
                        to: to.clone(),
                        data: body,
                    });
                    let _ = write
                        .write_all(format!("{code} unexpected\r\n").as_bytes())
                        .await;
                    let _ = write.shutdown().await;
                    return;
                }
                Some(SmtpFault::RefuseAfterData(code)) => {
                    if write
                        .write_all(format!("{code} refused\r\n").as_bytes())
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
                _ => {
                    world.lock().unwrap().received.push(ReceivedMail {
                        from: from.clone().unwrap_or_default(),
                        to: to.clone(),
                        data: body,
                    });
                    if write.write_all(b"250 OK queued\r\n").await.is_err() {
                        return;
                    }
                }
            }
        } else if upper == "QUIT" {
            world.lock().unwrap().log.push("QUIT".to_string());
            let _ = write.write_all(b"221 Bye\r\n").await;
            let _ = write.shutdown().await;
            return;
        } else if write.write_all(b"500 Unknown command\r\n").await.is_err() {
            return;
        }
    }
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let bytes = input.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let val = |b: u8| -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.as_chunks::<4>().0 {
        let a = val(chunk[0])?;
        let b = val(chunk[1])?;
        out.push((a << 2) | (b >> 4));
        if chunk[2] != b'=' {
            let c = val(chunk[2])?;
            out.push((b << 4) | (c >> 2));
            if chunk[3] != b'=' {
                let d = val(chunk[3])?;
                out.push((c << 6) | d);
            }
        }
    }
    Some(out)
}
