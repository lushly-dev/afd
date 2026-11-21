---
"lushly-botcore": patch
---

### Security

- **`docs_lint` stays inside the worktree.**
  - **Outside links:** a link whose target leaves the worktree, through `..`, a leading `/..` or a symlink, is reported as a `link-outside-workspace` warning instead of being read or tested for existence. The `..` check is lexical, so such a target is never looked up. A symlink inside the worktree is still resolved to find where it points.
  - **Symlinked files and start paths:** a Markdown file reached through a symlink out of the worktree is not linted. A starting directory outside the worktree is refused with `PATH_OUTSIDE_WORKSPACE`.
  - **Links between units:** still checked. The boundary is the worktree (the managed host's, or the nearest directory above the workspace that holds `.git`), not the selected unit.
