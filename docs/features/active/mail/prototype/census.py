#!/usr/bin/env python3
"""Mailbox census for the Mail proposal's phase 0 (steps 0.1 and 0.2).

Opens one mail account over IMAP without changing it and writes a file of counts.
It reads every message's headers and structure, and a sample of bodies under a byte
cap. It keeps no address, subject or text: identities are hashed with a key that
exists only in memory for the run, and no hash is written to the output.

Standard library only. Python 3.10 or later.

    python3 census.py --provider icloud --user you@icloud.com --out icloud.counts.json
    python3 census.py --provider gmail --user you@gmail.com --out gmail.counts.json

The password is read from a prompt, or from --password-file. It is never an argument.
Exit codes: 0 complete, 4 sign-in or IMAP refusal, 5 network, 6 written but incomplete.
"""

from __future__ import annotations

import argparse
import email
import email.policy
import getpass
import hashlib
import hmac
import imaplib
import json
import os
import random
import re
import sys
import time
from collections import Counter, defaultdict
from email.header import decode_header, make_header
from email.utils import getaddresses
from html.parser import HTMLParser

# One UID SEARCH answer is a single line; imaplib refuses lines over 1 MB, which a
# mailbox of about 130 000 messages already exceeds.
imaplib._MAXLINE = max(imaplib._MAXLINE, 64 * 1024 * 1024)

TOOL_VERSION = 4
TEMPLATE_MIN = 5  # a template is one seen at least this many times (the proposal's Q1)
BATCH = 250
BODY_PREFIX_BYTES = 128 * 1024  # how much of a sampled message is fetched
PROVIDERS = {
    "icloud": {"host": "imap.mail.me.com"},
    "gmail": {"host": "imap.gmail.com"},
}
HEADER_FIELDS = (
    "FROM TO CC BCC SUBJECT LIST-ID LIST-UNSUBSCRIBE PRECEDENCE AUTO-SUBMITTED "
    "MESSAGE-ID IN-REPLY-TO REFERENCES AUTHENTICATION-RESULTS"
)
SKIP_FLAGS = {"\\junk", "\\trash", "\\drafts", "\\noselect", "\\nonexistent"}
SKIP_NAMES = {"junk", "spam", "trash", "deleted messages", "deleted items", "drafts", "bin"}


# ----------------------------------------------------------------- pure analysis


def subject_shape(subject: str) -> str:
    """The subject with what varies between copies of one template removed."""
    text = subject.lower().strip()
    text = re.sub(r"^((re|fwd?|aw|wg|tr)\s*(\[\d+\])?:\s*)+", "", text)
    text = re.sub(r"[0-9a-f]{8,}", "@", text)  # long hex ids
    text = re.sub(r"\b\w*\d\w*\b", "#", text)  # any token holding a digit
    text = re.sub(r"\s+", " ", text)
    return text[:120]


def structure_shape(bodystructure: bytes) -> str:
    """The MIME types of a message's parts, in order, from an IMAP BODYSTRUCTURE."""
    types = re.findall(
        rb'"(text|image|application|audio|video|message|font|model)"\s+"([^"]{1,60})"',
        bodystructure,
        flags=re.I,
    )
    multi = re.findall(rb'\)\s*"(alternative|mixed|related|signed|report|digest)"', bodystructure, flags=re.I)
    parts = [f"{a.decode('ascii', 'replace').lower()}/{b.decode('ascii', 'replace').lower()}" for a, b in types]
    parts += [f"multipart/{m.decode('ascii', 'replace').lower()}" for m in multi]
    return ",".join(parts)[:300]


