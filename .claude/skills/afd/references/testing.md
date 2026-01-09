# Testing AFD Commands

Patterns for testing commands at multiple layers.

## Test Categories

| Layer | Tool | Purpose |
|-------|------|---------|
| **Unit** | Vitest | Test handler logic in isolation |
| **Validation** | Vitest | Test Zod schemas accept/reject |
| **Performance** | Vitest | Baseline response times |
| **AFD Compliance** | Vitest | Verify CommandResult structure |
| **Integration** | Vitest | Test command → store flow |
| **E2E** | Playwright | Test UI → command → response |

## Unit Tests

### Basic Command Test

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../store/memory.js';
import { createTodo } from './create.js';

beforeEach(() => {
  store.clear();
});

describe('todo.create', () => {
  it('creates todo with required fields', async () => {
    const result = await createTodo.handler(
      { title: 'Test', priority: 'medium' },
      {}
    );
    
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Test');
    expect(result.data?.id).toBeDefined();
  });
  
  it('uses default priority', async () => {
    const result = await createTodo.handler(
      { title: 'Test', priority: 'medium' },
      {}
    );
    
    expect(result.data?.priority).toBe('medium');
  });
});
```

### Error Handling Tests

```typescript
describe('todo.get', () => {
  it('returns NOT_FOUND for missing todo', async () => {
    const result = await getTodo.handler(
      { id: 'nonexistent' },
      {}
    );
    
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(result.error?.suggestion).toBeDefined();
  });
});

describe('todo.update', () => {
  it('returns NO_CHANGES when nothing to update', async () => {
    const created = await createTodo.handler(
      { title: 'Test', priority: 'medium' },
      {}
    );
    
    const result = await updateTodo.handler(
      { id: created.data!.id },
      {}
    );
    
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NO_CHANGES');
  });
});
```

## AFD Compliance Tests

Verify commands follow AFD patterns:

```typescript
describe('AFD Compliance', () => {
  it('success results include confidence', async () => {
    const result = await createTodo.handler(
      { title: 'Test', priority: 'medium' },
      {}
    );
    
    expect(result.success).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
  
  it('success results include reasoning', async () => {
    const result = await createTodo.handler(
      { title: 'Test', priority: 'medium' },
      {}
    );
    
    expect(result.reasoning).toBeDefined();
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning!.length).toBeGreaterThan(0);
  });
  
  it('error results include suggestion', async () => {
    const result = await getTodo.handler(
      { id: 'nonexistent' },
      {}
    );
    
    expect(result.success).toBe(false);
    expect(result.error?.suggestion).toBeDefined();
  });
  
  it('mutation commands include warnings when appropriate', async () => {
    const created = await createTodo.handler(
      { title: 'Test', priority: 'medium' },
      {}
    );
    const result = await deleteTodo.handler(
      { id: created.data!.id },
      {}
    );
    
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
  });
});
```

## Performance Tests

### Threshold-Based Tests

```typescript
const THRESHOLDS = {
  create: 10,   // ms
  get: 5,
  list: 20,
  update: 10,
  delete: 10,
};

describe('Performance', () => {
  it(`todo.create < ${THRESHOLDS.create}ms`, async () => {
    const start = performance.now();
    await createTodo.handler(
      { title: 'Test', priority: 'medium' },
      {}
    );
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(THRESHOLDS.create);
  });
});
```

### Percentile Tests

```typescript
describe('Latency Percentiles', () => {
  it('todo.create p50/p95/p99 within bounds', async () => {
    const durations: number[] = [];
    
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      await createTodo.handler(
        { title: `Test ${i}`, priority: 'medium' },
        {}
      );
      durations.push(performance.now() - start);
    }
    
    durations.sort((a, b) => a - b);
    
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const p99 = durations[Math.floor(durations.length * 0.99)];
    
    expect(p50).toBeLessThan(5);
    expect(p95).toBeLessThan(15);
    expect(p99).toBeLessThan(25);
  });
});
```

### Bulk Operations

```typescript
describe('Bulk Performance', () => {
  it('create 100 todos < 100ms', async () => {
    const start = performance.now();
    
    for (let i = 0; i < 100; i++) {
      await createTodo.handler(
        { title: `Bulk ${i}`, priority: 'medium' },
        {}
      );
    }
    
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(100);
  });
});
```

## Validation Tests

Test Zod schemas directly:

```typescript
import { z } from 'zod';

const inputSchema = z.object({
  title: z.string().min(1).max(200),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

describe('Input Validation', () => {
  it('accepts valid input', () => {
    const result = inputSchema.safeParse({
      title: 'Valid title',
      priority: 'high',
    });
    
    expect(result.success).toBe(true);
  });
  
  it('rejects empty title', () => {
    const result = inputSchema.safeParse({
      title: '',
      priority: 'medium',
    });
    
    expect(result.success).toBe(false);
  });
  
  it('rejects invalid priority', () => {
    const result = inputSchema.safeParse({
      title: 'Test',
      priority: 'invalid',
    });
    
    expect(result.success).toBe(false);
  });
  
  it('applies default priority', () => {
    const result = inputSchema.safeParse({
      title: 'Test',
    });
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('medium');
    }
  });
});
```

## Integration Tests

Test the full command → store → result flow:

```typescript
describe('Integration', () => {
  it('create → get → update → delete flow', async () => {
    // Create
    const created = await createTodo.handler(
      { title: 'Test', priority: 'low' },
      {}
    );
    expect(created.success).toBe(true);
    const id = created.data!.id;
    
    // Get
    const fetched = await getTodo.handler({ id }, {});
    expect(fetched.data?.title).toBe('Test');
    
    // Update
    const updated = await updateTodo.handler(
      { id, priority: 'high' },
      {}
    );
    expect(updated.data?.priority).toBe('high');
    
    // Delete
    const deleted = await deleteTodo.handler({ id }, {});
    expect(deleted.success).toBe(true);
    
    // Verify deleted
    const notFound = await getTodo.handler({ id }, {});
    expect(notFound.success).toBe(false);
    expect(notFound.error?.code).toBe('NOT_FOUND');
  });
});
```

## Test Setup

### Vitest Config

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

### Store Reset

```typescript
// Always reset store between tests
import { beforeEach } from 'vitest';
import { store } from '../store/memory.js';

beforeEach(() => {
  store.clear();
});
```

## Test Output

Performance tests should output a summary:

```
📊 Performance Summary

Command             Duration    Threshold   Status
────────────────────────────────────────────────────────
todo.create         0.85ms      10ms        ✓
todo.get            0.06ms      5ms         ✓
todo.list           8.7ms       20ms        ✓
────────────────────────────────────────────────────────

14/14 within threshold
```
