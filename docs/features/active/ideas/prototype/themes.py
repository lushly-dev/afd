#!/usr/bin/env python3
"""Themes experiment for the Ideas plan's phase 0 (step 0.5).

Asks whether themes derived from the ideas themselves group them as a person would.
It computes themes two ways from one extractor's statement embeddings:

- `graph`: each idea joined to its nearest neighbours above a similarity floor, and
  themes taken as the communities of that graph by label propagation, in a fixed order;
- `tree`: average-linkage clustering cut at a cosine distance.

and reports their sizes, how many join ideas from several documents, how stable they
are between the two methods and between two embedding models, and how far they agree
with a grouping given for comparison (by default each idea's source document and its
top heading, which stand in for the person's own grouping until they give one).

    uv run --with numpy --with scipy themes.py ideas.jsonl --vectors vectors/ \\
        --model BAAI/bge-base-en-v1.5 --compare-model nomic-ai/nomic-embed-text-v1.5-Q \\
        --out themes.counts.json [--assignments themes.jsonl]

The counts file holds numbers only. `--assignments` writes each idea's themes, which
name ideas and stay with the corpus.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np


def read_ideas(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def unit_vectors(path: Path) -> np.ndarray:
    vectors = np.load(path).astype(np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norms == 0, 1, norms)


def graph_themes(vectors: np.ndarray, k: int, floor: float, rounds: int = 30) -> list[int]:
    """Communities of the mutual-nearest-neighbour graph, by label propagation in a fixed order."""
    sims = vectors @ vectors.T
    np.fill_diagonal(sims, -1)
    n = len(vectors)
    nearest = np.argsort(-sims, axis=1)[:, :k]
    neighbours: list[dict[int, float]] = [{} for _ in range(n)]
    for i in range(n):
        for j in nearest[i]:
            j = int(j)
            if sims[i, j] >= floor and i in {int(x) for x in nearest[j]}:
                neighbours[i][j] = float(sims[i, j])
                neighbours[j][i] = float(sims[i, j])
    labels = list(range(n))
    for _ in range(rounds):
        changed = 0
        for i in range(n):
            if not neighbours[i]:
                continue
            weight: dict[int, float] = defaultdict(float)
            for j, w in neighbours[i].items():
                weight[labels[j]] += w
            best = max(sorted(weight), key=lambda label: weight[label])
            if best != labels[i]:
                labels[i] = best
                changed += 1
        if not changed:
            break
    return _renumber(labels)


def tree_themes(vectors: np.ndarray, distance: float) -> list[int]:
    from scipy.cluster.hierarchy import fcluster, linkage

    tree = linkage(vectors, method="average", metric="cosine")
    return _renumber([int(x) for x in fcluster(tree, t=distance, criterion="distance")])


def _renumber(labels: list[int]) -> list[int]:
    order: dict[int, int] = {}
    return [order.setdefault(label, len(order)) for label in labels]


def nmi(a: list, b: list) -> float:
    """Normalised mutual information, arithmetic mean."""
    n = len(a)
    ca, cb, cab = Counter(a), Counter(b), Counter(zip(a, b))
    mi = sum(c / n * math.log((c / n) / ((ca[x] / n) * (cb[y] / n))) for (x, y), c in cab.items())
    ha = -sum(c / n * math.log(c / n) for c in ca.values())
    hb = -sum(c / n * math.log(c / n) for c in cb.values())
    return 0.0 if ha + hb == 0 else 2 * mi / (ha + hb)


def ari(a: list, b: list) -> float:
    """Adjusted Rand index."""
    def pairs(x: int) -> float:
        return x * (x - 1) / 2

    n = len(a)
    index = sum(pairs(c) for c in Counter(zip(a, b)).values())
    sa = sum(pairs(c) for c in Counter(a).values())
    sb = sum(pairs(c) for c in Counter(b).values())
    expected = sa * sb / pairs(n) if n > 1 else 0
    top = (sa + sb) / 2
    return 0.0 if top == expected else (index - expected) / (top - expected)


def describe(labels: list[int], ideas: list[dict]) -> dict:
    groups: dict[int, list[int]] = defaultdict(list)
    for i, label in enumerate(labels):
        groups[label].append(i)
    themes = [g for g in groups.values() if len(g) >= 2]
    sizes = sorted((len(g) for g in themes), reverse=True)
    sources = [len({ideas[i]["source"] for i in g}) for g in themes]
    in_theme = sum(sizes)

    def q(p: float) -> int:
        ordered = sorted(sizes)
        return ordered[min(len(ordered) - 1, int(p * len(ordered)))] if ordered else 0

    return {
        "themes": len(themes),
        "ideas_in_a_theme": in_theme,
        "share_in_a_theme": round(in_theme / len(labels), 4),
        "singletons": len(labels) - in_theme,
        "size": {"median": q(0.5), "p90": q(0.9), "max": sizes[0] if sizes else 0},
        "largest_theme_share": round((sizes[0] if sizes else 0) / len(labels), 4),
        "themes_over": {str(t): sum(s > t for s in sizes) for t in (5, 10, 20, 50)},
        "themes_across_sources": sum(s >= 2 for s in sources),
        "share_of_themes_across_sources": round(sum(s >= 2 for s in sources) / (len(themes) or 1), 4),
        "themes_across_5_or_more_sources": sum(s >= 5 for s in sources),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("ideas", type=Path)
    parser.add_argument("--vectors", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--compare-model")
    parser.add_argument("--extractor", default="a")
    parser.add_argument("--k", type=int, default=10)
    parser.add_argument("--floors", default="0.70,0.75,0.80")
    parser.add_argument("--distances", default="0.25,0.30,0.35")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--assignments", type=Path)
    args = parser.parse_args(argv)

    all_ideas = read_ideas(args.ideas)
    keep = [n for n, i in enumerate(all_ideas) if i["extractor"] == args.extractor]
    ideas = [all_ideas[n] for n in keep]

    def load(model: str) -> np.ndarray:
        return unit_vectors(args.vectors / f"{model.replace('/', '__')}.npy")[keep]

    vectors = load(args.model)
    by_source = [i["source"] for i in ideas]
    by_section = [f'{i["source"]}|{(i.get("headings") or [""])[:2][-1]}' for i in ideas]
    out: dict = {
        "tool": "themes.py",
        "model": args.model,
        "extractor": args.extractor,
        "ideas": len(ideas),
        "comparison_groupings": {"source": len(set(by_source)), "source_and_section": len(set(by_section))},
        "runs": {},
    }
    rng = np.random.default_rng(20261111)

    def agreement(a: list, b: list) -> dict:
        """NMI and ARI, with the NMI of b's labels shuffled: what groupings of these shapes score by chance."""
        shuffled = list(rng.permutation(np.array(b, dtype=object)))
        return {"nmi": round(nmi(a, b), 4), "nmi_shuffled": round(nmi(a, shuffled), 4), "ari": round(ari(a, b), 4)}

    results: dict[str, list[int]] = {}
    for floor in [float(x) for x in args.floors.split(",")]:
        results[f"graph@{floor}"] = graph_themes(vectors, args.k, floor)
    for distance in [float(x) for x in args.distances.split(",")]:
        results[f"tree@{distance}"] = tree_themes(vectors, distance)
    for name, labels in results.items():
        out["runs"][name] = describe(labels, ideas) | {
            "against_source": agreement(labels, by_source),
            "against_section": agreement(labels, by_section),
        }
    names = list(results)
    out["between_methods"] = {
        f"{a} vs {b}": agreement(results[a], results[b])
        for x, a in enumerate(names)
        for b in names[x + 1 :]
        if a.split("@")[0] != b.split("@")[0]
    }
    if args.compare_model:
        other = load(args.compare_model)
        out["between_models"] = {"compare_model": args.compare_model}
        for name in names:
            method, value = name.split("@")
            again = graph_themes(other, args.k, float(value)) if method == "graph" else tree_themes(other, float(value))
            out["between_models"][name] = agreement(results[name], again)
    if args.assignments:
        with args.assignments.open("w", encoding="utf-8") as handle:
            for idea, *labels in zip(ideas, *results.values()):
                handle.write(json.dumps({"id": idea["id"], **dict(zip(names, labels))}) + "\n")
    text = json.dumps(out, indent=2) + "\n"
    if args.out:
        args.out.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
