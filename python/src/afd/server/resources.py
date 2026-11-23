"""MCP resources and the Skills extension's methods (``spec/mcp-resources.md``, R1 to R6, S1 to S6).

A server given ``resources`` serves a :class:`ResourceProvider`'s entries; one given ``skills``
serves a :class:`SkillCatalog` through ``skills/list``, ``skills/get`` and the skill files as
resources. A server given either declares the ``resources`` capability (never ``subscribe`` or
``listChanged``: AFD servers push nothing), and one given a catalog also declares
``io.modelcontextprotocol/skills``.

A read runs no command, middleware, confirmation, approval or journal entry, and ``context_hook``
does not run for it; failures are JSON-RPC errors, never ``CommandResult``s. An unknown URI is
``-32602`` with ``data.uri`` on both MCP eras.
"""

from __future__ import annotations

import base64
import copy
import inspect
import logging
import re
import unicodedata
from collections.abc import Awaitable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

from afd.core.meta_keys import check_meta_entry
from afd.server.session_context import is_modern_protocol
from afd.server.skills import (
    DIGEST_META_KEY,
    SKILLS_EXTENSION_ID,
    SkillCatalog,
    sha256_digest,
)

logger = logging.getLogger("afd.server")

MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
"""The MIME type MCP Apps requires of a ``ui://`` resource."""

_SCHEME_RE = re.compile(r"\A([A-Za-z][A-Za-z0-9+.-]*):(.*)\Z", re.DOTALL | re.ASCII)
_HEX_ESCAPE_RE = re.compile(r"\A[0-9A-Fa-f]{2}", re.ASCII)


@dataclass(frozen=True)
class ResourceEntry:
    """One item of ``resources/list`` (``spec/mcp-resources.md``, R2).

    The server checks the entries when built and each time it lists them, and refuses the whole
    list with ``-32603`` when one breaks a rule.
    """

    uri: str
    name: str
    title: str | None = None
    description: str | None = None
    icons: list[Any] | None = None
    annotations: dict[str, Any] | None = None
    mime_type: str | None = None
    size: int | None = None
    meta: Mapping[str, Any] | None = None
    content: str | bytes | None = None


@dataclass(frozen=True)
class ResourceContents:
    """What :meth:`ResourceProvider.read` returns: the bytes of one resource (R4)."""

    content: str | bytes
    mime_type: str | None = None
    meta: Mapping[str, Any] | None = None


@runtime_checkable
class ResourceProvider(Protocol):
    """What a server is given to serve resources (``spec/mcp-resources.md``, "Terms")."""

    def list(self) -> Sequence[ResourceEntry]:
        """The entries, in the order ``resources/list`` returns them."""
        ...

    def read(
        self, uri: str
    ) -> ResourceContents | None | Awaitable[ResourceContents | None]:
        """The content at ``uri``, or ``None`` when the provider serves nothing there."""
        ...


ResourcesOption = ResourceProvider | Sequence[ResourceEntry]
"""What ``create_server`` and ``ServerConfig`` take as ``resources``: a provider or static entries."""


def _bytes_of(content: Any) -> bytes:
    if isinstance(content, str):
        return content.encode("utf-8")
    if isinstance(content, (bytes, bytearray)):
        return bytes(content)
    raise TypeError(f"resource content must be a string or bytes, got {type(content).__name__}")


def _clone_meta(meta: Mapping[str, Any] | None) -> dict[str, Any]:
    if not meta:
        return {}
    return {key: copy.deepcopy(value) for key, value in meta.items()}


def _scheme_of(uri: str) -> str | None:
    """The RFC 3986 scheme of ``uri`` when it has one, no whitespace/control chars, and valid % escapes."""
    match = _SCHEME_RE.match(uri)
    if match is None:
        return None
    rest = match.group(2)
    idx = 0
    length = len(rest)
    while idx < length:
        ch = rest[idx]
        if ch.isspace() or unicodedata.category(ch) == "Cc":
            return None
        if ch == "%":
            if idx + 2 >= length or _HEX_ESCAPE_RE.match(rest[idx + 1 : idx + 3]) is None:
                return None
            idx += 3
            continue
        idx += 1
    return match.group(1)


