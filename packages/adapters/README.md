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
| `renderError(message, options?)` | Render error message |
| `renderSuccess(message, options?)` | Render success message |
| `renderWarning(message, options?)` | Render warning message |
| `renderResult(result, options?)` | Auto-detect and render CommandResult |
| `renderCommandError(error, options?)` | Render a CommandError with its code, message, suggestion and details |
| `renderConfidence(confidence, reasoning?, options?)` | Render a confidence bar and its reasoning |
| `renderWarnings(warnings, options?)` | Render a list of warnings |
| `renderPipelineSteps(steps, options?)` | Render pipeline step progress |
| `renderCommandResult(result, options?)` | Render a full CommandResult with its metadata sections |

All text is escaped with `escapeHtml(value)`, also exported: it converts any value with
`String(value)` and escapes `&`, `<`, `>`, `"` and `'`, so the output is safe in element content
and in quoted attributes. Confidence values outside `[0, 1]` are clamped, and a non-finite one
renders as 0%.

### Options

```typescript
interface RenderOptions {
  showFailureOutput?: boolean;  // Show stderr for failed packages (default: true)
  maxOutputLength?: number;     // Truncate long output
  styling?: 'inline' | 'classes';  // How spans are styled (default: 'inline')
}
```

### Styling under a Content-Security-Policy

By default spans carry a `style` attribute, which a policy of `style-src 'self'` refuses. With
`styling: 'classes'` no output has a `style` attribute:

```typescript
const html = WebAdapter.renderCommandResult(result, { styling: 'classes' });
// <span class="afd-status-success afd-bold">Confidence: 90%</span>
```

Each span has one `afd-status-<type>` class, where `<type>` is `success`, `failure`, `warning`,
`info`, `muted` or `neutral`, and bold spans add `afd-bold`. `styledSpan(text, status, bold, styling)`
takes the same value, and an unknown status renders as `neutral`.

The default theme defines these classes, using the variables above. Defining only the variables
is not enough here: without the theme, define every class yourself, `afd-bold` included, or the
spans render unstyled. A document's stylesheet does not reach into a shadow root, so load the theme
there, or define the classes in the shadow root's own stylesheet.

## License

MIT
