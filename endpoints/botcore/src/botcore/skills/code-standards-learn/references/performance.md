# Performance Best Practices

Guidelines for writing performant code.

## General Principles

1. **Measure first** -- Profile before optimizing
2. **Optimize hot paths** -- Focus on frequently executed code
3. **Avoid premature optimization** -- Clarity first, then optimize if needed

## JavaScript/TypeScript

### Avoid Unnecessary Operations

```typescript
// Cache expensive computations
const processedItems = useMemo(
  () => items.map((item) => expensiveTransform(item)),
  [items]
);

// Early returns
function processData(data: Data | null): Result {
  if (!data) return defaultResult;
  // ... process data
}

// Hoist invariants outside loops
const config = loadConfig();
for (const item of items) {
  // Use cached config
}
```

### Event Handling

```typescript
// Debounce expensive handlers
const handleResize = debounce(() => {
  recalculateLayout();
}, 100);

// Throttle continuous events
const handleScroll = throttle(() => {
  updateScrollPosition();
}, 16); // ~60fps
```

### Async Operations

```typescript
// Parallel independent operations
const [users, settings] = await Promise.all([
  fetchUsers(),
  fetchSettings(),
]);
```

## CSS

### Selector Performance

- Use simple, flat selectors
- Avoid deep nesting and universal selectors
- Prefer class selectors over element or attribute selectors

### Layout Thrashing

- Batch DOM reads and writes
- Use `transform` and `opacity` for animations (GPU-accelerated)
- Avoid layout-triggering properties (left, top, width, height) in animations

## Python

### Data Structures

```python
# Use sets for membership testing (O(1) vs O(n))
valid_ids = set(get_valid_ids())
if user_id in valid_ids:
    ...
```

### Generator Expressions

```python
# Generator for large datasets (lazy evaluation)
total = sum(item.value for item in large_dataset)

# Avoid list comprehension when only iterating
# total = sum([item.value for item in large_dataset])  # unnecessary list
```

## Checklist

- [ ] No unnecessary loops or repeated calculations
- [ ] Expensive operations cached appropriately
- [ ] Async operations parallelized when independent
- [ ] Event handlers debounced/throttled as needed
- [ ] CSS animations use transform/opacity
- [ ] Appropriate data structures for access patterns
