---
title: Fencing token
date: 2026-10-23
input_shape: concept
subject: The attempt id a runner carries to prove it still holds a task's lease
---

# Fencing token

A lease gives one runner a task until a deadline. On its own, a lease can't stop a runner that lost it from acting late. The runner may pause, lose the network, or miss its heartbeats. Its lease expires, the task goes to another runner, and then the first one comes back and reports a result. A fencing token is a value that changes with every grant. Each write carries the token, and the store refuses a write whose token is not the current one.

## Why here

The alternative is to check the lease in the server's memory before calling the task graph. Between that check and the write, the sweep can requeue the task and another runner can claim it. The late runner's write then lands on the new attempt. Putting the check in the same transaction as the status change closes that gap. Only the task graph owns that transaction, so the token lives in `@sextou/tasks`.

## In this change

Each claim creates a row in `task_executions` whose id (`exe_…`) is the token. `renewExecution` and `finishTask` accept only an id whose `expires_at` is still set, and `finishTask` and the sweep clear it when the attempt ends. A runner whose task was retried gets `lease_lost` (HTTP 409) and drops its result:

```text
runner A  claim  -> exe_1, attempt 1
          (network lost, lease expires, sweep reopens the task)
runner B  claim  -> exe_2, attempt 2
runner A  complete exe_1 -> CONFLICT lease_lost
runner B  complete exe_2 -> ok
```

## When not to use it

When a single process both holds the work and writes its result, with no way for another worker to take over, a token adds nothing. It also does not stop a stale runner's side effects outside the store, such as a push it already made. Those need idempotent effects, or a token checked by each system the runner writes to.
