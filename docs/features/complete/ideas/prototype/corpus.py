#!/usr/bin/env python3
"""Corpus census for the Ideas plan's phase 0.

Reads a directory of source files and reports what an archive is made of before
anything is extracted from it: how many files, how many are the same file twice,
how many differ only in line endings and trailing space, and which look like an
earlier or later draft of another.

Standard library only. Python 3.10 or later.

    python3 corpus.py ROOT --manifest corpus.manifest.json --counts corpus.counts.json

The manifest names every file and stays with the corpus. The counts file holds
numbers only, no path and no text, and can be committed here as the record of a run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

TOOL_VERSION = 1
SHINGLE = 8  # words in a shingle
LIKELY_VERSION = 0.5  # containment at or above which two sources are a likely version
WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’-]*")


def normalise(data: bytes) -> bytes:
    """Line endings to LF, trailing space removed from each line and from the end."""
    text = data.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return ("\n".join(lines) + "\n").encode("utf-8")


def shingles(text: str, size: int = SHINGLE) -> set[int]:
    tokens = [t.lower() for t in WORD.findall(text)]
    if len(tokens) < size:
        return {hash(" ".join(tokens))} if tokens else set()
    return {hash(" ".join(tokens[i : i + size])) for i in range(len(tokens) - size + 1)}


def containment(a: set[int], b: set[int]) -> float:
    """The share of the smaller source's shingles that the other also holds."""
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def census(root: Path, extensions: tuple[str, ...]) -> tuple[dict, dict]:
    """Return (manifest, counts) for every file under root with one of the extensions."""
    files = []
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.suffix in extensions):
        data = path.read_bytes()
        norm = normalise(data)
        text = norm.decode("utf-8")
        files.append(
            {
                "path": path.relative_to(root).as_posix(),
                "sha256": hashlib.sha256(data).hexdigest(),
                "normalised_sha256": hashlib.sha256(norm).hexdigest(),
                "bytes": len(data),
                "words": len(WORD.findall(text)),
                "front_matter": text.startswith("---\n"),
                "crlf": b"\r\n" in data,
            }
        )

    by_bytes: dict[str, list[dict]] = defaultdict(list)
    by_norm: dict[str, list[dict]] = defaultdict(list)
    for f in files:
        by_bytes[f["sha256"]].append(f)
        by_norm[f["normalised_sha256"]].append(f)

    # One representative for each distinct content: the first path in sorted order.
    sources = []
    for norm_hash, group in sorted(by_norm.items(), key=lambda kv: kv[1][0]["path"]):
        first = group[0]
        sources.append(
            {
                "source": "src-" + norm_hash[:12],
                "path": first["path"],
                "words": first["words"],
                "copies": [g["path"] for g in group[1:]],
                "copies_identical_bytes": sum(g["sha256"] == first["sha256"] for g in group[1:]),
            }
        )

    shingle_sets = {
        s["source"]: shingles(normalise((root / s["path"]).read_bytes()).decode("utf-8"))
        for s in sources
    }
    versions = []
    for i, a in enumerate(sources):
        for b in sources[i + 1 :]:
            c = containment(shingle_sets[a["source"]], shingle_sets[b["source"]])
            if c >= LIKELY_VERSION:
                versions.append({"a": a["source"], "b": b["source"], "containment": round(c, 3)})

    sizes = sorted(s["words"] for s in sources)

    def q(p: float) -> int:
        return sizes[min(len(sizes) - 1, int(p * len(sizes)))] if sizes else 0

    counts = {
        "tool": "corpus.py",
        "tool_version": TOOL_VERSION,
        "extensions": list(extensions),
        "files": len(files),
        "words": sum(f["words"] for f in files),
        "distinct_by_bytes": len(by_bytes),
        "distinct_after_normalising": len(by_norm),
        "files_that_repeat_another_byte_for_byte": len(files) - len(by_bytes),
        "files_that_differ_only_in_line_endings_or_trailing_space": len(by_bytes) - len(by_norm),
        "words_in_distinct_sources": sum(s["words"] for s in sources),
        "source_words": {"median": q(0.5), "p90": q(0.9), "max": q(1.0), "min": q(0.0)},
        "files_with_front_matter": sum(f["front_matter"] for f in files),
        "files_with_crlf": sum(f["crlf"] for f in files),
        "likely_version_pairs": len(versions),
        "sources_in_a_likely_version_pair": len({v[k] for v in versions for k in ("a", "b")}),
        "shingle_words": SHINGLE,
        "likely_version_containment": LIKELY_VERSION,
    }
    manifest = {"root": str(root), "files": files, "sources": sources, "likely_versions": versions}
    return manifest, counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("root", type=Path)
    parser.add_argument("--ext", action="append", default=None, help="default: .md and .txt")
    parser.add_argument("--manifest", type=Path, help="where to write the manifest (names files)")
    parser.add_argument("--counts", type=Path, help="where to write the counts (numbers only)")
    args = parser.parse_args(argv)
    manifest, counts = census(args.root, tuple(args.ext or [".md", ".txt"]))
    if args.manifest:
        args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    text = json.dumps(counts, indent=2) + "\n"
    if args.counts:
        args.counts.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
