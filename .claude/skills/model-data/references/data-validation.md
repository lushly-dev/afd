# Data Validation at the Boundary

Validation strategies using Zod, Pydantic, JSON Schema, and database-level constraints.

---

## Validation Layer Strategy

Validate data at every boundary where untrusted input enters the system:

```
User Input → API Boundary → Application Logic → Database
     ↑              ↑               ↑              ↑
  Client-side   Schema validation  Domain rules   Constraints
  (UX only)     (Zod/Pydantic)    (business)     (DB-level)
```

**Defense in depth**: Never rely on a single validation layer. Client-side validation is for UX; server-side validation is for correctness; database constraints are the last line of defense.

---

## Zod (TypeScript / JavaScript)

### Schema Definition

```typescript
import { z } from 'zod';

// User creation schema
export const CreateUserSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  name: z.string().min(1).max(255).trim(),
  age: z.number().int().min(13).max(150).optional(),
  role: z.enum(['user', 'admin', 'moderator']).default('user'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Infer TypeScript type from schema
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Update schema: all fields optional except id
export const UpdateUserSchema = CreateUserSchema.partial().extend({
  id: z.number().int().positive(),
});

// Strict mode: reject unknown keys
export const StrictCreateUserSchema = CreateUserSchema.strict();
```

### Validation Patterns

```typescript
// Parse and validate (throws on failure)
const user = CreateUserSchema.parse(rawInput);

// Safe parse (returns result object)
const result = CreateUserSchema.safeParse(rawInput);
if (!result.success) {
  console.error(result.error.flatten());
  // { formErrors: [], fieldErrors: { email: ['Invalid email'] } }
}

// Transform during validation
const MoneySchema = z.string()
  .regex(/^\d+\.\d{2}$/, 'Must be a valid dollar amount')
  .transform((val) => Math.round(parseFloat(val) * 100)); // Convert to cents

// Discriminated unions for polymorphic data
const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), x: z.number(), y: z.number() }),
  z.object({ type: z.literal('keypress'), key: z.string() }),
  z.object({ type: z.literal('scroll'), delta: z.number() }),
]);

// Composable schemas
const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const ListPostsSchema = PaginationSchema.extend({
  authorId: z.number().int().positive().optional(),
  published: z.boolean().optional(),
});
```

### Integration with ORMs

```typescript
// Zod + Drizzle: validate before insert
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { users } from './schema';

const insertUserSchema = createInsertSchema(users, {
  email: (schema) => schema.email.max(255),
});

const selectUserSchema = createSelectSchema(users);
```

---

## Pydantic (Python)

### Model Definition

```python
from pydantic import BaseModel, Field, EmailStr, field_validator
from datetime import datetime
from enum import Enum
from typing import Optional

class UserRole(str, Enum):
    USER = "user"
    ADMIN = "admin"
    MODERATOR = "moderator"

class CreateUserInput(BaseModel):
    email: EmailStr = Field(max_length=255)
    name: str = Field(min_length=1, max_length=255)
    age: Optional[int] = Field(None, ge=13, le=150)
    role: UserRole = UserRole.USER
    metadata: Optional[dict[str, Any]] = None

    model_config = {"strict": True, "str_strip_whitespace": True}

    @field_validator("name")
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip()

class UpdateUserInput(BaseModel):
    id: int = Field(gt=0)
    email: Optional[EmailStr] = None
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    age: Optional[int] = Field(None, ge=13, le=150)
    role: Optional[UserRole] = None

class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: UserRole
    created_at: datetime

    model_config = {"from_attributes": True}  # Works with ORM objects
```

### Validation Patterns

```python
# Parse and validate
try:
    user = CreateUserInput.model_validate(raw_input)
except ValidationError as e:
    print(e.errors())  # List of error dicts

# From ORM object
db_user = session.get(UserModel, user_id)
response = UserResponse.model_validate(db_user)

# JSON Schema generation (for documentation / OpenAPI)
schema = CreateUserInput.model_json_schema()

# Discriminated unions
from pydantic import Discriminator, Tag
from typing import Annotated, Union

class ClickEvent(BaseModel):
    type: Literal["click"]
    x: float
    y: float

class KeypressEvent(BaseModel):
    type: Literal["keypress"]
    key: str

Event = Annotated[
    Union[
        Annotated[ClickEvent, Tag("click")],
        Annotated[KeypressEvent, Tag("keypress")],
    ],
    Discriminator("type"),
]
```

---

## JSON Schema

Use JSON Schema as a language-agnostic validation contract shared between services.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["email", "name"],
  "properties": {
    "email": {
      "type": "string",
      "format": "email",
      "maxLength": 255
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "age": {
      "type": "integer",
      "minimum": 13,
      "maximum": 150
    },
    "role": {
      "type": "string",
      "enum": ["user", "admin", "moderator"],
      "default": "user"
    }
  },
  "additionalProperties": false
}
```

**Use JSON Schema when**:
- Multiple languages / services need to agree on a contract
- API documentation (OpenAPI / Swagger) is the source of truth
- Database document validation (MongoDB schema validation)
- AI structured output enforcement

---

## Database-Level Constraints

The final defense layer. Even if application validation fails, the database enforces integrity.

```sql
CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  age INT,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Uniqueness
  CONSTRAINT uq_users_email UNIQUE (email),

  -- Check constraints
  CONSTRAINT chk_users_age CHECK (age IS NULL OR (age >= 13 AND age <= 150)),
  CONSTRAINT chk_users_role CHECK (role IN ('user', 'admin', 'moderator')),
  CONSTRAINT chk_users_email_format CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  CONSTRAINT chk_users_name_not_blank CHECK (trim(name) <> '')
);
```

---

## Validation Strategy by Layer

| Layer | Tool | What It Catches | Failure Mode |
|-------|------|----------------|-------------|
| Client (browser/app) | HTML5 validation, Zod | Typos, format errors | Inline error messages |
| API boundary | Zod / Pydantic | Malformed input, missing fields, wrong types | 400 Bad Request with field errors |
| Application logic | Domain services | Business rule violations | 422 Unprocessable Entity |
| Database | CHECK, UNIQUE, FK, NOT NULL | Last-resort data integrity | 500 or constraint violation error |

---

## Agent Considerations

- **Schema-first design**: Define Zod/Pydantic schemas before writing any database or API code. Agents work best when validation rules are declared upfront and co-located with type definitions.
- **Infer types from schemas**: Use `z.infer<>` (Zod) or `model_validate` (Pydantic) so validation schemas are the single source of truth for types. Agents should never maintain separate type definitions.
- **Structured output enforcement**: When using AI/LLM outputs as data, always validate through the schema. Use strict mode to reject unexpected fields.
- **Error messages for agents**: Use `.describe()` in Zod or `Field(description=...)` in Pydantic to add human/agent-readable descriptions to every field. These descriptions appear in generated JSON schemas.
- **Composability**: Build schemas from smaller pieces (pagination, timestamps, common fields) that agents can recognize and reuse across endpoints.
