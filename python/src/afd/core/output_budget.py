"""Per-command output budgets (``spec/output-budgets.md``, B1–B8).

A command **declares** a budget (:class:`OutputBudget`), a caller **asks** for a
smaller or larger one per call, the handler **fits** its result to the effective
budget (``context.output_budget``), and the engine **checks** the result
afterwards. An over-budget read becomes an ``OUTPUT_BUDGET_EXCEEDED`` failure;
an over-budget mutation keeps its result with a caution warning. Nothing
truncates structured output.
"""

from __future__ import annotations

import contextlib
import math
from collections.abc import Iterator, Mapping
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from afd.core.errors import CommandError, ErrorCodes
from afd.core.journal import canonical_json
from afd.core.metadata import Warning, WarningSeverity
from afd.core.result import CommandResult, ResultMetadata, error, failure
from afd.core.wire import to_wire

__all__ = [
    "AFD_OUTPUT_BUDGET_META_KEY",
    "MAX_OUTPUT_BUDGET_BYTES",
    "OutputBudget",
    "apply_output_budget",
    "ask_validation_failure",
    "ask_value",
    "bind_output_budget_ask",
    "check_output_budget",
    "coerce_budgeted_result",
    "current_output_budget_ask",
    "measure_result_bytes",
    "normalize_ask_option",
    "output_budget_ask_from_meta",
    "over_budget_error",
    "parse_ask",
    "validate_output_budget_declaration",
]

AFD_OUTPUT_BUDGET_META_KEY = "dev.afd/outputBudget"
"""The ``_meta`` and result ``metadata`` key for output budgets.

Carries three shapes in three places:
- declaration on a tool's ``_meta``: ``{"defaultBytes": d, "maxBytes": m}``
- ask on a call's ``_meta``: ``{"maxBytes": n}``
- report in a result's ``metadata``: ``{"limitBytes": limit, "usedBytes": used}``
"""

MAX_OUTPUT_BUDGET_BYTES = 9_007_199_254_740_991
"""Largest safe integer (2^53 - 1): the largest budget allowed by B1 and B2."""

# The raw ``_meta["dev.afd/outputBudget"]`` value of the MCP ``tools/call`` being
# served, bound by the server around the call and read by the tool router.
_REQUEST_OUTPUT_BUDGET_ASK: ContextVar[Any] = ContextVar("afd_output_budget_ask", default=None)


