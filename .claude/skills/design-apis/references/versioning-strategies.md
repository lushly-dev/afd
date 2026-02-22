# API Versioning Strategies

Comprehensive reference for API versioning approaches, migration patterns, and deprecation policies.

## Versioning Approaches

### 1. URI Path Versioning

The version number is part of the URL path.

```
GET /api/v1/users
GET /api/v2/users
```

| Pros | Cons |
|------|------|
| Highly visible and explicit | URL changes on every version bump |
| Easy to route at infrastructure level | Cache invalidation per version |
| Simple for clients and agents to understand | Can lead to URL proliferation |
| Most widely adopted pattern | Breaks REST purist principles (version is not a resource) |

**Best for:** Public APIs, APIs consumed by AI agents (clear, unambiguous).

### 2. Header Versioning

Version specified via custom or Accept header.

```http
# Custom header
GET /api/users
X-API-Version: 2

# Accept header (content negotiation)
GET /api/users
Accept: application/vnd.myapi.v2+json
```

| Pros | Cons |
|------|------|
| Clean URLs | Hidden from URL inspection |
| Follows HTTP content negotiation | Harder to test in browser |
| Allows gradual migration | Agents must set headers correctly |
| Good for internal APIs | Less discoverable |

**Best for:** Internal/partner APIs where clients control headers.

### 3. Query Parameter Versioning

Version as a query parameter.

```
GET /api/users?version=2
```

| Pros | Cons |
|------|------|
| Easy to add to existing APIs | Pollutes query string |
| Optional with default fallback | Can be confused with other params |
| Simple for testing | Less standard |

**Best for:** Transitional versioning, legacy APIs.

### 4. No Versioning (Evolutionary Design)

Design the API to never break backward compatibility. Add fields, never remove them.

```json
// v1 response
{ "id": 1, "name": "Jane" }

// Evolution: added field, old clients unaffected
{ "id": 1, "name": "Jane", "display_name": "Jane Doe" }
```

| Pros | Cons |
|------|------|
| No version management overhead | Requires extreme discipline |
| Clients never need to update URLs | Schema can accumulate cruft |
| Ideal for GraphQL (additive by design) | Some changes are inherently breaking |

**Best for:** GraphQL APIs, APIs with strong additive-only policies.

## When to Version

### Breaking Changes (Require New Version)

- Removing a field or endpoint
- Renaming a field or endpoint
- Changing the type of a field (string to integer)
- Changing required/optional status of a field
- Changing authentication mechanism
- Changing error response format
- Changing pagination strategy
- Removing an enum value

### Non-Breaking Changes (No Version Needed)

- Adding a new endpoint
- Adding a new optional field to responses
- Adding a new optional query parameter
- Adding a new enum value (with caution)
- Adding a new HTTP method to an existing resource
- Performance improvements
- Bug fixes that match documented behavior

## Version Lifecycle

### Lifecycle Stages

```
Alpha (v1alpha1) -> Beta (v1beta1) -> Stable (v1) -> Deprecated -> Sunset
```

| Stage | SLA | Breaking Changes | Duration |
|-------|-----|-----------------|----------|
| Alpha | None | Anytime | Indefinite |
| Beta | Best effort | With notice | 3-6 months |
| Stable | Full SLA | Only via new major version | 12+ months |
| Deprecated | Maintained | Frozen (security fixes only) | 6-12 months |
| Sunset | None | Removed | -- |

### Deprecation Policy Template

```
1. Announce deprecation at least 6 months before sunset.
2. Add Deprecation and Sunset headers to responses:

   Deprecation: true
   Sunset: Sat, 01 Mar 2026 00:00:00 GMT
   Link: </api/v2/users>; rel="successor-version"

3. Log usage metrics to identify remaining consumers.
4. Send direct notification to registered API consumers.
5. Return 410 Gone after sunset date.
```

### Sunset Header (RFC 8594)

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sat, 01 Mar 2026 00:00:00 GMT
Link: </api/v2/users>; rel="successor-version"
```

## Migration Strategies

### Parallel Running

Run old and new versions simultaneously:

```
/api/v1/users  -> v1 handler (deprecated)
/api/v2/users  -> v2 handler (current)
```

Both share the same database. Map between versions at the handler layer.

### Adapter Pattern

Use an internal canonical model with version-specific adapters:

```
Request (v1 format) -> v1 Adapter -> Canonical Model -> Service Logic
Request (v2 format) -> v2 Adapter -> Canonical Model -> Service Logic

Service Logic -> Canonical Model -> v1 Adapter -> Response (v1 format)
Service Logic -> Canonical Model -> v2 Adapter -> Response (v2 format)
```

### Feature Flags

Use feature flags to gradually roll out new API behavior:

```json
{
  "features": {
    "new_pagination": true,
    "extended_user_fields": false
  }
}
```

## Version Discovery

Help agents and clients discover available versions:

```http
GET /api
```

```json
{
  "versions": [
    {
      "version": "v1",
      "status": "deprecated",
      "sunset": "2026-03-01",
      "url": "/api/v1",
      "docs": "https://docs.example.com/api/v1"
    },
    {
      "version": "v2",
      "status": "stable",
      "url": "/api/v2",
      "docs": "https://docs.example.com/api/v2"
    },
    {
      "version": "v3beta1",
      "status": "beta",
      "url": "/api/v3beta1",
      "docs": "https://docs.example.com/api/v3beta1"
    }
  ]
}
```

## Agent Considerations

AI agents need special version handling:

1. **Default to latest stable** -- If an agent does not specify a version, route to the latest stable version, never to deprecated or beta.
2. **Version in URL for agents** -- URI path versioning is the most agent-friendly because agents construct URLs; headers are error-prone for LLM-based clients.
3. **Machine-readable deprecation** -- Agents can parse `Deprecation` and `Sunset` headers to warn users or auto-migrate.
4. **Changelog endpoint** -- Provide a machine-readable changelog so agents can understand what changed between versions:

```http
GET /api/v2/changelog
```

```json
{
  "changes": [
    {
      "version": "v2",
      "date": "2025-06-01",
      "type": "breaking",
      "description": "User.name split into firstName and lastName",
      "migration": "Map name -> firstName + lastName"
    }
  ]
}
```
