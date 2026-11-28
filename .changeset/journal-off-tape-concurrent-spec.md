---
"afd-spec": patch
---

The journal (`spec/journal.md`): the clock and random source a call reads are its own. Recording a call, or keeping a secret call off tape, never changes what a concurrent call on the same context object reads, so a secret call's values reach no sibling's tape. Where an implementation cannot tell whose read a value is, the read takes neither call's sources and every recording running on the context is marked `truncated`.
