"""Trend measures contract, file reader, CLI wiring and report 1.3 integration."""

from __future__ import annotations

import io
import json
import stat
from pathlib import Path
from unittest.mock import patch

import jsonschema
import pytest

from lushly_health import (
    MEASURE_DIRECTIONS,
    MEASURES_SCHEMA_VERSION,
    Measure,
    Policy,
    Target,
    audit,
    capabilities,
    load_measures,
    load_measures_files,
    measures_from_mapping,
    report_schema,
)
from lushly_health.__main__ import main
from lushly_health.measures import MAX_MEASURES_FILE_BYTES, MAX_SAFE_MEASURE_VALUE

VALIDATOR = jsonschema.Draft202012Validator(report_schema())


@pytest.fixture
def project(tmp_path):
    repo = tmp_path / "plain-app"
    repo.mkdir()
    (repo / ".gitattributes").write_text("* text=auto eol=lf\n")
    return repo


def snapshot(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_measure_validation_and_serialization():
    repo_wide = Measure(
        key="files_over_warn",
        label="Files over size warning",
        value=12,
        unit="files",
        direction="lower_is_better",
    )
    assert repo_wide.describe() == {
        "key": "files_over_warn",
        "label": "Files over size warning",
        "value": 12,
        "unit": "files",
        "direction": "lower_is_better",
    }
    assert "target" not in repo_wide.describe()
    assert "source" not in repo_wide.describe()

    scoped = Measure(
        key="coverage.lines",
        label="Line coverage",
        value=87.5,
        unit="%",
        direction="higher_is_better",
        target="plain-app",
        source="coverage",
    )
    assert scoped.describe() == {
        "key": "coverage.lines",
        "label": "Line coverage",
        "value": 87.5,
        "unit": "%",
        "direction": "higher_is_better",
        "target": "plain-app",
        "source": "coverage",
    }

    zero = Measure("delta", "Net delta", -0.0, "lines", "neutral")
    assert zero.value == 0.0 and not str(zero.value).startswith("-")


@pytest.mark.parametrize(
    "kwargs",
    [
        {"key": "", "label": "X", "value": 1, "unit": "count", "direction": "neutral"},
        {"key": "bad key", "label": "X", "value": 1, "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "   ", "value": 1, "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "X", "value": True, "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "X", "value": False, "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "X", "value": "12", "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "X", "value": float("nan"), "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "X", "value": float("inf"), "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "X", "value": float("-inf"), "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "X", "value": 10**309, "unit": "count", "direction": "neutral"},
        {"key": "k", "label": "X", "value": -(10**309), "unit": "count", "direction": "neutral"},
        {
            "key": "k",
            "label": "X",
            "value": MAX_SAFE_MEASURE_VALUE + 1,
            "unit": "count",
            "direction": "neutral",
        },
        {
            "key": "k",
            "label": "X",
            "value": MAX_SAFE_MEASURE_VALUE + 2,
            "unit": "count",
            "direction": "neutral",
        },
        {
            "key": "k",
            "label": "X",
            "value": -(MAX_SAFE_MEASURE_VALUE + 1),
            "unit": "count",
            "direction": "neutral",
        },
        {
            "key": "k",
            "label": "X",
            "value": float(MAX_SAFE_MEASURE_VALUE + 1),
            "unit": "count",
            "direction": "neutral",
        },
        {"key": "k", "label": "X", "value": 1, "unit": " ", "direction": "neutral"},
        {"key": "k", "label": "X", "value": 1, "unit": "count", "direction": "up"},
        {
            "key": "k",
            "label": "X",
            "value": 1,
            "unit": "count",
            "direction": "neutral",
            "target": "bad target",
        },
        {
            "key": "k",
            "label": "X",
            "value": 1,
            "unit": "count",
            "direction": "neutral",
            "source": "",
        },
    ],
)
def test_measure_rejects_invalid_fields(kwargs):
    with pytest.raises(ValueError):
        Measure(**kwargs)


def test_load_measures_reads_json_and_toml_with_defaults_and_overrides(tmp_path):
    json_file = tmp_path / "sweep.json"
    json_file.write_text(
        json.dumps(
            {
                "schema_version": MEASURES_SCHEMA_VERSION,
                "source": "sweep-bloat",
                "measures": [
                    {
                        "key": "files_over_warn",
                        "label": "Files over size warning",
                        "value": 4,
                        "unit": "files",
                        "direction": "lower_is_better",
                    },
                    {
                        "key": "cognitive_findings",
                        "label": "Cognitive complexity findings",
                        "value": 7,
                        "unit": "findings",
                        "direction": "lower_is_better",
                        "source": "complexity-scan",
                    },
                ],
            }
        )
    )
    toml_file = tmp_path / "coverage.toml"
    toml_file.write_text(
        'schema_version = "1.0"\n'
        'source = "coverage"\n'
        'target = "plain-app"\n'
        "\n"
        "[[measures]]\n"
        'key = "line_coverage"\n'
        'label = "Line coverage"\n'
        "value = 91.25\n"
        'unit = "percent"\n'
        'direction = "higher_is_better"\n'
        "\n"
        "[[measures]]\n"
        'key = "tests_run"\n'
        'label = "Tests run"\n'
        "value = 120\n"
        'unit = "tests"\n'
        'direction = "higher_is_better"\n'
        'target = "other-app"\n'
    )
    empty_file = tmp_path / "empty.json"
    empty_file.write_text(json.dumps({"schema_version": "1.0", "measures": []}))

    loaded = load_measures_files([json_file, toml_file, empty_file])
    assert [m.describe() for m in loaded] == [
        {
            "key": "files_over_warn",
            "label": "Files over size warning",
            "value": 4,
            "unit": "files",
            "direction": "lower_is_better",
            "source": "sweep-bloat",
        },
        {
            "key": "cognitive_findings",
            "label": "Cognitive complexity findings",
            "value": 7,
            "unit": "findings",
            "direction": "lower_is_better",
            "source": "complexity-scan",
        },
        {
            "key": "line_coverage",
            "label": "Line coverage",
            "value": 91.25,
            "unit": "percent",
            "direction": "higher_is_better",
            "target": "plain-app",
            "source": "coverage",
        },
        {
            "key": "tests_run",
            "label": "Tests run",
            "value": 120,
            "unit": "tests",
            "direction": "higher_is_better",
            "target": "other-app",
            "source": "coverage",
        },
    ]


def test_load_measures_allows_same_key_across_different_targets_and_rejects_duplicates(tmp_path):
    first = tmp_path / "a.json"
    second = tmp_path / "b.json"
    first.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "measures": [
                    {
                        "key": "line_coverage",
                        "label": "Line coverage",
                        "value": 80,
                        "unit": "percent",
                        "direction": "higher_is_better",
                    },
                    {
                        "key": "line_coverage",
                        "label": "Line coverage",
                        "value": 90,
                        "unit": "percent",
                        "direction": "higher_is_better",
                        "target": "unit-a",
                    },
                ],
            }
        )
    )
    second.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "measures": [
                    {
                        "key": "line_coverage",
                        "label": "Line coverage",
                        "value": 85,
                        "unit": "percent",
                        "direction": "higher_is_better",
                        "target": "unit-b",
                    }
                ],
            }
        )
    )
    loaded = load_measures_files([first, second])
    assert [(m.key, m.target) for m in loaded] == [
        ("line_coverage", None),
        ("line_coverage", "unit-a"),
        ("line_coverage", "unit-b"),
    ]

    duplicate = tmp_path / "dup.json"
    duplicate.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "measures": [
                    {
                        "key": "line_coverage",
                        "label": "Line coverage",
                        "value": 75,
                        "unit": "percent",
                        "direction": "higher_is_better",
                        "target": "unit-a",
                    }
                ],
            }
        )
    )
    with pytest.raises(ValueError, match="Duplicate measure"):
        load_measures_files([first, duplicate])