def check_entries(entries: Sequence[ResourceEntry]) -> None:
    """Check a provider's entries against R2.

    Raises:
        ValueError: Naming the entry when any rule of R2 is broken.
    """
    if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
        raise ValueError("resources: list() must return a sequence of ResourceEntry items")
    seen: set[str] = set()
    for entry in entries:
        uri = getattr(entry, "uri", None)

        def fail(rule: str, u: Any = uri) -> ValueError:
            return ValueError(f'resource "{u}": {rule}')

        if not isinstance(uri, str):
            raise fail("the uri must be a string")
        scheme = _scheme_of(uri)
        if scheme is None:
            raise fail("the uri must be an absolute URI with a scheme")
        if uri in seen:
            raise fail("the uri is used by another entry")
        seen.add(uri)

        if not isinstance(entry.name, str) or entry.name == "":
            raise fail("the name must not be empty")
        for field_name in ("title", "description", "mime_type"):
            val = getattr(entry, field_name, None)
            if val is not None and not isinstance(val, str):
                raise fail(f"{field_name} must be a string")
        if entry.size is not None and (
            isinstance(entry.size, bool) or not isinstance(entry.size, int) or entry.size < 0
        ):
            raise fail("the size must be a non-negative integer")
        if scheme.lower() == "skill":
            raise fail("the skill:// scheme belongs to the skill catalog (the skills option)")
        if scheme.lower() == "ui" and entry.mime_type != MCP_APP_MIME_TYPE:
            raise fail(f"a ui:// entry must have the mimeType {MCP_APP_MIME_TYPE}")
        if entry.meta is not None:
            if not isinstance(entry.meta, Mapping):
                raise fail("_meta must be a mapping")
            for key, value in entry.meta.items():
                reason = check_meta_entry(key, value, allow_ui=False)
                if reason is not None:
                    raise fail(reason)
        if entry.content is not None:
            if not isinstance(entry.content, (str, bytes, bytearray)):
                raise fail("content must be a string or bytes")
            data = _bytes_of(entry.content)
            if entry.size is not None and entry.size != len(data):
                raise fail("the size must equal the length of the content's bytes")
        if entry.icons is not None or entry.annotations is not None:
            try:
                _resource_model(_entry_to_resource_dict(entry))
            except ImportError:
                pass
            except Exception as exc:
                raise fail(f"invalid MCP resource fields: {exc}") from exc


def _entry_to_resource_dict(entry: ResourceEntry) -> dict[str, Any]:
    data = None if entry.content is None else _bytes_of(entry.content)
    meta: dict[str, Any] = _clone_meta(entry.meta)
    if data is not None:
        meta[DIGEST_META_KEY] = sha256_digest(data)
    item: dict[str, Any] = {
        "uri": entry.uri,
        "name": entry.name,
    }
    if entry.title is not None:
        item["title"] = entry.title
    if entry.description is not None:
        item["description"] = entry.description
    if entry.icons is not None:
        item["icons"] = copy.deepcopy(entry.icons)
    if entry.annotations is not None:
        item["annotations"] = copy.deepcopy(entry.annotations)
    if entry.mime_type is not None:
        item["mimeType"] = entry.mime_type
    if data is not None:
        item["size"] = len(data)
    elif entry.size is not None:
        item["size"] = entry.size
    if meta:
        item["_meta"] = meta
    return item


class _StaticProvider:
    def __init__(self, entries: Sequence[ResourceEntry]) -> None:
        self._entries = tuple(entries)

    def list(self) -> Sequence[ResourceEntry]:
        return self._entries

    def read(self, uri: str) -> None:
        return None


def _provider_of(option: ResourcesOption | None) -> Any | None:
    if option is None:
        return None
    if isinstance(option, Sequence) and not isinstance(option, (str, bytes)):
        return _StaticProvider(option)
    if not hasattr(option, "list") or not callable(option.list):
        raise ValueError("resources: expected a sequence of ResourceEntry or an object with list()")
    return option


