"""Tests for the Gmail probe: whole runs against a fake Gmail API and token endpoint, and the
sign-in against a fake browser on loopback. No network beyond 127.0.0.1.
Run: python3 -m unittest test_gmail_probe -v"""

import base64
import hashlib
import json
import os
import stat
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import gmail_probe as probe

TOKEN_URI = probe.TOKEN_URI  # the fake transport answers it; nothing leaves the machine
CLIENT = {"installed": {"client_id": "client-id.apps.example", "client_secret": "CLIENT-SECRET-XYZ",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": TOKEN_URI,
                        "redirect_uris": ["http://localhost"]}}
REFRESH = "REFRESH-TOKEN-SECRET"
ACCESS = "ACCESS-TOKEN-SECRET"
PRIVATE = ("ann@example.com", "Lunch on Friday", "Taxes 2019", "msg-", "thread-", REFRESH, ACCESS,
           "CLIENT-SECRET-XYZ")
NOW = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc)


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def message(i: int) -> bytes:
    subject = "=?utf-8?q?Caf=C3=A9_menu?=" if i == 0 else f"Lunch on Friday {i}"
    return (f"From: Ann <ann@example.com>\r\nTo: me@example.com\r\nSubject: {subject}\r\n"
            f"X-Long: a value that\r\n continues here\r\n\r\nHello {i}\r\n").encode()


class FakeGoogle:
    """A Gmail account of a few messages, its history and the token endpoint."""

    def __init__(self, count=7, history_floor=900, refuse_refresh=False, rate_limit=0, forbid_limit=0,
                 token_answer=None, large=(), fail_after=None):
        self.messages = {f"msg-{i}": (f"thread-{i // 2}", message(i), 1000 - i) for i in range(count)}
        self.current = 1000
        self.history_floor = history_floor
        self.refuse_refresh = refuse_refresh
        self.rate_limit = rate_limit  # 429s to answer before the first messages.get succeeds
        self.forbid_limit = forbid_limit  # 403 userRateLimitExceeded, the same way
        self.requests = []
        self.lock = threading.Lock()
        self.token_answer = token_answer  # (status, body) the token endpoint gives instead
        self.large = set(large)  # message ids a search for larger:1M finds
        self.fail_after = fail_after  # Gmail API calls answered before the network drops
        self.api_calls = 0

    def __call__(self, method, url, headers, body):
        with self.lock:
            self.requests.append((method, url, dict(headers), body))
        parsed = urllib.parse.urlparse(url)
        query = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        if url == TOKEN_URI:
            if self.token_answer:
                return self.token_answer
            return self.token(dict(urllib.parse.parse_qsl(body.decode())))
        with self.lock:
            self.api_calls += 1
            if self.fail_after is not None and self.api_calls > self.fail_after:
                raise probe.ProbeError(5, "network: TimeoutError")
        if headers.get("Authorization") != f"Bearer {ACCESS}":
            return 401, b'{"error":{"code":401,"status":"UNAUTHENTICATED"}}'
        path = parsed.path.split("/users/me/", 1)[1]
        if path == "profile":
            return self.ok({"emailAddress": "ann@example.com", "messagesTotal": len(self.messages),
                            "threadsTotal": 4, "historyId": str(self.current)})
        if path == "labels":
            return self.ok({"labels": [{"id": "INBOX", "name": "INBOX", "type": "system"},
                                       {"id": "SENT", "name": "SENT", "type": "system"},
                                       {"id": "Label_1", "name": "Taxes 2019", "type": "user"}]})
        if path == "messages":
            ids = sorted(self.messages, key=lambda m: int(m.split("-")[1]))
            if query.get("q") == "larger:1M":
                ids = [m for m in ids if m in self.large]
            start = int(query.get("pageToken", 0))
            size = int(query["maxResults"])
            page = ids[start:start + size]
            answer = {"messages": [{"id": m, "threadId": self.messages[m][0]} for m in page]}
            if start + size < len(ids):
                answer["nextPageToken"] = str(start + size)
            return self.ok(answer)
        if path.startswith("messages/"):
            return self.get(path.split("/", 1)[1], query["format"])
        if path == "history":
            start = int(query["startHistoryId"])
            if start < self.history_floor:
                return 404, json.dumps({"error": {"code": 404, "message": "Requested entity was not found.",
                                                  "errors": [{"reason": "notFound"}], "status": "NOT_FOUND"}}).encode()
            added = [{"id": str(h), "messagesAdded": [{"message": {"id": m}}]}
                     for m, (_, _, h) in self.messages.items() if h > start]
            return self.ok({"history": added, "historyId": str(self.current)})
        return 404, b"{}"

    def get(self, message_id, form):
        with self.lock:
            if self.rate_limit:
                self.rate_limit -= 1
                return 429, (b'{"error":{"code":429,"errors":[{"reason":"rateLimitExceeded"}],'
                             b'"status":"RESOURCE_EXHAUSTED"}}')
            if self.forbid_limit:
                self.forbid_limit -= 1
                return 403, b'{"error":{"code":403,"errors":[{"reason":"userRateLimitExceeded"}]}}'
        thread, raw, history = self.messages[message_id]
        if form == "raw":
            return self.ok({"id": message_id, "threadId": thread, "historyId": str(history), "raw": b64(raw)})
        headers = []
        for line in raw.split(b"\r\n\r\n")[0].replace(b"\r\n ", b" ").split(b"\r\n"):
            name, _, value = line.decode().partition(": ")
            if value.startswith("=?utf-8?q?"):
                value = "Café menu"
            headers.append({"name": name, "value": value})
        return self.ok({"id": message_id, "historyId": str(history), "payload": {"headers": headers}})

    def token(self, form):
        if form["client_secret"] != "CLIENT-SECRET-XYZ":
            return 401, b'{"error":"invalid_client"}'
        if form["grant_type"] == "refresh_token":
            if self.refuse_refresh or form["refresh_token"] != REFRESH:
                return 400, b'{"error":"invalid_grant","error_description":"Token has been expired or revoked."}'
            return self.ok({"access_token": ACCESS, "expires_in": 3599, "scope": probe.SCOPE})
        self.last_code_form = form
        return self.ok({"access_token": ACCESS, "refresh_token": REFRESH, "scope": self.granted})

    granted = probe.SCOPE

    @staticmethod
    def ok(data):
        return 200, json.dumps(data).encode()


