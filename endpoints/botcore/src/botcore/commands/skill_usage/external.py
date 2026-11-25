"""Skills kept outside a project's default skill folders (#1830).

Two ways skills live outside `.claude/skills`, `.agents/skills` and `.codex/skills`:

1. **Repository-configured folders and aliases:** `[skills]` in `botcore.toml` (or
   `[tool.botcore.skills]` in `pyproject.toml`) may name `extra_dirs` (e.g. a source folder
   for generated skills), a custom `source_dir`, and `aliases` mapping canonical/alternate
   names to the name the project reports them under. Read from the same default-branch commit
   as the skills themselves, so every machine agrees.
2. **External folders and loaded files:** a person's own skill folders (and configured
   `skill_usage_dirs`) and any `SKILL.md` file loaded from outside a project's configured
   skill folders (a plugin, an unconfigured subfolder). File paths stay in this machine's
   local `state.json` only; only validated skill names and `[size_bytes, listing_chars]`
   counts are shared.
"""

from __future__ import annotations

import os
import stat
import tomllib
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import ValidationError

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.steps import doing
from botcore.commands.skill_usage.events import is_skill_folder
from botcore.config import SkillsConfig, _check_skill_dir

if TYPE_CHECKING:
    from botcore.commands.skill_usage.t3 import Load

DEFAULT_SKILL_DIRS = (".claude/skills", ".agents/skills", ".codex/skills")
_LINK = "120000"
_GIT_SECONDS = 30.0


def _parse_skills_table(table: object) -> SkillsConfig:
    if not isinstance(table, dict):
        return SkillsConfig()
    skills = table.get("skills")
    if not isinstance(skills, dict):
        return SkillsConfig()
    try:
        return SkillsConfig.model_validate(skills)
    except (ValidationError, ValueError, TypeError):
        return SkillsConfig()


def _botcore_table_from_texts(pyproject_text: str | None, botcore_text: str | None) -> dict | None:
    """Apply botcore's config precedence: `[tool.botcore]` in pyproject.toml wins wholesale."""
    if pyproject_text is not None:
        try:
            data = tomllib.loads(pyproject_text)
        except tomllib.TOMLDecodeError:
            data = None
        if isinstance(data, dict):
            tool = data.get("tool")
            section = tool.get("botcore") if isinstance(tool, dict) else None
            if section is not None:
                return section if isinstance(section, dict) else {}
    if botcore_text is not None:
        try:
            data = tomllib.loads(botcore_text)
        except tomllib.TOMLDecodeError:
            return None
        return data if isinstance(data, dict) else None
    return None


def repo_skills_config_at(root: Path, commit: str) -> SkillsConfig:
    """Read `[skills]` from `pyproject.toml` or `botcore.toml` at `commit`.

    Propagates `GitError` so transient git failures follow the same fallback path as
    `held_at`; malformed TOML or invalid config falls back to defaults so a broken config
    never stops collection.
    """
    listed = git_out(
        root, "ls-tree", "-z", commit, "--", "pyproject.toml", "botcore.toml",
        timeout=_GIT_SECONDS,
    )  # fmt: skip
    blobs: dict[str, str] = {}
    for entry in listed.split("\0"):
        about, _, path = entry.partition("\t")
        mode, kind, blob = (*about.split(), "", "", "")[:3]
        if kind == "blob" and mode != _LINK and path in ("pyproject.toml", "botcore.toml"):
            blobs[path] = blob
    if not blobs:
        return SkillsConfig()

    def read_blob(name: str) -> str | None:
        blob = blobs.get(name)
        if not blob:
            return None
        return git_out(root, "cat-file", "blob", blob, timeout=_GIT_SECONDS)

    pyproject_text = read_blob("pyproject.toml")
    table = _botcore_table_from_texts(pyproject_text, None)
    if table is None and "botcore.toml" in blobs:
        table = _botcore_table_from_texts(None, read_blob("botcore.toml"))
    return _parse_skills_table(table)


def _regular_bytes(path: Path) -> bytes | None:
    """Read a regular file's bytes in a single open (nonblocking where supported), verifying
    `S_ISREG` on the opened descriptor so a FIFO swap can never block collection."""
    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
    try:
        fd = os.open(path, flags)
    except (OSError, ValueError):
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            os.close(fd)
            return None
        with os.fdopen(fd, "rb") as handle:
            fd = -1
            return handle.read()
    except (OSError, ValueError):
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        return None


