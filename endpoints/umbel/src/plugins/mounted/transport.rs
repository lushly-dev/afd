//! The mount's transports, with the result limit enforced inside them (specification section
//! 6.3): a stdio reader that counts every JSON-RPC line as it passes and an HTTP client that
//! counts every response body, both before anything is parsed.

use std::borrow::Cow;
use std::collections::HashMap;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};

use futures::StreamExt;
use futures::stream::BoxStream;
use http::{HeaderName, HeaderValue, StatusCode};
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use rmcp::RoleClient;
use rmcp::model::{ClientJsonRpcMessage, ClientRequest, ErrorData, ServerJsonRpcMessage};
use rmcp::service::{RxJsonRpcMessage, TxJsonRpcMessage};
use rmcp::transport::Transport;
use rmcp::transport::async_rw::AsyncRwTransport;
use rmcp::transport::common::http_header::{
    EVENT_STREAM_MIME_TYPE, HEADER_SESSION_ID, JSON_MIME_TYPE,
};
use rmcp::transport::streamable_http_client::{
    SseError, StreamableHttpClient, StreamableHttpError, StreamableHttpPostResponse,
};
use sse_stream::{Sse, SseStream};
use tokio::io::{AsyncRead, ReadBuf};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::watch;

/// How much of an error body is read (and quoted): the limit does not apply, a message does not
/// need more.
const ERROR_BODY_BYTES: usize = 8 * 1024;

/// A connection's result limit and the signal that something exceeded it.
#[derive(Debug)]
pub(crate) struct Limit {
    max: usize,
    tripped: AtomicBool,
    signal: watch::Sender<bool>,
}

impl Limit {
    pub(crate) fn new(max: usize) -> Arc<Self> {
        let (signal, _) = watch::channel(false);
        Arc::new(Self {
            max,
            tripped: AtomicBool::new(false),
            signal,
        })
    }

    pub(crate) fn max(&self) -> usize {
        self.max
    }

    /// A message or body went over `max`.
    pub(crate) fn trip(&self) {
        self.tripped.store(true, Ordering::SeqCst);
        self.signal.send_replace(true);
    }

    pub(crate) fn tripped(&self) -> bool {
        self.tripped.load(Ordering::SeqCst)
    }

    /// Resolves once something went over the limit.
    pub(crate) async fn exceeded(&self) {
        let mut receiver = self.signal.subscribe();
        let _ = receiver.wait_for(|tripped| *tripped).await;
    }
}

/// A child's stdout that watches the length of each line as it is read, and trips the limit when
/// one passes `max` without a newline. rmcp's own reader is bounded to the same length, so the
/// line is dropped unread, not buffered.
pub(crate) struct LimitedRead<R> {
    inner: R,
    line: usize,
    limit: Arc<Limit>,
}

impl<R> LimitedRead<R> {
    pub(crate) fn new(inner: R, limit: Arc<Limit>) -> Self {
        Self {
            inner,
            line: 0,
            limit,
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for LimitedRead<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let before = buf.filled().len();
        let polled = Pin::new(&mut this.inner).poll_read(cx, buf);
        if matches!(polled, Poll::Ready(Ok(()))) {
            for byte in &buf.filled()[before..] {
                if *byte == b'\n' {
                    this.line = 0;
                } else {
                    this.line += 1;
                    if this.line > this.limit.max() {
                        this.limit.trip();
                    }
                }
            }
        }
        polled
    }
}

/// The child process and rmcp's line transport over its pipes. The child is owned by the
/// transport, so it is killed (`kill_on_drop`) when the service that holds the transport ends.
pub(crate) struct ChildTransport {
    transport: AsyncRwTransport<RoleClient, LimitedRead<ChildStdout>, ChildStdin>,
    _child: Child,
}

impl ChildTransport {
    pub(crate) fn new(
        child: Child,
        stdout: ChildStdout,
        stdin: ChildStdin,
        limit: Arc<Limit>,
    ) -> Self {
        let max = limit.max();
        Self {
            transport: AsyncRwTransport::new_client(LimitedRead::new(stdout, limit), stdin)
                .with_max_line_length(max),
            _child: child,
        }
    }
}

impl Transport<RoleClient> for ChildTransport {
    type Error = io::Error;

    fn send(
        &mut self,
        item: TxJsonRpcMessage<RoleClient>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send + 'static {
        self.transport.send(item)
    }

    fn receive(&mut self) -> impl Future<Output = Option<RxJsonRpcMessage<RoleClient>>> + Send {
        self.transport.receive()
    }

    fn close(&mut self) -> impl Future<Output = Result<(), Self::Error>> + Send {
        self.transport.close()
    }
}

/// A `reqwest` client for rmcp's Streamable HTTP transport that refuses a response body over the
/// limit: the JSON body of a call, or the bytes of its event stream, are counted as they arrive.
/// The long-lived GET stream is bounded per event by the transport's `max_sse_event_size`, which
/// the loader sets to the same limit.
#[derive(Clone)]
pub(crate) struct BoundedHttp {
    inner: reqwest::Client,
    limit: Arc<Limit>,
}

impl BoundedHttp {
    pub(crate) fn new(inner: reqwest::Client, limit: Arc<Limit>) -> Self {
        Self { inner, limit }
    }

