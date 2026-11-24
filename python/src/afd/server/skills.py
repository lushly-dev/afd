"""The Skills over MCP extension's catalog (``io.modelcontextprotocol/skills``, SEP-2640;
``spec/mcp-resources.md``, S1 to S8).

A :class:`SkillCatalog` is fixed when built: the constructor reads each skill's bytes once,
checks every rule of S2 and computes the SHA-256 digests, so a catalog that exists is one the
server can serve. The server serves skills as data: it reads only the frontmatter, never follows
instructions in a skill and never widens anything for one.
"""

from __future__ import annotations

import copy
import hashlib
import os
import re
import stat
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from afd.server.frontmatter import FrontmatterError, parse_frontmatter

MAX_SKILL_FILES = 512
"""The most files one skill may have, the extension's limit."""

MAX_SKILL_BYTES = 16 * 1024 * 1024
"""The most bytes one skill may have in total, ``SKILL.md`` included: 16 MiB."""

DIGEST_META_KEY = "dev.afd/digest"
"""The ``_meta`` key a resource's digest goes under, set by the server (R6)."""

SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills"
"""The Skills extension's identifier, declared in ``capabilities.extensions``."""

_DIRECTORY_MIME_TYPE = "inode/directory"

# Agent Skills name rule (S2): 1 to 64 chars of a-z, 0-9, '-', no leading/trailing '-', no '--'.
_NAME_RE = re.compile(r"\A[a-z0-9]+(?:-[a-z0-9]+)*\Z", re.ASCII)
_HEX_PAIR_RE = re.compile(r"\A[0-9A-Fa-f]{2}", re.ASCII)
_UNRESERVED_RE = re.compile(r"\A[A-Za-z0-9\-._~]\Z", re.ASCII)

_MIME_TYPES: dict[str, str] = {
    "md": "text/markdown",
    "txt": "text/plain",
    "json": "application/json",
    "yaml": "application/yaml",
    "yml": "application/yaml",
    "toml": "application/toml",
    "csv": "text/csv",
    "html": "text/html",
    "css": "text/css",
    "js": "text/javascript",
    "mjs": "text/javascript",
    "ts": "text/x-typescript",
    "py": "text/x-python",
    "sh": "text/x-shellscript",
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "pdf": "application/pdf",
}

_ENCODE_BYTES = frozenset({0x22, 0x3C, 0x3E, 0x5C, 0x5E, 0x60, 0x7B, 0x7C, 0x7D})


@dataclass(frozen=True)
class Skill:
    """One Agent Skill: a ``/``-separated skill path and its files' bytes.

    Files are addressed by their path relative to the skill's root (``SKILL.md``,
    ``references/STYLE.md``). A string value is stored as UTF-8. Nothing is checked until
    :class:`SkillCatalog` is built.
    """

    path: str
    files: Mapping[str, str | bytes] | Sequence[tuple[str, str | bytes]]


@dataclass(frozen=True)
class _CatalogFile:
    uri: str
    path: str
    data: bytes
    digest: str
    mime_type: str
    resource: dict[str, Any]


@dataclass(frozen=True)
class _CatalogSkill:
    path: str
    entry: dict[str, Any]
    files: tuple[_CatalogFile, ...]


def sha256_digest(data: bytes) -> str:
    """``sha256:`` followed by the 64 lowercase hex characters of the SHA-256 of ``data`` (R6)."""
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def skill_mime_type(path: str) -> str:
    """The MIME type of a skill file by its suffix, compared case-insensitively (S5)."""
    dot = path.rfind(".")
    suffix = "" if dot < 0 else path[dot + 1 :].lower()
    return _MIME_TYPES.get(suffix, "application/octet-stream")


def _is_valid_utf8_str(text: str) -> bool:
    try:
        text.encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


def _is_name(text: str) -> bool:
    return 1 <= len(text) <= 64 and _NAME_RE.fullmatch(text) is not None


def _encode_not_in_uri(value: str) -> str:
    """Percent-encode characters RFC 3986 never allows literally."""
    out: list[str] = []
    for byte in value.encode("utf-8"):
        if byte <= 0x20 or byte >= 0x7F or byte in _ENCODE_BYTES:
            out.append(f"%{byte:02X}")
        else:
            out.append(chr(byte))
    return "".join(out)


