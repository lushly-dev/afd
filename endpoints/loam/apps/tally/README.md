# Tally

Loam's second app, native: a counter on main, a panel view and a status item. It exists to land from a
deployment entry alone, with no change to the shell.

Trusted, not sandboxed. Native apps share the shell's page, so this app's grants are a contract, not a
boundary. Ship untrusted code as a view.