def _not_found(uri: str) -> Exception:
    from mcp import MCPError
    from mcp_types import INVALID_PARAMS

    return MCPError(code=INVALID_PARAMS, message="Resource not found", data={"uri": uri})


def _refuse_cursor(params: Any) -> None:
    if params is None:
        return
    has_cursor = (
        "cursor" in getattr(params, "model_fields_set", ())
        or getattr(params, "cursor", None) is not None
    )
    if not has_cursor:
        return
    from mcp import MCPError
    from mcp_types import INVALID_PARAMS

    raise MCPError(
        code=INVALID_PARAMS,
        message="This server returns one page and never issues a cursor",
    )


def _internal_error(exc: BaseException, *, dev_mode: bool) -> Exception:
    from mcp import MCPError
    from mcp_types import INTERNAL_ERROR

    logger.error("Resource handler raised an unhandled exception", exc_info=exc)
    return MCPError(
        code=INTERNAL_ERROR,
        message=str(exc) if dev_mode else "Internal error",
    )


def _content_model(
    uri: str,
    mime_type: str | None,
    data: bytes,
    meta: Mapping[str, Any] | None = None,
) -> Any:
    import mcp_types as types

    extra_meta = _clone_meta(meta) or None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        blob = base64.b64encode(data).decode("ascii")
        return types.BlobResourceContents.model_validate(
            {
                "uri": uri,
                **({"mimeType": mime_type} if mime_type is not None else {}),
                "blob": blob,
                **({"_meta": extra_meta} if extra_meta is not None else {}),
            }
        )
    return types.TextResourceContents.model_validate(
        {
            "uri": uri,
            **({"mimeType": mime_type} if mime_type is not None else {}),
            "text": text,
            **({"_meta": extra_meta} if extra_meta is not None else {}),
        }
    )


def _resource_model(item: dict[str, Any]) -> Any:
    import mcp_types as types

    return types.Resource.model_validate(item)