def _normalize_percent_encoding(value: str) -> str:
    """RFC 3986 §6.2.2 percent-encoding normalization."""
    encoded = _encode_not_in_uri(value)
    first = encoded.find("%")
    if first < 0:
        return encoded
    out = [encoded[:first]]
    for part in encoded[first + 1 :].split("%"):
        if len(part) >= 2 and _HEX_PAIR_RE.match(part):
            hex_digits = part[:2]
            ch = chr(int(hex_digits, 16))
            out.append(ch if _UNRESERVED_RE.fullmatch(ch) else f"%{hex_digits.upper()}")
            out.append(part[2:])
        else:
            out.append(f"%{part}")
    return "".join(out)


def _manifest_resource_key(skill_uri: str, resource_uri: str) -> str | None:
    """Comparison key for a skill file URI under ``skill_uri``'s directory after RFC 3986 §6.2.2
    normalization (S2 manifest boundary). Returns ``None`` if resolving ``.`` / ``..`` before
    ``?`` or ``#`` escapes the skill's directory or ends on an empty, ``.`` or ``..`` segment."""
    if not skill_uri.endswith("SKILL.md"):
        return None
    root = _normalize_percent_encoding(skill_uri[: -len("SKILL.md")])
    normalized = _normalize_percent_encoding(resource_uri)
    if not normalized.startswith(root):
        return None
    relative = normalized[len(root) :]
    q_idx = relative.find("?")
    h_idx = relative.find("#")
    cuts = [idx for idx in (q_idx, h_idx) if idx >= 0]
    cut = min(cuts) if cuts else -1
    path = relative if cut < 0 else relative[:cut]
    suffix = "" if cut < 0 else relative[cut:]
    segments = path.split("/")
    file_segment = segments.pop()
    if file_segment in ("", ".", ".."):
        return None
    resolved: list[str] = []
    for segment in segments:
        if segment == ".":
            continue
        if segment == "..":
            if not resolved:
                return None
            resolved.pop()
        else:
            resolved.append(segment)
    resolved.append(file_segment)
    return f"{'/'.join(resolved)}{suffix}"


def _coerce_skill(raw: Skill | Mapping[str, Any]) -> Skill:
    if isinstance(raw, Skill):
        return raw
    if isinstance(raw, Mapping):
        path = raw.get("path")
        files = raw.get("files")
        if not isinstance(path, str):
            raise ValueError('skill "": the skill path must be a string')
        if files is None:
            files = {}
        return Skill(path=path, files=files)
    raise TypeError(f"Expected Skill or mapping, got {type(raw).__name__}")