def _positive_json_integer(value: Any) -> int | None:
    """An integer from 1 to :data:`MAX_OUTPUT_BUDGET_BYTES` as JSON/JS reads one.

    Rejects ``bool`` (even though ``bool`` subclasses ``int`` in Python),
    non-finite floats, fractional floats, strings, and values outside
    ``1..=MAX_OUTPUT_BUDGET_BYTES``. Accepts integral finite floats (e.g.
    ``100.0`` from JSON) as ``int``.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 1 <= value <= MAX_OUTPUT_BUDGET_BYTES else None
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return None
        whole = int(value)
        return whole if 1 <= whole <= MAX_OUTPUT_BUDGET_BYTES else None
    return None


def _is_strict_budget_int(value: Any) -> bool:
    """Strict Python ``int`` (never ``bool`` or ``float``) within ``1..=MAX_OUTPUT_BUDGET_BYTES``."""
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= MAX_OUTPUT_BUDGET_BYTES
    )


@dataclass(frozen=True)
class OutputBudget:
    """A command's declared output budget: default and maximum bytes (B1).

    Both values must be integers from ``1`` to ``9007199254740991`` with
    ``default_bytes <= max_bytes``. Checked when the command is defined or
    registered.
    """

    default_bytes: int
    max_bytes: int

    def check(self) -> None:
        """Validate bounds, raising :class:`ValueError` naming the offending field."""
        for field_name, value in (
            ("defaultBytes", self.default_bytes),
            ("maxBytes", self.max_bytes),
        ):
            if not _is_strict_budget_int(value):
                raise ValueError(
                    f"outputBudget.{field_name} must be an integer from 1 to "
                    f"{MAX_OUTPUT_BUDGET_BYTES}, not {value!r}"
                )
        if self.default_bytes > self.max_bytes:
            raise ValueError(
                f"outputBudget.defaultBytes ({self.default_bytes}) must not be above "
                f"outputBudget.maxBytes ({self.max_bytes})"
            )

    @classmethod
    def from_value(cls, value: Any) -> OutputBudget:
        """Parse and validate a JSON declaration ``{"defaultBytes": d, "maxBytes": m}``."""
        if not isinstance(value, Mapping):
            raise ValueError("outputBudget must be an object { defaultBytes, maxBytes }")
        for key in value:
            if key not in ("defaultBytes", "maxBytes"):
                raise ValueError(
                    f"outputBudget has an unknown member {key!r}; "
                    "it takes only defaultBytes and maxBytes"
                )
        raw_default = value.get("defaultBytes") if "defaultBytes" in value else None
        if not isinstance(raw_default, int) or not _is_strict_budget_int(raw_default):
            raise ValueError(
                f"outputBudget.defaultBytes must be an integer from 1 to {MAX_OUTPUT_BUDGET_BYTES}"
            )
        raw_max = value.get("maxBytes") if "maxBytes" in value else None
        if not isinstance(raw_max, int) or not _is_strict_budget_int(raw_max):
            raise ValueError(
                f"outputBudget.maxBytes must be an integer from 1 to {MAX_OUTPUT_BUDGET_BYTES}"
            )
        budget = cls(default_bytes=raw_default, max_bytes=raw_max)
        budget.check()
        return budget

    def effective(self, ask: int | None) -> int:
        """Effective budget for a call with ``ask`` (B3): ``min(ask, max_bytes)`` or ``default_bytes``."""
        if ask is None:
            return self.default_bytes
        return min(ask, self.max_bytes)

    def to_wire_dict(self) -> dict[str, int]:
        """Wire JSON shape ``{"defaultBytes": d, "maxBytes": m}``."""
        return {"defaultBytes": self.default_bytes, "maxBytes": self.max_bytes}


def validate_output_budget_declaration(command_name: str, budget: Any) -> OutputBudget | None:
    """Validate and normalize a command's ``output_budget`` declaration (B1).

    Raises :class:`ValueError` naming both ``command_name`` and the field when invalid.
    """
    if budget is None:
        return None
    try:
        if isinstance(budget, OutputBudget):
            budget.check()
            return budget
        return OutputBudget.from_value(budget)
    except ValueError as exc:
        raise ValueError(f"Command '{command_name}': {exc}") from None


def ask_value(max_bytes: Any) -> dict[str, Any]:
    """``{"maxBytes": max_bytes}``, the ask in its ``_meta`` form."""
    return {"maxBytes": max_bytes}


def normalize_ask_option(value: Any) -> Any:
    """Normalize an in-process ``output_budget`` call option to the ``_meta`` ask shape.

    ``None`` stays ``None`` (no ask). A mapping is passed through so extra or
    missing keys still fail validation; any other value (including an ``int`` or
    an invalid value like ``0`` or ``True``) is wrapped as ``{"maxBytes": value}``.
    """
    if value is None:
        return None
    if isinstance(value, Mapping):
        return dict(value)
    return ask_value(value)


def parse_ask(value: Any) -> int | None:
    """Parse an ask in ``_meta`` form: ``{"maxBytes": n}`` with no extra members.

    Returns ``n`` as an ``int`` when valid, or ``None`` for anything else.
    """
    if not isinstance(value, Mapping) or len(value) != 1 or "maxBytes" not in value:
        return None
    return _positive_json_integer(value["maxBytes"])


def output_budget_ask_from_meta(meta: Any) -> Any:
    """Read ``_meta["dev.afd/outputBudget"]`` from a request's ``_meta``, or ``None``."""
    if not isinstance(meta, Mapping):
        return None
    value = meta.get(AFD_OUTPUT_BUDGET_META_KEY)
    return None if value is None else value


@contextlib.contextmanager
def bind_output_budget_ask(ask: Any) -> Iterator[None]:
    """Bind the current MCP call's raw output budget ask for its duration."""
    token = _REQUEST_OUTPUT_BUDGET_ASK.set(ask)
    try:
        yield
    finally:
        _REQUEST_OUTPUT_BUDGET_ASK.reset(token)


def current_output_budget_ask() -> Any:
    """The raw output budget ask bound for the current MCP call, or ``None``."""
    return _REQUEST_OUTPUT_BUDGET_ASK.get()


def ask_validation_failure() -> CommandResult[Any]:
    """The ``VALIDATION_ERROR`` result for an invalid output budget ask (B2)."""
    return error(
        ErrorCodes.VALIDATION_ERROR,
        "The output budget ask is not valid",
        suggestion=(
            f'Send _meta["{AFD_OUTPUT_BUDGET_META_KEY}"] = '
            '{ "maxBytes": <positive integer> }, or leave it out'
        ),
        retryable=False,
        details={
            "field": "outputBudget",
            "meta": AFD_OUTPUT_BUDGET_META_KEY,
        },
    )