class _Skeleton(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tags: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if not self.tags or self.tags[-1] != tag:  # collapse runs of one tag
            self.tags.append(tag)


def html_skeleton(html: str) -> str:
    """A hash of an HTML body's element sequence, with all text and attributes removed."""
    parser = _Skeleton()
    try:
        parser.feed(html)
    except Exception:
        pass
    return hashlib.sha256(" ".join(parser.tags).encode()).hexdigest()[:16]


def plain_shape(text: str) -> str:
    """A hash of a plain-text body's sequence of line shapes."""
    shapes: list[str] = []
    for line in text.splitlines()[:400]:
        stripped = line.strip()
        if not stripped:
            shape = "b"
        elif stripped.startswith(">"):
            shape = "q"
        elif "http://" in stripped or "https://" in stripped:
            shape = "u"
        elif len(stripped) < 40:
            shape = "s"
        else:
            shape = "l"
        if not shapes or shapes[-1] != shape:
            shapes.append(shape)
    return hashlib.sha256("".join(shapes).encode()).hexdigest()[:16]


def body_fingerprint(raw: bytes) -> str | None:
    """The body-level template fingerprint of one message, or None if it has no text."""
    try:
        message = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception:
        return None
    html = plain = None
    for part in message.walk():
        kind = part.get_content_type()
        if kind not in ("text/html", "text/plain") or part.get_filename():
            continue
        try:
            content = part.get_content()
        except Exception:
            continue
        if not isinstance(content, str):
            continue
        if kind == "text/html" and html is None:
            html = content
        elif kind == "text/plain" and plain is None:
            plain = content
    if html is not None:
        return "h:" + html_skeleton(html)
    if plain is not None:
        return "p:" + plain_shape(plain)
    return None


def bucket(value: int, edges: list[int]) -> str:
    low = 0
    for edge in edges:
        if value <= edge:
            return f"{low + 1}-{edge}" if low + 1 != edge else str(edge)
        low = edge
    return f"{edges[-1] + 1}+"


def share(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def addresses(fields: list[str]) -> list[str]:
    """The addresses in some header fields, lowercased. Empty fields are dropped first:
    newer Pythons parse strictly and return nothing for a list that holds one."""
    present = [f for f in fields if f and f.strip()]
    if not present:
        return []
    try:
        pairs = getaddresses(present, strict=False)
    except TypeError:  # before Python 3.13
        pairs = getaddresses(present)
    return [address.lower() for _, address in pairs if "@" in address]


def aggregate(records: list[dict], written_to: set[str]) -> dict:
    """Turn per-message records into counts. Nothing identifying survives this function.

    A record holds hashes (sender, template, thread) and plain facts: size, year, unsub,
    bulk, auth, self, reply.
    """
    inbound = [r for r in records if not r["self"]]
    templates = Counter(r["template"] for r in inbound)
    threads = Counter(r["thread"] for r in records)
    senders = Counter(r["sender"] for r in inbound)

    templated = [r for r in inbound if templates[r["template"]] >= TEMPLATE_MIN]
    templated_unsub = sum(1 for r in templated if r["unsub"])
    templated_plain = len(templated) - templated_unsub
    # A long thread with one person shares a subject and a structure, so its replies look
    # like a template. This variant leaves replies out.
    templated_plain_no_replies = sum(1 for r in templated if not r["unsub"] and not r["reply"])

    strangers = [r for r in inbound if r["sender"] not in written_to]
    strangers_lookup = sum(1 for r in strangers if r["bulk"] or templates[r["template"]] >= TEMPLATE_MIN)

    top = [count for _, count in senders.most_common()]
    return {
        "messages": len(records),
        "inbound": len(inbound),
        "from_the_person": len(records) - len(inbound),
        "with_list_unsubscribe": sum(1 for r in inbound if r["unsub"]),
        "with_any_bulk_header": sum(1 for r in inbound if r["bulk"]),
        "with_authentication_results": sum(1 for r in inbound if r["auth"]),
        "replies": sum(1 for r in inbound if r["reply"]),
        "q1": {
            "question": f"share of all messages in a template seen at least {TEMPLATE_MIN} times "
            "that carry no list-unsubscribe header",
            "templated_without_list_unsubscribe": templated_plain,
            "templated_with_list_unsubscribe": templated_unsub,
            "untemplated_inbound": len(inbound) - len(templated),
            "share": share(templated_plain, len(records)),
            "share_of_inbound": share(templated_plain, len(inbound)),
            "share_templated_with_list_unsubscribe": share(templated_unsub, len(records)),
            "excluding_replies": {
                "templated_without_list_unsubscribe": templated_plain_no_replies,
                "share": share(templated_plain_no_replies, len(records)),
            },
        },
        "q2": {
            "question": "of inbound messages from senders the person never wrote to, the share "
            "with a list or bulk header or in a template",
            "from_senders_never_written_to": len(strangers),
            "decided_by_lookup": strangers_lookup,
            "left_for_judgment": len(strangers) - strangers_lookup,
            "share": share(strangers_lookup, len(strangers)),
            "from_senders_written_to": len(inbound) - len(strangers),
        },
        "templates": {
            "distinct": len(templates),
            "seen_at_least_min": sum(1 for c in templates.values() if c >= TEMPLATE_MIN),
            "by_size": dict(Counter(bucket(c, [1, 4, 19, 99, 999]) for c in templates.values())),
        },
        "senders": {
            "distinct": len(senders),
            "share_of_inbound_from_top_10": share(sum(top[:10]), len(inbound)),
            "share_of_inbound_from_top_100": share(sum(top[:100]), len(inbound)),
            "by_volume": dict(Counter(bucket(c, [1, 4, 19, 99, 999]) for c in senders.values())),
        },
        "threads": {
            "distinct": len(threads),
            "by_size": dict(Counter(bucket(c, [1, 2, 5, 10, 50]) for c in threads.values())),
        },
        "sizes_bytes": dict(
            Counter(bucket(r["size"], [4096, 16384, 65536, 262144, 1048576, 10485760]) for r in records)
        ),
        "total_bytes": sum(r["size"] for r in records),
        "by_year": dict(sorted(Counter(r["year"] for r in records).items())),
    }


# ----------------------------------------------------------------- IMAP reading


def split_fetch(response: list) -> list[tuple[bytes, list[bytes]]]:
    """Group an imaplib FETCH response into one (text, literals) pair per message."""
    messages: list[tuple[bytearray, list[bytes]]] = []
    start = re.compile(rb"^\d+ \((?:UID|RFC822|BODY|INTERNALDATE|X-GM|FLAGS)")
    for item in response or []:
        if item is None:
            continue
        head = item[0] if isinstance(item, tuple) else item
        if start.match(head) or not messages:
            messages.append((bytearray(), []))
        text, literals = messages[-1]
        text += head
        if isinstance(item, tuple):
            literals.append(item[1])
            text += b" "
    return [(bytes(text), literals) for text, literals in messages]


def header_value(message: email.message.Message, name: str) -> str:
    raw = message.get(name)
    if raw is None:
        return ""
    try:
        return str(make_header(decode_header(str(raw))))
    except Exception:
        return str(raw)


class Census:
    def __init__(self, user: str, aliases: list[str]) -> None:
        self.key = os.urandom(32)  # never written anywhere
        self.me = {a.lower() for a in [user, *aliases]}
        self.written_to: set[str] = set()
        self.records: list[dict] = []
        self.uids: list[tuple[int, int, str]] = []  # (mailbox index, uid, template) for sampling
        self.pending: dict[tuple[int, int], dict] = {}  # records waiting for their structure
        self.errors: Counter = Counter()

    def h(self, value: str) -> str:
        return hmac.new(self.key, value.encode("utf-8", "replace"), hashlib.sha256).hexdigest()[:20]

    def add_sent(self, header_bytes: bytes) -> None:
        """A message the person sent: who it went to, and which address it came from."""
        message = email.message_from_bytes(header_bytes)
        for address in addresses([str(message.get(n, "")) for n in ("To", "Cc", "Bcc")]):
            self.written_to.add(self.h(address))
        self.me.update(addresses([str(message.get("From", ""))]))  # aliases and send-as addresses

    def add_message(self, mailbox: int, text: bytes, header_bytes: bytes) -> None:
        message = email.message_from_bytes(header_bytes)
        found = addresses([str(message.get("From", ""))])
        sender = found[0] if found else ""
        list_id = header_value(message, "List-Id").lower()
        unsub = message.get("List-Unsubscribe") is not None
        precedence = str(message.get("Precedence", "")).lower()
        auto = str(message.get("Auto-Submitted", "no")).lower()
        bulk = unsub or bool(list_id) or precedence in ("bulk", "list", "junk") or not auto.startswith("no")
        references = str(message.get("References", "")).split()
        in_reply_to = str(message.get("In-Reply-To", "")).strip()
        thread_match = re.search(rb"X-GM-THRID (\d+)", text)
        if thread_match:
            thread = thread_match.group(1).decode()
        else:
            thread = references[0] if references else in_reply_to or str(message.get("Message-ID", "")).strip()
        size = re.search(rb"RFC822\.SIZE (\d+)", text)
        year = re.search(rb'INTERNALDATE "\s*\d+-\w+-(\d{4})', text)
        uid = re.search(rb"UID (\d+)", text)
        source = self.h(list_id) if list_id else self.h(sender)
        record = {
            "sender": self.h(sender),
            # Completed with the structure in add_structures.
            "template": self.h("|".join([source, subject_shape(header_value(message, "Subject"))])),
            "thread": self.h(thread) if thread else self.h(os.urandom(8).hex()),
            "size": int(size.group(1)) if size else 0,
            "year": year.group(1).decode() if year else "unknown",
            "unsub": unsub,
            "bulk": bulk,
            "auth": message.get("Authentication-Results") is not None,
            "self": sender in self.me,
            "reply": bool(references or in_reply_to),
        }
        self.records.append(record)
        if uid:
            self.pending[(mailbox, int(uid.group(1)))] = record

    def add_structures(self, mailbox: int, structures: dict[int, str], fetched: bool) -> None:
        for uid, structure in structures.items():
            record = self.pending.pop((mailbox, uid), None)
            if record is None:
                continue
            record["template"] = self.h(record["template"] + "|" + structure)
            if not record["self"]:
                self.uids.append((mailbox, uid, record["template"]))
        # What is left has only its header-level template. If the fetch failed that makes
        # the run incomplete; if it worked, the message went away between the two fetches.
        self.errors["without_structure" if not fetched else "structure_not_returned"] += len(self.pending)
        self.pending.clear()

    def mark_self(self) -> None:
        """Addresses learned from sent mail may arrive after a message was recorded."""
        mine = {self.h(a) for a in self.me}
        for record in self.records:
            if record["sender"] in mine:
                record["self"] = True


def connect(host: str, user: str, password: str) -> tuple[imaplib.IMAP4_SSL, dict]:
    connection = imaplib.IMAP4_SSL(host, timeout=180)
    before = sorted(connection.capabilities)
    connection.login(user, password)
    _, data = connection.capability()
    after = sorted(set((data[0] or b"").decode("ascii", "replace").split()))
    return connection, {"before_login": list(before), "after_login": after}


class Session:
    """One account's connection. It only ever examines mailboxes and fetches with PEEK,
    and it reconnects once when a connection drops in the middle of a batch."""

    def __init__(self, host: str, user: str, password: str, errors: Counter) -> None:
        self.host, self.user, self.password, self.errors = host, user, password, errors
        self.connection = None
        self.selected: str | None = None
        self.capabilities: dict = {}

    def open(self) -> None:
        self.connection, self.capabilities = connect(self.host, self.user, self.password)
        self.selected = None

    def examine(self, name: str) -> bool:
        status, _ = self.connection.select(name, readonly=True)  # EXAMINE: nothing can change
        self.selected = name if status == "OK" else None
        return status == "OK"

    def uid(self, name: str, command: str, *arguments) -> list | None:
        """Run UID SEARCH or UID FETCH in a mailbox. None means it could not be done."""
        for attempt in (0, 1):
            try:
                if self.selected != name and not self.examine(name):
                    self.errors["examine_refused"] += 1
                    return None
                status, data = self.connection.uid(command, *arguments)
                if status != "OK":
                    self.errors["refused:" + str(status)] += 1
                    return None
                return data
            except (imaplib.IMAP4.abort, OSError) as error:
                self.errors["dropped:" + type(error).__name__] += 1
                if attempt:
                    return None
                try:
                    self.open()
                except (imaplib.IMAP4.error, OSError) as again:
                    self.errors["reconnect_failed:" + type(again).__name__] += 1
                    return None
            except imaplib.IMAP4.error as error:
                self.errors["refused:" + type(error).__name__] += 1
                return None
        return None

    def uids_of(self, name: str) -> list[int] | None:
        """Every UID in a mailbox, or None when it could not be listed."""
        data = self.uid(name, "SEARCH", None, "ALL")
        if data is None:
            self.errors["mailbox_not_listed"] += 1
            return None
        return [int(u) for u in (data[0] or b"").split()] if data else []


def list_mailboxes(connection) -> list[dict]:
    _, data = connection.list()
    boxes = []
    for line in data or []:
        if not line:
            continue
        literal = None
        if isinstance(line, tuple):  # a name sent as a literal
            line, literal = line[0], line[1]
        match = re.match(rb'\((?P<flags>[^)]*)\) (?:"[^"]*"|NIL) (?P<name>.+)$', line)
        if not match:
            continue
        flags = {f.lower() for f in match.group("flags").decode("ascii", "replace").split()}
        if literal is not None:
            bare = literal.decode("utf-8", "replace")
            name = '"' + bare.replace("\\", "\\\\").replace('"', '\\"') + '"'
        else:
            name = match.group("name").decode("utf-8", "replace").strip()
            bare = name.strip('"')
        boxes.append({"name": name, "bare": bare, "flags": flags})
    return boxes


def choose_mailboxes(boxes: list[dict]) -> tuple[list[dict], list[dict]]:
    """The mailboxes to count, and the ones holding what the person sent."""
    sent = [b for b in boxes if "\\sent" in b["flags"] or b["bare"].split("/")[-1].lower().startswith("sent")]
    everything = [b for b in boxes if "\\all" in b["flags"]]
    if everything:  # Gmail: All Mail already holds every message once
        return everything, sent
    keep = [
        b
        for b in boxes
        if not (b["flags"] & SKIP_FLAGS) and b["bare"].split("/")[-1].lower() not in SKIP_NAMES
    ]
    return keep, sent


def batches(items: list[int], size: int):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def run(args: argparse.Namespace, password: str) -> dict:
    preset = PROVIDERS.get(args.provider or "")
    host = args.host or preset["host"]
    started = time.time()
    census = Census(args.user, args.alias)
    session = Session(host, args.user, password, census.errors)
    session.open()
    capabilities = session.capabilities
    gmail_ext = any("X-GM-EXT-1" in c for c in capabilities["after_login"])
    boxes = list_mailboxes(session.connection)
    counted, sent = choose_mailboxes(boxes)
    note(f"{len(boxes)} mailboxes; counting {len(counted)}, reading {len(sent)} for who was written to")

    sent_listed = sent_read = sent_not_returned = 0
    for box in sent:
        uids = (session.uids_of(box["name"]) or [])[: args.limit or None]
        sent_listed += len(uids)
        for chunk in batches(uids, BATCH):
            ids = ",".join(map(str, chunk))
            data = session.uid(box["name"], "FETCH", ids, "(BODY.PEEK[HEADER.FIELDS (FROM TO CC BCC)])")
            answered = split_fetch(data or [])
            if data is not None:  # the fetch worked: the server listed this UID and returned nothing for it
                sent_not_returned += max(0, len(chunk) - len(answered))
            for _, literals in answered:
                if literals:
                    census.add_sent(literals[0])
                    sent_read += 1
    note(f"wrote to {len(census.written_to)} distinct addresses")

    header_started = time.time()
    extra = " X-GM-THRID" if gmail_ext else ""
    items = f"(UID RFC822.SIZE INTERNALDATE{extra} BODY.PEEK[HEADER.FIELDS ({HEADER_FIELDS})])"
    listed = not_returned = 0
    for index, box in enumerate(counted):
        uids = (session.uids_of(box["name"]) or [])[: args.limit or None]
        listed += len(uids)
        for chunk in batches(uids, BATCH):
            ids = ",".join(map(str, chunk))
            data = session.uid(box["name"], "FETCH", ids, items)
            answered = split_fetch(data or [])
            if data is not None:
                not_returned += max(0, len(chunk) - len(answered))
            for text, literals in answered:
                if not literals:
                    census.errors["without_headers"] += 1
                    continue
                try:
                    census.add_message(index, text, literals[0])
                except Exception as error:  # one odd message must not end the run
                    census.errors["message:" + type(error).__name__] += 1
            data = session.uid(box["name"], "FETCH", ids, "(UID BODYSTRUCTURE)")
            structures = {}
            for text, literals in split_fetch(data or []):
                uid = re.search(rb"UID (\d+)", text)
                if uid:
                    try:
                        structures[int(uid.group(1))] = structure_shape(text + b" ".join(literals))
                    except Exception as error:
                        census.errors["structure:" + type(error).__name__] += 1
            census.add_structures(index, structures, fetched=data is not None)
            note(f"mailbox {index + 1}/{len(counted)}: {len(census.records)} of {listed} messages read", end="\r")
    header_seconds = time.time() - header_started
    note(f"\n{len(census.records)} of {listed} messages in {header_seconds:.0f} s")

    sample = sample_bodies(session, counted, census, args.sample_mb * 1024 * 1024)
    try:
        session.connection.logout()
    except (imaplib.IMAP4.error, OSError):
        pass

    census.mark_self()
    result = aggregate(census.records, census.written_to)
    # Complete means every mailbox was listed, and every listed message was either read in
    # full or was one the server listed and then returned nothing for on a fetch that
    # succeeded. That happens when a message is deleted meanwhile, and iCloud also lists
    # messages it never returns. Those are counted, not hidden. Anything else is a partial run.
    complete = (
        len(census.records) + not_returned == listed
        and sent_read + sent_not_returned == sent_listed
        and not census.errors["mailbox_not_listed"]
        and not census.errors["without_structure"]
    )
    result.update(
        {
            "tool_version": TOOL_VERSION,
            "complete": complete,
            "coverage": {
                "uids_listed": listed,
                "messages_read": len(census.records),
                "listed_not_returned": not_returned,
                "sent_uids_listed": sent_listed,
                "sent_messages_read": sent_read,
                "sent_listed_not_returned": sent_not_returned,
                "mailboxes_not_listed": census.errors["mailbox_not_listed"],
            },
            "provider": args.provider or "custom",
            "host": preset["host"] if preset and not args.host else "custom",
            "limit_per_mailbox": args.limit or None,
            "mailboxes": {
                "listed": len(boxes),
                "counted": len(counted),
                "sent": len(sent),
                "special_use_flags_seen": sorted({f for b in boxes for f in b["flags"] if f.startswith("\\")}),
            },
            "distinct_addresses_written_to": len(census.written_to),
            "addresses_treated_as_the_person": len(census.me),
            "body_sample": sample,
            "capabilities": capabilities,
            "rates": {
                "header_pass_seconds": round(header_seconds, 1),
                "header_pass_messages_per_second": round(len(census.records) / header_seconds, 1)
                if header_seconds
                else None,
                "body_pass_bytes_per_second": sample.get("bytes_per_second"),
            },
            "errors": {name: count for name, count in census.errors.items() if count},
            "seconds": round(time.time() - started, 1),
        }
    )
    return result


def sample_bodies(session: Session, counted: list[dict], census: Census, byte_cap: int) -> dict:
    """Fetch a bounded sample of bodies and report how well the two template measures agree."""
    by_template: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for mailbox, uid, template in census.uids:
        by_template[template].append((mailbox, uid))
    recurring = [t for t, members in by_template.items() if len(members) >= TEMPLATE_MIN]
    recurring.sort(key=lambda t: -len(by_template[t]))
    rng = random.Random(0)
    wanted: list[tuple[str, int, int]] = []
    for template in recurring[:500]:
        for mailbox, uid in rng.sample(by_template[template], 3):
            wanted.append((template, mailbox, uid))
    wanted.sort(key=lambda w: w[1])  # one EXAMINE per mailbox

    fingerprints: dict[str, list[str]] = defaultdict(list)
    fetched = 0
    started = time.time()
    for template, mailbox, uid in wanted:
        if fetched >= byte_cap:
            break
        data = session.uid(counted[mailbox]["name"], "FETCH", str(uid), f"(BODY.PEEK[]<0.{BODY_PREFIX_BYTES}>)")
        for _, literals in split_fetch(data or []):
            if literals:
                fetched += len(literals[0])
                fingerprint = body_fingerprint(literals[0])
                if fingerprint:
                    fingerprints[template].append(fingerprint)
    seconds = time.time() - started
    compared = {t: prints for t, prints in fingerprints.items() if len(prints) >= 2}
    agree = sum(1 for prints in compared.values() if len(set(prints)) == 1)
    return {
        "templates_sampled": len(compared),
        "templates_whose_bodies_share_one_shape": agree,
        "agreement": share(agree, len(compared)),
        "bodies_fetched": sum(len(p) for p in fingerprints.values()),
        "bytes_fetched": fetched,
        "byte_cap": byte_cap,
        "bytes_per_second": round(fetched / seconds) if seconds else None,
    }


def note(message: str, end: str = "\n") -> None:
    print(message, file=sys.stderr, end=end, flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", choices=sorted(PROVIDERS))
    parser.add_argument("--host", help="an IMAP host, instead of --provider")
    parser.add_argument("--user", required=True, help="the account's address")
    parser.add_argument(
        "--alias",
        action="append",
        default=[],
        help="another address that is yours; repeatable. Addresses found on your sent mail are added by themselves",
    )
    parser.add_argument("--password-file", help="a file holding the password; otherwise you are prompted")
    parser.add_argument("--out", required=True, help="where to write the counts")
    parser.add_argument("--sample-mb", type=int, default=300, help="cap on body bytes fetched (default 300)")
    parser.add_argument("--limit", type=int, default=0, help="read at most this many messages per mailbox (a trial run)")
    args = parser.parse_args(argv)
    if not args.provider and not args.host:
        parser.error("give --provider or --host")
    if args.password_file:
        with open(args.password_file, encoding="utf-8") as handle:
            password = handle.read().strip()
    else:
        password = getpass.getpass(f"Password for {args.user} (an app-specific password): ")
    try:
        result = run(args, password)
    except imaplib.IMAP4.error as error:
        # The message can hold server text, so only the kind of failure is printed.
        note(f"IMAP refused the sign-in or a command: {type(error).__name__}")
        return 4
    except OSError as error:
        note(f"network failure: {type(error).__name__}")
        return 5
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")
    coverage = result["coverage"]
    note(
        f"wrote {args.out}: {coverage['messages_read']} of {coverage['uids_listed']} messages; "
        f"Q1 {result['q1']['share']}; Q2 {result['q2']['share']}"
    )
    if not result["complete"]:
        note("INCOMPLETE: not every listed message was read; see coverage and errors in the file")
        return 6
    return 0


if __name__ == "__main__":
    sys.exit(main())
