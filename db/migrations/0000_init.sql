CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `consent_event` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`contactId` text NOT NULL,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`by` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contactId`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `consent_event_contact_idx` ON `consent_event` (`contactId`,`at`);--> statement-breakpoint
CREATE TABLE `contact_topic` (
	`contactId` text NOT NULL,
	`topic` text NOT NULL,
	`weight` integer DEFAULT 2 NOT NULL,
	PRIMARY KEY(`contactId`, `topic`),
	FOREIGN KEY (`contactId`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`phoneEnc` text,
	`notesEnc` text,
	`timezone` text NOT NULL,
	`signalStatus` text DEFAULT 'unknown' NOT NULL,
	`consent` text DEFAULT 'not_asked' NOT NULL,
	`consentUpdatedAt` integer NOT NULL,
	`stoppedByRecipient` integer DEFAULT false NOT NULL,
	`minDaysBetween` integer DEFAULT 7 NOT NULL,
	`maxPer30Days` integer DEFAULT 4 NOT NULL,
	`windowStart` integer DEFAULT 540 NOT NULL,
	`windowEnd` integer DEFAULT 1200 NOT NULL,
	`allowedDays` integer DEFAULT 127 NOT NULL,
	`stopToken` text NOT NULL,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_stopToken_unique` ON `contact` (`stopToken`);--> statement-breakpoint
CREATE INDEX `contact_user_idx` ON `contact` (`userId`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`contactId` text NOT NULL,
	`kind` text NOT NULL,
	`contentId` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`scheduledFor` integer NOT NULL,
	`remindedAt` integer,
	`sentAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contactId`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_due_idx` ON `message` (`status`,`scheduledFor`);--> statement-breakpoint
CREATE INDEX `message_contact_idx` ON `message` (`contactId`,`sentAt`);--> statement-breakpoint
CREATE INDEX `message_user_idx` ON `message` (`userId`,`status`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`resetAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`userId` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`emailReminders` integer DEFAULT true NOT NULL,
	`pausedAt` integer,
	`translation` text DEFAULT 'web' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
