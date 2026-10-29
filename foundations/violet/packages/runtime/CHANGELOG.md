# @lushly-dev/violet-runtime

## 0.2.0

### Minor Changes

- [#106](https://github.com/lushly-dev/violet/pull/106) [`6c6cf14`](https://github.com/lushly-dev/violet/commit/6c6cf1420247f0b058535bfb4bae745a0050ef27) Thanks [@Falkicon](https://github.com/Falkicon)! - `VioletRuntime` no longer defaults `apiUrl` to the `api.violet.design` placeholder, which is not a Violet deployment. Passing `apiKey` without `apiUrl` now throws, so a key is only ever sent to a URL you chose. Without a key, `apiUrl` defaults to the page's own origin.

### Patch Changes

- [#64](https://github.com/lushly-dev/violet/pull/64) [`ee58bfa`](https://github.com/lushly-dev/violet/commit/ee58bfa5d22dac99ed8f7f2284d81f81a840ca02) Thanks [@Falkicon](https://github.com/Falkicon)! - Relicense under MIT and publish publicly to npm. Each package now ships a README and full npm metadata (repository, homepage, bugs, keywords, engines).
