import {
  boolean,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const chatChannels = pgTable("chat_channels", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("#"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMembers = pgTable(
  "chat_members",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("member"),
    avatarIndex: integer("avatar_index").notNull().default(0),
    isBanned: boolean("is_banned").notNull().default(false),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_members_display_name_idx").on(table.displayName)],
);

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => chatMembers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_sessions_online_idx").on(table.lastSeenAt)],
);

export const chatAttachments = pgTable("chat_attachments", {
  id: uuid("id").primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => chatMembers.id, { onDelete: "cascade" }),
  storedName: text("stored_name").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => chatChannels.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => chatMembers.id),
    body: text("body").notNull().default(""),
    kind: text("kind").notNull().default("text"),
    attachmentId: uuid("attachment_id").references(() => chatAttachments.id, {
      onDelete: "set null",
    }),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => chatMessages.id, {
      onDelete: "set null",
    }),
    pinned: boolean("pinned").notNull().default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_channel_created_idx").on(table.channelId, table.createdAt),
    index("chat_messages_member_idx").on(table.memberId),
  ],
);

export const chatRoomSettings = pgTable("chat_room_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatAuditLog = pgTable("chat_audit_log", {
  id: serial("id").primaryKey(),
  actorId: uuid("actor_id").references(() => chatMembers.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetId: text("target_id"),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});