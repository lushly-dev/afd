"""A host command's inputs, read from its handler, for the catalog and for refusals.

The catalog's input schema and the refusal of a wrong argument both read the handler's
signature, so they cannot disagree. Pydantic derives each parameter's JSON Schema from its
type hint. Google-style ``Args:`` sections and Sphinx ``:param`` fields supply
per-parameter descriptions; nothing else of a docstring beyond its first line is used.
"""

from __future__ import annotations

import difflib
import inspect
import re
import warnings
from collections.abc import Callable
from copy import deepcopy
from functools import lru_cache
from typing import Any

from afd import CommandResult, error
from pydantic import TypeAdapter
from pydantic.json_schema import PydanticJsonSchemaWarning
from pydantic_core import to_jsonable_python

DESCRIPTION_LIMIT = 200  # Characters in any one description the catalog carries.
_KEYWORD = (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
_SECTION = re.compile(r"(Args|Arguments|Parameters|Params|Keyword Args|Keyword Arguments):")
_ENTRY = re.compile(r"\*{0,2}(\w+)\s*(?:\([^)]*\))?\s*:\s*(.*)")
_SPHINX = re.compile(r":param\s+(?:[^:]*\s)?(\w+)\s*:\s*(.*)")


def _bound(text: str) -> str:
    text = " ".join(text.split())
    if len(text) <= DESCRIPTION_LIMIT:
        return text
    return text[: DESCRIPTION_LIMIT - 3].rsplit(" ", 1)[0] + "..."


def _doc(handler: Callable) -> str:
    return inspect.cleandoc(getattr(handler, "__doc__", None) or "")


def summary(handler: Callable) -> str:
    """The docstring's first line: the only prose of it a catalog row carries."""
    lines = _doc(handler).splitlines()
    return _bound(lines[0]) if lines else ""


def parameter_docs(doc: str | None) -> dict[str, str]:
    """Descriptions from a Google-style Args section or Sphinx ``:param name:`` fields.

    An entry's continuation lines join it. Other docstring styles yield nothing.
    """
    found: dict[str, list[str]] = {}
    mode = current = entry_indent = None
    for line in inspect.cleandoc(doc or "").splitlines():
        text, indent = line.strip(), len(line) - len(line.lstrip())
        if not text:
            current = None
            continue
        sphinx = _SPHINX.fullmatch(text) if indent == 0 else None
        if sphinx:
            mode, current = "sphinx", sphinx[1]
            found[current] = [sphinx[2]]
        elif indent == 0:
            mode = "google" if _SECTION.fullmatch(text) else None
            current = entry_indent = None
        elif mode == "google" and (entry_indent is None or indent <= entry_indent):
            entry, entry_indent = _ENTRY.fullmatch(text), indent
            current = entry[1] if entry else None
            if entry:
                found[current] = [entry[2]]
        elif current:
            found[current].append(text)
    return {name: _bound(" ".join(parts)) for name, parts in found.items() if "".join(parts)}


def _signature(handler: Callable) -> inspect.Signature:
    """The signature with string hints resolved one at a time, as eval_str would.

    A hint naming something unimportable at runtime (a TYPE_CHECKING import) stays a
    string without unresolving its neighbours.
    """
    signature = inspect.signature(handler)
    namespace = getattr(inspect.unwrap(handler), "__globals__", {})

    def resolve(annotation: Any) -> Any:
        if not isinstance(annotation, str):
            return annotation
        try:
            return eval(annotation, namespace)  # What inspect's eval_str does per hint.
        except Exception:
            return annotation

    return signature.replace(
        parameters=[
            parameter.replace(annotation=resolve(parameter.annotation))
            for parameter in signature.parameters.values()
        ]
    )


def _parameter_schema(annotation: Any, defs: dict) -> dict:
    if annotation is inspect.Parameter.empty or isinstance(annotation, str):
        return {}  # Unannotated, or a hint that did not resolve: any JSON value.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", PydanticJsonSchemaWarning)
            schema = TypeAdapter(annotation).json_schema()
    except Exception:  # A hint Pydantic cannot describe must not hide the command.
        return {}
    defs.update(schema.pop("$defs", {}))
    return schema


@lru_cache(maxsize=1024)
def _derive(handler: Callable) -> tuple[str, dict]:
    docs = parameter_docs(_doc(handler))
    properties: dict[str, dict] = {}
    required: list[str] = []
    defs: dict[str, dict] = {}
    open_ended = False
    for name, parameter in _signature(handler).parameters.items():
        if parameter.kind is inspect.Parameter.VAR_KEYWORD:
            open_ended = True
        if parameter.kind not in _KEYWORD:
            continue  # The host passes keyword arguments only.
        schema = _parameter_schema(parameter.annotation, defs)
        if name in docs and "description" not in schema:
            schema["description"] = docs[name]
        if parameter.default is inspect.Parameter.empty:
            required.append(name)
        else:
            try:
                schema["default"] = to_jsonable_python(parameter.default)
            except ValueError:
                pass  # A default with no JSON form is left out; the input stays optional.
        properties[name] = schema
    input_schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        input_schema["required"] = required
    input_schema["additionalProperties"] = open_ended
    if defs:
        input_schema["$defs"] = defs
    return summary(handler), input_schema


def describe_inputs(handler: Callable) -> tuple[str, dict]:
    """Return the handler's one-line description and the JSON Schema of its keyword inputs.

    Required inputs have no default; optional ones carry their default when it has a JSON
    form. ``additionalProperties`` is true only for a handler taking ``**kwargs``.
    """
    try:
        description, schema = _derive(handler)
    except TypeError:  # An unhashable callable is described afresh each time.
        description, schema = _derive.__wrapped__(handler)
    return description, deepcopy(schema)


def _key(name: str) -> str:
    return re.sub(r"[^0-9a-z]", "", name.lower())


def closest_parameter(name: str, accepted: list[str]) -> str | None:
    """The input a wrong key most likely meant: the same name in another case or
    separator convention (``timeoutMs``, ``TimeoutMs``, ``timeout-ms``), else the
    closest by difflib."""
    by_key = {_key(option): option for option in accepted}
    if _key(name) in by_key:
        return by_key[_key(name)]
    match = difflib.get_close_matches(_key(name), list(by_key), n=1, cutoff=0.6)
    return by_key[match[0]] if match else None


def check_arguments(name: str, handler: Callable, arguments: dict) -> CommandResult | None:
    """Refuse an argument the handler does not take, or a missing required one.

    The refusal is AFD's VALIDATION_ERROR, with the shared catalog's
    ``expectedFields``/``unexpectedFields``/``missingFields`` details, plus
    ``suggestedFields`` mapping each unknown key to the input it most likely meant.
    """
    parameters = list(inspect.signature(handler).parameters.values())
    accepted = [parameter.name for parameter in parameters if parameter.kind in _KEYWORD]
    open_ended = any(parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters)
    unexpected = [] if open_ended else [str(key) for key in arguments if key not in accepted]
    missing = [
        parameter.name
        for parameter in parameters
        if parameter.kind in _KEYWORD
        and parameter.default is inspect.Parameter.empty
        and parameter.name not in arguments
    ]
    if not unexpected and not missing:
        return None
    meant = {key: closest_parameter(key, accepted) for key in unexpected}
    problems = [f"does not take {', '.join(unexpected)}"] if unexpected else []
    problems += [f"requires {', '.join(missing)}"] if missing else []
    steps = [f"use {meant[key]} instead of {key}" for key in unexpected if meant[key]]
    unmatched = [key for key in unexpected if not meant[key]]
    steps += [f"remove {', '.join(unmatched)}"] if unmatched else []
    unnamed = [field for field in missing if field not in meant.values()]
    steps += [f"pass {', '.join(unnamed)}"] if unnamed else []
    expected = f"Expected fields: {', '.join(accepted)}" if accepted else "It takes no arguments"
    details: dict[str, Any] = {"expectedFields": accepted}
    if unexpected:
        details["unexpectedFields"] = unexpected
    if missing:
        details["missingFields"] = missing
    if any(meant.values()):
        details["suggestedFields"] = {key: value for key, value in meant.items() if value}
    advice = f"{'; '.join(steps)}. {expected}"
    return error(
        "VALIDATION_ERROR",
        f"{name} {' and '.join(problems)}",
        suggestion=advice[0].upper() + advice[1:],
        details=details,
    )
