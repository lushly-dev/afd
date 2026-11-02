; Definitions of Rust source (specification section 7.4). Every pattern captures the whole
; definition as `@definition.<kind>` and its name as `@name`.
(function_item name: (identifier) @name) @definition.function
(function_signature_item name: (identifier) @name) @definition.function
(struct_item name: (type_identifier) @name) @definition.struct
(enum_item name: (type_identifier) @name) @definition.enum
(union_item name: (type_identifier) @name) @definition.union
(trait_item name: (type_identifier) @name) @definition.trait
; An `impl` is named by the type it is for, so its methods are `Type::method`.
(impl_item type: (type_identifier) @name) @definition.impl
(impl_item type: (generic_type type: (type_identifier) @name)) @definition.impl
(impl_item type: (scoped_type_identifier name: (type_identifier) @name)) @definition.impl
(impl_item type: (generic_type type: (scoped_type_identifier name: (type_identifier) @name))) @definition.impl
(mod_item name: (identifier) @name) @definition.module
(const_item name: (identifier) @name) @definition.const
(static_item name: (identifier) @name) @definition.static
(type_item name: (type_identifier) @name) @definition.type
(macro_definition name: (identifier) @name) @definition.macro
