# Overriding the salutation

A deployer replaces the `greetings` pack for one space by putting a directory
`spaces/<space>/packs/hello/greetings/` in the workspace, with its own `pack.toml` (the same
`id` and `plugin`) and a `data/salutation.txt`. The override replaces the default pack whole:
files are never merged. A space without an override uses the default, `Hello`.
