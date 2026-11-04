# Tasks

Loam's project-scoped app, native: tasks in a sidebar list, and main to add, rename and complete
them. It declares `scope_levels = ["project"]`, so it opens only inside a project, and each project
keeps its own tasks. `app.resource_keys` names the `task` of `tasks-rename` and `tasks-complete`, so a
task of another project is refused with the project that holds it. It lands with no shell change: no
file of the kernel, the chrome or the web host names it.

Trusted, not sandboxed. Native apps share the shell's page, so this app's grants are a contract, not a
boundary. Ship untrusted code as a view.
