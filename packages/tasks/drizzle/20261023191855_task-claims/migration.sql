ALTER TABLE `task_executions` ADD `claim_id` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `task_execution_claim` ON `task_executions` (`actor`,`claim_id`);