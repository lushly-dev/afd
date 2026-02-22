# HTML/CSS Coding Standards

Detailed conventions for HTML and CSS.

## HTML

### Semantic Elements

Use semantic HTML5 elements:

```html
<!-- Semantic structure -->
<header>
  <nav aria-label="Main navigation">
    <ul>
      <li><a href="/">Home</a></li>
    </ul>
  </nav>
</header>

<main>
  <article>
    <h1>Article Title</h1>
    <section>
      <h2>Section Heading</h2>
      <p>Content...</p>
    </section>
  </article>
</main>

<footer>
  <p>Footer content</p>
</footer>
```

### Element Selection

| Purpose             | Element                     |
| ------------------- | --------------------------- |
| Page header         | `<header>`                  |
| Main content        | `<main>`                    |
| Navigation          | `<nav>`                     |
| Section             | `<section>`                 |
| Article/post        | `<article>`                 |
| Sidebar             | `<aside>`                   |
| Footer              | `<footer>`                  |
| Figure with caption | `<figure>` + `<figcaption>` |

### Accessibility Essentials

```html
<!-- Images: always include alt -->
<img src="chart.png" alt="Sales increased 25% from Q1 to Q2" />

<!-- Decorative images: empty alt -->
<img src="decoration.svg" alt="" />

<!-- Form labels -->
<label for="email">Email address</label>
<input type="email" id="email" name="email" required />

<!-- Buttons: clear text or aria-label -->
<button type="submit">Submit form</button>
<button aria-label="Close dialog">X</button>
```

## CSS

### BEM Methodology

Block, Element, Modifier naming:

```css
/* Block */
.card { }

/* Element (part of block) */
.card__header { }
.card__body { }
.card__footer { }

/* Modifier (variant) */
.card--featured { }
.card--compact { }
.card__header--highlighted { }
```

### Design Tokens

Use design tokens over hardcoded values:

```css
/* Use tokens */
.button {
  background-color: var(--color-primary);
  padding: var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
}
```

### Layout

- **Flexbox** for one-dimensional layouts
- **Grid** for two-dimensional layouts
- **No floats** for layout

```css
/* Flexbox for row/column alignment */
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* Grid for complex layouts */
.dashboard {
  display: grid;
  grid-template-columns: 250px 1fr;
  grid-template-rows: auto 1fr auto;
  gap: var(--spacing-lg);
}
```

### Responsive Design

- Mobile-first approach
- Use relative units (rem, em, %)
- Breakpoints via design system tokens when available

```css
.container {
  padding: var(--spacing-sm);
}

@media (min-width: 768px) {
  .container {
    padding: var(--spacing-lg);
  }
}
```

### Selector Performance

```css
/* Simple selectors (fast) */
.card-header { }

/* Avoid deep nesting (slow to match) */
/* .page .container .section .card .header .title { } */

/* Avoid universal selector with descendants */
/* .container * { } */
```

### Animations

```css
/* GPU-accelerated animation (preferred) */
.animated {
  transform: translateX(100px);
  transition: transform 0.3s ease;
}

/* Avoid layout-triggering properties in animations */
/* Do not animate left, top, width, height */
```

## Best Practices

1. **Validate HTML** for proper nesting and syntax
2. **Use CSS custom properties** (variables) for theming
3. **Minimize specificity** -- avoid ID selectors and `!important`
4. **Group related styles** logically
5. **Test with keyboard navigation** and screen readers
