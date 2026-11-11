"""Tests for the census: the pure analysis, the response splitter and whole runs
against a fake connection. No network. Run: python3 -m unittest test_census -v"""

import argparse
import imaplib
import json
import re
import unittest

import census


def headers(sender, subject, extra=""):
    return f"From: {sender}\r\nTo: me@example.com\r\nSubject: {subject}\r\n{extra}\r\n".encode()


class Shapes(unittest.TestCase):
    def test_subject_shape_drops_what_varies(self):
        a = census.subject_shape("Your order #48213 has shipped")
        b = census.subject_shape("Re: Your order #7 has shipped")
        self.assertEqual(a, b)
        self.assertNotEqual(a, census.subject_shape("Lunch on Friday?"))

    def test_structure_shape_reads_part_types(self):
        text = b'1 (UID 9 BODYSTRUCTURE (("text" "plain" NIL NIL NIL "7BIT" 10 1)("text" "html" NIL NIL NIL "7BIT" 20 1) "alternative"))'
        self.assertEqual(census.structure_shape(text), "text/plain,text/html,multipart/alternative")

    def test_html_skeleton_ignores_text_and_list_length(self):
        one = "<html><body><h1>Hi Ann</h1><ul><li>a</li></ul></body></html>"
        two = "<html><body><h1>Hi Bob</h1><ul><li>a</li><li>b</li><li>c</li></ul></body></html>"
        self.assertEqual(census.html_skeleton(one), census.html_skeleton(two))
        self.assertNotEqual(census.html_skeleton(one), census.html_skeleton("<p>x</p><table></table>"))

    def test_body_fingerprint_prefers_html(self):
        self.assertTrue(census.body_fingerprint(b"Content-Type: text/html\r\n\r\n<p>Hello</p>").startswith("h:"))
        self.assertTrue(census.body_fingerprint(b"Content-Type: text/plain\r\n\r\nhello\r\n").startswith("p:"))


class Addresses(unittest.TestCase):
    def test_empty_fields_do_not_hide_real_ones(self):
        self.assertEqual(census.addresses(["Ann <Ann@Example.com>", "", ""]), ["ann@example.com"])
        self.assertEqual(census.addresses(["", ""]), [])


class Splitter(unittest.TestCase):
    def test_groups_pieces_per_message(self):
        response = [
            (b"1 (UID 5 RFC822.SIZE 10 BODY[HEADER.FIELDS (FROM)] {7}", b"From: a"),
            b")",
            (b'2 (UID 6 BODYSTRUCTURE ("text" "plain" ("name" {4}', b"a.tx"),
            b') NIL NIL "7BIT" 1 1) BODY[HEADER.FIELDS (FROM)] {7}',
            b")",
        ]
        messages = census.split_fetch(response)
        self.assertEqual(len(messages), 2)
        self.assertIn(b"UID 5", messages[0][0])
        self.assertEqual(messages[1][1], [b"a.tx"])

    def test_uid_after_the_literal_stays_with_its_message(self):
        response = [
            (b"1 (BODY[HEADER.FIELDS (FROM)] {7}", b"From: a"),
            b" UID 41 RFC822.SIZE 10)",
            (b"2 (BODY[HEADER.FIELDS (FROM)] {7}", b"From: b"),
            b" UID 42 RFC822.SIZE 20)",
        ]
        messages = census.split_fetch(response)
        self.assertEqual(len(messages), 2)
        self.assertIn(b"UID 41", messages[0][0])
        self.assertIn(b"UID 42", messages[1][0])

    def test_long_search_lines_are_allowed(self):
        self.assertGreaterEqual(imaplib._MAXLINE, 64 * 1024 * 1024)


def make_record(sender, template, **over):
    base = {"sender": sender, "template": template, "thread": sender + template, "size": 5000,
            "year": "2026", "unsub": False, "bulk": False, "auth": True, "self": False, "reply": False}
    base.update(over)
    return base


