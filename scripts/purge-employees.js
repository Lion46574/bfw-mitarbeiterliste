const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..", "data");
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDir, "database.sqlite");

if (!fs.existsSync(dbPath)) {
  console.log("Keine database.sqlite gefunden unter:", dbPath);
  process.exit(0);
}

const db = new Database(dbPath);
db.exec(`
  DELETE FROM employee_positions;
  DELETE FROM employee_functions;
  DELETE FROM employee_trainings;
  DELETE FROM employees;
`);

const remaining = db.prepare("SELECT COUNT(*) c FROM employees").get().c;
console.log("Uebrig gebliebene Mitarbeiter:", remaining);
