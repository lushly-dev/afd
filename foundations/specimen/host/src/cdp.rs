//! Chrome DevTools Protocol over Chromium's `--remote-debugging-pipe`: commands are written to
//! the child's fd 3 and replies and events read from its fd 4, each a NUL-terminated JSON value.

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::os::fd::{FromRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
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
    next: AtomicU64,
}

fn pipe_pair() -> Result<(OwnedFd, OwnedFd)> {
    let mut fds = [0; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) })
}

fn set_nonblocking(fd: &OwnedFd) -> Result<()> {
    use std::os::fd::AsRawFd;
    let raw = fd.as_raw_fd();
    let flags = unsafe { libc::fcntl(raw, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(raw, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

/// Launch `executable` with `args` and a CDP pipe on fds 3 and 4.
pub fn launch(executable: &str, args: &[String]) -> Result<(Child, Cdp)> {
    use std::os::fd::AsRawFd;
    let (child_read, host_write) = pipe_pair()?;
    let (host_read, child_write) = pipe_pair()?;
    let (child_read_fd, child_write_fd) = (child_read.as_raw_fd(), child_write.as_raw_fd());
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // The browser gets its own process group, so the host can stop every descendant.
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(child_read_fd, 3) < 0 || libc::dup2(child_write_fd, 4) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            libc::setpgid(0, 0);
            Ok(())
        });
    }
    let child = command
        .spawn()
        .with_context(|| format!("launching {executable}"))?;
    drop(child_read);
    drop(child_write);
    set_nonblocking(&host_write)?;
    set_nonblocking(&host_read)?;
    let mut sender = pipe::Sender::from_owned_fd(host_write)?;
    let mut receiver = pipe::Receiver::from_owned_fd(host_read)?;
    let pending: Pending = Arc::default();
    let subscribers: Subscribers = Arc::default();
    let (writer, mut outgoing) = mpsc::unbounded_channel::<Vec<u8>>();
    tokio::spawn(async move {
        while let Some(mut message) = outgoing.recv().await {
            message.push(0);
            if sender.write_all(&message).await.is_err() {
                break;
            }
        }
    });
    let (reader_pending, reader_subscribers) = (pending.clone(), subscribers.clone());
    tokio::spawn(async move {
        let mut buffer = Vec::new();
        let mut chunk = vec![0u8; 1 << 16];
        loop {
            let read = match receiver.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            buffer.extend_from_slice(&chunk[..read]);
            while let Some(end) = buffer.iter().position(|byte| *byte == 0) {
                let message: Vec<u8> = buffer.drain(..=end).collect();
                let Ok(value) = serde_json::from_slice::<Value>(&message[..message.len() - 1])
                else {
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
        }
        // The browser is gone: fail every outstanding command.
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
