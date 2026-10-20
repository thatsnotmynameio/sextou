# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Organizations and beads

### Organization

The unit sextou does work for: it groups a set of workspaces and owns exactly one beads store.

Every call into beads names the organization it is for. Today the server creates a single default organization with a fixed id; creating, listing and naming organizations is not a feature yet.

### Workspace

A repository-like folder that an organization works on. A workspace has no database of its own; its work is tracked in its organization's beads store.

### Beads

The operational layer: a graph of work items and their dependencies, with a numbered journal of every change, kept per organization. sextou reaches it only through each organization's beads server, never by reading its tables.

### Data directory

The one folder where a sextou server keeps everything it owns on a machine: its own database, the pinned beads and database binaries, each organization's beads configuration, the credentials and the logs. It is private to the user who runs the server, and moving it moves all of them.
