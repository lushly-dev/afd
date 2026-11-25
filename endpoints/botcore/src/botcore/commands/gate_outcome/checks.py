"""The checks known: every workflow's jobs and steps, and the commands of a hook group, as they
are at the tip of the repository's default branch. They are read through git from that ref,
never from the caller's working tree, so every branch and every machine knows the same checks.

A check's id is `<workflow file> / <job as GitHub names it> / <step>`, and inside a step that
runs a hook group, ` / <command>` after it. A job is named as GitHub names it: its `name` (or
its id), with the matrix values substituted where the name carries them and appended in
parentheses where it does not; a job that calls a workflow of this repository is
`<caller> / <job of the called workflow>`. Where an expression decides the matrix (as in
`ci.yml`), the legs are the job names the record has seen, and until one is seen the job is
listed once under its name in the file. A step goes by its name, or by its command where it has
none: the first line of its `run`, or what it `uses`.

A hook group step is a step, run from the repository's root, whose command comes down through
the root `package.json` scripts to `lefthook run <group>`. Its commands are that group's in
`lefthook.yml`.
"""

from __future__ import annotations

import itertools
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from botcore.commands.disk.git import GitError, git_out

SEPARATOR = " / "
WORKFLOWS = ".github/workflows/"
# A landing branch, never the checkout's HEAD, which may be a feature branch
DEFAULT_REFS = (
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
    "refs/heads/main",
    "refs/heads/master",
)
# Where the hourly job fetches the default branch (hourly.py): a ref of its own, so no ref a
# session works with moves under it
OWN_REF = "refs/botcore/gate-outcome/default"
LEFTHOOK_FILES = ("lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml")
# Steps GitHub adds to every job, which no workflow file names: a job's overhead, not checks
HOUSEKEEPING = {
    "Set up job", "Complete job", "Set up runner", "Initialize containers", "Stop containers",
}  # fmt: skip
_EXPRESSION = re.compile(r"\$\{\{.*?\}\}", re.DOTALL)
_MATRIX_VALUE = re.compile(r"\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}")
_SCRIPT = re.compile(r"^(?:pnpm|npm|yarn)(?:\s+run)?\s+([A-Za-z0-9][A-Za-z0-9:_.-]*)(?=\s|$)")
_LEFTHOOK = re.compile(
    r"(?:^|[\s;&|(])(?:npx\s+|pnpm\s+(?:exec\s+)?)?lefthook\s+run\s+([A-Za-z0-9][\w-]*)"
)
_GIT_SECONDS = 30.0
_DEPTH = 4  # scripts followed from a step's command to `lefthook run`


def check_id(*parts: str) -> str:
    return SEPARATOR.join(parts)


@dataclass(frozen=True)
class Step:
    label: str  # its name in the file, or its command where it has none
    shown: str  # as a run names it: its name, or `Run <first line of its command>`
    group: str | None = None  # the hook group it runs
    commands: tuple[str, ...] = ()  # that group's commands


@dataclass
class Job:
    file: str  # the workflow's file name, such as ci.yml
    template: str  # its name as the file writes it
    legs: list[str]  # its names as GitHub gives them, one for each matrix leg
    steps: list[Step]
    pattern: re.Pattern[str] | None = None  # for legs the file cannot tell: what they look like

    def names(self, seen: set[str], others: set[str] = frozenset()) -> list[str]:  # type: ignore[assignment]
        """The legs: from the file, or for a matrix the file cannot tell, the names the record
        has seen that fit (a skipped job's unexpanded name, and a name another job of the file
        gives exactly, aside), else the name as written."""
        if self.pattern is None:
            return self.legs
        fitting = sorted(
            name
            for name in seen
            if "${{" not in name and name not in others and self.pattern.fullmatch(name)
        )
        return fitting or [self.template]

    def fits(self, name: str) -> bool:
        if name in self.legs or name == self.template:
            return True
        return self.pattern is not None and bool(self.pattern.fullmatch(name))

    def step(self, shown: str) -> Step | None:
        for step in self.steps:
            if shown in (step.shown, step.label):
                return step
        for step in self.steps:  # a name an expression the file cannot evaluate decides
            if "${{" in step.shown and _pattern(step.shown, appended=False).fullmatch(shown):
                return step
        return None


