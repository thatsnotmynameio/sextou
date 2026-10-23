# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Organizations and tasks

### Organization

The unit sextou does work for: it groups a set of workspaces and owns exactly one task graph, in a database file of its own.

The server will name each organization's file; the task graph itself knows nothing of organizations. Until organizations are a feature, the server opens one task graph, its tasks database, `tasks.db` in its data directory, and creating, listing and naming organizations is not a feature yet.

### Workspace

A repository-like folder that an organization works on. A workspace has no database of its own; its work is tracked in its organization's task graph.

### Task graph

An organization's work items and the `blocked_by` links between them, kept per organization by `@sextou/tasks`. A task has a title, a free kind (initiative, issue, task, or any other label), a priority from 0, the most urgent, to 4, and optionally a parent, which only organizes: it never blocks. Every task names an assignee, who may take it: an actor, a role or any other name the caller uses, which the task graph never checks. A task may also carry a description of what it asks for, and a source path, a URL or a file where its longer text lives. A task is `open`, then `running` once started, then finished as `succeeded`, `failed`, `skipped` or `cancelled`, and a finished task never changes state again. A task is ready when it is open and every task that blocks it succeeded or was skipped: a failed or cancelled blocker keeps it waiting until that link is removed. Only a ready task starts, and only a running one finishes. Ready tasks are asked for by a list of assignees, and only theirs come back. A link that would close a cycle is refused. Each change of a task's state is recorded, from its creation, with when it happened and who made it.

### Attempt and lease

Each start of a task is an attempt, numbered from 1, that records who runs it and where its log and result are. A running task's current attempt holds a lease: a deadline its runner pushes forward with each heartbeat. Only the runner that holds the lease can finish the task. When a lease runs out, the server ends the attempt: the task opens again while attempts are left, and fails once they run out, so a runner that comes back after losing its lease is refused. Cancelling an open task finishes it at once; cancelling a running one asks its runner, which learns of it on its next heartbeat.

### Data directory

The one folder where a sextou server keeps what it owns on the machine it runs on: today its database and its tasks database, `tasks.db`, and each organization's task graph once organizations are a feature. Moving it moves all of them.
