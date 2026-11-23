//! HTTP embeddings provider via `reqwest` blocking client (records host specification,
//! section 9.2).
//!
//! Speaks `POST <url>` with `{ "model": <name>, "input": [<text>, ...] }` and optional
//! `Authorization: Bearer <token>`, expecting `{ "data": [ { "index", "embedding" }, ... ] }`.
//! Follows no redirect, caps each response body at 16 MiB, sends at most 64 texts per request,
//! and accepts only `https://` URLs or `http://` URLs to a literal loopback address
//! (`127.0.0.0/8` or `[::1]`).
//!
//! No error message ever includes input text or response body text.

use std::fmt;
use std::io::Read;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::time::Duration;

use reqwest::Url;
use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use umbel_store::{EmbedError, Embedder, ModelId};

use crate::{MAX_HTTP_BATCH, MAX_HTTP_RESPONSE_BYTES, check_dimensions, check_vectors};

/// Configuration for an [`HttpEmbedder`].
#[derive(Clone)]
pub struct HttpConfig {
    /// Endpoint URL (`https://...` or `http://127.x.x.x...` / `http://[::1]...`).
    pub url: String,
    /// Model name sent in the JSON request's `model` field.
    pub name: String,
    /// Expected number of floats per returned vector (16..=4096).
    pub dimensions: usize,
    /// Optional bearer token value for `Authorization: Bearer`.
    pub bearer: Option<String>,
    /// Per-request timeout.
    pub timeout: Duration,
}

impl fmt::Debug for HttpConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpConfig")
            .field("url", &self.url)
            .field("name", &self.name)
            .field("dimensions", &self.dimensions)
            .field("bearer", &self.bearer.as_ref().map(|_| "<redacted>"))
            .field("timeout", &self.timeout)
            .finish()
    }
}

/// An HTTP embeddings provider.
pub struct HttpEmbedder {
    model: ModelId,
    url: Url,
    config: HttpConfig,
    client: Client,
}

#[derive(Serialize)]
struct RequestBody<'a> {
    model: &'a str,
    input: &'a [&'a str],
}

#[derive(Deserialize)]
struct ResponseBody {
    data: Vec<ResponseDatum>,
}

#[derive(Deserialize)]
struct ResponseDatum {
    index: usize,
    embedding: Vec<f32>,
}

/// Validate an HTTP provider URL (section 9.2): `https://` with a host name or bracketed IPv6
/// address, or `http://` with a literal loopback address (`127.0.0.0/8` or `[::1]`, never a name).
/// Returns `Ok(true)` for `https://`, `Ok(false)` for loopback `http://`.
///
/// # Errors
/// [`EmbedError::Invalid`] when the URL violates the rule.
pub fn check_http_url(url: &str) -> Result<bool, EmbedError> {
    const SHAPE: &str = "url must be an https URL, or an http URL to a literal loopback address (127.0.0.0/8 or [::1]), never a name";
    let (https, rest) = match (url.strip_prefix("https://"), url.strip_prefix("http://")) {
        (Some(rest), _) => (true, rest),
        (_, Some(rest)) => (false, rest),
        _ => return Err(EmbedError::Invalid(SHAPE.to_owned())),
    };
    let (authority, tail) = rest.split_at(rest.find(['/', '?', '#']).unwrap_or(rest.len()));
    if !tail.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        return Err(EmbedError::Invalid(format!(
            "{SHAPE}; after the host it holds only printable ASCII, with no whitespace"
        )));
    }
    let (host, bracketed, port) = match authority.strip_prefix('[') {
        Some(inner) => match inner.split_once(']') {
            Some((address, "")) => (address, true, None),
            Some((address, after)) if after.starts_with(':') => (address, true, Some(&after[1..])),
            _ => {
                return Err(EmbedError::Invalid(format!(
                    "{SHAPE}; its IPv6 address is not closed with ]"
                )));
            }
        },
        None => match authority.split_once(':') {
            Some((host, port)) => (host, false, Some(port)),
            None => (authority, false, None),
        },
    };
    if let Some(port) = port {
        let digits = (1..=5).contains(&port.len())
            && port.bytes().all(|byte| byte.is_ascii_digit())
            && !port.starts_with('0');
        if !digits || port.parse::<u16>().is_err() {
            return Err(EmbedError::Invalid(format!(
                "{SHAPE}; its port is 1 to 65535, in digits without a leading zero"
            )));
        }
    }
    let named = match (https, bracketed) {
        (true, false) => {
            !host.is_empty()
                && host
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        }
        (true, true) => host.parse::<Ipv6Addr>().is_ok(),
        (false, false) => host
            .parse::<Ipv4Addr>()
            .is_ok_and(|address| address.octets()[0] == 127),
        (false, true) => host == "::1",
    };
    if named && Url::parse(url).is_ok() {
        Ok(https)
    } else {
        Err(EmbedError::Invalid(SHAPE.to_owned()))
    }
}

