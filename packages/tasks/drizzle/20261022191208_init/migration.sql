CREATE TABLE `task_executions` (
	`task_id` text PRIMARY KEY,
	`actor` text NOT NULL,
	`log_path` text,
	`result_path` text,
	CONSTRAINT `fk_task_executions_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_links` (
	`task_id` text NOT NULL,
	`blocker_id` text NOT NULL,
	CONSTRAINT `task_links_pk` PRIMARY KEY(`task_id`, `blocker_id`),
	CONSTRAINT `fk_task_links_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`),
	CONSTRAINT `fk_task_links_blocker_id_tasks_id_fk` FOREIGN KEY (`blocker_id`) REFERENCES `tasks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_status_changes` (
	`id` integer PRIMARY KEY,
	`task_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`changed_by` text NOT NULL,
	`reason` text,
	`time_changed` integer NOT NULL,
	CONSTRAINT `fk_task_status_changes_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`),
	CONSTRAINT "task_status_change_from_status" CHECK("from_status" IN ('open', 'running', 'succeeded', 'failed', 'skipped')),
	CONSTRAINT "task_status_change_to_status" CHECK("to_status" IN ('open', 'running', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `tasks` (
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
	CONSTRAINT "task_status" CHECK("status" IN ('open', 'running', 'succeeded', 'failed', 'skipped')),
	CONSTRAINT "task_holding_blockers" CHECK("holding_blockers" >= 0)
);
--> statement-breakpoint
CREATE INDEX `task_link_blocker` ON `task_links` (`blocker_id`);--> statement-breakpoint
CREATE INDEX `task_ready` ON `tasks` (`assignee`,`priority`) WHERE "tasks"."status" = 'open' AND "tasks"."holding_blockers" = 0;