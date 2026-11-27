# HTTP

Profile: `http`. This page belongs to the `http` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. A server claims it when it serves MCP on Streamable HTTP.

The core needs one MCP transport, and stdio is enough: C++'s `afd::mcp_stdio` serves no HTTP by
design. This profile is what a server adds when it serves MCP over Streamable HTTP, in both eras
([protocol conformance](./protocol-conformance.md#eras)). The [`authorization`](./authorization.md)
profile is specified on top of it: a server claims authorization only on HTTP.

Every rule here is normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119. The page gathers what the contract specified about HTTP before it was split into a core
and profiles. Each language's suite holds the guard tests, as the
[acceptance index](./protocol-conformance.md#acceptance-index) records.

## The endpoint

- **One endpoint, both eras.** One Streamable HTTP endpoint (`/mcp` in TypeScript) serves MCP
  2026-07-28 requests and 2025 `initialize` sessions alike.
- **Headers in the modern era.** A request carries `MCP-Protocol-Version` and `Mcp-Method`. A
  request whose method names a target also carries `Mcp-Name`: a tool call its tool, a resource
  read its URI ([resources, R5](./mcp-resources.md#r5-headers-templates-and-subscriptions)), a task
  request its task ([tasks](./tasks.md)). A header that disagrees with the body, or a missing
  `Mcp-Name` where the method names a target, is answered with HTTP 400 and JSON-RPC `-32020`;
  `server/discover` names no target and carries none.
- **`GET` on the endpoint** is answered with 405.
- **Host and Origin** are checked before the MCP SDK sees the request, and a foreign `Origin` is
  refused. The request body has a size cap.

## Per-request context

A server on HTTP builds each call's context from the request: the actor, and the verified
credentials when the server is configured with [authorization](./authorization.md#m4-credentials).
Over stdio there is no request to read.

## Server instances

A server states whether it runs as one process or as several behind one URL (`instances`:
`'single'` or `'multiple'`; [#2224](https://github.com/lushly-dev/afd/issues/2224),
[#2242](https://github.com/lushly-dev/afd/issues/2242)). With several, the processes share the
state a call depends on across requests: the confirmation key and the nonce store
([approvals](./approvals.md)), and a task store ([tasks](./tasks.md)).

## AFD's own HTTP routes

TypeScript also serves AFD's own routes beside MCP: `/rpc`, `/batch` and `/stream`
([streaming](./streaming.md#surfaces)), and the deprecated MCP 2024-11-05 `/sse` and `/message`
lane. They run the same exposure, confirmation, approval, scope and validation checks as MCP.

## Error codes

The HTTP layer's codes are transport codes, outside the shared catalog
([error codes, HTTP layer](./error-codes.md#http-layer)): `METHOD_NOT_ALLOWED`,
`SSE_CAPACITY_REACHED` and `HTTP_<status>`. A client on HTTP reads its own
([MCP client](./error-codes.md#mcp-client)).
