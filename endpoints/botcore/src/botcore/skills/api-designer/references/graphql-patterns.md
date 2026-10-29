# GraphQL API Design Patterns

Detailed reference for GraphQL schema design, query patterns, and operational best practices.

## Schema Design

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Types | PascalCase | `User`, `OrderItem` |
| Fields | camelCase | `firstName`, `createdAt` |
| Enums | SCREAMING_SNAKE_CASE | `ORDER_STATUS`, `PENDING` |
| Mutations | Verb + noun | `createUser`, `updateOrder` |
| Queries | Noun or adjective | `user`, `activeOrders` |
| Inputs | PascalCase + Input suffix | `CreateUserInput` |
| Payloads | PascalCase + Payload suffix | `CreateUserPayload` |
| Connections | PascalCase + Connection suffix | `UserConnection` |

### Type Design

```graphql
type User {
  id: ID!
  email: String!
  firstName: String!
  lastName: String!
  displayName: String!          # Computed field
  createdAt: DateTime!
  updatedAt: DateTime!
  orders(first: Int, after: String): OrderConnection!
  status: UserStatus!
}

enum UserStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
}
```

### Input Types

Always use dedicated input types for mutations -- never reuse output types.

```graphql
input CreateUserInput {
  email: String!
  firstName: String!
  lastName: String!
}

input UpdateUserInput {
  email: String
  firstName: String
  lastName: String
}
```

### Payload Types

Wrap mutation responses in payload types for extensibility:

```graphql
type CreateUserPayload {
  user: User
  errors: [UserError!]!
}

type UserError {
  field: String
  message: String!
  code: ErrorCode!
}

enum ErrorCode {
  INVALID_INPUT
  NOT_FOUND
  ALREADY_EXISTS
  UNAUTHORIZED
  RATE_LIMITED
}
```

## Connection Pattern (Relay-style Pagination)

The standard for cursor-based pagination in GraphQL:

```graphql
type Query {
  users(
    first: Int
    after: String
    last: Int
    before: String
    filter: UserFilter
  ): UserConnection!
}

type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type UserEdge {
  node: User!
  cursor: String!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

input UserFilter {
  status: UserStatus
  createdAfter: DateTime
  search: String
}
```

### Usage

```graphql
query {
  users(first: 20, after: "cursor_abc", filter: { status: ACTIVE }) {
    edges {
      node {
        id
        email
        displayName
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
    totalCount
  }
}
```

## Mutation Design

### Standard Pattern

```graphql
type Mutation {
  createUser(input: CreateUserInput!): CreateUserPayload!
  updateUser(id: ID!, input: UpdateUserInput!): UpdateUserPayload!
  deleteUser(id: ID!): DeleteUserPayload!
  activateUser(id: ID!): ActivateUserPayload!
}
```

### Mutation Response

Always include both the result and potential errors:

```graphql
type UpdateUserPayload {
  user: User
  errors: [UserError!]!
}
```

This allows the client to handle partial success or validation errors without relying on top-level GraphQL errors.

## Error Handling

### Two Layers of Errors

1. **Top-level errors** -- Transport/schema errors (syntax, auth failures, server errors)
2. **Payload errors** -- Domain/business logic errors (validation, not found, conflicts)

```json
{
  "data": {
    "createUser": {
      "user": null,
      "errors": [
        {
          "field": "email",
          "message": "Email address is already registered",
          "code": "ALREADY_EXISTS"
        }
      ]
    }
  }
}
```

### Error Interface Pattern

```graphql
interface Error {
  message: String!
  code: ErrorCode!
}

type ValidationError implements Error {
  message: String!
  code: ErrorCode!
  field: String!
}

type NotFoundError implements Error {
  message: String!
  code: ErrorCode!
  resourceType: String!
  resourceId: ID!
}

union CreateUserError = ValidationError | NotFoundError
```

## Query Complexity and Depth Limiting

### Depth Limiting

Restrict query nesting to prevent abuse:

```graphql
# ALLOWED (depth 3)
query {
  user(id: "123") {
    orders {
      items {
        name
      }
    }
  }
}

# BLOCKED (depth exceeds limit)
query {
  user(id: "123") {
    orders {
      items {
        reviews {
          author {
            orders { ... }
          }
        }
      }
    }
  }
}
```

### Cost Analysis

Assign point values to fields and enforce a per-query budget:

```
user: 1 point
user.orders (connection): 2 points per item requested
user.orders.items: 1 point per item
Max budget: 1000 points per query
```

## Subscriptions

For real-time data:

```graphql
type Subscription {
  orderStatusChanged(orderId: ID!): Order!
  newMessage(channelId: ID!): Message!
}
```

### Implementation Notes

- Use WebSocket transport (graphql-ws protocol)
- Authenticate on connection init, not per subscription
- Include heartbeat/keep-alive mechanisms
- Limit concurrent subscriptions per client

## N+1 Problem Prevention

### DataLoader Pattern

Always use DataLoader (or equivalent) to batch and cache database queries:

```javascript
// Without DataLoader: N+1 queries
// With DataLoader: 2 queries (1 for users, 1 batched for all orders)
const orderLoader = new DataLoader(async (userIds) => {
  const orders = await db.orders.findMany({
    where: { userId: { in: userIds } },
  });
  return userIds.map(id => orders.filter(o => o.userId === id));
});
```

## Schema Evolution

### Non-breaking Changes (Safe)

- Adding new types
- Adding new fields to existing types
- Adding new enum values (with caution)
- Adding optional arguments to existing fields
- Deprecating fields

### Breaking Changes (Avoid)

- Removing types or fields
- Renaming types or fields
- Changing field types
- Making nullable fields non-nullable
- Removing enum values

### Deprecation

```graphql
type User {
  name: String! @deprecated(reason: "Use firstName and lastName instead")
  firstName: String!
  lastName: String!
}
```

## Agent-Friendly GraphQL Patterns

AI agents benefit from specific GraphQL design choices:

1. **Introspection** -- Keep introspection enabled in non-production environments so agents can discover the schema at runtime
2. **Descriptive field descriptions** -- Add `description` annotations to all types and fields in the schema
3. **Consistent payload patterns** -- Every mutation returns `{ result, errors }` so agents can programmatically check success
4. **Named queries** -- Encourage operation names for caching and logging (`query GetActiveUsers { ... }`)
5. **Persisted queries** -- Pre-register query hashes to reduce bandwidth and prevent query injection; agents send only the hash and variables
