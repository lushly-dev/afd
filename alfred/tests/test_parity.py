"""Tests for alfred_parity command."""

import tempfile
from pathlib import Path

import pytest

from alfred.commands.parity import (
    WIRE_ROUND_TRIP_TESTS,
    _camel_to_snake,
    _normalize,
    alfred_parity,
    check_wire_fixtures,
    parse_python_exports,
    parse_rust_exports,
    parse_typescript_exports,
)

REPO_ROOT = Path(__file__).parent.parent.parent

# ─── Unit tests for parsing ──────────────────────────────────────────────────


def test_camel_to_snake():
    assert _camel_to_snake("createError") == "create_error"
    assert _camel_to_snake("CommandResult") == "command_result"
    assert _camel_to_snake("isSuccess") == "is_success"
    assert _camel_to_snake("McpErrorCodes") == "mcp_error_codes"
    assert _camel_to_snake("isBatchRequest") == "is_batch_request"


def test_normalize_already_snake():
    assert _normalize("create_error") == "create_error"
    assert _normalize("is_success") == "is_success"


def test_normalize_camel():
    assert _normalize("createError") == "create_error"
    assert _normalize("CommandResult") == "command_result"


def _names(entries):
    return {e.name for e in entries}


def _kinds(entries):
    return {e.name: e.kind for e in entries}


def test_parse_typescript_exports():
    content = """
export type { CommandResult, ResultMetadata } from './result.js';
export { success, failure, isSuccess, isFailure } from './result.js';
export type { CommandError, ErrorCode } from './errors.js';
export { createError, validationError } from './errors.js';
"""
    entries = parse_typescript_exports(content)
    names = _names(entries)
    assert "CommandResult" in names
    assert "success" in names
    assert "createError" in names

    # Check kinds
    types = {e.name for e in entries if e.kind == "type"}
    funcs = {e.name for e in entries if e.kind == "function"}
    assert "CommandResult" in types
    assert "success" in funcs


def test_typescript_value_export_after_a_types_module_is_kept():
    # The old parser dropped a value export when the 20 characters before it
    # contained "type" (here, the './types.js' specifier).
    content = "export type { Foo } from './types.js';\nexport { bar } from './bar.js';\n"
    assert _kinds(parse_typescript_exports(content)) == {"Foo": "type", "bar": "function"}


def test_typescript_aliases_inline_types_and_comments():
    content = """
export {
    /** @deprecated Import from `./connectors`. */
    GitHubConnector,
    internalName as publicName,
    type Options,
    type Raw as Shaped,
    default as main, // re-exports the module's default export as `main`
} from './connectors/github.js';
export { local1, local2 as renamed, local3 as default };
"""
    assert _kinds(parse_typescript_exports(content)) == {
        "GitHubConnector": "function",
        "publicName": "function",
        "Options": "type",
        "Shaped": "type",
        "main": "function",
        "local1": "function",
        "renamed": "function",
    }


def test_typescript_direct_declarations():
    content = """
export function createThing() {}
export async function loadThing() {}
export const MAX_THINGS = 3;
export class ThingStore {}
export abstract class BaseThing {}
export interface ThingOptions { a: string }
export type ThingId = string;
export enum ThingKind { A }
export const enum Flags { B }
export declare const injected: number;
export default function ignoredDefault() {}
// export function commentedOut() {}
const notExported = 1;
"""
    assert _kinds(parse_typescript_exports(content)) == {
        "createThing": "function",
        "loadThing": "function",
        "MAX_THINGS": "function",
        "ThingStore": "function",
        "BaseThing": "function",
        "ThingOptions": "type",
        "ThingId": "type",
        "ThingKind": "function",
        "Flags": "function",
        "injected": "function",
    }