def _file_there(path: Path) -> bool | None:
    """Whether a regular file is there. False only when known absent or not a regular file;
    None when unreadable (permission denied, drive stalled)."""
    try:
        info = os.stat(path)
    except (FileNotFoundError, NotADirectoryError):
        return False
    except (OSError, ValueError):
        return None
    return stat.S_ISREG(info.st_mode)


def repo_skills_config_on_disk(root: Path) -> SkillsConfig:
    """Read `[skills]` from `pyproject.toml` or `botcore.toml` as `root` lies on disk."""
    pyproject_raw = _regular_bytes(root / "pyproject.toml")
    pyproject_text = pyproject_raw.decode("utf-8", errors="replace") if pyproject_raw else None
    table = _botcore_table_from_texts(pyproject_text, None)
    if table is None:
        botcore_raw = _regular_bytes(root / "botcore.toml")
        botcore_text = botcore_raw.decode("utf-8", errors="replace") if botcore_raw else None
        table = _botcore_table_from_texts(None, botcore_text)
    return _parse_skills_table(table)


def skill_dirs_for(config: SkillsConfig) -> tuple[str, ...]:
    """Every repository-relative skill folder to scan for a project, default folders first."""
    dirs: list[str] = list(DEFAULT_SKILL_DIRS)
    try:
        source = _check_skill_dir(config.source_dir)
    except ValueError:
        source = None
    if source and source not in dirs:
        dirs.append(source)
    for extra in config.extra_dirs:
        if extra not in dirs:
            dirs.append(extra)
    return tuple(dirs)


def extra_skill_dirs_for_root(root: str) -> tuple[str, ...]:
    """Non-default configured skill folders for a repository checkout on disk."""
    try:
        cfg = repo_skills_config_on_disk(Path(root))
    except (OSError, ValueError):
        return ()
    return tuple(folder for folder in skill_dirs_for(cfg) if folder not in DEFAULT_SKILL_DIRS)


def apply_aliases(held: dict[str, list[int]], aliases: dict[str, str]) -> dict[str, list[int]]:
    """Fold aliased skill names into their target name in `held`.

    Primary (non-aliased) entries are kept first so an exported skill in `.claude/skills`
    keeps its own size and listing characters; an aliased source skill supplies them only
    when the target is not itself present.
    """
    if not aliases:
        return held

    def resolve(name: str) -> str:
        seen = {name}
        while name in aliases:
            following = aliases[name]
            if following in seen:
                break
            seen.add(following)
            name = following
        return name

    resolved: dict[str, list[int]] = {}
    for name, facts in held.items():
        if name not in aliases:
            resolved[name] = facts
    for name, facts in held.items():
        if name in aliases:
            resolved.setdefault(resolve(name), facts)
    return resolved


def scan_skill_dirs(
    dirs: Sequence[Path], facts_fn: Callable[[bytes], list[int]]
) -> dict[str, list[int]]:
    """Scan external/user skill folders (`<dir>/<name>/SKILL.md`) for skill facts."""
    found: dict[str, list[int]] = {}
    for folder in dirs:
        doing("reading skill folder", folder)
        try:
            children = sorted(folder.iterdir())
        except (OSError, ValueError):
            continue
        for child in children:
            if not is_skill_folder(child.name):
                continue
            raw = _regular_bytes(child / "SKILL.md")
            if raw is None:
                continue
            found.setdefault(child.name, facts_fn(raw))
    return found


def _resolve_loaded_file(raw_path: str, cwd: str | None, roots: Sequence[str]) -> Path | None:
    """Resolve a loaded SKILL.md path to an existing regular file on disk, or None.

    Relative paths check the session's own working directory first, then the project's
    recorded roots.
    """
    text = raw_path.strip()
    if not text or "\x00" in text:
        return None
    try:
        candidate = Path(text).expanduser()
    except (OSError, ValueError):
        return None
    if candidate.is_absolute():
        return candidate if _file_there(candidate) is True else None
    bases: list[str] = [*([] if not cwd else [cwd]), *roots]
    for base in bases:
        try:
            joined = Path(base) / candidate
        except (OSError, ValueError):
            continue
        if _file_there(joined) is True:
            return joined
    return None


