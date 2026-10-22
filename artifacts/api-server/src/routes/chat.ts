import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();
const sessionCookie = "cave_chat_session";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const onlineWindowSeconds = 45;
const maxMessageLength = 2000;
const maxUploadBytes = 8 * 1024 * 1024;
const storageRoot = path.resolve(
  process.env.CHAT_STORAGE_DIR || path.join(process.cwd(), "storage", "chat"),
);
const roles = ["owner", "admin", "moderator", "member"] as const;
type Role = (typeof roles)[number];
type ChatMember = {
  id: string;
  displayName: string;
  role: Role;
  avatarIndex: number;
  isBanned: boolean;
  mutedUntil: string | null;
};

const channels = [
  { id: "general", label: "general", description: "The main chat. Be kind, have fun!", icon: "chat", sortOrder: 0 },
  { id: "gaming", label: "gaming", description: "Games, high scores, and what you're playing.", icon: "gamepad", sortOrder: 1 },
  { id: "memes", label: "memes", description: "Share a laugh from the cave.", icon: "sparkles", sortOrder: 2 },
  { id: "voice-lounge", label: "voice-lounge", description: "Voice notes and cave conversations.", icon: "mic", sortOrder: 3 },
];

const windows = new Map<string, number[]>();
const listeners = new Set<Response>();
let seedPromise: Promise<void> | undefined;

function sessionSecret() {
  return process.env.CHAT_SESSION_SECRET || process.env.SESSION_SECRET;
}

function signSession(id: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error("Chat sessions are not configured.");
  const signature = createHmac("sha256", secret).update(id).digest("base64url");
  return `${id}.${signature}`;
}

function readCookie(req: Request, name: string) {
  const entry = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) return undefined;
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

function verifySessionCookie(value: string | undefined) {
  const secret = sessionSecret();
  if (!secret || !value) return undefined;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return undefined;
  const id = value.slice(0, separator);
  const received = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(
    createHmac("sha256", secret).update(id).digest("base64url"),
  );
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return undefined;
  }
  return id;
}

async function currentMember(req: Request, touch = true): Promise<ChatMember | undefined> {
  const id = verifySessionCookie(readCookie(req, sessionCookie));
  if (!id) return undefined;
  const result = await pool.query<ChatMember>(
    `SELECT m.id, m.display_name AS "displayName", m.role,
            m.avatar_index AS "avatarIndex", m.is_banned AS "isBanned",
            m.muted_until AS "mutedUntil"
       FROM chat_sessions s
       JOIN chat_members m ON m.id = s.member_id
      WHERE s.id = $1::uuid AND s.expires_at > NOW()
      LIMIT 1`,
    [id],
  );
  const member = result.rows[0];
  if (!member) return undefined;
  if (touch) {
    await pool.query(
      "UPDATE chat_sessions SET last_seen_at = NOW() WHERE id = $1::uuid",
      [id],
    );
  }
  return member;
}

function jsonError(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

function logChatFailure(operation: string, error: unknown) {
  const errorCode = typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
  logger.error(
    { operation, errorName: error instanceof Error ? error.name : "UnknownError", errorCode },
    "Chat operation failed",
  );
}

function safeWrite(req: Request, res: Response) {
  const origin = req.get("origin");
  const host = req.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        jsonError(res, 403, "This request must come from the chat page.");
        return false;
      }
    } catch {
      jsonError(res, 403, "This request must come from the chat page.");
      return false;
    }
  }
  if (req.get("sec-fetch-site") === "cross-site") {
    jsonError(res, 403, "This request must come from the chat page.");
    return false;
  }
  return true;
}

function rateLimit(key: string, maximum: number, intervalMs: number) {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((time) => now - time < intervalMs);
  if (recent.length >= maximum) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  return true;
}

function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

async function requireMember(req: Request, res: Response, next: () => void) {
  try {
    const member = await currentMember(req);
    if (!member) {
      jsonError(res, 401, "Join the chat to continue.");
      return;
    }
    if (member.isBanned) {
      jsonError(res, 403, "This chat account is banned.");
      return;
    }
    res.locals.chatMember = member;
    next();
  } catch {
    jsonError(res, 503, "Chat is temporarily unavailable.");
  }
}

