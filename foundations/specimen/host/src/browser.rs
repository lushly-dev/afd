//! Chromium driven directly over CDP. Each render gets a fresh browser context, and pages get
//! the environment Playwright 1.64 gives headless Chromium pages: the same launch switches,
//! default font families, locale, media and metrics emulation. Scenario actions use real
//! input after Playwright's actionability checks. The ARIA snapshot comes from Chromium's own
//! accessibility tree.

use crate::aria;
use crate::cdp::{self, Cdp};
use crate::console::{Collector, Messages};
use crate::keyboard::Keyboard;
use crate::page::{Page, Viewport, emulate, prepare};
use anyhow::{Result, anyhow};
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::process::Child;
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

/// Playwright 1.64's headless Chromium switches, so pages see the same browser environment.
fn switches(user_data: &str) -> Vec<String> {
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
            "--no-sandbox",
            "--remote-debugging-pipe",
            "--no-startup-window",
        ]
        .map(String::from),
    );
    args.push(format!("--user-data-dir={user_data}"));
    args
}

/// Whether the process has exited, without reaping it: until it is reaped its id, and so its
/// process group's, cannot be reused by another process.
fn exited(pid: u32) -> bool {
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    let status = unsafe {
        libc::waitid(
            libc::P_PID,
            pid as libc::id_t,
            &mut info,
            libc::WEXITED | libc::WNOWAIT | libc::WNOHANG,
        )
    };
    status == 0 && unsafe { info.si_pid() } != 0
}

pub struct Browser {
    cdp: Cdp,
    child: Mutex<Option<Child>>,
    /// The browser's process id, which is also its process group.
    pub pid: u32,
    user_data: PathBuf,
    /// The handshake's outcome: the browser version, or why it did not start.
    version: tokio::sync::watch::Receiver<Option<Result<String, String>>>,
}

impl Browser {
    /// Start Chromium now; the CDP handshake completes in the background. Closing never
    /// depends on the handshake, so a browser that never answers is still stopped.
    pub fn spawn(executable: &str, work: &std::path::Path) -> Result<Arc<Browser>> {
        let user_data = work.join(format!("profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&user_data)?;
        let (child, cdp) = cdp::launch(executable, &switches(&user_data.display().to_string()))?;
        let (report, version) = tokio::sync::watch::channel(None);
        let browser = Arc::new(Browser {
            cdp,
            pid: child.id(),
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
                Ok(Err(error)) => Err(format!("Chromium did not start: {error:#}")),
                Err(_) => Err("Chromium did not start within 10000ms".to_string()),
            };
            let _ = report.send(Some(outcome));
        });
        Ok(browser)
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
            .unwrap_or_else(|| Err("Chromium did not start".into()))
            .map_err(|error| anyhow!(error))
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
                while !exited(self.pid) && Instant::now() < deadline {
                    sleep(Duration::from_millis(10)).await;
                }
            }
            // Its own process group: stop the browser if it did not exit, and any descendant
            // that outlived it. The browser is not reaped until after this, so its id, which
            // names the group, cannot have been reused.
            unsafe { libc::killpg(self.pid as i32, libc::SIGKILL) };
            let _ = child.wait();
        }
        let _ = std::fs::remove_dir_all(&self.user_data);
    }

    /// Stop the browser group immediately, without waiting: for a host losing its owner.
    /// The browser has not been reaped, so the group id is still its own.
    pub fn kill(&self) {
        if self.child.lock().unwrap().is_some() {
            unsafe { libc::killpg(self.pid as i32, libc::SIGKILL) };
        }
    }
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
    /// Inspect instead of capturing: `{ schema }`, the component's schema from the manifest.
    #[serde(default)]
    pub inspect: Option<Value>,
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
}

/// What one attempt produced before its context was disposed.
struct Attempted {
    captured: Value,
    snapshot: String,
    screenshot: Option<String>,
    context: Value,
    outcome: Option<Value>,
}

/// A failure the client re-raises: one message, or the render and disposal failures together.
#[derive(Debug)]
pub struct RenderFailure {
    pub message: String,
    pub causes: Vec<String>,
}