class Files(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.client = os.path.join(self.folder.name, "client.json")
        self.token = os.path.join(self.folder.name, "config", "token.json")
        self.out = os.path.join(self.folder.name, "out.json")
        with open(self.client, "w") as handle:
            json.dump(CLIENT, handle)

    def save_token(self, issued=NOW - timedelta(days=8)):
        probe.write_private(self.token, {"refresh_token": REFRESH, "issued_at": issued.isoformat(),
                                         "scope": [probe.SCOPE]})

    def run_probe(self, google, *extra):
        argv = ["probe", "--client-file", self.client, "--token-file", self.token, "--out", self.out,
                "--page-size", "3", *extra]
        args = probe.parse_args(argv)
        http = probe.Http(google, TOKEN_URI)
        token = probe.read_token(self.token)
        return probe.run(http, CLIENT["installed"], token, args, lambda: NOW, sleep=lambda s: None), http


class ReadOnly(unittest.TestCase):
    def test_refuses_anything_but_a_get_to_the_api(self):
        http = probe.Http(lambda *a: (200, b"{}"), TOKEN_URI)
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            with self.assertRaises(probe.WriteRefused):
                http.request(method, f"{probe.API}/messages/batchModify")
        with self.assertRaises(probe.WriteRefused):
            http.request("GET", "https://example.test/other")
        with self.assertRaises(probe.WriteRefused):
            http.request("POST", f"{TOKEN_URI}/revoke")
        with self.assertRaises(probe.WriteRefused):
            http.request("POST", "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send")
        with self.assertRaises(probe.WriteRefused):
            http.request("GET", "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages")
        self.assertEqual(http.sent, [])

    def test_a_token_address_that_is_not_googles_is_never_used(self):
        http = probe.Http(lambda *a: (200, b"{}"), probe.API + "/messages/send")
        with self.assertRaises(probe.WriteRefused):
            http.request("POST", probe.API + "/messages/send")

    def test_asks_for_read_access_alone(self):
        self.assertEqual(probe.SCOPE, "https://www.googleapis.com/auth/gmail.readonly")
        url = probe.auth_url(CLIENT["installed"], "http://127.0.0.1:9", "s", "c")
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["scope"], [probe.SCOPE])


