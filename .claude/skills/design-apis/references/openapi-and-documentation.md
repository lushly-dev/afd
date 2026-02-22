# OpenAPI and API Documentation

Reference for API-first design with OpenAPI 3.1, documentation standards, and specification authoring.

## API-First Design Methodology

### What Is API-First?

API-first means designing and agreeing on the API contract before writing any implementation code. The API specification (OpenAPI, AsyncAPI, Protobuf) is the source of truth.

### Workflow

```
1. Gather requirements (consumers, use cases, data model)
2. Design the API contract (OpenAPI spec)
3. Review the contract with stakeholders
4. Validate with linting tools (Spectral, Redocly)
5. Generate mocks for frontend/consumer development
6. Implement the backend against the contract
7. Test conformance: implementation matches spec
8. Publish documentation from the spec
```

### Benefits

- Frontend and backend develop in parallel against the contract
- Consumers (including agents) can build integrations before the API is implemented
- Breaking changes are caught at the design stage, not after deployment
- Generated SDKs, documentation, and tests stay in sync

## OpenAPI 3.1 Specification

### Key Improvements Over 3.0

| Feature | 3.0 | 3.1 |
|---------|-----|-----|
| JSON Schema alignment | Draft 4 (partial) | Draft 2020-12 (full) |
| Nullable fields | `nullable: true` | `type: ["string", "null"]` |
| Webhooks | Not supported | `webhooks` section |
| `const` keyword | Not supported | Supported |
| `if/then/else` | Not supported | Supported |
| `$ref` with siblings | Not allowed | Allowed |
| Content encoding | Limited | `contentMediaType`, `contentEncoding` |

### Specification Structure

```yaml
openapi: "3.1.0"
info:
  title: My API
  description: What the API does and who it is for.
  version: "1.0.0"
  contact:
    name: API Team
    email: api-team@example.com
  license:
    name: MIT

servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://staging-api.example.com/v1
    description: Staging

paths:
  /users:
    get:
      operationId: listUsers
      summary: List users
      description: Returns a paginated list of users.
      tags: [Users]
      parameters: [...]
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserListResponse'
              examples:
                default:
                  $ref: '#/components/examples/UserListExample'

components:
  schemas: { ... }
  securitySchemes: { ... }
  examples: { ... }
  parameters: { ... }

security:
  - bearerAuth: []

tags:
  - name: Users
    description: User management operations
```

### Writing Good Descriptions

```yaml
# BAD: Vague, no actionable information
description: Gets users

# GOOD: Explains behavior, constraints, and usage
description: >
  Returns a paginated list of users matching the specified filters.
  Results are sorted by created_at descending by default.
  Use cursor-based pagination with the 'after' parameter for
  consistent results across large datasets. Maximum page size is 100.
  Requires the 'read:users' scope.
```

### Schema Design

```yaml
components:
  schemas:
    User:
      type: object
      required: [id, email, status, created_at]
      properties:
        id:
          type: string
          description: Unique user identifier
          example: "usr_123abc"
          pattern: "^usr_[a-z0-9]+$"
        email:
          type: string
          format: email
          description: User's email address
          example: "jane@example.com"
        display_name:
          type: ["string", "null"]       # 3.1 nullable syntax
          description: Optional display name
          example: "Jane Doe"
        status:
          $ref: '#/components/schemas/UserStatus'
        created_at:
          type: string
          format: date-time
          description: When the user was created (ISO 8601)
          example: "2025-06-15T10:30:00Z"

    UserStatus:
      type: string
      enum: [active, inactive, suspended]
      description: Current account status

    Error:
      type: object
      required: [type, title, status]
      description: RFC 9457 Problem Details
      properties:
        type:
          type: string
          format: uri
          description: URI identifying the problem type
        title:
          type: string
          description: Short summary of the problem
        status:
          type: integer
          description: HTTP status code
        detail:
          type: string
          description: Explanation specific to this occurrence
        instance:
          type: string
          description: URI for this specific occurrence
```

### Security Schemes

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: >
        JWT access token obtained via OAuth 2.0 Authorization Code + PKCE flow.
        Include as: Authorization: Bearer {token}

    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
      description: >
        API key for application identification. Obtain from the developer portal.
        Not sufficient for user-context operations; pair with bearerAuth.
```

## Linting and Validation

### Spectral (Industry Standard)

Spectral validates OpenAPI specs against rulesets:

```yaml
# .spectral.yml
extends: ["spectral:oas"]
rules:
  operation-operationId: error
  operation-description: warn
  operation-tags: warn
  oas3-api-servers: error
  info-contact: warn
  no-$ref-siblings: off  # Allowed in 3.1
```

### Common Lint Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `operation-operationId` | Error | Every operation must have a unique operationId |
| `operation-description` | Warning | Every operation should have a description |
| `oas3-valid-schema-example` | Error | Examples must match their schema |
| `no-eval-in-markdown` | Error | No script injection in descriptions |
| `typed-enum` | Warning | Enum values must match the declared type |
| `path-params` | Error | Path parameters must be defined |

### Validation Tools

| Tool | Purpose |
|------|---------|
| Spectral | Lint rules and style enforcement |
| Redocly CLI | Bundling, linting, and preview |
| openapi-diff | Detect breaking changes between versions |
| Prism | Mock server from OpenAPI spec |
| oasdiff | Breaking change detection with CI integration |

## Documentation Generation

### From OpenAPI to Docs

| Tool | Output |
|------|--------|
| Redoc | Beautiful single-page HTML reference |
| Swagger UI | Interactive try-it-out documentation |
| Stoplight Elements | Embeddable API docs component |
| ReadMe | Hosted docs with analytics |

### Documentation Must-Haves

1. **Quick start** -- Minimal example to make the first API call
2. **Authentication guide** -- How to obtain and use credentials
3. **Error reference** -- All error codes with resolution steps
4. **Changelog** -- Dated list of changes per version
5. **Rate limit reference** -- Limits per tier and per endpoint
6. **SDKs and examples** -- Code samples in popular languages
7. **Webhook reference** -- Payload schemas and delivery semantics (if applicable)

## AsyncAPI for Event-Driven APIs

For WebSocket, message queue, and event-driven APIs, use AsyncAPI 3.0:

```yaml
asyncapi: "3.0.0"
info:
  title: Order Events
  version: "1.0.0"
channels:
  orderCreated:
    address: orders/created
    messages:
      orderCreated:
        payload:
          type: object
          properties:
            orderId:
              type: string
            createdAt:
              type: string
              format: date-time
operations:
  onOrderCreated:
    action: receive
    channel:
      $ref: '#/channels/orderCreated'
```

## Agent Considerations

1. **Publish the raw OpenAPI spec at a stable URL** -- Agents and agent frameworks fetch specs to auto-generate tools. Serve at `/openapi.json` or `/openapi.yaml`.
2. **Include examples for every schema** -- Agents use examples to understand expected formats. Missing examples cause malformed requests.
3. **Use `operationId` as tool names** -- Agent frameworks map `operationId` to function/tool names. Use clear, unique, verb-noun IDs: `listUsers`, `createOrder`, `cancelOrder`.
4. **Tag operations by domain** -- Tags help agents filter relevant tools when the API has many endpoints.
5. **Describe side effects** -- If an endpoint sends an email, triggers a webhook, or modifies related resources, say so in the description. Agents need to understand consequences before acting.
