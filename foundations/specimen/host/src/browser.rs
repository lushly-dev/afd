//! Chromium driven directly over CDP. Each render gets a fresh browser context, and pages get
//! the environment Playwright 1.64 gives headless Chromium pages: the same launch switches,
//! default font families, locale, media and metrics emulation. Scenario actions use real
//! input after Playwright's actionability checks. The ARIA snapshot comes from Chromium's own
//! accessibility tree. Unlike Playwright's defaults, Chromium keeps its sandbox where it can
//! start, and a context reaches only the origins `isolation::Network` lets through.

use crate::aria;
use crate::cdp::{self, Cdp};
use crate::console::{Collector, Messages};
use crate::gate::{GateExec, GateRunRequest, run_gate};
use crate::isolation::{Network, SANDBOX_VARIABLE, Sandbox, StartFailure};
use crate::keyboard::Keyboard;
use crate::page::{Page, Viewport, emulate, prepare};
use crate::process::{self, Child};
use anyhow::{Result, anyhow};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::{Instant, sleep, timeout};

const DISABLED_FEATURES: &[&str] = &[
    "AvoidUnnecessaryBeforeUnloadCheckSync",
    "DestroyProfileOnBrowserClose",
    "DialMediaRouteProvider",
    "GlobalMediaControls",
    "HttpsUpgrades",
    "LensOverlay",
    "MediaRouter",
    "PaintHolding",
    "ThirdPartyStoragePartitioning",
    "BlockOriginHeaderModificationOnRedirect",
    "Translate",
    "AutoDeElevate",
    "OptimizationHints",
    "NetworkTimeServiceQuerying",
    "AimEnabled",
    "msForceBrowserSignIn",
    "msEdgeUpdateLaunchServicesPreferredVersion",
];

/// Playwright 1.64's headless Chromium switches, so pages see the same browser environment,
/// with two exceptions: `--no-sandbox` only when the sandbox is off, and WebRTC kept to the
/// context's proxy, which refuses it, so UDP cannot reach a host the proxy would block.
fn switches(user_data: &str, sandbox: bool) -> Vec<String> {
    let mut args: Vec<String> = [
        "--disable-field-trial-config",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-back-forward-cache",
        "--disable-breakpad",
        "--disable-client-side-phishing-detection",
        "--disable-component-extensions-with-background-pages",
        "--disable-component-update",
        "--no-default-browser-check",
        "--disable-default-apps",
        "--disable-dev-shm-usage",
        "--disable-edgeupdater",
        "--disable-extensions",
    ]
    .map(String::from)
    .to_vec();
    args.push(format!(
        "--disable-features={}",
        DISABLED_FEATURES.join(",")
    ));
    args.extend(
        [
            "--enable-features=CDPScreenshotNewSurface",
            "--allow-pre-commit-input",
            "--disable-hang-monitor",
            "--disable-ipc-flooding-protection",
            "--disable-popup-blocking",
            "--disable-prompt-on-repost",
            "--disable-renderer-backgrounding",
            "--disable-updater-scheduler",
            "--force-color-profile=srgb",
            "--metrics-recording-only",
            "--no-first-run",
            "--password-store=basic",
            "--use-mock-keychain",
            "--no-service-autorun",
            "--export-tagged-pdf",
            "--disable-search-engine-choice-screen",
            "--unsafely-disable-devtools-self-xss-warnings",
            "--edge-skip-compat-layer-relaunch",
            "--disable-infobars",
            "--disable-sync",
            "--enable-unsafe-swiftshader",
            "--headless",
            "--hide-scrollbars",
            "--mute-audio",
            "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
        ]
        .map(String::from),
    );
    if !sandbox {
        args.push("--no-sandbox".into());
    }
    args.extend(
        [
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--remote-debugging-pipe",
            "--no-startup-window",
        ]
        .map(String::from),
    );
    args.push(format!("--user-data-dir={user_data}"));
    args
}

pub struct Browser {
    cdp: Cdp,
    child: Mutex<Option<Child>>,
    /// The browser's process id: on Unix also its process group; on Windows, in its own job.
    pub pid: u32,
    /// Whether Chromium runs in its sandbox.
    pub sandbox: bool,
    user_data: PathBuf,
    /// The handshake's outcome: the browser version, or why it did not start and how.
    version: tokio::sync::watch::Receiver<Option<Result<String, (String, StartFailure)>>>,
}

