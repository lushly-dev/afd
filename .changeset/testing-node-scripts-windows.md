---
'@lushly-dev/afd-testing': patch
---

On Windows, `CliWrapper` runs a `cliPath` ending in `.js`, `.mjs` or `.cjs` with the current Node binary, with the script as its first argument. Windows ignores a script's shebang, so it used to reach cmd.exe, which opened it with the `.mjs` file association and returned no output. No shell is involved. Other CLI paths, and every other platform, start as before.