def _is_under(child: Path, parent: Path) -> bool:
    try:
        return child.resolve().is_relative_to(parent.resolve())
    except (OSError, ValueError):
        return False


def _same_path(one: Path, other: Path) -> bool:
    try:
        return one.resolve() == other.resolve()
    except (OSError, ValueError):
        return False


def _enclosing_checkout(path: Path) -> tuple[Path, Path] | None:
    """Find the git checkout or linked worktree holding `path`: returns `(checkout_root,
    main_checkout_root)` using local `.git` metadata without invoking git."""
    for candidate in path.parents:
        dotgit = candidate / ".git"
        try:
            if dotgit.is_dir():
                resolved = candidate.resolve()
                return resolved, resolved
            if dotgit.is_file():
                raw = _regular_bytes(dotgit)
                if raw is None:
                    return None
                first = raw.decode("utf-8", errors="replace").splitlines()[0]
                if not first.lower().startswith("gitdir:"):
                    return None
                raw_dir = first.split(":", 1)[1].strip()
                if not raw_dir:
                    return None
                gitdir = Path(raw_dir)
                if not gitdir.is_absolute():
                    gitdir = (candidate / gitdir).resolve()
                else:
                    gitdir = gitdir.resolve()
                common_dir = gitdir
                commondir_raw = _regular_bytes(gitdir / "commondir")
                if commondir_raw is not None:
                    raw_common = commondir_raw.decode("utf-8", errors="replace").strip()
                    if raw_common:
                        common_path = Path(raw_common)
                        common_dir = (
                            common_path.resolve()
                            if common_path.is_absolute()
                            else (gitdir / common_path).resolve()
                        )
                main_root = common_dir.parent if common_dir.name == ".git" else common_dir
                return candidate.resolve(), main_root.resolve()
        except (OSError, ValueError, IndexError):
            return None
    return None


def _matching_checkout_root(canonical_path: Path, roots: Sequence[str]) -> Path | None:
    """If `canonical_path` lives inside a project root or any linked worktree of one of its
    roots, return that checkout/worktree root; otherwise None."""
    enclosing = _enclosing_checkout(canonical_path)
    if enclosing is not None:
        checkout_root, main_root = enclosing
        for root in roots:
            root_path = Path(root)
            if _same_path(checkout_root, root_path) or _same_path(main_root, root_path):
                return checkout_root
            # A project root may be a subfolder inside a repository
            if _is_under(root_path, main_root) and _is_under(canonical_path, root_path):
                return root_path.resolve()
    for root in roots:
        root_path = Path(root)
        if _is_under(canonical_path, root_path):
            return root_path.resolve()
    return None


def _merge_storage(prior: object, kept_on: dict | None) -> dict | None:
    """Keep a previously recorded volume identifier on the same mount when a transient
    lookup falls back to a device number."""
    if kept_on is None:
        return prior if isinstance(prior, dict) else None
    if (
        "id" not in kept_on
        and "volume" in kept_on
        and isinstance(prior, dict)
        and "id" in prior
        and prior.get("volume") == kept_on["volume"]
    ):
        return prior
    return kept_on


def _clean_observed_entries(value: object) -> dict[str, dict]:
    if not isinstance(value, dict):
        return {}
    cleaned: dict[str, dict] = {}
    for skill, entry in value.items():
        if not isinstance(skill, str) or not isinstance(entry, dict):
            continue
        path = entry.get("path")
        facts = entry.get("facts")
        if (
            isinstance(path, str)
            and path
            and "\x00" not in path
            and isinstance(facts, list)
            and len(facts) == 2  # noqa: PLR2004
            and all(type(n) is int and n >= 0 for n in facts)
        ):
            item: dict = {"path": path, "facts": list(facts)}
            if isinstance(entry.get("storage"), dict):
                item["storage"] = dict(entry["storage"])
            if isinstance(entry.get("missing"), str):
                item["missing"] = entry["missing"]
            cleaned[skill] = item
    return cleaned


def _clean_facts_dict(value: object) -> dict[str, list[int]]:
    if not isinstance(value, dict):
        return {}
    return {
        name: list(facts)
        for name, facts in value.items()
        if is_skill_folder(name)
        and isinstance(facts, list)
        and len(facts) == 2  # noqa: PLR2004
        and all(type(n) is int and n >= 0 for n in facts)
    }


