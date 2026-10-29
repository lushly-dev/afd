import { expect, test } from "@playwright/test";

test.describe("scoped custom element registries", () => {
    test("creates a scoped registry or an explicit global fallback", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const { createRegistry, supportsScopedRegistries, uniqueElementName } =
                await import("/main.js");

            class ChildElement extends HTMLElement {}

            const name = uniqueElementName();
            const supported = supportsScopedRegistries();
            const registry = createRegistry([[ChildElement, name]]);
            const effectiveRegistry = registry ?? customElements;

            return {
                registered: effectiveRegistry.get(name) === ChildElement,
                returnedScopedRegistry: registry !== undefined,
                supported,
            };
        });

        expect(result.registered).toBe(true);
        expect(result.returnedScopedRegistry).toBe(result.supported);
    });

    test("honors strict mode and reuses FAST definition registration", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                FASTElementDefinition,
                createRegistry,
                fastElementRegistry,
                supportsScopedRegistries,
                uniqueElementName,
            } = await import("/main.js");

            const supported = supportsScopedRegistries();
            let strictThrew = false;

            class StrictElement extends HTMLElement {}

            try {
                createRegistry([[StrictElement, uniqueElementName()]], {
                    strict: true,
                });
            } catch {
                strictThrew = true;
            }

            class FastChildElement extends FASTElement {}

            const name = uniqueElementName();
            const definition = await FASTElementDefinition.compose(FastChildElement, {
                name,
            });
            const registry = createRegistry([[FastChildElement, name]]);
            const effectiveRegistry = registry ?? customElements;

            return {
                definitionReused:
                    fastElementRegistry.getByType(FastChildElement) === definition,
                registered: effectiveRegistry.get(name) === FastChildElement,
                strictThrew,
                supported,
            };
        });

        expect(result.registered).toBe(true);
        expect(result.definitionReused).toBe(true);
        expect(result.strictThrew).toBe(!result.supported);
    });

    test("caches one registry per concrete mixin class", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                FASTElement,
                ScopedRegistryMixin,
                ensureScopedRegistrySupport,
                uniqueElementName,
            } = await import("/main.js");

            // Native support or the polyfill, so the registry assertions below are
            // unconditional on every browser.
            await ensureScopedRegistrySupport();

            class ChildA extends HTMLElement {}
            class ChildB extends HTMLElement {}

            const ScopedBase = ScopedRegistryMixin(FASTElement);
            class HostA extends ScopedBase {}
            class HostB extends ScopedBase {}

            (HostA as any).elementDefinitions = {
                [uniqueElementName()]: ChildA,
            };
            (HostB as any).elementDefinitions = {
                [uniqueElementName()]: ChildB,
            };

            const registryA = (HostA as any).scopedRegistry;
            const registryAAgain = (HostA as any).scopedRegistry;
            const registryB = (HostB as any).scopedRegistry;
            const options = (HostA as any).getShadowOptions({
                clonable: true,
                delegatesFocus: true,
                mode: "closed",
                serializable: true,
            });

            return {
                registryCreated: registryA !== undefined && registryB !== undefined,
                customRegistryMatches: options.customElementRegistry === registryA,
                distinctRegistry: registryA !== registryB,
                legacyRegistryMatches: options.registry === registryA,
                optionsPreserved:
                    options.mode === "closed" &&
                    options.delegatesFocus === true &&
                    options.clonable === true &&
                    options.serializable === true,
                sameRegistry: registryA === registryAAgain,
            };
        });

        expect(result).toEqual({
            registryCreated: true,
            customRegistryMatches: true,
            distinctRegistry: true,
            legacyRegistryMatches: true,
            optionsPreserved: true,
            sameRegistry: true,
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
                ScopedRegistryMixin,
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

            const ScopedBase = ScopedRegistryMixin(FASTElement);
            class HostA extends ScopedBase {
                static elementDefinitions = { [childTag]: ChildV1 };
                items = ["a", "b"];
                show = true;
            }
            class HostB extends ScopedBase {
                static elementDefinitions = { [childTag]: ChildV2 };
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
                shadowOptions: (HostA as any).getShadowOptions(),
            });
            await FASTElement.define(HostB, {
                name: nameB,
                template: templateFor(),
                shadowOptions: (HostB as any).getShadowOptions(),
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
