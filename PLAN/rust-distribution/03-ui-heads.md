# Part 3: Multi-Head UI Architecture

> **Goal**: Enable AFD apps to have multiple, context-optimized UI "heads" that all consume the same commands. Each distribution target can use the UI head best suited for its platform and interaction mode.

## The Core Insight

AFD's "commands are the app" philosophy means **UI is just a head** - an interchangeable presentation layer. Different contexts need different UIs:

```
                              AFD Commands
                                   │
                                   │ (same commands)
                                   │
    ┌──────────┬──────────┬───────┼───────┬──────────┐
    │          │          │       │       │          │
    ▼          ▼          ▼       ▼       ▼          ▼
┌──────┐  ┌──────┐  ┌──────┐ ┌──────┐ ┌──────┐  ┌ ─ ─ ─ ─ ─ ─ ┐
│ CLI  │  │ Web  │  │Desktop│ │Mobile│ │Agent │   Voice/Watch  
│ Head │  │ Head │  │ Head  │ │ Head │ │ Head │  │  (Future)   │
└──────┘  └──────┘  └──────┘ └──────┘ └──────┘  └ ─ ─ ─ ─ ─ ─ ┘
   │          │         │        │        │             │
   ▼          ▼         ▼        ▼        ▼             ▼
Terminal  Browser   Desktop   Mobile  AI Agent    See Part 6
  UI       SPA       App       App     (MCP)
```

> **Note**: Voice and Watch heads are deferred to [Part 6: Future Phases](./06-future-phases.md). The architecture supports them when ready.

## UI Head Types

### 1. CLI Head (Text Interface)

The original AFD surface. Commands are invoked via terminal.

```
┌─────────────────────────────────────────────────────────┐
│ Terminal                                                │
├─────────────────────────────────────────────────────────┤
│ $ my-app items list                                     │
│                                                         │
│ ID         NAME           STATUS      CREATED           │
│ ─────────────────────────────────────────────────────── │
│ item_001   First Item     active      2025-01-01        │
│ item_002   Second Item    pending     2025-01-01        │
│                                                         │
│ $ my-app items create --name "New Item"                 │
│ ✓ Created item_003                                      │
└─────────────────────────────────────────────────────────┘

Interaction: Keyboard only
Commands: Direct invocation via args
Output: Structured text, tables, JSON
```

### 2. Web Head (Browser SPA)

Responsive web application for browsers.

```
┌─────────────────────────────────────────────────────────┐
│ 🌐 My App                                    [User] [⚙] │
├─────────────────────────────────────────────────────────┤
│ ┌───────────┐  ┌─────────────────────────────────────┐  │
│ │ Sidebar   │  │  Items                    [+ New]   │  │
│ │           │  │  ┌───────────────────────────────┐  │  │
│ │ • Items   │  │  │ First Item        ● Active    │  │  │
│ │ • Reports │  │  │ Created Jan 1, 2025           │  │  │
│ │ • Settings│  │  └───────────────────────────────┘  │  │
│ │           │  │  ┌───────────────────────────────┐  │  │
│ │           │  │  │ Second Item       ○ Pending   │  │  │
│ │           │  │  │ Created Jan 1, 2025           │  │  │
│ └───────────┘  │  └───────────────────────────────┘  │  │
└─────────────────────────────────────────────────────────┘

Interaction: Mouse, keyboard, touch
Commands: API calls via fetch()
Output: Rich visual UI, animations
```

### 3. Desktop Head (Native Window)

Tauri-wrapped web UI with native OS integration.

```
┌─────────────────────────────────────────────────────────┐
│ ● ○ ○  My App                               ─ □ ✕      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [Same as Web Head, but with:]                          │
│                                                         │
│  • Native window controls                               │
│  • System tray icon                                     │
│  • Global keyboard shortcuts (Cmd+Shift+N)              │
│  • Native file dialogs                                  │
│  • OS notifications                                     │
│  • Multi-window support                                 │
│  • Menubar integration                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘

Interaction: Mouse, keyboard, trackpad
Commands: Tauri IPC to Rust backend
Output: Web UI + native chrome
```

### 4. Mobile Head (Touch-First)

Touch-optimized UI for phones and tablets.

```
┌───────────────────────┐
│ ≡  My App         ⋮   │
├───────────────────────┤
│                       │
│ ┌───────────────────┐ │
│ │ 📦 First Item     │ │
│ │    ● Active       │ │
│ │    Jan 1, 2025    │ │
│ └───────────────────┘ │
│                       │
│ ┌───────────────────┐ │
│ │ 📦 Second Item    │ │
│ │    ○ Pending      │ │
│ │    Jan 1, 2025    │ │
│ └───────────────────┘ │
│                       │
│         ...           │
│                       │
├───────────────────────┤
│ [🏠] [📋] [➕] [👤]   │
└───────────────────────┘

Interaction: Touch, gestures, swipe
Commands: Native bridge or API
Output: Large touch targets, bottom nav
```

