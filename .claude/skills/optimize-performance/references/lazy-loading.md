# Lazy Loading Patterns

Defer loading of non-critical resources to improve initial load performance.

## Image Lazy Loading

### Native Browser Lazy Loading

```html
<!-- Simple lazy loading -->
<img loading="lazy" src="photo.jpg" alt="Description">

<!-- Responsive lazy loading -->
<img
  loading="lazy"
  src="photo-800.jpg"
  srcset="photo-400.jpg 400w, photo-800.jpg 800w"
  sizes="(max-width: 600px) 400px, 800px"
>
```

**Important**: Do NOT lazy-load above-the-fold images (hero images, LCP candidates). Use `fetchpriority="high"` on those instead.

### Intersection Observer (Custom Control)

```typescript
class LazyImage extends FASTElement {
  @attr src = '';
  private observer?: IntersectionObserver;

  connectedCallback() {
    super.connectedCallback();

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.loadImage();
          this.observer?.disconnect();
        }
      });
    }, { rootMargin: '100px' }); // Start loading 100px before visible

    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    super.disconnectedCallback();
  }

  loadImage() {
    const img = this.shadowRoot?.querySelector('img');
    if (img) {
      img.src = this.src;
    }
  }
}
```

---

## Route-Based Lazy Loading

```typescript
const routes: Record<string, () => Promise<any>> = {
  '/': () => import('./pages/home'),
  '/dashboard': () => import('./pages/dashboard'),
  '/settings': () => import('./pages/settings'),
};

async function navigate(path: string) {
  const module = await routes[path]?.();
  if (module) {
    renderPage(module.default);
  }
}
```

---

## Component Lazy Loading

```typescript
// Load heavy component only on user interaction
class DataViewer extends FASTElement {
  private chartLoaded = false;

  async showChart() {
    if (!this.chartLoaded) {
      const { Chart } = await import('./chart');
      this.chartLoaded = true;
      this.renderChart(Chart);
    }
  }
}
```

### When to Lazy-Load Components

- Charts, data visualizations, and editors not visible on initial render.
- Modals and dialogs that open on user action.
- Below-the-fold sections that are not part of the critical path.

---

## Prefetching and Preloading

### Link-Based Hints

```html
<!-- Prefetch: load in idle time for likely next navigation -->
<link rel="prefetch" href="/dashboard.js">

<!-- Preload: load now, needed for current page -->
<link rel="preload" href="hero.webp" as="image">

<!-- Preconnect: establish connection to API early -->
<link rel="preconnect" href="https://api.example.com">

<!-- DNS-Prefetch: resolve DNS for third-party domains -->
<link rel="dns-prefetch" href="https://analytics.example.com">
```

### Programmatic Prefetch on Hover

```typescript
link.addEventListener('mouseenter', () => {
  const prefetch = document.createElement('link');
  prefetch.rel = 'prefetch';
  prefetch.href = link.href;
  document.head.appendChild(prefetch);
});
```

### Guidelines

- **Preload** resources needed for the current page (fonts, hero image, critical scripts).
- **Prefetch** resources needed for the next likely navigation.
- **Preconnect** to origins you will fetch from (APIs, CDNs).
- Do not over-prefetch; it wastes bandwidth on mobile connections.

---

## Skeleton Screens

Provide visual placeholders while content loads to improve perceived performance.

```typescript
class UserCard extends FASTElement {
  @observable loading = true;
  @observable user?: User;

  async connectedCallback() {
    super.connectedCallback();
    this.user = await fetchUser();
    this.loading = false;
  }
}

// Template
html`
  ${when(x => x.loading, html`
    <div class="skeleton">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-text"></div>
    </div>
  `)}

  ${when(x => !x.loading, html`
    <img src="${x => x.user?.avatar}">
    <span>${x => x.user?.name}</span>
  `)}
`
```

### Skeleton Best Practices

- Match the skeleton layout to the final content layout to prevent CLS.
- Use CSS animations (shimmer effect) to indicate loading is active.
- Remove skeletons as soon as content is ready; avoid artificial delays.
