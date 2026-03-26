const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDir, "database.sqlite");

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('editor','admin')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const users = [
  { username: "Logerhauser", password: "2501", role: "editor" },
  { username: "Hirsch", password: "0109", role: "editor" },
  { username: "Steiner", password: "1508", role: "editor" },
  { username: "Mickel", password: "1501", role: "editor" },
  { username: "Schulz", password: "3101", role: "editor" },
];

const existingUserStmt = db.prepare("SELECT id FROM users WHERE username = ?");
const updateUserStmt = db.prepare(
  "UPDATE users SET password_hash = ?, role = ?, is_active = 1 WHERE id = ?"
);
const insertUserStmt = db.prepare(
  "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)"
);

for (const user of users) {
  const hash = bcrypt.hashSync(user.password, 10);
  const existing = existingUserStmt.get(user.username);
  if (existing) {
    updateUserStmt.run(hash, user.role, existing.id);
    console.log(`updated: ${user.username}`);
  } else {
    insertUserStmt.run(user.username, hash, user.role);
    console.log(`created: ${user.username}`);
  }
}

console.log("Fertig: Benutzer wurden erfolgreich angelegt/aktualisiert.");