@pytest.mark.parametrize(
    "payload",
    [
        {"measures": []},
        {"schema_version": "2.0", "measures": []},
        {"schema_version": "1.0", "measures": [], "extra": 1},
        {"schema_version": "1.0", "source": 123, "measures": []},
        {"schema_version": "1.0", "source": "bad source", "measures": []},
        {"schema_version": "1.0", "target": None, "measures": []},
        {"schema_version": "1.0", "measures": "not-a-list"},
        {"schema_version": "1.0", "measures": ["not-an-object"]},
        {
            "schema_version": "1.0",
            "measures": [{"key": "k", "label": "L", "value": 1, "unit": "u"}],
        },
        {
            "schema_version": "1.0",
            "measures": [
                {
                    "key": "k",
                    "label": "L",
                    "value": 1,
                    "unit": "u",
                    "direction": "neutral",
                    "unknown": True,
                }
            ],
        },
        {
            "schema_version": "1.0",
            "measures": [
                {"key": "k", "label": "L", "value": 1, "unit": "u", "direction": "neutral"},
                {"key": "k", "label": "L2", "value": 2, "unit": "u", "direction": "neutral"},
            ],
        },
    ],
)
def test_measures_from_mapping_rejects_malformed_inputs(payload):
    with pytest.raises(ValueError):
        measures_from_mapping(payload)