@dataclass
class Known:
    """The checks known at a ref, or why none could be read."""

    ref: str | None = None
    commit: str | None = None
    jobs: list[Job] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)  # files that could not be read
    error: str | None = None  # why nothing could be read

    @property
    def files(self) -> set[str]:
        return {job.file for job in self.jobs}

    def job(self, file: str, name: str) -> Job | None:
        """The job of `file` a run's job name belongs to: one that names it exactly first."""
        jobs = [job for job in self.jobs if job.file == file]
        for job in jobs:
            if name in job.legs:
                return job
        for job in jobs:  # then by its name as written: a job skipped before its matrix
            if name == job.template:
                return job
        return next((job for job in jobs if job.fits(name)), None)

    def ids(self, seen: dict[str, set[str]]) -> dict[str, tuple[str, str, str, str | None]]:
        """Every check known, id -> (file, job, step, command), with the legs `seen` gives for
        a matrix the file cannot tell (workflow file -> the job names the record has seen)."""
        found: dict[str, tuple[str, str, str, str | None]] = {}
        exact: dict[str, set[str]] = {}
        for job in self.jobs:
            exact.setdefault(job.file, set()).update({*job.legs, job.template})
        for job in self.jobs:
            others = exact[job.file] - {job.template}
            for leg in job.names(seen.get(job.file, set()), others):
                for step in job.steps:
                    if step.group and step.commands:
                        for command in step.commands:
                            found[check_id(job.file, leg, step.label, command)] = (
                                job.file, leg, step.label, command,
                            )  # fmt: skip
                    else:
                        found[check_id(job.file, leg, step.label)] = (
                            job.file, leg, step.label, None,
                        )  # fmt: skip
        return found


def housekeeping(name: str, names: list[str]) -> bool:
    """Whether a step of a run is GitHub's own, not a step of the file: setting up and ending
    the job, and the `Pre`/`Post` halves of an action's step."""
    if name in HOUSEKEEPING:
        return True
    for half in ("Post ", "Pre "):
        if name.startswith(half) and name[len(half) :] in names:
            return True
    return False


def label_of(step: Step | None, name: str) -> str:
    """A run's step as a check names it: the file's label, or where an expression the file
    cannot evaluate is in it (or the file does not have the step), the name the run gives."""
    if step is None or "${{" in step.label:
        return step_label(name)
    return step.label


def step_label(name: str) -> str:
    """A step a run names that the file does not: its command where GitHub named it by one."""
    return name.removeprefix("Run ") if name.startswith("Run ") else name


# ── Reading the ref ─────────────────────────────────────────────────────────


def toplevel(root: Path) -> Path:
    """The top of the checkout `root` is in: a workspace can be a folder inside one."""
    try:
        top = git_out(root, "rev-parse", "--show-toplevel", timeout=_GIT_SECONDS).strip()
    except GitError:
        return root
    return Path(top) if top else root


def _commit(root: Path, ref: str) -> str | None:
    try:
        commit = git_out(
            root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}", timeout=_GIT_SECONDS,
        ).strip()  # fmt: skip
    except GitError:
        return None
    return commit or None


def _contains(root: Path, newer: str, older: str) -> bool:
    """Whether `older` is `newer` or one of its ancestors."""
    try:
        git_out(
            root, "merge-base", "--is-ancestor", older, newer, timeout=_GIT_SECONDS
        )  # fmt: skip
    except GitError:
        return False
    return True


