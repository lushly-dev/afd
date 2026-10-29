# gRPC API Design Patterns

Detailed reference for gRPC service design, Protobuf conventions, and operational patterns.

## Protobuf Style Guide

### File Organization

```protobuf
// File: user/v1/user_service.proto
syntax = "proto3";

package user.v1;

option go_package = "github.com/myorg/api/user/v1;userv1";
option java_package = "com.myorg.api.user.v1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/field_mask.proto";
```

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Package | `lowercase.dotted.v1` | `user.v1` |
| Service | PascalCase + Service suffix | `UserService` |
| RPC methods | PascalCase verb-noun | `GetUser`, `ListUsers` |
| Messages | PascalCase | `GetUserRequest`, `User` |
| Fields | snake_case | `first_name`, `created_at` |
| Enums | PascalCase | `UserStatus` |
| Enum values | SCREAMING_SNAKE_CASE with prefix | `USER_STATUS_ACTIVE` |
| Repeated fields | Plural | `repeated string tags` |

### Enum Design

Always define an UNSPECIFIED zero value:

```protobuf
enum UserStatus {
  USER_STATUS_UNSPECIFIED = 0;  // Required: default/unknown
  USER_STATUS_ACTIVE = 1;
  USER_STATUS_INACTIVE = 2;
  USER_STATUS_SUSPENDED = 3;
}
```

Prefix enum values with the enum name to avoid namespace collisions within the package.

## Service Design

### Standard RPC Patterns

```protobuf
service UserService {
  // Standard CRUD
  rpc CreateUser(CreateUserRequest) returns (User);
  rpc GetUser(GetUserRequest) returns (User);
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
  rpc UpdateUser(UpdateUserRequest) returns (User);
  rpc DeleteUser(DeleteUserRequest) returns (google.protobuf.Empty);

  // Custom action
  rpc ActivateUser(ActivateUserRequest) returns (User);

  // Streaming
  rpc WatchUsers(WatchUsersRequest) returns (stream UserEvent);
  rpc UploadUsers(stream UploadUserRequest) returns (UploadUsersResponse);
}
```

### Request/Response Design

Every RPC must have its own request and response message, even if the message is empty. This allows backward-compatible evolution.

```protobuf
message GetUserRequest {
  string user_id = 1;
}

message ListUsersRequest {
  int32 page_size = 1;        // Max items per page
  string page_token = 2;      // Cursor for next page
  string filter = 3;          // CEL filter expression
  string order_by = 4;        // e.g., "created_at desc"
}

message ListUsersResponse {
  repeated User users = 1;
  string next_page_token = 2;
  int32 total_size = 3;
}
```

### Update with FieldMask

Use `google.protobuf.FieldMask` for partial updates:

```protobuf
import "google/protobuf/field_mask.proto";

message UpdateUserRequest {
  User user = 1;
  google.protobuf.FieldMask update_mask = 2;
}
```

This is the gRPC equivalent of PATCH -- only fields listed in the mask are updated.

## Well-Known Types

Always use Google's well-known types instead of custom definitions:

| Type | Use For |
|------|---------|
| `google.protobuf.Timestamp` | Date/time values |
| `google.protobuf.Duration` | Time spans |
| `google.protobuf.FieldMask` | Partial updates |
| `google.protobuf.Empty` | No data needed |
| `google.protobuf.Struct` | Dynamic JSON-like data |
| `google.protobuf.Any` | Polymorphic messages |
| `google.protobuf.StringValue` (wrappers) | Nullable scalar fields |

## Error Handling

### gRPC Status Codes

| Code | Name | HTTP Equivalent | Use When |
|------|------|-----------------|----------|
| 0 | OK | 200 | Success |
| 1 | CANCELLED | 499 | Client cancelled request |
| 2 | UNKNOWN | 500 | Unknown error |
| 3 | INVALID_ARGUMENT | 400 | Bad input |
| 4 | DEADLINE_EXCEEDED | 504 | Timeout |
| 5 | NOT_FOUND | 404 | Resource doesn't exist |
| 6 | ALREADY_EXISTS | 409 | Duplicate resource |
| 7 | PERMISSION_DENIED | 403 | Insufficient permissions |
| 9 | FAILED_PRECONDITION | 400 | State precondition not met |
| 10 | ABORTED | 409 | Concurrency conflict |
| 11 | OUT_OF_RANGE | 400 | Value outside valid range |
| 12 | UNIMPLEMENTED | 501 | Method not implemented |
| 13 | INTERNAL | 500 | Internal server error |
| 14 | UNAVAILABLE | 503 | Service temporarily unavailable |
| 16 | UNAUTHENTICATED | 401 | Missing/invalid auth |

