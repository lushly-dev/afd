#!/usr/bin/env python3
"""Check and count an extraction for the Ideas plan's phase 0 (steps 0.1 and 0.4).

An extractor reads a source as numbered units (`sentences.py number`) and writes one
JSON object per idea:

    {"source": "src-0123456789ab", "type": "principle", "cites": [12, 13],
     "statement": null, "tags": ["soil", "drainage"]}

`cites` are the units the idea rests on. With no `statement` the idea is the cited
units, word for word. With one, it is a restatement.

`resolve` checks every line against its source and writes the flat file of ideas the
other tools read. `stats` counts it.

Standard library only. Python 3.10 or later.

    python3 ideas.py resolve --manifest corpus.manifest.json --root ROOT \\
        --extractor NAME=DIR [--extractor NAME=DIR ...] --out ideas.jsonl
    python3 ideas.py stats ideas.jsonl --manifest corpus.manifest.json \\
        [--kinds sources.json] --out ideas.counts.json
    python3 ideas.py sample ideas.jsonl --manifest corpus.manifest.json --root ROOT \\
        --count 200 --out review.todo.jsonl

The counts file holds numbers only, no path and no text.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sentences import divide, statement_of

TYPES = ("position", "principle", "model", "evidence", "example", "question", "synthesis")
WORD_LIMITS = (40, 60, 80, 120)


def read_jsonl(path: Path) -> list[dict]:
    out = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise SystemExit(f"{path}:{number}: not JSON: {error}") from error
    return out


def squash(text: str) -> str:
    return " ".join(text.split())


def resolve(manifest: dict, root: Path, extractors: dict[str, Path]) -> tuple[list[dict], list[str]]:
    """Check each extracted line against its source. Returns (ideas, problems)."""
    paths = {s["source"]: s["path"] for s in manifest["sources"]}
    units_of: dict[str, list] = {}
    ideas: list[dict] = []
    problems: list[str] = []
    for extractor, directory in sorted(extractors.items()):
        for file in sorted(directory.glob("*.jsonl")):
            seen: set[tuple] = set()
            for index, row in enumerate(read_jsonl(file), 1):
                where = f"{extractor}/{file.name}:{index}"
                source = row.get("source")
                if source not in paths:
                    problems.append(f"{where}: unknown source {source!r}")
                    continue
                if source not in units_of:
                    text = (root / paths[source]).read_text(encoding="utf-8", errors="replace")
                    units_of[source] = divide(text)[0]
                units = units_of[source]
                cites = row.get("cites")
                if (
                    not isinstance(cites, list)
                    or not cites
                    or not all(isinstance(c, int) and 1 <= c <= len(units) for c in cites)
                ):
                    problems.append(f"{where}: cites must be unit numbers of the source")
                    continue
                if row.get("type") not in TYPES:
                    problems.append(f"{where}: unknown type {row.get('type')!r}")
                    continue
                cited = statement_of(units, cites)
                given = squash(row.get("statement") or "")
                statement = given or cited
                key = (tuple(cites), statement)
                if key in seen:
                    problems.append(f"{where}: repeats an earlier line of the same file")
                    continue
                seen.add(key)
                by_n = {u.n: u for u in units}
                kinds = sorted({by_n[c].kind for c in cites})
                tags = [str(t).strip().lower() for t in (row.get("tags") or []) if str(t).strip()]
                digest = hashlib.sha256(
                    json.dumps([extractor, source, cites, statement]).encode()
                ).hexdigest()
                ideas.append(
                    {
                        "id": "idea-" + digest[:10],
                        "extractor": extractor,
                        "source": source,
                        "type": row["type"],
                        "cites": cites,
                        "statement": statement,
                        # Word for word, and in order: what the plan calls whole sentences.
                        "verbatim": statement == cited,
                        "restated": bool(given) and statement != cited,
                        "cited_kinds": kinds,
                        "cited_words": len(cited.split()),
                        "speakers": sorted({by_n[c].speaker for c in cites if by_n[c].speaker}),
                        "headings": by_n[cites[0]].headings,
                        "words": len(statement.split()),
                        "tags": tags,
                    }
                )
    return ideas, problems


def quantiles(values: list[int]) -> dict:
    values = sorted(values)
    if not values:
        return {"median": 0, "p90": 0, "p99": 0, "max": 0}

    def q(p: float) -> int:
        return values[min(len(values) - 1, int(p * len(values)))]

    return {"median": q(0.5), "p90": q(0.9), "p99": q(0.99), "max": values[-1]}


def stats(ideas: list[dict], manifest: dict, kinds: dict[str, dict]) -> dict:
    """Counts over a flat file of ideas. No path and no text."""
    source_words = {s["source"]: s["words"] for s in manifest["sources"]}
    by_extractor: dict[str, list[dict]] = defaultdict(list)
    for idea in ideas:
        by_extractor[idea["extractor"]].append(idea)
    out: dict = {"tool": "ideas.py", "types": list(TYPES), "extractors": {}}
    for extractor, rows in sorted(by_extractor.items()):
        sources = sorted({r["source"] for r in rows})
        words_read = sum(source_words[s] for s in sources)
        tags = Counter(t for r in rows for t in r["tags"])
        per_kind: dict[str, dict] = {}
        for kind in sorted({kinds.get(s, {}).get("kind", "unlabelled") for s in sources}):
            of_kind = [r for r in rows if kinds.get(r["source"], {}).get("kind", "unlabelled") == kind]
            kind_sources = {r["source"] for r in of_kind}
            kind_words = sum(source_words[s] for s in kind_sources)
            per_kind[kind] = {
                "sources": len(kind_sources),
                "source_words": kind_words,
                "ideas": len(of_kind),
                "ideas_per_1000_source_words": round(1000 * len(of_kind) / (kind_words or 1), 2),
                "word_for_word": sum(r["verbatim"] for r in of_kind),
                "share_word_for_word": round(
                    sum(r["verbatim"] for r in of_kind) / (len(of_kind) or 1), 4
                ),
                "word_for_word_from_prose_or_list_only": sum(
                    r["verbatim"] and set(r["cited_kinds"]) <= {"prose", "list"} for r in of_kind
                ),
            }
        per_source = Counter(r["source"] for r in rows)
        out["extractors"][extractor] = {
            "sources": len(sources),
            "source_words": words_read,
            "ideas": len(rows),
            "ideas_per_1000_source_words": round(1000 * len(rows) / (words_read or 1), 2),
            "ideas_per_source": quantiles(list(per_source.values())),
            "by_type": dict(Counter(r["type"] for r in rows).most_common()),
            "word_for_word": sum(r["verbatim"] for r in rows),
            "restated": sum(r["restated"] for r in rows),
            "statement_words": quantiles([r["words"] for r in rows]),
            "statement_words_word_for_word": quantiles([r["words"] for r in rows if r["verbatim"]]),
            "statement_words_restated": quantiles([r["words"] for r in rows if r["restated"]]),
            "share_over_word_limit": {
                str(limit): round(sum(r["words"] > limit for r in rows) / len(rows), 4)
                for limit in WORD_LIMITS
            },
            "units_cited_per_idea": quantiles([len(r["cites"]) for r in rows]),
            "ideas_citing_kind": dict(
                Counter(k for r in rows for k in r["cited_kinds"]).most_common()
            ),
            "tags_per_idea": quantiles([len(r["tags"]) for r in rows]),
            "distinct_tags": len(tags),
            "tags_used_once": sum(1 for count in tags.values() if count == 1),
            "by_source_kind": per_kind,
        }
    # Two extractors on the sources both read: one document mined twice.
    out["on_shared_sources"] = {}
    names = sorted(by_extractor)
    for i, first in enumerate(names):
        for second in names[i + 1 :]:
            shared = {r["source"] for r in by_extractor[first]} & {r["source"] for r in by_extractor[second]}
            if not shared:
                continue
            entry = {"sources": len(shared), "source_words": sum(source_words[s] for s in shared)}
            for name in (first, second):
                rows = [r for r in by_extractor[name] if r["source"] in shared]
                entry[name] = {
                    "ideas": len(rows),
                    "word_for_word": sum(r["verbatim"] for r in rows),
                    "share_word_for_word": round(sum(r["verbatim"] for r in rows) / (len(rows) or 1), 4),
                }
            out["on_shared_sources"][f"{first}+{second}"] = entry
    return out


def sample(ideas: list[dict], manifest: dict, root: Path, count: int, context: int, seed: int) -> list[dict]:
    """A review sample: each idea with the units it cites and the units around them.

    Half word for word and half restated where both exist, spread over extractors.
    """
    import random

    rng = random.Random(seed)
    paths = {s["source"]: s["path"] for s in manifest["sources"]}
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for idea in ideas:
        groups[(idea["extractor"], idea["verbatim"])].append(idea)
    per_group = max(1, count // max(1, len(groups)))
    picked: list[dict] = []
    for key in sorted(groups):
        picked += rng.sample(groups[key], min(per_group, len(groups[key])))
    rng.shuffle(picked)
    units_of: dict[str, list] = {}
    out = []
    for idea in picked[:count]:
        source = idea["source"]
        if source not in units_of:
            text = (root / paths[source]).read_text(encoding="utf-8", errors="replace")
            units_of[source] = divide(text)[0]
        units = units_of[source]
        low = max(1, min(idea["cites"]) - context)
        high = min(len(units), max(idea["cites"]) + context)
        out.append(
            {
                "id": idea["id"],
                "type": idea["type"],
                "word_for_word": idea["verbatim"],
                "statement": idea["statement"],
                "cites": idea["cites"],
                "passage": [
                    f"[{u.n}]{'*' if u.n in idea['cites'] else ''} ({u.kind}) {u.text}"
                    for u in units[low - 1 : high]
                ],
            }
        )
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    res = sub.add_parser("resolve", help="check extraction files and write the flat file")
    res.add_argument("--manifest", type=Path, required=True)
    res.add_argument("--root", type=Path, required=True)
    res.add_argument("--extractor", action="append", required=True, metavar="NAME=DIR")
    res.add_argument("--out", type=Path, required=True)
    cnt = sub.add_parser("stats", help="count a flat file of ideas")
    cnt.add_argument("ideas", type=Path)
    cnt.add_argument("--manifest", type=Path, required=True)
    cnt.add_argument("--kinds", type=Path, help="JSON: source id to {kind: ...}")
    cnt.add_argument("--out", type=Path)
    smp = sub.add_parser("sample", help="draw a review sample, each idea with its passage")
    smp.add_argument("ideas", type=Path)
    smp.add_argument("--manifest", type=Path, required=True)
    smp.add_argument("--root", type=Path, required=True)
    smp.add_argument("--count", type=int, default=200)
    smp.add_argument("--context", type=int, default=2)
    smp.add_argument("--seed", type=int, default=20261111)
    smp.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    manifest = json.loads(args.manifest.read_text())

    if args.command == "sample":
        rows = sample(read_jsonl(args.ideas), manifest, args.root, args.count, args.context, args.seed)
        with args.out.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"{len(rows)} ideas sampled", file=sys.stderr)
        return 0

    if args.command == "resolve":
        extractors = {}
        for pair in args.extractor:
            name, _, directory = pair.partition("=")
            extractors[name] = Path(directory)
        ideas, problems = resolve(manifest, args.root, extractors)
        with args.out.open("w", encoding="utf-8") as handle:
            for idea in ideas:
                handle.write(json.dumps(idea, ensure_ascii=False) + "\n")
        for problem in problems:
            print(problem, file=sys.stderr)
        print(f"{len(ideas)} ideas written, {len(problems)} lines refused", file=sys.stderr)
        return 1 if problems else 0

    kinds = json.loads(args.kinds.read_text()) if args.kinds else {}
    result = stats(read_jsonl(args.ideas), manifest, kinds)
    text = json.dumps(result, indent=2) + "\n"
    if args.out:
        args.out.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
