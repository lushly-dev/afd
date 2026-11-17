import { expect, test } from "@playwright/test";

test.describe("scoped custom element registries", () => {
    test("defines a composed FAST child in a scoped registry through its definition", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                FASTElementDefinition,
                ensureScopedRegistrySupport,
                fastElementRegistry,
                html,
                uniqueElementName,
            } = await import("/main.js");

            await ensureScopedRegistrySupport();

            class FastChildElement extends FASTElement {}
            class HostElement extends FASTElement {}

            const childName = uniqueElementName();
            const definition = await FASTElementDefinition.compose(FastChildElement, {
                name: childName,
                template: html`child`,
            });
            const registry = new CustomElementRegistry();
            definition.define(registry);

            const hostName = uniqueElementName();
            await FASTElement.define(HostElement, {
                name: hostName,
                template: html`${html.partial(`<${childName}></${childName}>`)}`,
                shadowOptions: { mode: "open", customElementRegistry: registry },
            });

            const host = document.createElement(hostName);
            document.body.append(host);
            const child = host.shadowRoot!.querySelector(childName) as any;
            const output = {
                definitionReused:
                    fastElementRegistry.getByType(FastChildElement) === definition,
                registered: registry.get(childName) === FastChildElement,
                upgraded: child instanceof FastChildElement,
                rendered: child?.shadowRoot?.textContent,
                definedGlobally: customElements.get(childName) !== undefined,
            };
            host.remove();
            return output;
        });

        expect(result).toEqual({
            definitionReused: true,
            registered: true,
            upgraded: true,
            rendered: "child",
            definedGlobally: false,
        });
    });

    test("normalizes native and compatibility shadow registry keys", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const { FASTElement, FASTElementDefinition, uniqueElementName } =
                await import("/main.js");

            class NativeKeyElement extends FASTElement {}
            class LegacyKeyElement extends FASTElement {}

            const nativeRegistry = {} as CustomElementRegistry;
            const legacyRegistry = {} as CustomElementRegistry;
            const nativeDefinition = await FASTElementDefinition.compose(
                NativeKeyElement,
                {
                    name: uniqueElementName(),
                    shadowOptions: {
                        customElementRegistry: nativeRegistry,
                        mode: "open",
                    },
                },
            );
            const legacyDefinition = await FASTElementDefinition.compose(
                LegacyKeyElement,
                {
                    name: uniqueElementName(),
                    shadowOptions: {
                        mode: "open",
                        registry: legacyRegistry,
                    } as any,
                },
            );

            return {
                legacyBackfillsNative:
                    legacyDefinition.shadowOptions?.customElementRegistry ===
                    legacyRegistry,
                legacyPreserved:
                    legacyDefinition.shadowOptions?.registry === legacyRegistry,
                nativeBackfillsLegacy:
                    nativeDefinition.shadowOptions?.registry === nativeRegistry,
                nativePreserved:
                    nativeDefinition.shadowOptions?.customElementRegistry ===
                    nativeRegistry,
            };
        });

        expect(result).toEqual({
            legacyBackfillsNative: true,
            legacyPreserved: true,
            nativeBackfillsLegacy: true,
            nativePreserved: true,
        });
    });

    test("loads the polyfill once when native support is absent", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const { ensureScopedRegistrySupport, supportsScopedRegistries } =
                await import("/main.js");

            const nativeSupport = supportsScopedRegistries();
            await Promise.all([
                ensureScopedRegistrySupport(),
                ensureScopedRegistrySupport(),
            ]);

            const scope = globalThis as typeof globalThis & {
                __scopedRegistryPolyfillApplied?: boolean;
                __scopedRegistryPolyfillPromise?: Promise<void>;
            };

            return {
                available: supportsScopedRegistries(),
                loadedWhenNeeded:
                    nativeSupport ||
                    (scope.__scopedRegistryPolyfillApplied === true &&
                        scope.__scopedRegistryPolyfillPromise !== undefined),
            };
        });

        expect(result).toEqual({ available: true, loadedWhenNeeded: true });
    });

    test("upgrades template children against each host's own scoped registry", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                Observable,
                ensureScopedRegistrySupport,
                html,
                repeat,
                uniqueElementName,
                when,
            } = await import("/main.js");

            // Load the polyfill (a no-op on browsers with native support) before any
            // class extends HTMLElement so both paths exercise the same code.
            await ensureScopedRegistrySupport();

            const childTag = uniqueElementName();

            class ChildV1 extends HTMLElement {
                readonly version = 1;
            }
            class ChildV2 extends HTMLElement {
                readonly version = 2;
            }

            const registryA = new CustomElementRegistry();
            const registryB = new CustomElementRegistry();
            registryA.define(childTag, ChildV1);
            registryB.define(childTag, ChildV2);

            class HostA extends FASTElement {
                items = ["a", "b"];
                show = true;
            }
            class HostB extends FASTElement {
                items = ["c"];
                show = true;
            }

            const partial = (markup: string) => html`${html.partial(markup)}`;
            const itemTemplate = partial(`<${childTag} class="item"></${childTag}>`);
            const whenTemplate = partial(`<${childTag} class="when"></${childTag}>`);
            const templateFor = () =>
                html`${html.partial(`<${childTag} id="direct"></${childTag}>`)}<div>${repeat(
                    (x: any) => x.items,
                    itemTemplate,
                )}</div><div>${when((x: any) => x.show, whenTemplate)}</div>`;

            for (const Host of [HostA, HostB]) {
                Observable.defineProperty(Host.prototype, "items");
                Observable.defineProperty(Host.prototype, "show");
            }

            const nameA = uniqueElementName();
            const nameB = uniqueElementName();
            await FASTElement.define(HostA, {
                name: nameA,
                template: templateFor(),
                shadowOptions: { mode: "open", customElementRegistry: registryA },
            });
            await FASTElement.define(HostB, {
                name: nameB,
                template: templateFor(),
                shadowOptions: { mode: "open", customElementRegistry: registryB },
            });

            const hostA = document.createElement(nameA);
            const hostB = document.createElement(nameB);
            document.body.append(hostA, hostB);
            await new Promise(resolve => requestAnimationFrame(resolve));

            const versions = (host: Element, selector: string) =>
                Array.from(host.shadowRoot!.querySelectorAll(selector)).map(
                    el => (el as any).version,
                );

            const output = {
                directA: versions(hostA, "#direct"),
                directB: versions(hostB, "#direct"),
                itemsA: versions(hostA, ".item"),
                itemsB: versions(hostB, ".item"),
                whenA: versions(hostA, ".when"),
                whenB: versions(hostB, ".when"),
                definedGlobally: customElements.get(childTag) !== undefined,
            };

            // Views created after the initial render (data changes, when toggles)
            // must be scoped too.
            (hostA as any).items = ["a", "b", "c"];
            (hostA as any).show = false;
            (hostB as any).show = false;
            await new Promise(resolve => requestAnimationFrame(resolve));
            (hostA as any).show = true;
            (hostB as any).show = true;
            await new Promise(resolve => requestAnimationFrame(resolve));
            const later = {
                itemsA: versions(hostA, ".item"),
                whenA: versions(hostA, ".when"),
                whenB: versions(hostB, ".when"),
            };

            hostA.remove();
            hostB.remove();
            return { ...output, later };
        });

        expect(result).toEqual({
            directA: [1],
            directB: [2],
            itemsA: [1, 1],
            itemsB: [2],
            whenA: [1],
            whenB: [2],
            definedGlobally: false,
            later: { itemsA: [1, 1, 1], whenA: [1], whenB: [2] },
        });
    });
});
