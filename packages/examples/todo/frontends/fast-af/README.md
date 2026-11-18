# The to-do page (FAST-AF)

The to-do example's page, on `@lushly-dev/fast-element` and `@lushly-dev/violet-elements`. It
renders the shared session (`../shared`) into light DOM; every action is a command on the
backend's `/mcp` endpoint.

```bash
pnpm dev            # http://localhost:5173, against http://localhost:3100
pnpm build          # dist/
pnpm test:browser   # the shared Chromium suite against a real TypeScript backend; build both first
```

`?backend=http://host:port` picks another backend. The page imports only the violet elements it
uses (`../shared/src/elements.ts`, imported as `@afd/example-todo-ui/elements`); add a module there before using another element, and brief on it with
the `umbel` server's `components-brief` (see the repository's `AGENTS.md`).

What it shows and why is in the [example README](../../README.md#frontend-features).
