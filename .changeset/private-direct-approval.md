---
'@lushly-dev/afd-core': patch
'@lushly-dev/afd-client': patch
'@lushly-dev/afd-server': patch
'@lushly-dev/afd-cli': patch
---

Keep DirectClient approval credentials in a private exchange instead of returning them to the gated caller. Public call, pipe and DirectRegistry contexts discard caller-supplied approval evidence; only an affirmative trusted hook enables one verified retry. Preserve in-process CLI approval through the same exchange.

Use matching client, core and server versions. Applications that submitted approval tokens directly through createDirectRegistry must migrate to DirectClient's onApprovalNeeded hook. Custom registries must support the private exchange; legacy token-in-result failures remain held and are returned without their token.
