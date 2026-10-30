"""Headless, local-only Health audit contract. Audits never write artifacts."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Literal

from . import checks

Status = Literal["passed", "failed", "warn", "skipped", "disabled", "unavailable", "error"]
Severity = Literal["required", "advisory"]
STATUSES = ("passed", "failed", "warn", "skipped", "disabled", "unavailable", "error")
SEVERITIES = ("required", "advisory")
VERDICTS = ("passed", "not_passed", "no_required_checks")
# Remediation is not implemented; a policy may only declare that it is off.
REMEDIATION_POLICIES = ("none",)
# The report contract this version emits; earlier report schemas stay readable.
SCHEMA_VERSION = "1.1"
REPORT_SCHEMA_VERSIONS = ("1.0", "1.1")
# Caller-owned policy and targets files have their own, separate version.
CONFIG_SCHEMA_VERSION = "1.0"
GENERATOR = {"name": "lushly-health", "version": "0.1.0"}
_IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._-]*")


@dataclass(frozen=True)
class Target:
    """One explicitly selected local directory. Health never discovers targets."""

    id: str
    path: Path
    language: str

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not _IDENTIFIER.fullmatch(self.id):
            raise ValueError("Target id must be a stable, nonempty identifier")
        if not isinstance(self.language, str) or not _IDENTIFIER.fullmatch(self.language):
            raise ValueError("Target language must be a nonempty identifier")
        object.__setattr__(self, "path", Path(self.path).resolve())


@dataclass(frozen=True)
class Policy:
    """Select named opinionated checks; no universal baseline is assumed."""

    check_ids: tuple[str, ...]
    disabled: frozenset[str] = frozenset()
    severity: Mapping[str, Severity] = field(default_factory=dict)
    remediation: str = "none"

    def __post_init__(self) -> None:
        object.__setattr__(self, "check_ids", tuple(self.check_ids))
        object.__setattr__(self, "disabled", frozenset(self.disabled))
        if len(set(self.check_ids)) != len(self.check_ids):
            raise ValueError("Duplicate check ids are not allowed")
        if set(self.check_ids) - set(CHECKS):
            raise ValueError("Unknown check id; inspect capabilities()")
        if self.disabled - set(self.check_ids):
            raise ValueError("Disabled checks must be selected checks")
        severity = dict(self.severity)
        if set(severity) - set(self.check_ids):
            raise ValueError("Severity may only be set for selected checks")
        if set(severity.values()) - set(SEVERITIES):
            raise ValueError("Severity must be required or advisory")
        object.__setattr__(self, "severity", MappingProxyType(severity))
        if self.remediation not in REMEDIATION_POLICIES:
            raise ValueError("No remediation is implemented; remediation must be none")

    def severity_of(self, check_id: str) -> Severity:
        return self.severity.get(check_id, "required")

    def describe(self) -> dict:
        return {
            "check_ids": list(self.check_ids),
            "disabled": sorted(self.disabled),
            "severity": {key: self.severity_of(key) for key in self.check_ids},
            "remediation": self.remediation,
        }


@dataclass(frozen=True)
class CheckSpec:
    run: Callable[[Path, str], dict]
    languages: frozenset[str] | None = None
    tools: tuple[str, ...] = ()
    evidence_paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class Outcome:
    check_id: str
    target: str
    status: Status
    severity: Severity
    message: str
    evidence: dict = field(default_factory=dict)
    remediation: str | None = None
    schema_version: str = SCHEMA_VERSION


def _last_commit(path: Path, language: str) -> dict:
    # Adapted from the source's read-only git metric: bounded execution and no age policy.
    if not (path / ".git").exists():
        # Never report an enclosing repository's history for a nested directory.
        return {
            "status": "unavailable",
            "message": "Target is not the root of a Git checkout",
            "suggestion": "Select the checkout root or disable this check",
        }
    result = subprocess.run(
        ["git", "--no-optional-locks", "log", "-1", "--format=%ct"],
        cwd=path,
        # Inherited GIT_* routing (for example from a hook) could select another repository.
        env={key: value for key, value in os.environ.items() if not key.startswith("GIT_")},
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    if result.returncode or not result.stdout.strip():
        return {
            "status": "unavailable",
            "message": "No commit timestamp available",
            "suggestion": "Use a Git checkout with at least one commit",
        }
    timestamp = int(result.stdout.strip())
    return {
        "status": "pass",
        "message": "Latest checkout commit timestamp observed",
        "metric": str(timestamp),
    }


def _node_alignment(path: Path, language: str) -> dict:
    """Keep the source major-alignment check while exposing unsupported inputs."""
    package = path / "package.json"
    if package.exists():
        manifest = json.loads(package.read_text())
        engine = manifest.get("engines", {}).get("node")
        if engine is not None and (
            not isinstance(engine, str) or not re.fullmatch(r">=\d+(?:\.\d+){0,2}", engine.strip())
        ):
            return {
                "status": "warn",
                "message": "Node engine range exceeds the major-floor heuristic",
                "suggestion": "Evaluate this engine range with a semver-aware tool",
            }
    for name in (".nvmrc", ".node-version"):
        version = path / name
        if version.exists() and not re.fullmatch(
            r"v?\d+(?:\.\d+){0,2}", version.read_text().strip()
        ):
            return {
                "status": "warn",
                "message": "Node version declaration is not a literal version",
                "suggestion": "Resolve the declaration to a concrete Node major before comparison",
            }
    workflows = path / ".github/workflows"
    if workflows.is_dir():
        for workflow in (*workflows.glob("*.yml"), *workflows.glob("*.yaml")):
            content = workflow.read_text()
            for raw in re.findall(r"^\s*node-version:\s*(.+)$", content, re.MULTILINE):
                if "${{" in raw:
                    if not checks._resolve_workflow_version_reference(content, raw):
                        return {
                            "status": "warn",
                            "message": "CI Node expression could not be resolved",
                            "suggestion": "Resolve the CI expression before comparing Node majors",
                        }
                elif not re.fullmatch(r"[\"']?v?\d+(?:\.(?:\d+|x)){0,2}[\"']?", raw.strip()):
                    return {
                        "status": "warn",
                        "message": "CI Node declaration exceeds the literal heuristic",
                        "suggestion": "Resolve the CI declaration before comparing Node majors",
                    }
    return checks.check_node_version_alignment(path, language)


CHECKS: dict[str, CheckSpec] = {
    "node_version_alignment": CheckSpec(
        _node_alignment,
        frozenset({"typescript"}),
        evidence_paths=(".nvmrc", ".node-version", "package.json", ".github/workflows"),
    ),
    "codex_skills_mirror": CheckSpec(
        checks.check_codex_skills_mirror, evidence_paths=(".claude/skills", ".codex/skills")
    ),
    "lefthook_configured": CheckSpec(
        checks.check_lefthook_configured, evidence_paths=("lefthook.yml",)
    ),
    "linter_strict": CheckSpec(
        checks.check_linter_strict,
        frozenset({"typescript", "python"}),
        evidence_paths=("biome.json", "pyproject.toml"),
    ),
    "ci_present": CheckSpec(checks.check_ci_present, evidence_paths=(".github/workflows",)),
    "dependabot_configured": CheckSpec(
        checks.check_dependabot_configured, evidence_paths=(".github/dependabot.yml",)
    ),
    "commitlint_configured": CheckSpec(
        checks.check_commitlint_configured,
        frozenset({"typescript"}),
        evidence_paths=("commitlint.config.mjs", "commitlint.config.js"),
    ),
    "coverage_thresholds": CheckSpec(
        checks.check_coverage_thresholds,
        frozenset({"typescript", "python"}),
        evidence_paths=("vitest.config.ts", "packages/*/vitest.config.ts", "botcore.toml"),
    ),
    "dead_code_tool": CheckSpec(
        checks.check_dead_code_tool,
        frozenset({"typescript", "python"}),
        evidence_paths=("package.json", "pyproject.toml"),
    ),
    "gitattributes_lf": CheckSpec(
        checks.check_gitattributes_lf, evidence_paths=(".gitattributes",)
    ),
    "changesets_configured": CheckSpec(
        checks.check_changesets_configured, evidence_paths=(".changeset", "package.json")
    ),
    "last_commit": CheckSpec(_last_commit, tools=("git",), evidence_paths=(".git",)),
}


def capabilities() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "generator": dict(GENERATOR),
        "config_schema_version": CONFIG_SCHEMA_VERSION,
        "statuses": list(STATUSES),
        "severities": list(SEVERITIES),
        "verdicts": list(VERDICTS),
        "remediation_policies": list(REMEDIATION_POLICIES),
        "checks": [
            {
                "check_id": key,
                "languages": sorted(spec.languages) if spec.languages else None,
                "required_tools": list(spec.tools),
                "effects": ["target_read", "subprocess"] if spec.tools else ["target_read"],
                "network": False,
            }
            for key, spec in CHECKS.items()
        ],
        "commands": {
            "audit": {"effects": ["target_read"], "subprocess_when_selected": ["last_commit"]},
            "write_report": {"effects": ["artifact_write"], "explicit_scope_required": True},
            "onboard": {"effects": ["artifact_write"], "explicit_scope_required": True},
        },
    }


def _target_issue(path: Path) -> str | None:
    return None if path.is_dir() else "Target directory is unavailable"


def _escapes(root: Path, candidate: Path) -> bool:
    return (
        candidate.exists() or candidate.is_symlink()
    ) and not candidate.resolve().is_relative_to(root)


def _boundary_issue(root: Path, spec: CheckSpec) -> str | None:
    """Refuse a check whose declared inputs resolve outside the selected target.

    Only the inputs a check reads are inspected, so unrelated links (for example a
    local virtual environment's interpreter) do not affect it. Git metadata is
    read by git itself and only its top-level entry is inspected.
    """
    for declared in spec.evidence_paths:
        candidates = list(root.glob(declared)) if "*" in declared else [root / declared]
        for candidate in candidates:
            if _escapes(root, candidate):
                return "A declared input resolves outside the selected target"
            # A directory input may itself be an internal link; inspect what it resolves to.
            if (
                declared != ".git"
                and candidate.is_dir()
                and any(_escapes(root, entry) for entry in candidate.resolve().rglob("*"))
            ):
                return "A declared input resolves outside the selected target"
    return None


def _evaluate(target: Target, check_id: str, spec: CheckSpec, policy: Policy, issue):
    evidence = {
        "paths": list(spec.evidence_paths),
        "required_tools": list(spec.tools),
        "kind": "local_configuration_heuristic",
    }
    remediation = None
    if check_id in policy.disabled:
        return "disabled", "Explicitly disabled by selected policy", evidence, None
    try:
        boundary = issue or _boundary_issue(target.path, spec)
    except (OSError, RuntimeError):
        boundary = "Target boundary could not be inspected"
    if boundary:
        remediation = "Provide an accessible target with configuration confined to its root"
        return "unavailable", boundary, evidence, remediation
    if spec.languages and target.language not in spec.languages:
        return "skipped", "Check does not apply to the selected language", evidence, None
    if any(shutil.which(tool) is None for tool in spec.tools):
        remediation = "Install the declared tool or disable this check explicitly"
        return "unavailable", "A declared required tool is unavailable", evidence, remediation
    try:
        result = spec.run(target.path, target.language)
        status = {"pass": "passed", "fail": "failed"}.get(result["status"], result["status"])
        if status not in STATUSES:
            raise ValueError("Invalid check outcome")
        if result.get("metric") is not None:
            evidence["metric"] = str(result["metric"])
        return status, result["message"], evidence, result.get("suggestion")
    except FileNotFoundError:
        remediation = "Restore the declared input and rerun the audit"
        return (
            "unavailable",
            "A required input or tool disappeared during audit",
            evidence,
            (remediation),
        )
    except subprocess.TimeoutExpired:
        remediation = "Check the declared tool and rerun the audit"
        return "unavailable", "Required tool exceeded the audit timeout", evidence, remediation
    except Exception as exc:
        evidence["error_type"] = type(exc).__name__
        remediation = "Validate configuration syntax and inspect the check implementation"
        return "error", "Check could not complete", evidence, remediation


def aggregate_verdict(outcomes: list[dict]) -> dict:
    """Overall result under the platform's aggregate rule.

    A report passes only when it has at least one counted required check and every
    counted required check passed. Required checks disabled by policy are not counted;
    any other non-passing required status (including ``skipped``) blocks a pass.
    Advisory results never affect the verdict.
    """
    counted = [o for o in outcomes if o["severity"] == "required" and o["status"] != "disabled"]
    blocking = sum(o["status"] != "passed" for o in counted)
    status = "no_required_checks" if not counted else "not_passed" if blocking else "passed"
    return {"status": status, "required_count": len(counted), "blocking_count": blocking}


def _timestamp(moment: datetime | None) -> str:
    moment = datetime.now(UTC) if moment is None else moment
    if moment.tzinfo is None:
        raise ValueError("generated_at must be timezone-aware")
    return moment.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def audit(
    targets: tuple[Target, ...], policy: Policy, *, generated_at: datetime | None = None
) -> dict:
    """Read the explicitly selected targets and return a versioned report (no writes).

    ``generated_at`` defaults to now; pass a fixed time for reproducible output.
    """
    targets = tuple(targets)
    timestamp = _timestamp(generated_at)
    if len({t.id for t in targets}) != len(targets):
        raise ValueError("Target ids must be unique")
    outcomes = []
    for target in targets:
        issue = _target_issue(target.path)
        for check_id in policy.check_ids:
            status, message, evidence, remediation = _evaluate(
                target, check_id, CHECKS[check_id], policy, issue
            )
            outcome = Outcome(
                check_id,
                target.id,
                status,
                policy.severity_of(check_id),
                message,
                evidence,
                remediation,
            )
            outcomes.append(asdict(outcome))
    counts = Counter(item["status"] for item in outcomes)
    return {
        "schema_version": SCHEMA_VERSION,
        "generator": dict(GENERATOR),
        "generated_at": timestamp,
        "targets": [{"id": t.id, "path": str(t.path), "language": t.language} for t in targets],
        "policy": policy.describe(),
        "outcomes": outcomes,
        "summary": {status: counts[status] for status in STATUSES},
        "verdict": aggregate_verdict(outcomes),
        "effects": ["target_read"],
        "artifacts_written": [],
    }


@dataclass(frozen=True)
class ArtifactScope:
    """An explicit output directory; it must lie outside every audited target."""

    root: Path

    def __post_init__(self) -> None:
        object.__setattr__(self, "root", Path(self.root).resolve())


def _write_artifact(data: dict, scope: ArtifactScope, name: str, targets: tuple[Path, ...]) -> dict:
    """Write one JSON artifact; the receipt names the version of what was written."""
    if Path(name).name != name or name in ("", ".", ".."):
        raise ValueError("Artifact name must be a single filename")
    if any(scope.root.is_relative_to(path.resolve()) for path in targets):
        raise ValueError("Artifact scope must be outside audited targets")
    scope.root.mkdir(parents=True, exist_ok=True)
    destination = scope.root / name
    # Exclusive create prevents overwrites and preexisting file symlink escapes.
    with destination.open("x", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")
    return {
        "schema_version": data["schema_version"],
        "effects": ["artifact_write"],
        "artifacts_written": [str(destination)],
    }


def write_report(report: dict, scope: ArtifactScope, name: str = "health-report.json") -> dict:
    """Write an already computed audit; never implicitly rerun checks or open a browser."""
    if report.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported audit schema version")
    return _write_artifact(report, scope, name, tuple(Path(t["path"]) for t in report["targets"]))


def onboard(
    target: Target,
    scope: ArtifactScope,
    *,
    selected: bool = False,
    name: str = "health-targets.json",
) -> dict:
    """Explicitly save one selected target declaration outside the target itself.

    The file uses the targets format that load_targets() reads; it is the caller's
    own inventory and never part of the distributed package.
    """
    if not selected:
        raise ValueError("Onboarding requires explicit selection")
    if not target.path.is_dir() or not (target.path / ".git").exists():
        raise ValueError("Onboarding requires an existing Git repository")
    return _write_artifact(
        {
            "schema_version": CONFIG_SCHEMA_VERSION,
            "targets": [{"id": target.id, "path": str(target.path), "language": target.language}],
        },
        scope,
        name,
        (target.path,),
    )
