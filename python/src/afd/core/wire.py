"""Wire (JSON) format shared by the TypeScript, Python and Rust AFD packages.

AFD results cross language boundaries as JSON, so every implementation
serializes them the same way (see ``spec/wire/README.md``):

- keys are camelCase (``executionTimeMs``, ``undoCommand``, ``successCount``);
- optional fields that are not set are omitted, never ``null``.

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

from pydantic import BaseModel, ConfigDict
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


def to_wire(value: Any) -> Any:
    """Convert a value to its JSON wire representation.

    Pydantic models are dumped by alias (camelCase for AFD models) with fields
    set to ``None`` omitted. ``None`` inside plain dicts and lists is kept, as
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