def _refresh_observed_entries(
    entries: dict[str, dict],
    *,
    facts_fn: Callable[[bytes], list[int]],
    storage_of_fn: Callable[[Path, dict[tuple[str, int], str | None]], dict | None],
    gone_fn: Callable[[str, dict, dict, datetime | None], bool],
    now: datetime,
    volume_ids: dict[tuple[str, int], str | None],
) -> dict[str, dict]:
    """Re-read existing observed files, drop ones removed on mounted storage, keep away ones."""
    kept: dict[str, dict] = {}
    for skill, entry in entries.items():
        file_path = Path(entry["path"])
        doing("reading observed skill", file_path)
        raw = _regular_bytes(file_path)
        if raw is not None:
            updated: dict = {"path": entry["path"], "facts": facts_fn(raw)}
            merged_storage = _merge_storage(
                entry.get("storage"), storage_of_fn(file_path.parent, volume_ids)
            )
            if merged_storage is not None:
                updated["storage"] = merged_storage
            kept[skill] = updated
            continue
        there = _file_there(file_path)
        if there is False:
            storage_map = {entry["path"]: entry["storage"]} if "storage" in entry else {}
            missing_map = {entry["path"]: entry["missing"]} if "missing" in entry else {}
            if gone_fn(entry["path"], storage_map, missing_map, now):
                continue
            updated = {"path": entry["path"], "facts": list(entry["facts"])}
            if "storage" in entry:
                updated["storage"] = entry["storage"]
            if entry["path"] in missing_map:
                updated["missing"] = missing_map[entry["path"]]
            kept[skill] = updated
        else:
            kept[skill] = entry
    return kept


def _save_observed(
    bucket: dict[str, dict],
    skill: str,
    canonical_path: Path,
    facts: list[int],
    kept_on: dict | None,
) -> None:
    record_entry: dict = {"path": str(canonical_path), "facts": facts}
    merged_storage = _merge_storage(bucket.get(skill, {}).get("storage"), kept_on)
    if merged_storage is not None:
        record_entry["storage"] = merged_storage
    bucket[skill] = record_entry


def _apply_project_observed(
    proj_entry: dict,
    refreshed: dict[str, dict],
    in_configured_dir: Callable[[Path, Path, Sequence[str]], bool],
) -> None:
    roots = proj_entry.get("roots", []) if isinstance(proj_entry, dict) else []
    # Prune observed files once a configured skill dir (e.g. newly added extra_dirs) covers them
    pruned: dict[str, dict] = {}
    for skill, item in refreshed.items():
        path = Path(item["path"])
        checkout_root = _matching_checkout_root(path, roots)
        if checkout_root is not None and in_configured_dir(path, checkout_root, roots):
            continue
        pruned[skill] = item
    skills_inv = proj_entry.get("skills")
    if pruned:
        proj_entry["observed_files"] = pruned
        if isinstance(skills_inv, dict):
            skills_inv["observed"] = {name: item["facts"] for name, item in pruned.items()}
    else:
        proj_entry.pop("observed_files", None)
        if isinstance(skills_inv, dict):
            skills_inv.pop("observed", None)


