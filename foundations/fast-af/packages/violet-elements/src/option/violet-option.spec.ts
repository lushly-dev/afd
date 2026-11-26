import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-option.define";
import "../option-group/violet-option-group.define";
import "../select/violet-select.define";
import "../combobox/violet-combobox.define";
import "../listbox/violet-listbox.define";
import "../theme/violet-theme.define";
import type { VioletCombobox } from "../combobox/violet-combobox";
import type { VioletListbox } from "../listbox/violet-listbox";
import type { VioletSelect } from "../select/violet-select";
import { loadVioletBuiltInTheme } from "../theme/violet-theme-runtime";
import { VioletOption } from "./violet-option";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderOption(
  options: { text?: string; description?: string; configure?: (option: VioletOption) => void } = {},
): Promise<VioletOption> {
  document.body.innerHTML = "";

  const option = document.createElement("violet-option") as VioletOption;
  if (options.text !== undefined) {
    option.textContent = options.text;
  }

  if (options.description) {
    const description = document.createElement("span");
    description.slot = "description";
    description.textContent = options.description;
    option.append(description);
  }

  options.configure?.(option);
  document.body.append(option);

  await customElements.whenDefined("violet-option");
  await nextFrame();

  return option;
}

function control(option: VioletOption): HTMLElement {
  const element = option.shadowRoot?.querySelector(".control") as HTMLElement | null;
  if (!element) {
    throw new Error("violet-option did not render its control");
  }
  return element;
}

