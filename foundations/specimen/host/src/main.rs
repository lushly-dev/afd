//! `specimen-host`: the Specimen bench's native runtime. It bundles a bench with Rolldown,
//! serves each generation from memory and renders cases in Chromium over CDP.
//!
//! Protocol: one JSON request per stdin line, one JSON reply per stdout line.
//! - `{"id", "op": "open", "root", "runtime", "modules": [[id, file]], "entries", "defaults", "executable", "work"}`
//!   starts Chromium and replies `{"browserPid"}`, the browser's process group.
//! - `{"id", "op": "render", "entry", "context", "checkpoint", "timeoutMs", "screenshot"}`
//! - `{"id", "op": "index", "root", "base", "stories": [{directory, files, titlePrefix}], "preview"}`
//!   reads story files statically and replies with their Storybook identities; it needs no `open`.
//! - `{"id", "op": "migrate", "root", "base", "stories", "manifest", "files", "apply"}` is the
//!   preview-first codemod over the same files; it writes only with `apply`.
//! - `{"id", "op": "close"}` waits for accepted renders, stops Chromium and exits.
//!
//! Replies are `{"id", "ok": true, "result"}` or `{"id", "ok": false, "error": {"message", "causes"}}`.
//! End of input means the owner is gone: Chromium's process group is killed at once.

mod aria;
mod browser;
mod bundle;
mod cdp;
mod console;
mod csf;
mod glob;
mod keyboard;
mod page;
mod serve;

use anyhow::{Result, anyhow};
use browser::{Browser, RenderFailure, RenderRequest};
use bundle::{BenchSource, Generation};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, mpsc};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    root: PathBuf,
    runtime: String,
    modules: Vec<(String, String)>,
    entries: Value,
    defaults: Value,
    executable: String,
    work: PathBuf,
    #[serde(default)]
    static_dirs: Vec<serve::StaticDir>,
}

struct Bench {
    source: BenchSource,
    browser: Arc<Browser>,
    generation: Mutex<Option<Arc<Generation>>>,
    renders: serve::Renders,
    origin: String,
    work: PathBuf,
}

impl Bench {
    /// The current bundle, rebuilt when any of its source files changed.
    async fn generation(&self) -> Result<Arc<Generation>> {
        let mut current = self.generation.lock().await;
        if let Some(generation) = current.as_ref()
            && !generation.stale()
        {
            return Ok(generation.clone());
        }
        let generation = Arc::new(bundle::build(&self.source).await?);
        *current = Some(generation.clone());
        Ok(generation)
    }

    async fn render(&self, request: RenderRequest) -> Result<Value, RenderFailure> {
        let generation = self.generation().await?;
        let token = uuid::Uuid::new_v4().to_string();
        self.renders.begin(&token, generation);
        let outcome = self
            .browser
            .render(&format!("{}/r/{token}/", self.origin), &request)
            .await;
        let loaded = self.renders.end(&token);
        let outcome = outcome?;
        Ok(json!({
            "captured": outcome.captured,
            "snapshot": outcome.snapshot,
            "screenshot": outcome.screenshot,
            "console": { "errors": outcome.errors, "warnings": outcome.warnings },
            "context": outcome.context,
            "outcome": outcome.outcome,
            "loaded": loaded,
            "browser": self.browser.ready().await.unwrap_or_default(),
        }))
    }

    async fn close(&self) {
        self.browser.close().await;
        let _ = std::fs::remove_dir_all(&self.work);
    }
}

