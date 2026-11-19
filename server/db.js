import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
fs.mkdirSync(directory, { recursive: true });
export const db = new Database(path.join(directory, 'chatai.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((room_id IS NOT NULL AND recipient_id IS NULL) OR (room_id IS NULL AND recipient_id IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(sender_id, recipient_id, created_at);
`);

const seed = db.prepare('INSERT OR IGNORE INTO rooms (name, description) VALUES (?, ?)');
[['general', 'The place for general conversation'], ['random', 'Anything and everything'], ['tech', 'Talk software, hardware, and ideas']]
  .forEach(([name, description]) => seed.run(name, description));
