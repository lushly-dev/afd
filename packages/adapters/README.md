# @lushly-dev/afd-adapters

Frontend adapters for rendering AFD `CommandResult` data into styled HTML.

## Installation

```bash
pnpm add @lushly-dev/afd-adapters
```

## Usage

```typescript
import { WebAdapter } from '@lushly-dev/afd-adapters';

// Render package results from lint/test/build commands
const result = await fetch('/api/execute', { command: 'lint' });
const html = WebAdapter.renderPackageResults(result.data);
container.innerHTML = html;
```

## CSS Variables

The adapters use CSS custom properties for theming. Include the default theme or define your own:

```css
/* Option 1: Use the default theme */
@import '@lushly-dev/afd-adapters/css';

/* Option 2: Define your own */
:root {
  --afd-success: #22c55e;
  --afd-error: #ef4444;
  --afd-warning: #f59e0b;
  --afd-info: #3b82f6;
  --afd-muted: #6b7280;
}
```

### Violet Integration

Map AFD variables to Violet design tokens:

```css
:root {
  --afd-success: var(--violet-color-semantic-success);
  --afd-error: var(--violet-color-semantic-error);
  --afd-warning: var(--violet-color-semantic-warning);
  --afd-info: var(--violet-color-semantic-info);
  --afd-muted: var(--violet-color-text-muted);
}
```

## API

### WebAdapter

| Method | Description |
|--------|-------------|
| `renderPackageResults(data, options?)` | Render lint/test/build results |
| `renderError(message)` | Render error message |
| `renderSuccess(message)` | Render success message |
| `renderWarning(message)` | Render warning message |
| `renderResult(result)` | Auto-detect and render CommandResult |

### Options

```typescript
interface RenderOptions {
  showFailureOutput?: boolean;  // Show stderr for failed packages (default: true)
  maxOutputLength?: number;     // Truncate long output
}
```

## License

MIT
