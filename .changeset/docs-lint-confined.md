---
"lushly-botcore": patch
---

### Security

- **`docs_lint` stays inside the workspace.** A link whose target resolves outside the workspace, through `..`, a leading `/..` or a symlink, is reported as a `link-outside-workspace` warning and is neither read nor tested for existence, and a Markdown file reached through a symlink out of the workspace is not linted.