### Rich Error Details

Use `google.rpc.Status` with error details for machine-readable errors:

```protobuf
import "google/rpc/error_details.proto";

// Return rich errors with:
// - BadRequest.FieldViolation: field-level validation errors
// - RetryInfo: when and how to retry
// - DebugInfo: stack traces (dev only)
// - ErrorInfo: domain/reason/metadata
```

```go
// Go example
st := status.New(codes.InvalidArgument, "invalid user data")
st, _ = st.WithDetails(&errdetails.BadRequest{
    FieldViolations: []*errdetails.BadRequest_FieldViolation{
        {Field: "email", Description: "must be a valid email address"},
    },
})
return nil, st.Err()
```

## Streaming Patterns

### Server Streaming (1:N)

Server sends a stream of responses to a single client request. Use for: real-time feeds, large data exports, event subscriptions.

```protobuf
rpc WatchUsers(WatchUsersRequest) returns (stream UserEvent);

message UserEvent {
  enum EventType {
    EVENT_TYPE_UNSPECIFIED = 0;
    EVENT_TYPE_CREATED = 1;
    EVENT_TYPE_UPDATED = 2;
    EVENT_TYPE_DELETED = 3;
  }
  EventType type = 1;
  User user = 2;
  google.protobuf.Timestamp occurred_at = 3;
}
```

### Client Streaming (N:1)

Client sends a stream of requests, server responds once. Use for: file uploads, batch imports.

```protobuf
rpc UploadUsers(stream UploadUserRequest) returns (UploadUsersResponse);
```

### Bidirectional Streaming (N:N)

Both client and server stream messages. Use for: chat, collaborative editing, real-time sync.

```protobuf
rpc Chat(stream ChatMessage) returns (stream ChatMessage);
```

## Versioning

### Package Versioning

Version at the package level, not per-RPC:

```protobuf
package user.v1;    // Stable
package user.v2;    // Breaking changes
package user.v1beta1;  // Pre-release
```

### Backward Compatibility Rules

**Safe changes (non-breaking):**
- Adding new fields (with new tag numbers)
- Adding new RPCs to a service
- Adding new enum values
- Adding new services
- Deprecating fields or RPCs

**Breaking changes (require new version):**
- Removing or renaming fields
- Changing field types or tag numbers
- Removing enum values
- Changing RPC signatures
- Renaming services or methods

### Field Deprecation

```protobuf
message User {
  string user_id = 1;
  string name = 2 [deprecated = true];  // Use first_name + last_name
  string first_name = 3;
  string last_name = 4;
}
```

Never reuse tag numbers from removed fields. Reserve them:

```protobuf
message User {
  reserved 2;
  reserved "name";
}
```

## Interceptors and Middleware

Common interceptor patterns:

| Interceptor | Purpose |
|-------------|---------|
| Authentication | Validate tokens from metadata |
| Logging | Log RPC calls with duration and status |
| Metrics | Prometheus/OTEL counters and histograms |
| Rate Limiting | Per-client request throttling |
| Retry | Client-side retry with backoff |
| Deadline Propagation | Ensure deadlines chain across services |
| Validation | Validate request messages via protovalidate |

## Agent-Friendly gRPC

For AI agents consuming gRPC services:

1. **gRPC-Gateway** -- Expose a REST/JSON proxy alongside gRPC so agents with HTTP-only tooling can interact with the API
2. **Reflection** -- Enable server reflection in non-production so agents can discover services dynamically
3. **Descriptive comments** -- Add doc comments to all services, RPCs, and messages in `.proto` files; these propagate to generated documentation
4. **Consistent patterns** -- Follow Google's AIP (API Improvement Proposals) for uniform CRUD, filtering, and pagination patterns
