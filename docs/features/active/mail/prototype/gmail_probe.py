#!/usr/bin/env python3
"""Gmail API probe for the Mail engine's step B0 (the engine specification's section 5.5).

Signs in to one Gmail account with the person's own OAuth client and reads it through the
Gmail API without changing it, then writes a file of counts. It records what section 5.5
leaves unobserved and a read-only run can answer: the calls and quota a sync spends and the
rate it reaches, one history sync and what a too-old history id returns, whether a header
block can be had without the whole message, and, run again a week after signing in, whether
a client in testing status lets its refresh token expire.

Read-only. It asks for the gmail.readonly scope alone, and its HTTP layer refuses any request
to the Gmail API that is not a GET. The label change, the trash and the sent copy that
section 5.5 also asks about change the mailbox; they are not here.

Standard library only. Python 3.10 or later.

    # Once: opens the system browser, receives the answer on a loopback port, keeps the
    # refresh token in --token-file. This starts the refresh token's clock.
    python3 gmail_probe.py signin --client-file ~/.config/loam-mail/gmail-client.json
    # Then, and again seven days or more after signing in:
    python3 gmail_probe.py probe --client-file ~/.config/loam-mail/gmail-client.json \\
        --out gmail-probe.results.json

The client secret and tokens are read from files, never arguments, and never written to the
output. The output holds counts, timings, status codes and error reasons: no address, subject,
label name, message id or thread id.
Exit codes: 0 complete, 2 usage, 4 sign-in or refresh token refused (the record says which),
5 network or an answer that could not be read, 6 written but incomplete.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import http.server
import json
import os
import secrets
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

TOOL_VERSION = 1
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
API_HOST = "gmail.googleapis.com"
API = f"https://{API_HOST}/gmail/v1/users/me"
TOKEN_URI = "https://oauth2.googleapis.com/token"
AUTH_PREFIX = "https://accounts.google.com/"
MAX_PAGE = 500  # Gmail's largest messages.list page
DEFAULT_DIR = os.path.join(os.path.expanduser("~"), ".config", "loam-mail")
DEFAULT_CLIENT = os.path.join(DEFAULT_DIR, "gmail-client.json")
DEFAULT_TOKEN = os.path.join(DEFAULT_DIR, "gmail-probe-token.json")
# Google's published cost of each method in quota units (Gmail API usage limits). Gmail does
# not report what a call cost, so the output multiplies these by the calls it counted.
UNITS = {"profile": 1, "labels.list": 1, "messages.list": 5, "messages.get.raw": 5,
         "messages.get.metadata": 5, "history.list": 2}
SYSTEM_LABELS = {"INBOX", "SENT", "TRASH", "SPAM", "DRAFT", "STARRED", "IMPORTANT", "UNREAD",
                 "CHAT", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS",
                 "CATEGORY_UPDATES", "CATEGORY_FORUMS"}
RETRY_STATUSES = {429, 500, 502, 503, 504}
RATE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded"}
SIZE_BUCKETS = (64 * 1024, 1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024)


class ProbeError(Exception):
    """A failure that ends the run with an exit code."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


class TokenRefused(ProbeError):
    """Google's token endpoint refused the grant or the client."""

    def __init__(self, shape: dict) -> None:
        super().__init__(4, f"the token endpoint refused: {json.dumps(shape)}")
        self.shape = shape


class WriteRefused(AssertionError):
    """The probe tried a request that could change the mailbox."""


# ----------------------------------------------------------------- files and secrets


