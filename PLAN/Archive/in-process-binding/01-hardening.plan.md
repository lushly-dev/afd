# Production Hardening Plan

> **Status**: ✅ Complete (All Core Phases)  
> **Priority**: High  
> **Depends On**: In-Process Binding (Complete)  
> **Estimated Effort**: 1-2 days  

## Overview

Harden the DirectClient experiment for production use. Address security vulnerabilities, improve error handling, and add operational observability.

---

## Phase 0: Research Spikes (De-risk First)

> **Goal**: Investigate unknowns before committing to implementation approach.

### Spike 0.1: LLM Hallucinated Tool Calls ✅ COMPLETE
- [x] **Test**: Intentionally trigger edge cases (ask for non-existent operations)
- [x] **Document**: What does Gemini return when it hallucinates a tool?
- [x] **Decide**: Validate tool names before execution? Return error to model for retry?
- [x] **Outcome**: Pattern for handling unknown tool calls

**Findings:**
- Gemini 3 Flash is **highly robust** against hallucination
- **Scenario 1** (indirect): Asked "export to CSV" → Gracefully declined, offered alternatives
- **Scenario 2** (direct): Asked to use `todo-archive` → Mapped to existing `todo-clear` instead
- **Scenario 3** (insistent): Claimed command was "hidden" → Listed actual tools, refused
- **Social engineering** (admin claims, developer bypass requests) → All rejected

**Decision:** Implemented model-agnostic `UnknownToolHandler` as defense-in-depth.

**Implemented in `@afd/client`:**
- `UnknownToolError` type with structured recovery info
- Levenshtein-based fuzzy matching for suggestions
- Returns: `{ error, message, requested_tool, available_tools, suggestions, hint }`
- Works for both DirectClient and DirectTransport

### Spike 0.2: Multi-Tool Partial Failures ✅ COMPLETE
- [x] **Test**: Create scenario where one tool succeeds, another fails
- [x] **Document**: Current behavior - does Gemini see the partial results?
- [x] **Decide**: Rollback strategy? Partial response? Continue with error context?
- [x] **Outcome**: Error propagation pattern for tool chains

**Test scenario:** "Create todo 'Test1', get todo 'invalid-id', list todos"

**Results:**
- `todo-create`: ✅ Succeeded (0.038ms)
- `todo-get`: ❌ Failed with NOT_FOUND (0.100ms)
- `todo-list`: ✅ Succeeded (0.014ms)

**Current behavior works well:**
- Tools execute sequentially; failures don't stop the chain
- Each result (success or error) is sent back to Gemini
- Gemini reasons about failures in its response:
  > "I've created 'Test1'. As expected, getting 'invalid-id' returned a NOT_FOUND error. Here are all your todos..."

**Decision:** No changes needed. Current implementation is correct:
1. Collect all results (pass/fail)
2. Send structured errors back to model  
3. Let LLM reason about partial success/failure

### Spike 0.3: Graceful Degradation ✅ COMPLETE
- [x] **Test**: Kill Gemini connection mid-request
- [x] **Document**: What does user see? How long until timeout?
- [x] **Decide**: Cache responses? Static fallbacks? "AI unavailable" message?
- [x] **Outcome**: Degradation UX pattern

**Current behavior is acceptable for demo:**

| Scenario | Frontend Behavior |
|----------|-------------------|
| Server offline | Status shows "Offline", "Connection error" in chat |
| No API key | Status shows "No API Key", error message in chat |
| API rate limit | Shows specific error message from Gemini |
| Request timeout | Eventual connection error (browser default) |

**What exists:**
- `/health` endpoint checks both server and Gemini status
- Status indicators update every 5 seconds
- Errors display in chat as system messages
- UI operations (`/execute`) still work when AI is down

**Future improvements (not P0):**
- Add request timeout (currently relies on browser defaults)
- Add retry button after errors
- Consider offline-first caching for `/execute`

### Spike 0.4: Cost/Token Control ✅ COMPLETE
- [x] **Research**: Gemini 3 Flash pricing and token limits
- [x] **Test**: What happens with very large todo lists?
- [x] **Decide**: Token budget per request? Pagination? Summarization?
- [x] **Outcome**: Cost guardrails pattern

**Gemini 3 Flash Pricing (per 1M tokens):**
| Type | Cost |
|------|------|
| Input | $0.50 |
| Output | $3.00 |
| Audio Input | $1.00 |

**Limits:**
- Context window: **1,048,576 tokens** (1M!)
- Max output: **65,536 tokens**
- Free tier: 1,000 req/day, 250K tokens/min

**Test Results:**
| Operation | Items | Model Time | Tool Time |
|-----------|-------|------------|-----------|
| Create 20 todos | 20 | 5,684ms | 0.104ms |
| Summarize all | 30 | 1,673ms | 0.057ms |

**Finding:** No token issues at this scale. The 1M context window is massive.

**Decision:** No guardrails needed for demo. For production:
- Consider request timeout (30s max)
- Log token usage for monitoring
- Could paginate at ~100 items if needed

