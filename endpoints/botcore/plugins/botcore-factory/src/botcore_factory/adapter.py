"""The repository adapter: what each repository states about its own lane.

Botcore validates ``[tool.botcore.plugins.factory]`` in ``pyproject.toml`` or
``[plugins.factory]`` in ``botcore.toml`` against ``FactoryConfig`` and hands the result to the
plugin. Commands are argument lists, never shell strings. Intake reads ``labels``; enqueue reads
``prequeue`` (named stages), ``review_evidence`` (``{head}`` stands for the head being enqueued)
and ``gate_paths``. The other keys are parsed and validated now so the lane's later commands find
them checked.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import PurePosixPath

from pydantic import BaseModel, ConfigDict, Field, field_validator

Argv = list[str]


def _argv(value: list[str] | None, key: str) -> list[str] | None:
    if value is None:
        return None
    if not value or any(not isinstance(part, str) or not part for part in value):
        raise ValueError(f"{key} must be a non-empty list of non-empty strings (an argument list)")
    return value


def _relative(value: str, key: str) -> str:
    path = PurePosixPath(value.replace("\\", "/"))
    if not value or path.is_absolute() or ".." in path.parts or ":" in value:
        raise ValueError(f"{key} must be a path inside the repository, relative to its root")
    return str(path)


class Stage(BaseModel):
    """One cheap check run before a branch joins the queue."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", description="Shown when the stage fails")
    run: Argv = Field(description="The argument list, run in the cell's worktree")

    @field_validator("run")
    @classmethod
    def _run(cls, value: list[str]) -> list[str]:
        return _argv(value, "run")


@lru_cache(maxsize=256)
def _pattern(glob: str) -> re.Pattern:
    """``**`` crosses directories, ``*`` and ``?`` stay within one."""
    parts = re.split(r"(\*\*/?|\*|\?)", glob)
    table = {"**": ".*", "**/": "(?:.*/)?", "*": "[^/]*", "?": "[^/]"}
    return re.compile("".join(table.get(part, re.escape(part)) for part in parts))


def matches(path: str, globs: list[str]) -> bool:
    """Whether ``path`` or a directory above it matches one of ``globs``.

    A directory match covers what is inside it, so ``scripts/affected*`` covers
    ``scripts/affected/suites.mjs``.
    """
    parts = path.replace("\\", "/").split("/")
    candidates = ["/".join(parts[:end]) for end in range(len(parts), 0, -1)]
    return any(_pattern(glob).fullmatch(candidate) for glob in globs for candidate in candidates)


class FactoryConfig(BaseModel):
    """``[plugins.factory]``: one repository's contract with the lane."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    labels: str | None = Field(
        default=None,
        description="The label definitions file intake reads (AFD: .github/labels.json)",
    )
    validate_command: Argv | None = Field(
        default=None, alias="validate", description="The full validation of a branch"
    )
    prequeue: list[Stage] = Field(default_factory=list, description="The cheap checks, in order")
    coverage: Argv | None = Field(default=None, description="Coverage run on main")
    install: Argv | None = Field(default=None, description="Installs dependencies")
    required_check: str | None = Field(default=None, description="The aggregate required check")
    gate_paths: list[str] = Field(default_factory=list, description="Globs of gate files")
    review_evidence: Argv | None = Field(default=None, description="Verifies a head's review")
    receipt: Argv | None = Field(default=None, description="Confirms an earlier validation")
    ui_paths: list[str] = Field(default_factory=list, description="Globs of UI source")
    screens: Argv | None = Field(default=None, description="Captures before and after screens")
    preview: Argv | None = Field(default=None, description="Serves the app for a commit")
    ignore_branches: list[str] = Field(default_factory=list, description="Never the lane's")
    measure_paths: list[str] = Field(default_factory=list, description="The loop's own measures")
    trend_issue: int | None = Field(default=None, gt=0, description="The trend issue")

    @field_validator("labels")
    @classmethod
    def _labels_inside(cls, value: str | None) -> str | None:
        return None if value is None else _relative(value, "labels")

    @field_validator(
        "validate_command",
        "coverage",
        "install",
        "review_evidence",
        "receipt",
        "screens",
        "preview",
    )
    @classmethod
    def _commands(cls, value: list[str] | None, info) -> list[str] | None:
        return _argv(value, info.field_name)

    @field_validator("prequeue")
    @classmethod
    def _stages(cls, value: list[Stage]) -> list[Stage]:
        names = [stage.name for stage in value]
        if len(set(names)) != len(names):
            raise ValueError("prequeue stage names must be unique")
        return value

    @field_validator("gate_paths", "ui_paths", "measure_paths", "ignore_branches")
    @classmethod
    def _patterns(cls, value: list[str], info) -> list[str]:
        if any(not isinstance(item, str) or not item.strip() for item in value):
            raise ValueError(f"{info.field_name} entries must be non-empty strings")
        return value
