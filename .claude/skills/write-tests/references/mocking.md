# Mocking Patterns

Mock and stub patterns for isolating code under test.

## Function Mocks

```typescript
import { vi, describe, it, expect } from 'vitest';

// Create mock function
const mockFn = vi.fn();
mockFn.mockReturnValue(42);

// With implementation
const mockCalc = vi.fn((x: number) => x * 2);

// Assertions
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
expect(mockFn).toHaveBeenCalledTimes(3);
expect(mockFn).toHaveReturnedWith(42);
```

## Module Mocks

```typescript
// Mock entire module
vi.mock('./api', () => ({
  fetchUser: vi.fn().mockResolvedValue({ name: 'Test' }),
}));

// Partial mock (keep real implementations)
vi.mock('./utils', async () => {
  const actual = await vi.importActual('./utils');
  return {
    ...actual,
    formatDate: vi.fn().mockReturnValue('2024-01-01'),
  };
});
```

## Spying on Existing Objects

```typescript
// Spy on method
const spy = vi.spyOn(object, 'method');
spy.mockReturnValue('mocked');

// Spy on global
vi.spyOn(console, 'log');
vi.spyOn(global, 'fetch');

// Restore original
spy.mockRestore();
```

## API Mocking with Fetch

```typescript
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation((url) => {
    if (url.includes('/users')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, name: 'Test' }]))
      );
    }
    return Promise.reject(new Error('Not found'));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

## API Mocking with MSW (Mock Service Worker)

```typescript
// mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/users', () => {
    return HttpResponse.json([
      { id: 1, name: 'Test User' }
    ]);
  }),

  http.post('/api/login', async ({ request }) => {
    const body = await request.json();
    if (body.password === 'wrong') {
      return HttpResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }
    return HttpResponse.json({ token: 'abc123' });
  }),
];

// tests/setup.ts
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

export const server = setupServer(...handlers);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Timer Mocks

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('debounces input', async () => {
  const handler = vi.fn();
  element.addEventListener('search', handler);

  element.value = 'test';

  // Not called yet (debounced)
  expect(handler).not.toHaveBeenCalled();

  // Fast-forward time
  vi.advanceTimersByTime(300);

  expect(handler).toHaveBeenCalled();
});
```

## Storage Mocks

```typescript
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// In test
localStorageMock.getItem.mockReturnValue('stored-value');
```

## Custom Element Mocks

```typescript
// Mock child component
class MockChildComponent extends HTMLElement {}
customElements.define('app-child', MockChildComponent);

// Or with behavior
class MockChildComponent extends HTMLElement {
  value = '';
  connectedCallback() {
    this.textContent = 'Mock Child';
  }
}
```
