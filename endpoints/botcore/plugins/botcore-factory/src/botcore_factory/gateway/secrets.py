"""Text checked before it reaches GitHub: reserved markers, secret rules and the size limit.

The built-in rules are a small subset of the gitleaks rule set (GitHub, AWS, Slack and
private-key formats); a repository adds its own patterns in the configuration. A refusal
names the field and the rule, never the matched text.
"""

from __future__ import annotations

import re

from afd import CommandResult, error

#: Hidden markers only the gateway writes: claims, releases, dedupe keys, and the legacy claim
#: markers the cutover honours. A caller's text holding one could forge a claim or a key.
RESERVED_MARKER = re.compile(
    r"<!--\s*(?:botcore-factory:|factory-gateway:|lushly-issue-claim)", re.IGNORECASE
)
#: A closing keyword GitHub acts on; pr-open writes these from closes[] itself.
CLOSING_KEYWORD = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+"
    r"(?:(?:[\w.-]+/[\w.-]+)?#\d+|https?://\S+/issues/\d+)",
    re.IGNORECASE,
)
#: git check-ref-format's rules, plus ``#`` and ``%``, which git allows but a URL reads as
#: a fragment or an escape.
_BAD_REF = re.compile(r"(\.\.|//|@\{|[\x00-\x20~^:?*\[\\\x7f#%]|\.lock(?:/|$)|/\.|^\.|/$|\.$)")

BUILT_IN_RULES: dict[str, str] = {
    "github-token": r"\bgh[pousr]_[A-Za-z0-9]{36,}\b",
    "github-fine-grained-token": r"\bgithub_pat_[A-Za-z0-9_]{22,}\b",
    "aws-access-key": r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
    "slack-token": r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b",
    "private-key": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
}


def rules(patterns: list[str]) -> dict[str, re.Pattern]:
    compiled = {name: re.compile(pattern) for name, pattern in BUILT_IN_RULES.items()}
    for index, pattern in enumerate(patterns):
        compiled[f"repository-pattern-{index + 1}"] = re.compile(pattern)
    return compiled


def check_text(
    fields: dict[str, str | None], patterns: list[str], max_bytes: int
) -> CommandResult | None:
    """Refuse the first field that is too large or matches a secret rule; None when clean."""
    compiled = rules(patterns)
    for field, text in fields.items():
        if not text:
            continue
        if RESERVED_MARKER.search(text):
            return error(
                "RESERVED_MARKER",
                f"{field} holds a marker only the gateway writes; nothing was written",
                suggestion="Remove the <!-- botcore-factory:/factory-gateway: --> marker; "
                "claims and dedupe keys go through issue-claim and dedupe_key",
                details={"field": field},
            )
        size = len(text.encode("utf-8"))
        if size > max_bytes:
            return error(
                "BODY_TOO_LARGE",
                f"{field} is {size} bytes; the gateway takes at most {max_bytes}",
                suggestion="Shorten it, or link to a log instead of pasting it",
            )
        for name, rule in compiled.items():
            if rule.search(text):
                return error(
                    "SECRET_IN_BODY",
                    f"{field} holds text matching the secret rule {name}; nothing was written",
                    suggestion="Redact it: remove the matching text and retry the same call",
                    details={"field": field, "rule": name},
                )
    return None


def ref_is_well_formed(ref: str) -> bool:
    """git check-ref-format's rules for a full ref: no ``..``, ``//``, ``@{``, control or
    special characters, no component starting with ``.`` or ending ``.lock``."""
    return ref.startswith("refs/") and not _BAD_REF.search(ref)
