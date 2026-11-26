import { registerSystemChevronRightIcon } from "../icon/generated/icons/system-chevron-right";
import { defineVioletIcon } from "../icon/violet-icon.define";
import { defineVioletIconButton } from "../icon-button/violet-icon-button.define";
import { defineVioletElement } from "../shared/define-element";
import { VioletCarousel, violetCarouselDefinition } from "./violet-carousel";

/**
 * Defines `<violet-carousel>` in `registry`, after the elements it uses.
 * Defining it again in the same registry does nothing.
 *
 * @param registry - The registry to define it in: the global one unless a scoped registry is given.
 */
export async function defineVioletCarousel(
  registry: CustomElementRegistry = customElements,
): Promise<void> {
  await defineVioletIcon(registry);
  await defineVioletIconButton(registry);
  registerSystemChevronRightIcon();
  await defineVioletElement(VioletCarousel, violetCarouselDefinition, registry);
}

await defineVioletCarousel();
