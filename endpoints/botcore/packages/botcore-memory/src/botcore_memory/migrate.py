"""Copy the single local user's ``default`` agent memory to a principal, locally.

Entries written before host callers had principals sit under the ``default`` agent scope.
:func:`move_default_memory` copies them to another principal's agent scope, keeping every
field (id, tags, timestamps, creator, ttl), after backing up both stores. It never deletes:
once it reports the copy verified, the reader removes the old file themselves.

It is a Python function, not a served command: it runs only in the local user's own process
and refuses a Botcore host call.
"""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path

from afd import CommandResult, error, success

from . import commands
from .access import DEFAULT_PRINCIPAL, _host_call
from .local_store import LocalMemoryStore
from .models import MemoryEntry, validate_scope_id

SCOPE = "agent"


def _normalized(raw: dict) -> dict:
    return MemoryEntry.from_dict(raw).to_dict()


def _back_up(store: LocalMemoryStore, scope_ids: tuple[str, ...], backup_dir: Path) -> list[str]:
    saved = []
    for scope_id in scope_ids:
        source = store._file_path(SCOPE, scope_id)
        if source.exists():
            target = backup_dir / SCOPE / source.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            saved.append(str(target))
    return saved


async def move_default_memory(
    to: str, *, backup_dir: str | Path | None = None
) -> CommandResult[dict]:
    """Copy every ``default`` agent-memory entry to principal ``to``'s agent memory.

    Stop any host serving the store first. Under the target's lock: backs up both stores (to
    ``backup_dir``, by default a timestamped ``.backup-<UTC time>`` folder beside the scope
    folders), then builds the target file and writes it once. A target entry identical to
    its source copy counts as already moved, so a rerun after an interrupted move completes
    it; a target key holding anything else is a conflict, refused before writing, as is a
    copy that would pass ``max_entries_per_scope``. The written file is read back and
    compared. Every result after the backup names the backup files. The ``default``
    entries are left in place.

    Args:
        to: The target principal, such as ``principal_id(Actor(kind="agent", id="x"))``.
        backup_dir: Where to copy both stores before writing.
    """
    if _host_call() is not None:
        return error(
            "MEMORY_MOVE_LOCAL_ONLY",
            "Moving default memory runs only in the local user's own process",
            suggestion="Run move_default_memory from a local script, not through a host",
        )
    if err := validate_scope_id(to):
        return error("MEMORY_INVALID_SCOPE_ID", err, suggestion="Pass a principal id")
    if to == DEFAULT_PRINCIPAL:
        return error(
            "MEMORY_INVALID_SCOPE_ID",
            "The target is the default principal itself",
            suggestion="Pass the principal to copy the default memory to",
        )
    store = commands.get_store()
    if not isinstance(store, LocalMemoryStore):
        return error(
            "MEMORY_MOVE_UNSUPPORTED",
            "Only the local JSON store can be backed up and moved",
            suggestion="Configure store = 'local' for the move",
        )

    source_path = store._file_path(SCOPE, DEFAULT_PRINCIPAL)
    target_path = store._file_path(SCOPE, to)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    folder = Path(backup_dir) if backup_dir else store._base_path / f".backup-{stamp}"
    async with store._get_lock(SCOPE, DEFAULT_PRINCIPAL), store._get_lock(SCOPE, to):
        try:
            source = {k: _normalized(v) for k, v in store._read_file(source_path).items()}
            target = {k: _normalized(v) for k, v in store._read_file(target_path).items()}
        except (OSError, ValueError, KeyError) as exc:
            return error(
                "MEMORY_MOVE_READ_FAILED",
                f"Could not read the stores: {exc}",
                suggestion="Check the store files are readable JSON, then retry",
            )
        try:
            backup = _back_up(store, (DEFAULT_PRINCIPAL, to), folder)
        except OSError as exc:
            return error(
                "MEMORY_MOVE_BACKUP_FAILED",
                f"Could not back up the stores to {folder}: {exc}",
                suggestion="Pass a writable backup_dir",
            )
        wanted = {key: {**entry, "scope_id": to} for key, entry in source.items()}
        already = sorted(key for key, entry in wanted.items() if target.get(key) == entry)
        conflicts = sorted(key for key in wanted if key in target and key not in already)
        if conflicts:
            return error(
                "MEMORY_MOVE_CONFLICT",
                f"{len(conflicts)} key(s) already hold other entries under {to}: "
                + ", ".join(conflicts[:10]),
                suggestion="Rename or delete those keys under one principal, then move again",
                details={"conflicts": conflicts, "backup": backup},
            )
        merged = {**target, **wanted}
        limit = commands._config.max_entries_per_scope
        if len(merged) > limit:
            return error(
                "MEMORY_SCOPE_FULL",
                f"{to} would hold {len(merged)} entries; the limit is {limit}",
                suggestion="Delete old entries or raise max_entries_per_scope in config",
                details={"backup": backup},
            )
        moved = sorted(set(wanted) - set(already))
        if moved:
            try:
                store._write_file(target_path, merged)
            except Exception as exc:
                return error(
                    "MEMORY_MOVE_WRITE_FAILED",
                    f"Writing {to}'s store failed: {exc}; it is unchanged",
                    suggestion="Fix the cause and run the move again",
                    details={"backup": backup},
                )
        try:
            written = store._read_file(target_path)
        except (OSError, ValueError) as exc:
            written, unreadable = {}, exc
        else:
            unreadable = None
        mismatched = sorted(
            key
            for key, entry in wanted.items()
            if key not in written or _normalized(written[key]) != entry
        )
    if unreadable is not None or mismatched:
        return error(
            "MEMORY_MOVE_UNVERIFIED",
            f"{len(mismatched)} entries read back differently: {', '.join(mismatched[:10])}",
            suggestion=f"Keep the default entries; restore {to} from the backup and retry",
            details={"mismatched": mismatched, "backup": backup},
        )
    return success(
        {
            "moved": len(moved),
            "already_moved": len(already),
            "from": DEFAULT_PRINCIPAL,
            "to": to,
            "verified": True,
            "backup": backup,
            "default_store": str(source_path),
        },
        reasoning=(
            f"Copied {len(moved)} entries ({len(already)} were already there) and verified "
            f"all {len(wanted)}; the default store is unchanged and can be deleted once you "
            "no longer need it"
        ),
    )
