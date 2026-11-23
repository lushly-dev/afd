#!/usr/bin/env python3
"""Matching experiment for the Ideas plan's phase 0 (step 0.2).

Asks whether matching can be trusted to refuse a duplicate. It scores statements
against one another two ways, by words and by meaning, pools the nearest candidates
of a sample of ideas for labelling, and then reports how each lane, and both
together, sort the labelled pairs.

By words is BM25 over stemmed tokens, as tantivy's `en_stem` analyzer produces them
with its default parameters, since that is the index Umbel has. By meaning is the
cosine of two embeddings from a local model.

    uv run --with numpy --with snowballstemmer --with fastembed match.py embed \\
        ideas.jsonl --model BAAI/bge-small-en-v1.5 --out vectors/
    uv run --with numpy --with snowballstemmer match.py pool ideas.jsonl \\
        --vectors vectors/ --probes 150 --out pairs.todo.jsonl
    uv run --with numpy --with snowballstemmer match.py score ideas.jsonl \\
        --vectors vectors/ --labels pairs.labelled.jsonl --out matching.counts.json

`pool` and the labels hold statements and stay with the corpus. The counts file holds
numbers only.

Labels: `same` (one idea: keeping both would be a duplicate), `related` (two ideas
worth a link) and `distinct`.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

TOKEN = re.compile(r"[A-Za-z0-9]+")
K1, B = 1.2, 0.75  # tantivy's BM25 parameters
LABELS = ("same", "related", "distinct")


def stemmer():
    try:
        import snowballstemmer

        return snowballstemmer.stemmer("english").stemWord
    except ImportError:  # pragma: no cover - the lane still runs, on whole words
        return lambda word: word


def read_ideas(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class Lexical:
    """BM25 over stemmed tokens, scaled so that a statement scores 1 against itself."""

    def __init__(self, statements: list[str]):
        stem = stemmer()
        self.docs = [Counter(stem(t.lower()) for t in TOKEN.findall(s) if len(t) <= 40) for s in statements]
        self.lengths = [sum(d.values()) for d in self.docs]
        self.average = sum(self.lengths) / max(1, len(self.lengths))
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        self.postings: dict[str, list[int]] = defaultdict(list)
        for i, d in enumerate(self.docs):
            for t in d:
                self.postings[t].append(i)
        self.self_score = [self._score(i, i) for i in range(n)]

    def _score(self, query: int, doc: int) -> float:
        d = self.docs[doc]
        norm = K1 * (1 - B + B * self.lengths[doc] / self.average)
        return sum(
            self.idf[t] * d[t] * (K1 + 1) / (d[t] + norm) for t in self.docs[query] if t in d
        )

    def directed(self, query: int, doc: int) -> float:
        return self._score(query, doc) / (self.self_score[query] or 1.0)

    def score(self, a: int, b: int) -> float:
        """Symmetric: the lower of the two directions, so a short statement inside a long one scores low."""
        return min(self.directed(a, b), self.directed(b, a))

    def nearest(self, query: int, allowed, k: int) -> list[tuple[int, float]]:
        candidates = {i for t in self.docs[query] for i in self.postings[t] if allowed(i)}
        scored = sorted(((self.score(query, i), i) for i in candidates), reverse=True)[:k]
        return [(i, s) for s, i in scored]


def model_key(name: str) -> str:
    return name.replace("/", "__")


def load_vectors(directory: Path) -> dict[str, np.ndarray]:
    out = {}
    for file in sorted(directory.glob("*.npy")):
        vectors = np.load(file)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        out[file.stem.replace("__", "/")] = vectors / np.where(norms == 0, 1, norms)
    return out


def embed(ideas: list[dict], model: str, out: Path) -> dict:
    from fastembed import TextEmbedding

    out.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    encoder = TextEmbedding(model_name=model)
    loaded = time.perf_counter()
    vectors = np.array(list(encoder.embed([i["statement"] for i in ideas], batch_size=64)), dtype=np.float32)
    done = time.perf_counter()
    np.save(out / f"{model_key(model)}.npy", vectors)
    timing = {
        "model": model,
        "dimensions": int(vectors.shape[1]),
        "statements": len(ideas),
        "load_seconds": round(loaded - started, 2),
        "statements_per_second": round(len(ideas) / (done - loaded), 1),
    }
    (out / f"{model_key(model)}.timing.json").write_text(json.dumps(timing, indent=2) + "\n")
    return timing


def pool(ideas: list[dict], vectors: dict[str, np.ndarray], probes: int, cross: int, top: int, seed: int) -> list[dict]:
    """Pick probes and pool each one's nearest candidates from every lane.

    A probe from the first extractor is matched against that extractor's ideas from
    other sources: the same idea met again in another document. A probe from a
    second extractor is matched against the first extractor's ideas from the same
    source: the same document mined again by another model.
    """
    rng = random.Random(seed)
    lexical = Lexical([i["statement"] for i in ideas])
    extractors = sorted({i["extractor"] for i in ideas})
    first = extractors[0]
    firsts = [n for n, i in enumerate(ideas) if i["extractor"] == first]
    others = [n for n, i in enumerate(ideas) if i["extractor"] != first]
    chosen = [("cross-source", n) for n in rng.sample(firsts, min(probes, len(firsts)))]
    chosen += [("cross-extractor", n) for n in rng.sample(others, min(cross, len(others)))]
    pairs: dict[tuple[int, int], dict] = {}
    for stratum, probe in chosen:
        source = ideas[probe]["source"]
        if stratum == "cross-source":
            allowed = lambda i, source=source: ideas[i]["extractor"] == first and ideas[i]["source"] != source
        else:
            allowed = lambda i, source=source: ideas[i]["extractor"] == first and ideas[i]["source"] == source
        mask = np.array([allowed(i) for i in range(len(ideas))])
        found: dict[int, set[str]] = defaultdict(set)
        for i, _ in lexical.nearest(probe, allowed, top):
            found[i].add("words")
        for name, matrix in vectors.items():
            scores = matrix @ matrix[probe]
            scores[~mask] = -1
            for i in np.argsort(-scores)[:top]:
                if scores[i] > -1:
                    found[int(i)].add(name)
        for i, lanes in found.items():
            pairs[(probe, i)] = {
                "pair": f"{ideas[probe]['id']}:{ideas[i]['id']}",
                "stratum": stratum,
                "pooled_by": sorted(lanes),
                "a": ideas[probe]["statement"],
                "b": ideas[i]["statement"],
                "label": None,
            }
    rows = list(pairs.values())
    rng.shuffle(rows)
    return rows


def auc(positive: list[float], negative: list[float]) -> float:
    """The chance that a positive pair outscores a negative one."""
    if not positive or not negative:
        return float("nan")
    ranked = sorted([(s, 1) for s in positive] + [(s, 0) for s in negative])
    rank_sum, i = 0.0, 0
    while i < len(ranked):
        j = i
        while j < len(ranked) and ranked[j][0] == ranked[i][0]:
            j += 1
        mean_rank = (i + j + 1) / 2
        rank_sum += mean_rank * sum(label for _, label in ranked[i:j])
        i = j
    n_pos, n_neg = len(positive), len(negative)
    return (rank_sum - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)


def band_report(scores: list[float], labels: list[str], probes: list[str], false_refusals: tuple[float, ...]) -> dict:
    """Thresholds for the same band and the related band, with their errors.

    The same band is judged per probe, as a capture would be. A probe with no labelled
    duplicate is wrongly refused when any of its candidates reaches the threshold. A
    probe with one has its duplicate missed when none of its duplicates reaches it,
    and is counted apart when a different idea also reaches it. Only labelled
    candidates are seen.
    """
    same = [s for s, l in zip(scores, labels) if l == "same"]
    not_same = [s for s, l in zip(scores, labels) if l != "same"]
    related_up = [s for s, l in zip(scores, labels) if l != "distinct"]
    distinct = [s for s, l in zip(scores, labels) if l == "distinct"]
    by_probe: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for s, l, p in zip(scores, labels, probes):
        by_probe[p].append((s, l))
    with_duplicate = [p for p, rows in by_probe.items() if any(l == "same" for _, l in rows)]
    without = [p for p in by_probe if p not in set(with_duplicate)]

    def at(threshold: float) -> dict:
        wrongly_refused = sum(any(s >= threshold for s, _ in by_probe[p]) for p in without)
        missed = sum(not any(s >= threshold and l == "same" for s, l in by_probe[p]) for p in with_duplicate)
        named_wrong = sum(
            any(s >= threshold and l != "same" for s, l in by_probe[p]) for p in with_duplicate
        )
        return {
            "threshold": round(threshold, 4),
            "probes_wrongly_refused": wrongly_refused,
            "share_wrongly_refused": round(wrongly_refused / (len(without) or 1), 4),
            "duplicates_missed": missed,
            "share_of_duplicates_missed": round(missed / (len(with_duplicate) or 1), 4),
            "refusals_that_also_name_a_different_idea": named_wrong,
            "pair_precision": round(
                sum(s >= threshold for s in same) / (sum(s >= threshold for s in scores) or 1), 4
            ),
            "pair_recall": round(sum(s >= threshold for s in same) / (len(same) or 1), 4),
        }

    candidates = sorted(set(scores), reverse=True)
    out_same = {}
    for allowed in false_refusals:
        best = None
        for t in candidates:
            row = at(t)
            if row["share_wrongly_refused"] <= allowed:
                best = row
            else:
                break
        out_same[f"at_most_{allowed:.0%}_wrongly_refused"] = best
    # The related band: the threshold that best separates distinct from the rest.
    best_f1, best_row = -1.0, None
    for t in candidates:
        tp = sum(s >= t for s in related_up)
        fp = sum(s >= t for s in distinct)
        if tp == 0:
            continue
        precision, recall = tp / (tp + fp), tp / len(related_up)
        f1 = 2 * precision * recall / (precision + recall)
        if f1 > best_f1:
            best_f1 = f1
            best_row = {
                "threshold": round(t, 4),
                "precision": round(precision, 4),
                "recall": round(recall, 4),
                "f1": round(f1, 4),
            }
    return {
        "auc_same_against_the_rest": round(auc(same, not_same), 4),
        "auc_related_or_same_against_distinct": round(auc(related_up, distinct), 4),
        "same_band": out_same,
        "related_band_best_f1": best_row,
        "probes_with_a_duplicate": len(with_duplicate),
        "probes_without": len(without),
    }


def score(ideas: list[dict], vectors: dict[str, np.ndarray], labelled: list[dict]) -> dict:
    index = {i["id"]: n for n, i in enumerate(ideas)}
    lexical = Lexical([i["statement"] for i in ideas])
    rows = [r for r in labelled if r.get("label") in LABELS]
    pairs = [(index[r["pair"].split(":")[0]], index[r["pair"].split(":")[1]]) for r in rows]
    labels = [r["label"] for r in rows]
    probes = [r["pair"].split(":")[0] for r in rows]
    lanes: dict[str, list[float]] = {"words": [lexical.score(a, b) for a, b in pairs]}
    for name, matrix in vectors.items():
        lanes[name] = [float(matrix[a] @ matrix[b]) for a, b in pairs]
    refusals = (0.0, 0.02, 0.05)
    out: dict = {
        "tool": "match.py",
        "pairs": len(rows),
        "labels": dict(Counter(labels)),
        "by_stratum": {
            stratum: dict(Counter(r["label"] for r in rows if r["stratum"] == stratum))
            for stratum in sorted({r["stratum"] for r in rows})
        },
        "lanes": {name: band_report(values, labels, probes, refusals) for name, values in lanes.items()},
        "both": {},
    }
    # Both lanes together: a weighted sum, with the weight chosen on the labelled pairs.
    words = np.array(lanes["words"])
    for name in vectors:
        meaning = np.array(lanes[name])
        best = None
        for weight in [w / 10 for w in range(11)]:
            combined = (weight * meaning + (1 - weight) * words).tolist()
            report = band_report(combined, labels, probes, refusals)
            key = report["auc_same_against_the_rest"]
            if best is None or key > best[0]:
                best = (key, weight, report)
        out["both"][name] = {"weight_on_meaning": best[1], **best[2]}
    # Each lane again within each stratum: another document, or another extractor.
    out["by_stratum_lanes"] = {}
    for stratum in sorted({r["stratum"] for r in rows}):
        keep = [k for k, r in enumerate(rows) if r["stratum"] == stratum]
        sub_labels = [labels[k] for k in keep]
        sub_probes = [probes[k] for k in keep]
        out["by_stratum_lanes"][stratum] = {
            name: band_report([values[k] for k in keep], sub_labels, sub_probes, refusals)
            for name, values in lanes.items()
        }
        for name in vectors:
            weight = out["both"][name]["weight_on_meaning"]
            combined = [weight * lanes[name][k] + (1 - weight) * lanes["words"][k] for k in keep]
            out["by_stratum_lanes"][stratum][f"both:{name}"] = band_report(
                combined, sub_labels, sub_probes, refusals
            )
    # Recall at k: for each probe with a labelled duplicate, the rank of its best
    # duplicate among every idea it could have matched, by each lane.
    first = sorted({i["extractor"] for i in ideas})[0]
    dups: dict[str, set[int]] = defaultdict(set)
    stratum_of: dict[str, str] = {}
    for r, (a, b) in zip(rows, pairs):
        stratum_of[r["pair"].split(":")[0]] = r["stratum"]
        if r["label"] == "same":
            dups[r["pair"].split(":")[0]].add(b)
    out["recall_at_k"] = {}
    for stratum in sorted(set(stratum_of.values())):
        ranks: dict[str, list[int]] = defaultdict(list)
        for probe_id, targets in dups.items():
            if stratum_of[probe_id] != stratum:
                continue
            probe = index[probe_id]
            source = ideas[probe]["source"]
            if stratum == "cross-source":
                allowed = [i for i, x in enumerate(ideas) if x["extractor"] == first and x["source"] != source]
            else:
                allowed = [i for i, x in enumerate(ideas) if x["extractor"] == first and x["source"] == source]
            word_scores = np.array([lexical.score(probe, i) for i in allowed])
            lane_scores = {"words": word_scores}
            for name, matrix in vectors.items():
                meaning = matrix[allowed] @ matrix[probe]
                lane_scores[name] = meaning
                weight = out["both"][name]["weight_on_meaning"]
                lane_scores[f"both:{name}"] = weight * meaning + (1 - weight) * word_scores
            positions = {i: n for n, i in enumerate(allowed)}
            for name, scores in lane_scores.items():
                order = np.argsort(-scores)
                rank = {int(allowed[j]): r + 1 for r, j in enumerate(order)}
                ranks[name].append(min(rank[t] for t in targets if t in positions))
        out["recall_at_k"][stratum] = {
            name: {f"top_{k}": round(sum(r <= k for r in values) / len(values), 4) for k in (1, 3, 5, 10, 20)}
            | {"probes": len(values)}
            for name, values in ranks.items()
        }
    # What each lane finds that the other does not, among true duplicates.
    out["duplicates_pooled_by"] = dict(
        Counter("+".join(r["pooled_by"]) for r in rows if r["label"] == "same").most_common()
    )
    out["duplicates_only_meaning_found"] = sum(
        r["label"] == "same" and "words" not in r["pooled_by"] for r in rows
    )
    out["duplicates_only_words_found"] = sum(
        r["label"] == "same" and r["pooled_by"] == ["words"] for r in rows
    )
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    e = sub.add_parser("embed", help="embed every statement with one local model")
    e.add_argument("ideas", type=Path)
    e.add_argument("--model", required=True)
    e.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("pool", help="sample probes and pool candidate pairs for labelling")
    p.add_argument("ideas", type=Path)
    p.add_argument("--vectors", type=Path, required=True)
    p.add_argument("--probes", type=int, default=150)
    p.add_argument("--cross-extractor", type=int, default=60)
    p.add_argument("--top", type=int, default=3)
    p.add_argument("--seed", type=int, default=20261111)
    p.add_argument("--out", type=Path, required=True)
    s = sub.add_parser("score", help="report how each lane sorts the labelled pairs")
    s.add_argument("ideas", type=Path)
    s.add_argument("--vectors", type=Path, required=True)
    s.add_argument("--labels", type=Path, required=True)
    s.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    ideas = read_ideas(args.ideas)

    if args.command == "embed":
        print(json.dumps(embed(ideas, args.model, args.out)))
        return 0
    vectors = load_vectors(args.vectors)
    if args.command == "pool":
        rows = pool(ideas, vectors, args.probes, args.cross_extractor, args.top, args.seed)
        with args.out.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"{len(rows)} pairs pooled from {len(vectors) + 1} lanes", file=sys.stderr)
        return 0
    labelled = [json.loads(line) for line in args.labels.read_text(encoding="utf-8").splitlines() if line.strip()]
    result = score(ideas, vectors, labelled)
    result["models"] = {
        name: json.loads(timing.read_text())
        for name in vectors
        if (timing := args.vectors / f"{model_key(name)}.timing.json").exists()
    }
    text = json.dumps(result, indent=2) + "\n"
    if args.out:
        args.out.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