class ResourceService:
    """Resource and Skills extension service installed on an AFD ``MCPServer``."""

    def __init__(
        self,
        provider: Any | None,
        skills: SkillCatalog | None,
        *,
        ttl_ms: int,
        dev_mode: bool = False,
    ) -> None:
        self._provider = provider
        self._skills = skills
        self._ttl_ms = ttl_ms
        self._dev_mode = dev_mode

    @property
    def has_skills(self) -> bool:
        return self._skills is not None

    def skills_extension_settings(self) -> dict[str, Any]:
        """The ``capabilities.extensions["io.modelcontextprotocol/skills"]`` settings object (S1)."""
        if self._skills is None:
            return {}
        return {"directoryRead": True} if self._skills.directory_read else {}

    @property
    def ttl_ms(self) -> int:
        return self._ttl_ms

    def _entries_of(self) -> Sequence[ResourceEntry]:
        if self._provider is None:
            return ()
        entries: Sequence[ResourceEntry] = self._provider.list()
        check_entries(entries)
        return entries

    async def _read_item(self, uri: str) -> Any:
        if self._skills is not None:
            found = self._skills.file(uri)
            if found is not None:
                data, mime_type = found
                return _content_model(uri, mime_type, data)
        # The `skill://` scheme is the catalog's alone (R2): a provider is never asked for it,
        # even when the URI itself is malformed.
        if self._provider is None or uri[:6].lower() == "skill:":
            raise _not_found(uri)

        entries = self._entries_of()
        entry = next((item for item in entries if item.uri == uri), None)
        if entry is not None and entry.content is not None:
            raw = (
                bytes(entry.content)
                if isinstance(entry.content, bytearray)
                else entry.content
            )
            return _content_model(uri, entry.mime_type, _bytes_of(raw))

        read_fn = getattr(self._provider, "read", None)
        if not callable(read_fn):
            raise _not_found(uri)
        maybe = read_fn(uri)
        contents = await maybe if inspect.isawaitable(maybe) else maybe
        if contents is None:
            raise _not_found(uri)
        if not isinstance(contents, ResourceContents):
            raise TypeError(
                f'resource "{uri}": read() must return ResourceContents or None'
            )
        if contents.meta is not None:
            if not isinstance(contents.meta, Mapping):
                raise ValueError(f'resource "{uri}": _meta must be a mapping')
            for key, value in contents.meta.items():
                reason = check_meta_entry(key, value, allow_ui=True)
                if reason is not None:
                    raise ValueError(f'resource "{uri}": {reason}')
        raw_content = (
            bytes(contents.content)
            if isinstance(contents.content, bytearray)
            else contents.content
        )
        data = _bytes_of(raw_content)
        if entry is not None and entry.size is not None and entry.size != len(data):
            raise ValueError(
                f'resource "{uri}": the listed size is {entry.size} '
                f"but the read returned {len(data)} bytes"
            )
        resolved_mime: str | None = (
            entry.mime_type
            if entry is not None and entry.mime_type is not None
            else contents.mime_type
        )
        return _content_model(uri, resolved_mime, data, contents.meta)

    def create_skills_extension(self) -> Any | None:
        """Build the ``mcp.server.extension.Extension`` for ``io.modelcontextprotocol/skills``."""
        if self._skills is None:
            return None

        import mcp_types as types
        from mcp import MCPError
        from mcp.server.extension import Extension, MethodBinding
        from pydantic import BaseModel, ConfigDict

        skills = self._skills
        service = self

        class _SkillsListParams(BaseModel):
            model_config = ConfigDict(extra="allow")
            cursor: str | None = None

        class _UriParams(BaseModel):
            model_config = ConfigDict(extra="allow")
            uri: str

        class _SkillsListResult(types.Result):
            skills: list[dict[str, Any]]
            ttl_ms: int | None = None
            cache_scope: Literal["public", "private"] | None = None
            result_type: Literal["complete"] | None = None

        class _SkillsGetResult(types.Result):
            skill: dict[str, Any]
            ttl_ms: int | None = None
            cache_scope: Literal["public", "private"] | None = None
            result_type: Literal["complete"] | None = None

        class _DirectoryReadResult(types.Result):
            resources: list[dict[str, Any]]
            ttl_ms: int | None = None
            cache_scope: Literal["public", "private"] | None = None
            result_type: Literal["complete"] | None = None

        def _modern_hints(ctx: Any) -> dict[str, Any]:
            if is_modern_protocol(getattr(ctx, "protocol_version", None)):
                return {
                    "result_type": "complete",
                    "ttl_ms": service._ttl_ms,
                    "cache_scope": "public",
                }
            return {}

        async def handle_list_skills(ctx: Any, params: _SkillsListParams) -> _SkillsListResult:
            try:
                _refuse_cursor(params)
                return _SkillsListResult(skills=skills.entries(), **_modern_hints(ctx))
            except MCPError:
                raise
            except Exception as exc:
                raise _internal_error(exc, dev_mode=service._dev_mode) from exc

        async def handle_get_skill(ctx: Any, params: _UriParams) -> _SkillsGetResult:
            try:
                entry = skills.entry(params.uri)
                if entry is None:
                    raise _not_found(params.uri)
                return _SkillsGetResult(skill=entry, **_modern_hints(ctx))
            except MCPError:
                raise
            except Exception as exc:
                raise _internal_error(exc, dev_mode=service._dev_mode) from exc

        async def handle_read_directory(ctx: Any, params: _UriParams) -> _DirectoryReadResult:
            try:
                children = skills.directory(params.uri)
                if children is None:
                    raise _not_found(params.uri)
                return _DirectoryReadResult(resources=children, **_modern_hints(ctx))
            except MCPError:
                raise
            except Exception as exc:
                raise _internal_error(exc, dev_mode=service._dev_mode) from exc

        class _AfdSkillsExtension(Extension):
            identifier = SKILLS_EXTENSION_ID

            def settings(self) -> dict[str, Any]:
                return {"directoryRead": True} if skills.directory_read else {}

            def methods(self) -> Sequence[MethodBinding]:
                bindings = [
                    MethodBinding(
                        method="skills/list",
                        params_type=_SkillsListParams,
                        handler=handle_list_skills,
                        protocol_versions=None,
                    ),
                    MethodBinding(
                        method="skills/get",
                        params_type=_UriParams,
                        handler=handle_get_skill,
                        protocol_versions=None,
                    ),
                ]
                if skills.directory_read:
                    bindings.append(
                        MethodBinding(
                            method="resources/directory/read",
                            params_type=_UriParams,
                            handler=handle_read_directory,
                            protocol_versions=None,
                        )
                    )
                return tuple(bindings)

        return _AfdSkillsExtension()

    def install_handlers(self, lowlevel: Any) -> None:
        """Install ``resources/list``, ``resources/templates/list`` and ``resources/read`` handlers."""
        import mcp_types as types
        from mcp import MCPError

        service = self

        async def handle_list_resources(
            ctx: Any, params: types.PaginatedRequestParams | None
        ) -> types.ListResourcesResult:
            try:
                _refuse_cursor(params)
                items = [
                    *(_entry_to_resource_dict(entry) for entry in service._entries_of()),
                    *(service._skills.resources() if service._skills is not None else []),
                ]
                return types.ListResourcesResult(
                    resources=[_resource_model(item) for item in items]
                )
            except MCPError:
                raise
            except Exception as exc:
                raise _internal_error(exc, dev_mode=service._dev_mode) from exc

        async def handle_list_templates(
            ctx: Any, params: types.PaginatedRequestParams | None
        ) -> types.ListResourceTemplatesResult:
            try:
                _refuse_cursor(params)
                return types.ListResourceTemplatesResult(resource_templates=[])
            except MCPError:
                raise
            except Exception as exc:
                raise _internal_error(exc, dev_mode=service._dev_mode) from exc

        async def handle_read_resource(
            ctx: Any, params: types.ReadResourceRequestParams
        ) -> types.ReadResourceResult:
            try:
                item = await service._read_item(params.uri)
                return types.ReadResourceResult(contents=[item])
            except MCPError:
                raise
            except Exception as exc:
                raise _internal_error(exc, dev_mode=service._dev_mode) from exc

        lowlevel.add_request_handler(
            "resources/list", types.PaginatedRequestParams, handle_list_resources
        )
        lowlevel.add_request_handler(
            "resources/templates/list", types.PaginatedRequestParams, handle_list_templates
        )
        lowlevel.add_request_handler(
            "resources/read", types.ReadResourceRequestParams, handle_read_resource
        )


