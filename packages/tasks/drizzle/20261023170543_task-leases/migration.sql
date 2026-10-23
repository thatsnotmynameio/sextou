ALTER TABLE `task_executions` ADD `id` text;--> statement-breakpoint
ALTER TABLE `task_executions` ADD `attempt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `task_executions` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `task_executions` ADD `cancel_requested_by` text;--> statement-breakpoint
ALTER TABLE `task_executions` ADD `cancel_reason` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_executions` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`actor` text NOT NULL,
	`log_path` text,
	`result_path` text,
	`expires_at` integer,
	`cancel_requested_by` text,
	`cancel_reason` text,
	CONSTRAINT `fk_task_executions_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`),
	CONSTRAINT "task_execution_attempt" CHECK("attempt" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_task_executions`(`task_id`, `actor`, `log_path`, `result_path`) SELECT `task_id`, `actor`, `log_path`, `result_path` FROM `task_executions`;--> statement-breakpoint
DROP TABLE `task_executions`;--> statement-breakpoint
ALTER TABLE `__new_task_executions` RENAME TO `task_executions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_status_changes` (
	`id` integer PRIMARY KEY,
	`task_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`changed_by` text NOT NULL,
	`reason` text,
	`time_changed` integer NOT NULL,
	CONSTRAINT `fk_task_status_changes_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`),
	CONSTRAINT "task_status_change_from_status" CHECK("from_status" IN ('open', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
	CONSTRAINT "task_status_change_to_status" CHECK("to_status" IN ('open', 'running', 'succeeded', 'failed', 'skipped', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_task_status_changes`(`id`, `task_id`, `from_status`, `to_status`, `changed_by`, `reason`, `time_changed`) SELECT `id`, `task_id`, `from_status`, `to_status`, `changed_by`, `reason`, `time_changed` FROM `task_status_changes`;--> statement-breakpoint
DROP TABLE `task_status_changes`;--> statement-breakpoint
ALTER TABLE `__new_task_status_changes` RENAME TO `task_status_changes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`priority` integer NOT NULL,
	`parent_id` text,
	`assignee` text NOT NULL,
	`description` text,
	`source_path` text,
	`status` text NOT NULL,
	`holding_blockers` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_tasks_parent_id_tasks_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`),
	CONSTRAINT "task_priority" CHECK("priority" BETWEEN 0 AND 4),
	CONSTRAINT "task_status" CHECK("status" IN ('open', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
	CONSTRAINT "task_holding_blockers" CHECK("holding_blockers" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`(`id`, `title`, `kind`, `priority`, `parent_id`, `assignee`, `description`, `source_path`, `status`, `holding_blockers`) SELECT `id`, `title`, `kind`, `priority`, `parent_id`, `assignee`, `description`, `source_path`, `status`, `holding_blockers` FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `task_execution_task_attempt` ON `task_executions` (`task_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `task_execution_lease` ON `task_executions` (`expires_at`) WHERE "task_executions"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `task_ready` ON `tasks` (`assignee`,`priority`) WHERE "tasks"."status" = 'open' AND "tasks"."holding_blockers" = 0;