class Aggregate(unittest.TestCase):

    def records(self):
        records = [make_record("shop", "receipt") for _ in range(6)]                         # templated, no unsubscribe
        records += [make_record("news", "letter", unsub=True, bulk=True) for _ in range(5)]  # templated, a list
        records += [make_record("bob", "chat", reply=True) for _ in range(5)]                # one long thread
        records += [make_record("ann", f"note{i}") for i in range(3)]                        # a person written to
        records += [make_record("stranger", "cold")]                                         # left for judgment
        records += [make_record("me", "sent", **{"self": True}) for _ in range(4)]                  # from the person
        return records

    def test_q1_is_a_share_of_all_messages(self):
        out = census.aggregate(self.records(), written_to={"ann", "bob"})
        self.assertEqual(out["messages"], 24)
        self.assertEqual(out["inbound"], 20)
        self.assertEqual(out["q1"]["templated_without_list_unsubscribe"], 11)
        self.assertEqual(out["q1"]["templated_with_list_unsubscribe"], 5)
        self.assertEqual(out["q1"]["share"], round(11 / 24, 4))
        self.assertEqual(out["q1"]["share_of_inbound"], round(11 / 20, 4))

    def test_q1_variant_leaves_replies_out(self):
        out = census.aggregate(self.records(), written_to={"ann", "bob"})
        self.assertEqual(out["q1"]["excluding_replies"]["templated_without_list_unsubscribe"], 6)
        self.assertEqual(out["q1"]["excluding_replies"]["share"], round(6 / 24, 4))

    def test_q2(self):
        out = census.aggregate(self.records(), written_to={"ann", "bob"})
        self.assertEqual(out["q2"]["from_senders_never_written_to"], 12)
        self.assertEqual(out["q2"]["decided_by_lookup"], 11)
        self.assertEqual(out["q2"]["left_for_judgment"], 1)

    def test_output_holds_no_identity(self):
        text = json.dumps(census.aggregate([make_record("alice@example.com", "t1")], set()))
        self.assertNotIn("alice", text)
        self.assertNotIn("t1", text)


class Store:
    """A made-up account that several fake connections can share."""

    def __init__(self, gmail=False):
        self.gmail = gmail
        self.log = []  # every command any connection sent
        inbox = {}
        uid = 100
        for i in range(8):  # one recurring receipt template
            uid += 1
            inbox[uid] = (headers("shop@example.com", f"Your order #{1000 + i} has shipped"),
                          b"<html><body><h1>Order</h1><p>x</p></body></html>")
        for i in range(6):  # a newsletter
            uid += 1
            inbox[uid] = (headers("news@example.com", f"Weekly digest {i}", "List-Unsubscribe: <mailto:u@example.com>\r\n"),
                          b"<html><body><table><tr><td>y</td></tr></table></body></html>")
        uid += 1
        inbox[uid] = (headers("ann@example.com", "Lunch on Friday?"), b"<p>hi</p>")
        uid += 1
        inbox[uid] = (headers("cold@example.com", "A quick question"), b"<p>hello</p>")
        sent = {1: (b"From: Me <me+work@example.com>\r\nTo: ann@example.com\r\nSubject: Re: Lunch\r\n\r\n", b"<p>yes</p>")}
        if gmail:
            everything = dict(inbox)
            everything[900] = sent[1]
            self.boxes = {'"[Gmail]/All Mail"': everything, '"[Gmail]/Sent Mail"': sent, "INBOX": inbox}
            self.listing = [b'(\\HasNoChildren) "/" INBOX', b'(\\All \\HasNoChildren) "/" "[Gmail]/All Mail"',
                            b'(\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"', b'(\\HasNoChildren \\Trash) "/" "[Gmail]/Trash"']
        else:
            self.boxes = {"INBOX": inbox, '"Sent Messages"': sent, '"Taxes \\"2019\\""': {7: inbox[116]}}
            self.listing = [b'(\\HasNoChildren) "/" INBOX', b'(\\HasNoChildren \\Sent) "/" "Sent Messages"',
                            b'(\\HasNoChildren \\Trash) "/" "Deleted Messages"',
                            (b'(\\HasNoChildren) "/" {12}', b'Taxes "2019"')]


