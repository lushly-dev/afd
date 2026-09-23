---
'@lushly-dev/afd-core': patch
'@lushly-dev/afd-server': patch
'@lushly-dev/afd-client': patch
---

Bound fuzzy matching of unknown command names and contain exceptions thrown during input validation. `findSimilarTools` now returns no suggestions for names longer than `MAX_SIMILARITY_INPUT_LENGTH` (128), skips candidates whose length difference rules out the 0.4 threshold, and uses a two-row Levenshtein, so a large name sent to `afd-call`, `afd-detail` or `DirectClient` no longer blocks the event loop for seconds. Error messages echo at most 128 characters of an unknown name (new `truncateName` helper), and the client uses the core matcher instead of its own copy. In the server, an exception thrown by a Zod `.refine`, `.superRefine`, `.transform` or `.preprocess` callback now returns a `VALIDATION_ERROR` result, with the exception text only in `devMode`, instead of rejecting: `/batch` and `afd-batch` no longer answer HTTP 500 after earlier commands in the batch ran, and `afd-pipe` and `/stream` no longer expose raw exception text. A throwing or rejecting `onCommand` or `onError` hook no longer changes a command's result, and handler results are copied instead of mutated, so frozen results work.
