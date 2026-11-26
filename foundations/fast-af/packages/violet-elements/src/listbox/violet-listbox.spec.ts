import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "../option-group/violet-option-group.define";
import "../option/violet-option.define";
import "./violet-listbox.define";
import type { VioletOption } from "../option/violet-option";
import type { VioletListbox } from "./violet-listbox";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createOption(label: string, value: string, disabled = false): HTMLElement {
  const option = document.createElement("violet-option");
  option.setAttribute("value", value);
  option.textContent = label;
  if (disabled) {
    option.setAttribute("disabled", "");
  }
  return option;
}

function createGroup(
  label: string,
  options: Array<{ label: string; value: string; disabled?: boolean }>,
  disabled = false,
): HTMLElement {
  const group = document.createElement("violet-option-group");
  group.setAttribute("label", label);
  if (disabled) {
    group.setAttribute("disabled", "");
  }

  for (const option of options) {
    group.append(createOption(option.label, option.value, option.disabled ?? false));
  }

  return group;
}

async function renderListbox(): Promise<VioletListbox> {
  document.body.innerHTML = "";
  const listbox = document.createElement("violet-listbox") as VioletListbox;
  listbox.value = "direct";
  listbox.append(
    createOption("Broadcast", "broadcast"),
    createOption("Direct", "direct"),
    createOption("Transplant", "transplant"),
    createOption("Hydro", "hydro", true),
  );
  document.body.append(listbox);
  await customElements.whenDefined("violet-listbox");
  await nextFrame();
  return listbox;
}