def _check_skill(skill: Skill) -> _CatalogSkill:
    path = skill.path

    def fail(rule: str) -> ValueError:
        return ValueError(f'skill "{path}": {rule}')

    if not isinstance(path, str) or path == "":
        raise fail("the skill path is empty")
    if not _is_valid_utf8_str(path):
        raise fail("the skill path is not valid UTF-8")
    segments = path.split("/")
    last = segments[-1]
    for segment in segments:
        if not _is_name(segment):
            raise fail(
                f'the skill path segment "{segment}" must be 1 to 64 characters of a-z, 0-9 and -, '
                "not starting or ending with -, with no --"
            )

    raw_files = skill.files
    if isinstance(raw_files, Mapping):
        pairs = list(raw_files.items())
    elif isinstance(raw_files, Sequence) and not isinstance(raw_files, (str, bytes)):
        pairs = list(raw_files)
    else:
        raise fail("files must be a mapping of path to text or bytes")

    if len(pairs) > MAX_SKILL_FILES:
        raise fail(f"has more than {MAX_SKILL_FILES} files")

    seen_raw_paths: set[str] = set()
    files: list[tuple[str, bytes]] = []
    total_bytes = 0
    for file_path, content in pairs:
        if (
            not isinstance(file_path, str)
            or file_path == ""
            or not _is_valid_utf8_str(file_path)
            or any(ch.isspace() or unicodedata.category(ch) == "Cc" for ch in file_path)
            or any(seg in ("", ".", "..") for seg in file_path.split("/"))
        ):
            raise fail(
                f'the file path "{file_path}" must be relative and "/"-separated, valid UTF-8, '
                'with no whitespace, control characters, or empty, "." or ".." segment'
            )
        if file_path in seen_raw_paths:
            raise fail(f'the file path "{file_path}" is listed twice')
        seen_raw_paths.add(file_path)
        if isinstance(content, str):
            if not _is_valid_utf8_str(content):
                raise fail(f'the file "{file_path}" must hold valid UTF-8 text or bytes')
            data = content.encode("utf-8")
        elif isinstance(content, (bytes, bytearray)):
            data = bytes(content)
        else:
            raise fail(f'the file "{file_path}" must hold a string or bytes')
        total_bytes += len(data)
        if total_bytes > MAX_SKILL_BYTES:
            raise fail(f"has more than {MAX_SKILL_BYTES} bytes")
        files.append((file_path, data))

    skill_md = next((item for item in files if item[0] == "SKILL.md"), None)
    if skill_md is None:
        raise fail("has no SKILL.md at its root")

    try:
        skill_md_text = skill_md[1].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise fail("SKILL.md is not valid UTF-8") from exc

    try:
        frontmatter = parse_frontmatter(skill_md_text)
    except FrontmatterError as exc:
        raise fail(f"SKILL.md: {exc}") from exc

    name = frontmatter.get("name")
    description = frontmatter.get("description")
    if not isinstance(name, str):
        raise fail('the frontmatter needs a string "name"')
    if not _is_name(name):
        raise fail(
            f'the name "{name}" must be 1 to 64 characters of a-z, 0-9 and -, '
            "not starting or ending with -, with no --"
        )
    if name != last:
        raise fail(f'the name "{name}" must equal the last segment of the skill path, "{last}"')
    if not isinstance(description, str) or description == "" or len(description) > 1024:
        raise fail('the frontmatter needs a "description" of 1 to 1,024 characters')

    # `SKILL.md` first, then the others in ascending order of their paths' UTF-8 bytes.
    others = sorted(
        (item for item in files if item[0] != "SKILL.md"),
        key=lambda item: item[0].encode("utf-8"),
    )
    ordered = [skill_md, *others]

    prefix = f"skill://{path}/"
    skill_uri = f"{prefix}SKILL.md"
    seen_keys: set[str] = set()
    catalog_files: list[_CatalogFile] = []
    for file_path, data in ordered:
        uri = f"{prefix}{file_path}"
        key = _manifest_resource_key(skill_uri, uri)
        if key is None:
            raise fail(
                f"resource {uri} does not identify a file within the directory of {skill_uri}"
            )
        if key in seen_keys:
            raise fail(f"skill manifest lists {uri} twice")
        seen_keys.add(key)

        digest = sha256_digest(data)
        mime_type = skill_mime_type(file_path)
        resource: dict[str, Any] = {
            "uri": uri,
            "name": name if file_path == "SKILL.md" else file_path,
            **({"description": description} if file_path == "SKILL.md" else {}),
            "mimeType": mime_type,
            "size": len(data),
            "_meta": {DIGEST_META_KEY: digest},
        }
        catalog_files.append(
            _CatalogFile(
                uri=uri,
                path=file_path,
                data=data,
                digest=digest,
                mime_type=mime_type,
                resource=resource,
            )
        )

    entry: dict[str, Any] = {
        "uri": skill_uri,
        "frontmatter": frontmatter,
        "resources": [
            {"uri": item.uri, "digest": item.digest, "size": len(item.data)}
            for item in catalog_files
        ],
    }
    return _CatalogSkill(path=path, entry=entry, files=tuple(catalog_files))


def _directories_of(skill: _CatalogSkill) -> set[str]:
    directories: set[str] = {""}
    for item in skill.files:
        end = item.path.find("/")
        while end >= 0:
            directories.add(item.path[:end])
            end = item.path.find("/", end + 1)
    return directories


