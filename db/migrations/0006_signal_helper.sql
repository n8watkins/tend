CREATE TABLE `helper_device` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastSeenAt` integer,
	`helperVersion` text,
	`signalCliVersion` text,
	`lastClaimAt` integer,
	`haltedAt` integer,
	`haltReason` text,
	`revokedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `helper_device_tokenHash_unique` ON `helper_device` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `helper_device_user_idx` ON `helper_device` (`userId`);--> statement-breakpoint
CREATE TABLE `helper_event` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`messageId` text,
	`kind` text NOT NULL,
	`reason` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `helper_event_user_idx` ON `helper_event` (`userId`,`at`);--> statement-breakpoint
CREATE TABLE `helper_pair_code` (
	`codeHash` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `message` ADD `approvalState` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `message` ADD `approvedBodyHash` text;--> statement-breakpoint
ALTER TABLE `message` ADD `approvedAt` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `approvedVia` text;--> statement-breakpoint
ALTER TABLE `message` ADD `sendBy` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `sendState` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `message` ADD `claimId` text;--> statement-breakpoint
ALTER TABLE `message` ADD `claimedAt` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `leaseUntil` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `resultAt` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `sendFailure` text;--> statement-breakpoint
ALTER TABLE `message` ADD `sentVia` text;--> statement-breakpoint
ALTER TABLE `message` ADD `signalTimestamp` integer;--> statement-breakpoint
CREATE INDEX `message_helper_idx` ON `message` (`userId`,`approvalState`,`sendState`);--> statement-breakpoint
CREATE INDEX `message_claimed_idx` ON `message` (`claimedAt`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `helperEnabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `helperAckAt` integer;