def test_typescript_star_exports_are_followed(tmp_path):
    (tmp_path / "utils.ts").write_text(
        "export function helper() {}\nexport type HelperOptions = {};\n", encoding="utf-8"
    )
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "index.ts").write_text(
        "export const nestedValue = 1;\nexport * from '../index.js';\n", encoding="utf-8"
    )
    index = (
        "export * from './utils.js';\n"
        "export * from './nested';\n"
        "export * as models from './models.js';\n"
        "export * from './missing.js';\n"
    )
    (tmp_path / "index.ts").write_text(index, encoding="utf-8")

    entries = parse_typescript_exports(index, tmp_path)

    assert _kinds(entries) == {
        "helper": "function",
        "HelperOptions": "type",
        "nestedValue": "function",
        "models": "function",
    }
    # Without a base directory, star re-exports cannot be resolved.
    assert _names(parse_typescript_exports(index)) == {"models"}


def test_parse_python_exports():
    content = '''
__all__ = [
    "__version__",
    "CommandResult",
    "success",
    "failure",
    "CommandError",
    "create_error",
]
'''
    entries = parse_python_exports(content)
    names = _names(entries)
    assert "CommandResult" in names
    assert "success" in names
    assert "create_error" in names
    # __version__ should be skipped
    assert "__version__" not in names


def test_python_all_augmentations_are_followed():
    content = '''
__all__: list[str] = ["first"]
__all__ += ["second", 'third']
__all__.extend(["fourth"])
__all__.append("fifth")
__all__ = __all__ + ("sixth",)
if TYPE_CHECKING:
    __all__ += ["seventh"]
try:
    import optional
    __all__.append("eighth")
except ImportError:
    pass
names = ["not_exported"]
'''
    assert [e.name for e in parse_python_exports(content)] == [
        "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
    ]


def test_python_reassignment_replaces_and_bad_syntax_is_empty():
    assert _names(parse_python_exports('__all__ = ["old"]\n__all__ = ["new"]\n')) == {"new"}
    assert parse_python_exports("__all__ = [\n") == []
    assert parse_python_exports("x = 1\n") == []


def test_parse_rust_exports():
    content = """
pub use result::{
    failure, success, CommandResult, ResultMetadata,
};
pub use errors::{
    create_error, CommandError,
};
"""
    entries = parse_rust_exports(content)
    names = _names(entries)
    assert "CommandResult" in names
    assert "success" in names
    assert "create_error" in names


def test_rust_use_forms():
    content = """
//! Crate docs mention pub use fake::{Nope};
pub use single::Item;
pub use single::item_fn;
pub use aliased::Original as Renamed;
pub use nested::{inner::{DeepType, deep_fn}, other::Shallow as Alias, self};
pub use grouped::{self as grouped_mod, Member};
pub use traits::Extension as _;
pub(crate) use private::Hidden;
/* pub use commented::Out; */
pub use crate::absolute::path::{AbsoluteType};
"""
    assert _kinds(parse_rust_exports(content)) == {
        "Item": "type",
        "item_fn": "function",
        "Renamed": "type",
        "DeepType": "type",
        "deep_fn": "function",
        "Alias": "type",
        "nested": "function",
        "grouped_mod": "function",
        "Member": "type",
        "AbsoluteType": "type",
    }


def test_rust_top_level_items_and_globs(tmp_path):
    (tmp_path / "helpers.rs").write_text(
        "pub fn helper() {}\n"
        "pub struct HelperType;\n"
        "pub(crate) fn crate_only() {}\n"
        "impl HelperType {\n    pub fn method(&self) {}\n}\n",
        encoding="utf-8",
    )
    (tmp_path / "things").mkdir()
    (tmp_path / "things" / "mod.rs").write_text(
        "pub enum Thing { A }\npub use crate::helpers::*;\n", encoding="utf-8"
    )
    content = """
pub mod helpers;
pub use helpers::*;
pub use things::*;
pub const MAX_ITEMS: usize = 3;
pub const fn is_native() -> bool { true }
pub static GREETING: &str = "} not a brace {";
pub trait Plugin {
    fn run(&self);
}
pub type Alias = u32;
#[cfg(doctest)]
pub struct ReadmeDoctests;
#[cfg(test)]
mod tests {
    pub fn test_helper() {}
}
fn private_fn() {}
"""
    assert _kinds(parse_rust_exports(content, tmp_path)) == {
        "helper": "function",
        "HelperType": "type",
        "Thing": "type",
        "MAX_ITEMS": "function",
        "GREETING": "function",
        "Plugin": "type",
        "Alias": "type",
    }


