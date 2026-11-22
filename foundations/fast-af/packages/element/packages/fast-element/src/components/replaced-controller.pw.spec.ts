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

    test("disconnects connected behaviors and aborts the old connect when the template is set mid-connect", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                FASTElementDefinition,
                Observable,
                html,
                uniqueElementName,
            } = await import("/main.js");

            const calls: string[] = [];
            const isConnectedLog: boolean[] = [];

            class MidConnectElement extends FASTElement {}

            const name = uniqueElementName();
            await FASTElement.define(MidConnectElement, { name });
            const definition = FASTElementDefinition.getByType(MidConnectElement)!;
            const element = document.createElement(name) as any;
            const first = element.$fastController;

            Observable.getNotifier(element).subscribe(
                {
                    handleChange(subject: any) {
                        isConnectedLog.push(subject.$fastController.isConnected);
                    },
                },
                "isConnected",
            );

            first.addBehavior({
                connectedCallback() {
                    calls.push("before:connect");
                },
                disconnectedCallback() {
                    calls.push("before:disconnect");
                },
            });

            first.addBehavior({
                connectedCallback() {
                    calls.push("trigger:connect");
                    definition.template = html`<span>ready</span>`;
                },
                disconnectedCallback() {
                    calls.push("trigger:disconnect");
                },
            });

            first.addBehavior({
                connectedCallback() {
                    calls.push("after:connect");
                },
                disconnectedCallback() {
                    calls.push("after:disconnect");
                },
            });

            document.body.append(element);

            const second = element.$fastController;
            const afterAppend = {
                replaced: second !== first,
                firstConnected: first.isConnected,
                secondConnected: second.isConnected,
                rendered: element.shadowRoot?.textContent,
                childCount: element.shadowRoot?.childNodes.length ?? 0,
                calls: [...calls],
                isConnectedLog: [...isConnectedLog],
                staleEmit: first.emit("stale", null),
                emitted: element.$emit("ok", 1),
            };

            element.remove();

            return {
                afterAppend,
                afterRemove: {
                    firstConnected: first.isConnected,
                    secondConnected: second.isConnected,
                    calls: [...calls],
                    isConnectedLog: [...isConnectedLog],
                },
            };
        });

        expect(result).toEqual({
            afterAppend: {
                replaced: true,
                firstConnected: false,
                secondConnected: true,
                rendered: "ready",
                childCount: 1,
                calls: [
                    "before:connect",
                    "trigger:connect",
                    "before:disconnect",
                    "trigger:disconnect",
                ],
                isConnectedLog: [true],
                staleEmit: false,
                emitted: true,
            },
            afterRemove: {
                firstConnected: false,
                secondConnected: false,
                calls: [
                    "before:connect",
                    "trigger:connect",
                    "before:disconnect",
                    "trigger:disconnect",
                ],
                isConnectedLog: [true, false],
            },
        });
    });

    test("unbinds the old view without throwing when a child element sets the template during shadow-DOM renderTemplate", async ({
        page,
    }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", error => {
            pageErrors.push(error.message);
        });

        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                FASTElementDefinition,
                Observable,
                Updates,
                html,
                uniqueElementName,
            } = await import("/main.js");

            const hostName = uniqueElementName();
            const childName = uniqueElementName();

            let hostDefinition: any;
            let oldBindingEvaluations = 0;

            class TriggerChild extends HTMLElement {
                connectedCallback() {
                    if (hostDefinition && hostDefinition.template === undefined) {
                        hostDefinition.template = html`<span>ready</span>`;
                    }
                }
            }
            customElements.define(childName, TriggerChild);

            class RenderMidConnectElement extends FASTElement {
                public value = "initial";
            }
            Observable.defineProperty(RenderMidConnectElement.prototype, "value");

            await FASTElement.define(RenderMidConnectElement, { name: hostName });
            hostDefinition = FASTElementDefinition.getByType(RenderMidConnectElement)!;

            const element = document.createElement(hostName) as any;
            const first = element.$fastController;
            first.template = html<RenderMidConnectElement>`${x => {
                oldBindingEvaluations++;
                return x.value;
            }}${html.partial(`<${childName}></${childName}>`)}`;

            document.body.append(element);

            const second = element.$fastController;
            const evalsAfterConnect = oldBindingEvaluations;

            element.value = "updated";
            await Updates.next();
            const evalsAfterMutation = oldBindingEvaluations;

            const rendered = element.shadowRoot?.textContent ?? "";
            const childCount = element.shadowRoot?.childNodes.length ?? 0;
            const firstConnected = first.isConnected;
            const secondConnected = second.isConnected;

            element.remove();

            return {
                replaced: second !== first,
                firstConnected,
                secondConnected,
                rendered,
                childCount,
                evalsAfterConnect,
                evalsAfterMutation,
            };
        });

        expect(pageErrors).toEqual([]);
        expect(result).toEqual({
            replaced: true,
            firstConnected: false,
            secondConnected: true,
            rendered: "ready",
            childCount: 1,
            evalsAfterConnect: 1,
            evalsAfterMutation: 1,
        });
    });

    test("keeps isConnected subscribers notified across controller replacement", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                FASTElementDefinition,
                Observable,
                Updates,
                html,
                uniqueElementName,
            } = await import("/main.js");

            // Case 1: element already connected when the late template arrives.
            class ConnectedLateElement extends FASTElement {}
            const connectedName = uniqueElementName();
            await FASTElement.define(ConnectedLateElement, { name: connectedName });
            const connectedDef = FASTElementDefinition.getByType(ConnectedLateElement)!;

            const connectedEl = document.createElement(connectedName) as any;
            document.body.append(connectedEl);
            const first = connectedEl.$fastController;

            const elementLog: boolean[] = [];
            const controllerLog: boolean[] = [];
            const bindingLog: boolean[] = [];

            const elementSub = {
                handleChange(subject: any) {
                    elementLog.push(subject.$fastController.isConnected);
                },
            };
            const controllerSub = {
                handleChange(subject: any) {
                    controllerLog.push(subject.$fastController.isConnected);
                },
            };

            Observable.getNotifier(connectedEl).subscribe(elementSub, "isConnected");
            Observable.getNotifier(first).subscribe(controllerSub, "isConnected");

            const binding = Observable.binding((el: any) => el.$fastController.isConnected);
            binding.subscribe({
                handleChange() {
                    bindingLog.push(binding.observe(connectedEl));
                },
            });
            const initialBinding = binding.observe(connectedEl);

            connectedDef.template = html`<span>ready</span>`;
            await Updates.next();
            const afterTemplate = {
                replaced: connectedEl.$fastController !== first,
                elementLog: [...elementLog],
                controllerLog: [...controllerLog],
                bindingLog: [...bindingLog],
            };

            connectedEl.remove();
            await Updates.next();
            const afterRemove = {
                elementLog: [...elementLog],
                controllerLog: [...controllerLog],
                bindingLog: [...bindingLog],
            };

            document.body.append(connectedEl);
            await Updates.next();
            const afterReconnect = {
                elementLog: [...elementLog],
                controllerLog: [...controllerLog],
                bindingLog: [...bindingLog],
            };

            // Unsubscribing through either the old controller or the element's
            // current notifier stops further notifications.
            first.unsubscribe(controllerSub, "isConnected");
            Observable.getNotifier(connectedEl).unsubscribe(elementSub, "isConnected");
            binding.dispose();

            connectedEl.remove();
            await Updates.next();
            const afterUnsubscribeRemove = {
                elementLog: [...elementLog],
                controllerLog: [...controllerLog],
                bindingLog: [...bindingLog],
            };

            // Case 2: detached element subscribed before the late template arrives.
            class DetachedLateElement extends FASTElement {}
            const detachedName = uniqueElementName();
            await FASTElement.define(DetachedLateElement, { name: detachedName });
            const detachedDef = FASTElementDefinition.getByType(DetachedLateElement)!;

            const detachedEl = document.createElement(detachedName) as any;
            const detachedLog: boolean[] = [];
            Observable.getNotifier(detachedEl).subscribe(
                {
                    handleChange(subject: any) {
                        detachedLog.push(subject.$fastController.isConnected);
                    },
                },
                "isConnected",
            );

            detachedDef.template = html`<span>later</span>`;
            const detachedAfterTemplate = [...detachedLog];

            document.body.append(detachedEl);
            const detachedAfterAppend = [...detachedLog];

            detachedEl.remove();
            const detachedAfterRemove = [...detachedLog];

            return {
                initialBinding,
                afterTemplate,
                afterRemove,
                afterReconnect,
                afterUnsubscribeRemove,
                detachedAfterTemplate,
                detachedAfterAppend,
                detachedAfterRemove,
            };
        });

        expect(result).toEqual({
            initialBinding: true,
            afterTemplate: {
                replaced: true,
                elementLog: [false, true],
                controllerLog: [false, true],
                bindingLog: [true],
            },
            afterRemove: {
                elementLog: [false, true, false],
                controllerLog: [false, true, false],
                bindingLog: [true, false],
            },
            afterReconnect: {
                elementLog: [false, true, false, true],
                controllerLog: [false, true, false, true],
                bindingLog: [true, false, true],
            },
            afterUnsubscribeRemove: {
                elementLog: [false, true, false, true],
                controllerLog: [false, true, false, true],
                bindingLog: [true, false, true],
            },
            detachedAfterTemplate: [],
            detachedAfterAppend: [true],
            detachedAfterRemove: [true, false],
        });
    });
});
