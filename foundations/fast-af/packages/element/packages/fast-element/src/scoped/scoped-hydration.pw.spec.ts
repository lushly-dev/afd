import { expect, type Page, test } from "@playwright/test";

/**
 * Whether a declarative shadow root can be server-rendered without a registry
 * (`shadowrootcustomelementregistry`) and given one later through
 * `CustomElementRegistry.prototype.initialize`. Browsers that only have the
 * polyfill cannot scope server-rendered content, so these specs skip there.
 */
async function supportsDeclarativeScopedRoots(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const container = document.createElement("div");
        (container as any).setHTMLUnsafe(
            `<div><template shadowrootmode="open" shadowrootcustomelementregistry></template></div>`,
        );
        const root = container.firstElementChild?.shadowRoot as any;
        return (
            root?.customElementRegistry === null &&
            typeof (globalThis as any).CustomElementRegistry?.prototype?.initialize ===
                "function"
        );
    });
}

test.describe("scoped custom element registries after hydration", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        test.skip(
            !(await supportsDeclarativeScopedRoots(page)),
            "needs native declarative scoped registries",
        );
    });

    test("views created after a scoped host hydrates use the host's registry", async ({
        page,
    }) => {
        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                enableHydration,
                FASTElement,
                Observable,
                ensureScopedRegistrySupport,
                html,
                repeat,
                uniqueElementName,
                when,
            } = await import("/main.js");

            await ensureScopedRegistrySupport();
            enableHydration();

            const childTag = uniqueElementName();

            class Child extends HTMLElement {
                readonly version = 1;
            }

            const registry = new CustomElementRegistry();
            registry.define(childTag, Child);

            class Host extends FASTElement {
                items = ["a", "b", "c"];
                show = true;
            }
            Observable.defineProperty(Host.prototype, "items");
            Observable.defineProperty(Host.prototype, "show");

            const tag = (cls: string) => `<${childTag} class="${cls}"></${childTag}>`;
            const child = (cls: string) => html`${html.partial(tag(cls))}`;
            const name = uniqueElementName();
            await FASTElement.define(Host, {
                name,
                template: html`${repeat((x: any) => x.items, child("item"))}${when(
                    (x: any) => x.show,
                    child("when"),
                    child("else"),
                )}`,
                shadowOptions: { mode: "open", customElementRegistry: registry },
            });

            // Server-rendered with one repeat item; the client has three.
            const container = document.createElement("div");
            document.body.append(container);
            (container as any).setHTMLUnsafe(
                `<${name}><template shadowrootmode="open" shadowrootcustomelementregistry>` +
                    `<!--fe:b--><!--fe:r-->${tag("item")}<!--fe:/r--><!--fe:/b-->` +
                    `<!--fe:b-->${tag("when")}<!--fe:/b-->` +
                    `</template></${name}>`,
            );

            const host = container.firstElementChild as any;
            const serverItem = host.shadowRoot.querySelector(".item");
            const serverWhen = host.shadowRoot.querySelector(".when");
            const isHydrated = await host.$fastController.isHydrated;
            await new Promise(resolve => requestAnimationFrame(resolve));

            const versions = (selector: string) =>
                Array.from(host.shadowRoot.querySelectorAll(selector)).map(
                    el => (el as any).version,
                );

            const hydrated = {
                isHydrated,
                serverItemReused: host.shadowRoot.querySelector(".item") === serverItem,
                serverWhenReused: host.shadowRoot.querySelector(".when") === serverWhen,
                items: versions(".item"),
                when: versions(".when"),
            };

            // Each change creates a new view: an item, the else branch, then the
            // when branch again (a template change replaces the view).
            host.items = [...host.items, "d"];
            host.show = false;
            await new Promise(resolve => requestAnimationFrame(resolve));
            const otherwise = versions(".else");
            host.show = true;
            await new Promise(resolve => requestAnimationFrame(resolve));

            const later = {
                items: versions(".item"),
                else: otherwise,
                when: versions(".when"),
                whenReplaced: host.shadowRoot.querySelector(".when") !== serverWhen,
            };

            container.remove();
            return {
                definedGlobally: customElements.get(childTag) !== undefined,
                hydrated,
                later,
            };
        });

        expect(result).toEqual({
            definedGlobally: false,
            hydrated: {
                isHydrated: true,
                serverItemReused: true,
                serverWhenReused: true,
                items: [1, 1, 1],
                when: [1],
            },
            later: { items: [1, 1, 1, 1], else: [1], when: [1], whenReplaced: true },
        });
    });

    test("views nested in hydrated views create later views in the host's registry", async ({
        page,
    }) => {
        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module.
            const {
                enableHydration,
                FASTElement,
                Observable,
                ensureScopedRegistrySupport,
                html,
                render,
                repeat,
                uniqueElementName,
                when,
            } = await import("/main.js");

            await ensureScopedRegistrySupport();
            enableHydration();

            const childTag = uniqueElementName();

            class Child extends HTMLElement {
                readonly version = 1;
            }

            class Model {
                on = true;
            }
            Observable.defineProperty(Model.prototype, "on");

            const registry = new CustomElementRegistry();
            registry.define(childTag, Child);

            class Host extends FASTElement {
                show = true;
                items = ["a", "b"];
                groups = ["g"];
                flag = true;
                model = new Model();
            }
            for (const key of ["show", "items", "groups", "flag"]) {
                Observable.defineProperty(Host.prototype, key);
            }

            const tag = (cls: string) => `<${childTag} class="${cls}"></${childTag}>`;
            const child = (cls: string) => html`${html.partial(tag(cls))}`;
            const name = uniqueElementName();
            await FASTElement.define(Host, {
                name,
                // Each inner directive's controller is a view that another directive
                // hydrated: a when's content (holding a repeat), a repeat item
                // (holding a when) and a render (holding a when).
                template: html`${when(
                    (x: any) => x.show,
                    html`${repeat((x: any) => x.items, child("item"))}`,
                )}${repeat(
                    (x: any) => x.groups,
                    html`${when(
                        (x: any, c: any) => c.parent.flag,
                        child("nested"),
                        child("nested-else"),
                    )}`,
                )}${render(
                    (x: any) => x.model,
                    html`${when(
                        (x: any) => x.on,
                        child("rendered"),
                        child("rendered-else"),
                    )}`,
                )}`,
                shadowOptions: { mode: "open", customElementRegistry: registry },
            });

            // Server-rendered with one item in the inner repeat.
            const container = document.createElement("div");
            document.body.append(container);
            (container as any).setHTMLUnsafe(
                `<${name}><template shadowrootmode="open" shadowrootcustomelementregistry>` +
                    `<!--fe:b--><!--fe:b--><!--fe:r-->${tag("item")}<!--fe:/r--><!--fe:/b--><!--fe:/b-->` +
                    `<!--fe:b--><!--fe:r--><!--fe:b-->${tag("nested")}<!--fe:/b--><!--fe:/r--><!--fe:/b-->` +
                    `<!--fe:b--><!--fe:b-->${tag("rendered")}<!--fe:/b--><!--fe:/b-->` +
                    `</template></${name}>`,
            );

            const host = container.firstElementChild as any;
            const classes = ["item", "nested", "rendered"];
            const server = classes.map(cls => host.shadowRoot.querySelector(`.${cls}`));
            const isHydrated = await host.$fastController.isHydrated;
            await new Promise(resolve => requestAnimationFrame(resolve));

            const versions = (selector: string) =>
                Array.from(host.shadowRoot.querySelectorAll(selector)).map(
                    el => (el as any).version,
                );

            const hydrated = {
                isHydrated,
                serverNodesReused: classes.every(
                    (cls, i) => host.shadowRoot.querySelector(`.${cls}`) === server[i],
                ),
                items: versions(".item"),
                nested: versions(".nested"),
                rendered: versions(".rendered"),
            };

            // Each change creates a view whose controller is a hydrated view.
            host.items = [...host.items, "c"];
            host.flag = false;
            host.model.on = false;
            await new Promise(resolve => requestAnimationFrame(resolve));

            const later = {
                items: versions(".item"),
                nested: versions(".nested-else"),
                rendered: versions(".rendered-else"),
            };

            container.remove();
            return { hydrated, later };
        });

        expect(result).toEqual({
            hydrated: {
                isHydrated: true,
                serverNodesReused: true,
                items: [1, 1],
                nested: [1],
                rendered: [1],
            },
            later: { items: [1, 1, 1], nested: [1], rendered: [1] },
        });
    });
});