class SkillCatalog:
    """An ordered, fixed set of Agent Skills served through ``skills/list``, ``skills/get``,
    ``resources/list`` and ``resources/read`` (and ``resources/directory/read`` when enabled).

    Raises:
        ValueError: Naming the skill and the rule when a skill breaks one of S2's checks.
    """

    def __init__(
        self,
        skills: Sequence[Skill | Mapping[str, Any]],
        *,
        directory_read: bool = False,
    ) -> None:
        self._directory_read = bool(directory_read)
        built: list[_CatalogSkill] = []
        names: set[str] = set()
        paths: set[str] = set()
        for raw in skills:
            checked = _check_skill(_coerce_skill(raw))
            if checked.path in paths:
                raise ValueError(f'skill "{checked.path}": the skill path is used twice')
            paths.add(checked.path)
            name = checked.entry["frontmatter"]["name"]
            if name in names:
                raise ValueError(
                    f'skill "{checked.path}": the name "{name}" is used by another skill '
                    "(names are unique in a catalog, even under different prefixes)"
                )
            names.add(name)
            built.append(checked)

        self._files: dict[str, _CatalogFile] = {}
        self._entries: dict[str, dict[str, Any]] = {}
        self._directories: dict[str, tuple[_CatalogSkill, str]] = {}
        normalized_files: set[str] = set()
        normalized_dirs: set[str] = set()

        for skill in built:
            self._entries[skill.entry["uri"]] = skill.entry
            for item in skill.files:
                norm_uri = _normalize_percent_encoding(item.uri)
                if item.uri in self._files or norm_uri in normalized_files:
                    raise ValueError(
                        f'skill "{skill.path}": the URI {item.uri} is also served by another skill'
                    )
                self._files[item.uri] = item
                normalized_files.add(norm_uri)
            for directory in _directories_of(skill):
                uri = (
                    f"skill://{skill.path}"
                    if directory == ""
                    else f"skill://{skill.path}/{directory}"
                )
                norm_dir = _normalize_percent_encoding(uri)
                if uri in self._directories or norm_dir in normalized_dirs:
                    raise ValueError(
                        f'skill "{skill.path}": the directory {uri} is also a directory of another skill'
                    )
                self._directories[uri] = (skill, directory)
                normalized_dirs.add(norm_dir)

        for uri in self._directories:
            norm_dir = _normalize_percent_encoding(uri)
            if uri in self._files or norm_dir in normalized_files:
                raise ValueError(f"{uri} is both a skill file and a skill directory")

        self._skills = tuple(built)

    @property
    def directory_read(self) -> bool:
        """Whether ``resources/directory/read`` is enabled (S6)."""
        return self._directory_read

    @property
    def size(self) -> int:
        """The number of skills in the catalog."""
        return len(self._skills)

    def __len__(self) -> int:
        return len(self._skills)

    def entries(self) -> list[dict[str, Any]]:
        """The ``skills/list`` entries, in catalog order (S3)."""
        return [copy.deepcopy(skill.entry) for skill in self._skills]

    def entry(self, uri: str) -> dict[str, Any] | None:
        """One ``skills/list`` entry by its exact ``SKILL.md`` URI (S4)."""
        found = self._entries.get(uri)
        return copy.deepcopy(found) if found is not None else None

    def resources(self) -> list[dict[str, Any]]:
        """Every skill file as a ``resources/list`` item, skill by skill in manifest order (S5)."""
        return [copy.deepcopy(item.resource) for skill in self._skills for item in skill.files]

    def file(self, uri: str) -> tuple[bytes, str] | None:
        """A skill file's ``(bytes, mime_type)`` by its exact URI."""
        found = self._files.get(uri)
        return (found.data, found.mime_type) if found is not None else None

    def directory(self, uri: str) -> list[dict[str, Any]] | None:
        """The direct children of a skill directory by exact URI (S6), or ``None``."""
        found = self._directories.get(uri)
        if found is None:
            return None
        skill, directory = found
        prefix = "" if directory == "" else f"{directory}/"
        children: dict[str, dict[str, Any]] = {}
        for item in skill.files:
            if not item.path.startswith(prefix):
                continue
            rest = item.path[len(prefix) :]
            slash = rest.find("/")
            if slash < 0:
                children[rest] = copy.deepcopy(item.resource)
            else:
                subdirectory = rest[:slash]
                if subdirectory not in children:
                    children[subdirectory] = {
                        "uri": f"{uri}/{subdirectory}",
                        "name": subdirectory,
                        "mimeType": _DIRECTORY_MIME_TYPE,
                    }
        return [children[name] for name in sorted(children, key=lambda key: key.encode("utf-8"))]


def _is_within_root(root: str, target: str) -> bool:
    """Whether ``target`` resides inside (or equals) ``root``, handling platform case rules."""
    norm_root = os.path.normcase(os.path.abspath(root))
    norm_target = os.path.normcase(os.path.abspath(target))
    try:
        return os.path.commonpath([norm_root, norm_target]) == norm_root
    except ValueError:
        # Different Windows drives.
        return False