class FakeConnection:
    """Answers as imaplib does. It can drop the connection after some fetches."""

    def __init__(self, store, drop_after=None, always_drop=False, no_search=None, no_examine=None,
                 drop_structures=False, vanish=()):
        self.store, self.drop_after, self.always_drop = store, drop_after, always_drop
        self.no_search, self.no_examine, self.drop_structures, self.vanish = no_search, no_examine, drop_structures, set(vanish)
        self.fetches = 0
        self.selected = self.selected_name = None

    def list(self):
        self.store.log.append("LIST")
        return "OK", list(self.store.listing)

    def select(self, name, readonly=False):
        self.store.log.append("EXAMINE" if readonly else "SELECT")
        if name not in self.store.boxes or name == self.no_examine:
            return "NO", [b"no such mailbox"]
        self.selected, self.selected_name = self.store.boxes[name], name
        return "OK", [str(len(self.selected)).encode()]

    def uid(self, command, ids, what):
        self.store.log.append(f"UID {command} {what}")
        if command == "SEARCH":
            if self.selected_name == self.no_search:
                return "NO", [b"cannot search"]
            return "OK", [b" ".join(str(u).encode() for u in sorted(self.selected))]
        self.fetches += 1
        if self.always_drop or (self.drop_after is not None and self.fetches > self.drop_after):
            raise imaplib.IMAP4.abort("socket error: EOF")
        if self.drop_structures and "BODYSTRUCTURE" in what:
            raise imaplib.IMAP4.abort("socket error: EOF")
        out = []
        for seq, uid in enumerate(int(u) for u in ids.split(",")):
            if uid in self.vanish:
                continue
            head, body = self.selected[uid]
            if "BODYSTRUCTURE" in what:
                out.append(f'{seq + 1} (UID {uid} BODYSTRUCTURE ("text" "html" NIL NIL NIL "7BIT" 40 1))'.encode())
            elif "BODY.PEEK[]" in what:
                raw = b"Content-Type: text/html\r\n\r\n" + body
                out.append((f"{seq + 1} (UID {uid} BODY[]<0> {{{len(raw)}}}".encode(), raw))
                out.append(b")")
            else:
                thread = f" X-GM-THRID {5000 + uid // 10}" if "X-GM-THRID" in what else ""
                meta = (f'{seq + 1} (UID {uid}{thread} RFC822.SIZE 2048 INTERNALDATE " 7-Jul-2026 02:44:25 +0000" '
                        f"BODY[HEADER.FIELDS (X)] {{{len(head)}}}")
                out.append((meta.encode(), head))
                out.append(b")")
        return "OK", out

    def logout(self):
        self.store.log.append("LOGOUT")
        return "BYE", []


def run_census(store, connections, provider="icloud", sample_mb=1, skip_over=0):
    """Run the census against fake connections handed out one per (re)connect."""
    queue = list(connections)
    capabilities = ["IDLE", "X-GM-EXT-1"] if store.gmail else ["IDLE", "CONDSTORE"]
    original = census.connect
    census.connect = lambda host, user, password: (queue.pop(0), {"before_login": ["IDLE"], "after_login": capabilities})
    try:
        args = argparse.Namespace(provider=provider, host=None, user="me@example.com", alias=[], limit=0, sample_mb=sample_mb, skip_over=skip_over)
        return census.run(args, "unused")
    finally:
        census.connect = original


