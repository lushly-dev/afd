# JavaScript/TypeScript Coding Standards

Detailed conventions for JS/TS code.

## Tooling

- **Linter:** ESLint
- **Formatter:** Prettier
- **Package manager:** npm (preferred)

## Variable Declarations

```typescript
// Prefer const
const config = loadConfig();

// Use let only when reassignment is needed
let counter = 0;
counter++;

// Never use var
```

## TypeScript Typing

### Strong Typing

```typescript
// Explicit types for function signatures
function processItems(items: Item[], options?: ProcessOptions): Result {
  // ...
}

// Interfaces for object shapes
interface UserData {
  id: string;
  name: string;
  email?: string;
}

// Use unknown for truly unknown types, never any
function parseInput(data: unknown): ParsedData {
  if (isValid(data)) {
    return data as ParsedData;
  }
  throw new Error("Invalid input");
}
```

### Type vs Interface

- **Interface:** Prefer for object shapes, can be extended
- **Type:** Use for unions, intersections, mapped types

## Modern Features

### Arrow Functions

```typescript
// For short callbacks
const doubled = items.map((item) => item * 2);

// Named functions for complex logic
function processComplexData(data: ComplexData): Result {
  // Multiple lines of logic
}
```

### Async/Await

```typescript
async function fetchData(): Promise<Data> {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    throw new Error(`Failed to fetch: ${error.message}`);
  }
}
```

### Template Literals

```typescript
// Template literals for interpolation
const message = `Hello, ${user.name}! You have ${count} items.`;
```

## Naming Conventions

| Element    | Convention                   | Example           |
| ---------- | ---------------------------- | ----------------- |
| Variables  | camelCase                    | `userData`        |
| Functions  | camelCase                    | `getUserData()`   |
| Classes    | PascalCase                   | `DataProcessor`   |
| Constants  | SCREAMING_SNAKE or camelCase | `MAX_RETRIES`     |
| Interfaces | PascalCase (no I prefix)     | `UserConfig`      |
| Types      | PascalCase                   | `ResponseData`    |
| Files      | kebab-case                   | `user-service.ts` |

## Module Patterns

```typescript
// Named exports for utilities
export function helperA() { ... }
export function helperB() { ... }

// Default export for main class/function
export default class MainService { ... }
```

## Error Handling

### Try/Catch Pattern

```typescript
async function fetchUserData(userId: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${userId}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch user ${userId}:`, error);
    throw new Error(`Unable to load user data: ${error.message}`);
  }
}
```

### Custom Error Classes

```typescript
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}
```

### Result Pattern (Alternative to Exceptions)

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

function parseConfig(input: string): Result<Config> {
  try {
    const config = JSON.parse(input);
    return { success: true, data: config };
  } catch (e) {
    return { success: false, error: new Error("Invalid JSON") };
  }
}
```

## Best Practices

1. **Enable strict mode** in tsconfig.json
2. **Use optional chaining** (`?.`) and nullish coalescing (`??`)
3. **Destructure objects/arrays** where it improves readability
4. **Keep functions pure** when possible
5. **Document public APIs** with JSDoc comments