# ─── Wire fixture coverage ───────────────────────────────────────────────────


def _write_wire_repo(root: Path, fixtures=("result-a.json", "batch-b.json")) -> None:
    wire = root / "spec" / "wire"
    wire.mkdir(parents=True)
    for name in fixtures:
        (wire / name).write_text('{"success": true}', encoding="utf-8")
    references = "\n".join(f'load("{name}")' for name in fixtures)
    for relative in WIRE_ROUND_TRIP_TESTS.values():
        suite = root / relative
        suite.parent.mkdir(parents=True, exist_ok=True)
        suite.write_text(references + "\n", encoding="utf-8")


def test_wire_fixtures_fully_covered(tmp_path):
    _write_wire_repo(tmp_path)
    report = check_wire_fixtures(tmp_path)
    assert report["fixtures"] == ["batch-b.json", "result-a.json"]
    assert report["gaps"] == 0
    assert report["uncovered"] == {"typescript": [], "python": [], "rust": []}


def test_wire_fixture_missing_from_one_suite(tmp_path):
    _write_wire_repo(tmp_path)
    rust_suite = tmp_path / WIRE_ROUND_TRIP_TESTS["rust"]
    # Mentioning the name outside a string literal does not count.
    rust_suite.write_text(
        'round_trip("result-a.json");\n// batch-b.json is todo\n', encoding="utf-8"
    )
    report = check_wire_fixtures(tmp_path)
    assert report["uncovered"]["rust"] == ["batch-b.json"]
    assert report["uncovered"]["python"] == []
    assert report["gaps"] == 1


def test_wire_missing_suite_invalid_fixture_and_missing_dir(tmp_path):
    _write_wire_repo(tmp_path)
    (tmp_path / WIRE_ROUND_TRIP_TESTS["python"]).unlink()
    (tmp_path / "spec" / "wire" / "broken.json").write_text("{not json", encoding="utf-8")

    report = check_wire_fixtures(tmp_path)

    assert report["missing_suites"] == ["python"]
    assert report["invalid_fixtures"] == ["broken.json"]
    assert report["uncovered"]["python"] == ["batch-b.json", "broken.json", "result-a.json"]
    # broken.json is invalid (1) and unreferenced by TS and Rust (2); Python misses all 3.
    assert report["gaps"] == 1 + 2 + 3

    empty = tmp_path / "empty"
    empty.mkdir()
    missing = check_wire_fixtures(empty)
    assert missing["missing_fixture_dir"] is True
    assert missing["gaps"] == 1


# ─── Integration tests ───────────────────────────────────────────────────────


@pytest.fixture
def fake_repo(tmp_path):
    """Create a minimal fake repo structure with export files and wire fixtures."""
    ts_dir = tmp_path / "packages" / "core" / "src"
    ts_dir.mkdir(parents=True)
    (ts_dir / "index.ts").write_text(
        "export type { CommandResult } from './result.js';\n"
        "export { success, failure } from './result.js';\n",
        encoding="utf-8",
    )

    py_dir = tmp_path / "python" / "src" / "afd"
    py_dir.mkdir(parents=True)
    (py_dir / "__init__.py").write_text(
        '__all__ = [\n'
        '    "CommandResult",\n'
        '    "success",\n'
        '    "failure",\n'
        ']\n',
        encoding="utf-8",
    )

    rs_dir = tmp_path / "packages" / "rust" / "src"
    rs_dir.mkdir(parents=True)
    (rs_dir / "lib.rs").write_text(
        "pub use result::{\n"
        "    success, failure, CommandResult,\n"
        "};\n",
        encoding="utf-8",
    )

    _write_wire_repo(tmp_path)
    return tmp_path


@pytest.mark.asyncio
async def test_parity_all_match(fake_repo):
    """When all languages export the same names, gaps should be zero."""
    result = await alfred_parity(str(fake_repo))
    assert result.success is True
    assert result.data["total_gaps"] == 0
    assert result.data["name_gaps"] == 0
    assert result.data["wire_fixtures"]["gaps"] == 0
    assert result.confidence == 1.0


