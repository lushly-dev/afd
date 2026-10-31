"""Declared context fields: named, validated request values a host declares.

A context field is a value that belongs to a request rather than to one
command's input, such as the project a shell is scoped to or a locale. A call
carries it in ``context.extra`` under the field's name; the server validates it
with the field's schema before middleware and the handler run, and the journal
keeps the fields declared ``journal=True``.

Mirrors ``packages/server/src/context-fields.ts``; the rules are
``spec/context-fields.md``.

Example:
    >>> class Scope(BaseModel):
    ...     project: str
    >>> server = create_server(
    ...     "shell",
    ...     context_fields=[
    ...         ContextField(name="scope", meta="dev.example/scope", schema=Scope, journal=True),
    ...         ContextField(name="locale", meta="dev.example/locale", schema=str),
    ...     ],
    ... )
    >>> await server.execute("todo-list", {}, CommandContext(extra={"scope": {"project": "p-1"}}))
"""

from __future__ import annotations

import contextlib
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import TypeAdapter
from pydantic import ValidationError as PydanticValidationError

from afd.core.result import CommandResult, error

__all__ = [
    "ContextField",
    "apply_context_fields",
    "check_context_fields",
]

# Context keys AFD sets itself, which a declared field cannot take: TypeScript's list, the
# fields of Python's CommandContext classes (core and DirectClient) and their camelCase or
# snake_case forms, and the ``extra`` keys the MCP router sets.
_RESERVED_NAMES = frozenset(
    {
        # spec/context-fields.md and packages/server/src/context-fields.ts
        "actor",
        "approval",
        "auth",
        "clock",
        "credentials",
        "interface",
        "random",
        "session",
        "signal",
        "timeout",
        "traceId",
        # CommandContext fields (afd.core.commands and afd.direct)
        "trace_id",
        "extra",
        "source",
        "_direct_approval",
        "direct_approval",
        "directApproval",
        # extra keys the MCP router sets
        "remote",
        "active_context",
        "activeContext",
    }
)

_LABEL = "[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
# A reverse-DNS prefix of two or more labels, a slash, then the key's name.
_META_KEY = re.compile(
    rf"^{_LABEL}(?:\.{_LABEL})+/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$"
)
_RESERVED_LABELS = frozenset({"mcp", "modelcontextprotocol"})

# Set on a context the server validated: the names of the declared fields marked
# ``journal=True``, for the journal middleware. Underscored, so the context digest never
# counts it among the context's keys. (TypeScript keeps it under a symbol.)
JOURNALED_CONTEXT_FIELDS = "_afd_journaled_context_fields"


@dataclass
class ContextField:
    """A request value a host declares: where it lands in the context and how it is validated.

    Attributes:
        name: The ``context.extra`` key the value lands under. Not a key AFD uses itself.
        meta: The MCP ``_meta`` key a caller sends the value in: a reverse-DNS
            prefix, such as ``dev.example/scope``.
        schema: Validates the value: a Pydantic model, any type
            ``pydantic.TypeAdapter`` accepts (``str``, ``Annotated[...]``, a
            ``TypedDict``) or a ``TypeAdapter``. Its output is what the handler
            sees, so a model schema gives the handler a model instance.
        journal: Record the value in the journal. Default ``False``: only for a
            field that never holds a secret.
        required: Fail a call that has no value for this field. Default ``False``.
    """

    name: str
    meta: str
    schema: Any
    journal: bool = False
    required: bool = False
    _adapter: TypeAdapter[Any] | None = field(default=None, init=False, repr=False, compare=False)

    def validate(self, value: Any) -> Any:
        """``value`` validated by the field's schema.

        Raises:
            pydantic.ValidationError: when the value does not match the schema.
        """
        if self._adapter is None:
            self._adapter = _adapter_for(self)
        return self._adapter.validate_python(value)


def _adapter_for(field: ContextField) -> TypeAdapter[Any]:
    if isinstance(field.schema, TypeAdapter):
        return field.schema
    if field.schema is None:
        raise TypeError(f"Context field '{field.name}' needs a schema")
    try:
        return TypeAdapter(field.schema)
    except Exception as exc:
        raise TypeError(
            f"Context field '{field.name}' needs a schema pydantic can validate with "
            "(a model, a type or a TypeAdapter)"
        ) from exc


