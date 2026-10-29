import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "../button/violet-button";
import "./violet-menu";
import "./violet-menu-item";
import type { VioletMenu } from "./violet-menu";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderMenu(template: string): Promise<VioletMenu> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-menu");
    await nextFrame();
    return document.querySelector("violet-menu") as VioletMenu;
}

describe("violet-menu", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("syncs menu trigger aria relationships", async () => {
        const menu = await renderMenu(`
            <violet-menu label="Actions">
                <button slot="trigger" type="button">Open</button>
                <violet-menu-item>First</violet-menu-item>
            </violet-menu>
        `);

        const trigger = menu.querySelector('[slot="trigger"]');
        expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
        expect(trigger?.getAttribute("aria-expanded")).toBe("false");
        expect(trigger?.getAttribute("aria-controls")).toBe(menu.panelId);
    });

    it("forwards menu trigger aria relationships to a violet-button control", async () => {
        const menu = await renderMenu(`
            <violet-menu label="Actions">
                <violet-button slot="trigger">Open</violet-button>
                <violet-menu-item>First</violet-menu-item>
            </violet-menu>
        `);

        const trigger = menu.querySelector("violet-button");
        const control = trigger?.shadowRoot?.querySelector("button");

        expect(control?.getAttribute("aria-haspopup")).toBe("menu");
        expect(control?.getAttribute("aria-expanded")).toBe("false");
        expect(control?.getAttribute("aria-controls")).toBe(menu.panelId);

        control?.click();
        await nextFrame();

        expect(menu.open).toBe(true);
        expect(trigger?.getAttribute("aria-expanded")).toBe("true");
        expect(trigger?.ariaExpanded).toBe("true");
        expect(control?.getAttribute("aria-expanded")).toBe("true");

        control?.click();
        await nextFrame();

        expect(menu.open).toBe(false);
        expect(control?.getAttribute("aria-expanded")).toBe("false");
    });

    it.each([false, true])("returns invocation focus unless the action moved it (moved: %s)", async moved => {
        const menu = await renderMenu(`
            <violet-menu label="Actions">
                <violet-button slot="trigger">Open</violet-button>
                <violet-menu-item>First</violet-menu-item>
            </violet-menu>
        `);
        const wrapper = document.createElement("div");
        const shadow = wrapper.attachShadow({ mode: "open" });
        shadow.append(menu);
        const destination = document.createElement("button");
        destination.textContent = "Action destination";
        shadow.append(destination);
        document.body.append(wrapper);
        await nextFrame();
        const trigger = menu.querySelector("violet-button")!;
        const control = trigger.shadowRoot!.querySelector("button")!;
        const item = menu.querySelector("violet-menu-item")!;
        control.click();
        await nextFrame();
        await nextFrame();
        expect(shadow.activeElement).toBe(item);
        if (moved) {
            menu.addEventListener("invoke", () => destination.focus(), { capture: true, once: true });
        }
        item.shadowRoot!.querySelector<HTMLElement>(".control")!.click();
        await nextFrame();
        expect(menu.open).toBe(false);
        expect(shadow.activeElement).toBe(moved ? destination : trigger);
        if (!moved) expect(trigger.shadowRoot!.activeElement).toBe(control);
    });

    it("opens from the trigger click", async () => {
        const menu = await renderMenu(`
            <violet-menu label="Actions">
                <button slot="trigger" type="button">Open</button>
                <violet-menu-item>First</violet-menu-item>
            </violet-menu>
        `);

        (menu.querySelector('[slot="trigger"]') as HTMLButtonElement | null)?.click();
        await nextFrame();

        expect(menu.open).toBe(true);
        expect(menu.shadowRoot?.querySelector(".panel")?.matches(":popover-open")).toBe(true);
    });

    it("clears the pending type-ahead timer when removed", async () => {
        const menu = await renderMenu(`
            <violet-menu label="Actions">
                <button slot="trigger" type="button">Open</button>
                <violet-menu-item>Alpha</violet-menu-item>
                <violet-menu-item>Beta</violet-menu-item>
            </violet-menu>
        `);

        menu.show();
        await nextFrame();

        const clearSpy = vi.spyOn(window, "clearTimeout");
        menu.handlePanelKeydown(new KeyboardEvent("keydown", { key: "b", cancelable: true }));
        clearSpy.mockClear();

        menu.remove();

        expect(clearSpy).toHaveBeenCalledTimes(1);
        clearSpy.mockRestore();
    });

    it("keeps keyboard-open focus on the requested item after the toggle settles", async () => {
        const menu = await renderMenu(`
            <violet-menu label="Actions">
                <button slot="trigger" type="button">Open</button>
                <violet-menu-item>First</violet-menu-item>
                <violet-menu-item>Second</violet-menu-item>
                <violet-menu-item>Third</violet-menu-item>
            </violet-menu>
        `);
        const trigger = menu.querySelector<HTMLButtonElement>('[slot="trigger"]')!;
        const items = menu.querySelectorAll("violet-menu-item");

        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
        await nextFrame();
        await nextFrame();
        await nextFrame();

        expect(menu.open).toBe(true);
        expect(document.activeElement).toBe(items[2]);
    });

    describe("keyboard (real key presses)", () => {
        const threeItems = `
            <violet-menu label="Actions">
                <button slot="trigger" type="button">Open</button>
                <violet-menu-item>First</violet-menu-item>
                <violet-menu-item>Second</violet-menu-item>
                <violet-menu-item>Third</violet-menu-item>
            </violet-menu>
            <button id="after" type="button">After</button>
        `;

        async function settle(): Promise<void> {
            await nextFrame();
            await nextFrame();
            await nextFrame();
        }

        it("keeps a second ArrowDown pressed straight after the opening one", async () => {
            const menu = await renderMenu(threeItems);
            const items = menu.querySelectorAll("violet-menu-item");
            const invoked: EventTarget[] = [];
            menu.addEventListener("invoke", event => invoked.push(event.target!));
            menu.querySelector<HTMLButtonElement>('[slot="trigger"]')!.focus();

            await userEvent.keyboard("{ArrowDown}{ArrowDown}");
            await settle();
            expect(menu.open).toBe(true);
            expect(document.activeElement).toBe(items[1]);

            await userEvent.keyboard("{Enter}");
            expect(invoked).toEqual([items[1]]);
        });

        it("keeps a second ArrowDown pressed in the frame after the opening one", async () => {
            const menu = await renderMenu(threeItems);
            const items = menu.querySelectorAll("violet-menu-item");
            menu.querySelector<HTMLButtonElement>('[slot="trigger"]')!.focus();

            await userEvent.keyboard("{ArrowDown}");
            await nextFrame();
            await userEvent.keyboard("{ArrowDown}");
            await settle();

            expect(document.activeElement).toBe(items[1]);
        });

        it("keeps a second ArrowUp pressed straight after the opening one", async () => {
            const menu = await renderMenu(threeItems);
            const items = menu.querySelectorAll("violet-menu-item");
            menu.querySelector<HTMLButtonElement>('[slot="trigger"]')!.focus();

            await userEvent.keyboard("{ArrowUp}{ArrowUp}");
            await settle();

            expect(document.activeElement).toBe(items[1]);
        });

        it("moves through the items when an arrow key reaches the trigger of an open menu", async () => {
            const menu = await renderMenu(threeItems);
            const items = menu.querySelectorAll("violet-menu-item");
            const trigger = menu.querySelector<HTMLButtonElement>('[slot="trigger"]')!;

            menu.show();
            trigger.focus();
            await userEvent.keyboard("{ArrowDown}");
            await settle();

            expect(document.activeElement).toBe(items[0]);
        });

        it("lets Tab leave the trigger", async () => {
            const menu = await renderMenu(threeItems);
            menu.querySelector<HTMLButtonElement>('[slot="trigger"]')!.focus();

            await userEvent.tab();

            expect(menu.open).toBe(false);
            expect(document.activeElement?.id).toBe("after");
        });

        it("closes on Tab and moves focus past the menu", async () => {
            const menu = await renderMenu(threeItems);
            menu.querySelector<HTMLButtonElement>('[slot="trigger"]')!.focus();
            await userEvent.keyboard("{ArrowDown}");
            await settle();

            await userEvent.tab();
            await settle();

            expect(menu.open).toBe(false);
            expect(document.activeElement?.id).toBe("after");
        });
    });

    describe("native key handling", () => {
        const template = `
            <violet-menu label="Actions">
                <button slot="trigger" type="button">Open</button>
                <violet-menu-item>First</violet-menu-item>
                <violet-menu-item>Second</violet-menu-item>
            </violet-menu>
        `;

        it("does not cancel Tab or unrelated keys on the trigger", async () => {
            const menu = await renderMenu(template);
            const trigger = menu.querySelector<HTMLButtonElement>('[slot="trigger"]')!;
            const press = (key: string) => {
                const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
                trigger.dispatchEvent(event);
                return event;
            };

            expect(press("Tab").defaultPrevented).toBe(false);
            expect(press("Enter").defaultPrevented).toBe(false);
            expect(press("ArrowDown").defaultPrevented).toBe(true);
        });

        it("lets Tab through inside the panel while still cancelling navigation keys", async () => {
            const menu = await renderMenu(template);
            menu.show();
            await nextFrame();
            const panel = menu.shadowRoot?.querySelector(".panel") as HTMLElement;
            const press = (key: string) => {
                const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
                panel.dispatchEvent(event);
                return event;
            };

            expect(press("Tab").defaultPrevented).toBe(false);
            menu.show();
            await nextFrame();
            expect(press("ArrowDown").defaultPrevented).toBe(true);
        });
    });
});
