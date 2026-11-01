//! Chromium driven directly over CDP. Each render gets a fresh browser context, and pages get
//! the environment Playwright 1.64 gives headless Chromium pages: the same launch switches,
//! default font families, locale, media and metrics emulation. Scenario actions use real
//! input after Playwright's actionability checks. The ARIA snapshot comes from Chromium's own
//! accessibility tree.

use crate::aria;
use crate::cdp::{self, Cdp};
use crate::console::{Messages, collect};
use crate::page::{Page, prepare};
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
                while !matches!(child.try_wait(), Ok(Some(_))) && Instant::now() < deadline {
                    sleep(Duration::from_millis(10)).await;
                }
            }
            // Its own process group: stop the browser if it did not exit, and any descendant
            // that outlived it.
            unsafe { libc::killpg(self.pid as i32, libc::SIGKILL) };
            let _ = child.wait();
        }
        let _ = std::fs::remove_dir_all(&self.user_data);
    }

    /// Stop the browser group immediately, without waiting: for a host losing its owner.
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
}

pub struct RenderOutcome {
    pub captured: Value,
    pub snapshot: String,
    pub screenshot: Option<String>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
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
    messages: Mutex<Option<Arc<Mutex<Messages>>>>,
    ready: std::sync::atomic::AtomicBool,
}

impl Browser {
    /// Render one case in a fresh browser context. Everything from creating the context to
    /// capture is bounded by the request's deadline, and disposal by at most one second more.
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
                "Specimen deadline exceeded after {}ms",
                request.timeout_ms
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
        let messages = attempt.messages.lock().unwrap().take();
        let Messages { errors, warnings } = messages
            .map(|messages| std::mem::take(&mut *messages.lock().unwrap()))
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
            (Ok((captured, snapshot, screenshot)), Ok(())) => Ok(RenderOutcome {
                captured,
                snapshot,
                screenshot,
                errors,
                warnings,
            }),
            (Ok(_), Err(failure)) | (Err(failure), Ok(())) => Err(failure.into()),
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
    ) -> Result<(Value, String, Option<String>)> {
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
        *attempt.messages.lock().unwrap() = Some(collect(self.cdp.subscribe(&session)));
        let page = Page {
            cdp: &self.cdp,
            session,
        };
        let viewport = prepare(&page, &request.context).await?;
        page.mouse("mouseMoved", -1.0, -1.0).await?;
        let navigated = page
            .send("Page.navigate", json!({ "url": format!("{url}specimen.html?automation=1"), "referrerPolicy": "unsafeUrl" }))
            .await?;
        if let Some(error) = navigated.get("errorText").and_then(Value::as_str) {
            return Err(anyhow!("{error} at {url}specimen.html?automation=1"));
        }
        // A reply from the document being replaced is retried in the navigated one.
        while page.evaluate(RUNTIME_READY).await.ok() != Some(Value::Bool(true)) {
            sleep(Duration::from_millis(5)).await;
        }
        attempt
            .ready
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let mounted = page
            .evaluate(&format!(
                "window.__specimen.mount({}, {})",
                request.entry, request.context
            ))
            .await?;
        page.steps(&mounted, &request.checkpoint).await?;
        // The DOM is normalized in the page, by the same `normalizeDom` the API exports.
        let captured = page
            .evaluate("(async () => { const captured = window.__specimen.capture(); captured.normalized = await window.__specimen.normalize(captured.dom); return captured; })()")
            .await?;
        let root = page.root_backend_id().await?;
        let tree = page.send("Accessibility.getFullAXTree", json!({})).await?;
        let snapshot = aria::snapshot(&tree, root);
        let screenshot = match &request.screenshot {
            Some(path) => {
                let metrics = page.send("Page.getLayoutMetrics", json!({})).await?;
                let size = |key: &str, fallback: u32| {
                    metrics
                        .pointer(&format!("/cssContentSize/{key}"))
                        .and_then(Value::as_f64)
                        .unwrap_or(fallback as f64)
                };
                let (width, height) = (
                    size("width", viewport.width),
                    size("height", viewport.height),
                );
                let shot = page
                    .send(
                        "Page.captureScreenshot",
                        json!({ "format": "png", "captureBeyondViewport": true, "clip": { "x": 0, "y": 0, "width": width, "height": height, "scale": 1 } }),
                    )
                    .await?;
                let data = shot.get("data").and_then(Value::as_str).unwrap_or("");
                std::fs::write(
                    path,
                    base64::engine::general_purpose::STANDARD.decode(data)?,
                )?;
                Some(path.clone())
            }
            None => None,
        };
        Ok((captured, snapshot, screenshot))
    }
}
