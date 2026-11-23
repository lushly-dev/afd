"""Wire (JSON) format shared by the TypeScript, Python and Rust AFD packages.

AFD results cross language boundaries as JSON, so every implementation
serializes them the same way (see ``spec/wire/README.md``):

- keys are camelCase (``executionTimeMs``, ``undoCommand``, ``successCount``);
- optional fields that are not set are omitted, never ``null``. The one
  exception is ``data`` on a result, a pipeline step or a pipeline result:
  ``null`` is a value there, so ``data`` set to ``None`` is sent as
  ``"data": null`` and only ``data`` never set is omitted, as in TypeScript.

Python attribute names stay snake_case. The result models use
:data:`WIRE_MODEL_CONFIG` (a camelCase alias generator), so they parse both
camelCase (TypeScript/Rust servers) and snake_case (older Python peers), and
:func:`to_wire` produces the JSON shape.

Example:
    >>> from afd import success
    >>> from afd.core.wire import to_wire
    >>> to_wire(success({"id": "1"}, undo_command="todo-delete"))
    {'success': True, 'data': {'id': '1'}, 'undoCommand': 'todo-delete'}
"""

from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    SerializationInfo,
    SerializerFunctionWrapHandler,
    ValidationInfo,
)
from pydantic.alias_generators import to_camel
from pydantic_core import to_jsonable_python

WIRE_MODEL_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)
"""Model config for wire models: camelCase aliases, snake_case names accepted."""


class WireModel(BaseModel):
    """Base class for models that cross the wire.

    Fields serialize under camelCase aliases (``model_dump(by_alias=True)``),
    and validation accepts either the alias or the snake_case field name.
    """

    model_config = WIRE_MODEL_CONFIG


WIRE_ENVELOPE: dict[str, Any] = {"afd_wire_envelope": True}
"""Validation context for a batch or pipeline request received over the wire.

``model_validate(payload, context=WIRE_ENVELOPE)`` applies the envelope rules
of TypeScript's ``isBatchRequest`` and ``isPipelineRequest``, where an optional
field may be omitted but never ``null``. Python code that builds the models
directly may still pass ``None``.
"""


def omitted_not_null(value: Any, info: ValidationInfo) -> Any:
    """Body of a before-mode field validator: reject ``null`` in a wire envelope.

    Pydantic runs before-mode field validators only for values that are given,
    so an omitted field keeps its default.
    """
    if value is None and info.context and info.context.get("afd_wire_envelope"):
        raise ValueError("Omit the field instead of sending null")
    return value


def json_number(value: Any, info: ValidationInfo) -> Any:
    """Body of a before-mode field validator: accept only a JSON number.

    Pydantic's lax mode would read ``true`` as 1 and ``"20"`` as 20, which
    TypeScript rejects.
    """
    if isinstance(value, (bool, str)):
        raise ValueError("Input should be a number")
    return omitted_not_null(value, info)


def keep_null_data(
    model: BaseModel, handler: SerializerFunctionWrapHandler, info: SerializationInfo
) -> Any:
    """Body of a wrap-mode model serializer: send ``data`` set to ``None`` as ``null``.

    :func:`to_wire` drops ``None`` fields, but for ``data`` ``null`` is a value,
    not "unset": TypeScript sends ``success(null)`` as ``{"success": true,
    "data": null}``. A ``data`` field that was set (it is in
    ``model_fields_set``) is therefore kept, and one never set is still
    omitted (#2073).
    """
    dumped = handler(model)
    if (
        info.exclude_none
        and isinstance(dumped, dict)
        and "data" not in dumped
        and "data" in model.model_fields_set
        and getattr(model, "data", None) is None
        and not info.exclude_defaults
        and not _excluded(info.exclude, "data")
        and (info.include is None or "data" in info.include)
    ):
        return _insert_in_field_order(model, dumped, info, "data", None)
    return dumped


def _insert_in_field_order(
    model: BaseModel, dumped: dict, info: SerializationInfo, name: str, value: Any
) -> dict:
    """``dumped`` with ``name`` added where the model declares it, so key order matches."""
    fields = type(model).model_fields
    before = set()
    for field_name, field in fields.items():
        if field_name == name:
            break
        before.add(field.alias if info.by_alias and field.alias else field_name)
    out: dict = {}
    placed = False
    for key, item in dumped.items():
        if not placed and key not in before:
            out[name] = value
            placed = True
        out[key] = item
    if not placed:
        out[name] = value
    return out


def _excluded(exclude: Any, name: str) -> bool:
    """Whether a serializer's ``exclude`` drops the field ``name`` entirely."""
    if isinstance(exclude, dict):
        return exclude.get(name) is True
    return bool(exclude) and name in exclude


def to_wire(value: Any) -> Any:
    """Convert a value to its JSON wire representation.

    Pydantic models are dumped by alias (camelCase for AFD models) with fields
    set to ``None`` omitted, except a result's ``data`` that was set to
    ``None`` (see :func:`keep_null_data`). ``None`` inside plain dicts and lists is kept, as
    ``null`` is a real JSON value there. Values JSON cannot represent fall back
    to ``str()``.

    Args:
        value: A model, or any JSON-like structure that may contain models.

    Returns:
        Plain JSON-compatible data (dicts, lists, strings, numbers, booleans, None).
    """
    return to_jsonable_python(
        value,
        by_alias=True,
        exclude_none=True,
        serialize_unknown=True,
    )


def to_wire_json(value: Any, *, indent: Optional[int] = None) -> str:
    """Serialize a value to a JSON string in the wire format.

    Args:
        value: A model, or any JSON-like structure that may contain models.
        indent: Optional indentation for pretty-printing.

    Returns:
        The JSON text.
    """
    return json.dumps(to_wire(value), indent=indent)
