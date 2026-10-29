"""Tests for botcore.utils.workspace — resolve_language priority chain."""

from __future__ import annotations

from pathlib import Path

from botcore.config import BotCoreConfig, LanguageConfig, PackageOverrideConfig
from botcore.utils.workspace import resolve_language


def _make_config(**kwargs) -> BotCoreConfig:
    return BotCoreConfig(**kwargs)


def test_resolve_language_explicit_override(tmp_path: Path) -> None:
    """Explicit override always wins."""
    config = _make_config(language="python")
    result = resolve_language(tmp_path / "foo.ts", config, tmp_path, language_override="rust")
    assert result == "rust"


def test_resolve_language_root_prefix(tmp_path: Path) -> None:
    """Root prefix matching resolves correct language."""
    config = _make_config(
        language_config={
            "python": LanguageConfig(root="python/"),
            "typescript": LanguageConfig(),
        }
    )
    # Create the path structure
    py_file = tmp_path / "python" / "src" / "foo.py"
    py_file.parent.mkdir(parents=True)
    py_file.touch()

    result = resolve_language(py_file, config, tmp_path)
    assert result == "python"


def test_resolve_language_longest_prefix_wins(tmp_path: Path) -> None:
    """Longest root prefix wins when multiple match."""
    config = _make_config(
        language_config={
            "typescript": LanguageConfig(root="packages/"),
            "rust": LanguageConfig(root="packages/rust/"),
        }
    )
    rust_file = tmp_path / "packages" / "rust" / "src" / "main.rs"
    rust_file.parent.mkdir(parents=True)
    rust_file.touch()

    result = resolve_language(rust_file, config, tmp_path)
    assert result == "rust"

    # A file directly under packages/ should match typescript
    ts_file = tmp_path / "packages" / "web" / "index.ts"
    ts_file.parent.mkdir(parents=True)
    ts_file.touch()

    result = resolve_language(ts_file, config, tmp_path)
    assert result == "typescript"


def test_resolve_language_package_override(tmp_path: Path) -> None:
    """PackageOverrideConfig.language is used when set."""
    # Create a package with a manifest
    pkg_dir = tmp_path / "packages" / "special"
    pkg_dir.mkdir(parents=True)
    (pkg_dir / "package.json").write_text('{"name": "@test/special"}', encoding="utf-8")

    config = _make_config(
        language="typescript",
        packages={"@test/special": PackageOverrideConfig(language="rust")},
    )

    file_path = pkg_dir / "src" / "lib.rs"
    file_path.parent.mkdir(parents=True)
    file_path.touch()

    result = resolve_language(file_path, config, tmp_path)
    assert result == "rust"


def test_resolve_language_marker_walkup(tmp_path: Path) -> None:
    """detect_language fallback uses marker walk-up from path directory."""
    # detect_language checks for markers in the passed directory directly
    # so pass a path whose parent *is* the directory with the marker
    rust_dir = tmp_path / "rust_proj"
    rust_dir.mkdir()
    (rust_dir / "Cargo.toml").write_text('[package]\nname = "test"', encoding="utf-8")

    config = _make_config()
    # File directly in the rust_proj directory — parent is rust_proj
    result = resolve_language(rust_dir / "main.rs", config, tmp_path)
    assert result == "rust"


def test_resolve_language_primary_fallback(tmp_path: Path) -> None:
    """Falls back to config.language when nothing else matches."""
    config = _make_config(language="python")
    result = resolve_language(tmp_path / "unknown" / "file.txt", config, tmp_path)
    assert result == "python"


def test_resolve_language_none(tmp_path: Path) -> None:
    """Returns None when nothing matches and no primary language."""
    config = _make_config()
    result = resolve_language(None, config, tmp_path)
    assert result is None