impl HttpEmbedder {
    /// Construct an HTTP embedder.
    ///
    /// Builds the internal `reqwest::blocking::Client` on a clean thread so calling this from an
    /// async Tokio worker thread (e.g. `HostBuilder::seal` inside a runtime) never triggers
    /// `reqwest::blocking`'s debug-mode runtime-drop assertion.
    ///
    /// # Errors
    /// [`EmbedError::Invalid`] for a bad URL, dimensions, or timeout, or
    /// [`EmbedError::Unavailable`] if the HTTP client fails to initialize.
    pub fn new(model: ModelId, config: HttpConfig) -> Result<Self, EmbedError> {
        let https = check_http_url(&config.url)?;
        let parsed_url = Url::parse(&config.url)
            .map_err(|_| EmbedError::Invalid("url is not a valid HTTP(S) URL".to_owned()))?;
        check_dimensions(config.dimensions)?;
        if config.timeout.is_zero() {
            return Err(EmbedError::Invalid(
                "http embedder timeout must be positive".to_owned(),
            ));
        }
        let timeout = config.timeout;
        // Build the blocking client on a plain OS thread so `reqwest::blocking::wait::enter`
        // does not collide with an already-entered Tokio async worker context.
        // Loopback HTTP explicitly disables proxies so environment `HTTP_PROXY` settings cannot
        // divert local record text or bearer tokens off the machine.
        let client = std::thread::Builder::new()
            .name("umbel-embed-http-init".to_owned())
            .spawn(move || {
                let mut builder = Client::builder()
                    .redirect(Policy::none())
                    .timeout(timeout)
                    .https_only(https);
                if !https {
                    builder = builder.no_proxy();
                }
                builder.build()
            })
            .map_err(|err| EmbedError::Unavailable(format!("failed to spawn client init: {err}")))?
            .join()
            .map_err(|_| EmbedError::Unavailable("http client init thread panicked".to_owned()))?
            .map_err(|err| {
                EmbedError::Unavailable(format!("failed to build http client: {err}"))
            })?;
        Ok(Self {
            model,
            url: parsed_url,
            config,
            client,
        })
    }

    fn embed_batch(&self, chunk: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let payload = serde_json::to_vec(&RequestBody {
            model: &self.config.name,
            input: chunk,
        })
        .map_err(|_| EmbedError::Invalid("failed to serialise embedding request".to_owned()))?;
        let mut request = self
            .client
            .post(self.url.clone())
            .header("Content-Type", "application/json")
            .body(payload);
        if let Some(bearer) = &self.config.bearer {
            request = request.bearer_auth(bearer);
        }
        let response = request
            .send()
            .map_err(|err| EmbedError::Unavailable(classify_transport_error(&err)))?;
        let status = response.status();
        if status.is_redirection() {
            return Err(EmbedError::Unavailable(format!(
                "endpoint returned redirect status {}; redirects are not followed",
                status.as_u16()
            )));
        }
        if !status.is_success() {
            return Err(EmbedError::Unavailable(format!(
                "endpoint returned HTTP status {}",
                status.as_u16()
            )));
        }
        let mut bytes = Vec::new();
        let cap = (MAX_HTTP_RESPONSE_BYTES as u64) + 1;
        response
            .take(cap)
            .read_to_end(&mut bytes)
            .map_err(|_| EmbedError::Unavailable("failed reading endpoint response".to_owned()))?;
        if bytes.len() > MAX_HTTP_RESPONSE_BYTES {
            return Err(EmbedError::Invalid(format!(
                "endpoint response exceeded {MAX_HTTP_RESPONSE_BYTES} bytes"
            )));
        }
        let parsed: ResponseBody = serde_json::from_slice(&bytes)
            .map_err(|_| EmbedError::Invalid("endpoint response is not valid JSON".to_owned()))?;
        if parsed.data.len() != chunk.len() {
            return Err(EmbedError::Invalid(format!(
                "expected {} embeddings, got {}",
                chunk.len(),
                parsed.data.len()
            )));
        }
        let mut ordered: Vec<Option<Vec<f32>>> = vec![None; chunk.len()];
        for datum in parsed.data {
            if datum.index >= chunk.len() {
                return Err(EmbedError::Invalid(format!(
                    "embedding index {} is out of range for batch of {}",
                    datum.index,
                    chunk.len()
                )));
            }
            if ordered[datum.index].is_some() {
                return Err(EmbedError::Invalid(format!(
                    "duplicate embedding index {}",
                    datum.index
                )));
            }
            ordered[datum.index] = Some(datum.embedding);
        }
        let vectors: Vec<Vec<f32>> = ordered
            .into_iter()
            .enumerate()
            .map(|(index, slot)| {
                slot.ok_or_else(|| EmbedError::Invalid(format!("missing embedding index {index}")))
            })
            .collect::<Result<_, _>>()?;
        check_vectors(vectors, chunk.len(), self.config.dimensions)
    }
}

/// Produce a short, text-free reason for a `reqwest` transport error.
fn classify_transport_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "request timed out".to_owned()
    } else if err.is_connect() {
        "connection failed".to_owned()
    } else if err.is_redirect() {
        "redirect refused".to_owned()
    } else {
        "request failed".to_owned()
    }
}

impl Embedder for HttpEmbedder {
    fn model(&self) -> &ModelId {
        &self.model
    }

    fn dimensions(&self) -> usize {
        self.config.dimensions
    }

    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(MAX_HTTP_BATCH) {
            out.extend(self.embed_batch(chunk)?);
        }
        Ok(out)
    }
}
