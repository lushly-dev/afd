//! A component that exports `umbel:plugin/command@2.0.0`, which a protocol 1 host must refuse.

#[allow(unsafe_code, missing_docs, unreachable_pub)]
mod glue {
    wit_bindgen::generate!({ path: "wit", world: "plugin" });

    struct Component;

    impl exports::umbel::plugin::command::Guest for Component {
        fn execute(_name: String, input: String) -> String {
            input
        }
    }

    export!(Component);
}
