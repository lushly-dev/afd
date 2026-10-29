# FAST HTML to declarative HTML migration rules

This folder contains `.yml` rules for converting common FAST tagged-template
patterns to FAST Element v3 declarative HTML using
[ast-grep](https://ast-grep.github.io/).

Run the rules from the FAST Element package root with:

```bash
pnpm exec sg scan --config migration/fast-html/sgconfig.yml path/to/source
```

The generated markup is a migration aid, not a semantic guarantee. Move the
resulting template into an `.html` file, use `$e` and `$c` for event/context
arguments, and verify it with the declarative Playwright suite.
