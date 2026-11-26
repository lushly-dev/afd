import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "../option/violet-option.define";
import "../option-group/violet-option-group.define";
import "./violet-select.define";
import type { VioletOption } from "../option/violet-option";
import type { VioletSelect } from "./violet-select";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForShadow<T>(get: () => T | null, description: string): Promise<T> {
  return vi.waitFor(() => {
    const value = get();
    expect(value, description).not.toBeNull();
    return value as T;
  });
}

interface FrameTree {
  frame: { id: string; url: string };
  childFrames?: FrameTree[];
}

function findFrame(tree: FrameTree, url: string): string | undefined {
  if (tree.frame.url === url) {
    return tree.frame.id;
  }
  for (const child of tree.childFrames ?? []) {
    const found = findFrame(child, url);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * The names of the triggers in Chromium's accessibility tree, which resolves
 * aria-labelledby as assistive technology does.
 */
async function triggerNames(): Promise<string[]> {
  const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
  // Each spec runs in a frame of the runner's page; read that frame's tree, found by its URL.
  const { frameTree } = (await session.send("Page.getFrameTree")) as { frameTree: FrameTree };
  const frameId = findFrame(frameTree, location.href);
  const { nodes } = (await session.send("Accessibility.getFullAXTree", { frameId })) as {
    nodes: {
      role?: { value: string };
      name?: { value: string };
      properties?: { name: string }[];
    }[];
  };
  return nodes
    .filter((node) => node.properties?.some((property) => property.name === "hasPopup"))
    .map((node) => node.name?.value ?? "");
}

function createOption(label: string, value: string): HTMLElement {
  const option = document.createElement("violet-option");
  option.setAttribute("value", value);
  option.textContent = label;
  return option;
}

async function renderSelect(): Promise<VioletSelect> {
  document.body.innerHTML = "";
  const select = document.createElement("violet-select") as VioletSelect;
  select.label = "Propagation";
  select.supportingText = "Choose a default path.";
  select.value = "direct";
  select.append(
    createOption("Broadcast", "broadcast"),
    createOption("Direct", "direct"),
    createOption("Transplant", "transplant"),
  );
  document.body.append(select);
  await customElements.whenDefined("violet-select");
  await nextFrame();
  return select;
}

describe("violet-select", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reflects the selected option label in the trigger text", async () => {
    const select = await renderSelect();
    expect(select.selectedLabel).toBe("Direct");
  });

  // #712: a position: fixed panel is placed against a containing ancestor (contain, transform),
  // not the viewport, so the list opened away from its trigger inside one.
  it("opens its list beside the trigger inside a contained, transformed ancestor", async () => {
    document.body.innerHTML = "";
    const mount = document.createElement("div");
    mount.style.cssText =
      "contain: content; transform: translateX(0); margin: 120px 0 0 80px; padding: 40px; overflow: hidden; block-size: 60px;";
    document.body.append(mount);
    const select = document.createElement("violet-select") as VioletSelect;
    select.label = "Propagation";
    select.append(createOption("Broadcast", "broadcast"), createOption("Direct", "direct"));
    mount.append(select);
    await customElements.whenDefined("violet-select");
    await nextFrame();

    select.show();
    const trigger = select.shadowRoot?.querySelector(".trigger") as HTMLElement;
    const panel = select.shadowRoot?.querySelector(".panel") as HTMLElement;
    // Placed as it opens, before any frame.
    expect(
      Math.abs(panel.getBoundingClientRect().left - trigger.getBoundingClientRect().left),
    ).toBeLessThanOrEqual(1);
    await nextFrame();
    await nextFrame();
    await nextFrame();

    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    expect(Math.abs(panelRect.top - triggerRect.bottom)).toBeLessThanOrEqual(2);
    expect(Math.abs(panelRect.left - triggerRect.left)).toBeLessThanOrEqual(1);
    // Above the mount's clip: a pointer on the list reaches the select's options.
    const hit = document.elementFromPoint(panelRect.left + 12, panelRect.top + 16);
    expect(hit?.closest("violet-select")).toBe(select);
    expect(panel.matches(":popover-open")).toBe(true);

    select.hide();
    await nextFrame();
    expect(panel.matches(":popover-open")).toBe(false);
    expect(panel.hidden).toBe(true);
  });

  // #712: show() did not resync the options, so a reopened list kept the row last made active.
  it("makes the chosen option active again when the list reopens", async () => {
    const select = await renderSelect();
    select.show();
    select.handleListboxKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await nextFrame();
    expect(select.activeValue).toBe("transplant");
    select.handleListboxKeydown(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextFrame();
    expect(select.open).toBe(false);

    select.show();
    await nextFrame();
    const options = Array.from(select.querySelectorAll("violet-option"));
    expect(select.activeValue).toBe("direct");
    expect(options.map((option) => option.hasAttribute("active"))).toEqual([false, true, false]);
  });

  it("commits the active option and closes", async () => {
    const select = await renderSelect();
    select.show();
    select.handleListboxKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    select.handleListboxKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
    await nextFrame();

    expect(select.value).toBe("transplant");
    expect(select.open).toBe(false);
  });

  it("keeps native keyboard defaults while opening and selecting through rendered bindings", async () => {
    const select = await renderSelect();
    const before = document.createElement("button");
    before.textContent = "Before";
    const after = document.createElement("button");
    after.textContent = "After";
    document.body.prepend(before);
    document.body.append(after);

    const trigger = select.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");

    if (!trigger) {
      throw new Error("Expected select trigger to render.");
    }
    expect(trigger?.getAttribute("aria-labelledby")).toContain(select.valueId);
    expect(trigger?.textContent).toContain("Direct");

    trigger.focus();
    const character = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "x",
    });
    trigger.dispatchEvent(character);
    expect(character.defaultPrevented).toBe(false);

    const openWithSpace = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: " ",
    });
    trigger.dispatchEvent(openWithSpace);
    expect(openWithSpace.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(select.open).toBe(true));
    expect(select.open).toBe(true);

    const listbox = await waitForShadow(
      () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
      "Expected select listbox to render.",
    );
    listbox.focus();
    const moveDown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "ArrowDown",
    });
    listbox.dispatchEvent(moveDown);
    expect(moveDown.defaultPrevented).toBe(true);
    const commit = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "Enter",
    });
    listbox.dispatchEvent(commit);
    expect(commit.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(select.open).toBe(false));

    expect(select.value).toBe("transplant");
    expect(select.open).toBe(false);
    expect(select.shadowRoot?.activeElement).toBe(trigger);

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await vi.waitFor(() => expect(select.open).toBe(true));
    expect(select.open).toBe(true);
    const forwardTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "Tab",
    });
    const openListbox = await waitForShadow(
      () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
      "Expected select listbox to render.",
    );
    openListbox.dispatchEvent(forwardTab);
    expect(forwardTab.defaultPrevented).toBe(false);
    openListbox.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        composed: true,
        relatedTarget: after,
      }),
    );
    after.focus();
    await nextFrame();
    expect(select.open).toBe(false);
    expect(document.activeElement).toBe(after);

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await vi.waitFor(() => expect(select.open).toBe(true));
    const reverseTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "Tab",
      shiftKey: true,
    });
    const reopenedListbox = await waitForShadow(
      () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
      "Expected select listbox to render after reopening.",
    );
    reopenedListbox.dispatchEvent(reverseTab);
    expect(reverseTab.defaultPrevented).toBe(false);
    reopenedListbox.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        composed: true,
        relatedTarget: before,
      }),
    );
    before.focus();
    await nextFrame();
    expect(select.open).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it("passes composing shortcut keys through the rendered trigger and listbox", async () => {
    const select = await renderSelect();
    const trigger = select.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");

    if (!trigger) {
      throw new Error("Expected select trigger to render.");
    }
    trigger.focus();

    const triggerEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      isComposing: true,
      key: "ArrowDown",
    });
    trigger.dispatchEvent(triggerEvent);
    expect(triggerEvent.defaultPrevented).toBe(false);
    expect(select.open).toBe(false);

    const composingEnter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      isComposing: true,
      key: "Enter",
    });
    trigger.dispatchEvent(composingEnter);
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(select.open).toBe(false);

    const openWithEnter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "Enter",
    });
    trigger.dispatchEvent(openWithEnter);
    expect(openWithEnter.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(select.open).toBe(true));
    const listbox = await waitForShadow(
      () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
      "Expected select listbox to render after opening.",
    );
    listbox.focus();

    const listboxEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "ArrowDown",
    });
    Object.defineProperty(listboxEvent, "keyCode", { value: 229 });
    listbox.dispatchEvent(listboxEvent);
    expect(listboxEvent.defaultPrevented).toBe(false);
    expect(select.activeValue).toBe("direct");
  });

  it("closes on outside focus while keeping internal focus transfers open", async () => {
    const select = await renderSelect();
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);

    const trigger = select.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
    if (!trigger) {
      throw new Error("Expected select trigger to render.");
    }

    await userEvent.click(trigger);
    await vi.waitFor(() => expect(select.open).toBe(true));
    const listbox = await waitForShadow(
      () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
      "Expected select listbox to render for focus transfer.",
    );
    listbox.focus();
    trigger.focus();
    expect(select.open).toBe(true);

    const outsideFocusOut = new FocusEvent("focusout", {
      bubbles: true,
      composed: true,
      relatedTarget: outside,
    });
    trigger.dispatchEvent(outsideFocusOut);
    await nextFrame();
    expect(select.open).toBe(false);
  });

  describe("options that arrive after the value (#499)", () => {
    // The trigger is labelled by the value element, so its text is the
    // trigger's accessible name alongside the field label.
    function displayed(select: VioletSelect): { text: string; name: string } {
      const trigger = select.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
      const ids = trigger?.getAttribute("aria-labelledby")?.split(" ") ?? [];
      const name = ids
        .map((id) => select.shadowRoot?.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ");
      const text = select.shadowRoot?.getElementById(select.valueId)?.textContent?.trim() ?? "";
      return { text, name };
    }

    async function mount(value: string, options: HTMLElement[]): Promise<VioletSelect> {
      const select = document.createElement("violet-select") as VioletSelect;
      select.label = "Propagation";
      select.value = value;
      select.append(...options);
      document.body.append(select);
      await nextFrame();
      return select;
    }

    it("shows the same label whether the value was set before or after the options", async () => {
      const optionsFirst = await mount("", [
        createOption("Label A", "a"),
        createOption("Label B", "b"),
      ]);
      optionsFirst.value = "b";
      const valueFirst = await mount("b", []);
      expect(displayed(valueFirst).text).toBe("b");

      valueFirst.append(createOption("Label A", "a"), createOption("Label B", "b"));

      await vi.waitFor(() => expect(displayed(valueFirst)).toEqual(displayed(optionsFirst)));
      expect(displayed(valueFirst)).toEqual({ text: "Label B", name: "Propagation Label B" });
      if (isChromium) {
        await vi.waitFor(
          async () =>
            expect(await triggerNames()).toEqual(["Propagation Label B", "Propagation Label B"]),
          { timeout: 5000 },
        );
      }
    });

    it("follows options added inside a group", async () => {
      const select = await mount("b", []);
      const group = document.createElement("violet-option-group");
      select.append(group);
      group.append(createOption("Label B", "b"));

      await vi.waitFor(() => expect(displayed(select).text).toBe("Label B"));
    });

    it("follows a change to the selected option's label text", async () => {
      const option = createOption("Label B", "b");
      const select = await mount("b", [option]);
      expect(displayed(select).text).toBe("Label B");

      option.textContent = "Renamed B";
      await vi.waitFor(() =>
        expect(displayed(select)).toEqual({ text: "Renamed B", name: "Propagation Renamed B" }),
      );
      if (isChromium) {
        await vi.waitFor(
          async () => expect(await triggerNames()).toEqual(["Propagation Renamed B"]),
          {
            timeout: 5000,
          },
        );
      }

      (option.firstChild as Text).data = "Edited B";
      await vi.waitFor(() => expect(displayed(select).text).toBe("Edited B"));

      option.setAttribute("label", "Attribute B");
      await vi.waitFor(() => expect(displayed(select).text).toBe("Attribute B"));
    });

    it("follows an option whose value changes to the chosen one", async () => {
      const option = createOption("Label B", "other");
      const select = await mount("b", [option]);
      expect(displayed(select).text).toBe("b");

      option.setAttribute("value", "b");
      await vi.waitFor(() => expect(displayed(select).text).toBe("Label B"));
    });
  });

  it("shrinks inside 1fr grid tracks and a 120px column without overflowing (#1587)", async () => {
    document.body.innerHTML = `
            <div id="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:296px">
                <violet-select id="first" label="First"><violet-option>A very long option label</violet-option></violet-select>
                <violet-select id="last" label="Last"><violet-option>Another very long option label</violet-option></violet-select>
            </div>
            <div style="width:120px;display:grid;grid-template-columns:1fr">
                <violet-select id="single" label="Size"><violet-option selected>Extra extra large size</violet-option></violet-select>
            </div>
        `;
    await customElements.whenDefined("violet-select");
    await nextFrame();

    const grid = document.getElementById("grid") as HTMLElement;
    const first = document.getElementById("first") as VioletSelect;
    const last = document.getElementById("last") as VioletSelect;
    const single = document.getElementById("single") as VioletSelect;

    expect(first.getBoundingClientRect().width).toBeLessThanOrEqual(144.5);
    expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(
      grid.getBoundingClientRect().right + 0.5,
    );
    expect(single.getBoundingClientRect().width).toBeLessThanOrEqual(120.5);
    const singleTrigger = single.shadowRoot?.querySelector(".trigger") as HTMLElement;
    expect(singleTrigger.getBoundingClientRect().width).toBeLessThanOrEqual(120.5);
  });

  describe("empty-value options (#2235)", () => {
    function renderEmptyValueForm(
      configure?: (select: VioletSelect, options: VioletOption[]) => void,
    ) {
      document.body.innerHTML = "";
      const form = document.createElement("form");
      const select = document.createElement("violet-select") as VioletSelect;
      select.name = "tone";
      select.label = "Tone";
      select.placeholder = "Pick a tone";
      const warm = createOption("Warm", "warm") as VioletOption;
      const none = createOption("None", "") as VioletOption;
      const cold = createOption("Cold", "cold") as VioletOption;
      select.append(warm, none, cold);
      configure?.(select, [warm, none, cold]);
      form.append(select);
      document.body.append(form);
      return { form, select, options: [warm, none, cold] as const };
    }

    it("activates, chooses, displays in the trigger and submits an empty-value option", async () => {
      const { form, select, options } = renderEmptyValueForm();
      const [, none] = options;
      await customElements.whenDefined("violet-select");
      await nextFrame();

      // Nothing chosen yet: placeholder shows and the form gets no entry.
      const valueEl = select.shadowRoot?.getElementById(select.valueId) as HTMLElement;
      expect(valueEl.dataset.placeholder).toBe("true");
      expect(valueEl.textContent?.trim()).toBe("Pick a tone");
      expect(new FormData(form).has("tone")).toBe(false);

      // Navigate to the empty-value option from the keyboard and commit with Enter.
      const changes: string[] = [];
      select.addEventListener("change", (event) =>
        changes.push((event as CustomEvent<{ value: string }>).detail.value),
      );
      select.show();
      await nextFrame();
      select.handleListboxKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      await nextFrame();

      expect(none.active).toBe(true);
      expect(select.activeOptionId).toBe(none.optionId);
      const listbox = select.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement;
      expect(listbox.ariaActiveDescendantElement).toBe(none);

      select.handleListboxKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
      await nextFrame();

      expect(select.open).toBe(false);
      expect(select.value).toBe("");
      expect(select.selectedLabel).toBe("None");
      expect(none.selected).toBe(true);
      expect(valueEl.dataset.placeholder).toBe("false");
      expect(valueEl.textContent?.trim()).toBe("None");
      expect(changes).toEqual([""]);
      expect(new FormData(form).has("tone")).toBe(true);
      expect(new FormData(form).get("tone")).toBe("");

      // Reopening highlights the chosen empty-value option, not the first option.
      select.show();
      await nextFrame();
      expect(none.active).toBe(true);
      expect(options[0].active).toBe(false);
    });

    it("selects an empty-value option when value is set to empty string before connect or via selected", async () => {
      const { form, select, options } = renderEmptyValueForm((el) => {
        el.value = "";
      });
      const [, none] = options;
      await customElements.whenDefined("violet-select");
      await nextFrame();

      expect(select.value).toBe("");
      expect(select.selectedLabel).toBe("None");
      expect(none.selected).toBe(true);
      expect(new FormData(form).get("tone")).toBe("");

      select.selectValue("cold");
      await nextFrame();
      expect(new FormData(form).get("tone")).toBe("cold");

      form.reset();
      await nextFrame();
      expect(select.value).toBe("");
      expect(select.selectedLabel).toBe("None");
      expect(none.selected).toBe(true);
      expect(new FormData(form).get("tone")).toBe("");

      // Parsed markup with `<violet-option value="" selected>` selects the empty option on connect.
      document.body.innerHTML = `
                <form>
                    <violet-select name="tone" label="Tone" required>
                        <violet-option value="warm">Warm</violet-option>
                        <violet-option value="" selected>None</violet-option>
                    </violet-select>
                </form>
            `;
      await nextFrame();
      const parsedForm = document.body.querySelector("form") as HTMLFormElement;
      const parsedSelect = parsedForm.querySelector("violet-select") as VioletSelect;
      const parsedNone = parsedSelect.querySelectorAll("violet-option")[1] as VioletOption;
      expect(parsedNone.selected).toBe(true);
      expect(parsedSelect.selectedLabel).toBe("None");
      expect(parsedSelect.checkValidity()).toBe(true);
      expect(new FormData(parsedForm).get("tone")).toBe("");

      // Clicking a second option with the same empty value selects the clicked option, not the first.
      const secondNone = createOption("Unset", "") as VioletOption;
      parsedSelect.append(secondNone);
      await nextFrame();
      parsedSelect.show();
      secondNone.shadowRoot?.querySelector<HTMLElement>('[part="control"]')?.click();
      await nextFrame();
      expect(secondNone.selected).toBe(true);
      expect(parsedNone.selected).toBe(false);
      expect(parsedSelect.selectedLabel).toBe("Unset");

      // Renaming a derived-value option updates both the displayed label and submitted value.
      const derived = document.createElement("violet-option") as VioletOption;
      derived.textContent = "Apple";
      parsedSelect.append(derived);
      await nextFrame();
      parsedSelect.selectValue("Apple");
      await nextFrame();
      expect(new FormData(parsedForm).get("tone")).toBe("Apple");
      derived.textContent = "Pear";
      await vi.waitFor(() => expect(parsedSelect.selectedLabel).toBe("Pear"));
      expect(new FormData(parsedForm).get("tone")).toBe("Pear");

      // Selecting an empty-value option via `value = ""` on a required invalid select clears the rendered error.
      document.body.innerHTML = `
                <violet-select name="tone" label="Tone" required invalid>
                    <violet-option value="">None</violet-option>
                    <violet-option value="warm">Warm</violet-option>
                </violet-select>
            `;
      await nextFrame();
      const requiredSelect = document.body.querySelector("violet-select") as VioletSelect;
      expect(requiredSelect.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Please select an option.",
      );
      requiredSelect.value = "";
      await nextFrame();
      expect(requiredSelect.shadowRoot?.querySelector(".error")).toBeNull();
    });
  });
});
