# The to-do page (React)

The to-do example's page in React 19, on `@lushly-dev/violet-elements`. It renders the shared
session (`../shared`) with the same structure and class names as the FAST-AF page
(`../fast-af`), so the two share the styles, the elements and the browser suite and differ only
in how they render; every action is a command on the backend's `/mcp` endpoint.

```bash
pnpm dev            # http://localhost:5174, against http://localhost:3100
pnpm build          # dist/
pnpm test:browser   # Chromium against a real TypeScript backend; build both first
```

React 19 renders the violet elements directly: a prop becomes a property when the element has
one (`value`, `checked`, `open`), and the elements' own events (`change`, `approve`, `dismiss`)
are wired through `useElementEvents` (`src/hooks.ts`), a ref callback that listens while the
element is mounted. `src/violet.d.ts` types the tags for JSX.

What it shows and why is in the [example README](../../README.md#frontend-features).