impl Browser {
    /// Start Chromium now; the CDP handshake completes in the background. Closing never
    /// depends on the handshake, so a browser that never answers is still stopped.
    pub fn spawn(
        executable: &str,
        work: &std::path::Path,
        sandbox: &Sandbox,
    ) -> Result<Arc<Browser>> {
        let user_data = work.join(format!("profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&user_data)?;
        let (child, cdp) = cdp::launch(
            executable,
            &switches(&user_data.display().to_string(), sandbox.enabled),
        )?;
        // A container can withhold what the Linux sandbox needs in ways the host cannot see.
        let hint = if sandbox.enabled && cfg!(target_os = "linux") {
            format!(
                "; if this system cannot run Chromium's sandbox, such as a container without user namespaces, set {SANDBOX_VARIABLE}=0"
            )
        } else {
            String::new()
        };
        let (report, version) = tokio::sync::watch::channel(None);
        let browser = Arc::new(Browser {
            cdp,
            pid: child.id(),
            sandbox: sandbox.enabled,
            child: Mutex::new(Some(child)),
            user_data,
            version,
        });
        let handshake = browser.clone();
        tokio::spawn(async move {
            let reply = timeout(
                Duration::from_secs(10),
                handshake.cdp.send(None, "Browser.getVersion", json!({})),
            )
            .await;
            let outcome = match reply {
                Ok(Ok(version)) => {
                    let product = version.get("product").and_then(Value::as_str).unwrap_or("");
                    Ok(product
                        .split_once('/')
                        .map_or(product, |(_, version)| version)
                        .to_string())
                }
                Ok(Err(error)) => {
                    let message = format!("{error:#}");
                    let failure = if message.contains("Browser connection closed") {
                        StartFailure::Closed
                    } else {
                        StartFailure::Other
                    };
                    Err((format!("Chromium did not start: {message}{hint}"), failure))
                }
                Err(_) => Err((
                    format!("Chromium did not start within 10000ms{hint}"),
                    StartFailure::Other,
                )),
            };
            let _ = report.send(Some(outcome));
        });
        Ok(browser)
    }

    /// How the handshake failed, once it has finished, or `None` if Chromium started.
    pub async fn start_failure(&self) -> Option<StartFailure> {
        let mut version = self.version.clone();
        let outcome = version.wait_for(Option::is_some).await.ok()?.clone();
        match outcome {
            Some(Err((_, failure))) => Some(failure),
            _ => None,
        }
    }

    /// The browser version once the handshake succeeds.
    pub async fn ready(&self) -> Result<String> {
        let mut version = self.version.clone();
        let outcome = version
            .wait_for(Option::is_some)
            .await
            .map_err(|_| anyhow!("Chromium did not start"))?;
        outcome
            .clone()
            .unwrap_or_else(|| Err(("Chromium did not start".into(), StartFailure::Other)))
            .map_err(|(message, _)| anyhow!(message))
    }

    pub async fn close(&self) {
        let child = self.child.lock().unwrap().take();
        if let Some(mut child) = child {
            let started = matches!(*self.version.borrow(), Some(Ok(_)));
            if started {
                let _ = timeout(
                    Duration::from_millis(1000),
                    self.cdp.send(None, "Browser.close", json!({})),
                )
                .await;
                let deadline = Instant::now() + Duration::from_millis(2000);
                while !child.exited() && Instant::now() < deadline {
                    sleep(Duration::from_millis(10)).await;
                }
            }
            // Its own process group (a job on Windows): stop the browser if it did not exit,
            // and any descendant that outlived it. The browser is not reaped until after this,
            // so its id, which names the group, cannot have been reused.
            child.kill_tree();
            child.wait();
        }
        process::remove_tree(&self.user_data);
    }

    /// Stop the browser group immediately, without waiting: for a host losing its owner.
    /// The browser has not been reaped, so the group id is still its own.
    pub fn kill(&self) {
        if let Some(child) = self.child.lock().unwrap().as_ref() {
            child.kill_tree();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRequest {
    pub name: String,
    #[serde(default)]
    pub screenshot: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRunRequest {
    pub driver: String,
    pub target: String,
    pub scenario: Value,
    pub capture_plan: Value,
    #[serde(default)]
    pub screenshots: HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointCapture {
    pub key: Option<String>,
    pub name: String,
    pub step: Option<u64>,
    pub captured: Value,
    pub snapshot: String,
    pub screenshot: Option<String>,
    pub accessibility: Option<Value>,
    pub console: Messages,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub entry: Value,
    pub context: Value,
    pub checkpoint: String,
    pub timeout_ms: u64,
    pub screenshot: Option<String>,
    /// A retained story's requested context, which the page completes from the story.
    #[serde(default)]
    pub requested: Option<Value>,
    #[serde(default)]
    pub defaults: Option<Value>,
    /// A suite's capture mode: `all`, `failed` or `none`. Absent, every render captures.
    #[serde(default)]
    pub capture: Option<String>,
    /// Use the built bundle without checking its sources, as a suite does after checking once.
    #[serde(default)]
    pub reuse_bundle: bool,
    /// Run an accessibility check at the checkpoint, as `specimen-a11y` asks.
    #[serde(default)]
    pub accessibility: bool,
    /// Check a retained story's run again once it has settled (`test.settledAccessibility`).
    #[serde(default)]
    pub settled: bool,
    /// Measure the page at the checkpoint, as `specimen-profile` asks.
    #[serde(default)]
    pub profile: bool,
    /// Inspect instead of capturing: `{ schema }`, the component's schema from the manifest.
    #[serde(default)]
    pub inspect: Option<Value>,
    /// Resolve a point target (`{ selector }` or `{ role, name? }`) to its positional ref.
    #[serde(default)]
    pub resolve_target: Option<Value>,
    /// Collect normalized visible text (capped at 200 chars) per element ref for `specimen-point`.
    #[serde(default)]
    pub collect_texts: bool,
    /// Optional ISO-8601 instant pinning `Date` and positive-delay timers before any module loads.
    #[serde(default)]
    pub pin_clock: Option<String>,
    /// Optional list of named checkpoints to capture in a single fresh pass (empty = all `{ capture }` steps).
    #[serde(default)]
    pub checkpoints: Option<Vec<CheckpointRequest>>,
    /// Optional directory for auto-named checkpoint screenshots when `checkpoints` is empty.
    #[serde(default)]
    pub screenshots_dir: Option<String>,
    /// Optional in-page job driver run coordinated via CDP bindings.
    #[serde(default)]
    pub job_run: Option<JobRunRequest>,
    /// Optional native portable pattern gate run (`spec.md` §4.3).
    #[serde(default)]
    pub gate: Option<GateRunRequest>,
}

pub struct RenderOutcome {
    pub captured: Value,
    pub snapshot: String,
    pub screenshot: Option<String>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    /// The context the page rendered in: the request's, or a retained story's own.
    pub context: Value,
    /// A retained story's run: its play and accessibility check.
    pub outcome: Option<Value>,
    /// An accessibility check the request asked for, apart from a retained story's run.
    pub accessibility: Option<Value>,
    /// The page's measurements at the checkpoint, when the request asked for them.
    pub profile: Option<Value>,
    /// Positional ref resolved for `resolve_target`, when requested.
    pub resolved_target_ref: Option<String>,
    /// Normalized visible text per element ref, when `collect_texts` was requested.
    pub element_texts: Option<Value>,
    /// Slotted element -> assigned `<slot>` ref map, when `collect_texts` was requested.
    pub slotted_parents: Option<Value>,
    /// Multiple kept checkpoints captured during a single fresh pass.
    pub captures: Option<Vec<CheckpointCapture>>,
    /// Final step outcomes returned by an in-page job driver.
    pub job_outcome: Option<Value>,
}

/// What one attempt produced before its context was disposed.
#[derive(Default)]
struct Attempted {
    captured: Value,
    snapshot: String,
    screenshot: Option<String>,
    context: Value,
    outcome: Option<Value>,
    accessibility: Option<Value>,
    profile: Option<Value>,
    resolved_target_ref: Option<String>,
    element_texts: Option<Value>,
    slotted_parents: Option<Value>,
    captures: Option<Vec<CheckpointCapture>>,
    job_outcome: Option<Value>,
}

/// Structured metadata attached to a typed host failure (e.g. `TARGET_NOT_FOUND`, `TARGET_AMBIGUOUS`).
#[derive(Debug)]
pub struct StructuredFailure {
    pub code: String,
    pub suggestion: String,
    pub details: Value,
}

/// A failure the client re-raises: one message, or the render and disposal failures together.
#[derive(Debug)]
pub struct RenderFailure {
    pub message: String,
    pub causes: Vec<String>,
    pub structured: Option<Box<StructuredFailure>>,
}

impl From<anyhow::Error> for RenderFailure {
    fn from(error: anyhow::Error) -> Self {
        let structured = error
            .chain()
            .find_map(|cause| cause.downcast_ref::<crate::page::TargetError>())
            .map(|err| {
                Box::new(StructuredFailure {
                    code: err.code().to_string(),
                    suggestion: err.suggestion(),
                    details: err.details(),
                })
            });
        RenderFailure {
            message: format!("{error:#}"),
            causes: Vec::new(),
            structured,
        }
    }
}

/// Resolves once the bench runtime is installed in the navigated document.
const RUNTIME_READY: &str = "new Promise((resolve) => { const check = () => window.__specimen ? resolve(true) : setTimeout(check, document.readyState === 'loading' ? 0 : 10); check(); })";

/// What a render has created so far, so cleanup can undo exactly that after any failure.
#[derive(Default)]
struct Attempt {
    context: Mutex<Option<Value>>,
    session: Mutex<Option<String>>,
    collector: Mutex<Option<Collector>>,
    ready: std::sync::atomic::AtomicBool,
    /// What the attempt is doing, for the deadline's message.
    phase: Mutex<&'static str>,
}

/// The binding `vitest/browser`'s stand-in calls, in `src/browser/vitest-browser.ts`.
const INPUT_BINDING: &str = "__specimenInput";
/// The binding an in-page `JobDriver` calls for actions, commands, and checkpoint captures.
const JOB_BINDING: &str = "__specimenJob";

#[derive(serde::Deserialize)]
struct InputCall {
    id: u64,
    keys: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobBridgeCall {
    id: u64,
    token: String,
    op: String,
    #[serde(default)]
    action: Option<Value>,
    #[serde(default)]
    runner: Option<String>,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<Value>,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    step: Option<u64>,
}

const RUN_PHASE: &str = "running the story's play and accessibility check";

impl Attempt {
    fn enter(&self, phase: &'static str) {
        *self.phase.lock().unwrap() = phase;
    }

    fn snapshot_console(&self) -> Messages {
        self.collector
            .lock()
            .unwrap()
            .as_mut()
            .map(Collector::snapshot)
            .unwrap_or_default()
    }

    /// The phase for a deadline's message. A story's run asks the page which stage it reached;
    /// a page that does not answer has a script blocking it.
    async fn deadline_phase(&self, cdp: &crate::cdp::Cdp) -> &'static str {
        let phase = *self.phase.lock().unwrap();
        let session = self.session.lock().unwrap().clone();
        let (RUN_PHASE, Some(session)) = (phase, session) else {
            return phase;
        };
        let page = Page { cdp, session };
        match timeout(
            Duration::from_millis(500),
            page.evaluate("window.__specimenStage ?? null"),
        )
        .await
        {
            Err(_) => "running the story, with a script blocking the page",
            Ok(Ok(Value::String(stage))) if stage == "accessibility" => {
                "running the accessibility check"
            }
            Ok(Ok(Value::String(stage))) if stage == "play" => "running the story's play",
            _ => phase,
        }
    }
}

impl Browser {
    /// Render one case in a fresh browser context. Everything from creating the context to
    /// capture is bounded by the request's deadline. Disposal and closing the context are each
    /// bounded by at most one second more. Bundling and browser startup come first, with their
    /// own bounds, as the Playwright runtime's bundle step and launch did.
    pub async fn render(
        &self,
        url: &str,
        network: &Network,
        request: &RenderRequest,
    ) -> Result<RenderOutcome, RenderFailure> {
        // Startup has its own bound, as the browser launch does in Playwright.
        self.ready().await?;
        let attempt = Attempt::default();
        let attempt_deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
        let (outcome, timed_out) = match timeout(
            Duration::from_millis(request.timeout_ms),
            self.attempt(&attempt, url, network, request, attempt_deadline),
        )
        .await
        {
            Ok(result) => (result, false),
            Err(_) => (
                Err(anyhow!(
                    "Specimen deadline exceeded after {}ms while {}",
                    request.timeout_ms,
                    attempt.deadline_phase(&self.cdp).await
                )),
                true,
            ),
        };
        let session = attempt.session.lock().unwrap().clone();
        let dispose_budget = request.timeout_ms.min(1000);
        // A retained story has nothing of its own to dispose: Storybook has no such step, and the
        // context closes next. Asking a page still busy with a heavy story would only time out.
        let retained = request.entry.get("story").is_some_and(Value::is_object);
        let disposal = match &session {
            Some(session)
                if !retained && attempt.ready.load(std::sync::atomic::Ordering::SeqCst) =>
            {
                let page = Page {
                    cdp: &self.cdp,
                    session: session.clone(),
                };
                if timed_out {
                    let _ = timeout(
                        Duration::from_millis(200),
                        page.evaluate("window.__specimen.cancel?.()"),
                    )
                    .await;
                }
                match timeout(
                    Duration::from_millis(dispose_budget),
                    page.evaluate("window.__specimen.dispose()"),
                )
                .await
                {
                    Ok(result) => result.map(|_| ()),
                    Err(_) => Err(anyhow!(
                        "Specimen deadline exceeded after {dispose_budget}ms"
                    )),
                }
            }
            _ => Ok(()),
        };
        let collector = attempt.collector.lock().unwrap().take();
        let Messages { errors, warnings } = collector
            .map(|mut collector| collector.take())
            .unwrap_or_default();
        if let Some(session) = &session {
            self.cdp.unsubscribe(session);
        }
        let context = attempt.context.lock().unwrap().take();
        if let Some(context) = context {
            let close = self.cdp.send(
                None,
                "Target.disposeBrowserContext",
                json!({ "browserContextId": context }),
            );
            let _ = timeout(Duration::from_millis(1000), close).await;
        }
        match (outcome, disposal) {
            (Ok(attempted), Ok(())) => Ok(RenderOutcome {
                captured: attempted.captured,
                snapshot: attempted.snapshot,
                screenshot: attempted.screenshot,
                errors,
                warnings,
                context: attempted.context,
                outcome: attempted.outcome,
                accessibility: attempted.accessibility,
                profile: attempted.profile,
                resolved_target_ref: attempted.resolved_target_ref,
                element_texts: attempted.element_texts,
                slotted_parents: attempted.slotted_parents,
                captures: attempted.captures,
                job_outcome: attempted.job_outcome,
            }),
            (Ok(_), Err(failure)) => Err(failure.into()),
            // The page's own errors usually explain a render that failed or never became ready.
            (Err(failure), Ok(())) if !errors.is_empty() => {
                let mut rendered = RenderFailure::from(failure);
                rendered.message =
                    format!("{}; page errors: {}", rendered.message, errors.join("; "));
                Err(rendered)
            }
            (Err(failure), Ok(())) => Err(failure.into()),
            (Err(render), Err(disposal)) => {
                let primary = RenderFailure::from(render);
                Err(RenderFailure {
                    message: format!(
                        "Specimen render and disposal failed: {}; {disposal:#}",
                        primary.message
                    ),
                    causes: vec![primary.message, format!("{disposal:#}")],
                    structured: primary.structured,
                })
            }
        }
    }

    async fn attempt(
        &self,
        attempt: &Attempt,
        url: &str,
        network: &Network,
        request: &RenderRequest,
        attempt_deadline: Instant,
    ) -> Result<Attempted> {
        attempt.enter("opening the page");
        let context = self
            .cdp
            .send(
                None,
                "Target.createBrowserContext",
                json!({
                    "disposeOnDetach": true,
                    "proxyServer": network.proxy_server,
                    "proxyBypassList": network.bypass_list,
                }),
            )
            .await?
            .get("browserContextId")
            .cloned()
            .ok_or_else(|| anyhow!("Chromium did not create a browser context"))?;
        *attempt.context.lock().unwrap() = Some(context.clone());
        let target = self
            .cdp
            .send(
                None,
                "Target.createTarget",
                json!({ "url": "about:blank", "browserContextId": context }),
            )
            .await?;
        let attached = self
            .cdp
            .send(
                None,
                "Target.attachToTarget",
                json!({ "targetId": target.get("targetId"), "flatten": true }),
            )
            .await?;
        let session = attached
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("Chromium did not attach to the page"))?
            .to_string();
        *attempt.session.lock().unwrap() = Some(session.clone());
        *attempt.collector.lock().unwrap() = Some(Collector::new(self.cdp.subscribe(&session)));
        let page = Page {
            cdp: &self.cdp,
            session,
        };
        let viewport = prepare(&page, &request.context).await?;
        let mut input = None;
        page.mouse("mouseMoved", -1.0, -1.0).await?;
        // Storybook's test helpers instrument themselves only inside an iframe, as its Vitest
        // runner has them, unless the URL asks; a retained story's play runs them the same way.
        let retained = request.entry.get("story").is_some_and(Value::is_object);
        if retained {
            input = Some(self.cdp.subscribe_bindings(&page.session));
            page.send("Runtime.addBinding", json!({ "name": INPUT_BINDING }))
                .await?;
        }
        let address = format!(
            "{url}specimen.html?automation=1{}",
            if retained { "&instrument=true" } else { "" }
        );
        crate::navigate::navigate_with_retry(&address, attempt_deadline, || {
            page.send(
                "Page.navigate",
                json!({ "url": address, "referrerPolicy": "unsafeUrl" }),
            )
        })
        .await?;
        // A reply from the document being replaced is retried in the navigated one.
        while page.evaluate(RUNTIME_READY).await.ok() != Some(Value::Bool(true)) {
            sleep(Duration::from_millis(5)).await;
        }
        attempt
            .ready
            .store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(clock) = &request.pin_clock {
            page.evaluate(&format!(
                "window.__specimen.pinClock({})",
                serde_json::to_string(clock)?
            ))
            .await?;
        }
        if let Some(inspect) = &request.inspect {
            let schema = inspect.get("schema").cloned().unwrap_or(Value::Null);
            let inspected = page
                .evaluate(&format!(
                    "window.__specimen.inspect({}, {}, {}, {})",
                    request.entry,
                    request.requested.clone().unwrap_or(json!({})),
                    request
                        .defaults
                        .clone()
                        .unwrap_or_else(|| request.context.clone()),
                    schema
                ))
                .await?;
            let context = inspected
                .get("context")
                .cloned()
                .unwrap_or_else(|| request.context.clone());
            return Ok(Attempted {
                captured: inspected,
                snapshot: String::new(),
                screenshot: None,
                context,
                outcome: None,
                accessibility: None,
                profile: None,
                resolved_target_ref: None,
                element_texts: None,
                slotted_parents: None,
                captures: None,
                job_outcome: None,
            });
        }
        let mut context = request.context.clone();
        if let Some(job_run) = &request.job_run {
            let mut bridge = self.cdp.subscribe_bindings(&page.session);
            page.send("Runtime.addBinding", json!({ "name": JOB_BINDING }))
                .await?;
            attempt.enter("mounting the job specimen");
            let mounted = page
                .evaluate(&format!(
                    "window.__specimen.mount({}, {})",
                    request.entry, request.context
                ))
                .await?;
            let targets = mounted.get("targets").cloned().unwrap_or(json!({}));
            if mounted
                .get("events")
                .and_then(Value::as_array)
                .is_some_and(|events| !events.is_empty())
            {
                page.bind_event_targets(&mounted, &targets).await?;
            }
            let target_object = if let Some(target_def) = targets.get(&job_run.target) {
                page.target(&job_run.target, target_def).await?
            } else if job_run.target == "root" {
                page.root_object_id().await?
            } else {
                return Err(anyhow!(
                    "Job target '{}' is not declared on specimen targets",
                    job_run.target
                ));
            };
            attempt.enter("running the job scenario");
            let bridge_token = uuid::Uuid::new_v4().to_string();
            let allowed_captures: std::collections::HashSet<(String, String, u64)> = job_run
                .capture_plan
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| {
                    let key = item.get("key")?.as_str()?.to_string();
                    let name = item.get("name")?.as_str()?.to_string();
                    let step = item.get("step")?.as_u64()?;
                    Some((key, name, step))
                })
                .collect();
            let payload = json!({
                "driver": job_run.driver,
                "targets": targets,
                "scenario": job_run.scenario,
                "capturePlan": job_run.capture_plan,
                "bridgeToken": bridge_token,
            });
            let run = page.call(
                &target_object,
                "function (entry, context, payload) { return window.__specimen.runJob(this, entry, context, payload); }",
                json!([
                    { "value": request.entry },
                    { "value": context },
                    { "value": payload },
                ]),
            );
            let mut captures = Vec::new();
            let job_outcome = run_with_job_bridge(
                attempt,
                &page,
                run,
                &mut bridge,
                &bridge_token,
                &allowed_captures,
                &targets,
                &viewport,
                &job_run.screenshots,
                request.accessibility,
                &mut captures,
            )
            .await?;
            return Ok(Attempted {
                captured: Value::Null,
                snapshot: String::new(),
                screenshot: None,
                context,
                outcome: None,
                accessibility: None,
                profile: None,
                resolved_target_ref: None,
                element_texts: None,
                slotted_parents: None,
                captures: Some(captures),
                job_outcome: Some(job_outcome),
            });
        }
        if let Some(checkpoints) = &request.checkpoints {
            attempt.enter("mounting the specimen");
            let mounted = page
                .evaluate(&format!(
                    "window.__specimen.mount({}, {})",
                    request.entry, request.context
                ))
                .await?;
            let targets = mounted.get("targets").cloned().unwrap_or(json!({}));
            let events_declared = mounted
                .get("events")
                .and_then(Value::as_array)
                .is_some_and(|events| !events.is_empty());
            if events_declared {
                page.bind_event_targets(&mounted, &targets).await?;
            }
            let steps = mounted
                .get("scenario")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let declared_names: Vec<String> = steps
                .iter()
                .filter_map(|step| {
                    step.get("capture")
                        .and_then(Value::as_str)
                        .map(String::from)
                })
                .collect();
            let mut seen_names = std::collections::HashSet::new();
            for requested_cp in checkpoints {
                if !seen_names.insert(requested_cp.name.as_str()) {
                    return Err(anyhow!(
                        "Duplicate checkpoint requested: {}",
                        requested_cp.name
                    ));
                }
                if requested_cp.name != "mount"
                    && requested_cp.name != "after-run"
                    && !declared_names.contains(&requested_cp.name)
                {
                    return Err(anyhow!("Checkpoint not found: {}", requested_cp.name));
                }
            }
            let by_name: HashMap<&str, &CheckpointRequest> = checkpoints
                .iter()
                .map(|cp| (cp.name.as_str(), cp))
                .collect();
            let capture_all = checkpoints.is_empty();
            let mut captures = Vec::new();
            let resolve_shot =
                |step_ordinal: u64, req: Option<&CheckpointRequest>| -> Option<String> {
                    if let Some(explicit) = req.and_then(|item| item.screenshot.as_deref()) {
                        return Some(explicit.to_string());
                    }
                    request.screenshots_dir.as_ref().map(|dir| {
                        std::path::Path::new(dir)
                            .join(format!("cp-{step_ordinal}.png"))
                            .display()
                            .to_string()
                    })
                };

            if let Some(mount_cp) = by_name.get("mount").copied() {
                attempt.enter("capturing checkpoint");
                let shot_path = resolve_shot(0, Some(mount_cp));
                captures.push(
                    take_capture(
                        attempt,
                        &page,
                        &viewport,
                        shot_path.as_deref(),
                        request.accessibility,
                        "mount".to_string(),
                        None,
                        Some(0),
                    )
                    .await?,
                );
            }

            let needs_after_run = by_name.contains_key("after-run");
            let mut remaining_named: std::collections::HashSet<&str> = checkpoints
                .iter()
                .map(|cp| cp.name.as_str())
                .filter(|name| *name != "mount" && *name != "after-run")
                .collect();

            if capture_all || !remaining_named.is_empty() || needs_after_run {
                attempt.enter("running the specimen's scenario");
                let mut scenario_capture_step: u64 = 0;
                let mut keyboard = Keyboard::default();
                for step in &steps {
                    if let Some(capture_name) = step.get("capture").and_then(Value::as_str) {
                        scenario_capture_step += 1;
                        if capture_all || remaining_named.remove(capture_name) {
                            attempt.enter("capturing checkpoint");
                            let req = by_name.get(capture_name).copied();
                            let shot_path = resolve_shot(scenario_capture_step, req);
                            captures.push(
                                take_capture(
                                    attempt,
                                    &page,
                                    &viewport,
                                    shot_path.as_deref(),
                                    request.accessibility,
                                    capture_name.to_string(),
                                    None,
                                    Some(scenario_capture_step),
                                )
                                .await?,
                            );
                            if !capture_all && remaining_named.is_empty() && !needs_after_run {
                                break;
                            }
                            attempt.enter("running the specimen's scenario");
                        }
                        continue;
                    }
                    page.run_step(&mounted, &targets, events_declared, step, &mut keyboard)
                        .await?;
                }
            }

            if let Some(after_cp) = by_name.get("after-run").copied() {
                attempt.enter("capturing checkpoint");
                let after_step = declared_names.len() as u64 + 1;
                let shot_path = resolve_shot(after_step, Some(after_cp));
                captures.push(
                    take_capture(
                        attempt,
                        &page,
                        &viewport,
                        shot_path.as_deref(),
                        request.accessibility,
                        "after-run".to_string(),
                        None,
                        Some(after_step),
                    )
                    .await?,
                );
            }

            return Ok(Attempted {
                context,
                captures: Some(captures),
                ..Default::default()
            });
        }
        let mut outcome = None;
        if let Some(gate) = &request.gate {
            let capture_on_failure = request.capture.as_deref() != Some("none");
            match run_gate(
                &page,
                gate,
                &request.entry,
                retained,
                &context,
                request.timeout_ms,
                attempt_deadline,
                capture_on_failure,
                |phase| attempt.enter(phase),
            )
            .await?
            {
                GateExec::MountFailed(failure_outcome) => {
                    return Ok(Attempted {
                        context,
                        outcome: Some(failure_outcome),
                        ..Default::default()
                    });
                }
                GateExec::Completed(gate_outcome) => outcome = Some(gate_outcome),
            }
        } else if retained {
            if !matches!(request.checkpoint.as_str(), "mount" | "after-run") {
                return Err(anyhow!(
                    "A retained story has the mount and after-run checkpoints, not '{}'",
                    request.checkpoint
                ));
            }
            // The story settles its own viewport and theme; emulate what it resolves to.
            attempt.enter("loading the story's modules");
            let check = request.checkpoint == "after-run" || request.accessibility;
            let resolved = page
                .evaluate(&format!(
                    "window.__specimen.resolve({}, {}, {}, {{ check: {check} }})",
                    request.entry,
                    request.requested.clone().unwrap_or(json!({})),
                    request
                        .defaults
                        .clone()
                        .unwrap_or_else(|| request.context.clone())
                ))
                .await?;
            context = resolved
                .get("context")
                .cloned()
                .ok_or_else(|| anyhow!("The page did not resolve the story's context"))?;
            emulate(&page, &context).await?;
            if request.checkpoint == "after-run" {
                attempt.enter(RUN_PHASE);
                let expression = format!(
                    "window.__specimen.mountAndRun({}, {}, {{ settled: {} }})",
                    request.entry, context, request.settled
                );
                let run = page.evaluate(&expression);
                outcome = Some(match input.as_mut() {
                    Some(input) => run_with_input(&page, run, input).await?,
                    None => run.await?,
                });
            } else {
                attempt.enter("rendering the story");
                page.evaluate(&format!(
                    "window.__specimen.mount({}, {})",
                    request.entry, context
                ))
                .await?;
            }
        } else {
            attempt.enter("mounting the specimen");
            let mounted = page
                .evaluate(&format!(
                    "window.__specimen.mount({}, {})",
                    request.entry, request.context
                ))
                .await?;
            attempt.enter("running the specimen's scenario");
            page.steps(&mounted, &request.checkpoint).await?;
        }
        // A retained story's run has its own check, under its policy, in its outcome; a gate
        // run does not run axe unless requested (e.g. explicit `specimen-capture` with `axe: true`).
        let accessibility =
            if request.accessibility && (outcome.is_none() || request.gate.is_some()) {
                attempt.enter("running the accessibility check");
                Some(
                    page.evaluate("window.__specimen.checkAccessibility()")
                        .await?,
                )
            } else {
                None
            };
        let mut profile = if request.profile {
            attempt.enter("measuring the page");
            let mut metrics = page.evaluate("window.__specimen.profileMetrics()").await?;
            let heap = page.send("Runtime.getHeapUsage", json!({})).await?;
            metrics["usedJSHeapSizeBytes"] = heap.get("usedSize").cloned().unwrap_or(Value::Null);
            Some(metrics)
        } else {
            None
        };
        let story_status = outcome
            .as_ref()
            .and_then(|outcome| outcome.get("status"))
            .and_then(Value::as_str);
        let keep = match request.capture.as_deref() {
            Some("none") => false,
            Some("failed") => story_status == Some("failed"),
            _ => true,
        };
        if !keep {
            return Ok(Attempted {
                context,
                outcome,
                accessibility,
                profile,
                ..Default::default()
            });
        }
        let resolved_target_ref = if let Some(target) = &request.resolve_target {
            attempt.enter("resolving the point target");
            Some(page.target_ref(target).await?)
        } else {
            None
        };
        let (element_texts, slotted_parents) = if request.collect_texts {
            attempt.enter("collecting element text");
            let (texts, slotted) = page.point_meta().await?;
            (Some(texts), Some(slotted))
        } else {
            (None, None)
        };
        attempt.enter("capturing the result");
        let capture_started = std::time::Instant::now();
        let viewport: Viewport =
            serde_json::from_value(context.get("viewport").cloned().unwrap_or(Value::Null))
                .unwrap_or(viewport);
        let point = take_capture(
            attempt,
            &page,
            &viewport,
            request.screenshot.as_deref(),
            false,
            request.checkpoint.clone(),
            None,
            None,
        )
        .await?;
        if let Some(profile) = profile.as_mut() {
            profile["captureMs"] = json!(capture_started.elapsed().as_secs_f64() * 1000.0);
        }
        Ok(Attempted {
            captured: point.captured,
            snapshot: point.snapshot,
            screenshot: point.screenshot,
            context,
            outcome,
            accessibility,
            profile,
            resolved_target_ref,
            element_texts,
            slotted_parents,
            captures: None,
            job_outcome: None,
        })
    }
}

/// Capture observation, ARIA snapshot + roles, optional axe check, and optional screenshot at the
/// page's current state without disposing the browser context.
#[allow(clippy::too_many_arguments)]
async fn take_capture(
    attempt: &Attempt,
    page: &Page<'_>,
    viewport: &Viewport,
    screenshot_path: Option<&str>,
    accessibility: bool,
    name: String,
    key: Option<String>,
    step: Option<u64>,
) -> Result<CheckpointCapture> {
    let axe = if accessibility {
        Some(
            page.evaluate("window.__specimen.checkAccessibility()")
                .await?,
        )
    } else {
        None
    };
    // The DOM is normalized in the page, by the same `normalizeDom` the API exports.
    let mut captured = page
        .evaluate("(async () => { const captured = window.__specimen.capture(); captured.normalized = await window.__specimen.normalize(captured.dom); return captured; })()")
        .await?;
    let root = page.root_backend_id().await?;
    let tree = page.send("Accessibility.getFullAXTree", json!({})).await?;
    let dom = page.subtree(root).await?;
    let snapshot = match aria::snapshot(&tree, root) {
        Some(snapshot) => snapshot,
        // A modal dialog has left the mount root out of the tree (#662).
        None => aria::exposed_within(&tree, &crate::page::backend_ids(&dom)),
    };
    // Each accessible element's computed role and name, by the reference the page gave it.
    // The tree is read after the page's capture: if the page changed in between, references
    // no longer name the same elements, and no role is recorded rather than a wrong one.
    let roles = aria::roles(&tree, &dom);
    let page_references: std::collections::HashSet<String> = captured
        .get("elements")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|element| element.get("ref").and_then(Value::as_str))
        .filter(|reference| *reference != "root")
        .map(String::from)
        .collect();
    if page_references == roles.references {
        if let Some(elements) = captured.get_mut("elements").and_then(Value::as_array_mut) {
            for element in elements {
                let accessible = element
                    .get("ref")
                    .and_then(Value::as_str)
                    .and_then(|reference| roles.accessible.get(reference));
                if let (Some(accessible), Some(element)) = (accessible, element.as_object_mut()) {
                    element.insert("accessibility".into(), json!(accessible));
                }
            }
        }
    } else if let Some(limitations) = captured
        .get_mut("limitations")
        .and_then(Value::as_array_mut)
    {
        limitations.push(json!(
            "The page changed between its capture and the accessibility tree's, so no element's role is recorded."
        ));
    }
    let shot = match screenshot_path {
        Some(path) => Some(screenshot(page, path, viewport).await?),
        None => None,
    };
    let console = attempt.snapshot_console();
    Ok(CheckpointCapture {
        key,
        name,
        step,
        captured,
        snapshot,
        screenshot: shot,
        accessibility: axe,
        console,
    })
}

/// Drive an in-page `JobDriver`, answering its real-input actions, commands, and checkpoint
/// captures on the live page until the driver finishes.
#[allow(clippy::too_many_arguments)]
async fn run_with_job_bridge(
    attempt: &Attempt,
    page: &Page<'_>,
    run: impl std::future::Future<Output = Result<Value>>,
    bridge: &mut tokio::sync::mpsc::UnboundedReceiver<crate::cdp::Event>,
    bridge_token: &str,
    allowed_captures: &std::collections::HashSet<(String, String, u64)>,
    targets: &Value,
    viewport: &Viewport,
    screenshots: &HashMap<String, String>,
    accessibility: bool,
    captures: &mut Vec<CheckpointCapture>,
) -> Result<Value> {
    tokio::pin!(run);
    let mut expected_context_id: Option<i64> = None;
    let mut keyboard = Keyboard::default();
    loop {
        tokio::select! {
            result = &mut run => return result,
            Some(event) = bridge.recv() => {
                if event.params.get("name").and_then(Value::as_str) != Some(JOB_BINDING) {
                    continue;
                }
                let Ok(call) = serde_json::from_str::<JobBridgeCall>(
                    event.params.get("payload").and_then(Value::as_str).unwrap_or(""),
                ) else {
                    continue;
                };
                if call.token != bridge_token {
                    continue;
                }
                let context_id = event.params.get("executionContextId").and_then(Value::as_i64);
                match (expected_context_id, context_id) {
                    (Some(expected), Some(actual)) if expected != actual => continue,
                    (None, Some(actual)) => expected_context_id = Some(actual),
                    _ => {}
                }
                let outcome: Result<Value> = match call.op.as_str() {
                    "action" => {
                        let action = call.action.unwrap_or(Value::Null);
                        page.act(&action, targets, &mut keyboard).await.map(|()| Value::Null)
                    }
                    "command" => {
                        let cmd = json!({
                            "runner": call.runner.unwrap_or_default(),
                            "target": call.target.unwrap_or_default(),
                            "name": call.name.unwrap_or_default(),
                            "input": call.input.unwrap_or(Value::Null),
                        });
                        page.command_value(&cmd, targets).await
                    }
                    "capture" => {
                        let key = call.key.clone().unwrap_or_default();
                        let name = call.name.clone().unwrap_or_default();
                        let step = call.step;
                        if let Some(step_num) = step
                            && allowed_captures.contains(&(key.clone(), name.clone(), step_num))
                        {
                            let shot_path = screenshots.get(&key).map(String::as_str);
                            take_capture(
                                attempt,
                                page,
                                viewport,
                                shot_path,
                                accessibility,
                                name,
                                Some(key),
                                Some(step_num),
                            )
                            .await
                            .map(|point| {
                                let shot = point.screenshot.clone();
                                captures.push(point);
                                json!({ "screenshot": shot })
                            })
                        } else {
                            Err(anyhow!(
                                "Unexpected job capture request for key='{key}', name='{name}', step={step:?}"
                            ))
                        }
                    }
                    other => Err(anyhow!("Unsupported job bridge operation: {other}")),
                };
                let (error, value) = match outcome {
                    Ok(val) => (None, val),
                    Err(err) => (Some(format!("{err:#}")), Value::Null),
                };
                let expression = format!(
                    "window.__specimenJobDone({}, {}, {})",
                    call.id,
                    serde_json::to_string(&error)?,
                    serde_json::to_string(&value)?,
                );
                let mut reply = json!({
                    "expression": expression,
                    "awaitPromise": true,
                    "returnByValue": true,
                });
                if let Some(ctx_id) = expected_context_id {
                    reply["contextId"] = json!(ctx_id);
                }
                page.send("Runtime.evaluate", reply).await?;
            }
        }
    }
}

/// Run a retained story, answering its `userEvent.keyboard` calls while it runs.
async fn run_with_input(
    page: &Page<'_>,
    run: impl std::future::Future<Output = Result<Value>>,
    input: &mut tokio::sync::mpsc::UnboundedReceiver<crate::cdp::Event>,
) -> Result<Value> {
    tokio::pin!(run);
    let mut keyboard = Keyboard::default();
    loop {
        tokio::select! {
            result = &mut run => return result,
            Some(event) = input.recv() => {
                let call: InputCall = serde_json::from_str(
                    event.params.get("payload").and_then(Value::as_str).unwrap_or(""),
                )?;
                let error = keyboard.press(page, &call.keys).await.err().map(|error| error.to_string());
                page.evaluate(&format!(
                    "window.__specimenInputDone({}, {})",
                    call.id,
                    serde_json::to_string(&error)?
                ))
                .await?;
            }
        }
    }
}

/// A full-page screenshot as Playwright takes one: the format from the path's extension, the
/// page size from the document's largest scroll, offset and client extents.
async fn screenshot(page: &Page<'_>, path: &str, viewport: &Viewport) -> Result<String> {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    let (format, quality) = match extension.as_deref() {
        Some("png") => ("png", None),
        Some("jpg" | "jpeg") => ("jpeg", Some(80)),
        Some("webp") => ("webp", Some(100)),
        other => {
            let mime = match other {
                Some("gif") => "image/gif",
                Some("bmp") => "image/bmp",
                Some("svg") => "image/svg+xml",
                Some("avif") => "image/avif",
                Some("pdf") => "application/pdf",
                _ => "null",
            };
            return Err(anyhow!("path: unsupported mime type \"{mime}\""));
        }
    };
    let size = page
        .evaluate("(() => { const body = document.body, root = document.documentElement; return { width: Math.max(body.scrollWidth, root.scrollWidth, body.offsetWidth, root.offsetWidth, body.clientWidth, root.clientWidth), height: Math.max(body.scrollHeight, root.scrollHeight, body.offsetHeight, root.offsetHeight, body.clientHeight, root.clientHeight) }; })()")
        .await?;
    let dimension = |key: &str| size.get(key).and_then(Value::as_f64).unwrap_or(0.0);
    let (width, height) = (dimension("width"), dimension("height"));
    let fits = width <= viewport.width as f64 && height <= viewport.height as f64;
    let mut params = json!({
        "format": format,
        "clip": { "x": 0, "y": 0, "width": width, "height": height, "scale": 1 },
        "captureBeyondViewport": !fits,
    });
    if let Some(quality) = quality {
        params["quality"] = json!(quality);
    }
    let shot = page.send("Page.captureScreenshot", params).await?;
    let data = shot.get("data").and_then(Value::as_str).unwrap_or("");
    let target = std::path::Path::new(path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(
        target,
        base64::engine::general_purpose::STANDARD.decode(data)?,
    )?;
    Ok(path.to_string())
}

#[cfg(test)]
mod tests {
    use super::{RenderFailure, switches};
    use crate::page::TargetError;
    use anyhow::{Context, anyhow};
    use serde_json::json;

    #[test]
    fn render_failure_extracts_target_error_metadata_even_when_wrapped() {
        let not_found: anyhow::Error = TargetError::NotFound {
            name: "print".into(),
            target: "role \"button\", name \"Print\"".into(),
        }
        .into();
        let wrapped = Err::<(), _>(not_found).context("step 1").unwrap_err();
        let failure = RenderFailure::from(wrapped);
        let structured = failure
            .structured
            .as_deref()
            .expect("expected structured metadata");
        assert_eq!(structured.code, "TARGET_NOT_FOUND");
        assert!(structured.suggestion.contains("review page"));
        assert_eq!(structured.details, json!({ "count": 0, "target": "print" }));

        let ambiguous: anyhow::Error = TargetError::Ambiguous {
            name: "action".into(),
            target: "role \"button\"".into(),
            count: 4,
        }
        .into();
        let failure = RenderFailure::from(ambiguous);
        let structured = failure
            .structured
            .as_deref()
            .expect("expected structured metadata");
        assert_eq!(structured.code, "TARGET_AMBIGUOUS");
        assert!(structured.suggestion.contains("4") && structured.suggestion.contains("name"));
        assert_eq!(
            structured.details,
            json!({ "count": 4, "target": "action" })
        );
    }

    #[test]
    fn chromium_keeps_its_sandbox_unless_it_is_off() {
        let sandboxed = switches("/profile", true);
        assert!(!sandboxed.iter().any(|switch| switch == "--no-sandbox"));
        let unsandboxed = switches("/profile", false);
        assert_eq!(
            unsandboxed
                .iter()
                .filter(|switch| *switch == "--no-sandbox")
                .count(),
            1
        );
        for args in [sandboxed, unsandboxed] {
            assert!(args.iter().any(
                |switch| switch == "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"
            ));
            assert_eq!(args.last().unwrap(), "--user-data-dir=/profile");
        }
    }

    #[test]
    fn render_failure_leaves_untyped_errors_without_structured_fields() {
        let failure = RenderFailure::from(anyhow!("boom"));
        assert_eq!(failure.message, "boom");
        assert!(failure.structured.is_none());
    }
}
