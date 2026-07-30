import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const realtimeState = sqliteTable("realtime_state", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
