---
"@lushly-dev/violet-afd": minor
"@lushly-dev/violet-core": patch
"@lushly-dev/violet-cli": patch
"@lushly-dev/violet-server": patch
---

Specimens take their component model from the components' token interface ([#1786](https://github.com/lushly-dev/afd/issues/1786)). `@lushly-dev/violet-afd` exports `SPECIMEN_INTERFACE_MAP`, which maps each role of the seven specimens (button, input, card, text, link, checkbox, focus) to the token id its `@lushly-dev/violet-elements` component reads in `tokens/interface.json` (`color.action.primary.background` for the button's background, `radius.lg` for the card's radius), with `SPECIMEN_INTERFACE`, `specimenRolesOf`, `specimenTakesRole` and `specimenInterfaceToken`. A tree that defines the interface ids now draws its specimens with no stored map. Roles whose value the component computes or hard-codes, or for which the interface has no token (among them the button's border and font weight, the button's and input's vertical padding, the checkbox's size, the link's underline and the focus ring's offset), have no interface id and are drawn only through a map. A test reads the interface and fails when a mapped id leaves it, changes to a type its role cannot draw, or the interface's `contractVersion` changes.

- **Breaking (preview minor), `specimen.get`:** a role the stored map leaves out now draws from the interface id, not the `<component>.<role>` naming convention, which is gone: a tree that relied on tokens such as `button.background` must map them with `specimen.set`. Each role's `source` is `map`, `interface` or `unmapped` (no longer `convention`), its `tokenId` is null when neither the map nor the interface names one, and it gains `interfaceTokenId`. Each component gains `element` (the violet-elements tag it samples, or null for the link and focus ring), and the result gains `interface` (`{ package, contractVersion }`).
- `specimen.set` checks components and roles against the same map; which components and roles it accepts is unchanged.
- `@lushly-dev/violet-core` keeps the role validators (`SPECIMEN_ROLES`, `specimenRoleDeclaration`, `SPECIMEN_CHECK_PROPERTY`). `SPECIMEN_COMPONENTS`, `SpecimenComponent`, `SPECIMEN_REQUIRED_ROLE`, `conventionToken` and `specimenComponentHasRole` are deprecated in favour of violet-afd's map and helpers, are no longer read by the commands, and will be removed in a later release. The OpenAPI description of the specimen route says where unmapped roles draw from.
- The demo tree (`violet demo`) names its component tokens `<component>.<role>`, so it now stores a specimen map on `global` and its specimens draw as before.
- `violet specimen get` says that a tree with no map draws from the interface ids, and the MCP server's instructions describe the same.
