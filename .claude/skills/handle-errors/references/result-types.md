# Result and Either Types

Type-safe error handling patterns using Result types, discriminated unions, neverthrow, and Effect for TypeScript, plus equivalent patterns in Python.

## Why Result Types

Traditional try-catch has fundamental problems:

1. **Invisible failures** -- Function signatures do not declare what errors they throw
2. **Unchecked handling** -- Callers can ignore errors with no compiler warning
3. **Control flow disruption** -- Exceptions break normal flow; hard to compose
4. **Type erasure** -- Caught errors are `unknown` in TypeScript, losing type information

Result types solve these by making errors explicit return values in the type system.

## Discriminated Unions (Zero Dependencies)

The simplest approach, using only TypeScript's type system:

```typescript
// Define success and failure types with a discriminant
type Success<T> = { ok: true; value: T };
type Failure<E> = { ok: false; error: E };
type Result<T, E> = Success<T> | Failure<E>;

// Constructors
function Ok<T>(value: T): Success<T> {
  return { ok: true, value };
}

function Err<E>(error: E): Failure<E> {
  return { ok: false, error };
}

// Usage
function divide(a: number, b: number): Result<number, 'DIVISION_BY_ZERO'> {
  if (b === 0) return Err('DIVISION_BY_ZERO');
  return Ok(a / b);
}

const result = divide(10, 0);
if (result.ok) {
  console.log(result.value); // TypeScript knows this is number
} else {
  console.log(result.error); // TypeScript knows this is 'DIVISION_BY_ZERO'
}
```

### Exhaustive Error Handling

```typescript
type UserError =
  | { type: 'NOT_FOUND'; userId: string }
  | { type: 'VALIDATION'; fields: string[] }
  | { type: 'FORBIDDEN'; requiredRole: string };

function handleUserError(error: UserError): string {
  switch (error.type) {
    case 'NOT_FOUND':
      return `User ${error.userId} not found`;
    case 'VALIDATION':
      return `Invalid fields: ${error.fields.join(', ')}`;
    case 'FORBIDDEN':
      return `Requires role: ${error.requiredRole}`;
    default:
      // Compile error if a case is missing
      const _exhaustive: never = error;
      return _exhaustive;
  }
}
```

## neverthrow

The most popular Result type library for TypeScript. Rust-inspired, with excellent chaining support.

### Installation and Basic Usage

```bash
npm install neverthrow
```

```typescript
import { ok, err, Result, ResultAsync } from 'neverthrow';

// Sync
function parseAge(input: string): Result<number, 'INVALID_AGE'> {
  const age = parseInt(input, 10);
  if (isNaN(age) || age < 0 || age > 150) {
    return err('INVALID_AGE');
  }
  return ok(age);
}

// Async
function fetchUser(id: string): ResultAsync<User, ApiError> {
  return ResultAsync.fromPromise(
    fetch(`/api/users/${id}`).then(r => {
      if (!r.ok) throw new ApiError(r.status, r.statusText);
      return r.json();
    }),
    (error) => error instanceof ApiError
      ? error
      : new ApiError(0, 'Network error')
  );
}
```

### Chaining with map and andThen

```typescript
import { ok, err, Result } from 'neverthrow';

interface User { id: string; email: string; age: number }
interface Profile { userId: string; displayName: string }

function validateEmail(email: string): Result<string, ValidationError> {
  if (!email.includes('@')) return err(new ValidationError('Invalid email'));
  return ok(email);
}

function validateAge(age: number): Result<number, ValidationError> {
  if (age < 18) return err(new ValidationError('Must be 18+'));
  return ok(age);
}

function createUser(email: string, age: number): Result<User, ValidationError> {
  return validateEmail(email)
    .andThen(validEmail =>
      validateAge(age)
        .map(validAge => ({
          id: crypto.randomUUID(),
          email: validEmail,
          age: validAge,
        }))
    );
}

// Combine multiple results
import { Result as R } from 'neverthrow';

function validateUserInput(input: unknown): Result<ValidInput, ValidationError> {
  return R.combine([
    validateEmail(input.email),
    validateAge(input.age),
    validateName(input.name),
  ]).map(([email, age, name]) => ({ email, age, name }));
}
```

### Wrapping Existing Code