function memberFrom(res: Response): ChatMember {
  return res.locals.chatMember as ChatMember;
}

function routeId(req: Request) {
  return typeof req.params.id === "string" ? req.params.id : req.params.id?.[0] ?? "";
}

function canModerate(role: Role) {
  return role === "owner" || role === "admin" || role === "moderator";
}

function canManageServer(role: Role) {
  return role === "owner" || role === "admin";
}

async function audit(
  actorId: string,
  action: string,
  targetId: string | null,
  details: Record<string, unknown> = {},
) {
  await pool.query(
    `INSERT INTO chat_audit_log (actor_id, action, target_id, details)
     VALUES ($1::uuid, $2, $3, $4::jsonb)`,
    [actorId, action, targetId, JSON.stringify(details)],
  );
}

async function seedChannels() {
  if (!seedPromise) {
    seedPromise = Promise.all(
      channels.map((channel) =>
        pool.query(
          `INSERT INTO chat_channels (id, label, description, icon, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [channel.id, channel.label, channel.description, channel.icon, channel.sortOrder],
        ),
      ),
    ).then(() => undefined);
  }
  return seedPromise;
}

async function messageById(id: string) {
  const result = await pool.query(
    `SELECT m.id, m.channel_id AS "channelId", m.body AS content, m.kind,
            m.reply_to_id AS "replyToId", m.pinned, m.edited_at AS "editedAt",
            m.created_at AS "createdAt", u.id AS "senderId",
            u.display_name AS username, u.role,
            a.id AS "attachmentId", a.original_name AS "fileName",
            a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes",
            a.duration_seconds AS "durationSeconds"
       FROM chat_messages m
       JOIN chat_members u ON u.id = m.member_id
       LEFT JOIN chat_attachments a ON a.id = m.attachment_id
      WHERE m.id = $1::uuid AND m.deleted_at IS NULL`,
    [id],
  );
  return result.rows[0];
}

function sendEvent(event: Record<string, unknown>) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of listeners) {
    if (response.destroyed || response.writableEnded) {
      listeners.delete(response);
      continue;
    }
    response.write(payload);
  }
}

function validFileContent(mime: string, data: Buffer) {
  if (mime === "image/png") {
    return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mime === "image/gif") {
    const signature = data.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (mime === "image/webp") {
    return data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (mime === "application/pdf") return data.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "audio/webm" || mime === "video/webm") {
    return data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  if (mime === "audio/ogg") return data.subarray(0, 4).toString("ascii") === "OggS";
  if (mime === "audio/mp4" || mime === "audio/m4a") {
    return data.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (mime === "text/plain" || mime === "text/csv" || mime === "text/markdown") {
    return !data.includes(0);
  }
  return false;
}

router.get("/channels", async (_req, res) => {
  try {
    await seedChannels();
    const result = await pool.query(
      `SELECT id, label, description, icon, sort_order AS "sortOrder"
         FROM chat_channels ORDER BY sort_order, label`,
    );
    res.json({ channels: result.rows });
  } catch {
    jsonError(res, 503, "Chat is temporarily unavailable.");
  }
});

router.post("/join", async (req, res) => {
  if (!safeWrite(req, res)) return;
  const rawName = typeof req.body?.username === "string" ? req.body.username : "";
  const displayName = rawName.trim();
  if (displayName.length < 2 || displayName.length > 20 ||
      !/^[\p{L}\p{N}_ -]+$/u.test(displayName) ||
      /^(admin|administrator|moderator|owner|system)$/i.test(displayName)) {
    jsonError(res, 400, "Use 2–20 letters, numbers, spaces, _ or -. Reserved role names are unavailable.");
    return;
  }
  if (!rateLimit(`join:${clientKey(req)}`, 8, 60 * 60 * 1000)) {
    jsonError(res, 429, "Too many join attempts. Please try again later.");
    return;
  }

  const ownerName = process.env.CHAT_OWNER_USERNAME?.trim();
  const setupSecret = process.env.CHAT_OWNER_SETUP_SECRET;
  const providedSecret = typeof req.body?.ownerSetupSecret === "string"
    ? req.body.ownerSetupSecret
    : "";
  const isOwnerName = Boolean(ownerName && displayName.toLowerCase() === ownerName.toLowerCase());
  const secretMatches = Boolean(
    setupSecret &&
    providedSecret &&
    Buffer.byteLength(providedSecret) === Buffer.byteLength(setupSecret) &&
    timingSafeEqual(Buffer.from(providedSecret), Buffer.from(setupSecret)),
  );

  if (isOwnerName && !secretMatches) {
    jsonError(res, 403, "That display name is reserved for the configured owner.");
    return;
  }
  if (secretMatches && !isOwnerName) {
    jsonError(res, 400, "The owner setup code is valid only with the configured owner name.");
    return;
  }

  const usernameKey = displayName.toLocaleLowerCase("en");
  const sessionId = randomUUID();
  if (!sessionSecret()) {
    logger.error({ operation: "join", configuration: "CHAT_SESSION_SECRET" }, "Chat session signing is not configured");
    jsonError(res, 503, "Chat sessions are not configured. Set CHAT_SESSION_SECRET on the server and restart.");
    return;
  }
  const signedSession = signSession(sessionId);
  const avatarIndex = Math.abs(
    [...usernameKey].reduce((hash, char) => (hash * 31 + char.codePointAt(0)!) | 0, 7),
  ) % 6;
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);

  try {
    await seedChannels();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [usernameKey]);
      const duplicate = await client.query(
        `SELECT 1 FROM chat_sessions s
          JOIN chat_members m ON m.id = s.member_id
         WHERE lower(m.display_name) = $1
           AND s.expires_at > NOW()
           AND s.last_seen_at > NOW() - INTERVAL '${onlineWindowSeconds} seconds'
         LIMIT 1`,
        [usernameKey],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        jsonError(res, 409, "That name is already active in the cave.");
        return;
      }
      const existingOwner = await client.query(
        `SELECT id, avatar_index AS "avatarIndex"
           FROM chat_members WHERE role = 'owner' AND lower(display_name) = $1 LIMIT 1`,
        [usernameKey],
      );
      if (existingOwner.rowCount && !secretMatches) {
        await client.query("ROLLBACK");
        jsonError(res, 403, "That display name is reserved for the configured owner.");
        return;
      }
      const memberId = existingOwner.rows[0]?.id ?? randomUUID();
      const role: Role = secretMatches ? "owner" : "member";
      if (!existingOwner.rowCount) {
        await client.query(
          `INSERT INTO chat_members (id, display_name, role, avatar_index)
           VALUES ($1::uuid, $2, $3, $4)`,
          [memberId, displayName, role, avatarIndex],
        );
      }
      await client.query(
        `INSERT INTO chat_sessions (id, member_id, expires_at, last_seen_at)
         VALUES ($1::uuid, $2::uuid, $3, NOW())`,
        [sessionId, memberId, expiresAt],
      );
      await client.query("COMMIT");
      res.cookie(sessionCookie, signedSession, {
        httpOnly: true,
        secure: req.secure,
        sameSite: "strict",
        path: "/",
        maxAge: sessionLifetimeMs,
      });
      res.status(201).json({
        user: { id: memberId, displayName, role, avatarIndex, isBanned: false },
      });
      sendEvent({ type: "members" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logChatFailure("join", error);
    jsonError(res, 503, "Could not join right now. Please try again.");
  }
});

router.get("/session", async (req, res) => {
  try {
    const member = await currentMember(req);
    if (!member || member.isBanned) {
      jsonError(res, 401, "Join the chat to continue.");
      return;
    }
    res.json({ user: member });
  } catch {
    jsonError(res, 503, "Chat is temporarily unavailable.");
  }
});

router.post("/heartbeat", requireMember, (_req, res) => {
  res.json({ ok: true });
});

router.post("/leave", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const id = verifySessionCookie(readCookie(req, sessionCookie));
  if (id) {
    await pool.query("DELETE FROM chat_sessions WHERE id = $1::uuid", [id]);
    sendEvent({ type: "members" });
  }
  res.clearCookie(sessionCookie, { path: "/", sameSite: "strict", secure: req.secure });
  res.status(204).end();
});

router.patch("/profile", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  const displayName = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (displayName.length < 2 || displayName.length > 20 ||
      !/^[\p{L}\p{N}_ -]+$/u.test(displayName) ||
      /^(admin|administrator|moderator|owner|system)$/i.test(displayName)) {
    jsonError(res, 400, "Use 2–20 letters, numbers, spaces, _ or -.");
    return;
  }
  if (!rateLimit(`rename:${member.id}`, 1, 60 * 60 * 1000)) {
    jsonError(res, 429, "You can change your name once per hour.");
    return;
  }
  const nameKey = displayName.toLowerCase();
  if (process.env.CHAT_OWNER_USERNAME?.toLowerCase() === nameKey && member.role !== "owner") {
    jsonError(res, 403, "That display name is reserved.");
    return;
  }
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [nameKey]);
      const duplicate = await client.query(
        `SELECT 1 FROM chat_sessions s JOIN chat_members m ON m.id = s.member_id
          WHERE lower(m.display_name) = $1 AND m.id <> $2::uuid
            AND s.expires_at > NOW()
            AND s.last_seen_at > NOW() - INTERVAL '${onlineWindowSeconds} seconds'
          LIMIT 1`,
        [nameKey, member.id],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        jsonError(res, 409, "That name is already active in the cave.");
        return;
      }
      await client.query(
        "UPDATE chat_members SET display_name = $1 WHERE id = $2::uuid",
        [displayName, member.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await audit(member.id, "profile.rename", member.id, { displayName });
    sendEvent({ type: "members" });
    res.json({ user: { ...member, displayName } });
  } catch {
    jsonError(res, 503, "Could not update your name.");
  }
});

router.get("/messages", requireMember, async (req, res) => {
  const channelId = typeof req.query.channel === "string" ? req.query.channel : "general";
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const before = typeof req.query.before === "string" ? req.query.before : "";
  if (!/^[a-z0-9-]{1,40}$/.test(channelId)) {
    jsonError(res, 400, "Invalid channel.");
    return;
  }
  try {
    const channel = await pool.query("SELECT id FROM chat_channels WHERE id = $1", [channelId]);
    if (!channel.rowCount) {
      jsonError(res, 404, "Channel not found.");
      return;
    }
    const result = await pool.query(
      `SELECT m.id, m.channel_id AS "channelId", m.body AS content, m.kind,
              m.reply_to_id AS "replyToId", m.pinned, m.edited_at AS "editedAt",
              m.created_at AS "createdAt", u.id AS "senderId",
              u.display_name AS username, u.role,
              a.id AS "attachmentId", a.original_name AS "fileName",
              a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes",
              a.duration_seconds AS "durationSeconds"
         FROM chat_messages m
         JOIN chat_members u ON u.id = m.member_id
         LEFT JOIN chat_attachments a ON a.id = m.attachment_id
        WHERE m.channel_id = $1
          AND m.deleted_at IS NULL
          AND ($2 = '' OR m.body ILIKE '%' || $2 || '%')
          AND ($3 = '' OR m.created_at < $3::timestamptz)
        ORDER BY m.created_at DESC LIMIT 60`,
      [channelId, search, before],
    );
    res.json({ messages: result.rows.reverse() });
  } catch {
    jsonError(res, 503, "Could not load messages.");
  }
});

router.post("/messages", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  const channelId = typeof req.body?.channelId === "string" ? req.body.channelId : "general";
  const body = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  const attachmentId = typeof req.body?.attachmentId === "string" ? req.body.attachmentId : null;
  const replyToId = typeof req.body?.replyToId === "string" ? req.body.replyToId : null;
  if (!/^[a-z0-9-]{1,40}$/.test(channelId)) {
    jsonError(res, 400, "Invalid channel.");
    return;
  }
  if (body.length > maxMessageLength || (!body && !attachmentId)) {
    jsonError(res, 400, `Messages must contain text or an attachment and stay under ${maxMessageLength} characters.`);
    return;
  }
  if (!rateLimit(`message:${member.id}`, 5, 8000)) {
    jsonError(res, 429, "Slow down a little before sending another message.");
    return;
  }
  if (member.mutedUntil && new Date(member.mutedUntil).getTime() > Date.now()) {
    jsonError(res, 403, "You are muted until your restriction expires.");
    return;
  }
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const channel = await client.query("SELECT id FROM chat_channels WHERE id = $1", [channelId]);
      if (!channel.rowCount) {
        await client.query("ROLLBACK");
        jsonError(res, 404, "Channel not found.");
        return;
      }
      let kind = "text";
      if (attachmentId) {
        const attachment = await client.query(
          `SELECT id, mime_type FROM chat_attachments
            WHERE id = $1::uuid AND member_id = $2::uuid`,
          [attachmentId, member.id],
        );
        if (!attachment.rowCount) {
          await client.query("ROLLBACK");
          jsonError(res, 404, "Attachment not found.");
          return;
        }
        kind = attachment.rows[0].mime_type.startsWith("audio/") ? "voice" : "attachment";
      }
      if (replyToId) {
        const reply = await client.query(
          "SELECT id FROM chat_messages WHERE id = $1::uuid AND channel_id = $2 AND deleted_at IS NULL",
          [replyToId, channelId],
        );
        if (!reply.rowCount) {
          await client.query("ROLLBACK");
          jsonError(res, 404, "The message being replied to no longer exists.");
          return;
        }
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO chat_messages
          (id, channel_id, member_id, body, kind, attachment_id, reply_to_id)
         VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid, $7::uuid)`,
        [id, channelId, member.id, body, kind, attachmentId, replyToId],
      );
      await client.query("COMMIT");
      const message = await messageById(id);
      sendEvent({ type: "message", message });
      res.status(201).json({ message });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch {
    jsonError(res, 503, "Could not send your message.");
  }
});

router.patch("/messages/:id", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  const id = routeId(req);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (content.length > maxMessageLength || !content) {
    jsonError(res, 400, `Enter a message under ${maxMessageLength} characters.`);
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE chat_messages SET body = $1, edited_at = NOW()
        WHERE id = $2::uuid AND member_id = $3::uuid
          AND kind = 'text' AND deleted_at IS NULL
          AND created_at > NOW() - INTERVAL '15 minutes'
        RETURNING id, channel_id AS "channelId"`,
      [content, id, member.id],
    );
    if (!result.rowCount) {
      jsonError(res, 404, "This message can no longer be edited.");
      return;
    }
    const message = await messageById(id);
    sendEvent({ type: "message:update", message });
    res.json({ message });
  } catch {
    jsonError(res, 503, "Could not edit this message.");
  }
});

router.delete("/messages/:id", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  const id = routeId(req);
  try {
    const existing = await pool.query(
      "SELECT id, member_id AS \"memberId\", channel_id AS \"channelId\" FROM chat_messages WHERE id = $1::uuid AND deleted_at IS NULL",
      [id],
    );
    const message = existing.rows[0];
    if (!message) {
      jsonError(res, 404, "Message not found.");
      return;
    }
    if (message.memberId !== member.id && !canModerate(member.role)) {
      jsonError(res, 403, "You can only delete your own messages.");
      return;
    }
    await pool.query("UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1::uuid", [id]);
    if (message.memberId !== member.id) {
      await audit(member.id, "message.delete", id, { channelId: message.channelId });
    }
    sendEvent({ type: "message:delete", id, channelId: message.channelId });
    res.status(204).end();
  } catch {
    jsonError(res, 503, "Could not delete this message.");
  }
});

router.post("/messages/:id/pin", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  const id = routeId(req);
  if (!canManageServer(member.role)) {
    jsonError(res, 403, "Only server admins can pin messages.");
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE chat_messages SET pinned = NOT pinned
        WHERE id = $1::uuid AND deleted_at IS NULL
        RETURNING id, channel_id AS "channelId", pinned`,
      [id],
    );
    if (!result.rowCount) {
      jsonError(res, 404, "Message not found.");
      return;
    }
    await audit(member.id, result.rows[0].pinned ? "message.pin" : "message.unpin", id);
    sendEvent({ type: "message:pin", ...result.rows[0] });
    res.json(result.rows[0]);
  } catch {
    jsonError(res, 503, "Could not update the pin.");
  }
});

