//! Page navigation with bounded retry for transient loopback socket exhaustion (`#2751`).

use anyhow::{Result, anyhow};
use serde_json::Value;
use std::future::Future;
use std::time::Duration;
use tokio::time::{Instant, sleep};

/// Windows loopback socket exhaustion (`WSAENOBUFS`) can fail `Page.navigate` transiently before
/// the page loads anything; short backoff retries recover once OS sockets drain (#2751).
const TRANSIENT_NAVIGATE_DELAYS_MS: &[u64] = &[50, 100, 200, 400, 800];

pub fn is_transient_navigation_error(error: &str) -> bool {
    error == "net::ERR_NO_BUFFER_SPACE"
}

pub async fn navigate_with_retry<F, Fut>(
    address: &str,
    deadline: Instant,
    navigate: F,
) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    navigate_with_retry_delays(address, deadline, TRANSIENT_NAVIGATE_DELAYS_MS, navigate).await
}

async fn navigate_with_retry_delays<F, Fut>(
    address: &str,
    deadline: Instant,
    delays_ms: &[u64],
    mut navigate: F,
) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    for attempt_index in 0..=delays_ms.len() {
        let navigated = navigate().await?;
        let Some(error) = navigated.get("errorText").and_then(Value::as_str) else {
            return Ok(());
        };
        let Some(&delay_ms) = delays_ms.get(attempt_index) else {
            return Err(anyhow!("{error} at {address}"));
        };
        if !is_transient_navigation_error(error) {
            return Err(anyhow!("{error} at {address}"));
        }
        let delay = Duration::from_millis(delay_ms);
        if deadline.saturating_duration_since(Instant::now()) <= delay {
            return Err(anyhow!("{error} at {address}"));
        }
        if !delay.is_zero() {
            sleep(delay).await;
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::{navigate_with_retry, navigate_with_retry_delays};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;
    use tokio::time::Instant;

    #[tokio::test]
    async fn navigate_retries_transient_no_buffer_space_until_it_recovers() {
        let calls = AtomicUsize::new(0);
        let deadline = Instant::now() + Duration::from_secs(5);
        let result = navigate_with_retry_delays(
            "http://127.0.0.1:9/specimen.html",
            deadline,
            &[0, 0],
            || {
                let attempt = calls.fetch_add(1, Ordering::SeqCst);
                async move {
                    if attempt < 2 {
                        Ok(json!({ "errorText": "net::ERR_NO_BUFFER_SPACE" }))
                    } else {
                        Ok(json!({ "frameId": "1" }))
                    }
                }
            },
        )
        .await;
        assert!(result.is_ok(), "{result:?}");
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn navigate_does_not_retry_non_transient_errors() {
        let calls = AtomicUsize::new(0);
        let deadline = Instant::now() + Duration::from_secs(5);
        let err = navigate_with_retry("http://127.0.0.1:9/specimen.html", deadline, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(json!({ "errorText": "net::ERR_NAME_NOT_RESOLVED" })) }
        })
        .await
        .unwrap_err();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(err.to_string().contains("net::ERR_NAME_NOT_RESOLVED"));
    }

    #[tokio::test]
    async fn navigate_stops_retrying_once_deadline_would_be_exceeded() {
        let calls = AtomicUsize::new(0);
        let deadline = Instant::now() + Duration::from_millis(10);
        let err = navigate_with_retry("http://127.0.0.1:9/specimen.html", deadline, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(json!({ "errorText": "net::ERR_NO_BUFFER_SPACE" })) }
        })
        .await
        .unwrap_err();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(err.to_string().contains("net::ERR_NO_BUFFER_SPACE"));
    }
}
