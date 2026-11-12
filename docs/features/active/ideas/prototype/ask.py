#!/usr/bin/env python3
"""Bundles for the Ideas plan's phase 0 (step 0.3).

Asks whether questions can be answered from ideas. For each question it returns the
ideas a bundle would hold: the nearest by words and meaning fused, as `match.py`
scores them, up to a budget. A judge then answers from the bundle alone and says what
was missing (`prompts/judge-bundles.md`); `ask.py score` counts the judgments.

    uv run --with numpy --with snowballstemmer --with fastembed ask.py bundle ideas.jsonl \\
        --questions questions.jsonl --vectors vectors/ --model BAAI/bge-base-en-v1.5 \\
        --weight 0.7 --budget 25 --out bundles.jsonl
    python3 ask.py score bundles.judged.jsonl --out bundles.counts.json

Bundles and questions hold text and stay with the corpus. The counts file holds numbers.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def bundle(args: argparse.Namespace) -> int:
    import numpy as np
    from fastembed import TextEmbedding
    from match import Lexical, load_vectors, read_ideas

    ideas = [i for i in read_ideas(args.ideas) if i["extractor"] == args.extractor]
    all_ideas = read_ideas(args.ideas)
    keep = [n for n, i in enumerate(all_ideas) if i["extractor"] == args.extractor]
    matrix = load_vectors(args.vectors)[args.model][keep]
    questions = [json.loads(line) for line in args.questions.read_text().splitlines() if line.strip()]
    encoder = TextEmbedding(model_name=args.model)
    asked = np.array(list(encoder.embed([q["q"] for q in questions])), dtype=np.float32)
    asked /= np.linalg.norm(asked, axis=1, keepdims=True)
    lexical = Lexical([i["statement"] for i in ideas] + [q["q"] for q in questions])
    with args.out.open("w", encoding="utf-8") as handle:
        for n, question in enumerate(questions):
            probe = len(ideas) + n
            words = np.array([lexical.directed(probe, i) for i in range(len(ideas))])
            meaning = matrix @ asked[n]
            fused = args.weight * meaning + (1 - args.weight) * words
            order = np.argsort(-fused)[: args.budget]
            handle.write(
                json.dumps(
                    {
                        "n": n + 1,
                        "q": question["q"],
                        "kind": question["kind"],
                        "ideas": [
                            {"id": ideas[i]["id"], "type": ideas[i]["type"], "statement": ideas[i]["statement"]}
                            for i in order
                        ],
                        "sources": len({ideas[i]["source"] for i in order}),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    print(f"{len(questions)} bundles of {args.budget}", file=sys.stderr)
    return 0


def score(args: argparse.Namespace) -> int:
    rows = [json.loads(line) for line in args.judged.read_text().splitlines() if line.strip()]
    by_kind: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        for key in ("all", r["kind"]):
            by_kind[key]["questions"] += 1
            by_kind[key][f"answered_{r['answered']}"] += 1
            by_kind[key]["ideas_used"] += r.get("ideas_used", 0)
            by_kind[key]["ideas_off_topic"] += r.get("ideas_off_topic", 0)
            for need in r.get("missing", []):
                by_kind[key][f"missing_{need}"] += 1
            for link in r.get("links_that_would_help", []):
                by_kind[key][f"link_{link}"] += 1
            if r.get("budget") is not None:
                by_kind[key][f"budget_{r['budget']}"] += 1
    out = {"tool": "ask.py", "by_kind": {k: dict(v) for k, v in sorted(by_kind.items())}}
    text = json.dumps(out, indent=2) + "\n"
    if args.out:
        args.out.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("bundle")
    b.add_argument("ideas", type=Path)
    b.add_argument("--questions", type=Path, required=True)
    b.add_argument("--vectors", type=Path, required=True)
    b.add_argument("--model", required=True)
    b.add_argument("--weight", type=float, default=0.7)
    b.add_argument("--budget", type=int, default=25)
    b.add_argument("--extractor", default="a")
    b.add_argument("--out", type=Path, required=True)
    s = sub.add_parser("score")
    s.add_argument("judged", type=Path)
    s.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    return bundle(args) if args.command == "bundle" else score(args)


if __name__ == "__main__":
    raise SystemExit(main())
