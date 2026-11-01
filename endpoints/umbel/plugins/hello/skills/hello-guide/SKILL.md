---
name: hello-guide
description: When to call hello-greet, and how a space's greetings pack changes the salutation.
---

# Hello guide

Call `hello-greet` when someone asks for a greeting. Pass `name` to greet a person; leave it out
to greet the instance's `default_name`. Pass `space` to greet in a space: each space can override
the `greetings` pack, so the salutation can differ between spaces. See
[the override notes](references/override.md).

The result holds `greeting`, the `space` that was used and `at`, the time of the call.
