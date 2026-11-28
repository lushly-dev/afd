---
"@lushly-dev/specimen": patch
---

Bound `runSchemas()` concurrency to the configured worker pool with a once-only retry, honor story/config timeouts and `reuseBundle` on `inspect`, and retry transient `net::ERR_NO_BUFFER_SPACE` navigation failures with loopback socket hardening (`TCP_NODELAY` and idle keep-alive read timeout) (#2767, #2751).
