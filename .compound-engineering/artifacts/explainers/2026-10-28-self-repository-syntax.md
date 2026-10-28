---
title: GitHub Actions self-repository syntax ($/)
date: 2026-10-28
input_shape: concept
subject: Referencing a local action or reusable workflow as `$/path` instead of `./path`
---

# GitHub Actions self-repository syntax (`$/`)

**What it is.** A `uses:` value that starts with `$/` names an action or reusable workflow in the workflow's own repository, at the exact commit that is running. `uses: $/.github/actions/pnpm` loads `.github/actions/pnpm/action.yml` from that commit. GitHub shipped it on 2026-07-30 ([changelog](https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/)). It works wherever `./` does: workflow steps, composite action steps, nested composites and reusable workflow calls. It needs runner 2.336.0 or newer, which GitHub-hosted runners have.

**Why here, rather than `./`.** `./.github/actions/pnpm` is read from the job's workspace, so it only works after `actions/checkout`. It also loads whatever a step before it left in that folder, which may not be what the commit holds. `$/` doesn't depend on the workspace: the action is always the one at the running commit, with no checkout needed to find it. zizmor's `self-repository` audit flags every `./` local action for that reason, and GitHub counts `$/` as pinned under a "fully pinned actions" policy, which `./` isn't.

**Example from this change.** `checks.yml` calls both local actions this way:

```yaml
- uses: $/.github/actions/pnpm
  with:
    install: false
- name: go-task
  if: ${{ matrix.package == 'runner' || matrix.package == 'workflows' }}
  uses: $/.github/actions/go-task
```

The jobs still run `actions/checkout`, but only because their own steps read the repository's files.

**When not to use it.** An action in another repository keeps the `owner/repo/path@<sha>` form. On GitHub Enterprise Server or a self-hosted runner older than 2.336.0 the syntax may not exist, so keep `./` there. Some tools haven't caught up yet: actionlint 1.7.12 rejects `$/` as an action reference with no ref, so a repository that gates on actionlint needs a newer release first.
