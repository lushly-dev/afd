---
name: optimize-performance
source: botcore
description: >
  Guides bundle size reduction, Core Web Vitals improvement, and runtime performance optimization for web applications. Covers LCP, INP, CLS metrics, code splitting, lazy loading, tree shaking, compression, and long-task mitigation strategies. Use when bundle size exceeds thresholds, Core Web Vitals scores degrade, users report slowness, or before major releases. Triggers: performance, bundle size, LCP, INP, CLS, Lighthouse, slow, optimize, lazy loading, code splitting, web vitals.

version: 1.0.0
triggers:
  - performance
  - bundle size
  - LCP
  - INP
  - CLS
  - Lighthouse
  - slow
  - optimize
  - lazy loading
  - code splitting
  - web vitals
portable: true
---

# Optimizing Performance

Best practices for web performance optimization covering bundle size, Core Web Vitals, and runtime efficiency.

## Capabilities

1. Measure and diagnose Core Web Vitals (LCP, INP, CLS) against Google-defined thresholds
2. Analyze and reduce JavaScript bundle size through code splitting, tree shaking, and compression
3. Implement lazy loading patterns for images, routes, and components
4. Identify and fix runtime bottlenecks such as long tasks and layout thrashing
5. Provide actionable checklists and anti-pattern guidance for performance audits
6. Set and enforce bundle size budgets with warning and failure thresholds

## Routing Logic

| Topic | Reference |
|-------|-----------|
| LCP, INP, CLS, TBT metrics and fixes | `{baseDir}/references/core-web-vitals.md` |
| Bundle analysis, code splitting, tree shaking, compression | `{baseDir}/references/bundle-optimization.md` |
| Image, route, and component lazy loading; prefetching; skeletons | `{baseDir}/references/lazy-loading.md` |

## Core Principles

- **Measure first** -- Never optimize without a baseline; use Lighthouse, Web Vitals library, or DevTools Performance panel.
- **Target the critical path** -- Focus on resources that block first render or first interaction.
- **Ship less JavaScript** -- Every kilobyte costs parse time, execution time, and memory; split, shake, and defer.
- **Prioritize user-perceived performance** -- Skeleton screens and progressive loading feel faster even when total load time is similar.
- **Avoid regressions** -- Enforce budgets in CI; a single large dependency can undo weeks of optimization.

## Workflow

1. **Measure** -- Capture baseline metrics (LCP, INP, CLS, bundle sizes).
2. **Analyze** -- Identify the largest contributors: source-map-explorer for bundles, DevTools Performance panel for runtime.
3. **Optimize** -- Apply targeted fixes from the relevant reference file.
4. **Verify** -- Re-measure to confirm improvement and catch regressions.
5. **Monitor** -- Set up CI budget checks and track metrics over time.

## Quick Reference

### Core Web Vitals Targets

| Metric | Good | Needs Work | Poor |
|--------|------|------------|------|
| LCP (Largest Contentful Paint) | < 2.5s | 2.5-4.0s | > 4.0s |
| INP (Interaction to Next Paint) | < 200ms | 200-500ms | > 500ms |
| CLS (Cumulative Layout Shift) | < 0.1 | 0.1-0.25 | > 0.25 |
| TBT (Total Blocking Time, lab) | < 200ms | 200-600ms | > 600ms |

### Bundle Size Budgets

| Asset | Good | Warning | Fail |
|-------|------|---------|------|
| Entry chunk (gzip) | < 100KB | 100-150KB | > 200KB |
| Total JS (gzip) | < 300KB | 300-400KB | > 500KB |
| Critical CSS | < 50KB | 50-75KB | > 100KB |
| Per lazy chunk | < 50KB | 50-75KB | > 100KB |

### Common Anti-Patterns

| Avoid | Instead |
|-------|---------|
| Importing entire libraries | Import specific functions or use tree-shakeable ESM builds |
| Synchronous heavy operations on main thread | Use web workers or break into yielding chunks |
| Layout thrashing (interleaved reads/writes) | Batch DOM reads then batch DOM writes |
| Images without width/height attributes | Always set explicit dimensions to prevent CLS |
| Unoptimized image formats | Use WebP/AVIF with responsive srcset |
| Render-blocking third-party scripts | Defer or async-load non-critical scripts |

### Key Optimization Patterns

```typescript
// Code splitting with dynamic imports
const HeavyComponent = await import('./HeavyComponent');

// Lazy loading images
<img loading="lazy" src="below-fold-image.jpg" />

// Breaking up long tasks for better INP
async function yieldToMain() {
  if (navigator.scheduling?.isInputPending?.()) {
    await new Promise(r => setTimeout(r, 0));
  }
}

// Preload critical assets
<link rel="preload" href="critical.css" as="style" />
<link rel="preload" href="hero.webp" as="image" fetchpriority="high" />

// Tree-shakeable imports
import { debounce } from 'lodash-es'; // NOT: import _ from 'lodash'
```

## Checklist

- [ ] Baseline metrics captured (LCP, INP, CLS, bundle sizes)
- [ ] Bundle under target size budgets
- [ ] Code splitting implemented for routes and heavy components
- [ ] Images optimized (WebP/AVIF format, responsive srcset, lazy loading)
- [ ] No render-blocking resources in critical path
- [ ] Critical CSS inlined above the fold
- [ ] Third-party scripts deferred or async
- [ ] Explicit width/height on all images and media (CLS prevention)
- [ ] Long tasks broken up with yielding (INP improvement)
- [ ] Fonts preloaded with font-display: swap
- [ ] Compression enabled (gzip + Brotli)
- [ ] CI budget checks configured for bundle size regressions
- [ ] Post-optimization metrics verified against baseline

## When to Escalate

- **Infrastructure-level TTFB issues** -- If server response time (TTFB) exceeds 600ms consistently, escalate to platform/infrastructure team; application-level optimization cannot fix slow origins or CDN misconfiguration.
- **Third-party script dominance** -- When third-party scripts (analytics, ads, chat widgets) account for the majority of bundle/execution time and cannot be deferred, escalate to product owner for prioritization decisions.
- **Framework-level rendering bottlenecks** -- If the rendering framework itself is the bottleneck (e.g., excessive re-renders, virtual DOM overhead), consider architectural changes that go beyond this skill's scope.
- **Memory leaks or crashes** -- Performance degradation caused by memory leaks requires dedicated profiling beyond Core Web Vitals; escalate to senior engineering.
