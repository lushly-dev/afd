# Shadow DOM Queries

Patterns for querying inside web components' Shadow DOM with Playwright.

## The challenge

Web components use Shadow DOM for encapsulation. Standard CSS selectors cannot reach into shadow roots. Playwright provides several approaches to pierce these boundaries.

## Approach 1: Locator chaining (recommended)

Chain `.locator()` calls to pierce shadow boundaries. Playwright automatically pierces shadow roots when chaining locators.

```typescript
// Find a button inside a web component's shadow root
const button = page.locator("my-button").locator("button");

// Find text inside a component
const label = page.locator("my-nav").locator(".nav-label");

// Nested shadow DOM (component within component)
const innerButton = page
  .locator("my-app-shell")
  .locator("my-header")
  .locator("button");
```

## Approach 2: CSS `>>` deep combinator

Use `>>` to pierce a single shadow boundary:

```typescript
// Pierce into shadow root
const item = page.locator("my-nav >> .nav-item");

// Multiple levels
const text = page.locator("my-app-shell >> my-header >> .title");
```

## Approach 3: `page.evaluate()` for computed styles

When you need to check CSS custom property values or computed styles:

```typescript
// Read a design token value from the document root
const bgColor = await page.evaluate(() => {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--colorNeutralBackground1")
    .trim();
});

// Read computed style on a shadow DOM element
const navBg = await page.evaluate(() => {
  const nav = document.querySelector("my-nav");
  const inner = nav?.shadowRoot?.querySelector(".nav-container");
  return inner ? getComputedStyle(inner).backgroundColor : null;
});
```

## Approach 4: `evaluateHandle()` for complex queries

For traversing multiple shadow roots programmatically:

```typescript
const handle = await page.evaluateHandle(() => {
  const shell = document.querySelector("my-app-shell");
  const header = shell?.shadowRoot?.querySelector("my-header");
  return header?.shadowRoot?.querySelector(".product-name");
});

const text = await handle.evaluate((el) => el?.textContent);
expect(text).toBe("My Product");
```

## Waiting for custom elements

Custom elements upgrade asynchronously. Always wait for them:

```typescript
// Wait for element to exist in DOM
await page.waitForSelector("my-app-shell");

// Wait for shadow root to be available
await page.waitForFunction(() => {
  const el = document.querySelector("my-app-shell");
  return el?.shadowRoot !== null;
});
```

## Verifying attribute reflection

Many web component frameworks reflect properties to DOM attributes:

```typescript
// Check attribute is reflected
const card = page.locator("my-card");
await expect(card).toHaveAttribute("title", "Expected Title");

// Check observable state via evaluate
const isOpen = await page.evaluate(() => {
  const panel = document.querySelector("my-panel");
  return panel?.open;
});
```

## Tips

- Prefer locator chaining over `evaluate()` for most queries -- it is more readable and has built-in auto-waiting
- Use `evaluate()` when you need computed styles, CSS custom property values, or complex traversals
- Always wait for custom element registration before querying shadow roots
- When debugging, use `page.pause()` in headed mode to inspect the shadow DOM in DevTools
