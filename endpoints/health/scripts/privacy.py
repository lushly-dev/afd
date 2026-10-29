"""Private-record and machine-path scan for Health source and package artifacts.

Generic rules live here. Terms that would themselves be private (repository names
from a personal inventory, for example) are passed in a caller-owned deny file that
stays outside the repository. Patterns are assembled from fragments so this file
does not match itself.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import PurePosixPath

_SEP = "/"
MACHINE_PATH = re.compile(
    "|".join(
        [
            re.escape(_SEP + "Users" + _SEP),
            re.escape(_SEP + "home" + _SEP) + r"[a-z]",
            re.escape(_SEP + "private" + _SEP + "var" + _SEP),
            re.escape(_SEP + "var" + _SEP + "folders" + _SEP),
            r"\b[A-Za-z]:\\{1,2}(?:Users|Documents|Windows|github|repos|src)\b",
            re.escape("\\" + "Users" + "\\"),
        ]
    )
)
TOKEN = re.compile(
    "|".join(
        [
            "gh" + r"[pousr]_[A-Za-z0-9]{20,}",
            "github" + "_pat_",
            "xox" + r"[abpr]-",
            "AK" + r"IA[0-9A-Z]{16}",
            "s" + r"k-[A-Za-z0-9]{20,}",
            "-----BEGIN " + r"[A-Z ]*PRIVATE KEY",
        ]
    )
)
EMAIL = re.compile(r"[\w.+-]+@([\w-]+(?:\.[\w-]+)+)")
ALLOWED_EMAIL_DOMAINS = {"example.invalid"}
URL_HOST = re.compile(r"https?://([^/\s\"'<>)]+)")
ALLOWED_HOSTS = {"github.com", "json-schema.org", "pypi.org", "files.pythonhosted.org"}
INVENTORY_MARKERS = ("repos" + ".toml",)
FORBIDDEN_PARTS = {".git", ".venv", "__pycache__", "reports", "baselines", "history", ".env"}


def scan_text(name: str, text: str, deny_terms: Iterable[str] = ()) -> list[str]:
    """Return human-readable findings; never echo the matched private value."""
    findings = []
    if MACHINE_PATH.search(text):
        findings.append(f"{name}: machine-specific absolute path")
    if TOKEN.search(text):
        findings.append(f"{name}: credential-like token")
    for match in EMAIL.finditer(text):
        if match.group(1).lower() not in ALLOWED_EMAIL_DOMAINS:
            findings.append(f"{name}: email address")
            break
    for match in URL_HOST.finditer(text):
        if match.group(1).lower() not in ALLOWED_HOSTS:
            findings.append(f"{name}: unexpected host")
            break
    if any(marker in text for marker in INVENTORY_MARKERS):
        findings.append(f"{name}: repository inventory reference")
    lowered = text.lower()
    for index, term in enumerate(term for term in deny_terms if term.strip()):
        if re.search(rf"(?<![\w-]){re.escape(term.strip().lower())}(?![\w-])", lowered):
            findings.append(f"{name}: caller deny term #{index}")
    return findings


def scan_member(name: str, data: bytes, deny_terms: Iterable[str] = ()) -> list[str]:
    parts = set(PurePosixPath(name).parts)
    findings = [f"{name}: forbidden path component"] if parts & FORBIDDEN_PARTS else []
    if name.endswith((".html", ".htm")):
        findings.append(f"{name}: dashboard/report markup is not part of this package")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return [*findings, f"{name}: unexpected binary content"]
    return [*findings, *scan_text(name, text, deny_terms)]


def load_deny_terms(path) -> list[str]:
    if path is None:
        return []
    with open(path, encoding="utf-8") as stream:
        return [line.strip() for line in stream if line.strip() and not line.startswith("#")]