impl From<anyhow::Error> for RenderFailure {
    fn from(error: anyhow::Error) -> Self {
        RenderFailure {
            message: format!("{error:#}"),
            causes: Vec::new(),
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

#[derive(serde::Deserialize)]
struct InputCall {
    id: u64,
    keys: String,
}

const RUN_PHASE: &str = "running the story's play and accessibility check";

impl Attempt {
    fn enter(&self, phase: &'static str) {
        *self.phase.lock().unwrap() = phase;
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
        request: &RenderRequest,
    ) -> Result<RenderOutcome, RenderFailure> {
        // Startup has its own bound, as the browser launch does in Playwright.
        self.ready().await?;
        let attempt = Attempt::default();
        let outcome = match timeout(
            Duration::from_millis(request.timeout_ms),
            self.attempt(&attempt, url, request),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(anyhow!(
                "Specimen deadline exceeded after {}ms while {}",
                request.timeout_ms,
                attempt.deadline_phase(&self.cdp).await
            )),
        };
        let session = attempt.session.lock().unwrap().clone();
        let dispose_budget = request.timeout_ms.min(1000);
        let disposal = match &session {
            Some(session) if attempt.ready.load(std::sync::atomic::Ordering::SeqCst) => {
                let page = Page {
                    cdp: &self.cdp,
                    session: session.clone(),
                };
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
            }),
            (Ok(_), Err(failure)) => Err(failure.into()),
            // The page's own errors usually explain a render that failed or never became ready.
            (Err(failure), Ok(())) if !errors.is_empty() => Err(RenderFailure::from(anyhow!(
                "{failure:#}; page errors: {}",
                errors.join("; ")
            ))),
            (Err(failure), Ok(())) => Err(failure.into()),
            (Err(render), Err(disposal)) => Err(RenderFailure {
                message: format!("Specimen render and disposal failed: {render:#}; {disposal:#}"),
                causes: vec![format!("{render:#}"), format!("{disposal:#}")],
            }),
        }
    }

    async fn attempt(
        &self,
        attempt: &Attempt,
        url: &str,
        request: &RenderRequest,
    ) -> Result<Attempted> {
        attempt.enter("opening the page");
        let context = self
            .cdp
            .send(
                None,
                "Target.createBrowserContext",
                json!({ "disposeOnDetach": true }),
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
        let navigated = page
            .send(
                "Page.navigate",
                json!({ "url": address, "referrerPolicy": "unsafeUrl" }),
            )
            .await?;
        if let Some(error) = navigated.get("errorText").and_then(Value::as_str) {
            return Err(anyhow!("{error} at {address}"));
        }
        // A reply from the document being replaced is retried in the navigated one.
        while page.evaluate(RUNTIME_READY).await.ok() != Some(Value::Bool(true)) {
            sleep(Duration::from_millis(5)).await;
        }
        attempt
            .ready
            .store(true, std::sync::atomic::Ordering::SeqCst);
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
            });
        }
        let mut context = request.context.clone();
        let mut outcome = None;
        if retained {
            if !matches!(request.checkpoint.as_str(), "mount" | "after-run") {
                return Err(anyhow!(
                    "A retained story has the mount and after-run checkpoints, not '{}'",
                    request.checkpoint
                ));
            }
            // The story settles its own viewport and theme; emulate what it resolves to.
            attempt.enter("loading the story's modules");
            let resolved = page
                .evaluate(&format!(
                    "window.__specimen.resolve({}, {}, {})",
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
                    "window.__specimen.mountAndRun({}, {})",
                    request.entry, context
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
        attempt.enter("capturing the result");
        // The DOM is normalized in the page, by the same `normalizeDom` the API exports.
        let captured = page
            .evaluate("(async () => { const captured = window.__specimen.capture(); captured.normalized = await window.__specimen.normalize(captured.dom); return captured; })()")
            .await?;
        let root = page.root_backend_id().await?;
        let tree = page.send("Accessibility.getFullAXTree", json!({})).await?;
        let snapshot = aria::snapshot(&tree, root);
        let viewport: Viewport =
            serde_json::from_value(context.get("viewport").cloned().unwrap_or(Value::Null))
                .unwrap_or(viewport);
        let screenshot = match &request.screenshot {
            Some(path) => Some(screenshot(&page, path, &viewport).await?),
            None => None,
        };
        Ok(Attempted {
            captured,
            snapshot,
            screenshot,
            context,
            outcome,
        })
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