def check_context_fields(
    fields: Sequence[ContextField | Mapping[str, Any]] | None,
) -> list[ContextField]:
    """Check declarations when a server is created.

    Mappings are accepted in place of :class:`ContextField` and converted.

    Returns:
        The fields, as :class:`ContextField` objects with their schemas compiled.

    Raises:
        ValueError: naming the field, for an empty, reserved or repeated name, a
            ``meta`` key without a reverse-DNS prefix or with a reserved one
            (``dev.afd/``, or a label ``mcp`` or ``modelcontextprotocol``), or a
            repeated ``meta`` key.
        TypeError: for a declaration that is not a field, or a schema pydantic
            cannot validate with.
    """
    if fields is None:
        return []
    if isinstance(fields, (str, bytes, Mapping)) or not isinstance(fields, Sequence):
        raise TypeError("context_fields must be a list of ContextField")
    checked: list[ContextField] = []
    names: set[str] = set()
    meta_keys: set[str] = set()
    for item in fields:
        declared = _as_field(item)
        name, meta = declared.name, declared.meta
        if not isinstance(name, str) or name == "":
            raise ValueError("A context field needs a non-empty name")
        if name in _RESERVED_NAMES:
            raise ValueError(
                f"Context field '{name}' uses a name AFD sets itself; choose another name"
            )
        if name in names:
            raise ValueError(f"Context field '{name}' is declared twice")
        if not isinstance(meta, str) or not _META_KEY.match(meta):
            raise ValueError(
                f"Context field '{name}' needs a meta key with a reverse-DNS prefix, "
                f"such as 'dev.example/{name}'"
            )
        labels = meta[: meta.index("/")].lower().split(".")
        if meta.lower().startswith("dev.afd/") or any(label in _RESERVED_LABELS for label in labels):
            raise ValueError(
                f"Context field '{name}' uses the reserved meta prefix of '{meta}'; "
                "use your own domain"
            )
        if meta in meta_keys:
            raise ValueError(f"Meta key '{meta}' is declared twice")
        declared._adapter = _adapter_for(declared)
        names.add(name)
        meta_keys.add(meta)
        checked.append(declared)
    return checked


def _as_field(item: Any) -> ContextField:
    if isinstance(item, ContextField):
        return item
    if isinstance(item, Mapping):
        try:
            return ContextField(**item)
        except TypeError as exc:
            raise TypeError(f"Not a context field declaration: {exc}") from None
    raise TypeError(f"Not a context field declaration: {type(item).__name__}")


def apply_context_fields(
    fields: Sequence[ContextField], context: Any, command_name: str | None = None
) -> CommandResult[Any] | None:
    """Validate a call's declared fields on ``context``.

    Each value in ``context.extra`` is replaced by its schema's output, in a
    new ``extra`` dict so the caller's dict keeps what it sent, and the
    journaled names are marked for the journal. A value of ``None`` counts as
    no value. ``required`` is not enforced for AFD's own commands (a
    ``command_name`` starting with ``afd-``), so a client can discover the
    fields before it sends them; a value they do get is still validated.

    Returns:
        A ``VALIDATION_ERROR`` result for an invalid value or a missing
        required one, else ``None``.
    """
    if not fields:
        return None
    enforce_required = not (command_name or "").startswith("afd-")
    extra = getattr(context, "extra", None)
    values = dict(extra) if isinstance(extra, dict) else {}
    for declared in fields:
        value = values.get(declared.name)
        if value is None:
            if declared.required and enforce_required:
                return _field_failure(
                    declared,
                    f"Context field '{declared.name}' is required",
                    [{"path": "", "message": "Required"}],
                )
            continue
        try:
            values[declared.name] = declared.validate(value)
        except PydanticValidationError as exc:
            return _field_failure(
                declared,
                f"Context field '{declared.name}' is not valid",
                [
                    {
                        "path": ".".join(str(part) for part in issue.get("loc", ())),
                        "message": issue.get("msg", "Invalid value"),
                    }
                    for issue in exc.errors()
                ],
            )
        except Exception as exc:
            # A validator that raises something other than ValueError or AssertionError.
            return _field_failure(
                declared,
                f"Context field '{declared.name}' is not valid",
                [{"path": "", "message": str(exc) or type(exc).__name__}],
            )
    try:
        context.extra = values
    except (AttributeError, TypeError):
        if isinstance(extra, dict):
            extra.update(values)
    journaled = tuple(declared.name for declared in fields if declared.journal)
    with contextlib.suppress(AttributeError, TypeError):
        setattr(context, JOURNALED_CONTEXT_FIELDS, journaled)
    return None


def _field_failure(
    declared: ContextField, message: str, errors: list[dict[str, Any]]
) -> CommandResult[Any]:
    tail = "; it is required" if declared.required else ", or leave it out"
    return error(
        "VALIDATION_ERROR",
        message,
        suggestion=(
            f"Send '{declared.name}' in _meta[\"{declared.meta}\"] as its schema describes "
            f"(server/discover lists it under _meta[\"dev.afd/context-fields\"]){tail}"
        ),
        details={"field": declared.name, "meta": declared.meta, "errors": errors},
    )
