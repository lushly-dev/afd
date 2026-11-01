# Token-only lint corpus

One passing and one failing case per rule of the token-only lint
(`scripts/lint-tokens.mjs`, phase 0 specification section 2.7), run by
`src/lint-tokens.test.ts`. Each `fail` file holds violations of its directory's
rule only; each `pass` file holds none. `system-color` and `tagged-template`
cover the forced-colors exception and the `css` tagged templates of `.ts`
files. `shell-token` and `private-alias` pass as the chrome, with its state
properties; the other cases lint as a package other than the chrome.

The root Biome configuration skips this directory: the failing cases are
meant to fail.
