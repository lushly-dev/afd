# Bundle Optimization

Strategies for reducing JavaScript and CSS bundle size.

## Analysis Tools

```bash
# Analyze bundle composition (project-specific)
web-dev build --analyze --agent

# Visualize bundle with source-map-explorer
npx source-map-explorer dist/assets/*.js

# Check bundle impact of a package before adding it
npx bundlephobia <package-name>

# Check output sizes
ls -la dist/assets/*.js
```

---

## Code Splitting

### Route-Based Splitting

```typescript
// Each route loads only when navigated to
const routes = {
  '/dashboard': () => import('./pages/dashboard'),
  '/settings': () => import('./pages/settings'),
};

async function loadRoute(path: string) {
  const module = await routes[path]();
  return module.default;
}
```

### Component-Level Splitting

```typescript
// Load heavy component on demand
class MyPage extends FASTElement {
  async loadChart() {
    const { ChartComponent } = await import('./chart-component');
    // Render chart only when needed
  }
}
```

### Guidelines

- Split at route boundaries first -- biggest impact with least effort.
- Split heavy components that are not visible on initial load.
- Avoid splitting very small modules (< 5KB); the overhead of an extra request may negate savings.

---

## Tree Shaking

```typescript
// BAD: Imports entire library (no tree shaking)
import _ from 'lodash';

// GOOD: Import specific function from subpath
import debounce from 'lodash/debounce';

// BEST: Use ESM build that supports tree shaking natively
import { debounce } from 'lodash-es';
```

### Requirements for Tree Shaking

- Package must use ES module syntax (`import`/`export`), not CommonJS (`require`).
- `sideEffects: false` in package.json helps bundlers eliminate unused exports.
- Avoid re-exporting everything through barrel files (`index.ts`) unless the bundler handles it.

---

## Common Large Dependencies

| Library | Typical Size | Lighter Alternative |
|---------|-------------|---------------------|
| moment.js | ~300KB | date-fns (~30KB) or dayjs (~6KB) |
| lodash (full) | ~70KB | lodash-es with tree shaking |
| rxjs (full) | ~50KB | Import operators individually |
| chart.js | ~200KB | Lazy load; do not include in entry chunk |

---

## Minification

Vite handles minification automatically in production builds:

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    minify: 'esbuild', // fast default; use 'terser' for more aggressive minification
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['@microsoft/fast-element'],
        },
      },
    },
  },
});
```

### Manual Chunks Strategy

- Group framework/vendor code into a `vendor` chunk -- changes infrequently, caches well.
- Group shared utilities into a `common` chunk.
- Let route/feature code remain in separate lazy chunks.

---

## Compression

```typescript
// vite.config.ts
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    viteCompression({ algorithm: 'gzip' }),
    viteCompression({ algorithm: 'brotliCompress', ext: '.br' }),
  ],
});
```

- Brotli typically achieves 15-20% better compression than gzip.
- Ensure the server/CDN serves `.br` files when the client supports `Accept-Encoding: br`.

---

## Bundle Size Budgets

| Asset | Good | Warning | Fail |
|-------|------|---------|------|
| Entry chunk (gzip) | < 100KB | 100-150KB | > 200KB |
| Total JS (gzip) | < 350KB | 350-450KB | > 500KB |
| Per lazy chunk | < 50KB | 50-75KB | > 100KB |

### Enforcing Budgets in CI

```typescript
// vite.config.ts -- warn on large chunks
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 150, // KB (uncompressed)
  },
});
```

- Use `bundlesize` or `size-limit` packages for CI enforcement.
- Fail the build if any budget is exceeded to prevent regressions.