class ClientFile(Files):
    def test_a_web_client_is_refused(self):
        with open(self.client, "w") as handle:
            json.dump({"web": CLIENT["installed"]}, handle)
        with self.assertRaises(probe.ProbeError) as caught:
            probe.read_client(self.client)
        self.assertEqual(caught.exception.code, 2)

    def test_a_client_naming_another_token_address_is_refused(self):
        for key, value in (("token_uri", "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send"),
                           ("auth_uri", "https://accounts.example.test/auth")):
            with open(self.client, "w") as handle:
                json.dump({"installed": {**CLIENT["installed"], key: value}}, handle)
            with self.assertRaises(probe.ProbeError) as caught:
                probe.read_client(self.client)
            self.assertEqual(caught.exception.code, 2)

    def test_the_probes_own_open_folder_is_made_private(self):
        self.addCleanup(setattr, probe, "DEFAULT_DIR", probe.DEFAULT_DIR)
        probe.DEFAULT_DIR = os.path.dirname(self.token)
        os.makedirs(os.path.dirname(self.token), mode=0o755)
        os.chmod(os.path.dirname(self.token), 0o755)
        self.save_token()
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(self.token)).st_mode), 0o700)
        self.assertEqual(os.listdir(os.path.dirname(self.token)), ["token.json"])

    def test_a_named_folder_others_can_open_is_refused_not_changed(self):
        folder = os.path.join(self.folder.name, "shared")
        os.makedirs(folder)
        os.chmod(folder, 0o755)
        with self.assertRaises(probe.ProbeError) as caught:
            probe.write_private(os.path.join(folder, "token.json"), {})
        self.assertEqual(caught.exception.code, 2)
        self.assertEqual(stat.S_IMODE(os.stat(folder).st_mode), 0o755)
        code = probe.main(["signin", "--client-file", self.client, "--token-file", os.path.join(folder, "t.json")],
                          transport=FakeGoogle(), open_browser=lambda url: self.fail("opened the browser"))
        self.assertEqual(code, 2)

    def test_a_page_larger_than_gmails_is_refused(self):
        with self.assertRaises(SystemExit):
            probe.parse_args(["probe", "--out", "x", "--page-size", "1000"])

    def test_a_missing_client_file_is_a_usage_error(self):
        code = probe.main(["probe", "--client-file", self.client + ".no", "--token-file", self.token,
                           "--out", self.out], transport=FakeGoogle())
        self.assertEqual(code, 2)

    def test_the_token_file_is_private(self):
        self.save_token()
        self.assertEqual(stat.S_IMODE(os.stat(self.token).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(self.token)).st_mode), 0o700)