async fn open(request: OpenRequest) -> Result<Arc<Bench>> {
    let work = request.work.join(format!("host-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&work)?;
    // Chromium starts while the first bundle builds.
    let browser = Browser::spawn(&request.executable, &work)?;
    let renders = serve::Renders::new(request.static_dirs);
    let origin = match serve::start(renders.clone()).await {
        Ok(origin) => origin,
        Err(error) => {
            browser.close().await;
            let _ = std::fs::remove_dir_all(&work);
            return Err(error);
        }
    };
    Ok(Arc::new(Bench {
        source: BenchSource {
            root: request.root,
            runtime: request.runtime,
            modules: request.modules,
            entries: request.entries,
            defaults: request.defaults,
            work: work.join("bundle"),
        },
        browser,
        generation: Mutex::new(None),
        renders,
        origin,
        work,
    }))
}

/// The numeric `"id"` of a request line that is not valid JSON, if one can be read.
fn request_id(line: &str) -> Option<u64> {
    let start = line.find("\"id\"")? + 4;
    let rest = line[start..].trim_start().strip_prefix(':')?.trim_start();
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

fn failure(id: &Value, error: RenderFailure) -> Value {
    json!({ "id": id, "ok": false, "error": { "message": error.message, "causes": error.causes } })
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<()> {
    let (replies, mut outgoing) = mpsc::unbounded_channel::<Value>();
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(reply) = outgoing.recv().await {
            let mut line = serde_json::to_vec(&reply).unwrap_or_default();
            line.push(b'\n');
            if stdout.write_all(&line).await.is_err() || stdout.flush().await.is_err() {
                break;
            }
        }
    });
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut bench: Option<Arc<Bench>> = None;
    let mut work = tokio::task::JoinSet::new();
    let mut closed = false;
    while let Ok(Some(line)) = lines.next_line().await {
        let Some(message) = cdp::parse_lossy(line.as_bytes()) else {
            // Answer what can be answered, so the caller is not left waiting.
            if let Some(id) = request_id(&line) {
                let _ = replies.send(failure(&json!(id), anyhow!("Invalid host request").into()));
            }
            continue;
        };
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        match message.get("op").and_then(Value::as_str) {
            Some("open") if bench.is_none() => {
                let reply = match serde_json::from_value::<OpenRequest>(message) {
                    Ok(request) => match open(request).await {
                        Ok(opened) => {
                            let pid = opened.browser.pid;
                            bench = Some(opened);
                            json!({ "id": id, "ok": true, "result": { "browserPid": pid } })
                        }
                        Err(error) => failure(&id, error.into()),
                    },
                    Err(error) => failure(&id, anyhow!("Invalid open request: {error}").into()),
                };
                let _ = replies.send(reply);
            }
            Some("render") => {
                let Some(current) = bench.clone() else {
                    let _ = replies.send(failure(&id, anyhow!("Specimen host is not open").into()));
                    continue;
                };
                let replies = replies.clone();
                work.spawn(async move {
                    let reply = match serde_json::from_value::<RenderRequest>(message) {
                        Ok(request) => match current.render(request).await {
                            Ok(result) => json!({ "id": id, "ok": true, "result": result }),
                            Err(error) => failure(&id, error),
                        },
                        Err(error) => {
                            failure(&id, anyhow!("Invalid render request: {error}").into())
                        }
                    };
                    let _ = replies.send(reply);
                });
            }
            Some("index") => {
                let replies = replies.clone();
                work.spawn(async move {
                    let reply = match serde_json::from_value::<csf::index::IndexRequest>(message) {
                        Ok(request) => {
                            match tokio::task::spawn_blocking(move || csf::index::index(&request))
                                .await
                            {
                                Ok(index) => json!({ "id": id, "ok": true, "result": index }),
                                Err(error) => {
                                    failure(&id, anyhow!("Indexing failed: {error}").into())
                                }
                            }
                        }
                        Err(error) => {
                            failure(&id, anyhow!("Invalid index request: {error}").into())
                        }
                    };
                    let _ = replies.send(reply);
                });
            }
            Some("migrate") => {
                let replies = replies.clone();
                work.spawn(async move {
                    let reply =
                        match serde_json::from_value::<csf::migrate::MigrateRequest>(message) {
                            Ok(request) => {
                                match tokio::task::spawn_blocking(move || {
                                    csf::migrate::migrate(&request)
                                })
                                .await
                                {
                                    Ok(migration) => {
                                        json!({ "id": id, "ok": true, "result": migration })
                                    }
                                    Err(error) => {
                                        failure(&id, anyhow!("Migration failed: {error}").into())
                                    }
                                }
                            }
                            Err(error) => {
                                failure(&id, anyhow!("Invalid migrate request: {error}").into())
                            }
                        };
                    let _ = replies.send(reply);
                });
            }
            Some("close") => {
                // Accepted renders finish first; each is bounded by its own deadline.
                while work.join_next().await.is_some() {}
                if let Some(current) = bench.take() {
                    current.close().await;
                }
                let _ = replies.send(json!({ "id": id, "ok": true, "result": null }));
                closed = true;
                break;
            }
            _ => {
                let _ = replies.send(failure(&id, anyhow!("Unsupported host request").into()));
            }
        }
    }
    if !closed {
        // The owner is gone: nothing can receive a reply, so stop Chromium immediately.
        if let Some(current) = bench.take() {
            current.browser.kill();
            work.abort_all();
            current.close().await;
        }
    }
    drop(replies);
    let _ = writer.await;
    Ok(())
}