def apply_output_budget(command: Any, context: Any) -> tuple[int | None, CommandResult[Any] | None]:
    """Validate the call's ask and stamp the effective budget on ``context`` (B2–B4).

    The ask is validated even when ``command`` declares no output budget, and
    then ignored if there is no declaration. Returns ``(effective_budget, None)``
    on success, or ``(None, VALIDATION_ERROR result)`` on an invalid ask.
    """
    raw_ask = getattr(context, "_output_budget_ask", None)
    ask: int | None = None
    if raw_ask is not None:
        ask = parse_ask(raw_ask)
        if ask is None:
            return None, ask_validation_failure()
    declaration: OutputBudget | None = getattr(command, "output_budget", None)
    effective = declaration.effective(ask) if declaration is not None else None
    with contextlib.suppress(AttributeError, TypeError):
        context.output_budget = effective
    return effective, None


def coerce_budgeted_result(result: Any) -> CommandResult[Any] | None:
    """Return ``result`` as a :class:`CommandResult` when it is one or a valid envelope dict."""
    if isinstance(result, CommandResult):
        return result
    if isinstance(result, dict) and isinstance(result.get("success"), bool):
        try:
            return CommandResult.model_validate(result)
        except ValueError:
            return None
    return None


def measure_result_bytes(result: CommandResult[Any] | Mapping[str, Any]) -> int:
    """UTF-8 byte length of canonical JSON of ``result`` with ``metadata`` omitted (B5 step 2)."""
    wire = to_wire(result)
    if isinstance(wire, dict):
        wire = {key: value for key, value in wire.items() if key != "metadata"}
    return len(canonical_json(wire).encode("utf-8"))


def over_budget_error(limit: int, actual: int, max_bytes: int) -> CommandError:
    """The ``OUTPUT_BUDGET_EXCEEDED`` error replacing an over-budget read (B5 rule 4)."""
    if limit < max_bytes:
        suggestion = (
            "Narrow the request (fewer results, a smaller window or a filter), "
            f"or ask for up to {max_bytes} bytes with "
            f'_meta["{AFD_OUTPUT_BUDGET_META_KEY}"] = {{ "maxBytes": {max_bytes} }}.'
        )
    else:
        suggestion = (
            "Narrow the request (fewer results, a smaller window or a filter); "
            f"{max_bytes} bytes is this command's largest output budget."
        )
    return CommandError(
        code=ErrorCodes.OUTPUT_BUDGET_EXCEEDED,
        message=f"The result is {actual} bytes, over this call's output budget of {limit} bytes",
        suggestion=suggestion,
        retryable=False,
        details={
            "limitBytes": limit,
            "actualBytes": actual,
            "maxBytes": max_bytes,
        },
    )


def check_output_budget(
    command: Any,
    limit: int | None,
    result: CommandResult[Any],
) -> CommandResult[Any]:
    """Check ``result`` against the call's effective budget ``limit`` (B5, B6).

    - Unbudgeted calls and handler failures pass unchanged with no report.
    - Over-budget reads are replaced with an ``OUTPUT_BUDGET_EXCEEDED`` failure.
    - Over-budget mutations keep their result, gain a caution warning (not
      counted in ``usedBytes``), and carry the report.
    - Within-budget results carry ``metadata["dev.afd/outputBudget"]``.
    """
    declaration: OutputBudget | None = getattr(command, "output_budget", None)
    if limit is None or declaration is None or not result.success:
        return result

    used = measure_result_bytes(result)
    is_mutation = bool(getattr(command, "mutation", False))
    if used > limit and not is_mutation:
        return failure(over_budget_error(limit, used, declaration.max_bytes))

    updates: dict[str, Any] = {}
    if used > limit:
        warning = Warning(
            code=ErrorCodes.OUTPUT_BUDGET_EXCEEDED,
            message=(
                f"The result is {used} bytes, over this call's output budget of "
                f"{limit} bytes; the change was made"
            ),
            severity=WarningSeverity.CAUTION,
            details={
                "limitBytes": limit,
                "actualBytes": used,
            },
        )
        updates["warnings"] = [*list(result.warnings or ()), warning]

    report = {"limitBytes": limit, "usedBytes": used}
    if result.metadata is not None:
        metadata = result.metadata.model_copy(update={AFD_OUTPUT_BUDGET_META_KEY: report})
    else:
        metadata = ResultMetadata.model_validate({AFD_OUTPUT_BUDGET_META_KEY: report})
    updates["metadata"] = metadata
    return result.model_copy(update=updates)