describe("violet-option", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes option semantics and a generated id when connected", async () => {
    const option = await renderOption({ text: "Apple" });

    expect(option.getAttribute("role")).toBe("option");
    expect(option.id).toBe(option.optionId);
    expect(option.getAttribute("aria-selected")).toBe("false");
    // Unset, so a disabled listbox's aria-disabled reaches it.
    expect(option.hasAttribute("aria-disabled")).toBe(false);
  });

  it("keeps an author-provided id", async () => {
    const option = await renderOption({
      text: "Apple",
      configure: (el) => {
        el.id = "custom-id";
      },
    });

    expect(option.id).toBe("custom-id");
  });

  it("gives each option a unique id", () => {
    const first = document.createElement("violet-option") as VioletOption;
    const second = document.createElement("violet-option") as VioletOption;

    expect(first.optionId).not.toBe(second.optionId);
  });

  it("derives its value from its text when no value is set", async () => {
    const option = await renderOption({ text: "  Green   apple " });

    expect(option.labelText).toBe("Green apple");
    expect(option.value).toBe("Green apple");
  });

  it("prefers the label attribute for label text and derived value", async () => {
    const option = await renderOption({
      text: "ignored",
      configure: (el) => {
        el.setAttribute("label", "Explicit label");
      },
    });

    expect(option.labelText).toBe("Explicit label");
    expect(option.value).toBe("Explicit label");
  });

  it("keeps an explicit value", async () => {
    const option = await renderOption({
      text: "Apple",
      configure: (el) => {
        el.setAttribute("value", "apple-id");
      },
    });

    expect(option.value).toBe("apple-id");
  });

  it("keeps an empty value from the value attribute or the value property (#2235)", async () => {
    document.body.innerHTML = `<violet-option value="">None</violet-option>`;
    await customElements.whenDefined("violet-option");
    await nextFrame();
    const fromMarkup = document.body.querySelector("violet-option") as VioletOption;

    expect(fromMarkup.labelText).toBe("None");
    expect(fromMarkup.value).toBe("");

    const beforeConnect = await renderOption({
      text: "None",
      configure: (el) => {
        el.value = "";
      },
    });

    expect(beforeConnect.labelText).toBe("None");
    expect(beforeConnect.value).toBe("");

    beforeConnect.label = "Nothing";
    await nextFrame();
    expect(beforeConnect.value).toBe("");

    const afterConnect = await renderOption({ text: "None" });
    expect(afterConnect.value).toBe("None");
    afterConnect.value = "";
    await nextFrame();
    expect(afterConnect.value).toBe("");

    afterConnect.removeAttribute("value");
    await nextFrame();
    expect(afterConnect.value).toBe("None");
  });

  it("excludes slotted description text from the label text", async () => {
    const option = await renderOption({ text: "Apple", description: "A red fruit" });

    expect(option.labelText).toBe("Apple");
    expect(option.hasDescription).toBe(true);
  });

  it("reports no description when the slot is empty", async () => {
    const option = await renderOption({ text: "Apple" });

    expect(option.hasDescription).toBe(false);
  });

  it("reflects selected to aria-selected and the control class", async () => {
    const option = await renderOption({ text: "Apple" });

    option.selected = true;
    await nextFrame();

    expect(option.hasAttribute("selected")).toBe(true);
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(control(option).classList.contains("selected")).toBe(true);

    option.selected = false;
    await nextFrame();

    expect(option.getAttribute("aria-selected")).toBe("false");
    expect(control(option).classList.contains("selected")).toBe(false);
  });

  it("reflects disabled to aria-disabled and the control class", async () => {
    const option = await renderOption({ text: "Apple" });

    option.disabled = true;
    await nextFrame();
    expect(option.hasAttribute("disabled")).toBe(true);
    expect(option.isDisabled).toBe(true);
    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(control(option).classList.contains("disabled")).toBe(true);

    option.disabled = false;
    await nextFrame();
    expect(option.hasAttribute("aria-disabled")).toBe(false);
  });

  it("treats a disabled group as disabled", async () => {
    const option = await renderOption({ text: "Apple" });

    option.groupDisabled = true;

    expect(option.disabled).toBe(false);
    expect(option.isDisabled).toBe(true);
  });

  // The test below relies on @observable change callbacks / bindings, which are inert when
  // the vite/esbuild test transform does not apply experimentalDecorators.
  it("reflects group-disabled state to aria-disabled", async () => {
    const option = await renderOption({ text: "Apple" });

    option.groupDisabled = true;
    await nextFrame();

    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(control(option).classList.contains("disabled")).toBe(true);
  });

  it("reflects active as a host attribute and marks the control active", async () => {
    const option = await renderOption({ text: "Apple" });

    option.active = true;
    await nextFrame();

    expect(option.hasAttribute("active")).toBe(true);
    expect(control(option).classList.contains("active")).toBe(true);

    option.active = false;
    await nextFrame();

    expect(option.hasAttribute("active")).toBe(false);
    expect(control(option).classList.contains("active")).toBe(false);
  });

  it("allows styling active rows independently of hover and selected states through [active] and CSS custom properties (#1582)", async () => {
    await loadVioletBuiltInTheme();
    const option = await renderOption({ text: "Apple" });
    const style = document.createElement("style");
    style.textContent = `
            violet-option[active] {
                --violet-option-active-background: rgb(12, 34, 56);
                --violet-option-active-ring: rgb(200, 10, 20);
            }
        `;
    document.body.append(style);

    option.active = true;
    await nextFrame();
    control(option).style.transition = "none";

    let computed = getComputedStyle(control(option));
    expect(computed.backgroundColor).toBe("rgb(12, 34, 56)");
    expect(computed.boxShadow).toContain("rgb(200, 10, 20)");

    // Hovering the active row preserves the explicit active fill rather than replacing it with hover.
    await userEvent.hover(control(option));
    await nextFrame();
    computed = getComputedStyle(control(option));
    expect(computed.backgroundColor).toBe("rgb(12, 34, 56)");
    await userEvent.unhover(control(option));

    // Reopening a populated select makes its selected option active: default preserves selected fill,
    // while explicit --violet-option-active-background and --violet-option-active-ring on the host win.
    document.body.innerHTML = "";
    const theme = document.createElement("violet-theme");
    theme.setAttribute("preset", "light");
    const select = document.createElement("violet-select") as VioletSelect;
    select.label = "Size";
    const optSmall = document.createElement("violet-option") as VioletOption;
    optSmall.value = "small";
    optSmall.textContent = "Small";
    const optMedium = document.createElement("violet-option") as VioletOption;
    optMedium.value = "medium";
    optMedium.textContent = "Medium";
    select.append(optSmall, optMedium);
    theme.append(select);
    document.body.append(theme);
    await customElements.whenDefined("violet-select");
    select.value = "medium";
    await nextFrame();
    select.show();
    await nextFrame();
    await nextFrame();

    expect(optMedium.hasAttribute("selected")).toBe(true);
    expect(optMedium.hasAttribute("active")).toBe(true);
    control(optMedium).style.transition = "none";
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--violet-color-surface-selected)";
    theme.append(probe);
    expect(getComputedStyle(control(optMedium)).backgroundColor).toBe(
      getComputedStyle(probe).backgroundColor,
    );

    // Author overrides on the host select propagate through the shadow listbox without being clobbered.
    select.style.setProperty("--violet-option-active-background", "rgb(12, 34, 56)");
    select.style.setProperty("--violet-option-active-ring", "rgb(200, 10, 20)");
    await vi.waitFor(() => {
      computed = getComputedStyle(control(optMedium));
      expect(computed.backgroundColor).toBe("rgb(12, 34, 56)");
      expect(computed.boxShadow).toContain("rgb(200, 10, 20)");
    });
  });

  it.each(["light", "dark", "high-contrast"])(
    "marks the active row at >= 3:1 in open select, combobox and focused listbox in %s (#1582)",
    async (preset) => {
      await loadVioletBuiltInTheme();
      document.body.innerHTML = "";
      const theme = document.createElement("violet-theme");
      theme.setAttribute("preset", preset);
      const canvas = document.createElement("div");
      canvas.style.background = "var(--violet-color-surface-page)";
      theme.append(canvas);
      document.body.append(theme);

      const parseRgba = (color: string): [number, number, number, number] => {
        const nums = (color.match(/[\d.]+/g) ?? []).map(Number);
        if (color.startsWith("color(srgb")) {
          return [(nums[0] ?? 0) * 255, (nums[1] ?? 0) * 255, (nums[2] ?? 0) * 255, nums[3] ?? 1];
        }
        return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1];
      };
      const composite = (
        fg: [number, number, number, number],
        bg: [number, number, number, number],
      ): [number, number, number] => [
        fg[0] * fg[3] + bg[0] * (1 - fg[3]),
        fg[1] * fg[3] + bg[1] * (1 - fg[3]),
        fg[2] * fg[3] + bg[2] * (1 - fg[3]),
      ];
      const luminance = (rgb: [number, number, number]): number => {
        const [r = 0, g = 0, b = 0] = rgb.map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const ringMetrics = (opt: VioletOption, backdropColor: string) => {
        control(opt).style.transition = "none";
        const computed = getComputedStyle(control(opt));
        const shadow = computed.boxShadow;
        const colorMatch = shadow.match(/color\(srgb[^)]+\)|rgba?\([^)]+\)/);
        const spreadMatch = shadow.match(/(\d+(?:\.\d+)?)px\s+inset/);
        const backdrop = parseRgba(backdropColor);
        const rowBg = composite(parseRgba(computed.backgroundColor), backdrop);
        const ringRgba = parseRgba(colorMatch?.[0] ?? "rgba(0, 0, 0, 0)");
        const ringRgb = composite(ringRgba, [rowBg[0], rowBg[1], rowBg[2], 1]);
        const l1 = luminance(ringRgb);
        const l2 = luminance(rowBg);
        return {
          hasInset: shadow.includes("inset"),
          spreadPx: Number(spreadMatch?.[1] ?? 0),
          alpha: ringRgba[3],
          contrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
        };
      };
      const assertActiveRing = (opt: VioletOption, backdropColor: string) => {
        expect(opt.hasAttribute("active")).toBe(true);
        const metrics = ringMetrics(opt, backdropColor);
        expect(metrics.hasInset).toBe(true);
        expect(metrics.spreadPx).toBeGreaterThanOrEqual(2);
        expect(metrics.alpha).toBeGreaterThan(0);
        expect(metrics.contrast).toBeGreaterThanOrEqual(3);
      };

      const pageBg = getComputedStyle(canvas).backgroundColor;

      // Select with grouped options (verifies inheritance through violet-option-group too).
      const select = document.createElement("violet-select") as VioletSelect;
      select.label = "Size";
      const group = document.createElement("violet-option-group");
      group.setAttribute("label", "Sizes");
      const optSmall = document.createElement("violet-option") as VioletOption;
      optSmall.textContent = "Small";
      const optMedium = document.createElement("violet-option") as VioletOption;
      optMedium.textContent = "Medium";
      group.append(optSmall, optMedium);
      select.append(group);
      canvas.append(select);
      await customElements.whenDefined("violet-select");
      await nextFrame();
      select.show();
      await nextFrame();
      await nextFrame();
      const selectPanel = select.shadowRoot?.querySelector(".panel") as HTMLElement;
      assertActiveRing(optSmall, getComputedStyle(selectPanel).backgroundColor);

      // Combobox.
      const combobox = document.createElement("violet-combobox") as VioletCombobox;
      combobox.label = "Fruit";
      const optApple = document.createElement("violet-option") as VioletOption;
      optApple.textContent = "Apple";
      combobox.append(optApple);
      canvas.append(combobox);
      await customElements.whenDefined("violet-combobox");
      await nextFrame();
      combobox.show();
      await nextFrame();
      await nextFrame();
      const comboPanel = combobox.shadowRoot?.querySelector(".panel") as HTMLElement;
      assertActiveRing(optApple, getComputedStyle(comboPanel).backgroundColor);

      // Listbox at rest draws no visible ring; focused via keyboard (:focus-visible) meets >= 3:1.
      const listbox = document.createElement("violet-listbox") as VioletListbox;
      listbox.label = "Choices";
      const optOne = document.createElement("violet-option") as VioletOption;
      optOne.textContent = "One";
      listbox.append(optOne);
      canvas.append(listbox);
      await customElements.whenDefined("violet-listbox");
      await nextFrame();
      const lbControl = listbox.shadowRoot?.querySelector(".control") as HTMLElement;
      const lbBg = getComputedStyle(lbControl).backgroundColor || pageBg;
      optOne.active = true;
      await nextFrame();
      const restingMetrics = ringMetrics(optOne, lbBg);
      expect(restingMetrics.alpha).toBe(0);
      expect(restingMetrics.contrast).toBe(1);

      await userEvent.tab();
      lbControl.focus();
      await userEvent.keyboard("{ArrowDown}");
      await nextFrame();
      assertActiveRing(optOne, lbBg);
    },
  );

  it.each(["light", "dark", "high-contrast"])(
    "keeps active text readable in %s without a palette override",
    async (preset) => {
      await loadVioletBuiltInTheme();
      await customElements.whenDefined("violet-theme");
      const option = await renderOption({ text: "Apple" });
      const theme = document.createElement("violet-theme");
      theme.setAttribute("preset", preset);
      theme.style.color = "var(--violet-color-text-primary)";
      option.before(theme);
      theme.append(option);
      option.active = true;
      await vi.waitFor(() => {
        expect(
          getComputedStyle(theme).getPropertyValue("--violet-color-surface-subtle").trim(),
        ).not.toBe("");
      });
      await nextFrame();
      // Exclude transition intermediates from the measured color pair.
      control(option).style.transition = "none";
      const computed = getComputedStyle(control(option));
      const surface = getComputedStyle(theme)
        .getPropertyValue("--violet-color-surface-subtle")
        .trim();
      const probe = document.createElement("span");
      probe.style.backgroundColor = surface;
      theme.append(probe);
      expect(computed.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
      const luminance = (color: string): number => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const foreground = luminance(computed.color);
      const background = luminance(computed.backgroundColor);
      expect(
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("emits request-select with its value when clicked", async () => {
    const option = await renderOption({
      text: "Apple",
      configure: (el) => {
        el.value = "apple-id";
      },
    });
    const details: Array<{ value: string }> = [];
    option.addEventListener("request-select", (event) => {
      details.push((event as CustomEvent<{ value: string }>).detail);
    });

    control(option).click();

    expect(details).toEqual([{ value: "apple-id" }]);
  });

  it("does not emit request-select when disabled", async () => {
    const option = await renderOption({
      text: "Apple",
      configure: (el) => {
        el.disabled = true;
      },
    });
    let emitted = 0;
    option.addEventListener("request-select", () => {
      emitted += 1;
    });

    control(option).click();

    expect(emitted).toBe(0);
  });

  it("does not emit request-select when its group is disabled", async () => {
    const option = await renderOption({
      text: "Apple",
      configure: (el) => {
        el.groupDisabled = true;
      },
    });
    let emitted = 0;
    option.addEventListener("request-select", () => {
      emitted += 1;
    });

    control(option).click();

    expect(emitted).toBe(0);
  });

  it("projects before, default and after slots", async () => {
    const option = await renderOption({
      text: "Apple",
      configure: (el) => {
        const before = document.createElement("span");
        before.slot = "before";
        const after = document.createElement("span");
        after.slot = "after";
        el.append(before, after);
      },
    });
    const root = option.shadowRoot as ShadowRoot;

    expect(
      (root.querySelector('slot[name="before"]') as HTMLSlotElement).assignedElements(),
    ).toHaveLength(1);
    expect(
      (root.querySelector('slot[name="after"]') as HTMLSlotElement).assignedElements(),
    ).toHaveLength(1);
    expect(
      (root.querySelector("slot:not([name])") as HTMLSlotElement).assignedNodes()[0]?.textContent,
    ).toBe("Apple");
  });
});
