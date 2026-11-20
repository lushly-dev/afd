# Tally

Loam's second app, native: a counter on main, a panel view and a status item. It exists to land from a
deployment entry alone, with no change to the shell.

`tally-reset` sets the total back to zero and declares a `confirm_prompt`, so the shell asks the person before it
runs: in the overlay slot when the person or the active Tally calls it, and in the inbox when an agent or a
background Tally does (phase 4 specification, 7.2).

Trusted, not sandboxed. Native apps share the shell's page, so this app's grants are a contract, not a
boundary. Ship untrusted code as a view.