### Spike 0.5: Concurrent Access ✅ COMPLETE
- [x] **Test**: Multiple parallel requests hitting the same registry
- [x] **Document**: Are there race conditions? Data loss?
- [x] **Verify**: Data integrity after concurrent writes
- [x] **Outcome**: Concurrency safety validation

**Test 1: 5 parallel requests**
```
All completed in 3ms window (602-605 timestamp)
Each got unique ID - no collisions
```

**Test 2: 10 parallel requests**
```
All completed in 18ms window
Unique IDs: todo-...-5wy17lb through todo-...-1ctgsaw
Execution time: 0.015ms - 0.051ms per request
```

**Data Integrity Check:**
- Started with 31 todos
- Added 15 via concurrent tests (5 + 10)
- Final count: 46 ✅ (no data loss)

**Finding:** Node.js event loop + Map-based registry handles concurrency correctly. DirectClient's synchronous design prevents race conditions.

---

## Phase 1: Security Hardening ✅ COMPLETE

### 1.1 API Key Protection ✅
- [x] Validate `GOOGLE_API_KEY` format on startup
- [x] Mask API key in logs (show only last 4 chars)
- [x] Add `.env` to `.gitignore` (verified)

### 1.2 CORS Lockdown ✅
- [x] Allow only specific origins (configurable via `ALLOWED_ORIGINS` env)
- [x] Reject requests from unauthorized origins (403 response)

### 1.3 Input Validation ✅
- [x] Validate command names with regex (`^[a-zA-Z][a-zA-Z0-9-]{0,49}$`)
- [x] Sanitize/validate args (must be object, not array)
- [x] Add request body size limits (`MAX_BODY_SIZE`, default 10KB)

### 1.4 Rate Limiting ✅
- [x] Per-IP rate limiting for `/chat` (`RATE_LIMIT_CHAT`, default 30/min)
- [x] Per-IP rate limiting for `/execute` (`RATE_LIMIT_EXECUTE`, default 120/min)
- [x] Return 429 with `Retry-After` header

### 1.5 Authentication (Optional - Skipped for Demo)
- [ ] Add API key header for server endpoints
- [ ] Consider JWT for session-based auth

---

## Phase 2: Error Handling ✅ COMPLETE

### 2.1 Gemini API Errors ✅
- [x] Categorize error types (`rate_limit`, `auth`, `network`, `timeout`, `server`, `unknown`)
- [x] Add exponential backoff retry (1s → 2s → 4s, max 3 retries)
- [x] Return user-friendly error messages per category

### 2.2 Tool Call Validation ✅
- [x] Validate tool name exists before execution (via UnknownToolHandler)
- [x] Validate args match expected schema (object-only validation)
- [x] Handle partial success in multi-tool responses (tested in Spike 0.2)

### 2.3 Graceful Degradation (Partial - Acceptable for Demo)
- [ ] Return cached/stale data when Gemini unavailable (future)
- [ ] Provide fallback responses for common queries (future)

### 2.4 Frontend Error Handling (Existing)
- [x] Show error messages for failed operations (system messages in chat)
- [ ] Add retry buttons for recoverable errors (future)
- [x] Handle connection loss gracefully (status indicators)

---

## Phase 3: Operational Readiness ✅ COMPLETE

### 3.1 Structured Logging ✅
- [x] Request ID tracing (`req-{timestamp}-{counter}`)
- [x] Log latencies, errors, and key events
- [ ] JSON log format (future - console is sufficient for demo)

### 3.2 Metrics Collection ✅ (`GET /metrics`)
- [x] Track request counts (`requestCount`, `successCount`, `errorCount`)
- [x] Track tool call counts (`toolCallCount`)
- [x] Track latency percentiles (`p50LatencyMs`, `p95LatencyMs`, `p99LatencyMs`)
- [x] Track error rates by type (`errorsByType`)
- [x] Track uptime (`uptimeMs`)

### 3.3 Health Checks ✅
- [x] `GET /health` - Basic liveness with uptime and Gemini status
- [x] `GET /ready` - Comprehensive readiness (returns 503 if not ready)

### 3.4 State Persistence (Skipped for Demo)
- [ ] Option to persist state to file/database
- [ ] Graceful state recovery on restart

---

## Priority Matrix

| Item | Impact | Effort | Priority |
|------|--------|--------|----------|
| Input validation | High | Low | **P0** |
| API key protection | High | Low | **P0** |
| CORS lockdown | Medium | Low | **P1** |
| Error handling | High | Medium | **P1** |
| Rate limiting | Medium | Medium | **P1** |
| Structured logging | Medium | Low | **P2** |
| Metrics | Medium | Medium | **P2** |
| State persistence | Low | High | **P3** |
| Authentication | Low | Medium | **P3** |

---

## Next Steps

1. Start with P0 items (input validation, API key protection)
2. Proceed to P1 items (CORS, error handling, rate limiting)
3. Add observability (P2) for production monitoring
4. Consider P3 items based on requirements
