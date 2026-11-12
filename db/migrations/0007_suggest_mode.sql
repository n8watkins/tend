ALTER TABLE `contact` ADD `suggest` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `suggest` text DEFAULT 'mix' NOT NULL;