def strip_unused_sdk_handlers(lowlevel: Any, *, serve_resources: bool) -> None:
    """Remove the SDK's default prompt (always) and resource (when opt-in is off) handlers (R1)."""
    handlers = getattr(lowlevel, "_request_handlers", None)
    if not isinstance(handlers, dict):
        return
    for method in ("prompts/list", "prompts/get"):
        handlers.pop(method, None)
    if not serve_resources:
        for method in ("resources/list", "resources/read", "resources/templates/list"):
            handlers.pop(method, None)


def create_resource_service(
    resources: ResourcesOption | None,
    skills: SkillCatalog | None,
    *,
    ttl_ms: int,
    dev_mode: bool = False,
) -> ResourceService | None:
    """Build the resource service, or ``None`` when neither ``resources`` nor ``skills`` was given.

    Raises:
        ValueError: Naming the offending entry when the provider breaks R2.
        TypeError: When ``skills`` is not a :class:`SkillCatalog`.
    """
    provider = _provider_of(resources)
    if skills is not None and not isinstance(skills, SkillCatalog):
        raise TypeError("skills must be a SkillCatalog instance")
    if provider is None and skills is None:
        return None
    if provider is not None:
        check_entries(provider.list())
    return ResourceService(provider, skills, ttl_ms=ttl_ms, dev_mode=dev_mode)
