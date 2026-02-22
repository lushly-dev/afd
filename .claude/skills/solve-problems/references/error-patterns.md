# Error Patterns

Common error messages, their root causes, and proven fix patterns.

## Quick Lookup Table

| Error Pattern | Likely Cause | Section |
|---|---|---|
| `Type 'X' is not assignable to type 'Y'` | TypeScript type mismatch | TypeScript Errors |
| `Property 'X' does not exist on type 'Y'` | Missing property or wrong type | TypeScript Errors |
| `Cannot find module 'X'` | Missing package or bad path | Build Errors |
| `undefined is not a function` | Calling method on undefined/null | Runtime Errors |
| `Cannot read property 'X' of undefined` | Accessing property on undefined | Runtime Errors |
| `Module not found` | Typo in import path or missing dep | Build Errors |
| `Maximum call stack size exceeded` | Infinite recursion | Runtime Errors |
| `Hydration mismatch` | SSR/client rendering difference | Framework Errors |
| `CORS error` | Missing Access-Control headers | Network Errors |
| `401 Unauthorized` | Auth token missing or expired | Network Errors |
| `Circular dependency` | Modules importing each other | Build Errors |

## TypeScript Errors

### Type 'X' is not assignable to type 'Y'

**Root Cause**: A value does not match the expected type. Often involves `undefined` or `null` in union types.

```typescript
// Error: Type 'string | undefined' not assignable to 'string'
const value: string = maybeString; // wrong

// Fix: Handle the undefined case
const value: string = maybeString ?? 'default'; // correct
const value = maybeString!; // only if certain it exists
```

### Property 'X' does not exist on type 'Y'

**Root Cause**: Accessing a property not declared on the type. Happens with DOM elements, untyped objects, or extended interfaces.

```typescript
// Error
element.customProp = value; // wrong

// Fix: Type assertion or interface extension
(element as CustomElement).customProp = value;
```

### Cannot find module 'X'

**Root Cause**: Package not installed, or types package missing.

```bash
# Check if installed
pnpm list <package>

# Install if missing
pnpm add <package>

# If type-only package
pnpm add -D @types/<package>
```

## Runtime Errors

### undefined is not a function

**Root Cause**: Calling a method on an undefined or null reference.

```typescript
// Error
this.handler(); // handler is undefined

// Fix: Optional chaining
this.handler?.();

// Or ensure binding
this.handler = this.handleClick.bind(this);
```

### Cannot read property 'X' of undefined

**Root Cause**: Accessing a property on an undefined or null value. Often from missing data, uninitialized state, or async timing.

```typescript
// Error
user.name // user is undefined

// Fix: Optional chaining
user?.name

// Or nullish coalescing for defaults
const name = user?.name ?? 'Anonymous';
```

### Maximum call stack size exceeded

**Root Cause**: Infinite recursion. A function calls itself (directly or indirectly) without a valid termination condition.

**Investigation**:
1. Read the stack trace -- the repeating frame is the recursive call
2. Check the termination condition
3. Look for indirect recursion through event handlers or observers

## Build Errors

### Module not found

**Causes**:
- Typo in import path
- Missing file extension (or including `.ts` extension incorrectly)
- Missing dependency
- Case sensitivity mismatch (Linux/CI vs local)

```typescript
// Check relative paths
import './component.ts';     // wrong -- do not include .ts
import './component';        // correct

// Check case sensitivity (matters on Linux/CI)
import './Component';        // wrong if file is component.ts
import './component';        // correct
```

### Circular dependency

**Symptoms**: Module evaluates to `undefined` at import time.

**Root Cause**: Module A imports B, and B imports A (directly or through a chain).

```typescript
// Fix: Extract shared code to a third module
// shared.ts -- both A and B import from here instead
```

**Detection**: Build tools often warn about circular deps. Follow the import chain in the error output.

## Component / Framework Errors

### Element not registering

**Root Cause**: Missing decorator or missing import of the component file.

```typescript
// Ensure decorator is present
@customElement({ name: 'app-my-element', template, styles })
export class MyElement extends FASTElement {}

// Ensure element is imported somewhere in the app
import './components/my-element';
```

### Template binding not updating

**Root Cause**: Property is not marked as reactive/observable.

```typescript
// Reactive -- will trigger re-render
@observable myProp = '';  // correct

// Plain property -- no reactivity
myProp = '';  // wrong
```

### Hydration mismatch

**Root Cause**: Server-rendered HTML differs from client-rendered HTML. Common causes: date/time formatting, random values, browser-only APIs used during SSR.

**Fix**: Ensure deterministic rendering. Guard browser-only code with environment checks.

## Network Errors

### CORS error

**Symptoms**: `Access-Control-Allow-Origin header missing` in console.

**Fixes**:
1. Server needs to add CORS headers for the requesting origin
2. Use a proxy in development
3. Use same-origin requests when possible

### 401 Unauthorized

**Investigation**:
1. Check that auth token exists
2. Check that token has not expired
3. Check that token is sent in the correct header (`Authorization: Bearer <token>`)
4. Check that the token has the required scopes/permissions

### Network timeout

**Investigation**:
1. Check that the service is running
2. Check that the URL is correct
3. Check for DNS resolution issues
4. Check for firewall or proxy blocking
