CREATE TABLE `game_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text,
	`player_id` text,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL
);
