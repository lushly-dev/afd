import { expect, test } from "@playwright/test";

// A FAST-AF fix: Microsoft FAST leaves the controller that a late template replaces
// connected, so the behaviors it connected are never disconnected.
test.describe("a controller replaced when a late template arrives", () => {
    test("is disconnected, with its host behaviors, before the new one connects", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const { FASTElement, FASTElementDefinition, html, uniqueElementName } =
                await import("/main.js");

            const calls: string[] = [];
            const behavior = {
                connectedCallback() {
                    calls.push("connected");
                },
                disconnectedCallback() {
                    calls.push("disconnected");
                },
            };

            class LateElement extends FASTElement {}

            // No template yet, as for a declarative element whose <f-template>
            // arrives after the element has connected.
            const name = uniqueElementName();
            await FASTElement.define(LateElement, { name });
            const element = document.createElement(name) as any;
            document.body.append(element);

            const first = element.$fastController;
            first.addBehavior(behavior);
            const beforeTemplate = [...calls];

            FASTElementDefinition.getByType(LateElement).template =
                html`<span>ready</span>`;

            const second = element.$fastController;
            const afterTemplate = [...calls];

            let received: CustomEvent | undefined;
            element.parentElement.addEventListener("saved", (event: Event) => {
                received = event as CustomEvent;
            });
            const staleEmit = first.emit("stale", null);
            const emitted = element.$emit("saved", { value: 1 });
            // Options override the defaults, as in Microsoft FAST Element 3.1.4.
            let local: CustomEvent | undefined;
            element.addEventListener("local", (event: Event) => {
                local = event as CustomEvent;
            });
            element.$emit("local", "kept", { bubbles: false, composed: false });
            const firstConnected = first.isConnected;
            const secondConnected = second.isConnected;

            element.remove();

            return {
                replaced: second !== first,
                rendered: element.shadowRoot?.textContent,
                firstConnected,
                secondConnected,
                beforeTemplate,
                afterTemplate,
                afterRemove: [...calls],
                staleEmit,
                emitted,
                detail: received?.detail,
                bubbles: received?.bubbles,
                composed: received?.composed,
                local: [local?.detail, local?.bubbles, local?.composed],
            };
        });

        expect(result).toEqual({
            replaced: true,
            rendered: "ready",
            firstConnected: false,
            secondConnected: true,
            beforeTemplate: ["connected"],
            afterTemplate: ["connected", "disconnected"],
            afterRemove: ["connected", "disconnected"],
            staleEmit: false,
            emitted: true,
            detail: { value: 1 },
            bubbles: true,
            composed: true,
            local: ["kept", false, false],
        });
    });
});
