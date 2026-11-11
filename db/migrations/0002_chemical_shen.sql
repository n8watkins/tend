CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_link_code` (
	`codeHash` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `user_settings` ADD `telegramChatId` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `telegramLinkedAt` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `telegramReminders` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_telegram_chat_idx` ON `user_settings` (`telegramChatId`);