class FullRun(Files):
    def test_counts_an_account(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle())
        self.assertTrue(out["complete"], out["errors"])
        self.assertEqual(out["refresh_token"]["outcome"], "ok")
        self.assertEqual(out["refresh_token"]["age_hours"], 192.0)
        self.assertEqual(out["profile"], {"messages_total": 7, "threads_total": 4})
        self.assertEqual(out["labels"], {"by_type": {"system": 2, "user": 1}, "system": ["INBOX", "SENT"]})
        self.assertEqual(out["list"]["ids"], 7)
        self.assertEqual(out["list"]["pages"], 3)
        self.assertEqual(out["list"]["threads"], 4)
        self.assertTrue(out["list"]["reached_end"])
        self.assertEqual(out["fetch"]["fetched_raw"], 7)
        self.assertEqual(out["fetch"]["metadata_headers_against_raw"],
                         {"<=64KiB:same": 6, "<=64KiB:values_differ": 1})
        self.assertEqual(out["list_large"]["ids"], 0)
        self.assertEqual(out["fetch"]["sizes"], {"<=64KiB": 7})

    def test_sends_only_reads_and_token_requests(self):
        self.save_token()
        google = FakeGoogle()
        _, http = self.run_probe(google)
        methods = {(m, p.startswith(probe.API) or p == TOKEN_URI) for m, p in http.sent}
        self.assertEqual(methods, {("GET", True), ("POST", True)})
        self.assertEqual([p for m, p in http.sent if m == "POST"], [TOKEN_URI])
        self.assertEqual(len(google.requests), len(http.sent))

    def test_output_holds_nothing_private(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle())
        text = json.dumps(out)
        for value in PRIVATE:
            self.assertNotIn(value, text)

    def test_counts_calls_and_published_units(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle())
        calls = out["quota"]["calls"]
        self.assertEqual(calls["profile"], 1)
        self.assertEqual(calls["messages.list"], 4)  # three pages, and the search for large mail
        self.assertEqual(calls["messages.get.raw"], 7)
        self.assertEqual(calls["messages.get.metadata"], 7)
        self.assertEqual(out["quota"]["units"], sum(probe.UNITS[k] * v for k, v in calls.items()))
        self.assertEqual(out["quota"]["first_sync_estimate"], {"messages": 7, "list_units": 15, "raw_get_units": 35})

    def test_rate_limits_are_retried_and_counted(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle(rate_limit=2, forbid_limit=1))
        self.assertTrue(out["complete"])
        self.assertEqual(out["fetch"]["fetched_raw"], 7)
        self.assertEqual(out["quota"]["retries"], {"429:rateLimitExceeded": 2, "403:userRateLimitExceeded": 1})

    def test_a_history_id_too_old_is_recorded(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle(history_floor=996))
        by_start = {h["start"]: h for h in out["history"]}
        self.assertEqual(by_start["current"]["records"], 0)
        self.assertEqual(by_start["newest_sampled"]["records"], 0)
        self.assertEqual(by_start["oldest_sampled"]["error"],
                         {"http": 404, "status": "NOT_FOUND", "reason": "notFound"})
        self.assertEqual(by_start["one"]["behind_current"], 999)
        self.assertIn("error", by_start["one"])

    def test_a_history_sync_counts_what_was_added(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle(history_floor=0))
        by_start = {h["start"]: h for h in out["history"]}
        self.assertEqual(by_start["oldest_sampled"]["messages_added"], 6)

    def test_the_sample_is_bounded(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle(count=20), "--limit", "10", "--sample", "4", "--workers", "3")
        self.assertEqual(out["list"]["ids"], 10)
        self.assertFalse(out["list"]["reached_end"])
        self.assertEqual(out["fetch"]["fetched_raw"], 4)

    def test_an_expired_refresh_token_writes_the_record_and_exits_four(self):
        self.save_token()
        code = probe.main(["probe", "--client-file", self.client, "--token-file", self.token, "--out", self.out],
                          transport=FakeGoogle(refuse_refresh=True))
        self.assertEqual(code, 4)
        with open(self.out) as handle:
            out = json.load(handle)
        self.assertEqual(out["refresh_token"]["outcome"], "refused")
        self.assertIn("invalid_grant", out["refresh_token"]["detail"])
        self.assertFalse(out["complete"])
        self.assertNotIn(REFRESH, json.dumps(out))

    def main_probe(self, google):
        code = probe.main(["probe", "--client-file", self.client, "--token-file", self.token, "--out", self.out],
                          transport=google)
        record = None
        if os.path.exists(self.out):
            with open(self.out) as handle:
                record = json.load(handle)
        return code, record

    def test_a_token_endpoint_outage_is_not_an_expired_token(self):
        self.save_token()
        for answer in ((503, b'{"error":"backend_error"}'), (429, b"Too many"), (502, b"<html>proxy</html>"),
                       (200, b"<html>captive portal</html>"), (200, b'{"token_type":"Bearer"}')):
            if os.path.exists(self.out):
                os.remove(self.out)
            code, record = self.main_probe(FakeGoogle(token_answer=answer))
            self.assertEqual(code, 5, answer)
            self.assertIsNone(record, answer)

    def test_a_refused_client_is_told_apart_from_an_expired_token(self):
        self.save_token()
        code, record = self.main_probe(FakeGoogle(token_answer=(401, b'{"error":"invalid_client"}')))
        self.assertEqual(code, 4)
        self.assertEqual(record["refresh_token"]["outcome"], "client_refused")

    def test_a_network_failure_after_the_refresh_keeps_its_outcome(self):
        self.save_token()
        code, record = self.main_probe(FakeGoogle(fail_after=3))
        self.assertEqual(code, 5)
        self.assertEqual(record["refresh_token"]["outcome"], "ok")
        self.assertEqual(record["refresh_token"]["age_hours"] > 0, True)
        self.assertFalse(record["complete"])
        self.assertEqual(record["stopped"], 5)

    def test_an_unreadable_api_answer_stops_with_five(self):
        self.save_token()
        google = FakeGoogle()
        real = google.__call__

        def portal(method, url, headers, body):
            if "/labels" in url:
                return 200, b"<html>portal</html>"
            return real(method, url, headers, body)

        code, record = self.main_probe(portal)
        self.assertEqual(code, 5)
        self.assertIn("profile", record)

    def test_large_messages_are_sampled_by_search(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle(large={"msg-2", "msg-5"}))
        self.assertEqual(out["list_large"]["ids"], 2)
        self.assertEqual(out["fetch_large"]["fetched_raw"], 2)

    def test_main_writes_a_complete_record(self):
        self.save_token()
        code = probe.main(["probe", "--client-file", self.client, "--token-file", self.token, "--out", self.out],
                          transport=FakeGoogle())
        self.assertEqual(code, 0)
        with open(self.out) as handle:
            self.assertTrue(json.load(handle)["complete"])

    def test_a_network_failure_exits_five(self):
        self.save_token()

        def down(*_):
            raise probe.ProbeError(5, "network: URLError")

        code = probe.main(["probe", "--client-file", self.client, "--token-file", self.token, "--out", self.out],
                          transport=down)
        self.assertEqual(code, 5)


