---
"lushly-botcore": patch
---

### Security

- **Concurrent `CommandHost.execute` calls sharing one context keep a secret call's clock and random reads off a recorded call's tape** with an afd release after 0.14.0. Botcore 0.11.0's isolation assumed one call at a time on a context; the host docs now say which afd releases that applies to (#2703).