@pytest.mark.asyncio
async def test_parity_detects_missing(fake_repo):
    """When Python is missing an export, it should be reported."""
    py_init = fake_repo / "python" / "src" / "afd" / "__init__.py"
    py_init.write_text(
        '__all__ = [\n'
        '    "CommandResult",\n'
        '    "success",\n'
        ']\n',
        encoding="utf-8",
    )
    result = await alfred_parity(str(fake_repo))
    assert result.success is True
    assert "failure" in result.data["missing_from_python"]
    assert result.data["total_gaps"] > 0
    assert result.confidence < 1.0


@pytest.mark.asyncio
async def test_parity_counts_uncovered_wire_fixtures(fake_repo):
    """A fixture no suite round-trips is a gap, so `alfred parity` exits 1."""
    (fake_repo / "spec" / "wire" / "new-shape.json").write_text("{}", encoding="utf-8")
    result = await alfred_parity(str(fake_repo))
    assert result.data["name_gaps"] == 0
    assert result.data["wire_fixtures"]["uncovered"] == {
        "typescript": ["new-shape.json"],
        "python": ["new-shape.json"],
        "rust": ["new-shape.json"],
    }
    assert result.data["total_gaps"] == 3
    assert result.confidence < 1.0


@pytest.mark.asyncio
async def test_parity_missing_files():
    """Running parity on a dir without export files should error."""
    with tempfile.TemporaryDirectory() as d:
        result = await alfred_parity(d)
        assert result.success is False
        assert result.error.code == "NOT_FOUND"


# Name-gap budgets for the real repo. They only go down: lower them when a gap
# closes. Raising one means a language fell further behind TypeScript; do it
# only with a reason in the pull request.
NAME_GAP_BUDGET = {
    # 97 → 98 and 9 → 10: TypeScript's StreamExecutorOptions (the executeStream
    # timeout). Neither language has an executor options type, like ExecutorOptions.
    "missing_from_python": 98,
    "missing_from_rust": 10,
}

# Exports every language must have; if one disappears the parser is broken.
CORE_EXPORTS = {
    "command_result",
    "command_error",
    "success",
    "failure",
    "batch_result",
    "pipeline_result",
    "stream_chunk",
    "create_batch_result",
    "handoff_result",
}


@pytest.mark.asyncio
async def test_parity_on_real_repo():
    """Run parity on the actual AFD repo and hold it to real budgets."""
    ts_file = REPO_ROOT / "packages" / "core" / "src" / "index.ts"
    if not ts_file.exists():
        pytest.skip("Not running from AFD repo root")

    result = await alfred_parity(str(REPO_ROOT))
    assert result.success is True
    data = result.data

    # Every golden wire fixture is round-tripped by all three suites.
    wire = data["wire_fixtures"]
    on_disk = sorted(p.name for p in (REPO_ROOT / "spec" / "wire").glob("*.json"))
    assert wire["fixtures"] == on_disk
    assert len(on_disk) >= 6
    assert wire["missing_suites"] == []
    assert wire["invalid_fixtures"] == []
    assert wire["uncovered"] == {"typescript": [], "python": [], "rust": []}
    assert wire["gaps"] == 0

    # The parsers find the core surface in every language.
    for language, entries in (
        ("typescript", parse_typescript_exports(ts_file.read_text(), ts_file.parent)),
        (
            "python",
            parse_python_exports((REPO_ROOT / "python/src/afd/__init__.py").read_text()),
        ),
        (
            "rust",
            parse_rust_exports(
                (REPO_ROOT / "packages/rust/src/lib.rs").read_text(),
                REPO_ROOT / "packages/rust/src",
            ),
        ),
    ):
        missing = CORE_EXPORTS - {e.normalized for e in entries}
        assert not missing, f"{language} parser lost core exports: {sorted(missing)}"
        assert all(e.name.isidentifier() for e in entries), language

    # Name gaps stay within budget.
    for key, budget in NAME_GAP_BUDGET.items():
        assert len(data[key]) <= budget, (
            f"{key} grew to {len(data[key])} (budget {budget}): {data[key]}"
        )
