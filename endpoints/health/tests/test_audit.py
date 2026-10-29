"""Audit behavior on disposable fixtures that have no AFD, Botcore or Health dependency."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from botcore_health import ArtifactScope, Policy, Target, audit, capabilities, onboard, write_report
from botcore_health.core import CHECKS, STATUSES, CheckSpec


class HealthFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "unrelated-project"
        self.repo.mkdir()
        self.target = Target("sample-project", self.repo, "typescript")

    def write(self, relative, content):
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def run_check(self, check_id):
        return audit((self.target,), Policy((check_id,)))["outcomes"][0]

    def snapshot(self):
        return {
            str(p.relative_to(self.repo)): p.read_bytes()
            for p in self.repo.rglob("*")
            if p.is_file()
        }

    def test_unrelated_repository_without_author_inventory_or_afd_dependency(self):
        self.write(
            "package.json", '{"name":"sample-project","private":true,"engines":{"node":">=22"}}'
        )
        self.write(".nvmrc", "24\n")
        self.write(".gitattributes", "* text=auto eol=lf\n")
        before = self.snapshot()
        with patch("socket.socket", side_effect=AssertionError("Audit must not use network")):
            report = audit((self.target,), Policy(("node_version_alignment", "gitattributes_lf")))
        self.assertEqual(report["summary"]["passed"], 2)
        self.assertEqual(report["summary"]["skipped"], 0)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(report["artifacts_written"], [])
        self.assertEqual(set(report["summary"]), set(STATUSES))
        self.assertTrue(all(o["schema_version"] == "1.0" for o in report["outcomes"]))
        self.assertEqual(report["outcomes"][0]["target"], "sample-project")

    def test_missing_version_is_failure_with_remediation(self):
        result = self.run_check("node_version_alignment")
        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["remediation"])
        self.assertIn(".nvmrc", result["evidence"]["paths"])

    def test_disagreeing_local_versions(self):
        self.write(".nvmrc", "24\n")
        self.write(".node-version", "22\n")
        self.assertEqual(self.run_check("node_version_alignment")["status"], "failed")

    def test_engine_floor(self):
        self.write(".nvmrc", "22\n")
        self.write("package.json", '{"engines":{"node":">=24.0.0"}}')
        self.assertEqual(self.run_check("node_version_alignment")["status"], "failed")

    def test_unknown_node_inputs_are_not_passed(self):
        self.write(".nvmrc", "24\n")
        self.write("package.json", '{"engines":{"node":"<24"}}')
        self.assertEqual(self.run_check("node_version_alignment")["status"], "warn")
        self.write("package.json", '{"engines":{"node":">=22"}}')
        self.write(".github/workflows/ci.yml", "node-version: ${{ inputs.node }}\n")
        self.assertEqual(self.run_check("node_version_alignment")["status"], "warn")
        self.write("package.json", "{")
        self.assertEqual(self.run_check("node_version_alignment")["status"], "error")

    def test_ci_mismatch(self):
        self.write(".nvmrc", "22\n")
        self.write(".github/workflows/ci.yml", "node-version: 24\n")
        self.assertEqual(self.run_check("node_version_alignment")["status"], "failed")

    def test_ci_matrix_and_env(self):
        self.write(".nvmrc", "24\n")
        self.write(
            ".github/workflows/ci.yml",
            "matrix:\n  node: [22.x, 24.x]\nnode-version: ${{ matrix.node }}\n",
        )
        self.assertEqual(self.run_check("node_version_alignment")["status"], "passed")
        self.write(
            ".github/workflows/ci.yml",
            "env:\n  NODE_VERSION: '24'\nnode-version: ${{ env.NODE_VERSION }}\n",
        )
        self.assertEqual(self.run_check("node_version_alignment")["status"], "passed")

    def test_live_skill_mirror(self):
        self.write(".claude/skills/shared/SKILL.md", "# Shared\n")
        (self.repo / ".codex").mkdir()
        (self.repo / ".codex/skills").symlink_to("../.claude/skills")
        self.assertEqual(self.run_check("codex_skills_mirror")["status"], "passed")

    def test_missing_and_divergent_mirror(self):
        self.write(".claude/skills/shared/SKILL.md", "# Shared\n")
        self.assertEqual(self.run_check("codex_skills_mirror")["status"], "failed")
        self.write(".codex/skills/shared/SKILL.md", "# Different\n")
        result = self.run_check("codex_skills_mirror")
        self.assertEqual(result["status"], "failed")
        self.assertIn("Divergent", result["message"])

    def test_declared_input_outside_the_target_is_unavailable(self):
        outside = self.root / "outside.txt"
        outside.write_text("24\n")
        (self.repo / ".nvmrc").symlink_to(outside)
        result = self.run_check("node_version_alignment")
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("outside the selected target", result["message"])

    def test_linked_directory_contents_outside_the_target_are_unavailable(self):
        self.write(".gitattributes", "* text=auto eol=lf\n")
        (self.root / "shared-workflows").mkdir()
        (self.repo / ".github").mkdir()
        (self.repo / ".github/workflows").symlink_to(self.root / "shared-workflows")
        self.assertEqual(self.run_check("ci_present")["status"], "unavailable")
        internal = self.repo / "ci"
        (internal / "nested").mkdir(parents=True)
        (internal / "nested/escape.yml").symlink_to(self.root / "shared-workflows")
        (self.repo / ".github/workflows").unlink()
        (self.repo / ".github/workflows").symlink_to(internal)
        self.assertEqual(self.run_check("ci_present")["status"], "unavailable")
        # Unrelated inputs are unaffected by the link.
        self.assertEqual(self.run_check("gitattributes_lf")["status"], "passed")

    def test_unrelated_external_links_do_not_block_checks(self):
        self.write(".nvmrc", "24\n")
        (self.repo / ".venv/bin").mkdir(parents=True)
        (self.repo / ".venv/bin/python").symlink_to(self.root)
        self.assertEqual(self.run_check("node_version_alignment")["status"], "passed")

    def test_git_metric_never_reads_an_enclosing_repository(self):
        with patch("botcore_health.core.subprocess.run") as run:
            result = self.run_check("last_commit")
        self.assertEqual(result["status"], "unavailable")
        run.assert_not_called()

    def test_disabled_and_language_inapplicable_are_skipped(self):
        disabled = audit(
            (self.target,),
            Policy(("node_version_alignment",), frozenset({"node_version_alignment"})),
        )
        self.assertEqual(disabled["summary"]["skipped"], 1)
        other = Target("other", self.repo, "rust")
        self.assertEqual(
            audit((other,), Policy(("node_version_alignment",)))["summary"]["skipped"], 1
        )

    def test_missing_target_and_tool_are_unavailable(self):
        missing = Target("missing", self.root / "missing", "typescript")
        self.assertEqual(audit((missing,), Policy(("ci_present",)))["summary"]["unavailable"], 1)
        with patch("botcore_health.core.shutil.which", return_value=None):
            self.assertEqual(self.run_check("last_commit")["status"], "unavailable")

    @patch.dict("os.environ", {"GIT_DIR": "elsewhere"})
    def test_git_metric_is_bounded_and_read_only(self):
        (self.repo / ".git").mkdir()
        completed = subprocess.CompletedProcess([], 0, "12345\n", "")
        with (
            patch("botcore_health.core.shutil.which", return_value="/tool/git"),
            patch("botcore_health.core.subprocess.run", return_value=completed) as run,
        ):
            result = self.run_check("last_commit")
        self.assertEqual(result["evidence"]["metric"], "12345")
        self.assertEqual(run.call_args.kwargs["timeout"], 5)
        self.assertEqual(run.call_args.args[0][1], "--no-optional-locks")
        self.assertFalse(any(key.startswith("GIT_") for key in run.call_args.kwargs["env"]))

    @unittest.skipUnless(__import__("shutil").which("git"), "Git is unavailable")
    def test_real_git_checkout_fixture_without_target_mutation(self):
        commands = [
            ["git", "init", "--quiet"],
            [
                "git",
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--quiet",
                "--allow-empty",
                "-m",
                "fixture",
            ],
        ]
        for command in commands:
            subprocess.run(command, cwd=self.repo, check=True, capture_output=True)
        before = self.snapshot()
        result = self.run_check("last_commit")
        self.assertEqual(result["status"], "passed")
        self.assertTrue(result["evidence"]["metric"].isdigit())
        self.assertEqual(self.snapshot(), before)

    def test_git_timeout_does_not_become_zero_or_pass(self):
        (self.repo / ".git").mkdir()
        with (
            patch("botcore_health.core.shutil.which", return_value="/tool/git"),
            patch(
                "botcore_health.core.subprocess.run",
                side_effect=subprocess.TimeoutExpired("git", 5),
            ),
        ):
            self.assertEqual(self.run_check("last_commit")["status"], "unavailable")

    def test_check_exception_is_redacted_error(self):
        def broken(*args):
            raise RuntimeError("potentially sensitive diagnostic")

        with patch.dict(CHECKS, {"ci_present": CheckSpec(broken)}):
            result = self.run_check("ci_present")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["evidence"]["error_type"], "RuntimeError")
        self.assertNotIn("sensitive", json.dumps(result))

    def test_existing_partial_policy_warning(self):
        self.write(".changeset/config.json", "{}")
        self.assertEqual(self.run_check("changesets_configured")["status"], "warn")

    def test_policy_validation(self):
        for ids, disabled in [
            (("unknown",), frozenset()),
            (("ci_present", "ci_present"), frozenset()),
            ((), frozenset({"ci_present"})),
        ]:
            with self.assertRaises(ValueError):
                Policy(ids, disabled)
        with self.assertRaises(ValueError):
            audit((self.target, self.target), Policy(()))

    def test_all_local_checks_on_disposable_fixture_do_not_mutate(self):
        self.write("package.json", '{"private":true}')
        before = self.snapshot()
        selected = tuple(key for key in CHECKS if key != "last_commit")
        report = audit((self.target,), Policy(selected))
        self.assertEqual(len(report["outcomes"]), 11)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(report["summary"]["error"], 0)

    def test_report_explicit_output_and_no_implicit_rerun(self):
        report = audit((self.target,), Policy(("ci_present",)))
        scope = ArtifactScope(self.root / "artifacts")
        with patch("botcore_health.core.audit", side_effect=AssertionError("No implicit audit")):
            receipt = write_report(report, scope)
        self.assertEqual(receipt["effects"], ["artifact_write"])
        stored = json.loads((scope.root / "health-report.json").read_text())
        self.assertEqual(stored, report)
        with self.assertRaises(FileExistsError):
            write_report(report, scope)
        with self.assertRaises(ValueError):
            write_report(report, ArtifactScope(self.repo / "reports"))
        with self.assertRaises(ValueError):
            write_report(report, scope, "../escape.json")

    def test_onboard_requires_selection_scope_and_existing_git(self):
        scope = ArtifactScope(self.root / "config")
        with self.assertRaises(ValueError):
            onboard(self.target, scope)
        with self.assertRaises(ValueError):
            onboard(self.target, scope, selected=True)
        (self.repo / ".git").mkdir()
        before = self.snapshot()
        receipt = onboard(self.target, scope, selected=True)
        self.assertEqual(len(receipt["artifacts_written"]), 1)
        self.assertEqual(self.snapshot(), before)
        with self.assertRaises(ValueError):
            onboard(self.target, ArtifactScope(self.repo), selected=True)

    def test_capabilities_declare_effects_and_tools(self):
        declared = capabilities()
        git = next(c for c in declared["checks"] if c["check_id"] == "last_commit")
        self.assertEqual(git["required_tools"], ["git"])
        self.assertEqual(git["effects"], ["target_read", "subprocess"])
        self.assertTrue(all(not c["network"] for c in declared["checks"]))
        self.assertEqual(declared["commands"]["audit"]["effects"], ["target_read"])
        self.assertEqual(declared["statuses"], list(STATUSES))
        self.assertEqual({c["check_id"] for c in declared["checks"]}, set(CHECKS))

    def test_severity_is_policy_driven_and_reported(self):
        policy = Policy(("ci_present", "gitattributes_lf"), severity={"ci_present": "advisory"})
        outcomes = audit((self.target,), policy)["outcomes"]
        self.assertEqual([o["severity"] for o in outcomes], ["advisory", "required"])
        self.assertEqual(
            audit((self.target,), policy)["policy"]["severity"]["gitattributes_lf"], "required"
        )
        for severity, remediation in [
            ({"ci_present": "blocker"}, "none"),
            ({"dependabot_configured": "advisory"}, "none"),
            ({}, "apply"),
        ]:
            with self.assertRaises(ValueError):
                Policy(("ci_present",), severity=severity, remediation=remediation)

    def test_every_status_is_distinguishable(self):
        self.write(".nvmrc", "24\n")
        self.write(".gitattributes", "* text=auto eol=lf\n")
        self.write(".changeset/config.json", "{}")

        def broken(*args):
            raise RuntimeError("boom")

        rust = Target("rust-app", self.repo, "rust")
        missing = Target("missing", self.root / "missing", "typescript")
        with (
            patch.dict(CHECKS, {"lefthook_configured": CheckSpec(broken)}),
            patch("botcore_health.core.shutil.which", return_value=None),
        ):
            report = audit(
                (self.target, rust, missing),
                Policy(
                    (
                        "gitattributes_lf",
                        "ci_present",
                        "changesets_configured",
                        "commitlint_configured",
                        "lefthook_configured",
                        "last_commit",
                    ),
                    frozenset({"ci_present"}),
                ),
            )
        statuses = {(o["target"], o["check_id"]): o["status"] for o in report["outcomes"]}
        self.assertEqual(statuses["sample-project", "gitattributes_lf"], "passed")
        self.assertEqual(statuses["sample-project", "commitlint_configured"], "failed")
        self.assertEqual(statuses["sample-project", "changesets_configured"], "warn")
        self.assertEqual(statuses["sample-project", "ci_present"], "skipped")
        self.assertEqual(statuses["rust-app", "commitlint_configured"], "skipped")
        self.assertEqual(statuses["sample-project", "last_commit"], "unavailable")
        self.assertEqual(statuses["missing", "gitattributes_lf"], "unavailable")
        self.assertEqual(statuses["sample-project", "lefthook_configured"], "error")
        self.assertTrue(all(report["summary"][status] for status in STATUSES))


if __name__ == "__main__":
    unittest.main()
