# Vitest Patterns

Unit testing patterns for web components and TypeScript applications.

## Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 80,
      },
    },
  },
});
```

## Testing Components

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../src/components/my-button';

describe('MyButton', () => {
  let element: HTMLElement;

  beforeEach(async () => {
    element = document.createElement('app-my-button');
    document.body.appendChild(element);
    await element.updateComplete; // Wait for render
  });

  afterEach(() => {
    element.remove();
  });

  it('renders with default state', () => {
    const shadow = element.shadowRoot!;
    expect(shadow.querySelector('button')).toBeTruthy();
  });

  it('reflects disabled attribute', () => {
    element.setAttribute('disabled', '');
    expect(element.hasAttribute('disabled')).toBe(true);
  });
});
```

## Testing Events

```typescript
it('emits click event', async () => {
  const handler = vi.fn();
  element.addEventListener('click', handler);

  const button = element.shadowRoot!.querySelector('button')!;
  button.click();

  expect(handler).toHaveBeenCalledTimes(1);
});

it('emits custom event with data', async () => {
  const handler = vi.fn();
  element.addEventListener('submit', handler);

  element.submit();

  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({
      detail: { value: 'expected' }
    })
  );
});
```

## Testing Async Operations

```typescript
it('fetches data on connect', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ name: 'Test' }))
  );

  const element = document.createElement('app-user-card');
  element.setAttribute('user-id', '123');
  document.body.appendChild(element);

  await vi.waitFor(() => {
    expect(element.shadowRoot!.textContent).toContain('Test');
  });
});
```

## Snapshot Testing

```typescript
it('matches snapshot', async () => {
  element.setAttribute('variant', 'primary');
  await element.updateComplete;

  expect(element.shadowRoot!.innerHTML).toMatchSnapshot();
});
```

## Test Utility Helper

```typescript
// tests/setup.ts
export async function createElement<T extends HTMLElement>(
  tag: string,
  attrs: Record<string, string> = {}
): Promise<T> {
  const el = document.createElement(tag) as T;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.body.appendChild(el);
  await (el as any).updateComplete;
  return el;
}
```
