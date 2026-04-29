import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      github_number INTEGER NOT NULL,
      github_item_type TEXT NOT NULL CHECK (github_item_type IN ('issue','pull_request')),
      discord_thread_id TEXT NOT NULL UNIQUE,
      discord_forum_channel_id TEXT NOT NULL,
      last_seen_comment_id INTEGER NOT NULL DEFAULT 0,
      github_node_id TEXT,
      internal_pin_message_id TEXT,
      internal_notes TEXT,
      internal_status TEXT,
      internal_priority TEXT,
      discord_handled_at INTEGER,
      UNIQUE(owner, repo, github_number, github_item_type)
    );

    CREATE TABLE IF NOT EXISTS outbound_github_comment (
      github_comment_id INTEGER NOT NULL PRIMARY KEY,
      discord_message_id TEXT NOT NULL,
      discord_thread_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_users (
      discord_user_id TEXT PRIMARY KEY,
      github_user_id TEXT,
      encrypted_refresh_token TEXT,
      scopes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tracked_owner_repo ON tracked_threads(owner, repo);
    CREATE INDEX IF NOT EXISTS idx_tracked_thread ON tracked_threads(discord_thread_id);
  `);

  const col = db
    .prepare(`SELECT name FROM pragma_table_info('tracked_threads') WHERE name = ?`)
    .get("github_reflected_state") as { name: string } | undefined;
  if (!col) {
    db.exec(`ALTER TABLE tracked_threads ADD COLUMN github_reflected_state TEXT`);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_outbound_discord_msg ON outbound_github_comment(discord_message_id);`);
}

export type TrackedThread = {
  id: number;
  owner: string;
  repo: string;
  github_number: number;
  github_item_type: "issue" | "pull_request";
  discord_thread_id: string;
  discord_forum_channel_id: string;
  last_seen_comment_id: number;
  internal_pin_message_id: string | null;
  internal_notes: string | null;
  internal_status: string | null;
  internal_priority: string | null;
  /** Last GitHub `state` we mirrored to Discord (`open` | `closed`); null = not yet synced */
  github_reflected_state: string | null;
};
