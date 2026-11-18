import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, userEvent } from "vitest/browser";

import "../option/violet-option";
import "../option-group/violet-option-group";
import "./violet-select";
import type { VioletSelect } from "./violet-select";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
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
        nodes: { role?: { value: string }; name?: { value: string }; properties?: { name: string }[] }[];
    };
    return nodes
        .filter(node => node.properties?.some(property => property.name === "hasPopup"))
        .map(node => node.name?.value ?? "");
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
    select.append(createOption("Broadcast", "broadcast"), createOption("Direct", "direct"), createOption("Transplant", "transplant"));
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
            "Expected select listbox to render."
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
            "Expected select listbox to render."
        );
        openListbox.dispatchEvent(forwardTab);
        expect(forwardTab.defaultPrevented).toBe(false);
        openListbox.dispatchEvent(
            new FocusEvent("focusout", {
                bubbles: true,
                composed: true,
                relatedTarget: after,
            })
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
            "Expected select listbox to render after reopening."
        );
        reopenedListbox.dispatchEvent(reverseTab);
        expect(reverseTab.defaultPrevented).toBe(false);
        reopenedListbox.dispatchEvent(
            new FocusEvent("focusout", {
                bubbles: true,
                composed: true,
                relatedTarget: before,
            })
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
            "Expected select listbox to render after opening."
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
            "Expected select listbox to render for focus transfer."
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
                .map(id => select.shadowRoot?.getElementById(id)?.textContent?.trim() ?? "")
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
            const optionsFirst = await mount("", [createOption("Label A", "a"), createOption("Label B", "b")]);
            optionsFirst.value = "b";
            const valueFirst = await mount("b", []);
            expect(displayed(valueFirst).text).toBe("b");

            valueFirst.append(createOption("Label A", "a"), createOption("Label B", "b"));

            await vi.waitFor(() => expect(displayed(valueFirst)).toEqual(displayed(optionsFirst)));
            expect(displayed(valueFirst)).toEqual({ text: "Label B", name: "Propagation Label B" });
            await vi.waitFor(
                async () => expect(await triggerNames()).toEqual(["Propagation Label B", "Propagation Label B"]),
                { timeout: 5000 }
            );
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
            await vi.waitFor(() => expect(displayed(select)).toEqual({ text: "Renamed B", name: "Propagation Renamed B" }));
            await vi.waitFor(async () => expect(await triggerNames()).toEqual(["Propagation Renamed B"]), {
                timeout: 5000,
            });

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
});
