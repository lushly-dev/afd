#!/usr/bin/env python3
"""The sentence rule for the Ideas plan's phase 0 (steps 0.1 and 0.4).

Divides a Markdown or plain-text source into numbered units by one fixed rule, so
that an extractor can cite a source by number and never retype it. A unit is a
sentence of prose, a sentence of a list item, a heading, a table row, a code block
or a sentence of a quotation. Each carries its kind, the headings above it and, in
a transcript, its speaker.

This is a prototype of the rule the plugin's specification will fix. It is not the
engine.

Standard library only. Python 3.10 or later.

    python3 sentences.py number SOURCE            # the numbered text an extractor reads
    python3 sentences.py number SOURCE --json     # the same, as JSON lines
    python3 sentences.py number SOURCE --transcript  # read "Name: ..." as turns
    python3 sentences.py stats ROOT --manifest corpus.manifest.json --out sentences.counts.json

`stats` writes counts and shares only: no path and no text.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

RULE_VERSION = 3

# Words that end in a full stop without ending a sentence.
ABBREVIATIONS = frozenset(
    ["e.g", "i.e", "etc", "vs", "cf", "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "no", "fig", "figs", "eq", "ch", "sec", "vol", "pp", "p", "ed", "eds", "inc", "ltd", "co", "corp", "approx", "est", "dept", "univ", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "a.m", "p.m", "u.s", "u.k", "al"]
)

FENCE = re.compile(r"^\s{0,3}(```+|~~~+)")
HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
LIST_ITEM = re.compile(r"^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$")
TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
QUOTE = re.compile(r"^\s{0,3}>\s?(.*)$")
RULE_LINE = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
# A speaker label at the start of a block: "**Name:** ...", "Name: ..." or "[00:12] Name: ...".
SPEAKER = re.compile(
    r"^(?:\[[0-9:.]+\]\s*)?(?:\*\*([A-Z][\w .'-]{0,40}?):?\*\*:?|([A-Z][\w.'-]{0,20}(?: [A-Z][\w.'-]{0,20}){0,2}):)\s+(\S.*)$",
    re.DOTALL,
)
# Where a sentence may end: a terminal mark, any closing quotes or brackets, then space.
BOUNDARY = re.compile(r"([.!?]+)([\"'”’)\]]*)\s+")
OPENER = re.compile(r"[A-Z0-9\"'“‘(\[]")
TERMINAL = re.compile(r"[.!?:][\"'”’)\]]*$")


@dataclass
class Unit:
    n: int
    kind: str  # prose, list, heading, table, code, quote
    text: str
    headings: list[str] = field(default_factory=list)
    speaker: str | None = None
    ends_cleanly: bool = True


def strip_inline(text: str) -> str:
    """Remove inline Markdown so that a statement is plain text."""
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)  # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # links
    text = re.sub(r"\[([^\]]+)\]\[[^\]]*\]", r"\1", text)  # reference links
    text = re.sub(r"`([^`]*)`", r"\1", text)  # code spans
    text = re.sub(r"(\*\*\*|___)(?=\S)(.+?)(?<=\S)\1", r"\2", text)
    text = re.sub(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1", r"\2", text)
    text = re.sub(r"(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])", r"\1", text)
    text = re.sub(r"(?<![\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])", r"\1", text)
    text = re.sub(r"<br\s*/?>", " ", text)
    text = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|>])", r"\1", text)  # backslash escapes
    return re.sub(r"\s+", " ", text).strip()


def split_sentences(text: str) -> list[str]:
    """Split plain text into sentences. Conservative: when in doubt it does not split."""
    out: list[str] = []
    start = 0
    for m in BOUNDARY.finditer(text):
        end = m.end(2)
        rest = text[m.end() :]
        if not rest or not OPENER.match(rest):
            continue
        marks = m.group(1)
        if marks == ".":
            before = text[start : m.start()]
            word = before.rsplit(None, 1)[-1] if before.split() else ""
            word = word.lstrip("(\"'“‘[")
            if word.lower().rstrip(".") in ABBREVIATIONS or word.lower() in ABBREVIATIONS:
                continue
            if len(word) == 1 and word.isalpha() and word.isupper():
                continue  # an initial
            if re.fullmatch(r"\d{1,3}", word) and before.strip() == word:
                continue  # "1. " at the start of a block is a number, not a sentence
        out.append(text[start:end].strip())
        start = m.end()
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return [s for s in out if s]


def split_front_matter(lines: list[str]) -> tuple[int, int]:
    """Return (first line after the front matter, its line count)."""
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                return i + 1, i + 1
    return 0, 0


def divide(source: str, transcript: bool = False) -> tuple[list[Unit], dict]:
    """Divide a source into units. Returns the units and what was left out.

    A speaker label is read only when the source is said to be a transcript. Whether it
    is one is a setting, not a guess: labelled fields ("Goal: ... Keywords: ...") take
    turns just as two speakers do, and no rule on the text tells them apart.
    """
    lines = source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i, front = split_front_matter(lines)
    blocks: list[tuple[str, str]] = []
    left_out = {"front_matter_lines": front, "blank_or_rule_lines": 0}

    n = len(lines)
    while i < n:
        line = lines[i]
        if not line.strip() or RULE_LINE.match(line):
            left_out["blank_or_rule_lines"] += 1
            i += 1
            continue
        fence = FENCE.match(line)
        if fence:
            mark = fence.group(1)
            j = i + 1
            while j < n and not lines[j].strip().startswith(mark[:3]):
                j += 1
            blocks.append(("code", "\n".join(lines[i : min(j + 1, n)])))
            i = j + 1
            continue
        heading = HEADING.match(line)
        if heading:
            blocks.append((f"heading{len(heading.group(1))}", heading.group(2)))
            i += 1
            continue
        if TABLE_ROW.match(line):
            if not TABLE_RULE.match(line):
                cells = [strip_inline(c) for c in line.strip().strip("|").split("|")]
                blocks.append(("table", " | ".join(c for c in cells if c)))
            i += 1
            continue
        if QUOTE.match(line):
            parts = []
            while i < n and (m := QUOTE.match(lines[i])):
                parts.append(m.group(1))
                i += 1
            blocks.append(("quote", " ".join(parts)))
            continue
        item = LIST_ITEM.match(line)
        kind, parts = ("list", [item.group(3)]) if item else ("prose", [line.strip()])
        i += 1
        while i < n and lines[i].strip() and not _starts_block(lines[i]):
            parts.append(lines[i].strip())
            i += 1
        blocks.append((kind, " ".join(parts)))

    units: list[Unit] = []
    headings: list[tuple[int, str]] = []
    speaker: str | None = None

    def add(kind: str, text: str, who: str | None = None) -> None:
        if not text:
            return
        clean = kind in ("heading", "table", "code") or bool(TERMINAL.search(text))
        units.append(Unit(len(units) + 1, kind, text, [h for _, h in headings], who, clean))

    for kind, raw in blocks:
        if kind == "code":
            add("code", raw)
        elif kind == "table":
            add("table", raw)
        elif kind.startswith("heading"):
            level = int(kind[7:])
            title = strip_inline(raw)
            headings[:] = [h for h in headings if h[0] < level]
            add("heading", title)
            headings.append((level, title))
            speaker = None
        else:
            text = strip_inline(raw)
            if transcript and kind in ("prose", "list"):
                m = SPEAKER.match(raw.strip())
                if m:
                    speaker = (m.group(1) or m.group(2)).strip()
                    text = strip_inline(m.group(3))
            who = speaker if transcript and kind in ("prose", "list") else None
            for sentence in split_sentences(text):
                add(kind, sentence, who)
    left_out["transcript"] = bool(transcript)
    return units, left_out


def _starts_block(line: str) -> bool:
    return bool(
        FENCE.match(line)
        or HEADING.match(line)
        or LIST_ITEM.match(line)
        or TABLE_ROW.match(line)
        or QUOTE.match(line)
        or RULE_LINE.match(line)
    )


def statement_of(units: list[Unit], numbers: list[int]) -> str:
    """The statement a capture takes when it cites numbers and gives no text."""
    by_n = {u.n: u for u in units}
    return " ".join(by_n[k].text for k in numbers)


def render(units: list[Unit]) -> str:
    """The numbered text an extractor reads."""
    out = []
    for u in units:
        if u.kind == "heading":
            out.append(f"\n[{u.n}] (heading) {u.text}")
        elif u.kind == "code":
            first = u.text.split("\n", 1)[0]
            out.append(f"[{u.n}] (code) {first} ... ({u.text.count(chr(10)) + 1} lines)")
        else:
            who = f" <{u.speaker}>" if u.speaker else ""
            out.append(f"[{u.n}] ({u.kind}){who} {u.text}")
    return "\n".join(out).strip() + "\n"


def words(text: str) -> int:
    return len(text.split())


def stats(
    root: Path,
    extensions: tuple[str, ...],
    transcripts: frozenset[str] = frozenset(),
    only: frozenset[str] | None = None,
) -> dict:
    """Counts over every source under root, or only the paths given. No path and no text."""
    kinds: Counter[str] = Counter()
    kind_words: Counter[str] = Counter()
    unclean: Counter[str] = Counter()
    lengths: list[int] = []
    long_units = 0
    with_speaker = 0
    files = 0
    files_with_speakers = 0
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.suffix in extensions):
        relative = path.relative_to(root).as_posix()
        if only is not None and relative not in only:
            continue
        units, _ = divide(path.read_text(encoding="utf-8", errors="replace"), relative in transcripts)
        files += 1
        spoke = False
        for u in units:
            w = words(u.text)
            kinds[u.kind] += 1
            kind_words[u.kind] += w
            if not u.ends_cleanly:
                unclean[u.kind] += 1
            if u.kind in ("prose", "list", "quote"):
                lengths.append(w)
                if w > 60:
                    long_units += 1
            if u.speaker:
                with_speaker += 1
                spoke = True
        files_with_speakers += spoke
    lengths.sort()
    total_words = sum(kind_words.values()) or 1

    def q(p: float) -> int:
        return lengths[min(len(lengths) - 1, int(p * len(lengths)))] if lengths else 0

    return {
        "tool": "sentences.py",
        "rule_version": RULE_VERSION,
        "files": files,
        "units": sum(kinds.values()),
        "units_by_kind": dict(sorted(kinds.items())),
        "share_of_words_by_kind": {
            k: round(v / total_words, 4) for k, v in sorted(kind_words.items())
        },
        "sentence_words": {"median": q(0.5), "p90": q(0.9), "p99": q(0.99), "max": q(1.0)},
        "sentences_over_60_words": long_units,
        "units_without_a_terminal_mark": dict(sorted(unclean.items())),
        "share_of_sentences_without_a_terminal_mark": round(
            sum(unclean[k] for k in ("prose", "list", "quote")) / (len(lengths) or 1), 4
        ),
        "units_with_a_speaker": with_speaker,
        "transcripts": files_with_speakers,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    number = sub.add_parser("number", help="print a source as numbered units")
    number.add_argument("source", type=Path)
    number.add_argument("--json", action="store_true", help="one JSON object per unit")
    number.add_argument("--transcript", action="store_true", help="read speaker labels")
    count = sub.add_parser("stats", help="counts over every source under a directory")
    count.add_argument("root", type=Path)
    count.add_argument("--ext", action="append", default=None)
    count.add_argument("--out", type=Path)
    count.add_argument("--manifest", type=Path, help="count only the distinct sources it lists")
    count.add_argument("--transcripts", type=Path, help="a file of paths that are transcripts")
    args = parser.parse_args(argv)

    if args.command == "number":
        units, _ = divide(args.source.read_text(encoding="utf-8", errors="replace"), args.transcript)
        if args.json:
            for u in units:
                print(json.dumps(asdict(u), ensure_ascii=False))
        else:
            sys.stdout.write(render(units))
        return 0
    only = None
    if args.manifest:
        only = frozenset(src["path"] for src in json.loads(args.manifest.read_text())["sources"])
    transcripts = frozenset()
    if args.transcripts:
        transcripts = frozenset(args.transcripts.read_text().split())
    result = stats(args.root, tuple(args.ext or [".md", ".txt"]), transcripts, only)
    result["transcripts_listed"] = len(transcripts)
    text = json.dumps(result, indent=2) + "\n"
    if args.out:
        args.out.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