class FullRun(unittest.TestCase):
    def test_counts_an_icloud_like_account(self):
        store = Store()
        out = run_census(store, [FakeConnection(store)])
        self.assertTrue(out["complete"])
        self.assertEqual(out["messages"], 18)             # 16 in the inbox, 1 sent, 1 in a folder
        self.assertEqual(out["from_the_person"], 1)       # found by the alias on the sent message
        self.assertEqual(out["addresses_treated_as_the_person"], 2)
        self.assertEqual(out["distinct_addresses_written_to"], 1)
        self.assertEqual(out["mailboxes"]["counted"], 3)  # the inbox, Sent and the folder; Trash is not
        self.assertEqual(out["q1"]["templated_without_list_unsubscribe"], 8)
        self.assertEqual(out["q1"]["templated_with_list_unsubscribe"], 6)
        self.assertEqual(out["q1"]["share"], round(8 / 18, 4))
        self.assertEqual(out["q2"]["left_for_judgment"], 2)   # the cold sender twice; ann was written to
        self.assertEqual(out["by_year"], {"2026": 18})
        self.assertEqual(out["body_sample"]["agreement"], 1.0)
        self.assertEqual(out["coverage"], {"uids_listed": 18, "messages_read": 18, "listed_not_returned": 0,
                                           "sent_uids_listed": 1, "sent_messages_read": 1,
                                           "sent_listed_not_returned": 0, "mailboxes_not_listed": 0})

    def test_sends_only_commands_that_cannot_change_anything(self):
        store = Store()
        run_census(store, [FakeConnection(store)])
        allowed = re.compile(r"^(LIST|EXAMINE|LOGOUT|UID SEARCH ALL|UID FETCH \((UID |BODY\.PEEK\[|RFC822\.SIZE|INTERNALDATE|BODYSTRUCTURE|X-GM-THRID| |\)|HEADER\.FIELDS \([A-Z -]+\)\]|\]<0\.\d+>|\])+)$")
        for command in store.log:
            self.assertRegex(command, allowed)
            self.assertNotIn("SELECT", command)
            for word in ("STORE", "COPY", "MOVE", "EXPUNGE", "APPEND", "DELETE", "CREATE", "RFC822)", "BODY["):
                self.assertNotIn(word, command.replace("BODY.PEEK[", ""))

    def test_output_holds_nothing_private(self):
        store = Store()
        text = json.dumps(run_census(store, [FakeConnection(store)]))
        for private in ("example.com", "order", "Lunch", "digest", "Taxes", "Sent Messages", "me+work"):
            self.assertNotIn(private, text)
        self.assertIsNone(re.search(r"[0-9a-f]{16,}", text))   # no hash of anything

    def test_gmail_counts_all_mail_once_and_threads_by_its_id(self):
        store = Store(gmail=True)
        out = run_census(store, [FakeConnection(store)], provider="gmail")
        self.assertEqual(out["mailboxes"]["counted"], 1)        # All Mail only: the inbox is inside it
        self.assertEqual(out["messages"], 17)
        self.assertEqual(out["from_the_person"], 1)
        self.assertTrue(any("X-GM-THRID" in c for c in store.log))
        self.assertLess(out["threads"]["distinct"], 17)         # the fake ids group messages

    def test_a_dropped_connection_is_reconnected_and_nothing_is_lost(self):
        store = Store()
        out = run_census(store, [FakeConnection(store, drop_after=2), FakeConnection(store)])
        self.assertTrue(out["complete"])
        self.assertEqual(out["coverage"]["messages_read"], out["coverage"]["uids_listed"])
        self.assertEqual(out["errors"].get("dropped:abort"), 1)

    def test_a_lost_account_is_reported_incomplete(self):
        store = Store()
        dead = [FakeConnection(store, drop_after=2)] + [FakeConnection(store, always_drop=True) for _ in range(40)]
        out = run_census(store, dead)
        self.assertFalse(out["complete"])
        self.assertLess(out["coverage"]["messages_read"], out["coverage"]["uids_listed"])

    def test_a_sent_folder_that_cannot_be_searched_makes_the_run_incomplete(self):
        store = Store()
        out = run_census(store, [FakeConnection(store, no_search='"Sent Messages"')])
        self.assertFalse(out["complete"])                      # Q2 would call everyone a stranger
        self.assertEqual(out["coverage"]["mailboxes_not_listed"], 2)   # once as Sent, once as a counted mailbox

    def test_a_folder_that_cannot_be_opened_makes_the_run_incomplete(self):
        store = Store()
        out = run_census(store, [FakeConnection(store, no_examine='"Taxes \\"2019\\""')])
        self.assertFalse(out["complete"])
        self.assertEqual(out["errors"]["examine_refused"], 1)

    def test_lost_structures_make_the_run_incomplete(self):
        store = Store()
        out = run_census(store, [FakeConnection(store, drop_structures=True) for _ in range(40)])
        self.assertFalse(out["complete"])                      # Q1's templates would be split
        self.assertGreater(out["errors"]["without_structure"], 0)

    def test_a_message_listed_but_not_returned_is_counted_and_does_not_make_it_incomplete(self):
        store = Store()
        out = run_census(store, [FakeConnection(store, vanish={115})])
        self.assertTrue(out["complete"])
        self.assertEqual(out["coverage"]["listed_not_returned"], 1)
        self.assertEqual(out["coverage"]["messages_read"], 17)

    def test_a_mailbox_over_the_skip_threshold_is_left_out_and_recorded(self):
        store = Store()
        out = run_census(store, [FakeConnection(store)], skip_over=5)   # the inbox lists 16
        self.assertEqual(out["skipped_over"], {"threshold": 5, "mailboxes": 1, "uids_listed": 16})
        self.assertEqual(out["messages"], 2)
        self.assertTrue(out["complete"])

    def test_the_byte_cap_stops_the_body_sample(self):
        store = Store()
        out = run_census(store, [FakeConnection(store)], sample_mb=0)
        self.assertEqual(out["body_sample"]["bodies_fetched"], 0)


if __name__ == "__main__":
    unittest.main()
