# Checklist

Loam's second document type, and its first view: a checklist is a list of items a person adds and
ticks off in the editor area, at workspace level or in a project. It has no rail entry, sidebar or
main: its documents open in the editor area, from New, the documents section, the command palette or
an agent's `document-open`. `checklist-get`, `checklist-item-add`, `checklist-item-toggle` and
`checklist-item-remove` are its instance commands, so the shell checks each checklist's scope and type
first, and each change has its undo. Every change is a command at once, so its editor holds no draft and
never reports unsaved work; a checklist works with its editor closed, from the palette or an agent. It
lands with no shell change: no file of the kernel, the chrome or the web host names it.

`src/editor.ts` compiles into `dist/editor.html`, the editor at `ui://checklist/editor`, and the same
handlers the test kit runs (`src/app.ts`) run in `dist/handlers.html`, a hidden frame. `pnpm build`
writes both; `loam app pack` packs them. A deployment names the package in an `[apps.<instance>]` entry
and serves `dist/sandbox/` on a second origin, `[sandbox] origin`.

Sandboxed: its grants are enforced. A view runs in an opaque-origin frame on the sandbox origin, and
reaches the shell only through the broker, at its document's scope.