def default_ref(root: Path) -> tuple[str, str] | None:
    """The default branch's tip: the hourly job's own ref (OWN_REF) when it is there and newer
    than the checkout's landing branch, which it is when it holds it; otherwise origin's HEAD,
    origin/main, origin/master, main or master, the first that is there."""
    found = next(
        ((ref, commit) for ref in DEFAULT_REFS if (commit := _commit(root, ref)) is not None),
        None,
    )
    own = _commit(root, OWN_REF)
    if own is not None and (found is None or (own != found[1] and _contains(root, own, found[1]))):
        return OWN_REF, own
    return found


def _show(root: Path, commit: str, path: str) -> str | None:
    try:
        return git_out(root, "show", f"{commit}:{path}", timeout=_GIT_SECONDS)
    except GitError:
        return None


def read_known(root: Path) -> Known:
    """The checks known at the default branch's tip of the checkout at `root`."""
    found = default_ref(root)
    if found is None:
        return Known(
            error="the checkout has no default branch (origin's HEAD, origin/main or main)"
        )
    ref, commit = found
    known = Known(ref=ref, commit=commit)
    try:
        listed = git_out(
            root,
            "ls-tree",
            "-z",
            "--full-tree",
            "--name-only",
            commit,
            "--",
            WORKFLOWS,
            timeout=_GIT_SECONDS,
        )
    except GitError as exc:
        known.error = f"the workflows at {ref} could not be listed: {exc}"
        return known
    paths = sorted(p for p in listed.split("\0") if p.endswith((".yml", ".yaml")))
    texts = {path: _show(root, commit, path) for path in paths}
    scripts, groups = _hooks(root, commit, known)
    for path in paths:
        data = _parse(texts[path])
        if data is None:
            known.problems.append(f"{path} at {ref} could not be read as a workflow")
            continue
        if _only_called(data):
            continue  # a reusable workflow: its jobs are read where a workflow calls it
        reader = _Reader(path.rsplit("/", 1)[-1], texts, scripts, groups, known)
        known.jobs.extend(reader.jobs(data))
    return known


def _parse(text: str | None) -> dict | None:
    if text is None:
        return None
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError:
        return None
    return data if isinstance(data, dict) and isinstance(data.get("jobs"), dict) else None


def _only_called(data: dict) -> bool:
    """Whether a workflow runs only when another calls it (PyYAML reads `on` as True)."""
    triggers = data.get("on", data.get(True))
    if isinstance(triggers, str):
        names = {triggers}
    elif isinstance(triggers, (list, dict)):
        names = {str(name) for name in triggers}
    else:
        return False
    return names == {"workflow_call"}


def _hooks(root: Path, commit: str, known: Known) -> tuple[dict[str, str], dict[str, tuple]]:
    """The root package.json's scripts and each hook group's commands, at the commit."""
    scripts: dict[str, str] = {}
    text = _show(root, commit, "package.json")
    if text is not None:
        try:
            found = json.loads(text).get("scripts")
        except (ValueError, AttributeError):
            found = None
            known.problems.append("package.json could not be read")
        if isinstance(found, dict):
            scripts = {str(k): v for k, v in found.items() if isinstance(v, str)}
    groups: dict[str, tuple] = {}
    for name in LEFTHOOK_FILES:
        text = _show(root, commit, name)
        if text is None:
            continue
        try:
            data = yaml.safe_load(text)
        except yaml.YAMLError:
            known.problems.append(f"{name} could not be read")
            break
        for group, spec in (data or {}).items() if isinstance(data, dict) else []:
            commands = _group_commands(spec)
            if commands:
                groups[str(group)] = commands
        break
    return scripts, groups


def _group_commands(spec: object) -> tuple[str, ...]:
    if not isinstance(spec, dict):
        return ()
    names: list[str] = []
    for key in ("commands", "scripts"):
        if isinstance(spec.get(key), dict):
            names.extend(str(name) for name in spec[key])
    if isinstance(spec.get("jobs"), list):
        names.extend(
            str(job["name"]) for job in spec["jobs"] if isinstance(job, dict) and job.get("name")
        )
    return tuple(sorted(set(names)))


