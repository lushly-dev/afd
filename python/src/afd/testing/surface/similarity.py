"""
Token-based cosine similarity for command description analysis.

Lightweight, dependency-free approach using term-frequency vectors.

Port of packages/testing/src/surface/similarity.ts
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

STOP_WORDS: set[str] = {
	"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
	"have", "has", "had", "do", "does", "did", "will", "would", "could",
	"should", "may", "might", "shall", "can", "to", "of", "in", "for",
	"on", "with", "at", "by", "from", "as", "into", "through", "during",
	"before", "after", "above", "below", "between", "and", "but", "or",
	"not", "no", "nor", "so", "yet", "both", "either", "neither", "each",
	"every", "all", "any", "few", "more", "most", "other", "some", "such",
	"than", "too", "very", "this", "that", "these", "those", "it", "its",
}


@dataclass
class SimilarityPair:
	command_a: str
	command_b: str
	score: float


class SimilarityMatrix:
	def __init__(
		self, pairs: list[SimilarityPair], scores: dict[str, float]
	) -> None:
		self.pairs = pairs
		self._scores = scores

	def get(self, command_a: str, command_b: str) -> float:
		key = "\0".join(sorted([command_a, command_b]))
		return self._scores.get(key, 0.0)


def tokenize(text: str, case_insensitive: bool = True) -> list[str]:
	"""Tokenize text into words, removing non-alphanumeric characters."""
	normalized = text.lower() if case_insensitive else text
	cleaned = re.sub(r"[^a-z0-9\s]", " ", normalized, flags=re.IGNORECASE)
	return [t for t in cleaned.split() if t]


def build_term_frequency(tokens: list[str]) -> dict[str, int]:
	"""Build a term frequency map from tokens."""
	tf: dict[str, int] = {}
	for token in tokens:
		tf[token] = tf.get(token, 0) + 1
	return tf


def cosine_similarity(
	a: str,
	b: str,
	*,
	remove_stop_words: bool = True,
	case_insensitive: bool = True,
	additional_stop_words: list[str] | None = None,
) -> float:
	"""Compute cosine similarity between two strings using term-frequency vectors."""
	tokens_a = tokenize(a, case_insensitive)
	tokens_b = tokenize(b, case_insensitive)

	if remove_stop_words:
		sw = set(STOP_WORDS)
		if additional_stop_words:
			for w in additional_stop_words:
				sw.add(w.lower())
		tokens_a = [t for t in tokens_a if t not in sw]
		tokens_b = [t for t in tokens_b if t not in sw]

	tf_a = build_term_frequency(tokens_a)
	tf_b = build_term_frequency(tokens_b)

	all_terms = set(tf_a.keys()) | set(tf_b.keys())

	dot_product = 0.0
	magnitude_a = 0.0
	magnitude_b = 0.0

	for term in all_terms:
		val_a = tf_a.get(term, 0)
		val_b = tf_b.get(term, 0)
		dot_product += val_a * val_b
		magnitude_a += val_a * val_a
		magnitude_b += val_b * val_b

	magnitude = math.sqrt(magnitude_a) * math.sqrt(magnitude_b)
	return 0.0 if magnitude == 0 else dot_product / magnitude


def build_similarity_matrix(
	commands: list[Any],
	*,
	remove_stop_words: bool = True,
	case_insensitive: bool = True,
) -> SimilarityMatrix:
	"""Compute pairwise description similarity for a command set."""
	pairs: list[SimilarityPair] = []
	scores: dict[str, float] = {}

	for i in range(len(commands)):
		for j in range(i + 1, len(commands)):
			cmd_a = commands[i]
			cmd_b = commands[j]

			name_a = cmd_a.name if hasattr(cmd_a, "name") else cmd_a.get("name", "")
			name_b = cmd_b.name if hasattr(cmd_b, "name") else cmd_b.get("name", "")
			desc_a = cmd_a.description if hasattr(cmd_a, "description") else cmd_a.get("description", "")
			desc_b = cmd_b.description if hasattr(cmd_b, "description") else cmd_b.get("description", "")

			score = cosine_similarity(
				desc_a, desc_b,
				remove_stop_words=remove_stop_words,
				case_insensitive=case_insensitive,
			)

			pairs.append(SimilarityPair(command_a=name_a, command_b=name_b, score=score))
			key = "\0".join(sorted([name_a, name_b]))
			scores[key] = score

	pairs.sort(key=lambda p: p.score, reverse=True)
	return SimilarityMatrix(pairs=pairs, scores=scores)
