//! Chrome DevTools Protocol over Chromium's `--remote-debugging-pipe`: commands are written to
//! the child's fd 3 and replies and events read from its fd 4, each a NUL-terminated JSON value.
//! The child inherits only those two descriptors, so if the host dies Chromium sees its
//! command pipe close and exits.

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::pipe;
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Clone)]
pub struct Event {
    pub method: String,
    pub params: Value,
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>;
type Subscribers = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Event>>>>;

pub struct Cdp {
    writer: mpsc::UnboundedSender<Vec<u8>>,
    pending: Pending,
    subscribers: Subscribers,
    closed: Arc<AtomicBool>,
    next: AtomicU64,
}

fn set_flag(fd: RawFd, get: libc::c_int, set: libc::c_int, flag: libc::c_int) -> Result<()> {
    let flags = unsafe { libc::fcntl(fd, get) };
    if flags < 0 || unsafe { libc::fcntl(fd, set, flags | flag) } < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

/// A pipe whose ends close on exec: only descriptors placed deliberately reach the child.
fn pipe_pair() -> Result<(OwnedFd, OwnedFd)> {
    let mut fds = [0; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let ends = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    for fd in fds {
        set_flag(fd, libc::F_GETFD, libc::F_SETFD, libc::FD_CLOEXEC)?;
    }
    Ok(ends)
}

/// Strings Chromium escapes as lone UTF-16 surrogates, which strict JSON parsers reject,
/// become U+FFFD so the message still parses.
pub fn repair_surrogates(text: &str) -> String {
    let bytes = text.as_bytes();
    let hex = |at: usize| -> Option<u32> {
        let digits = text.get(at..at + 4)?;
        u32::from_str_radix(digits, 16).ok()
    };
    let mut repaired = String::with_capacity(text.len());
    let mut index = 0;
    let mut last = 0;
    while index + 1 < bytes.len() {
        if bytes[index] != b'\\' {
            index += 1;
            continue;
        }
        if bytes[index + 1] != b'u' {
            index += 2;
            continue;
        }
        let Some(unit) = hex(index + 2) else {
            index += 2;
            continue;
        };
        let paired = (0xD800..0xDC00).contains(&unit)
            && text.get(index + 6..index + 8) == Some("\\u")
            && hex(index + 8).is_some_and(|low| (0xDC00..0xE000).contains(&low));
        if paired {
            index += 12;
        } else if (0xD800..0xE000).contains(&unit) {
            repaired.push_str(&text[last..index]);
            repaired.push_str("\\ufffd");
            index += 6;
            last = index;
        } else {
            index += 6;
        }
    }
    repaired.push_str(&text[last..]);
    repaired
}

/// Parse one JSON value, repairing lone surrogates if the strict parse fails.
pub fn parse_lossy(bytes: &[u8]) -> Option<Value> {
    if let Ok(value) = serde_json::from_slice(bytes) {
        return Some(value);
    }
    let text = String::from_utf8_lossy(bytes);
    serde_json::from_str(&repair_surrogates(&text)).ok()
}

/// Launch `executable` with `args` and a CDP pipe on fds 3 and 4.
pub fn launch(executable: &str, args: &[String]) -> Result<(Child, Cdp)> {
    let (child_read, host_write) = pipe_pair()?;
    let (host_read, child_write) = pipe_pair()?;
    let (child_read_fd, child_write_fd) = (child_read.as_raw_fd(), child_write.as_raw_fd());
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // In the child only: copy both ends above 3 and 4 first, so placing one cannot overwrite
    // the other, then place them. `dup2` clears close-on-exec on the copies it makes. The
    // browser gets its own process group, so the host can stop every descendant.
    unsafe {
        command.pre_exec(move || {
            let read = libc::fcntl(child_read_fd, libc::F_DUPFD, 10);
            let write = libc::fcntl(child_write_fd, libc::F_DUPFD, 10);
            if read < 0 || write < 0 || libc::dup2(read, 3) < 0 || libc::dup2(write, 4) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            libc::close(read);
            libc::close(write);
            libc::setpgid(0, 0);
            Ok(())
        });
    }
    let child = command
        .spawn()
        .with_context(|| format!("launching {executable}"))?;
    drop(child_read);
    drop(child_write);
    set_flag(
        host_write.as_raw_fd(),
        libc::F_GETFL,
        libc::F_SETFL,
        libc::O_NONBLOCK,
    )?;
    set_flag(
        host_read.as_raw_fd(),
        libc::F_GETFL,
        libc::F_SETFL,
        libc::O_NONBLOCK,
    )?;
    let mut sender = pipe::Sender::from_owned_fd(host_write)?;
    let mut receiver = pipe::Receiver::from_owned_fd(host_read)?;
    let pending: Pending = Arc::default();
    let subscribers: Subscribers = Arc::default();
    let closed = Arc::new(AtomicBool::new(false));
    let (writer, mut outgoing) = mpsc::unbounded_channel::<Vec<u8>>();
    tokio::spawn(async move {
        while let Some(mut message) = outgoing.recv().await {
            message.push(0);
            if sender.write_all(&message).await.is_err() {
                break;
            }
        }
    });
    let (reader_pending, reader_subscribers, reader_closed) =
        (pending.clone(), subscribers.clone(), closed.clone());
    tokio::spawn(async move {
        let mut buffer = Vec::new();
        let mut chunk = vec![0u8; 1 << 16];
        // Bytes before this offset hold no message terminator.
        let mut scanned = 0;
        loop {
            let read = match receiver.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            buffer.extend_from_slice(&chunk[..read]);
            while let Some(offset) = buffer[scanned..].iter().position(|byte| *byte == 0) {
                let end = scanned + offset;
                let message: Vec<u8> = buffer.drain(..=end).collect();
                scanned = 0;
                let Some(value) = parse_lossy(&message[..message.len() - 1]) else {
                    continue;
                };
                if let Some(id) = value.get("id").and_then(Value::as_u64) {
                    let reply = reader_pending.lock().unwrap().remove(&id);
                    if let Some(reply) = reply {
                        let result = match value.get("error") {
                            Some(error) => Err(anyhow!(
                                "{}",
                                error
                                    .get("message")
                                    .and_then(Value::as_str)
                                    .unwrap_or("CDP error")
                            )),
                            None => Ok(value.get("result").cloned().unwrap_or(Value::Null)),
                        };
                        let _ = reply.send(result);
                    }
                } else if let Some(method) = value.get("method").and_then(Value::as_str) {
                    let session = value.get("sessionId").and_then(Value::as_str).unwrap_or("");
                    let subscriber = reader_subscribers.lock().unwrap().get(session).cloned();
                    if let Some(subscriber) = subscriber {
                        let _ = subscriber.send(Event {
                            method: method.to_string(),
                            params: value.get("params").cloned().unwrap_or(Value::Null),
                        });
                    }
                }
            }
            scanned = buffer.len();
        }
        // The browser is gone: fail every outstanding command, and every later one.
        reader_closed.store(true, Ordering::SeqCst);
        for (_, reply) in reader_pending.lock().unwrap().drain() {
            let _ = reply.send(Err(anyhow!("Browser connection closed")));
        }
    });
    Ok((
        child,
        Cdp {
            writer,
            pending,
            subscribers,
            closed,
            next: AtomicU64::new(1),
        },
    ))
}

impl Cdp {
    pub async fn send(&self, session: Option<&str>, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = Value::String(session.to_string());
        }
        let (reply, response) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, reply);
        // Checked after registering: a reader that closed before this saw no entry to fail.
        if self.closed.load(Ordering::SeqCst) {
            self.pending.lock().unwrap().remove(&id);
            return Err(anyhow!("Browser connection closed")).with_context(|| method.to_string());
        }
        self.writer
            .send(serde_json::to_vec(&message)?)
            .map_err(|_| anyhow!("Browser connection closed"))?;
        response
            .await
            .map_err(|_| anyhow!("Browser connection closed"))?
            .with_context(|| method.to_string())
    }

    /// Receive the events of one session (`""` for the browser target).
    pub fn subscribe(&self, session: &str) -> mpsc::UnboundedReceiver<Event> {
        let (sender, receiver) = mpsc::unbounded_channel();
        self.subscribers
            .lock()
            .unwrap()
            .insert(session.to_string(), sender);
        receiver
    }

    pub fn unsubscribe(&self, session: &str) {
        self.subscribers.lock().unwrap().remove(session);
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_lossy, repair_surrogates};

    #[test]
    fn repairs_lone_surrogates_and_keeps_pairs() {
        assert_eq!(repair_surrogates(r#""a\ud800b""#), r#""a\ufffdb""#);
        assert_eq!(repair_surrogates(r#""\udc00""#), r#""\ufffd""#);
        assert_eq!(repair_surrogates(r#""😀""#), r#""😀""#);
        assert_eq!(repair_surrogates(r#""\\ud800""#), r#""\\ud800""#);
        assert_eq!(
            parse_lossy(br#"{"text":"x\ud800"}"#).unwrap()["text"],
            "x\u{fffd}"
        );
    }
}