### 5. Agent Head (MCP/API)

No visual UI - designed for AI agents to consume programmatically.

```json
// MCP Tool Call
{
  "method": "tools/call",
  "params": {
    "name": "items.list",
    "arguments": { "status": "active" }
  }
}

// CommandResult (Agent-optimized)
{
  "success": true,
  "data": {
    "items": [...],
    "total": 2
  },
  "reasoning": "Filtered to active items as requested",
  "suggestions": [
    "items.create to add new item",
    "items.update to change status"
  ]
}
```

## Architecture: Head Registry

Mint manages heads through a registry:

```rust
// src/heads/mod.rs

/// A UI Head is a presentation layer that consumes commands.
pub trait UiHead: Send + Sync {
    /// Unique identifier for this head
    fn id(&self) -> &str;
    
    /// Human-readable name
    fn name(&self) -> &str;
    
    /// Supported platforms
    fn platforms(&self) -> Vec<Platform>;
    
    /// Build the head for distribution
    async fn build(&self, ctx: &BuildContext) -> Result<Vec<Artifact>, BuildError>;
    
    /// Start development server for this head
    async fn dev(&self, ctx: &DevContext) -> Result<(), DevError>;
}

pub enum Platform {
    Web,
    Windows,
    MacOS,
    Linux,
    IOS,
    Android,
    WatchOS,
    Alexa,
    GoogleAssistant,
}
```

## Head Configuration

```toml
# mint.toml

[project]
name = "my-app"
version = "0.1.0"

# Enable specific heads
[heads]
cli = true
web = true
desktop = true
mobile = true
# voice = true    # Future - see Part 6

# CLI Head configuration
[heads.cli]
shell_completions = ["bash", "zsh", "fish", "powershell"]
man_pages = true

# Web Head configuration
[heads.web]
framework = "vanilla"  # or "react", "vue", "solid"
ssr = false
pwa = true

# Desktop Head configuration
[heads.desktop]
share_web_head = true  # Use web head in Tauri
system_tray = true
auto_update = true

# Mobile Head configuration
[heads.mobile]
share_web_head = true  # Use web head in Tauri mobile
# OR
native_ui = "flutter"  # Use Flutter for native feel
```

## Shared Components (Design System)

To maximize code reuse across visual heads, use a shared component library:

```
heads/
├── shared/                    # Shared across heads
│   ├── tokens/               # Violet design tokens
│   │   ├── colors.css
│   │   ├── typography.css
│   │   └── spacing.css
│   ├── components/           # Platform-agnostic components
│   │   ├── Button.ts
│   │   ├── Card.ts
│   │   ├── Input.ts
│   │   └── List.ts
│   └── hooks/                # Shared logic
│       ├── useCommand.ts     # Execute AFD command
│       └── useSubscribe.ts   # Real-time updates
│
├── web/                       # Web-specific
│   ├── layouts/
│   │   ├── SidebarLayout.ts
│   │   └── DashboardLayout.ts
│   └── index.html
│
├── mobile/                    # Mobile-specific
│   ├── layouts/
│   │   ├── TabLayout.ts
│   │   └── StackLayout.ts
│   └── gestures/
│       ├── SwipeActions.ts
│       └── PullRefresh.ts
│
└── desktop/                   # Desktop-specific
    ├── native/
    │   ├── SystemTray.rs
    │   ├── GlobalShortcuts.rs
    │   └── NativeMenus.rs
    └── window/
        └── MultiWindow.ts
```

## Head Selection Matrix

| Head | Use When | Interaction | Strengths |
|------|----------|-------------|-----------|
| **CLI** | Power users, automation, scripts | Keyboard | Fast, scriptable, no UI overhead |
| **Web** | Broad access, no install | Mouse/Touch | Universal, always up-to-date |
| **Desktop** | Heavy users, offline, OS integration | Mouse/Keyboard | Native feel, system access |
| **Mobile** | On-the-go, quick actions | Touch/Gesture | Always available, notifications |
| **Agent** | AI integration, automation | MCP/API | Programmable, composable |

> **Future Heads**: Voice and Watch heads are designed but deferred. See [Part 6](./06-future-phases.md).

---

## Accessibility (a11y)

All visual UI heads must meet accessibility standards. This is not optional—it's required for many enterprise customers and is the right thing to do.

