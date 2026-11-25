"""The `main` source of gate-outcome-collect and the report by area, against a prepared
repository and recorded GraphQL answers.

Every commit, issue and label here is invented. The repository is `bench-org/beds`; its default
branch is built commit by commit, each landing at a set time, and `Graph` answers the GraphQL
requests the collection makes for the pull requests and issues they close.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

import pytest

from botcore.commands.gate_outcome import gate_outcome_collect as collect_cmd
from botcore.commands.gate_outcome import gate_outcome_report as report_cmd
from botcore.commands.gate_outcome import github, main, record, units
from botcore.commands.gate_outcome.report_areas import is_bug
from tests.test_gate_outcome import CANARY, REPO, Bench, day, ok, refused

ARCHITECTURE = json.dumps({
    "schemaVersion": 1,
    "discoveryRoots": ["packages", "endpoints"],
    "exclude": ["packages/beds/hosted"],
    "quarantine": [{"path": "endpoints/shed/package.json", "reason": "a stub"}],
    "units": [{"manifest": "packages/cpp/CMakeLists.txt"}],
})  # fmt: skip
RUST = """\
pub fn plant(n: u32) -> u32 {
    n + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plants_one() {
        let open = '{';
        let text = "}}}";
        assert_eq!(plant(1), 2, "{open}{text}");
    }
}

pub fn water(n: u32) -> u32 {
    n * 2
}
"""


class Graph:
    """GitHub's GraphQL API for `issueOrPullRequest` and a commit's pull requests."""

    def __init__(self) -> None:
        self.pulls: dict[int, list[int]] = {}  # number -> the issues it closes
        self.issues: dict[int, tuple[str, list[str]]] = {}  # number -> state, labels
        self.merged: dict[str, int] = {}  # a commit -> the pull request it merged
        self.queries: list[str] = []

    def issue(self, number: int) -> dict:
        state, labels = self.issues[number]
        return {"number": number, "state": state.upper(),
                "repository": {"nameWithOwner": REPO},
                "labels": {"nodes": [{"name": label} for label in labels]}}  # fmt: skip

    def pull(self, number: int) -> dict:
        refs = {"nodes": [self.issue(n) for n in self.pulls[number]]}
        return {"__typename": "PullRequest", "number": number, "closingIssuesReferences": refs}

    def answer(self, query: str) -> github.Answer:
        self.queries.append(query)
        nodes: dict = {}
        for alias, number in re.findall(r"(\w+): issueOrPullRequest\(number: (\d+)\)", query):
            n = int(number)
            nodes[alias] = (
                self.pull(n) if n in self.pulls
                else {"__typename": "Issue", **self.issue(n)} if n in self.issues
                else None
            )  # fmt: skip
        for alias, sha in re.findall(r'(\w+): object\(oid: "([0-9a-f]{40})"\)', query):
            found = self.merged.get(sha)
            pulls = [{**self.pull(found), "mergeCommit": {"oid": sha}}] if found else []
            nodes[alias] = {"associatedPullRequests": {"nodes": pulls}}
        return github.Answer(200, {"data": {"repository": nodes}})


class Garden:
    """A Bench whose default branch has commits that land at set times."""

    def __init__(self, bench: Bench) -> None:
        self.bench = bench
        self.graph = Graph()
        self.github = True
        actions = bench.github.call
        self.fetched: list[str] = []

        def call(endpoint: str, query: str | None = None) -> github.Answer:
            if not self.github:
                raise github.ServiceUnavailable("gh is not installed or not on PATH")
            if query is not None:
                return self.graph.answer(query)
            if endpoint == "rate_limit":
                allowance = {"remaining": 5000, "limit": 5000}
                return github.Answer(200, {"resources": {"core": allowance, "graphql": allowance}})
            return actions(endpoint)

        bench.monkeypatch.setattr(github, "call", call)
        bench.monkeypatch.setattr(main, "fetch", lambda _root, branch: self.fetched.append(branch))

    def land(self, message: str, files: dict[str, str | None], when: datetime) -> str:
        checkout = self.bench.checkout
        for name, text in files.items():
            path = checkout / name
            if text is None:
                path.unlink()
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        moment = when.strftime("%Y-%m-%dT%H:%M:%S+0000")
        env = {**os.environ, "GIT_AUTHOR_DATE": moment, "GIT_COMMITTER_DATE": moment}
        git = ["git", "-C", str(checkout), "-c", "user.name=Bench",
               "-c", "user.email=bench@example.invalid", "-c", "commit.gpgsign=false"]  # fmt: skip
        subprocess.run([*git, "add", "-A"], check=True, env=env)
        subprocess.run([*git, "commit", "-q", "--allow-empty", "-F", "-"], input=message,
                       text=True, check=True, env=env)  # fmt: skip
        subprocess.run([*git, "update-ref", "refs/remotes/origin/main", "HEAD"], check=True)
        return subprocess.run(
            [*git, "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        ).stdout.strip()

    def plant(self) -> None:
        """The garden's first commit, before any window: its units and files."""
        self.land("chore: plant the garden", {
            "architecture.json": ARCHITECTURE,
            "packages/beds/package.json": "{}\n",
            "packages/beds/hosted/package.json": "{}\n",
            "packages/beds/node_modules/leaf/package.json": "{}\n",
            "packages/pots/pyproject.toml": "[project]\nname = 'pots'\n",
            "endpoints/shed/package.json": "{}\n",
            "endpoints/shed/tool/Cargo.toml": "[package]\nname = 'tool'\n",
            "packages/cpp/CMakeLists.txt": "project(cpp)\n",
            "packages/cpp/tests/CMakeLists.txt": "add_executable(t)\n",
            "packages/kiln/CMakeLists.txt": "project(kiln VERSION 1.0)\n",
            "packages/beds/src/a.ts": "".join(f"export const a{n} = {n};\n" for n in range(6)),
            "packages/pots/src/lib.rs": RUST,
            "scripts/tool.mjs": "export const tool = 1;\n",
        }, day(40))  # fmt: skip


