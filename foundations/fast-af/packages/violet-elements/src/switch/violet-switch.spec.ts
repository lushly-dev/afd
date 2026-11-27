import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import "./violet-switch.define";
import type { VioletSwitch } from "./violet-switch";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderSwitch(
  options: {
    checked?: boolean;
    inline?: boolean;
    label?: string;
    supporting?: string;
    ariaLabel?: string;
    required?: boolean;
  } = {},
): Promise<VioletSwitch> {
  document.body.innerHTML = "";

  const element = document.createElement("violet-switch") as VioletSwitch;
  element.checked = options.checked ?? false;
  element.inline = options.inline ?? false;
  element.required = options.required ?? false;
  element.name = "notifications";
  element.value = "enabled";

  if (options.ariaLabel) {
    element.setAttribute("aria-label", options.ariaLabel);
  }

  if (options.label) {
    element.textContent = options.label;
  }

  if (options.supporting) {
    const supporting = document.createElement("span");
    supporting.slot = "supporting";
    supporting.textContent = options.supporting;
    element.append(supporting);
  }

  document.body.append(element);

  await customElements.whenDefined("violet-switch");
  await nextFrame();

  return element;
}

describe("violet-switch", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dims a disabled switch's control and label but keeps its supporting text readable", async () => {
    const element = await renderSwitch({
      label: "Enable harvest sync",
      supporting: "Unavailable while the field audit is in progress.",
    });
    element.disabled = true;
    await nextFrame();

    const opacity = (selector: string) =>
      getComputedStyle(element.shadowRoot?.querySelector(selector) as Element).opacity;
    expect(opacity(".control-shell")).toBe("0.5");
    expect(opacity(".label")).toBe("0.5");
    expect(opacity(".supporting")).toBe("1");
    expect(opacity(".root")).toBe("1");
  });

  it("toggles from its visual track and exposes switch semantics on the native control", async () => {
    const element = await renderSwitch({
      label: "Enable notifications",
      supporting: "Keeps morning alerts turned on.",
    });
    const input = element.shadowRoot?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    const track = element.shadowRoot?.querySelector(".track") as HTMLLabelElement | null;

    expect(input?.getAttribute("role")).toBe("switch");
    expect(input?.checked).toBe(false);

    track?.click();
    await nextFrame();

    expect(element.checked).toBe(true);
    expect(input?.checked).toBe(true);
    expect(input?.getAttribute("aria-describedby")).toBe(element.supportingTextId);
  });

  it("participates in validation and form submission when required", async () => {
    const element = await renderSwitch({
      label: "Enable automation",
      required: true,
    });

    expect(element.checkValidity()).toBe(false);

    element.checked = true;
    await nextFrame();

    expect(element.checkValidity()).toBe(true);

    const form = document.createElement("form");
    form.append(element);
    const formData = new FormData(form);
    expect(formData.get("notifications")).toBe("enabled");
  });

  it("supports inline control-only rendering with an explicit accessible name", async () => {
    const element = await renderSwitch({
      checked: true,
      inline: true,
      ariaLabel: "Compact automation switch",
    });
    const input = element.shadowRoot?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;

    expect(element.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
    expect(input?.getAttribute("aria-label")).toBe("Compact automation switch");
  });

  describe("hit area", () => {
    function nativeInput(element: VioletSwitch): HTMLInputElement {
      return element.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    }

    function centerOf(target: Element): { x: number; y: number } {
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    it("toggles from a role-based click without force", async () => {
      const element = await renderSwitch({ label: "Enable notifications" });
      const changes: boolean[] = [];
      element.addEventListener("change", () => changes.push(element.checked));

      await page.getByRole("switch", { name: "Enable notifications" }).click();

      expect(element.checked).toBe(true);
      expect(nativeInput(element).checked).toBe(true);
      expect(changes).toEqual([true]);

      await page.getByRole("switch", { name: "Enable notifications" }).click();
      expect(element.checked).toBe(false);
      expect(changes).toEqual([true, false]);
    });

    it("toggles an inline switch from a role-based click", async () => {
      const element = await renderSwitch({ inline: true, ariaLabel: "Compact automation switch" });

      await page.getByRole("switch", { name: "Compact automation switch" }).click();

      expect(element.checked).toBe(true);
    });

    it("hit-tests the visible track to the native input and toggles exactly once", async () => {
      const element = await renderSwitch({ label: "Enable notifications" });
      const track = element.shadowRoot?.querySelector(".track") as HTMLElement;
      const changes: boolean[] = [];
      element.addEventListener("change", () => changes.push(element.checked));

      const { x, y } = centerOf(track);
      expect(element.shadowRoot?.elementFromPoint(x, y)).toBe(nativeInput(element));

      // A real pointer at the track's centre: the control shell contains the input,
      // so Playwright's hit-test accepts it and the click lands where a person's would.
      await page
        .elementLocator(element.shadowRoot?.querySelector(".control-shell") as HTMLElement)
        .click();

      expect(element.checked).toBe(true);
      expect(changes).toEqual([true]);
    });

    it("still toggles once when the track is clicked programmatically", async () => {
      const element = await renderSwitch({ label: "Enable notifications" });
      const changes: boolean[] = [];
      element.addEventListener("change", () => changes.push(element.checked));

      const track = element.shadowRoot?.querySelector(".track") as HTMLElement;
      track.click();

      expect(element.checked).toBe(true);
      expect(changes).toEqual([true]);
    });

    it("toggles from a label click and from the keyboard", async () => {
      const element = await renderSwitch({ label: "Enable notifications" });

      await page.elementLocator(element.shadowRoot?.querySelector(".label") as HTMLElement).click();
      expect(element.checked).toBe(true);

      nativeInput(element).focus();
      await userEvent.keyboard("{ }");
      expect(element.checked).toBe(false);
    });

    it("ignores clicks while disabled", async () => {
      const element = await renderSwitch({ label: "Enable notifications" });
      element.disabled = true;
      await nextFrame();

      const track = element.shadowRoot?.querySelector(".track") as HTMLElement;
      const { x, y } = centerOf(track);
      expect(element.shadowRoot?.elementFromPoint(x, y)).toBe(nativeInput(element));
      expect(nativeInput(element).disabled).toBe(true);

      track.click();
      nativeInput(element).click();

      expect(element.checked).toBe(false);
      expect(nativeInput(element).checked).toBe(false);
    });

    it("does not take clicks from a positioned overlay stacked above it", async () => {
      const element = await renderSwitch({ label: "Enable notifications" });
      const overlay = document.createElement("div");
      const rect = element.shadowRoot?.querySelector(".track")?.getBoundingClientRect() as DOMRect;
      overlay.setAttribute(
        "style",
        `position:fixed;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px`,
      );
      document.body.append(overlay);
      const { x, y } = centerOf(element.shadowRoot?.querySelector(".track") as HTMLElement);

      expect(document.elementFromPoint(x, y)).toBe(overlay);
      await page.elementLocator(overlay).click();
      expect(element.checked).toBe(false);
    });

    it("keeps the focus ring on the track when the input has keyboard focus", async () => {
      const element = await renderSwitch({ label: "Enable notifications" });
      const track = element.shadowRoot?.querySelector(".track") as HTMLElement;
      const before = getComputedStyle(track).boxShadow;

      await userEvent.tab();
      await nextFrame();

      expect(element.shadowRoot?.activeElement).toBe(nativeInput(element));
      expect(getComputedStyle(track).boxShadow).not.toBe(before);
    });
  });

  describe("field errors", () => {
    it("renders no error before invalid is set, even with required and error-text", async () => {
      const element = await renderSwitch({
        label: "Enable alerts",
        supporting: "Sends weather updates.",
        required: true,
      });
      element.errorText = "Turn on alerts to continue.";
      await nextFrame();

      expect(element.shadowRoot?.querySelector(".error")).toBeNull();
      expect(element.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(false);
      expect(element.checkValidity()).toBe(false);
    });

    it("replaces supporting text with error-text while invalid, announces it, and links aria-describedby", async () => {
      const element = await renderSwitch({
        label: "Enable alerts",
        supporting: "Sends weather updates.",
      });
      element.setAttribute("error-text", "Turn on alerts to continue.");
      element.invalid = true;
      await nextFrame();
      await nextFrame();

      const input = element.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const error = element.shadowRoot?.querySelector(
        '[part~="error-message"]',
      ) as HTMLElement | null;
      const supporting = element.shadowRoot?.querySelector(
        '[part~="supporting-text"]',
      ) as HTMLElement | null;

      expect(error?.textContent?.trim()).toBe("Turn on alerts to continue.");
      expect(error?.getAttribute("role")).toBe("alert");
      expect(supporting?.hasAttribute("hidden")).toBe(true);
      expect(input.getAttribute("aria-describedby")).toBe(element.errorTextId);
      expect(element.validationMessage).toBe("Turn on alerts to continue.");

      element.invalid = false;
      await nextFrame();
      await nextFrame();

      expect(element.shadowRoot?.querySelector(".error")).toBeNull();
      expect(supporting?.hasAttribute("hidden")).toBe(false);
      expect(input.getAttribute("aria-describedby")).toBe(element.supportingTextId);
    });

    it("falls back to the browser validation message when invalid and required without error-text", async () => {
      const element = await renderSwitch({
        label: "Enable alerts",
        supporting: "Sends weather updates.",
        required: true,
      });
      element.invalid = true;
      await nextFrame();
      await nextFrame();

      const input = element.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const error = element.shadowRoot?.querySelector(
        '[part~="error-message"]',
      ) as HTMLElement | null;
      expect(error?.textContent?.trim()).toBe(input.validationMessage);
      expect(error?.textContent?.trim()).not.toBe("");
      expect(element.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(true);
    });

    it("suppresses the error message while disabled and reveals content for inline errors", async () => {
      const element = await renderSwitch({
        inline: true,
        ariaLabel: "Compact switch",
      });
      element.errorText = "Turn on before saving.";
      element.invalid = true;
      await nextFrame();
      await nextFrame();

      expect(element.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(false);
      expect(element.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Turn on before saving.",
      );

      element.disabled = true;
      await nextFrame();

      expect(element.shadowRoot?.querySelector(".error")).toBeNull();
      expect(element.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
    });

    it("falls back to the browser validation message when error-text is only whitespace", async () => {
      const element = await renderSwitch({
        label: "Enable alerts",
        required: true,
      });
      element.errorText = "   ";
      element.invalid = true;
      await nextFrame();
      await nextFrame();

      const input = element.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const error = element.shadowRoot?.querySelector(
        '[part~="error-message"]',
      ) as HTMLElement | null;
      expect(error?.textContent?.trim()).toBe(input.validationMessage);
      expect(error?.textContent?.trim()).not.toBe("");
    });

    it("suppresses the error message inside a disabled fieldset and restores it when re-enabled", async () => {
      document.body.innerHTML = "";
      const form = document.createElement("form");
      const fieldset = document.createElement("fieldset");
      fieldset.disabled = true;
      const element = document.createElement("violet-switch") as VioletSwitch;
      element.textContent = "Enable alerts";
      const supporting = document.createElement("span");
      supporting.slot = "supporting";
      supporting.textContent = "Helper.";
      element.append(supporting);
      element.errorText = "Turn on alerts.";
      element.invalid = true;
      fieldset.append(element);
      form.append(fieldset);
      document.body.append(form);
      await customElements.whenDefined("violet-switch");
      await nextFrame();
      await nextFrame();

      expect(element.shadowRoot?.querySelector(".error")).toBeNull();
      expect(element.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(false);

      fieldset.disabled = false;
      await nextFrame();
      await nextFrame();

      expect(element.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Turn on alerts.",
      );
      expect(element.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(true);
    });

    it("keeps displayErrorText read-only", async () => {
      const element = await renderSwitch({ label: "Enable alerts" });
      const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        "displayErrorText",
      );
      expect(descriptor?.set).toBeUndefined();
    });
  });

  describe("in right-to-left", () => {
    it("keeps the checked thumb inside the track and moves it toward the inline-end edge", async () => {
      document.body.innerHTML = "";
      const wrapper = document.createElement("div");
      wrapper.setAttribute("dir", "rtl");

      const unchecked = document.createElement("violet-switch") as VioletSwitch;
      unchecked.textContent = "Unchecked";
      const checked = document.createElement("violet-switch") as VioletSwitch;
      checked.checked = true;
      checked.textContent = "Checked";

      wrapper.append(unchecked, checked);
      document.body.append(wrapper);
      await customElements.whenDefined("violet-switch");
      await nextFrame();
      await nextFrame();

      const uncheckedShadow = unchecked.shadowRoot as ShadowRoot;
      const checkedShadow = checked.shadowRoot as ShadowRoot;
      const uncheckedTrack = (
        uncheckedShadow.querySelector(".track") as HTMLElement
      ).getBoundingClientRect();
      const uncheckedThumb = (
        uncheckedShadow.querySelector(".thumb") as HTMLElement
      ).getBoundingClientRect();
      const checkedTrack = (
        checkedShadow.querySelector(".track") as HTMLElement
      ).getBoundingClientRect();
      const checkedThumb = (
        checkedShadow.querySelector(".thumb") as HTMLElement
      ).getBoundingClientRect();

      // Unchecked thumb sits at the right (inline-start) edge inside the track.
      expect(uncheckedThumb.left).toBeGreaterThanOrEqual(uncheckedTrack.left);
      expect(uncheckedThumb.right).toBeLessThanOrEqual(uncheckedTrack.right);
      expect(uncheckedTrack.right - uncheckedThumb.right).toBeLessThan(
        uncheckedThumb.left - uncheckedTrack.left,
      );

      // Checked thumb moves leftward toward the inline-end edge and stays inside the track.
      expect(checkedThumb.left).toBeGreaterThanOrEqual(checkedTrack.left);
      expect(checkedThumb.right).toBeLessThanOrEqual(checkedTrack.right);
      expect(checkedThumb.left - checkedTrack.left).toBeLessThan(
        checkedTrack.right - checkedThumb.right,
      );
      expect(checkedThumb.left - checkedTrack.left).toBeCloseTo(
        uncheckedTrack.right - uncheckedThumb.right,
        0,
      );
    });
  });
});
