//! `specimen-host`: the Specimen bench's native runtime. It bundles a bench with Rolldown,
//! serves each generation from memory and renders cases in Chromium over CDP.
//!
//! Protocol: one JSON request per stdin line, one JSON reply per stdout line.
//! - `{"id", "op": "open", "root", "runtime", "modules": [[id, file]], "entries", "defaults", "executable", "work", "network"?: {"allow"}}`
//!   starts Chromium and replies `{"browserPid", "sandbox", "isolation"}`: the browser's process
//!   group, whether Chromium runs in its sandbox, and `ISOLATION`, which a client checks so that
//!   a host built before these rules is refused rather than ignoring `network`. When it does not, stderr says why, in one line
//!   starting `specimen-host: `. Pages reach only the bench's origin and `network.allow`.
//! - `{"id", "op": "render", "entry", "context", "checkpoint", "timeoutMs", "screenshot"}`
//! - `{"id", "op": "index", "root", "base", "stories": [{directory, files, titlePrefix}], "preview"}`
//!   reads story files statically and replies with their Storybook identities; it needs no `open`.
//! - `{"id", "op": "migrate", "root", "base", "stories", "manifest", "files", "apply"}` is the
//!   preview-first codemod over the same files; it writes only with `apply`.
//! - `{"id", "op": "close"}` waits for accepted renders, stops Chromium and exits.
//!
//! Replies are `{"id", "ok": true, "result"}` or `{"id", "ok": false, "error": {"message", "causes", "code"?, "suggestion"?, "details"?}}`.
//! End of input means the owner is gone: Chromium's process group is killed at once.

mod a11y_expect;
mod aria;
mod browser;
mod bundle;
mod cdp;
mod console;
mod csf;
mod gate;
mod glob;
mod isolation;
mod keyboard;
mod page;
mod point;
mod process;
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
    #[serde(default)]
    network: NetworkConfig,
}

/// The configuration's `network`: origins a page may reach besides the bench's own.
#[derive(Deserialize, Default)]
struct NetworkConfig {
    #[serde(default)]
    allow: Vec<String>,
}

struct Bench {
    source: BenchSource,
    browser: Arc<Browser>,
    generation: Mutex<Option<Arc<Generation>>>,
    renders: serve::Renders,
    origin: String,
    network: isolation::Network,
    work: PathBuf,
}

impl Bench {
    /// The current bundle, rebuilt when any of its source files changed.
    /// The built generation without checking its sources, for a suite that checked them once.
    async fn current_generation(&self) -> Result<Arc<Generation>> {
        if let Some(generation) = self.generation.lock().await.as_ref() {
            return Ok(generation.clone());
        }
        self.generation().await
    }

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
        let generation = match request.reuse_bundle {
            true => self.current_generation().await?,
            false => self.generation().await?,
        };
        let token = uuid::Uuid::new_v4().to_string();
        self.renders.begin(&token, generation);
        let outcome = self
            .browser
            .render(
                &format!("{}/r/{token}/", self.origin),
                &self.network,
                &request,
            )
            .await;
        let (loaded, loaded_sources) = self.renders.end(&token);
        let outcome = outcome?;
        Ok(json!({
            "captured": outcome.captured,
            "snapshot": outcome.snapshot,
            "screenshot": outcome.screenshot,
            "console": { "errors": outcome.errors, "warnings": outcome.warnings },
            "context": outcome.context,
            "outcome": outcome.outcome,
            "accessibility": outcome.accessibility,
            "profile": outcome.profile,
            "captures": outcome.captures,
            "jobOutcome": outcome.job_outcome,
            "loaded": loaded,
            "loadedSources": loaded_sources,
            "resolvedTargetRef": outcome.resolved_target_ref,
            "elementTexts": outcome.element_texts,
            "slottedParents": outcome.slotted_parents,
            "browser": self.browser.ready().await.unwrap_or_default(),
        }))
    }

    async fn close(&self) {
        self.browser.close().await;
        process::remove_tree(&self.work);
    }
}