@pytest.fixture
def bench(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Bench:
    return Bench(tmp_path, monkeypatch)


@pytest.fixture
def garden(bench: Bench) -> Garden:
    found = Garden(bench)
    found.plant()
    return found


def lines(bench: Bench) -> list[dict]:
    text = (bench.folder() / record.RECORD_FILE).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def commit_line(bench: Bench, sha: str) -> dict:
    found = [line for line in lines(bench) if line["id"] == f"commit:{sha}"]
    return found[-1]


def main_source(data: dict) -> dict:
    (found,) = [source for source in data["sources"] if source["source"] == "main"]
    return found


def area_row(data: dict, area: str) -> dict:
    (found,) = [row for row in data["rows"] if row["area"] == area]
    return found


# ── Units and test paths ────────────────────────────────────────────────────


def test_the_units_are_the_repositorys_list_found_as_its_boundary_check_finds_them() -> None:
    files = {
        "architecture.json": ARCHITECTURE,
        "packages/cpp/CMakeLists.txt": "project(cpp)\n",
        "packages/cpp/tests/CMakeLists.txt": "add_executable(t)\n",
        "packages/kiln/CMakeLists.txt": "project(kiln VERSION 1.0)\n",
    }
    paths = [
        *files, "packages/beds/package.json", "packages/beds/hosted/package.json",
        "packages/beds/node_modules/leaf/package.json", "packages/pots/pyproject.toml",
        "endpoints/shed/package.json", "endpoints/shed/tool/Cargo.toml", "docs/package.json",
    ]  # fmt: skip
    found = units.read_units(paths, files.get)
    assert found.source == "architecture.json" and found.problem is None
    assert sorted(found.folders) == [
        "endpoints/shed/tool", "packages/beds", "packages/cpp", "packages/kiln", "packages/pots"
    ]  # fmt: skip
    assert found.of("packages/beds/src/a.ts") == "packages/beds"
    assert found.of("endpoints/shed/tool/src/main.rs") == "endpoints/shed/tool"
    assert found.of("endpoints/shed/src/a.ts") is None  # its manifest is quarantined
    assert found.of("packages/beds/hosted/x.ts") == "packages/beds"  # excluded: the parent's


def test_a_repository_without_the_list_gets_the_nearest_folder_with_a_manifest() -> None:
    found = units.read_units(
        ["package.json", "packages/beds/package.json", "tools/kit/pyproject.toml",
         "tools/kit/node_modules/x/package.json"],
        lambda _path: None,
    )  # fmt: skip
    assert found.source == "manifests"
    assert found.folders == ["packages/beds", "tools/kit"]
    assert found.area(["README.md"]) == ("repository", [])


def test_an_area_is_one_unit_repository_or_several_named_by_most_files() -> None:
    found = units.Units(["packages/beds/inner", "endpoints/shed", "packages/beds"])
    assert found.area(["packages/beds/a.ts", ".changeset/x.md"]) == (
        "packages/beds",
        ["packages/beds"],
    ), "a file no unit owns does not make a commit several"
    assert found.area([".changeset/x.md", "docs/a.md"]) == ("repository", [])
    assert found.area(
        ["endpoints/shed/a.ts", "packages/beds/a.ts", "packages/beds/b.ts",
         "packages/beds/inner/c.ts"]
    ) == ("several", ["packages/beds", "endpoints/shed", "packages/beds/inner"])  # fmt: skip


@pytest.mark.parametrize(
    ("path", "test"),
    [
        ("packages/beds/tests/a.py", True),
        ("packages/beds/test/a.ts", True),
        ("packages/beds/src/__tests__/a.ts", True),
        ("packages/beds/src/a.test.ts", True),
        ("packages/beds/src/a.spec.mjs", True),
        ("docs/02-see.scenario.yaml", True),
        ("python/test_beds.py", True),
        ("python/beds_test.py", True),
        ("packages/cpp/beds_test.cpp", True),
        ("packages/cpp/test_beds.cc", True),
        ("packages/beds/src/testing.ts", False),
        ("packages/beds/src/contest.py", False),
        ("packages/beds/test_data.json", False),
        ("packages/pots/src/lib.rs", False),
    ],
)
def test_a_test_path_by_its_folders_or_its_name(path: str, test: bool) -> None:
    assert units.named_test(path) is test


def test_a_rust_test_module_ends_where_its_braces_close() -> None:
    assert units.rust_test_lines(RUST) == [(5, 15)]
    nested = '#[cfg(all(test, feature = "x"))]\n#[allow(dead_code)]\npub(crate) mod checks {\n  fn a() { /* } */ }\n  // }\n  let r = r#"}"#;\n}\nfn b() {}\n'  # noqa: E501
    assert units.rust_test_lines(nested) == [(1, 7)]
    assert units.rust_test_lines("#[cfg(test)]\nmod tests;\n") == []


@pytest.mark.parametrize(
    ("subject", "kind"),
    [
        ("fix: mend the gate", "fix"),
        ("fix(beds): mend the gate (#12)", "fix"),
        ("fix!: mend the gate", "fix"),
        ("fix(beds)!: mend the gate", "fix"),
        ('Revert "feat: edge the beds"', "revert"),
        ("fixup! feat: edge", None),
        ("feat: fix the gate", None),
        ("Fix: mend", None),
    ],
)
def test_a_fix_commit_and_a_revert_by_their_subject(subject: str, kind: str | None) -> None:
    assert main.commit_type(subject) == kind


def test_closing_words_name_issues_of_this_repository_only() -> None:
    message = (
        "fix: mend (#90)\n\nCloses #1, fixes: #2 and resolved bench-org/beds#3.\n"
        "Fixes bench-org/other#4. See #5. Close https://github.com/bench-org/beds/issues/6\n"
        "closes #1\n"
    )
    assert main.closes(message, REPO) == [1, 2, 3, 6]


def test_found_by_lines_are_read_each_once_and_one_off_the_list_is_counted() -> None:
    message = (
        "fix: mend\n\nFound-by: use contract #27\nfound-by: Review Logic\n"
        "Found-by: use contract #27\nFound-by: luck logic\nFound-by: use\n"
    )
    assert main.found_by(message) == ([["use", "contract", 27], ["review", "logic", None]], 2)
    assert main.found_by("fix: mend\n") == ([], 0)


@pytest.mark.parametrize(
    ("label", "bug"),
    [("bug", True), ("Bug", True), ("security", True), ("type:bug", True),
     ("kind:security", True), ("bugfix", False), ("type:task", False), ("debug", False)],
)  # fmt: skip
def test_a_bug_label(label: str, bug: bool) -> None:
    assert is_bug(label) is bug


# ── Collecting ──────────────────────────────────────────────────────────────


def test_the_inventory_reads_each_fix_and_revert_once_and_counts_every_commit(
    garden: Garden,
) -> None:
    g = garden.graph
    several = garden.land(
        f"fix(beds): mend the beds and the shed (#31)\n\nCloses #27, closes #28. {CANARY}\n\n"
        "Found-by: use contract #27\nFound-by: daily logic #28\nFound-by: review parity\n",
        {"packages/beds/src/a.ts": "".join(f"export const a{n} = {n + 1};\n" for n in range(6)),
         "packages/beds/test/a.test.ts": "test('a', () => {});\n",
         "endpoints/shed/tool/src/main.rs": "fn main() {}\n",
         ".changeset/mend.md": f"{CANARY}\n"},
        day(3),
    )  # fmt: skip
    g.pulls[31] = [28, 29]
    g.issues.update({27: ("closed", ["type:bug"]), 28: ("closed", ["bug"]),
                     29: ("closed", ["type:task"])})  # fmt: skip
    none = garden.land(
        "fix: the tool exits with its code (#32)\n", {"scripts/tool.mjs": "x\n"}, day(2)
    )
    g.pulls[32] = []
    pr_only = garden.land(
        "fix(pots): water the pots (#33)\n", {"packages/pots/src/lib.rs": RUST.replace(
            "plant(1), 2", "plant(1), 3")}, day(2, 13))  # fmt: skip
    g.pulls[33] = [40]
    g.issues[40] = ("closed", ["type:security"])
    outside = garden.land(
        "fix(pots): water twice (#34)\n",
        {"packages/pots/src/lib.rs": RUST.replace("plant(1), 2", "plant(1), 3").replace(
            "n * 2", "n * 3")}, day(1))  # fmt: skip
    g.pulls[34] = [41]
    g.issues[41] = ("open", ["type:bug"])
    revert = garden.land('Revert "fix(pots): water twice"\n\nReverts #34.\n',
                         {"packages/pots/src/lib.rs": RUST}, day(1, 14))  # fmt: skip
    garden.land("feat(beds): edge the beds (#35)\n\nAlso fixes the gate.\n",
                {"packages/beds/src/edge.ts": "x\n"}, day(1, 15))  # fmt: skip
    garden.land("fix: tomorrow's fix\n", {"docs/a.md": "x\n"}, day(-1))  # after now: not yet

    data = ok(collect_cmd(sources=["main"], since_days=7))
    assert main_source(data) == {"source": "main", "status": "read", "found": 5, "added": 5}
    assert garden.fetched == ["main"]
    assert len(garden.graph.queries) == 1, "many numbers to one request"

    first = commit_line(garden.bench, several)
    assert first["units"] == ["packages/beds", "endpoints/shed/tool"]
    assert first["closes"] == [27, 28] and first["pr_closes"] == [28, 29]
    assert [issue[0] for issue in first["issues"]] == [27, 28, 29]
    assert first["test_paths"] == ["packages/beds/test/a.test.ts"]
    assert first["found_by"] == [["use", "contract", 27], ["daily", "logic", 28],
                                 ["review", "parity", None]]  # fmt: skip
    assert first["last_edit_status"] == "read"
    assert commit_line(garden.bench, none)["units"] == []
    assert commit_line(garden.bench, pr_only)["closes"] == []
    assert commit_line(garden.bench, pr_only)["test_paths"] == ["packages/pots/src/lib.rs"]
    assert commit_line(garden.bench, outside)["test_paths"] == [], "outside the test module"
    assert commit_line(garden.bench, revert)["type"] == "revert"

    again = ok(collect_cmd(sources=["main"], since_days=7))
    assert main_source(again)["added"] == 0, "each commit is read once"
    assert len(garden.graph.queries) == 1

    report = ok(report_cmd(days=7, by="area"))
    totals = report["totals"]
    assert totals["merged"] == 6 and totals["fix_commits"] == 4 and totals["reverts"] == 1
    assert totals["escapes"] == 3, "27, 28 and 40; 29 is a task and 41 is open"
    assert totals["unconfirmed"] == 1 and totals["with_test_path"] == 2
    assert totals["found_by_absent"] == 3
    assert totals["escapes_found_by"]["use"] == 1 and totals["escapes_found_by"]["daily"] == 1
    assert totals["escapes_found_by"]["absent"] == 1  # 40: its commit has no line
    assert totals["escapes_by_class"] == {**dict.fromkeys(record.CLASSES, 0),
                                          "contract": 1, "logic": 1, "absent": 1}  # fmt: skip
    assert [row["area"] for row in report["rows"]] == ["packages/pots", "repository", "several"]
    pots = area_row(report, "packages/pots")
    assert (pots["fix_commits"], pots["reverts"], pots["escapes"], pots["unconfirmed"]) == (
        2, 1, 1, 0
    )  # fmt: skip
    assert area_row(report, "several")["units"] == ["packages/beds", "endpoints/shed/tool"]
    assert report["coverage"]["sources"]["main"] == "read"
    assert report["coverage"]["not_seen"] == [report_not_seen()]


def report_not_seen() -> str:
    from botcore.commands.gate_outcome.report_areas import NOT_SEEN

    return NOT_SEEN[0]


def test_the_rust_rule_counts_changes_inside_a_test_module_and_not_outside(
    garden: Garden,
) -> None:
    inside = garden.land("fix(pots): plant right (#40)\n",
                         {"packages/pots/src/lib.rs": RUST.replace("plant(1), 2", "plant(1), 3")},
                         day(2))  # fmt: skip
    outside = garden.land("fix(pots): water right (#41)\n",
                          {"packages/pots/src/lib.rs": RUST.replace("plant(1), 2", "plant(1), 3")
                           .replace("n * 2", "n * 3")}, day(1))  # fmt: skip
    removed = garden.land("fix(pots): drop a line of a test (#42)\n",
                          {"packages/pots/src/lib.rs": RUST.replace("plant(1), 2", "plant(1), 3")
                           .replace("n * 2", "n * 3").replace("        let open = '{';\n", "")},
                          day(1, 14))  # fmt: skip
    garden.github = False
    ok(collect_cmd(sources=["main"], since_days=7))
    assert commit_line(garden.bench, inside)["tests"] == 1
    assert commit_line(garden.bench, outside)["tests"] == 0
    assert commit_line(garden.bench, removed)["tests"] == 1, "a line removed from a test module"


def test_without_github_the_commits_are_read_and_no_escape_is_counted(garden: Garden) -> None:
    sha = garden.land("fix(beds): mend (#31)\n\nCloses #27.\n", {"packages/beds/src/b.ts": "b\n"},
                      day(2))  # fmt: skip
    garden.graph.pulls[31] = [27]
    garden.graph.issues[27] = ("closed", ["type:bug"])
    garden.github = False
    data = ok(collect_cmd(sources=["ci", "main"], since_days=7))
    ci, source = data["sources"]
    assert ci["source"] == "ci" and ci["status"] == "absent" and "gh" in ci["why"]
    assert source["status"] == "partly" and "gh" in source["why"]
    assert (source["found"], source["added"]) == (1, 1)
    report = ok(report_cmd(days=7, by="area"))
    assert report["totals"]["escapes"] is None and report["totals"]["unconfirmed"] is None
    assert report["totals"]["escapes_found_by"] is None
    row = area_row(report, "packages/beds")
    assert row["escapes"] is None and row["github_unread"] == 1 and row["fix_commits"] == 1
    assert report["coverage"]["sources"]["main"] == "partly"
    assert any("no pull request or issue read" in w for w in report["warnings"])
    assert ok(report_cmd(days=7, by="check"))["coverage"]["sources"]["main"] == "partly"
    refused(collect_cmd(sources=["ci"], since_days=7), "SERVICE_UNAVAILABLE")

    garden.github = True  # later, with GitHub: only GitHub is read, and git is not again
    again = ok(collect_cmd(sources=["main"], since_days=7))
    assert main_source(again)["status"] == "read" and main_source(again)["added"] == 1
    assert commit_line(garden.bench, sha)["issues"] == [[27, "closed", ["type:bug"]]]
    assert ok(report_cmd(days=7, by="area"))["totals"]["escapes"] == 1


def test_a_commit_whose_subject_names_no_number_gets_the_pull_request_it_merged(
    garden: Garden,
) -> None:
    sha = garden.land("fix(beds): mend without a number\n", {"packages/beds/src/b.ts": "b\n"},
                      day(2))  # fmt: skip
    garden.graph.pulls[44] = [27]
    garden.graph.issues[27] = ("closed", ["type:bug"])
    garden.graph.merged[sha] = 44
    ok(collect_cmd(sources=["main"], since_days=7))
    line = commit_line(garden.bench, sha)
    assert (line["pr"], line["pr_closes"]) == (44, [27])


def test_the_age_of_the_last_edit_is_the_newest_replaced_line_and_bounded(
    garden: Garden, monkeypatch: pytest.MonkeyPatch
) -> None:
    garden.land("feat(beds): edge (#30)\n",
                {"packages/beds/src/a.ts": "export const a0 = 9;\n" + "".join(
                    f"export const a{n} = {n};\n" for n in range(1, 6))}, day(6))  # fmt: skip
    mended = "export const a0 = 8;\nexport const a1 = 8;\n" + "".join(
        f"export const a{n} = {n};\n" for n in range(2, 6)
    )
    fix = garden.land("fix(beds): mend (#31)\n", {"packages/beds/src/a.ts": mended}, day(2))
    added = garden.land("fix(beds): add (#32)\n", {"packages/beds/src/new.ts": "x\n"}, day(1))
    monkeypatch.setattr(main, "MAX_BLAME_FILES", 1)
    both = {"scripts/tool.mjs": "y\n", "packages/beds/src/a.ts": "z\n"}
    wide = garden.land("fix: everywhere (#33)\n", both, day(1, 13))
    for n in (31, 32, 33, 30):
        garden.graph.pulls[n] = []
    ok(collect_cmd(sources=["main"], since_days=7))
    line = commit_line(garden.bench, fix)
    assert line["last_edit_status"] == "read"
    assert record.parse_time(line["last_edit"]) == day(6), "the newest of the replaced lines"
    assert commit_line(garden.bench, added)["last_edit_status"] == "no-lines"
    assert commit_line(garden.bench, wide)["last_edit_status"] == "too-many-files"
    row = area_row(ok(report_cmd(days=7, by="area")), "packages/beds")
    assert row["last_edit"] == {"read": 1, "of": 3, "median_days": 4.0}


def test_the_last_edit_is_read_from_a_folder_inside_the_checkout(garden: Garden) -> None:
    """A workspace can be a unit's own folder; git blame takes a path from where it runs."""
    garden.land("feat(beds): edge (#30)\n",
                {"packages/beds/src/a.ts": "export const a0 = 9;\n" + "".join(
                    f"export const a{n} = {n};\n" for n in range(1, 6))}, day(6))  # fmt: skip
    mended = "export const a0 = 8;\n" + "".join(f"export const a{n} = {n};\n" for n in range(1, 6))
    fix = garden.land("fix(beds): mend (#31)\n", {"packages/beds/src/a.ts": mended}, day(2))
    for n in (30, 31):
        garden.graph.pulls[n] = []
    garden.bench.monkeypatch.chdir(garden.bench.checkout / "packages" / "beds")
    ok(collect_cmd(sources=["main"], since_days=7))
    line = commit_line(garden.bench, fix)
    assert line["last_edit_status"] == "read"
    assert record.parse_time(line["last_edit"]) == day(6)


def test_the_record_holds_no_subject_message_or_diff_text(garden: Garden) -> None:
    garden.land(f"fix(beds): {CANARY} (#31)\n\n{CANARY}\nCloses #27.\n",
                {"packages/beds/src/a.ts": f"// {CANARY}\n"}, day(2))  # fmt: skip
    garden.land(f'Revert "{CANARY}"\n\n{CANARY}\n', {"packages/beds/src/a.ts": "x\n"}, day(1))
    garden.graph.pulls[31] = [27]
    garden.graph.issues[27] = ("closed", ["type:bug"])
    garden.bench.on("bench", shared=True)
    ok(collect_cmd(sources=["main"], since_days=7))
    assert len(lines(garden.bench)) == 2
    for path in [*garden.bench.tmp.glob("record-*/**/*"), *garden.bench.shared.rglob("*")]:
        if path.is_file():
            assert CANARY.encode() not in path.read_bytes(), path


def test_a_collection_held_to_its_requests_is_partly_read_and_goes_on(garden: Garden) -> None:
    for n in range(3):
        garden.land(f"fix: mend {n} (#{50 + n})\n", {f"docs/{n}.md": "x\n"}, day(2, n))
        garden.graph.pulls[50 + n] = []
    data = ok(collect_cmd(sources=["main"], since_days=7, requests=1))  # the allowance only
    source = main_source(data)
    assert source["status"] == "partly" and source["why"].startswith("requests")
    assert source["added"] == 3
    report = ok(report_cmd(days=7, by="area"))
    assert report["totals"]["escapes"] is None and report["totals"]["fix_commits"] == 3
    again = ok(collect_cmd(sources=["main"], since_days=7))
    assert main_source(again)["status"] == "read"


def test_days_not_collected_give_no_merged_count(garden: Garden) -> None:
    garden.land("fix: mend (#31)\n", {"docs/a.md": "x\n"}, day(1))
    garden.graph.pulls[31] = []
    ok(collect_cmd(sources=["main"], since_days=2))
    report = ok(report_cmd(days=7, by="area"))
    assert report["totals"]["merged"] is None and report["coverage"]["sources"]["main"] == "partly"
    assert any("since_days 7" in w for w in report["warnings"])
    assert ok(report_cmd(days=2, by="area"))["totals"]["merged"] == 1


def test_one_area_lists_its_commits_newest_first(garden: Garden) -> None:
    for n in range(3):
        garden.land(f"fix(beds): mend {n} (#{60 + n})\n", {f"packages/beds/src/{n}.ts": "x\n"},
                    day(3 - n))  # fmt: skip
        garden.graph.pulls[60 + n] = [70 + n]
        garden.graph.issues[70 + n] = ("closed", ["type:bug"])
    ok(collect_cmd(sources=["main"], since_days=7))
    data = ok(report_cmd(days=7, by="area", area="packages/beds/", limit=2))
    assert [e["pull_request"] for e in data["examples"]] == [62, 61]
    assert data["examples"][0]["escapes"] == [{"issue": 72, "found_by": "absent", "class": None}]
    assert data["more"]["examples"] == 1
    assert [row["area"] for row in data["rows"]] == ["packages/beds"]


def test_an_area_that_is_not_known_is_refused_with_the_closest(garden: Garden) -> None:
    error = refused(report_cmd(days=7, by="area", area="packages/bedz"), "INVALID_INPUT")
    assert "packages/beds" in error.suggestion and "areas are known" in error.suggestion
    refused(report_cmd(days=7, by="area"), "NOT_COLLECTED")
    refused(report_cmd(days=7, by="workflow", area="packages/beds"), "INVALID_INPUT")


def test_main_alone_refuses_a_checkout_with_no_default_branch(bench: Bench) -> None:
    bench.monkeypatch.setattr(main, "fetch", lambda _root, _branch: None)
    error = refused(collect_cmd(sources=["main"]), "SOURCE_UNREADABLE")
    assert "fetch" in error.suggestion


def test_two_machines_read_the_inventory_once(garden: Garden) -> None:
    garden.land("fix: mend (#31)\n", {"docs/a.md": "x\n"}, day(1))
    garden.graph.pulls[31] = []
    garden.bench.on("first", shared=True)
    ok(collect_cmd(sources=["main"], since_days=7))
    garden.bench.on("second", shared=True)
    data = ok(collect_cmd(sources=["main"], since_days=7))
    assert main_source(data)["added"] == 0 and len(garden.graph.queries) == 1
    assert ok(report_cmd(days=7, by="area"))["totals"]["merged"] == 1


def test_the_docs_topic_and_the_command_line_name_the_main_source(bench: Bench) -> None:
    from click.testing import CliRunner

    from botcore.cli import cli
    from botcore.docs import CORE_DOCS

    topic = CORE_DOCS["gate-outcome"]
    for said in ("`main`", "#[cfg(test)]", "__tests__", "`several`", "`repository`", "Found-by",
                 "`:security`", "`unconfirmed`", "`too-many-files`", "the age of the bug",
                 "`github_unread`", "`escapes_found_by`"):  # fmt: skip
        assert said in topic, said
    runner = CliRunner()
    assert "main (the fix commits" in runner.invoke(cli, ["gate-outcome-collect", "--help"]).output
    helped = runner.invoke(cli, ["gate-outcome-report", "--help"]).output
    assert "by area" in helped and "--area" in helped


def test_an_answer_without_the_repository_or_a_pull_request_leaves_commits_unread(
    garden: Garden, monkeypatch: pytest.MonkeyPatch
) -> None:
    sha = garden.land("fix: mend (#31)\n", {"docs/a.md": "x\n"}, day(2))
    garden.land("fix: mend again (#32)\n", {"docs/b.md": "x\n"}, day(1))
    garden.graph.pulls[32] = []  # 31 names nothing GitHub answers for
    answer = garden.graph.answer

    def hidden(query: str) -> github.Answer:
        answer(query)
        return github.Answer(200, {"data": {"repository": None}})

    monkeypatch.setattr(garden.graph, "answer", hidden)
    data = ok(collect_cmd(sources=["main"], since_days=7))
    assert main_source(data)["status"] == "partly" and "no repository" in main_source(data)["why"]
    assert commit_line(garden.bench, sha)["issues"] is None
    assert ok(report_cmd(days=7, by="area"))["totals"]["unconfirmed"] is None
    monkeypatch.setattr(garden.graph, "answer", answer)
    data = ok(collect_cmd(sources=["main"], since_days=7))
    assert main_source(data)["status"] == "partly"
    assert commit_line(garden.bench, sha)["issues"] is None, "never read as closing nothing"
    assert ok(report_cmd(days=7, by="area"))["totals"]["github_unread"] == 1


def test_sort_does_not_go_with_by_area(garden: Garden) -> None:
    error = refused(report_cmd(days=7, by="area", sort="failed"), "INVALID_INPUT")
    assert "sort" in error.suggestion


def test_an_answer_with_an_error_other_than_not_found_reads_nothing_as_closed(
    garden: Garden, monkeypatch: pytest.MonkeyPatch
) -> None:
    sha = garden.land("fix: mend (#31)\n\nCloses #27.\n", {"docs/a.md": "x\n"}, day(2))
    garden.graph.pulls[31] = [27]
    garden.graph.issues[27] = ("closed", ["type:bug"])
    answer = garden.graph.answer

    def forbidden(query: str) -> github.Answer:
        held = answer(query)
        assert isinstance(held.body, dict)
        return github.Answer(200, {**held.body, "errors": [{"type": "FORBIDDEN"}]})

    monkeypatch.setattr(garden.graph, "answer", forbidden)
    source = main_source(ok(collect_cmd(sources=["main"], since_days=7)))
    assert source["status"] == "partly" and "FORBIDDEN" in source["why"]
    assert commit_line(garden.bench, sha)["issues"] is None


def test_a_tip_that_could_not_be_fetched_lists_no_day(garden: Garden) -> None:
    garden.land("fix: mend (#31)\n", {"docs/a.md": "x\n"}, day(1))
    garden.graph.pulls[31] = []
    garden.bench.monkeypatch.setattr(main, "fetch", lambda _root, _branch: "no network")
    source = main_source(ok(collect_cmd(sources=["main"], since_days=7)))
    assert source["status"] == "partly" and "could not be fetched" in source["why"]
    report = ok(report_cmd(days=7, by="area"))
    assert report["totals"]["merged"] is None, "a tip not fetched may lack commits"
    assert report["coverage"]["sources"]["main"] == "partly"
    assert report["totals"]["fix_commits"] == 1


def test_a_path_with_a_space_is_read_whole(garden: Garden) -> None:
    sha = garden.land("chore: a crate\n", {"packages/pots/src/my lib.rs": RUST}, day(5))
    fix = garden.land(
        "fix(pots): plant right (#40)\n",
        {"packages/pots/src/my lib.rs": RUST.replace("plant(1), 2", "plant(1), 3")},
        day(2),
    )
    garden.graph.pulls[40] = []
    ok(collect_cmd(sources=["main"], since_days=7))
    line = commit_line(garden.bench, fix)
    assert line["test_paths"] == ["packages/pots/src/my lib.rs"]
    assert record.parse_time(line["last_edit"]) == day(5) and sha


def test_a_main_collection_says_nothing_of_how_old_ci_is(garden: Garden) -> None:
    garden.land("fix: mend (#31)\n", {"docs/a.md": "x\n"}, day(1))
    garden.graph.pulls[31] = []
    ok(collect_cmd(sources=["main"], since_days=7))
    report = ok(report_cmd(days=7, by="workflow"))
    assert report["coverage"]["collected"]["ci"] == {"newest": None, "age_hours": None}
    assert any("last collected ci never" in w for w in report["warnings"])
    assert not any("last collected" in w for w in ok(report_cmd(days=7, by="area"))["warnings"])


def test_a_rebuild_of_one_source_is_kept_while_the_other_is_collected(garden: Garden) -> None:
    for _ in range(3):
        garden.bench.github.add(conclusion="failure")
    ok(collect_cmd(sources=["ci"], since_days=7, requests=3, rebuild=True))
    state = record.load_state(garden.bench.folder())
    assert "rebuild" in state
    ok(collect_cmd(sources=["main"], since_days=7))
    state = record.load_state(garden.bench.folder())
    assert "rebuild" in state and "main_rebuild" not in state
    ok(collect_cmd(sources=["main"], since_days=7, rebuild=True))
    assert "rebuild" in record.load_state(garden.bench.folder()), "ci's is still going"


def test_a_source_named_twice_is_read_once(garden: Garden) -> None:
    garden.github = False
    refused(collect_cmd(sources=["ci", "ci"], since_days=7), "SERVICE_UNAVAILABLE")


def test_a_diff_header_of_a_path_with_a_space_ends_with_a_tab() -> None:
    diff = "diff --git a/x y.rs b/x y.rs\n--- a/x y.rs\t\n+++ b/x y.rs\t\n@@ -2 +2 @@\n-a\n+b\n"
    (change,) = units.parse_diff(diff)
    assert (change.old, change.new, change.removed, change.added) == ("x y.rs", "x y.rs", [2], [2])