### Standards

| Standard | Requirement |
|----------|-------------|
| WCAG 2.1 AA | Minimum compliance for all heads |
| WCAG 2.1 AAA | Target for key workflows |
| Section 508 | Required for US government |
| ARIA 1.2 | Semantic markup standard |

### Per-Head Requirements

#### CLI Head
```bash
# Already accessible by nature, but ensure:
# 1. Clear, parseable output (--json flag)
# 2. Meaningful exit codes
# 3. Screen reader friendly text (no emoji-only output)
# 4. Support for NO_COLOR environment variable

my-app items list --json          # Machine-readable
my-app items list --no-color      # Remove ANSI codes
echo $?                            # Meaningful exit code
```

#### Web Head
```html
<!-- Required ARIA attributes -->
<button 
  aria-label="Create new item"
  aria-describedby="create-help"
  tabindex="0"
>
  <svg aria-hidden="true">...</svg>
  <span>New Item</span>
</button>

<!-- Skip navigation link -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<!-- Semantic structure -->
<main id="main-content" role="main">
  <h1>Items</h1>
  <nav aria-label="Item filters">...</nav>
  <ul role="list" aria-label="Item list">
    <li role="listitem">...</li>
  </ul>
</main>

<!-- Live regions for dynamic updates -->
<div 
  role="status" 
  aria-live="polite" 
  aria-atomic="true"
  class="sr-only"
>
  Item created successfully
</div>
```

**Keyboard Navigation:**
```css
/* Visible focus indicators */
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Don't remove focus for mouse users who also use keyboard */
:focus:not(:focus-visible) {
  outline: 2px solid var(--color-focus-subtle);
}
```

**Color Contrast:**
```css
/* Minimum 4.5:1 for normal text, 3:1 for large text */
:root {
  --color-text-primary: #1a1a1a;      /* On white: 12.6:1 ✓ */
  --color-text-secondary: #595959;    /* On white: 7.0:1 ✓ */
  --color-text-on-primary: #ffffff;   /* On blue: 4.5:1 ✓ */
}
```

#### Mobile Head
```typescript
// Touch targets: minimum 44x44 points (iOS) / 48x48 dp (Android)
const Button = styled.TouchableOpacity`
  min-width: 48px;
  min-height: 48px;
  padding: 12px;
`;

// Accessibility labels
<TouchableOpacity
  accessibilityLabel="Create new item"
  accessibilityHint="Opens the item creation form"
  accessibilityRole="button"
>
  <Icon name="plus" />
</TouchableOpacity>

// Announce changes
AccessibilityInfo.announceForAccessibility('Item created');
```

#### Desktop Head
```rust
// Native accessibility APIs via Tauri
#[tauri::command]
async fn announce(message: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // NSAccessibility announcement
    }
    #[cfg(target_os = "windows")]
    {
        // UI Automation notification
    }
    Ok(())
}
```

### Accessibility Testing

```yaml
# .github/workflows/a11y.yml
name: Accessibility Tests

jobs:
  web-a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm build
      
      # Automated WCAG checks
      - name: axe-core scan
        run: npx @axe-core/cli http://localhost:3000 --tags wcag2aa
      
      # Lighthouse accessibility audit
      - name: Lighthouse
        uses: treosh/lighthouse-ci-action@v10
        with:
          configPath: .lighthouserc.json
          
  keyboard-nav:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install && pnpm build
      - name: Keyboard navigation test
        run: npx playwright test tests/a11y/keyboard.spec.ts
```

### Accessibility Configuration

```toml
# mint.toml
[accessibility]
# Minimum WCAG level (aa or aaa)
wcag_level = "aa"

# Fail build if a11y tests fail
strict = true

# Generate accessibility report
report = true

# Test with these screen readers (CI)
screen_readers = ["voiceover", "nvda"]
```

---

## Internationalization (i18n)

All UI heads should support multiple languages and locales.

### Supported Locales

Mint generates support for common locales by default:

| Locale | Language | Region |
|--------|----------|--------|
| `en-US` | English | United States (default) |
| `en-GB` | English | United Kingdom |
| `es-ES` | Spanish | Spain |
| `es-MX` | Spanish | Mexico |
| `fr-FR` | French | France |
| `de-DE` | German | Germany |
| `ja-JP` | Japanese | Japan |
| `zh-CN` | Chinese | China (Simplified) |
| `zh-TW` | Chinese | Taiwan (Traditional) |
| `pt-BR` | Portuguese | Brazil |
| `ar-SA` | Arabic | Saudi Arabia (RTL) |
| `he-IL` | Hebrew | Israel (RTL) |

### Message Format

