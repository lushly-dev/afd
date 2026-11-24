---
"lushly-botcore": minor
---

### Added

- **`create_host_http_app(..., upload_routes=...)` names the routes that take uploads.** A `POST /<route>/uploads` on any other route is refused with `NOT_FOUND` before it takes an upload slot or reaches the upload handler. Left out, every route takes uploads, as before. The factory gateway passes only the routes that can push, so a route such as its `heartbeat` route, whose token a lane's queued code can read, cannot store bundles.
