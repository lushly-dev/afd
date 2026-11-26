import {
  type Constructable,
  FASTElementDefinition,
  type FASTElementExtension,
  type PartialFASTElementDefinition,
} from "@lushly-dev/fast-element";

const definitions = new WeakMap<Constructable<HTMLElement>, Promise<FASTElementDefinition>>();

/**
 * Defines a Violet element in `registry`, composing its FAST definition once per class.
 *
 * @remarks
 * `FASTElement.define` composes a new definition on every call and, for a class it has defined
 * before, a subclass, so a class defined in a second registry would not be the class the first one
 * holds. One definition serves every registry instead: `definition.define(registry)` registers the
 * class itself and does nothing for a registry that already has the tag.
 *
 * The elements an element creates in its own shadow root still come from the global registry, so
 * a scoped registry does not isolate its children yet (#2437).
 *
 * @param type - The element class.
 * @param partial - Its name, template, styles and shadow options.
 * @param registry - The registry to define it in.
 * @param extensions - FAST extensions applied once per registry before the element is defined.
 */
export async function defineVioletElement<TType extends Constructable<HTMLElement>>(
  type: TType,
  partial: PartialFASTElementDefinition<TType>,
  registry: CustomElementRegistry = customElements,
  extensions?: FASTElementExtension[],
): Promise<void> {
  let definition = definitions.get(type);
  if (definition === undefined) {
    definition = FASTElementDefinition.compose(type, partial);
    definitions.set(type, definition);
  }
  (await definition).define(registry, extensions);
}