    async fn post_bounded(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session_id: Option<Arc<str>>,
        auth_token: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<StreamableHttpPostResponse, StreamableHttpError<reqwest::Error>> {
        let mut request = self
            .inner
            .post(uri.as_ref())
            .header(ACCEPT, [EVENT_STREAM_MIME_TYPE, JSON_MIME_TYPE].join(", "))
            .header(CONTENT_TYPE, JSON_MIME_TYPE);
        if let Some(token) = auth_token {
            request = request.bearer_auth(token);
        }
        for (name, value) in custom_headers {
            request = request.header(name, value);
        }
        let session_attached = session_id.is_some();
        if let Some(session) = session_id {
            request = request.header(HEADER_SESSION_ID, session.as_ref());
        }
        let response = request.body(serde_json::to_vec(&message)?).send().await?;
        let status = response.status();
        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            // The body and the challenge are the server's; the credential is the deployer's and
            // is never echoed.
            return Err(StreamableHttpError::UnexpectedServerResponse(Cow::Owned(
                format!("HTTP {status}: the server refused the bearer token or has none for it"),
            )));
        }
        if matches!(status, StatusCode::ACCEPTED | StatusCode::NO_CONTENT) {
            return Ok(StreamableHttpPostResponse::Accepted);
        }
        if status == StatusCode::NOT_FOUND && session_attached {
            return Err(StreamableHttpError::SessionExpired);
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let is_json = content_type
            .as_deref()
            .is_some_and(|value| value.starts_with(JSON_MIME_TYPE));
        let is_sse = content_type
            .as_deref()
            .is_some_and(|value| value.starts_with(EVENT_STREAM_MIME_TYPE));
        let session = response
            .headers()
            .get(HEADER_SESSION_ID)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let needs_no_reply = matches!(
            message,
            ClientJsonRpcMessage::Notification(_)
                | ClientJsonRpcMessage::Response(_)
                | ClientJsonRpcMessage::Error(_)
        );
        if status.is_success() && response.content_length() == Some(0) && needs_no_reply {
            return Ok(StreamableHttpPostResponse::Accepted);
        }
        if !status.is_success() {
            let (body, _) = read_capped(response, ERROR_BODY_BYTES).await?;
            let text = String::from_utf8_lossy(&body).into_owned();
            if let Some(legacy) =
                legacy_discover_response(&message, session_attached, status, &text)
            {
                return Ok(legacy);
            }
            if is_json
                && let Ok(error @ ServerJsonRpcMessage::Error(_)) =
                    serde_json::from_str::<ServerJsonRpcMessage>(&text)
            {
                return Ok(StreamableHttpPostResponse::Json(error, session));
            }
            return Err(StreamableHttpError::UnexpectedServerResponse(Cow::Owned(
                format!("HTTP {status}: {}", preview(&text)),
            )));
        }
        if is_sse {
            return Ok(StreamableHttpPostResponse::Sse(
                self.bounded_events(response),
                session,
            ));
        }
        if is_json {
            if response
                .content_length()
                .is_some_and(|length| length > self.limit.max() as u64)
            {
                self.limit.trip();
                return Err(over_limit(self.limit.max()));
            }
            let (body, exceeded) = read_capped(response, self.limit.max()).await?;
            if exceeded {
                self.limit.trip();
                return Err(over_limit(self.limit.max()));
            }
            return match serde_json::from_slice::<ServerJsonRpcMessage>(&body) {
                Ok(parsed) => Ok(StreamableHttpPostResponse::Json(parsed, session)),
                Err(_) if needs_no_reply => Ok(StreamableHttpPostResponse::Accepted),
                Err(error) => Err(StreamableHttpError::UnexpectedServerResponse(Cow::Owned(
                    format!("the response is not a JSON-RPC message: {error}"),
                ))),
            };
        }
        Err(StreamableHttpError::UnexpectedContentType(content_type))
    }

    /// The response's event stream, refusing it once more than `max` bytes have arrived.
    fn bounded_events(
        &self,
        response: reqwest::Response,
    ) -> BoxStream<'static, Result<Sse, SseError>> {
        let limit = Arc::clone(&self.limit);
        let mut received = 0usize;
        let bytes = response.bytes_stream().map(move |chunk| match chunk {
            Ok(chunk) => {
                received += chunk.len();
                if received > limit.max() {
                    limit.trip();
                    Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("the response is over the {} byte result limit", limit.max()),
                    ))
                } else {
                    Ok(chunk)
                }
            }
            Err(error) => Err(io::Error::other(error)),
        });
        SseStream::from_bytes_stream(bytes).boxed()
    }
}

fn over_limit(max: usize) -> StreamableHttpError<reqwest::Error> {
    StreamableHttpError::UnexpectedServerResponse(Cow::Owned(format!(
        "the response is over the {max} byte result limit"
    )))
}