def test_load_measures_rejects_non_finite_json_non_object_and_oversized_file(tmp_path):
    nan_file = tmp_path / "nan.json"
    nan_file.write_text(
        '{"schema_version":"1.0","measures":['
        '{"key":"k","label":"L","value":NaN,"unit":"u","direction":"neutral"}]}'
    )
    with pytest.raises(ValueError, match="Non-finite"):
        load_measures(nan_file)

    array_file = tmp_path / "array.json"
    array_file.write_text("[]")
    with pytest.raises(ValueError, match="object"):
        load_measures(array_file)

    with pytest.raises(ValueError, match="regular file"):
        load_measures(tmp_path)

    fifo_stub = type("S", (), {"st_mode": stat.S_IFIFO | 0o600, "st_size": 0})()
    with (
        patch.object(Path, "stat", return_value=fifo_stub),
        pytest.raises(ValueError, match="regular file"),
    ):
        load_measures(array_file)

    big_file = tmp_path / "big.json"
    big_file.write_text("{}")
    reg_big = type(
        "S", (), {"st_mode": stat.S_IFREG | 0o600, "st_size": MAX_MEASURES_FILE_BYTES + 1}
    )()
    with (
        patch.object(Path, "stat", return_value=reg_big),
        pytest.raises(ValueError, match="exceeds"),
    ):
        load_measures(big_file)

    # A file that grows past the cap after stat() is still stopped by the bounded read.
    reg_small = type("S", (), {"st_mode": stat.S_IFREG | 0o600, "st_size": 0})()
    growing_stream = io.BytesIO(b"x" * (MAX_MEASURES_FILE_BYTES + 10))
    growing_stream.fileno = lambda: 0  # type: ignore[method-assign]
    with (
        patch.object(Path, "stat", return_value=reg_small),
        patch.object(Path, "open", return_value=growing_stream),
        patch("lushly_health.measures.os.fstat", return_value=reg_small),
        pytest.raises(ValueError, match="exceeds"),
    ):
        load_measures(big_file)

    with pytest.raises(ValueError, match="iterable"):
        load_measures_files("measures.json")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="iterable"):
        load_measures_files(big_file)  # type: ignore[arg-type]


def test_safe_integer_boundaries_round_trip_and_huge_values_exit_2_in_cli(
    tmp_path, project, capsys
):
    bounds = (
        Measure("max_safe", "Max safe", MAX_SAFE_MEASURE_VALUE, "count", "neutral"),
        Measure("min_safe", "Min safe", -MAX_SAFE_MEASURE_VALUE, "count", "neutral"),
    )
    report = audit(
        (Target("plain-app", project, "typescript"),),
        Policy(("gitattributes_lf",)),
        measures=bounds,
    )
    VALIDATOR.validate(report)

    base = [
        "audit",
        "--target",
        "plain-app",
        str(project),
        "typescript",
        "--check",
        "gitattributes_lf",
    ]
    for name, raw_value in (("huge.json", str(10**309)), ("unsafe.json", "9007199254740993")):
        bad = tmp_path / name
        bad.write_text(
            '{"schema_version":"1.0","measures":[{"key":"k","label":"K",'
            f'"value":{raw_value},"unit":"count","direction":"neutral"}}]}}'
        )
        assert main([*base, "--measures", str(bad)]) == 2
    capsys.readouterr()


def test_audit_carries_measures_without_affecting_verdict_or_mutating_target(project):
    before = snapshot(project)
    measures = (
        Measure(
            key="files_over_warn",
            label="Files over size warning",
            value=99,
            unit="files",
            direction="lower_is_better",
            source="sweep-bloat",
        ),
        Measure(
            key="line_coverage",
            label="Line coverage",
            value=12.5,
            unit="percent",
            direction="higher_is_better",
            target="plain-app",
            source="coverage",
        ),
    )
    report = audit(
        (Target("plain-app", project, "typescript"),),
        Policy(("gitattributes_lf",)),
        measures=measures,
    )
    VALIDATOR.validate(report)
    assert report["schema_version"] == "1.3"
    assert report["verdict"] == {"status": "passed", "required_count": 1, "blocking_count": 0}
    assert len(report["measures"]) == 2
    assert snapshot(project) == before

    with pytest.raises(ValueError, match="unknown target"):
        audit(
            (Target("plain-app", project, "typescript"),),
            Policy(("gitattributes_lf",)),
            measures=(Measure("x", "X", 1, "count", "neutral", target="missing-target"),),
        )


def test_cli_measures_option_reads_multiple_files_and_fails_cleanly_on_invalid(
    tmp_path, project, capsys
):
    m1 = tmp_path / "m1.json"
    m2 = tmp_path / "m2.toml"
    m1.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "source": "sweep",
                "measures": [
                    {
                        "key": "hotspots",
                        "label": "Hotspots",
                        "value": 3,
                        "unit": "files",
                        "direction": "lower_is_better",
                    }
                ],
            }
        )
    )
    m2.write_text(
        'schema_version = "1.0"\n'
        "[[measures]]\n"
        'key = "tests_run"\n'
        'label = "Tests run"\n'
        "value = 42\n"
        'unit = "tests"\n'
        'direction = "higher_is_better"\n'
        'target = "plain-app"\n'
    )
    base = [
        "audit",
        "--target",
        "plain-app",
        str(project),
        "typescript",
        "--check",
        "gitattributes_lf",
    ]
    assert main([*base, "--measures", str(m1), "--measures", str(m2)]) == 0
    report = json.loads(capsys.readouterr().out)
    VALIDATOR.validate(report)
    assert [m["key"] for m in report["measures"]] == ["hotspots", "tests_run"]

    assert main([*base, "--measures", str(tmp_path / "missing.json")]) == 2
    assert main([*base, "--measures", str(m1), "--measures", str(m1)]) == 2
    capsys.readouterr()

    declared = capabilities()
    assert declared["measures_schema_version"] == MEASURES_SCHEMA_VERSION == "1.0"
    assert declared["measure_directions"] == list(MEASURE_DIRECTIONS)