def _is_reparse_or_junction(location: str, info: os.stat_result) -> bool:
    """Whether ``location`` is a Windows directory junction or other non-symlink reparse point."""
    is_junction = getattr(os.path, "isjunction", None)
    if callable(is_junction) and is_junction(location):
        return True
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    attrs = getattr(info, "st_file_attributes", 0)
    return bool(reparse_flag and (attrs & reparse_flag))


def _read_regular_file_bounded(
    source: str,
    *,
    nofollow: bool,
    max_bytes: int,
    relative: str,
    fail: Any,
) -> bytes:
    """Open ``source``, verify the opened fd is a regular file, and read at most ``max_bytes``."""
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
    if nofollow:
        flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(source, flags)
    except OSError as exc:
        raise fail(f"cannot open {relative}: {exc}") from exc
    try:
        fd_info = os.fstat(fd)
        if not stat.S_ISREG(fd_info.st_mode):
            raise fail(f"{relative} is not a regular file")
        if fd_info.st_size > max_bytes:
            raise fail(f"has more than {MAX_SKILL_BYTES} bytes")
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(fd, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        if len(data) > max_bytes:
            raise fail(f"has more than {MAX_SKILL_BYTES} bytes")
        return data
    except OSError as exc:
        raise fail(f"cannot read {relative}: {exc}") from exc
    finally:
        os.close(fd)


def skill_from_directory(path: str, directory: str | os.PathLike[str]) -> Skill:
    """Read a skill from a directory on disk (S2).

    Every regular file under ``directory`` is read once, addressed by its ``/``-separated path
    relative to ``directory``. A symbolic link or directory junction that leaves ``directory``,
    a link/junction to a directory, or any non-regular file is refused.

    Raises:
        ValueError: Naming ``path`` and the problem.
    """

    def fail(problem: str) -> ValueError:
        return ValueError(f'skill "{path}": {problem}')

    dir_str = os.fspath(directory)
    if not os.path.isdir(dir_str):
        raise fail(f"cannot read {dir_str}: not a directory")
    root = os.path.realpath(dir_str)

    files: dict[str, bytes] = {}
    count = 0
    total = 0
    pending: list[tuple[str, str]] = [(root, "")]
    while pending:
        current_dir, prefix = pending.pop()
        if not _is_within_root(root, os.path.realpath(current_dir)):
            raise fail(f"directory {prefix or '.'} escapes the skill's directory")
        try:
            names = sorted(os.listdir(current_dir))
        except OSError as exc:
            raise fail(f"cannot read {current_dir}: {exc}") from exc
        for name in names:
            relative = f"{prefix}{name}"
            location = os.path.join(current_dir, name)
            source = location
            try:
                info = os.lstat(location)
            except OSError as exc:
                raise fail(f"cannot stat {relative}: {exc}") from exc
            if stat.S_ISLNK(info.st_mode) or _is_reparse_or_junction(location, info):
                source = os.path.realpath(location)
                if not _is_within_root(root, source):
                    raise fail(f"{relative} is a symbolic link that leaves the skill's directory")
                try:
                    info = os.stat(source)
                except OSError as exc:
                    raise fail(f"cannot follow {relative}: {exc}") from exc
                if stat.S_ISDIR(info.st_mode):
                    raise fail(f"{relative} is a symbolic link to a directory")
            if stat.S_ISDIR(info.st_mode):
                resolved_dir = os.path.realpath(source)
                if not _is_within_root(root, resolved_dir) or os.path.normcase(
                    resolved_dir
                ) != os.path.normcase(os.path.abspath(source)):
                    raise fail(f"{relative} is a symbolic link to a directory")
                pending.append((resolved_dir, f"{relative}/"))
            elif stat.S_ISREG(info.st_mode):
                count += 1
                if count > MAX_SKILL_FILES:
                    raise fail(f"has more than {MAX_SKILL_FILES} files")
                if info.st_size > MAX_SKILL_BYTES - total:
                    raise fail(f"has more than {MAX_SKILL_BYTES} bytes")
                data = _read_regular_file_bounded(
                    source,
                    nofollow=True,
                    max_bytes=MAX_SKILL_BYTES - total,
                    relative=relative,
                    fail=fail,
                )
                total += len(data)
                files[relative] = data
            else:
                raise fail(f"{relative} is not a regular file")
    return Skill(path=path, files=files)
