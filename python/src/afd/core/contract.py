"""The version of the AFD contract this package implements."""

CONTRACT_VERSION: str = "1.0-rc"
"""The AFD contract version (``spec/VERSION`` in the repository) this package follows.

The contract covers the wire shapes, the pipeline variables, the behavior
vectors and the todo conformance suite that every AFD language shares. Its
``MAJOR.MINOR`` version is independent of ``afd.__version__``:
implementations that report the same contract version are meant to agree on
everything it covers. It reads ``1.0-rc`` until every language loads every
vector file.

``afd-help`` reports it as ``contractVersion``. The TypeScript
(``AFD_CONTRACT_VERSION``), Rust (``afd::CONTRACT_VERSION``) and C++
(``afd::contract_version``) packages export the same value.
"""