router.post("/messages/:id/report", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  const id = routeId(req);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 240) : "";
  if (!rateLimit(`report:${member.id}`, 3, 60 * 60 * 1000)) {
    jsonError(res, 429, "You have reached the report limit for this hour.");
    return;
  }
  try {
    const exists = await pool.query(
      "SELECT id FROM chat_messages WHERE id = $1::uuid AND deleted_at IS NULL",
      [id],
    );
    if (!exists.rowCount) {
      jsonError(res, 404, "Message not found.");
      return;
    }
    await audit(member.id, "message.report", id, { reason });
    res.status(201).json({ ok: true });
  } catch {
    jsonError(res, 503, "Could not submit the report.");
  }
});

router.get("/members", requireMember, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.display_name AS "displayName", m.role,
              m.avatar_index AS "avatarIndex", MAX(s.last_seen_at) AS "lastSeenAt",
              BOOL_OR(s.id IS NOT NULL AND s.last_seen_at > NOW() - INTERVAL '${onlineWindowSeconds} seconds') AS online
         FROM chat_members m
         LEFT JOIN chat_sessions s ON s.member_id = m.id AND s.expires_at > NOW()
        GROUP BY m.id
        ORDER BY online DESC, lower(m.display_name)
        LIMIT 80`,
    );
    res.json({ members: result.rows });
  } catch {
    jsonError(res, 503, "Could not load members.");
  }
});

router.post("/typing", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  const channelId = typeof req.body?.channelId === "string" ? req.body.channelId : "";
  if (!/^[a-z0-9-]{1,40}$/.test(channelId)) {
    jsonError(res, 400, "Invalid channel.");
    return;
  }
  if (!rateLimit(`typing:${member.id}`, 1, 1800)) {
    res.status(204).end();
    return;
  }
  try {
    const channel = await pool.query("SELECT id FROM chat_channels WHERE id = $1", [channelId]);
    if (!channel.rowCount) {
      jsonError(res, 404, "Channel not found.");
      return;
    }
    sendEvent({
      type: "typing",
      channelId,
      memberId: member.id,
      displayName: member.displayName,
    });
    res.status(204).end();
  } catch (error) {
    logChatFailure("typing", error);
    jsonError(res, 503, "Could not send typing status.");
  }
});

router.get("/events", requireMember, (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
  listeners.add(res);
  const heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      clearInterval(heartbeat);
      listeners.delete(res);
      return;
    }
    res.write(": keepalive\n\n");
  }, 20_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    listeners.delete(res);
  });
});

router.get("/notice", requireMember, async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT value, updated_at AS \"updatedAt\" FROM chat_room_settings WHERE key = 'notice'",
    );
    res.json({ notice: result.rows[0]?.value?.text ?? "" });
  } catch {
    jsonError(res, 503, "Could not load the room notice.");
  }
});

router.put("/notice", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  if (!canManageServer(member.role)) {
    jsonError(res, 403, "Only server admins can change the room notice.");
    return;
  }
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 300) : "";
  try {
    await pool.query(
      `INSERT INTO chat_room_settings (key, value, updated_at)
       VALUES ('notice', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ text })],
    );
    await audit(member.id, "notice.update", null);
    sendEvent({ type: "notice", text });
    res.json({ notice: text });
  } catch {
    jsonError(res, 503, "Could not update the room notice.");
  }
});