```typescript
import { fromThrowable, ResultAsync } from 'neverthrow';

// Wrap a throwing function
const safeJsonParse = fromThrowable(
  JSON.parse,
  (e) => new ParseError(`Invalid JSON: ${e}`)
);

const result = safeJsonParse('{"valid": true}');
// Result<any, ParseError>

// Wrap a Promise
const safeFetch = ResultAsync.fromPromise(
  fetch('/api/data').then(r => r.json()),
  (e) => new NetworkError('Fetch failed', { cause: toError(e) })
);
```

### Pattern: Service Layer with neverthrow

```typescript
class UserService {
  async getUser(id: string): Promise<Result<User, NotFoundError | DatabaseError>> {
    return ResultAsync.fromPromise(
      this.db.users.findUnique({ where: { id } }),
      (e) => new DatabaseError('Query failed', { cause: toError(e) })
    ).andThen(user =>
      user ? ok(user) : err(new NotFoundError('User', id))
    );
  }

  async updateEmail(
    userId: string,
    newEmail: string
  ): Promise<Result<User, NotFoundError | ValidationError | DatabaseError>> {
    return validateEmail(newEmail)
      .asyncAndThen(() => this.getUser(userId))
      .andThen(user =>
        ResultAsync.fromPromise(
          this.db.users.update({ where: { id: userId }, data: { email: newEmail } }),
          (e) => new DatabaseError('Update failed', { cause: toError(e) })
        )
      );
  }
}
```

## Effect (Advanced)

Effect provides the most comprehensive typed error handling system. It tracks success, failure, and requirements in the type signature: `Effect<Success, Error, Requirements>`.

### Basic Usage

```typescript
import { Effect, Either } from 'effect';

// Create effects that can fail
const parseNumber = (input: string): Effect.Effect<number, ParseError> =>
  Effect.try({
    try: () => {
      const n = Number(input);
      if (isNaN(n)) throw new Error('NaN');
      return n;
    },
    catch: () => new ParseError({ input }),
  });

// Tagged errors for catchTag
class ParseError extends Error {
  readonly _tag = 'ParseError';
  constructor(readonly context: { input: string }) {
    super(`Failed to parse: ${context.input}`);
  }
}

class NotFoundError extends Error {
  readonly _tag = 'NotFoundError';
  constructor(readonly id: string) {
    super(`Not found: ${id}`);
  }
}

// Handle specific errors by tag
const program = Effect.gen(function* () {
  const user = yield* getUser('123');
  return user;
}).pipe(
  Effect.catchTag('NotFoundError', (e) =>
    Effect.succeed({ id: e.id, name: 'Guest' })
  ),
  // ParseError would still propagate (type-safe!)
);
```

### Composing Effects

```typescript
import { Effect, pipe } from 'effect';

const createOrder = (userId: string, items: Item[]): Effect.Effect<
  Order,
  NotFoundError | ValidationError | DatabaseError
> =>
  Effect.gen(function* () {
    const user = yield* getUser(userId);           // NotFoundError
    const validated = yield* validateItems(items);  // ValidationError
    const order = yield* saveOrder(user, validated); // DatabaseError
    return order;
  });
```

### Effect vs neverthrow: When to Choose

| Factor | neverthrow | Effect |
|---|---|---|
| Learning curve | Low | High |
| Bundle size | ~3KB | ~50KB+ |
| Error tracking | Result<T, E> | Effect<A, E, R> (tracks dependencies too) |
| Async support | ResultAsync | Built-in, unified |
| Composition | .andThen, .map | Generators, pipe, comprehensive operators |
| Concurrency | Manual | Built-in (Effect.all, Race, etc.) |
| Retries | Manual | Effect.retry with Schedule |
| Best for | Adding Result types to existing code | New projects embracing functional patterns |

**Recommendation:** Start with neverthrow for teams new to Result types. Adopt Effect for greenfield projects or when you need its concurrency, scheduling, and dependency injection features.

## Python Result Patterns

### Using the returns Library

```bash
pip install returns
```

