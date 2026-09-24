---
'@lushly-dev/afd-server': patch
---

`GET /stream/:name?input=...` now applies `maxBodyBytes` to its query input, as `POST /stream` does to the body. `maxBodyBytes` used to cover POST bodies only, so a host that raised Node's header size limit (or set a small `maxBodyBytes`) accepted query input of any size up to the header limit. Input whose UTF-8 size exceeds `maxBodyBytes` is refused with HTTP 413 (`HTTP_413`) before the command runs.