describe("violet-listbox", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // #712: focus entering on a press scrolled the active row into view, so the row under the
  // pointer moved before the press ended and the click landed on another row.
  describe("focus scrolling", () => {
    async function renderLongListbox(): Promise<{ listbox: VioletListbox; scroller: HTMLElement }> {
      document.body.innerHTML = "";
      const listbox = document.createElement("violet-listbox") as VioletListbox;
      listbox.style.setProperty("--violet-listbox-max-block-size", "8rem");
      for (let index = 1; index <= 30; index++) {
        listbox.append(createOption(`Row ${index}`, `row-${index}`));
      }
      listbox.value = "row-28";
      document.body.append(listbox);
      await customElements.whenDefined("violet-listbox");
      await nextFrame();
      const scroller = listbox.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement;
      scroller.scrollTop = 0;
      return { listbox, scroller };
    }

    it("does not scroll the selected row into view when a press focuses the list", async () => {
      const { listbox, scroller } = await renderLongListbox();
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
      const changes: string[] = [];
      listbox.addEventListener("change", () => changes.push(listbox.value));

      await userEvent.click(listbox.querySelector('violet-option[value="row-2"]') as HTMLElement);
      await nextFrame();

      expect(scroller.scrollTop).toBe(0);
      expect(listbox.value).toBe("row-2");
      expect(changes).toEqual(["row-2"]);
    });

    // Loam's project switcher sets the active row and focuses the list from a click handler.
    it("scrolls the active row into view when script focuses the list after a press elsewhere", async () => {
      const { listbox, scroller } = await renderLongListbox();
      const opener = document.createElement("button");
      opener.textContent = "Open";
      opener.addEventListener("click", () => {
        listbox.activeValue = "row-28";
        listbox.focus();
      });
      document.body.prepend(opener);

      await userEvent.click(opener);
      await nextFrame();

      expect(scroller.scrollTop).toBeGreaterThan(0);
    });

    it("scrolls the active row into view when focus arrives from the keyboard", async () => {
      const { scroller } = await renderLongListbox();
      const before = document.createElement("button");
      before.textContent = "Before";
      document.body.prepend(before);
      before.focus();

      await userEvent.keyboard("{Tab}");
      await nextFrame();

      expect(scroller.scrollTop).toBeGreaterThan(0);
    });
  });

  it("syncs selected and active option state from the current value", async () => {
    const listbox = await renderListbox();
    const options = listbox.options;

    expect(listbox.value).toBe("direct");
    expect(options.find((option) => option.value === "direct")?.selected).toBe(true);
    expect(options.find((option) => option.value === "direct")?.active).toBe(true);
  });

  it("moves active state with the keyboard and commits on enter", async () => {
    const listbox = await renderListbox();
    listbox.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await nextFrame();

    expect(listbox.activeValue).toBe("transplant");

    listbox.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
    await nextFrame();

    expect(listbox.value).toBe("transplant");
  });

  it("supports multiple selection without collapsing to a single value", async () => {
    const listbox = await renderListbox();
    listbox.multiple = true;
    listbox.selectedValues = ["direct"];
    listbox.activeValue = "transplant";
    listbox.handleKeydown(new KeyboardEvent("keydown", { key: " " }));
    await nextFrame();

    expect(listbox.selectedValues).toEqual(["direct", "transplant"]);
    expect(listbox.options.find((option) => option.value === "direct")?.selected).toBe(true);
    expect(listbox.options.find((option) => option.value === "transplant")?.selected).toBe(true);
  });

  it("treats options inside a disabled group as unavailable", async () => {
    document.body.innerHTML = "";
    const listbox = document.createElement("violet-listbox") as VioletListbox;
    listbox.value = "regional";
    listbox.append(
      createGroup("Active", [{ label: "Regional", value: "regional" }]),
      createGroup("Archived", [{ label: "Legacy", value: "legacy" }], true),
    );
    document.body.append(listbox);
    await customElements.whenDefined("violet-listbox");
    await nextFrame();

    listbox.selectValue("legacy");
    await nextFrame();

    expect(listbox.value).toBe("regional");
    expect(listbox.options.find((option) => option.value === "legacy")?.isDisabled).toBe(true);
  });

  it("leaves its options' disabled state to a disabled listbox", async () => {
    const listbox = await renderListbox();
    listbox.disabled = true;
    await nextFrame();

    const control = listbox.shadowRoot?.querySelector('[role="listbox"]');
    expect(control?.getAttribute("aria-disabled")).toBe("true");
    // An explicit "false" on an option would override the listbox's state for it.
    const states = listbox.options.map((option) => [
      option.value,
      option.getAttribute("aria-disabled"),
    ]);
    expect(states).toEqual([
      ["broadcast", null],
      ["direct", null],
      ["transplant", null],
      ["hydro", "true"],
    ]);
    expect(listbox.value).toBe("direct");
  });

  describe("native key handling", () => {
    it("returns true for unhandled keys and false for handled keys", async () => {
      const listbox = await renderListbox();
      const key = (value: string, init: KeyboardEventInit = {}) =>
        new KeyboardEvent("keydown", { key: value, cancelable: true, ...init });

      expect(listbox.handleKeydown(key("Tab"))).toBe(true);
      expect(listbox.handleKeydown(key("a", { ctrlKey: true }))).toBe(true);
      expect(listbox.handleKeydown(key("ArrowDown"))).toBe(false);
    });

    it("does not cancel Tab on a real keydown", async () => {
      const listbox = await renderListbox();
      const control = listbox.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement;
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
        composed: true,
      });

      control.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("empty-value options (#2235)", () => {
    async function renderEmptyValueListbox(configure?: (listbox: VioletListbox) => void) {
      document.body.innerHTML = "";
      const listbox = document.createElement("violet-listbox") as VioletListbox;
      const warm = createOption("Warm", "warm") as VioletOption;
      const none = createOption("None", "") as VioletOption;
      const cold = createOption("Cold", "cold") as VioletOption;
      listbox.append(warm, none, cold);
      configure?.(listbox);
      document.body.append(listbox);
      await customElements.whenDefined("violet-listbox");
      await nextFrame();
      return { listbox, warm, none, cold };
    }

    it("activates and chooses an empty-value option from the keyboard and with selectionFollowsFocus", async () => {
      const { listbox, none } = await renderEmptyValueListbox();
      const changes: string[] = [];
      listbox.addEventListener("change", (event) =>
        changes.push((event as CustomEvent<{ value: string }>).detail.value),
      );

      listbox.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      await nextFrame();

      expect(none.active).toBe(true);
      expect(listbox.activeOptionId).toBe(none.optionId);
      const control = listbox.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement;
      expect(control.ariaActiveDescendantElement).toBe(none);

      listbox.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
      await nextFrame();

      expect(listbox.value).toBe("");
      expect(listbox.selectedValues).toEqual([""]);
      expect(none.selected).toBe(true);
      expect(changes).toEqual([""]);

      // selectionFollowsFocus commits an empty-value option too.
      const follow = await renderEmptyValueListbox((el) => {
        el.selectionFollowsFocus = true;
      });
      follow.listbox.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      await nextFrame();
      expect(follow.none.selected).toBe(true);
      expect(follow.listbox.selectedValues).toEqual([""]);
    });

    it("selects an empty-value option from an initial empty value and toggles it in multiple mode", async () => {
      const { listbox, none } = await renderEmptyValueListbox((el) => {
        el.value = "";
      });

      expect(none.selected).toBe(true);
      expect(listbox.selectedValues).toEqual([""]);

      const multi = await renderEmptyValueListbox((el) => {
        el.multiple = true;
      });
      multi.listbox.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      multi.listbox.handleKeydown(new KeyboardEvent("keydown", { key: " " }));
      await nextFrame();

      expect(multi.none.selected).toBe(true);
      expect(multi.listbox.selectedValues).toEqual([""]);

      // In multiple mode, selecting only the second duplicate empty option survives appending another row.
      const dupFirst = createOption("None 1", "") as VioletOption;
      const dupSecond = createOption("None 2", "") as VioletOption;
      multi.listbox.selectedValues = [];
      multi.listbox.replaceChildren(dupFirst, dupSecond);
      await nextFrame();
      dupSecond.shadowRoot?.querySelector<HTMLElement>('[part="control"]')?.click();
      await nextFrame();
      multi.listbox.append(createOption("Extra", "extra"));
      await nextFrame();
      expect(dupFirst.selected).toBe(false);
      expect(dupSecond.selected).toBe(true);
      expect(multi.listbox.selectedValues).toEqual([""]);

      // Parsed `<violet-option value="" selected>` is preserved on connect.
      document.body.innerHTML = `
                <violet-listbox>
                    <violet-option value="warm">Warm</violet-option>
                    <violet-option value="" selected>None</violet-option>
                </violet-listbox>
            `;
      await nextFrame();
      const parsed = document.body.querySelector("violet-listbox") as VioletListbox;
      const parsedNone = parsed.querySelectorAll("violet-option")[1] as VioletOption;
      expect(parsedNone.selected).toBe(true);
      expect(parsed.selectedValues).toEqual([""]);

      // Replacing rows keeps the matching activeValue active and single mode ignores multi selectedValues.
      parsed.activeValue = "warm";
      await nextFrame();
      const nextA = createOption("A", "a") as VioletOption;
      const nextWarm = createOption("Warm 2", "warm") as VioletOption;
      parsed.replaceChildren(nextA, nextWarm);
      await nextFrame();
      expect(parsed.activeValue).toBe("warm");
      expect(nextWarm.active).toBe(true);
      parsed.selectedValues = ["a", "warm"];
      await nextFrame();
      expect(parsed.options.filter((option) => option.selected).length).toBeLessThanOrEqual(1);
    });
  });
});
