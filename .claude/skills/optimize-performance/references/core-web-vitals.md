# Core Web Vitals

Google's key metrics for user experience.

## LCP - Largest Contentful Paint

**What**: Time until the largest visible element renders.
**Target**: < 2.5s
**Poor**: > 4.0s

### Common Causes of Poor LCP

- Slow server response (high TTFB)
- Render-blocking CSS or JavaScript
- Large unoptimized images or videos
- Client-side rendering delays (no SSR/SSG)

### Optimizations

```typescript
// Preload the LCP resource
<link rel="preload" href="hero.webp" as="image">

// Responsive images with fetchpriority
<img
  src="hero.webp"
  srcset="hero-400.webp 400w, hero-800.webp 800w"
  sizes="(max-width: 600px) 400px, 800px"
  fetchpriority="high"
>

// Inline critical CSS to avoid render-blocking stylesheet
<style>/* Critical above-fold CSS */</style>
```

### Server-Side Considerations

- Ensure TTFB < 600ms; use CDN for static assets.
- Enable HTTP/2 or HTTP/3 for multiplexed requests.
- Use `103 Early Hints` to preload resources before the HTML response completes.

---

## INP - Interaction to Next Paint

**What**: Responsiveness to user input (replaced FID in 2024).
**Target**: < 200ms
**Poor**: > 500ms

### Common Causes of Poor INP

- Long JavaScript tasks blocking the main thread
- Heavy event handlers with synchronous logic
- Forced synchronous layouts (layout thrashing)
- Excessive DOM size (> 1,500 nodes)

### Optimizations

```typescript
// Break up long tasks with requestIdleCallback
function processItems(items: Item[]) {
  const chunk = items.splice(0, 100);
  chunk.forEach(process);

  if (items.length > 0) {
    requestIdleCallback(() => processItems(items));
  }
}

// Yield to main thread when input is pending
async function yieldToMain() {
  if (navigator.scheduling?.isInputPending?.()) {
    await new Promise(r => setTimeout(r, 0));
  }
}

// Debounce frequent handlers
let timeout: number;
input.addEventListener('input', (e) => {
  clearTimeout(timeout);
  timeout = setTimeout(() => handleInput(e), 150);
});

// Use passive event listeners for scroll/touch
element.addEventListener('scroll', handler, { passive: true });
```

### Diagnostic Steps

1. Open DevTools Performance panel and record a user interaction.
2. Look for "Long Task" markers (> 50ms).
3. Identify the function/call stack responsible.
4. Break the task into smaller chunks or move to a web worker.

---

## CLS - Cumulative Layout Shift

**What**: Visual stability during page load and interaction.
**Target**: < 0.1
**Poor**: > 0.25

### Common Causes of Poor CLS

- Images or videos without explicit dimensions
- Dynamically injected content above existing content
- Web fonts causing FOIT/FOUT
- Ads or embeds without reserved space

### Optimizations

```html
<!-- Always set explicit dimensions -->
<img src="photo.jpg" width="800" height="600">

<!-- Reserve space for dynamic content -->
<div style="min-height: 250px">
  <!-- Ad or embed loads here -->
</div>

<!-- Preload fonts to reduce FOUT -->
<link rel="preload" href="font.woff2" as="font" type="font/woff2" crossorigin>
```

```css
/* Prevent font layout shift */
@font-face {
  font-family: 'MyFont';
  src: url('font.woff2') format('woff2');
  font-display: swap;
}

/* Use aspect-ratio for responsive media */
.media-container {
  aspect-ratio: 16 / 9;
  width: 100%;
}
```

### Diagnostic Steps

1. Run Lighthouse and check the CLS filmstrip for shift locations.
2. Use `Layout Shift Regions` in DevTools Rendering panel to visualize shifts.
3. Add explicit dimensions or min-height to shifting elements.

---

## TBT - Total Blocking Time

**What**: Lab metric measuring total time the main thread was blocked (tasks > 50ms).
**Target**: < 200ms
**Poor**: > 600ms

### Optimizations

- Code split large bundles so less JS executes on initial load.
- Defer non-critical scripts with `defer` or `async` attributes.
- Move heavy computation to web workers.
- Remove unused JavaScript with tree shaking.

---

## Measuring Core Web Vitals

### In the Field (Real User Monitoring)

```typescript
import { onLCP, onINP, onCLS } from 'web-vitals';

onLCP(metric => sendToAnalytics('LCP', metric));
onINP(metric => sendToAnalytics('INP', metric));
onCLS(metric => sendToAnalytics('CLS', metric));
```

### In the Lab

- **Lighthouse** -- Chrome DevTools > Lighthouse panel
- **PageSpeed Insights** -- https://pagespeed.web.dev/
- **WebPageTest** -- https://www.webpagetest.org/

### Chrome DevTools

- **Performance panel** -- Record and analyze runtime behavior
- **Network panel** -- Identify slow/large resources
- **Coverage tab** -- Find unused JS/CSS
