"""The ``meta`` argument of the meta-tools (``spec/command-metadata.md``, "Decisions on the
tool surface (#466)"; ``spec/context-fields.md``, "Clients that cannot set ``_meta``").

``afd-call``, ``afd-batch``, ``afd-pipe``, ``afd-discover`` and ``afd-detail`` take an optional
``meta`` object for clients that cannot set ``_meta``. Its keys are ``dev.afd/context`` and the
declared context fields' ``_meta`` keys, and the server applies them as if the request had sent
them in ``_meta``, before it reads ``_meta``. Other keys are dropped, as undeclared ``_meta``
keys are. A key sent both ways must agree, or the call fails with ``VALIDATION_ERROR``.

Mirrors ``packages/server/src/meta-argument.ts``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from afd.core.builtin_names import AFD_META_TOOL_NAMES
from afd.core.errors import CommandError
from afd.server.bootstrap.afd_context import AFD_CONTEXT_META_KEY
from afd.server.context_fields import ContextField

__all__ = [
    "META_ARGUMENT_DESCRIPTION",
    "LiftedMetaArgument",
    "lift_meta_argument",
    "meta_argument_keys",
]

META_ARGUMENT_DESCRIPTION = (
    "Request values for clients that cannot set _meta: dev.afd/context and the server's "
    "declared context fields' _meta keys, applied as if sent in _meta"
)
"""The description of the ``meta`` property in each meta-tool's input schema."""


def meta_argument_keys(fields: Sequence[ContextField] | None) -> frozenset[str]:
    """The keys a ``meta`` argument may carry on a server with these declared fields."""
    return frozenset([AFD_CONTEXT_META_KEY, *(field.meta for field in fields or ())])


@dataclass(frozen=True)
class LiftedMetaArgument:
    """A call with a meta-tool's ``meta`` argument moved into ``meta``, or the refusal."""

    arguments: Any
    meta: Any
    error: CommandError | None = None


def lift_meta_argument(
    tool_name: str, arguments: Any, meta: Any, keys: frozenset[str] | set[str]
) -> LiftedMetaArgument:
    """Move a meta-tool's ``meta`` argument into the request's ``_meta`` values.

    Calls to other tools, and meta-tool calls without ``meta``, come back unchanged.

    Args:
        tool_name: The tool called.
        arguments: The call's arguments.
        meta: The request's ``_meta`` values.
        keys: The keys the argument may carry (``meta_argument_keys``).
    """
    if (
        tool_name not in AFD_META_TOOL_NAMES
        or not isinstance(arguments, Mapping)
        or "meta" not in arguments
    ):
        return LiftedMetaArgument(arguments, meta)
    rest = {key: value for key, value in arguments.items() if key != "meta"}
    argument = arguments["meta"]
    if argument is None:
        return LiftedMetaArgument(rest, meta)
    if not isinstance(argument, Mapping):
        return LiftedMetaArgument(
            rest,
            meta,
            CommandError(
                code="VALIDATION_ERROR",
                message=f"The meta argument of {tool_name} must be an object",
                suggestion=(
                    "Send meta as an object whose keys are _meta keys: "
                    + ", ".join(sorted(keys))
                ),
                details={"argument": "meta"},
            ),
        )
    sent: Mapping[str, Any] = meta if isinstance(meta, Mapping) else {}
    merged = dict(sent)
    for key, value in argument.items():
        if key not in keys or value is None:
            continue
        other = sent.get(key)
        if other is not None and not _same_json(other, value):
            return LiftedMetaArgument(
                rest,
                meta,
                CommandError(
                    code="VALIDATION_ERROR",
                    message=f'_meta["{key}"] and the meta argument of {tool_name} disagree',
                    suggestion=(
                        f"Send {key} in _meta or in the meta argument, or the same value in both"
                    ),
                    details={"meta": key},
                ),
            )
        merged[key] = value
    return LiftedMetaArgument(rest, merged)


def _same_json(a: Any, b: Any) -> bool:
    """Whether two JSON values are equal, ignoring object key order."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (list, tuple)) or isinstance(b, (list, tuple)):
        return (
            isinstance(a, (list, tuple))
            and isinstance(b, (list, tuple))
            and len(a) == len(b)
            and all(_same_json(x, y) for x, y in zip(a, b, strict=True))
        )
    if isinstance(a, Mapping) or isinstance(b, Mapping):
        if not (isinstance(a, Mapping) and isinstance(b, Mapping)):
            return False
        # JSON has no undefined, so every member counts, null ones included.
        return set(a) == set(b) and all(_same_json(a[key], b[key]) for key in a)
    return a == b