# ── Jobs and their legs ─────────────────────────────────────────────────────


def _text(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return "" if value is None else str(value)


def expand(matrix: object) -> list[dict] | None:
    """A matrix's legs as GitHub makes them, or None when the file cannot tell (an expression
    decides it). The product of its lists, less `exclude`, then each `include` added to every
    leg whose own values it keeps, or as a leg of its own where it fits none."""
    if not isinstance(matrix, dict):
        return None
    keys = [key for key in matrix if key not in ("include", "exclude")]
    values = []
    for key in keys:
        listed = matrix[key]
        if not isinstance(listed, list) or any(_dynamic(item) for item in listed):
            return None
        values.append(listed)
    legs = [dict(zip(keys, chosen, strict=True)) for chosen in itertools.product(*values)]
    if not keys:
        legs = []
    exclude, include = matrix.get("exclude", []), matrix.get("include", [])
    if not isinstance(exclude, list) or not isinstance(include, list):
        return None
    for entry in exclude:
        if not isinstance(entry, dict):
            return None
        legs = [leg for leg in legs if not all(leg.get(k) == v for k, v in entry.items())]
    own = [dict(leg) for leg in legs]  # each leg's values from the lists, which none overwrites
    for entry in include:
        if not isinstance(entry, dict) or any(_dynamic(v) for v in entry.values()):
            return None
        fitted = False
        for leg, values_of in zip(legs, own, strict=True):
            if all(values_of[k] == v for k, v in entry.items() if k in values_of):
                leg.update({k: v for k, v in entry.items() if k not in values_of})
                fitted = True
        if not fitted:
            legs.append(dict(entry))
            own.append(dict(entry))
    return legs


def _dynamic(value: object) -> bool:
    return isinstance(value, str) and "${{" in value or isinstance(value, (dict, list))


def _values_of(combo: dict):  # noqa: ANN202 - a re.sub replacement
    def value(match: re.Match[str]) -> str:
        return _text(combo.get(match.group(1), match.group(0)))

    return value


def _pattern(template: str, appended: bool) -> re.Pattern[str]:
    """What the names of a job's legs look like when the file cannot give them."""
    parts = _EXPRESSION.split(template)
    body = ".+".join(re.escape(part) for part in parts)
    # appended values are required: a job skipped before its matrix was expanded is listed under
    # its name as written, which is not a leg
    return re.compile(body + (r" \(.+\)" if appended else ""))


def legs(job_id: str, spec: dict) -> tuple[str, list[str], re.Pattern[str] | None]:
    """A job's name as written, its legs' names, and for legs the file cannot tell, a pattern."""
    template = spec.get("name") if isinstance(spec.get("name"), str) else job_id
    assert isinstance(template, str)
    strategy = spec.get("strategy") if isinstance(spec.get("strategy"), dict) else {}
    matrix = strategy.get("matrix") if isinstance(strategy, dict) else None
    carries = bool(_MATRIX_VALUE.search(template))
    if matrix is None:
        if "${{" in template:
            return template, [], _pattern(template, appended=False)
        return template, [template], None
    combos = expand(matrix)
    if combos is None:
        return template, [], _pattern(template, appended=not carries)
    names = []
    for combo in combos:
        if carries or "${{" in template:
            name = _MATRIX_VALUE.sub(_values_of(combo), template)
            if "${{" in name:
                return template, [], _pattern(template, appended=False)
        else:
            name = (
                f"{template} ({', '.join(_text(v) for v in combo.values())})" if combo else template
            )
        names.append(name)
    return template, names, None


def _combos(spec: dict) -> list[dict] | None:
    strategy = spec.get("strategy") if isinstance(spec.get("strategy"), dict) else {}
    matrix = strategy.get("matrix") if isinstance(strategy, dict) else None
    return expand(matrix) if matrix is not None else None


def _leg_step(step: Step, combo: dict) -> Step:
    values = _values_of(combo)
    return Step(
        _MATRIX_VALUE.sub(values, step.label), _MATRIX_VALUE.sub(values, step.shown),
        step.group, step.commands,
    )  # fmt: skip


class _Reader:
    """One workflow file's jobs, with those of the workflows it calls."""

    def __init__(  # noqa: PLR0913 - what a file's jobs are read against
        self, file: str, texts: dict[str, str | None], scripts: dict[str, str],
        groups: dict[str, tuple], known: Known,
    ) -> None:  # fmt: skip
        self.file, self.texts, self.scripts, self.groups = file, texts, scripts, groups
        self.known = known

    def jobs(self, data: dict, prefix: str = "", depth: int = 0) -> list[Job]:
        found: list[Job] = []
        for job_id, spec in data["jobs"].items():
            if not isinstance(spec, dict):
                continue
            template, names, pattern = legs(str(job_id), spec)
            uses = spec.get("uses")
            if isinstance(uses, str):
                found.extend(self._called(uses, template, names, pattern, prefix, depth))
                continue
            defaults = spec.get("defaults") if isinstance(spec.get("defaults"), dict) else {}
            run = defaults.get("run") if isinstance(defaults, dict) else None
            folder = run.get("working-directory") if isinstance(run, dict) else None
            steps = [
                step
                for item in spec.get("steps") or []
                if isinstance(item, dict) and (step := self._step(item, folder)) is not None
            ]
            combos = _combos(spec) if pattern is None else None
            if combos and len(combos) == len(names) and any("${{" in s.label for s in steps):
                # step names that carry matrix values: one job for each leg, its steps named
                for name, combo in zip(names, combos, strict=True):
                    found.append(Job(self.file, prefix + template, [prefix + name],
                                     [_leg_step(step, combo) for step in steps]))  # fmt: skip
                continue
            found.append(
                Job(
                    file=self.file,
                    template=prefix + template,
                    legs=[prefix + name for name in names],
                    steps=steps,
                    pattern=re.compile(re.escape(prefix) + pattern.pattern) if pattern else None,
                )
            )
        return found

    def _called(  # noqa: PLR0913 - the caller's names
        self, uses: str, template: str, names: list[str], pattern: re.Pattern[str] | None,
        prefix: str, depth: int,
    ) -> list[Job]:  # fmt: skip
        path = uses.removeprefix("./").split("@", 1)[0]
        data = _parse(self.texts.get(path)) if path.startswith(WORKFLOWS) else None
        if data is None or depth >= 2 or pattern is not None or len(names) != 1:  # noqa: PLR2004
            if path.startswith(WORKFLOWS) and data is None:
                self.known.problems.append(f"{path}, which {self.file} calls, could not be read")
            return []
        return self.jobs(data, prefix=f"{prefix}{names[0]}{SEPARATOR}", depth=depth + 1)

    def _step(self, item: dict, folder: object) -> Step | None:
        name, run, uses = item.get("name"), item.get("run"), item.get("uses")
        command = run if isinstance(run, str) else uses if isinstance(uses, str) else None
        lines = [line.strip() for line in (command or "").splitlines() if line.strip()]
        first = lines[0] if lines else None
        if isinstance(name, str) and name.strip():
            label = shown = name.strip()
        elif first is not None:
            label, shown = first, f"Run {first}"
        else:
            return None
        where = item.get("working-directory", folder)
        if not isinstance(run, str) or where not in (None, ".", "./"):
            return Step(label, shown)
        group = self._group(run)
        if group is None or group not in self.groups:
            return Step(label, shown)
        return Step(label, shown, group, self.groups[group])

    def _group(self, command: str, depth: int = 0) -> str | None:
        found = _LEFTHOOK.search(command)
        if found:
            return found.group(1)
        if depth >= _DEPTH:
            return None
        for line in command.splitlines():
            script = _SCRIPT.match(line.strip())
            if script and script.group(1) in self.scripts:
                group = self._group(self.scripts[script.group(1)], depth + 1)
                if group:
                    return group
        return None
