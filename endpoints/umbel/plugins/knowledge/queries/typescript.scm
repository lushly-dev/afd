; Definitions of TypeScript, TSX, JavaScript and JSX source (specification section 7.4); the TSX
; grammar parses JavaScript and JSX, so one file serves them all.
(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(class_declaration name: (type_identifier) @name) @definition.class
(abstract_class_declaration name: (type_identifier) @name) @definition.class
(interface_declaration name: (type_identifier) @name) @definition.interface
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum
(internal_module name: (identifier) @name) @definition.module
(method_definition name: (property_identifier) @name) @definition.method
(method_signature name: (property_identifier) @name) @definition.method
(abstract_method_signature name: (property_identifier) @name) @definition.method
; An exported constant (including an arrow function bound to one).
(export_statement
  declaration: (lexical_declaration
    (variable_declarator name: (identifier) @name))) @definition.const