class Shapes(unittest.TestCase):
    def test_an_error_body_that_is_not_an_object(self):
        self.assertEqual(probe.error_shape(500, b"[]"), {"http": 500})
        self.assertEqual(probe.error_shape(500, b"null"), {"http": 500})

    def test_the_header_block_ends_at_the_first_blank_line(self):
        self.assertEqual(probe.header_block(b"A: 1\nB: 2\n\nbody\r\n\r\nmore"), b"A: 1\nB: 2")


class Gaps(Files):
    def test_a_failed_listing_does_not_claim_the_end(self):
        self.save_token()
        google = FakeGoogle()
        real = google.__call__

        def broken(method, url, headers, body):
            if url.split("?")[0].endswith("/messages"):
                return 500, b'{"error":{"code":500}}'
            return real(method, url, headers, body)

        out, _ = self.run_probe(broken)
        self.assertFalse(out["list"]["reached_end"])
        self.assertFalse(out["complete"])

    def test_a_history_failure_other_than_too_old_is_a_gap(self):
        self.save_token()
        google = FakeGoogle(history_floor=0)
        real = google.__call__

        def broken(method, url, headers, body):
            if "/history" in url:
                return 403, b'{"error":{"code":403,"errors":[{"reason":"forbidden"}]}}'
            return real(method, url, headers, body)

        out, _ = self.run_probe(broken)
        self.assertFalse(out["complete"])

    def test_history_too_old_alone_keeps_the_run_complete(self):
        self.save_token()
        out, _ = self.run_probe(FakeGoogle(history_floor=996))
        self.assertTrue(out["complete"], out["errors"])


class Headers(unittest.TestCase):
    def test_folded_headers_compare_the_same(self):
        raw = b"A: one\r\nB: two\r\n  more\r\n\r\nbody"
        meta = {"payload": {"headers": [{"name": "A", "value": "one"}, {"name": "B", "value": "two more"}]}}
        self.assertEqual(probe.compare_headers(raw, meta), "same")

    def test_decoded_and_different_headers(self):
        raw = b"Subject: =?utf-8?q?x?=\r\n\r\n"
        self.assertEqual(probe.compare_headers(raw, {"payload": {"headers": [{"name": "Subject", "value": "x"}]}}),
                         "values_differ")
        self.assertEqual(probe.compare_headers(raw, {"payload": {"headers": []}}), "names_differ")


class SignIn(Files):
    def browser(self, wrong_state_first=False):
        def open_browser(url):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            self.asked = query
            target = query["redirect_uri"][0]
            if wrong_state_first:
                try:
                    urllib.request.urlopen(f"{target}/?state=forged&code=evil", timeout=5)
                except urllib.error.HTTPError as error:
                    self.assertEqual(error.code, 400)
            params = urllib.parse.urlencode({"state": query["state"][0], "code": "the-code"})
            threading.Thread(target=lambda: urllib.request.urlopen(f"{target}/?{params}", timeout=5).read(),
                             daemon=True).start()
        return open_browser

    def test_signs_in_with_pkce_and_keeps_the_refresh_token(self):
        google = FakeGoogle()
        code = probe.main(["signin", "--client-file", self.client, "--token-file", self.token],
                          transport=google, open_browser=self.browser(wrong_state_first=True))
        self.assertEqual(code, 0)
        token = probe.read_token(self.token)
        self.assertEqual(token["refresh_token"], REFRESH)
        self.assertEqual(token["scope"], [probe.SCOPE])
        self.assertEqual(stat.S_IMODE(os.stat(self.token).st_mode), 0o600)
        form = google.last_code_form
        self.assertEqual(form["code"], "the-code")
        self.assertTrue(form["redirect_uri"].startswith("http://127.0.0.1:"))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(form["code_verifier"].encode()).digest()).rstrip(b"=")
        self.assertEqual(self.asked["code_challenge"], [challenge.decode()])
        self.assertEqual(self.asked["access_type"], ["offline"])

    def test_a_broader_grant_is_refused_and_not_kept(self):
        google = FakeGoogle()
        google.granted = f"{probe.SCOPE} https://mail.google.com/"
        code = probe.main(["signin", "--client-file", self.client, "--token-file", self.token],
                          transport=google, open_browser=self.browser())
        self.assertEqual(code, 4)
        self.assertFalse(os.path.exists(self.token))

    def test_an_existing_token_is_not_replaced_unasked(self):
        self.save_token()
        code = probe.main(["signin", "--client-file", self.client, "--token-file", self.token],
                          transport=FakeGoogle(), open_browser=lambda url: self.fail("opened the browser"))
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