Use ICU Message Format for pluralization and formatting:

```json
// locales/en-US.json
{
  "items.count": "{count, plural, =0 {No items} one {1 item} other {{count} items}}",
  "items.created": "Item \"{name}\" created successfully",
  "items.deleted": "{count, plural, one {Item deleted} other {{count} items deleted}}",
  "date.relative": "{date, relative}",
  "currency.amount": "{amount, number, ::currency/USD}"
}

// locales/ja-JP.json
{
  "items.count": "{count}個のアイテム",
  "items.created": "アイテム「{name}」を作成しました",
  "items.deleted": "{count}個のアイテムを削除しました"
}
```

### Per-Head Implementation

#### CLI Head
```bash
# Respect system locale
$ LANG=ja_JP.UTF-8 my-app items list
# Output in Japanese

# Override with flag
$ my-app items list --locale es-MX
# Output in Spanish (Mexico)

# In code
use sys_locale::get_locale;
let locale = get_locale().unwrap_or_else(|| "en-US".to_string());
```

#### Web Head
```typescript
// hooks/useI18n.ts
import { useContext } from 'react';
import { I18nContext } from './context';

export function useI18n() {
  const { locale, messages, setLocale } = useContext(I18nContext);
  
  function t(key: string, params?: Record<string, unknown>): string {
    const message = messages[key] || key;
    return formatMessage(message, params, locale);
  }
  
  return { t, locale, setLocale };
}

// Usage in component
function ItemList({ items }) {
  const { t } = useI18n();
  
  return (
    <div>
      <h1>{t('items.count', { count: items.length })}</h1>
      {items.map(item => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
```

#### Mobile Head
```typescript
// Use react-native-localize for native integration
import * as RNLocalize from 'react-native-localize';

const locales = RNLocalize.getLocales();
const currentLocale = locales[0]?.languageTag || 'en-US';

// For date/number formatting, use native APIs
import { NativeModules } from 'react-native';
const { I18nManager } = NativeModules;

// RTL support
if (isRTL(currentLocale)) {
  I18nManager.forceRTL(true);
}
```

### RTL Support

For Arabic, Hebrew, and other RTL languages:

```css
/* Automatically flip layout for RTL */
[dir="rtl"] {
  /* Logical properties handle this automatically */
}

/* Use logical properties everywhere */
.card {
  margin-inline-start: var(--spacing-md);  /* Not margin-left */
  padding-inline-end: var(--spacing-sm);   /* Not padding-right */
  border-inline-start: 2px solid blue;     /* Not border-left */
}

/* Flip icons that have directional meaning */
[dir="rtl"] .icon-arrow-right {
  transform: scaleX(-1);
}
```

### i18n Configuration

```toml
# mint.toml
[i18n]
# Default locale
default = "en-US"

# Supported locales
locales = ["en-US", "es-ES", "ja-JP", "ar-SA"]

# Locale file location
messages_dir = "./locales"

# Fallback chain
fallback = ["en-US"]

# Extract strings from code
extract = true

# Fail build if translations missing
strict = false  # Set to true for production
```

### Translation Workflow

```bash
# Extract translatable strings from code
mint i18n extract

# Check for missing translations
mint i18n check

# Generate placeholder translations (for dev)
mint i18n generate --locale ja-JP

# Validate translation files
mint i18n validate
```

---

## Implementation Phases

### Phase 3.1: Head Registry (Day 1)
- [ ] Define `UiHead` trait
- [ ] Head registration system
- [ ] Platform detection

### Phase 3.2: Shared Components (Days 2-3)
- [ ] Design token pipeline (Violet → CSS/TS/Swift)
- [ ] Core component library
- [ ] `useCommand` hook for all heads

### Phase 3.3: Web Head (Day 4)
- [ ] Vanilla JS/Web Components template
- [ ] Optional React/Vue/Solid templates
- [ ] PWA configuration

### Phase 3.4: Desktop Head (Day 5)
- [ ] Tauri integration with web head
- [ ] Native features (tray, shortcuts, menus)
- [ ] Multi-window support

### Phase 3.5: Mobile Head (Days 6-7)
- [ ] Tauri mobile with shared web head
- [ ] Touch-optimized layouts
- [ ] Native features (haptics, share)

> **Future Phases**: Voice and Watch heads are deferred. See [Part 6](./06-future-phases.md).

## Success Criteria

1. **Same Commands**: All heads invoke identical AFD commands
2. **Appropriate UX**: Each head is optimized for its context
3. **Shared Tokens**: Violet design tokens work across all visual heads
4. **Easy Selection**: `mint build --heads web,mobile` builds only selected heads