def update_external_and_observed(  # noqa: C901, PLR0912, PLR0913 - cohesive location tracker
    *,
    loads: Sequence[tuple[str, Load]],
    projects: dict[str, dict],
    previous_projects: dict,
    previous_external: dict,
    user_dirs: Sequence[Path],
    scan_user_dirs: bool = True,
    facts_fn: Callable[[bytes], list[int]],
    storage_of_fn: Callable[[Path, dict[tuple[str, int], str | None]], dict | None],
    gone_fn: Callable[[str, dict, dict, datetime | None], bool],
    now: datetime,
) -> dict:
    """Record where loaded skill files live, refresh previously observed files, and scan
    personal/external skill folders.

    Mutates `projects[name]["observed_files"]` (local-only, holds paths) and
    `projects[name]["skills"]["observed"]` (shared, holds validated `[size, listing]` only).
    Returns the new local `state["external"]` dict (or `{}` when empty).
    """
    volume_ids: dict[tuple[str, int], str | None] = {}
    external_files = _clean_observed_entries(previous_external.get("files"))
    project_observed_files: dict[str, dict[str, dict]] = {}
    root_dirs_cache: dict[str, tuple[str, ...]] = {}

    for proj_name, proj_entry in projects.items():
        prev = previous_projects.get(proj_name)
        raw_prev = prev.get("observed_files") if isinstance(prev, dict) else None
        existing = _clean_observed_entries(proj_entry.get("observed_files"))
        project_observed_files[proj_name] = {**_clean_observed_entries(raw_prev), **existing}

    def dirs_at(root_str: str) -> tuple[str, ...]:
        if root_str not in root_dirs_cache:
            try:
                cfg = repo_skills_config_on_disk(Path(root_str))
            except (OSError, GitError, ValueError):
                cfg = SkillsConfig()
            root_dirs_cache[root_str] = skill_dirs_for(cfg)
        return root_dirs_cache[root_str]

    def configured_dirs_for(roots: Sequence[str]) -> tuple[str, ...]:
        dirs: list[str] = list(DEFAULT_SKILL_DIRS)
        for root in roots:
            for folder in dirs_at(root):
                if folder not in dirs:
                    dirs.append(folder)
        return tuple(dirs)

    def in_configured_dir(canonical_path: Path, checkout_root: Path, roots: Sequence[str]) -> bool:
        return any(
            _is_under(canonical_path, checkout_root / folder)
            for folder in configured_dirs_for([str(checkout_root), *roots])
        )

    if scan_user_dirs:
        seen_loads: set[tuple[str, str, str, str | None]] = set()
        for proj_name, load in loads:
            if not load.file:
                continue
            key = (proj_name, load.skill, load.file, load.cwd)
            if key in seen_loads:
                continue
            seen_loads.add(key)
            doing("reading loaded skill", load.file)
            project_entry = projects.get(proj_name)
            roots = project_entry.get("roots", []) if isinstance(project_entry, dict) else []
            resolved = _resolve_loaded_file(load.file, load.cwd, roots)
            if resolved is None:
                continue
            try:
                canonical_path = resolved.resolve()
            except OSError:
                canonical_path = resolved
            # Classify by the actual path first (before considering any skill-name collision):
            # files inside a project root or its linked worktrees stay scoped to that project, and
            # files inside configured skill dirs are owned by the default-branch inventory.
            checkout_root = (
                _matching_checkout_root(canonical_path, roots)
                if project_entry is not None
                else None
            )
            if checkout_root is not None:
                if in_configured_dir(canonical_path, checkout_root, roots):
                    continue
            elif any(_is_under(canonical_path, u) for u in user_dirs):
                continue
            raw = _regular_bytes(canonical_path)
            if raw is None:
                continue
            facts = facts_fn(raw)
            kept_on = storage_of_fn(canonical_path.parent, volume_ids)
            target_bucket = (
                project_observed_files.setdefault(proj_name, {})
                if checkout_root is not None
                else external_files
            )
            _save_observed(target_bucket, load.skill, canonical_path, facts, kept_on)

    for proj_name, proj_entry in projects.items():
        refreshed = _refresh_observed_entries(
            project_observed_files.get(proj_name, {}),
            facts_fn=facts_fn,
            storage_of_fn=storage_of_fn,
            gone_fn=gone_fn,
            now=now,
            volume_ids=volume_ids,
        )
        _apply_project_observed(proj_entry, refreshed, in_configured_dir)

    external_files = _refresh_observed_entries(
        external_files,
        facts_fn=facts_fn,
        storage_of_fn=storage_of_fn,
        gone_fn=gone_fn,
        now=now,
        volume_ids=volume_ids,
    )
    if scan_user_dirs:
        if user_dirs:
            external_files = {
                name: item
                for name, item in external_files.items()
                if not any(_is_under(Path(item["path"]), u) for u in user_dirs)
            }
        external_held = scan_skill_dirs(user_dirs, facts_fn) if user_dirs else {}
    else:
        # Importing a copied store skips scanning this machine's user dirs: keep what was here
        external_held = _clean_facts_dict(previous_external.get("held"))
    external_observed = {name: item["facts"] for name, item in external_files.items()}
    if not external_files and not external_held:
        return {}
    result: dict = {"held": external_held, "observed": external_observed}
    if external_files:
        result["files"] = external_files
    return result
