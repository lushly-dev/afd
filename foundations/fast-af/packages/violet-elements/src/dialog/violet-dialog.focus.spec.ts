import { afterEach, describe, expect, it } from "vitest";
import { server, userEvent } from "vitest/browser";

import "./violet-dialog.define";
import type { VioletDialog } from "./violet-dialog";

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function fixture(type = "modal") {
  const before = document.createElement("button");
  before.textContent = "Before";
  const dialog = document.createElement("violet-dialog") as VioletDialog;
  dialog.type = type;
  dialog.style.setProperty("--_duration-base", "200ms");
  dialog.innerHTML = '<span slot="title">Title</span><input aria-label="Name">';
  const after = document.createElement("button");
  after.textContent = "After";
  document.body.append(before, dialog, after);
  await settle();
  const native = dialog.shadowRoot!.querySelector("dialog")!;
  const input = dialog.querySelector("input")!;
  return { before, dialog, after, native, input };
}

describe("closed violet-dialog focus", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Tabs past a never-opened dialog with a title and input", async () => {
    const { before, after } = await fixture();
    before.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(after);
  });

  for (const type of ["modal", "non-modal"]) {
    it(`excludes descendants after ${type} close while preserving animations and focus`, async () => {
      const { before, dialog, after, native, input } = await fixture(type);
      before.focus();
      dialog.show();
      await settle();
      expect(native.open).toBe(true);
      expect(native.matches(":modal")).toBe(type === "modal");
      expect(getComputedStyle(native).display).toBe("flex");
      const opening = native.getAnimations();
      expect(
        opening.some(
          (animation) =>
            animation instanceof CSSTransition && animation.transitionProperty === "opacity",
        ),
      ).toBe(true);
      await Promise.all(opening.map((animation) => animation.finished));
      input.focus();
      expect(document.activeElement).toBe(input);
      const rect = input.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const openHit = dialog.shadowRoot!.elementFromPoint(x, y);
      if (server.browser === "chromium") {
        expect(openHit).toBe(input);
      } else {
        // Firefox returns the shadow body wrapping the slot for elementFromPoint on a slotted input.
        expect(openHit === input || openHit === dialog.shadowRoot!.querySelector(".body")).toBe(
          true,
        );
      }

      dialog.hide();
      await settle();
      expect(native.open).toBe(false);
      expect(document.activeElement).toBe(before);
      const closing = native.getAnimations();
      if (server.browser === "chromium") {
        expect(
          closing.some(
            (animation) =>
              animation instanceof CSSTransition && animation.transitionProperty === "opacity",
          ),
        ).toBe(true);
        expect(getComputedStyle(native).display).toBe("flex");
      }
      // Chromium can cancel the opacity transition when the discrete display transition hides it.
      await Promise.allSettled(closing.map((animation) => animation.finished));
      await settle();

      expect(getComputedStyle(native).display).toBe("none");
      expect(input.getClientRects().length).toBe(0);
      expect(dialog.shadowRoot!.elementFromPoint(x, y)).not.toBe(input);
      expect(document.elementFromPoint(x, y)).not.toBe(dialog);
      await userEvent.tab();
      expect(document.activeElement).toBe(after);
    });
  }
});
