---
"afd-python": minor
---

### Breaking changes

- **`afd` now requires Python 3.11 or newer** (`requires-python >=3.11`). Python 3.10 reached end of life in October 2026. On 3.10, pip and uv keep resolving `afd` 0.12, the last release that supports it, and a pin to this release or later fails to install; move to 3.11 to upgrade. CI tests 3.11, 3.12, 3.13 and 3.14, and the classifiers list the same four ([#1805](https://github.com/lushly-dev/afd/issues/1805)).