router.post("/channels", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const member = memberFrom(res);
  if (!canManageServer(member.role)) {
    jsonError(res, 403, "Only server admins can add channels.");
    return;
  }
  const label = typeof req.body?.label === "string" ? req.body.label.trim().toLowerCase() : "";
  const id = label.replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  if (id.length < 2) {
    jsonError(res, 400, "Use a channel name with at least two letters or numbers.");
    return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO chat_channels (id, label, description, icon, sort_order)
       VALUES ($1, $2, 'A new cave channel.', 'chat', 20)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, label, description, icon, sort_order AS "sortOrder"`,
      [id, label.slice(0, 32)],
    );
    if (!result.rowCount) {
      jsonError(res, 409, "That channel already exists.");
      return;
    }
    await audit(member.id, "channel.create", id);
    sendEvent({ type: "channels" });
    res.status(201).json({ channel: result.rows[0] });
  } catch {
    jsonError(res, 503, "Could not create this channel.");
  }
});

router.post("/members/:id/role", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const actor = memberFrom(res);
  const targetId = routeId(req);
  const role = req.body?.role as Role;
  if (actor.role !== "owner" || !roles.includes(role) || role === "owner") {
    jsonError(res, 403, "Only the owner can manage member roles; owner status cannot be granted here.");
    return;
  }
  try {
    const target = await pool.query(
      "SELECT id, role FROM chat_members WHERE id = $1::uuid",
      [targetId],
    );
    if (!target.rowCount) {
      jsonError(res, 404, "Member not found.");
      return;
    }
    if (target.rows[0].role === "owner") {
      jsonError(res, 403, "The owner role cannot be changed here.");
      return;
    }
    await pool.query(
      "UPDATE chat_members SET role = $1 WHERE id = $2::uuid",
      [role, targetId],
    );
    await audit(actor.id, "member.role", targetId, { role });
    sendEvent({ type: "members" });
    res.json({ ok: true });
  } catch {
    jsonError(res, 503, "Could not update this member.");
  }
});

router.post("/members/:id/moderate", requireMember, async (req, res) => {
  if (!safeWrite(req, res)) return;
  const actor = memberFrom(res);
  const targetId = routeId(req);
  const action = req.body?.action;
  if (!["mute", "unmute", "ban", "unban", "kick"].includes(action)) {
    jsonError(res, 400, "Invalid moderation action.");
    return;
  }
  const allowed = action === "mute" || action === "unmute"
    ? canModerate(actor.role)
    : canManageServer(actor.role);
  if (!allowed) {
    jsonError(res, 403, "You do not have permission to use that moderation action.");
    return;
  }
  try {
    const target = await pool.query(
      "SELECT id, role FROM chat_members WHERE id = $1::uuid",
      [targetId],
    );
    if (!target.rowCount) {
      jsonError(res, 404, "Member not found.");
      return;
    }
    if (target.rows[0].role === "owner" || targetId === actor.id) {
      jsonError(res, 403, "You cannot moderate the owner or yourself.");
      return;
    }
    if (action === "mute") {
      await pool.query(
        "UPDATE chat_members SET muted_until = NOW() + INTERVAL '10 minutes' WHERE id = $1::uuid",
        [targetId],
      );
    } else if (action === "unmute") {
      await pool.query("UPDATE chat_members SET muted_until = NULL WHERE id = $1::uuid", [targetId]);
    } else if (action === "ban") {
      await pool.query("UPDATE chat_members SET is_banned = TRUE WHERE id = $1::uuid", [targetId]);
      await pool.query("DELETE FROM chat_sessions WHERE member_id = $1::uuid", [targetId]);
    } else if (action === "unban") {
      await pool.query("UPDATE chat_members SET is_banned = FALSE WHERE id = $1::uuid", [targetId]);
    } else {
      await pool.query("DELETE FROM chat_sessions WHERE member_id = $1::uuid", [targetId]);
    }
    await audit(actor.id, `member.${action}`, targetId);
    sendEvent({ type: "members" });
    res.json({ ok: true });
  } catch {
    jsonError(res, 503, "Could not complete that moderation action.");
  }
});

router.get("/audit", requireMember, async (_req, res) => {
  const actor = memberFrom(res);
  if (!canManageServer(actor.role)) {
    jsonError(res, 403, "Only server admins can view audit history.");
    return;
  }
  try {
    const result = await pool.query(
      `SELECT l.id, l.action, l.target_id AS "targetId", l.details,
              l.created_at AS "createdAt", m.display_name AS "actorName"
         FROM chat_audit_log l LEFT JOIN chat_members m ON m.id = l.actor_id
        ORDER BY l.created_at DESC LIMIT 100`,
    );
    res.json({ events: result.rows });
  } catch {
    jsonError(res, 503, "Could not load the audit history.");
  }
});

router.post(
  "/uploads",
  requireMember,
  (req, res, next) => {
    if (!safeWrite(req, res)) return;
    next();
  },
  (req, res, next) => {
    import("express")
      .then(({ default: express }) =>
        express.raw({ type: "*/*", limit: maxUploadBytes })(req, res, next),
      )
      .catch(() => jsonError(res, 500, "Could not prepare the upload."));
  },
  async (req, res) => {
    const member = memberFrom(res);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      jsonError(res, 400, "The selected file is empty.");
      return;
    }
    if (req.body.length > maxUploadBytes) {
      jsonError(res, 413, "Files must be 8 MB or smaller.");
      return;
    }
    const mimeType = (req.get("x-chat-file-type") || req.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!validFileContent(mimeType, req.body)) {
      jsonError(res, 415, "This file type is not supported or its contents do not match its type.");
      return;
    }
    const originalName = decodeURIComponent(req.get("x-chat-file-name") || "attachment")
      .replace(/[\\/\0-\x1f\x7f]/g, "_")
      .trim()
      .slice(0, 120) || "attachment";
    const durationValue = Number(req.get("x-chat-duration"));
    const duration = Number.isFinite(durationValue)
      ? Math.min(180, Math.max(0, Math.round(durationValue)))
      : null;
    const extensionByType: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "application/pdf": ".pdf",
      "text/plain": ".txt",
      "text/csv": ".csv",
      "text/markdown": ".md",
      "audio/webm": ".webm",
      "video/webm": ".webm",
      "audio/ogg": ".ogg",
      "audio/mp4": ".m4a",
      "audio/m4a": ".m4a",
    };
    const id = randomUUID();
    const storedName = `${id}${extensionByType[mimeType]}`;
    try {
      await mkdir(storageRoot, { recursive: true });
      await writeFile(path.join(storageRoot, storedName), req.body, { flag: "wx" });
      await pool.query(
        `INSERT INTO chat_attachments
          (id, member_id, stored_name, original_name, mime_type, size_bytes, duration_seconds)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
        [id, member.id, storedName, originalName, mimeType, req.body.length, duration],
      );
      res.status(201).json({
        attachment: {
          id,
          fileName: originalName,
          mimeType,
          sizeBytes: req.body.length,
          durationSeconds: duration,
        },
      });
    } catch {
      await unlink(path.join(storageRoot, storedName)).catch(() => undefined);
      jsonError(res, 503, "Could not save this file.");
    }
  },
);

router.get("/files/:id", requireMember, async (req, res) => {
  const id = routeId(req);
  try {
    const result = await pool.query(
      `SELECT stored_name AS "storedName", original_name AS "originalName",
              mime_type AS "mimeType"
         FROM chat_attachments WHERE id = $1::uuid`,
      [id],
    );
    const file = result.rows[0];
    if (!file) {
      jsonError(res, 404, "File not found.");
      return;
    }
    const data = await readFile(path.join(storageRoot, file.storedName));
    const safeName = String(file.originalName).replace(/["\\\r\n]/g, "_");
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.setHeader("Content-Length", data.length);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(data);
  } catch {
    jsonError(res, 404, "File is unavailable.");
  }
});

export default router;
