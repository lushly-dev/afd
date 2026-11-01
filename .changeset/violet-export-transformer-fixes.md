---
'@lushly-dev/violet-core': patch
---

Export transformers emit valid platform source. Kotlin and Dart turn eight-digit CSS hex (`#RRGGBBAA`) into `Color(0xAARRGGBB)` instead of a ten-digit literal, so `#FFD70080` becomes `Color(0x80FFD700)`. The Swift `Color(hex:)` extension reads eight digits in CSS `RRGGBBAA` order instead of ARGB. Swift, Kotlin and Dart escape quotes, backslashes and control characters in string literals, and Kotlin and Dart also escape `$`, so a font stack such as `"Segoe UI", sans-serif` or a value containing `'` compiles. TypeScript `exportStyle: 'flat'` now emits only the named constants with the default `exportType`, and the `transformMulti` index declares one `tokens` object merging every category, so output with several categories no longer fails with TS2308. Tailwind merges the `radius` and `borderRadius` categories into one `borderRadius` scale instead of letting one replace the other.