def read_client(path: str) -> dict:
    """The installed-app client from a Google client JSON file."""
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        raise ProbeError(2, f"no client file at {path}") from None
    except (OSError, ValueError) as error:
        raise ProbeError(2, f"the client file cannot be read: {type(error).__name__}") from None
    client = data.get("installed")
    if not isinstance(client, dict):
        raise ProbeError(2, "the client file is not a Desktop app client (no 'installed' key)")
    for key in ("client_id", "client_secret", "auth_uri", "token_uri"):
        if not client.get(key):
            raise ProbeError(2, f"the client file has no {key}")
    # The secret goes to the token endpoint, so only Google's own addresses are accepted.
    if client["token_uri"] != TOKEN_URI or not client["auth_uri"].startswith(AUTH_PREFIX):
        raise ProbeError(2, "the client file names a sign-in or token address that is not Google's")
    return client


def private_folder(path: str) -> str:
    """The folder that holds path, made private. The probe's own folder, or one it creates, is
    set to 0700; a folder the person named that others can open is refused, not changed."""
    folder = os.path.dirname(os.path.abspath(path))
    if not os.path.isdir(folder):
        os.makedirs(folder, mode=0o700)
        os.chmod(folder, 0o700)  # the mode makedirs is given is narrowed by the umask
    elif os.path.abspath(folder) == os.path.abspath(DEFAULT_DIR):
        os.chmod(folder, 0o700)
    elif os.stat(folder).st_mode & 0o077:
        raise ProbeError(2, f"{folder} can be opened by others; keep the token in a private folder")
    return folder


def write_private(path: str, data: dict) -> None:
    """Writes JSON readable by the user alone, replacing the file in one step."""
    private_folder(path)
    temporary = f"{path}.{os.getpid()}.{secrets.token_hex(4)}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.replace(temporary, path)
    except BaseException:
        if os.path.exists(temporary):
            os.remove(temporary)
        raise


