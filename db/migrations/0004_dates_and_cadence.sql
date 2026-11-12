CREATE TABLE `nudge` (
	`contactId` text NOT NULL,
	`userId` text NOT NULL,
	`key` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`contactId`, `key`),
	FOREIGN KEY (`contactId`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `nudge_at_idx` ON `nudge` (`at`);--> statement-breakpoint
ALTER TABLE `contact` ADD `birthday` text;--> statement-breakpoint
ALTER TABLE `contact` ADD `anniversary` text;--> statement-breakpoint
ALTER TABLE `contact` ADD `occasionLeadDays` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `contact` ADD `cadenceDays` integer;--> statement-breakpoint
ALTER TABLE `contact` ADD `lastInTouchAt` integer;