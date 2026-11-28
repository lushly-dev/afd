import { beforeEach } from "vitest";

// Firefox spends the first focus() on a document that lacks focus, as it does after a spec file
// that never took focus, on the window alone: the element stays unfocused. Firefox runs spec
// files one at a time in an order Vitest picks by size and duration, so a focus-dependent spec
// would pass or fail by which file ran before it. Take the window's focus before every test (#2841).
beforeEach(() => {
  window.focus();
});