def read_token(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as handle:
            token = json.load(handle)
    except FileNotFoundError:
        raise ProbeError(2, f"no token file at {path}; run 'signin' first") from None
    except (OSError, ValueError) as error:
        raise ProbeError(2, f"the token file cannot be read: {type(error).__name__}") from None
    if not token.get("refresh_token") or not token.get("issued_at"):
        raise ProbeError(2, "the token file has no refresh token; run 'signin' again")
    return token


# ----------------------------------------------------------------- HTTP


def urllib_transport(method: str, url: str, headers: dict, body: bytes | None, timeout: float = 60):
    """One HTTP request. Returns (status, body); raises ProbeError(5) for the network."""
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
        raise ProbeError(5, f"network: {type(error).__name__}") from None


class Http:
    """Sends requests through a transport, refusing any that could change the mailbox.

    A GET to the Gmail API and a POST to Google's token endpoint are allowed; anything else,
    and any request to the Gmail API's host that is not a GET, raises WriteRefused before it
    is sent."""

    def __init__(self, transport, token_uri: str) -> None:
        self.transport = transport
        self.token_uri = token_uri
        self.sent: list[tuple[str, str]] = []  # (method, path without query), for the tests

    def request(self, method: str, url: str, headers: dict | None = None, body: bytes | None = None):
        path = url.split("?", 1)[0]
        host = urllib.parse.urlparse(url).hostname or ""
        if host == API_HOST:
            if method != "GET" or not path.startswith(API + "/"):
                raise WriteRefused(f"{method} to the Gmail API is not a read the probe makes")
        elif not (method == "POST" and path == self.token_uri == TOKEN_URI):
            raise WriteRefused(f"{method} to an address the probe does not use")
        self.sent.append((method, path))
        return self.transport(method, url, headers or {}, body)


def error_shape(status: int, body: bytes) -> dict:
    """The status, Google's status name and error reason of a failed call, and nothing else."""
    shape: dict = {"http": status}
    try:
        data = json.loads(body)
    except ValueError:
        return shape
    if not isinstance(data, dict):
        return shape
    error = data.get("error")
    if isinstance(error, dict):
        if error.get("status"):
            shape["status"] = error["status"]
        reasons = [e.get("reason") for e in error.get("errors") or [] if isinstance(e, dict)]
        if reasons and reasons[0]:
            shape["reason"] = reasons[0]
    elif isinstance(error, str):  # the token endpoint's form
        shape["error"] = error
        if data.get("error_description"):
            shape["description"] = str(data["error_description"])[:200]
    return shape


# ----------------------------------------------------------------- sign-in


def pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def auth_url(client: dict, redirect_uri: str, state: str, challenge: str) -> str:
    query = urllib.parse.urlencode({
        "client_id": client["client_id"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        "prompt": "consent",  # so Google issues a refresh token every time
    })
    return f"{client['auth_uri']}?{query}"


class LoopbackServer(http.server.ThreadingHTTPServer):
    """An HTTP server on loopback that skips the host-name lookup HTTPServer makes on bind,
    which can stall for seconds on a Mac. Each connection has its own thread, so a browser's
    idle preconnect cannot hold up the redirect."""

    daemon_threads = True

    def server_bind(self) -> None:
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def receive_code(state: str, open_browser, timeout: float = 300) -> tuple[str, str]:
    """Listens on a loopback port, opens the browser at the URL built for it, and returns
    (code, redirect_uri). open_browser receives the redirect URI and opens the sign-in page."""
    answer: dict = {}
    done = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        timeout = 15  # an idle connection is closed

        def do_GET(self) -> None:  # noqa: N802 (the standard library's name)
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if done.is_set() or query.get("state", [""])[0] != state:
                self.reply(400, b"This answer is not for this sign-in.")
                return
            answer["code"] = query.get("code", [""])[0]
            answer["error"] = query.get("error", [""])[0]
            if answer["error"] or not answer["code"]:
                self.reply(200, b"Sign-in did not complete. Return to the terminal.")
            else:
                self.reply(200, b"Signed in. You can close this tab and return to the terminal.")
            done.set()

        def reply(self, status: int, text: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(text)

        def log_message(self, *args) -> None:  # keep the code out of the terminal
            pass

    server = LoopbackServer(("127.0.0.1", 0), Handler)
    redirect_uri = f"http://127.0.0.1:{server.server_address[1]}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        open_browser(redirect_uri)
        if not done.wait(timeout):
            raise ProbeError(4, "no answer from the browser in time")
    finally:
        server.shutdown()
        server.server_close()
    if answer.get("error") or not answer.get("code"):
        raise ProbeError(4, f"the sign-in was refused: {answer.get('error') or 'no code'}")
    return answer["code"], redirect_uri


def token_request(http: Http, client: dict, fields: dict) -> dict:
    body = urllib.parse.urlencode({"client_id": client["client_id"],
                                   "client_secret": client["client_secret"], **fields}).encode()
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    status, raw = http.request("POST", client["token_uri"], headers, body)
    if status == 200:
        try:
            answer = json.loads(raw)
        except ValueError:
            answer = None
        if not isinstance(answer, dict) or not answer.get("access_token"):
            raise ProbeError(5, "the token endpoint's answer could not be read")
        return answer
    shape = error_shape(status, raw)
    # Only Google's own refusal says something about the grant or the client. An outage, a
    # rate limit or a proxy's page says nothing, and must not pass for an expired token.
    if status in (400, 401) and shape.get("error") in ("invalid_grant", "invalid_client", "unauthorized_client"):
        raise TokenRefused(shape)
    raise ProbeError(5, f"the token endpoint did not answer: {json.dumps(shape)}")


def signin(http: Http, client: dict, token_path: str, open_browser, now) -> dict:
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(24)

    def go(redirect_uri: str) -> None:
        url = auth_url(client, redirect_uri, state, challenge)
        print("Opening the browser to sign in. If it does not open, visit:\n" + url, file=sys.stderr)
        open_browser(url)

    code, redirect_uri = receive_code(state, go)
    answer = token_request(http, client, {"code": code, "code_verifier": verifier,
                                          "redirect_uri": redirect_uri, "grant_type": "authorization_code"})
    if not answer.get("refresh_token"):
        raise ProbeError(4, "Google issued no refresh token")
    granted = sorted(answer.get("scope", "").split())
    if granted != [SCOPE]:
        raise ProbeError(4, f"Google granted other scopes than read access alone: {granted}")
    write_private(token_path, {"refresh_token": answer["refresh_token"], "issued_at": now().isoformat(),
                               "scope": granted})
    return {"issued_at": now().isoformat(), "scope": granted}


# ----------------------------------------------------------------- the API


class Gmail:
    """Read-only Gmail calls, counted, timed and retried on rate limits."""

    def __init__(self, http: Http, access_token: str, sleep=time.sleep, clock=time.monotonic) -> None:
        self.http, self.access_token, self.sleep, self.clock = http, access_token, sleep, clock
        self.calls: Counter = Counter()
        self.retries: Counter = Counter()  # by status and reason
        self.seconds = 0.0
        self.seconds_by_kind: Counter = Counter()
        self.lock = threading.Lock()

    def get(self, kind: str, path: str, query: dict | None = None) -> tuple[int, dict | bytes]:
        """(200, parsed JSON) or (status, error shape) after retrying what can be retried."""
        url = f"{API}/{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query, doseq=True)
        headers = {"Authorization": f"Bearer {self.access_token}", "Accept": "application/json"}
        delay = 1.0
        for attempt in range(6):
            start = self.clock()
            status, body = self.http.request("GET", url, headers)
            with self.lock:
                spent = self.clock() - start
                self.calls[kind] += 1
                self.seconds += spent
                self.seconds_by_kind[kind] += spent
            if status == 200:
                try:
                    return status, json.loads(body)
                except ValueError:
                    raise ProbeError(5, f"an answer from {kind} could not be read") from None
            shape = error_shape(status, body)
            limited = status in RETRY_STATUSES or (status == 403 and shape.get("reason") in RATE_REASONS)
            if not limited or attempt == 5:
                return status, shape
            with self.lock:
                self.retries[f"{status}:{shape.get('reason', '')}"] += 1
            self.sleep(delay)
            delay *= 2
        return status, shape  # not reached

    def units(self) -> int:
        return sum(UNITS[kind] * count for kind, count in self.calls.items())


def refresh(http: Http, client: dict, token: dict, now) -> tuple[str | None, dict]:
    """A new access token from the stored refresh token, and the record of trying."""
    issued = datetime.fromisoformat(token["issued_at"])
    record = {"issued_at": token["issued_at"], "age_hours": round((now() - issued).total_seconds() / 3600, 2)}
    try:
        answer = token_request(http, client, {"refresh_token": token["refresh_token"], "grant_type": "refresh_token"})
    except TokenRefused as error:
        # invalid_grant is the refresh token refused or expired; invalid_client is the client.
        record["outcome"] = "refused" if error.shape.get("error") == "invalid_grant" else "client_refused"
        record["detail"] = str(error)
        return None, record
    record["outcome"] = "ok"
    record["scope"] = sorted(answer.get("scope", "").split())
    return answer["access_token"], record


def bucket(size: int) -> str:
    for limit in SIZE_BUCKETS:
        if size <= limit:
            return f"<={limit // 1024}KiB"
    return f">{SIZE_BUCKETS[-1] // 1024}KiB"


def raw_bytes(message: dict) -> bytes:
    data = message.get("raw", "")
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def header_block(raw: bytes) -> bytes:
    ends = [end for end in (raw.find(b"\r\n\r\n"), raw.find(b"\n\n")) if end >= 0]
    return raw[: min(ends)] if ends else raw


def unfold(block: bytes) -> list[tuple[str, str]]:
    """A raw header block as (lower-case name, value) pairs, folding removed."""
    lines: list[bytes] = []
    for line in block.replace(b"\r\n", b"\n").split(b"\n"):
        if line[:1] in (b" ", b"\t") and lines:
            lines[-1] += b" " + line.strip()
        elif line:
            lines.append(line)
    pairs = []
    for line in lines:
        name, _, value = line.partition(b":")
        pairs.append((name.decode("latin-1").strip().lower(), " ".join(value.decode("latin-1").split())))
    return pairs


def compare_headers(raw: bytes, metadata: dict) -> str:
    """How the metadata form's headers compare with the raw form's header block, after both are
    normalised (folding removed, runs of space collapsed, names in lower case), so 'same' does
    not mean byte-exact: 'same' when every header, in order, has the same name and value;
    'values_differ' when the names match in order and some value does not; else 'names_differ'."""
    ours = unfold(header_block(raw))
    theirs = [(h.get("name", "").lower(), " ".join(str(h.get("value", "")).split()))
              for h in metadata.get("payload", {}).get("headers", [])]
    if ours == theirs:
        return "same"
    if [name for name, _ in ours] == [name for name, _ in theirs]:
        return "values_differ"
    return "names_differ"


# ----------------------------------------------------------------- the probe


def list_ids(gmail: Gmail, limit: int, page_size: int, out: dict, key: str = "list",
             search: str | None = None) -> list[tuple[str, str]]:
    """Message ids and thread ids, newest first, up to limit, over all mail and spam/trash,
    or those a Gmail search finds."""
    ids: list[tuple[str, str]] = []
    token = None
    pages = 0
    reached_end = False
    start = gmail.clock()
    while len(ids) < limit:
        query = {"maxResults": min(page_size, limit - len(ids)), "includeSpamTrash": "true"}
        if search:
            query["q"] = search
        if token:
            query["pageToken"] = token
        status, body = gmail.get("messages.list", "messages", query)
        if status != 200:
            out["errors"].append({"step": f"messages.list:{key}", **body})
            out["complete"] = False
            break
        pages += 1
        ids += [(m["id"], m.get("threadId", "")) for m in body.get("messages", [])]
        token = body.get("nextPageToken")
        if not token:
            reached_end = True
            break
    elapsed = gmail.clock() - start
    out[key] = {"ids": len(ids), "pages": pages, "page_size": page_size, "seconds": round(elapsed, 2),
                   "ids_per_second": round(len(ids) / elapsed, 1) if elapsed else None,
                   "reached_end": reached_end}
    return ids


def fetch_sample(gmail: Gmail, ids: list[tuple[str, str]], workers: int, out: dict,
                 key: str = "fetch") -> list[int]:
    """Each sampled message in raw form and in metadata form. Returns the history ids seen."""
    sizes: Counter = Counter()
    comparisons: Counter = Counter()  # by size bucket and result
    history_ids: list[int] = []
    raw_total = 0
    failures: Counter = Counter()
    lock = threading.Lock()

    def one(message_id: str) -> None:
        nonlocal raw_total
        status, raw = gmail.get("messages.get.raw", f"messages/{message_id}", {"format": "raw"})
        if status != 200:
            with lock:
                failures[f"raw:{status}:{raw.get('reason', '')}"] += 1
            return
        data = raw_bytes(raw)
        status, meta = gmail.get("messages.get.metadata", f"messages/{message_id}", {"format": "metadata"})
        with lock:
            raw_total += len(data)
            sizes[bucket(len(data))] += 1
            if raw.get("historyId"):
                history_ids.append(int(raw["historyId"]))
            if status != 200:
                failures[f"metadata:{status}:{meta.get('reason', '')}"] += 1
            else:
                comparisons[f"{bucket(len(data))}:{compare_headers(data, meta)}"] += 1

    start = gmail.clock()
    before = dict(gmail.seconds_by_kind)
    raw_calls_before = gmail.calls["messages.get.raw"]
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(one, [message_id for message_id, _ in ids]))
    elapsed = gmail.clock() - start
    fetched = sum(sizes.values())
    raw_seconds = gmail.seconds_by_kind["messages.get.raw"] - before.get("messages.get.raw", 0.0)
    raw_calls = gmail.calls["messages.get.raw"] - raw_calls_before  # retries and failures included
    out[key] = {
        "asked": len(ids), "fetched_raw": fetched, "workers": workers, "seconds": round(elapsed, 2),
        "rate_note": "each message costs a raw and a metadata call; a sync makes the raw call alone",
        "messages_per_second_both_calls": round(fetched / elapsed, 2) if elapsed else None,
        "raw_call_seconds_mean": round(raw_seconds / raw_calls, 3) if raw_calls else None,
        "raw_bytes": raw_total, "sizes": dict(sorted(sizes.items())), "failures": dict(failures),
        "metadata_headers_against_raw": dict(sorted(comparisons.items())),
    }
    if failures:
        out["complete"] = False
    return history_ids


def probe_history(gmail: Gmail, profile_history: int, seen: list[int], out: dict) -> None:
    """One history sync from each of several starting points, to see where Gmail says 'too old'."""
    starts = [("current", profile_history)]
    if seen:
        starts += [("newest_sampled", max(seen)), ("oldest_sampled", min(seen))]
    starts.append(("one", 1))
    results = []
    for name, start_id in starts:
        token, pages, records, added = None, 0, 0, 0
        result: dict = {"start": name, "behind_current": profile_history - start_id}
        while True:
            query = {"startHistoryId": str(start_id), "maxResults": 500}
            if token:
                query["pageToken"] = token
            status, body = gmail.get("history.list", "history", query)
            if status != 200:
                result["error"] = body
                # Gmail's answer to a history id too old is the observation; anything else, or
                # any failure from the current id, is a gap.
                if status != 404 or name == "current":
                    out["complete"] = False
                break
            pages += 1
            history = body.get("history", [])
            records += len(history)
            added += sum(len(h.get("messagesAdded", [])) for h in history)
            token = body.get("nextPageToken")
            if not token or pages >= 20:
                result["stopped_at_page_cap"] = bool(token)
                break
        result.update({"pages": pages, "records": records, "messages_added": added})
        results.append(result)
    out["history"] = results


def run(http: Http, client: dict, token: dict, args, now, sleep=time.sleep, clock=time.monotonic) -> dict:
    out: dict = {"tool_version": TOOL_VERSION, "observed_at": now().isoformat(), "scope_asked": SCOPE,
                 "complete": True, "errors": []}
    access, record = refresh(http, client, token, now)
    out["refresh_token"] = record
    if access is None:
        out["complete"] = False
        return out
    gmail = Gmail(http, access, sleep=sleep, clock=clock)
    try:
        read_account(gmail, args, out)
    except ProbeError as error:
        # Keep what was learned, the refresh token's outcome above all.
        out["complete"] = False
        out["errors"].append({"step": "stopped", "exit": error.code, "detail": str(error)[:200]})
        out["stopped"] = error.code
    return out


def read_account(gmail: Gmail, args, out: dict) -> None:

    status, profile = gmail.get("profile", "profile")
    if status != 200:
        out["errors"].append({"step": "profile", **profile})
        out["complete"] = False
        return
    out["profile"] = {"messages_total": profile.get("messagesTotal"), "threads_total": profile.get("threadsTotal")}

    status, labels = gmail.get("labels.list", "labels")
    if status == 200:
        kinds = Counter(label.get("type", "unknown") for label in labels.get("labels", []))
        system = sorted(label["id"] for label in labels.get("labels", [])
                        if label.get("type") == "system" and label.get("id") in SYSTEM_LABELS)
        out["labels"] = {"by_type": dict(kinds), "system": system}
    else:
        out["errors"].append({"step": "labels.list", **labels})
        out["complete"] = False

    ids = list_ids(gmail, args.limit, args.page_size, out)
    out["list"]["threads"] = len({thread for _, thread in ids})
    seen = fetch_sample(gmail, ids[: args.sample], args.workers, out)
    if args.large_sample:
        # The newest mail is mostly small; section 5.5's question is about the large messages.
        large = list_ids(gmail, args.large_sample, args.page_size, out, "list_large", "larger:1M")
        fetch_sample(gmail, large, args.workers, out, "fetch_large")
    probe_history(gmail, int(profile.get("historyId", 0)), seen, out)

    total = profile.get("messagesTotal") or 0
    pages = -(-total // args.page_size) if total else 0
    out["quota"] = {
        "units_are": "Google's published cost per method multiplied by the calls counted; not reported by Gmail",
        "calls": dict(gmail.calls), "units": gmail.units(), "seconds_in_calls": round(gmail.seconds, 2),
        "retries": dict(gmail.retries),
        "first_sync_estimate": {"messages": total, "list_units": pages * UNITS["messages.list"],
                                "raw_get_units": total * UNITS["messages.get.raw"]},
    }
    out["not_run"] = {
        "label_change_scope": "needs gmail.modify and the owner's approval",
        "batch_modify_to_trash": "changes the mailbox; needs gmail.modify and the owner's approval",
        "sent_copy_without_append": "sends a message; needs gmail.send and the owner's approval",
    }


# ----------------------------------------------------------------- command line


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("signin", "probe"):
        one = sub.add_parser(name)
        one.add_argument("--client-file", default=DEFAULT_CLIENT)
        one.add_argument("--token-file", default=DEFAULT_TOKEN)
    sub.choices["signin"].add_argument("--replace", action="store_true",
                                       help="sign in again over an existing token; restarts its clock")
    probe = sub.choices["probe"]
    probe.add_argument("--out", required=True)
    probe.add_argument("--limit", type=int, default=5000, help="message ids to list, newest first")
    probe.add_argument("--page-size", type=int, default=MAX_PAGE, help=f"1 to {MAX_PAGE}, Gmail's largest page")
    probe.add_argument("--sample", type=int, default=200, help="messages fetched in raw and metadata form")
    probe.add_argument("--large-sample", type=int, default=20,
                       help="messages over 1 MiB, found by search, fetched the same way")
    probe.add_argument("--workers", type=int, default=1, help="requests in flight at once while fetching")
    args = parser.parse_args(argv)
    if args.command == "probe":
        if not 1 <= args.page_size <= MAX_PAGE:
            parser.error(f"--page-size must be 1 to {MAX_PAGE}")
        if args.limit < 1 or args.sample < 0 or args.large_sample < 0 or args.workers < 1:
            parser.error("--limit and --workers must be at least 1, the samples at least 0")
    return args


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def main(argv: list[str] | None = None, transport=urllib_transport, open_browser=webbrowser.open) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        client = read_client(args.client_file)
        http = Http(transport, client["token_uri"])
        if args.command == "signin":
            if os.path.exists(args.token_file) and not args.replace:
                raise ProbeError(2, f"{args.token_file} exists; signing in again restarts the refresh "
                                    "token's clock, so pass --replace to mean it")
            private_folder(args.token_file)  # before the browser, so a sign-in is never wasted
            result = signin(http, client, args.token_file, open_browser, now_utc)
            print(json.dumps(result, indent=2))
            return 0
        result = run(http, client, read_token(args.token_file), args, now_utc)
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2)
            handle.write("\n")
        outcome = result["refresh_token"].get("outcome")
        if outcome != "ok":
            print(f"The token endpoint refused ({outcome}); the record is written.", file=sys.stderr)
            return 4
        if result.get("stopped"):
            print("The run stopped early; what it learned is written.", file=sys.stderr)
            return result["stopped"]
        return 0 if result["complete"] else 6
    except ProbeError as error:
        print(error, file=sys.stderr)
        return error.code
    except OSError as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    sys.exit(main())
