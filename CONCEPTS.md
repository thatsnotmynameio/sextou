# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Organizations and tasks

### Organization

The unit sextou does work for: it groups a set of workspaces and owns exactly one task graph, in a database file of its own.

The server names each organization's file; the task graph itself knows nothing of organizations. Today only the default organization exists, in `default.tasks.db`; creating, listing and naming organizations is not a feature yet.

### Workspace

A repository-like folder that an organization works on. A workspace has no database of its own; its work is tracked in its organization's task graph.

### Task graph

An organization's work items and the `blocked_by` links between them, kept per organization by `@sextou/tasks`. A task has a title, a free kind (initiative, issue, task, or any other label), a priority from 0, the most urgent, to 4, and optionally a parent, which only organizes: it never blocks. Every task names an assignee, who may take it: an actor, a role or any other name the caller uses, which the task graph never checks. A task may also carry a description of what it asks for, and a source path, a URL or a file where its longer text lives. A task is ready when it is open and every task that blocks it is closed. Ready tasks are asked for by a list of assignees, and only theirs come back. A link that would close a cycle is refused, a task closes only once none of its blockers is open, and closed is final.

### Data directory

The one folder where a sextou server keeps everything it owns on a machine: its own database and each organization's task graph. It is private to the user who runs the server, and moving it moves all of them.