fn preview(text: &str) -> String {
    let trimmed: String = text.chars().take(200).collect();
    if trimmed.is_empty() {
        "<empty>".to_owned()
    } else {
        trimmed
    }
}

/// Read a body chunk by chunk and stop at `cap` bytes: the bytes read, and whether the body had
/// more.
async fn read_capped(
    mut response: reqwest::Response,
    cap: usize,
) -> Result<(Vec<u8>, bool), reqwest::Error> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > cap {
            let room = cap.saturating_sub(body.len());
            body.extend_from_slice(&chunk[..room]);
            return Ok((body, true));
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, false))
}

/// A legacy server answers `server/discover` with a 4xx and no id the lifecycle can correlate:
/// make it the JSON-RPC error the handshake classifies as "legacy" (the same translation rmcp's
/// own reqwest client makes).
fn legacy_discover_response(
    message: &ClientJsonRpcMessage,
    session_attached: bool,
    status: StatusCode,
    body: &str,
) -> Option<StreamableHttpPostResponse> {
    if session_attached || !status.is_client_error() {
        return None;
    }
    let ClientJsonRpcMessage::Request(request) = message else {
        return None;
    };
    if !matches!(request.request, ClientRequest::DiscoverRequest(_)) {
        return None;
    }
    let error = match serde_json::from_str::<ServerJsonRpcMessage>(body) {
        Ok(ServerJsonRpcMessage::Error(error)) => error.error,
        _ => ErrorData::invalid_request(
            format!(
                "server/discover rejected with HTTP {status}: {}",
                preview(body)
            ),
            None,
        ),
    };
    Some(StreamableHttpPostResponse::Json(
        ServerJsonRpcMessage::error(error, Some(request.id.clone())),
        None,
    ))
}

impl StreamableHttpClient for BoundedHttp {
    type Error = reqwest::Error;

    async fn post_message(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session_id: Option<Arc<str>>,
        auth_token: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<StreamableHttpPostResponse, StreamableHttpError<Self::Error>> {
        self.post_bounded(uri, message, session_id, auth_token, custom_headers)
            .await
    }

    async fn post_message_with_max_sse_event_size(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session_id: Option<Arc<str>>,
        auth_token: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
        _max_sse_event_size: usize,
    ) -> Result<StreamableHttpPostResponse, StreamableHttpError<Self::Error>> {
        self.post_bounded(uri, message, session_id, auth_token, custom_headers)
            .await
    }

    async fn delete_session(
        &self,
        uri: Arc<str>,
        session_id: Arc<str>,
        auth_token: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<(), StreamableHttpError<Self::Error>> {
        self.inner
            .delete_session(uri, session_id, auth_token, custom_headers)
            .await
    }

    async fn get_stream(
        &self,
        uri: Arc<str>,
        session_id: Option<Arc<str>>,
        last_event_id: Option<String>,
        auth_token: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<BoxStream<'static, Result<Sse, SseError>>, StreamableHttpError<Self::Error>> {
        self.inner
            .get_stream_with_max_sse_event_size(
                uri,
                session_id,
                last_event_id,
                auth_token,
                custom_headers,
                self.limit.max(),
            )
            .await
    }

    async fn get_stream_with_max_sse_event_size(
        &self,
        uri: Arc<str>,
        session_id: Option<Arc<str>>,
        last_event_id: Option<String>,
        auth_token: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
        max_sse_event_size: usize,
    ) -> Result<BoxStream<'static, Result<Sse, SseError>>, StreamableHttpError<Self::Error>> {
        self.inner
            .get_stream_with_max_sse_event_size(
                uri,
                session_id,
                last_event_id,
                auth_token,
                custom_headers,
                max_sse_event_size.min(self.limit.max()),
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::{Limit, LimitedRead};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn a_line_over_the_limit_trips_before_its_end_arrives() {
        let limit = Limit::new(16);
        let (mut writer, reader) = tokio::io::duplex(1024);
        let mut reader = LimitedRead::new(reader, std::sync::Arc::clone(&limit));
        // 17 bytes and no newline: the message is not complete, but it is already too long.
        writer.write_all(&[b'a'; 17]).await.unwrap();
        let mut buffer = [0u8; 64];
        let read = reader.read(&mut buffer).await.unwrap();
        assert_eq!(read, 17);
        assert!(limit.tripped());
        tokio::time::timeout(std::time::Duration::from_secs(1), limit.exceeded())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn lines_at_the_limit_pass_and_the_count_restarts_at_each_newline() {
        let limit = Limit::new(8);
        let (mut writer, reader) = tokio::io::duplex(1024);
        let mut reader = LimitedRead::new(reader, std::sync::Arc::clone(&limit));
        writer.write_all(b"12345678\n12345678\n1234").await.unwrap();
        let mut buffer = [0u8; 64];
        assert!(reader.read(&mut buffer).await.unwrap() > 0);
        assert!(!limit.tripped());
        writer.write_all(b"56789\n").await.unwrap();
        assert!(reader.read(&mut buffer).await.unwrap() > 0);
        assert!(limit.tripped(), "4 + 5 bytes make a 9 byte line");
    }
}
