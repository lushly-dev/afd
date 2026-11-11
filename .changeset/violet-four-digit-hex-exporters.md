---
'@lushly-dev/violet-core': patch
---

The Kotlin, Dart and Swift exporters read four-digit CSS hex colours (`#RGBA`) with their alpha: `#F008` becomes `Color(0x88FF0000)` in Kotlin and Dart, and the generated Swift `Color(hex:)` extension reads four digits instead of falling back to opaque black. A four-digit hex value outside the `color` category is a colour too.