async fn open(request: OpenRequest) -> Result<Arc<Bench>> {
    for entry in &request.network.allow {
        isolation::allowed_origin(entry)?;
    }
    let setting = std::env::var(isolation::SANDBOX_VARIABLE).ok();
    let sandbox = isolation::sandbox(setting.as_deref(), &isolation::System::current())?;
    if let Some(reason) = &sandbox.reason {
        eprintln!("specimen-host: Chromium runs without its sandbox: {reason}");
    }
    // The server is the one origin pages reach and the proxy that refuses every other.
    let renders = serve::Renders::new(request.static_dirs);
    let origin = serve::start(renders.clone()).await?;
    let network = isolation::Network::new(&origin, &request.network.allow)?;
    let work = request.work.join(format!("host-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&work)?;
    // Chromium starts while the first bundle builds.
    let mut browser = match Browser::spawn(&request.executable, &work, &sandbox) {
        Ok(browser) => browser,
        Err(error) => {
            process::remove_tree(&work);
            return Err(error);
        }
    };
    // Under a restriction a profile may lift, the sandboxed start is awaited: if Chromium closed
    // its connection, as it does when the sandbox cannot start, it starts once more without.
    if sandbox.fallback.is_some()
        && let Some(unsandboxed) =
            isolation::retry_without_sandbox(&sandbox, browser.start_failure().await)
    {
        browser.close().await;
        if let Some(reason) = &unsandboxed.reason {
            eprintln!("specimen-host: Chromium runs without its sandbox: {reason}");
        }
        browser = match Browser::spawn(&request.executable, &work, &unsandboxed) {
            Ok(browser) => browser,
            Err(error) => {
                process::remove_tree(&work);
                return Err(error);
            }
        };
    }
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
        network,
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

/// The version of the sandbox and network rules this host applies, which `open` reports. The
/// client refuses a host that reports another, or none.
const ISOLATION: u32 = 1;

fn opened_reply(id: &Value, pid: u32, sandbox: bool) -> Value {
    json!({
        "id": id,
        "ok": true,
        "result": { "browserPid": pid, "sandbox": sandbox, "isolation": ISOLATION }
    })
}

fn failure(id: &Value, error: RenderFailure) -> Value {
    let mut body = json!({ "message": error.message, "causes": error.causes });
    if let Some(structured) = error.structured {
        body["code"] = json!(structured.code);
        body["suggestion"] = json!(structured.suggestion);
        body["details"] = structured.details;
    }
    json!({ "id": id, "ok": false, "error": body })
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
                            let reply =
                                opened_reply(&id, opened.browser.pid, opened.browser.sandbox);
                            bench = Some(opened);
                            reply
                        }
                        Err(error) => failure(&id, error.into()),
                    },
                    Err(error) => failure(&id, anyhow!("Invalid open request: {error}").into()),
                };
                let _ = replies.send(reply);
            }
            Some(operation @ ("prepare" | "stale")) => {
                let Some(current) = bench.clone() else {
                    let _ = replies.send(failure(&id, anyhow!("Specimen host is not open").into()));
                    continue;
                };
                let replies = replies.clone();
                let prepare = operation == "prepare";
                work.spawn(async move {
                    // Prepare rebuilds a stale bundle; stale only reports whether it is.
                    let reply = if prepare {
                        match current.generation().await {
                            Ok(generation) => json!({
                                "id": id,
                                "ok": true,
                                "result": { "bundle": generation.digest() }
                            }),
                            Err(error) => failure(&id, error.into()),
                        }
                    } else {
                        let stale = match current.generation.lock().await.as_ref() {
                            Some(generation) => {
                                let generation = generation.clone();
                                tokio::task::spawn_blocking(move || generation.stale())
                                    .await
                                    .unwrap_or(true)
                            }
                            None => false,
                        };
                        json!({ "id": id, "ok": true, "result": { "stale": stale } })
                    };
                    let _ = replies.send(reply);
                });
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
            Some("native_bindings") => {
                let replies = replies.clone();
                work.spawn(async move {
                    let reply =
                        match serde_json::from_value::<csf::native::NativeBindingsRequest>(message)
                        {
                            Ok(request) => match tokio::task::spawn_blocking(move || {
                                csf::native::extract_native_bindings(&request)
                            })
                            .await
                            {
                                Ok(result) => json!({ "id": id, "ok": true, "result": result }),
                                Err(error) => failure(
                                    &id,
                                    anyhow!("Native binding extraction failed: {error}").into(),
                                ),
                            },
                            Err(error) => failure(
                                &id,
                                anyhow!("Invalid native_bindings request: {error}").into(),
                            ),
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

#[cfg(test)]
mod tests {
    use super::{failure, opened_reply};
    use crate::browser::RenderFailure;
    use crate::page::TargetError;
    use anyhow::anyhow;
    use serde_json::json;

    #[test]
    fn failure_reply_serializes_structured_target_error_fields() {
        let err: anyhow::Error = TargetError::Ambiguous {
            name: "action".into(),
            target: "role \"button\"".into(),
            count: 2,
        }
        .into();
        let reply = failure(&json!(7), RenderFailure::from(err));
        assert_eq!(reply["id"], json!(7));
        assert_eq!(reply["ok"], json!(false));
        assert_eq!(reply["error"]["code"], json!("TARGET_AMBIGUOUS"));
        assert!(
            reply["error"]["suggestion"]
                .as_str()
                .is_some_and(|s| s.contains("2") && s.contains("name"))
        );
        assert_eq!(
            reply["error"]["details"],
            json!({ "count": 2, "target": "action" })
        );
    }

    #[test]
    fn open_reports_the_isolation_rules_it_applies() {
        assert_eq!(
            opened_reply(&json!(3), 41, true),
            json!({
                "id": 3,
                "ok": true,
                "result": { "browserPid": 41, "sandbox": true, "isolation": 1 }
            })
        );
    }

    #[test]
    fn failure_reply_omits_optional_fields_for_untyped_errors() {
        let reply = failure(&json!(8), RenderFailure::from(anyhow!("plain failure")));
        assert_eq!(
            reply,
            json!({
                "id": 8,
                "ok": false,
                "error": {
                    "message": "plain failure",
                    "causes": []
                }
            })
        );
    }
}
