import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const realtimeState = sqliteTable("realtime_state", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const gameRooms = sqliteTable("game_rooms", {
  code: text("code").primaryKey(),
  state: text("state").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const gameClients = sqliteTable("game_clients", {
  id: text("id").primaryKey(),
  roomCode: text("room_code"),
  playerId: text("player_id"),
  lastSeen: integer("last_seen").notNull(),
});