```python
from returns.result import Result, Success, Failure, safe
from returns.pipeline import flow
from returns.pointfree import bind

# Basic usage
def parse_age(value: str) -> Result[int, str]:
    try:
        age = int(value)
        if age < 0 or age > 150:
            return Failure("Age out of range")
        return Success(age)
    except ValueError:
        return Failure("Not a valid number")

# @safe decorator wraps exceptions into Result
@safe
def divide(a: float, b: float) -> float:
    return a / b  # ZeroDivisionError -> Failure

result = divide(10.0, 0.0)  # Failure(ZeroDivisionError(...))

# Chaining
def process_input(raw: str) -> Result[ProcessedData, str]:
    return flow(
        raw,
        parse_age,
        bind(lambda age: validate_range(age)),
        bind(lambda age: Success(ProcessedData(age=age))),
    )
```

### Simple Custom Result (No Dependencies)

```python
from __future__ import annotations
from dataclasses import dataclass
from typing import Generic, TypeVar, Union, Callable

T = TypeVar("T")
E = TypeVar("E")
U = TypeVar("U")


@dataclass(frozen=True)
class Ok(Generic[T]):
    value: T

    def is_ok(self) -> bool:
        return True

    def is_err(self) -> bool:
        return False

    def map(self, fn: Callable[[T], U]) -> Result[U, E]:
        return Ok(fn(self.value))

    def and_then(self, fn: Callable[[T], Result[U, E]]) -> Result[U, E]:
        return fn(self.value)

    def unwrap(self) -> T:
        return self.value

    def unwrap_or(self, default: T) -> T:
        return self.value


@dataclass(frozen=True)
class Err(Generic[E]):
    error: E

    def is_ok(self) -> bool:
        return False

    def is_err(self) -> bool:
        return True

    def map(self, fn: Callable) -> Result[any, E]:
        return self  # type: ignore

    def and_then(self, fn: Callable) -> Result[any, E]:
        return self  # type: ignore

    def unwrap(self) -> never:
        raise ValueError(f"Called unwrap on Err: {self.error}")

    def unwrap_or(self, default: T) -> T:
        return default


Result = Union[Ok[T], Err[E]]


# Usage with match (Python 3.10+)
def get_user(user_id: str) -> Result[User, NotFoundError]:
    user = db.find_user(user_id)
    if user is None:
        return Err(NotFoundError("User", user_id))
    return Ok(user)

result = get_user("abc")
match result:
    case Ok(user):
        print(f"Found: {user.name}")
    case Err(error):
        print(f"Error: {error}")
```

## Pattern: Boundary Conversion

Convert between Result types and exceptions at system boundaries:

```typescript
// At API boundary: convert Result to HTTP response
function handleResult<T>(result: Result<T, AppError>): Response {
  if (result.isOk()) {
    return Response.json(result.value, { status: 200 });
  }

  const error = result.error;
  return Response.json(
    {
      type: `https://api.example.com/errors/${error.code.toLowerCase()}`,
      title: error.name,
      status: ERROR_CODES[error.code]?.httpStatus ?? 500,
      detail: error.message,
    },
    { status: ERROR_CODES[error.code]?.httpStatus ?? 500 }
  );
}

// At library boundary: convert exceptions to Result
function wrapLibrary<T>(fn: () => T): Result<T, AppError> {
  try {
    return ok(fn());
  } catch (error) {
    return err(new AppError('Library call failed', { cause: toError(error) }));
  }
}
```

```python
# At API boundary (FastAPI example)
from fastapi import Request
from fastapi.responses import JSONResponse

async def result_to_response(result: Result) -> JSONResponse:
    match result:
        case Ok(value):
            return JSONResponse(content=value, status_code=200)
        case Err(error) if isinstance(error, AppError):
            return JSONResponse(
                content=error.to_dict(),
                status_code=ErrorCodes[error.code].value.http_status,
            )
```

## Anti-Patterns

- **`.unwrap()` everywhere** -- Defeats the purpose. Use `.map()`, `.andThen()`, or pattern matching.
- **Mixing Result returns with thrown exceptions** -- Choose one pattern per layer. Convert at boundaries.
- **`Result<T, Error>`** -- The error type `Error` is too broad. Use specific error types for each function.
- **Ignoring the error channel** -- `result.isOk() && doThing(result.value)` without handling the error case.
- **Nested Results** -- `Result<Result<T, E1>, E2>` signals a missing `.andThen()` / `.flatMap()`.
