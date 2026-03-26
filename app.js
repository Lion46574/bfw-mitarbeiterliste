const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const livereload = require("livereload");
const connectLivereload = require("connect-livereload");

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDir, "database.sqlite");
const sessionDbPath = process.env.SESSION_DB_PATH
  ? path.resolve(process.env.SESSION_DB_PATH)
  : path.join(dataDir, "sessions.sqlite");
fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });

const legacyDbPath = path.join(__dirname, "database.sqlite");
const legacySessionPath = path.join(__dirname, "sessions.sqlite");
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  fs.copyFileSync(legacyDbPath, dbPath);
}
if (!fs.existsSync(sessionDbPath) && fs.existsSync(legacySessionPath)) {
  fs.copyFileSync(legacySessionPath, sessionDbPath);
}

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

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    department TEXT,
    position TEXT,
    notes TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS employee_positions (
    employee_id INTEGER NOT NULL,
    position_id INTEGER NOT NULL,
    PRIMARY KEY (employee_id, position_id),
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(position_id) REFERENCES positions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS functions_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trainings_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS employee_functions (
    employee_id INTEGER NOT NULL,
    function_id INTEGER NOT NULL,
    PRIMARY KEY (employee_id, function_id),
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(function_id) REFERENCES functions_catalog(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS employee_trainings (
    employee_id INTEGER NOT NULL,
    training_id INTEGER NOT NULL,
    PRIMARY KEY (employee_id, training_id),
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(training_id) REFERENCES trainings_catalog(id) ON DELETE CASCADE
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some((column) => column.name === "is_active")) {
  db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
}

const employeeColumns = db.prepare("PRAGMA table_info(employees)").all();
if (!employeeColumns.some((column) => column.name === "functions_text")) {
  db.exec("ALTER TABLE employees ADD COLUMN functions_text TEXT");
}
if (!employeeColumns.some((column) => column.name === "trainings_text")) {
  db.exec("ALTER TABLE employees ADD COLUMN trainings_text TEXT");
}

function seedDefaultOptions() {
  const defaultDepartments = ["MA-68-Leopoldstadt", "MA-68-Zentral"];
  const defaultPositions = [
    "PFM-Provisorischerfeuewerhmann",
    "FM-Feuwehrmann",
    "OFM-Obefeuerwehrmann",
  ];

  const insertDepartment = db.prepare("INSERT OR IGNORE INTO departments (name) VALUES (?)");
  const insertPosition = db.prepare("INSERT OR IGNORE INTO positions (name) VALUES (?)");
  const insertFunction = db.prepare("INSERT OR IGNORE INTO functions_catalog (name) VALUES (?)");
  const insertTraining = db.prepare("INSERT OR IGNORE INTO trainings_catalog (name) VALUES (?)");

  defaultDepartments.forEach((name) => insertDepartment.run(name));
  defaultPositions.forEach((name) => insertPosition.run(name));
  ["Gruppenkommandant", "Maschinist", "ATS/KS"].forEach((name) => insertFunction.run(name));
  ["Atemschutz", "Funklehrgang"].forEach((name) => insertTraining.run(name));
}

function createDefaultAdmin() {
  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASS || "admin123!";
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUser);

  if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare("INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'admin', 1)")
      .run(adminUser, hash);
    console.log("Default-Admin erstellt:");
    console.log(`Benutzer: ${adminUser}`);
    if (!process.env.ADMIN_PASS) {
      console.log("Passwort: admin123! (bitte sofort nach dem Login aendern)");
    }
  }
}

createDefaultAdmin();
seedDefaultOptions();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));

if (process.env.ENABLE_LIVERELOAD === "true") {
  const liveReloadServer = livereload.createServer();
  liveReloadServer.watch([
    path.join(__dirname, "views"),
    path.join(__dirname, "public"),
    path.join(__dirname, "app.js"),
  ]);
  app.use(connectLivereload());
}

app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new SQLiteStore({
      db: path.basename(sessionDbPath),
      dir: path.dirname(sessionDbPath),
    }),
    secret: process.env.SESSION_SECRET || "bfw-mitarbeiter-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use((req, res, next) => {
  if (req.session.userId) {
    const user = db
      .prepare("SELECT id, username, role, is_active FROM users WHERE id = ?")
      .get(req.session.userId);
    req.user = user || null;
  } else {
    req.user = null;
  }
  res.locals.user = req.user;
  res.locals.departments = [];
  res.locals.positions = [];
  res.locals.selectedPositionIds = [];
  res.locals.filters = { q: "", department: "" };
  next();
});

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect("/login");
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).render("forbidden");
  return next();
}

function getDepartments() {
  return db.prepare("SELECT id, name FROM departments ORDER BY name ASC").all();
}

function getPositions() {
  return db.prepare("SELECT id, name FROM positions ORDER BY name ASC").all();
}

function getFunctionsCatalog() {
  return db.prepare("SELECT id, name FROM functions_catalog ORDER BY name ASC").all();
}

function getTrainingsCatalog() {
  return db.prepare("SELECT id, name FROM trainings_catalog ORDER BY name ASC").all();
}

function renderAdminSettings(res, payload = {}) {
  const departments = getDepartments();
  const positions = getPositions();
  const functionsCatalog = getFunctionsCatalog();
  const trainingsCatalog = getTrainingsCatalog();
  return res.render("admin-settings", {
    departments,
    positions,
    functionsCatalog,
    trainingsCatalog,
    error: payload.error || null,
    success: payload.success || null,
  });
}

function normalizeSelectedIds(rawValue) {
  if (!rawValue) return [];
  const list = Array.isArray(rawValue) ? rawValue : [rawValue];
  return [...new Set(list.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

function getSelectedPositionIdsFromBody(body) {
  return normalizeSelectedIds(body.position_ids || body["position_ids[]"]);
}

function getSelectedFunctionIdsFromBody(body) {
  return normalizeSelectedIds(body.function_ids || body["function_ids[]"]);
}

function getSelectedTrainingIdsFromBody(body) {
  return normalizeSelectedIds(body.training_ids || body["training_ids[]"]);
}

app.get("/", (req, res) => {
  const queryText = (req.query.q || "").trim();
  const departmentFilter = (req.query.department || "").trim();
  const whereParts = [];
  const params = [];

  if (queryText) {
    whereParts.push(`(
      LOWER(e.first_name) LIKE LOWER(?) OR
      LOWER(e.last_name) LIKE LOWER(?) OR
      EXISTS (
        SELECT 1
        FROM employee_positions ep2
        JOIN positions p2 ON p2.id = ep2.position_id
        WHERE ep2.employee_id = e.id
          AND LOWER(p2.name) LIKE LOWER(?)
      ) OR EXISTS (
        SELECT 1
        FROM employee_functions ef2
        JOIN functions_catalog f2 ON f2.id = ef2.function_id
        WHERE ef2.employee_id = e.id
          AND LOWER(f2.name) LIKE LOWER(?)
      ) OR EXISTS (
        SELECT 1
        FROM employee_trainings et2
        JOIN trainings_catalog t2 ON t2.id = et2.training_id
        WHERE et2.employee_id = e.id
          AND LOWER(t2.name) LIKE LOWER(?)
      )
    )`);
    const wildcard = `%${queryText}%`;
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard);
  }

  if (departmentFilter) {
    whereParts.push("LOWER(e.department) = LOWER(?)");
    params.push(departmentFilter);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const employees = db
    .prepare(
      `SELECT e.id, e.first_name, e.last_name, e.department, e.position,
              (SELECT GROUP_CONCAT(p.name, ', ')
               FROM employee_positions ep
               JOIN positions p ON p.id = ep.position_id
               WHERE ep.employee_id = e.id) AS dienstgrade,
              (SELECT GROUP_CONCAT(f.name, ', ')
               FROM employee_functions ef
               JOIN functions_catalog f ON f.id = ef.function_id
               WHERE ef.employee_id = e.id) AS functions_text,
              (SELECT GROUP_CONCAT(t.name, ', ')
               FROM employee_trainings et
               JOIN trainings_catalog t ON t.id = et.training_id
               WHERE et.employee_id = e.id) AS trainings_text,
              e.created_at, e.updated_at, u.username AS creator
       FROM employees e
       JOIN users u ON u.id = e.created_by
       ${whereSql}
       ORDER BY e.last_name ASC, e.first_name ASC`
    )
    .all(...params);

  const departments = db
    .prepare(
      `SELECT DISTINCT department
       FROM employees
       WHERE department IS NOT NULL AND department != ''
       ORDER BY department ASC`
    )
    .all()
    .map((row) => row.department);

  res.render("index", {
    employees,
    filters: {
      q: queryText,
      department: departmentFilter,
    },
    departments,
  });
});

app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  return res.render("login", { error: null });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (user && !user.is_active) {
    return res.status(403).render("login", { error: "Dieses Konto ist deaktiviert." });
  }
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render("login", { error: "Ungueltiger Benutzername oder Passwort." });
  }
  req.session.userId = user.id;
  return res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/account/password", requireLogin, (req, res) => {
  res.render("change-password", { error: null, success: null });
});

app.get("/password", requireLogin, (req, res) => {
  res.render("change-password", { error: null, success: null });
});

app.post("/account/password", requireLogin, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).render("change-password", {
      error: "Bitte alle Felder ausfuellen.",
      success: null,
    });
  }
  if (new_password.length < 8) {
    return res.status(400).render("change-password", {
      error: "Das neue Passwort muss mindestens 8 Zeichen haben.",
      success: null,
    });
  }
  if (new_password !== confirm_password) {
    return res.status(400).render("change-password", {
      error: "Neues Passwort und Bestaetigung stimmen nicht ueberein.",
      success: null,
    });
  }

  const fullUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!fullUser || !bcrypt.compareSync(current_password, fullUser.password_hash)) {
    return res.status(401).render("change-password", {
      error: "Aktuelles Passwort ist falsch.",
      success: null,
    });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, req.user.id);
  return res.render("change-password", {
    error: null,
    success: "Passwort wurde erfolgreich geaendert.",
  });
});

app.post("/password", requireLogin, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).render("change-password", {
      error: "Bitte alle Felder ausfuellen.",
      success: null,
    });
  }
  if (new_password.length < 8) {
    return res.status(400).render("change-password", {
      error: "Das neue Passwort muss mindestens 8 Zeichen haben.",
      success: null,
    });
  }
  if (new_password !== confirm_password) {
    return res.status(400).render("change-password", {
      error: "Neues Passwort und Bestaetigung stimmen nicht ueberein.",
      success: null,
    });
  }

  const fullUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!fullUser || !bcrypt.compareSync(current_password, fullUser.password_hash)) {
    return res.status(401).render("change-password", {
      error: "Aktuelles Passwort ist falsch.",
      success: null,
    });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, req.user.id);
  return res.render("change-password", {
    error: null,
    success: "Passwort wurde erfolgreich geaendert.",
  });
});

app.get("/employees/new", requireLogin, (req, res) => {
  res.render("employee-form", {
    employee: null,
    error: null,
    departments: getDepartments(),
    positions: getPositions(),
    functionsCatalog: getFunctionsCatalog(),
    trainingsCatalog: getTrainingsCatalog(),
  });
});

app.post("/employees", requireLogin, (req, res) => {
  const { first_name, last_name, department } = req.body;
  const selectedPositionIds = getSelectedPositionIdsFromBody(req.body);
  const selectedFunctionIds = getSelectedFunctionIdsFromBody(req.body);
  const selectedTrainingIds = getSelectedTrainingIdsFromBody(req.body);
  if (!first_name || !last_name) {
    return res.status(400).render("employee-form", {
      employee: req.body,
      error: "Vorname und Nachname sind Pflichtfelder.",
      departments: getDepartments(),
      positions: getPositions(),
      functionsCatalog: getFunctionsCatalog(),
      trainingsCatalog: getTrainingsCatalog(),
      selectedPositionIds,
      selectedFunctionIds,
      selectedTrainingIds,
    });
  }

  try {
    const inserted = db.prepare(
      `INSERT INTO employees
       (first_name, last_name, department, position, functions_text, trainings_text, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      first_name.trim(),
      last_name.trim(),
      department || "",
      "",
      "",
      "",
      req.user.id
    );

    const insertEmployeePosition = db.prepare(
      "INSERT OR IGNORE INTO employee_positions (employee_id, position_id) VALUES (?, ?)"
    );
    selectedPositionIds.forEach((positionId) => {
      insertEmployeePosition.run(inserted.lastInsertRowid, positionId);
    });

    const insertEmployeeFunction = db.prepare(
      "INSERT OR IGNORE INTO employee_functions (employee_id, function_id) VALUES (?, ?)"
    );
    selectedFunctionIds.forEach((functionId) => {
      insertEmployeeFunction.run(inserted.lastInsertRowid, functionId);
    });

    const insertEmployeeTraining = db.prepare(
      "INSERT OR IGNORE INTO employee_trainings (employee_id, training_id) VALUES (?, ?)"
    );
    selectedTrainingIds.forEach((trainingId) => {
      insertEmployeeTraining.run(inserted.lastInsertRowid, trainingId);
    });
  } catch (err) {
    console.error("Fehler beim Anlegen eines Mitarbeiters:", err);
    return res.status(500).render("employee-form", {
      employee: req.body,
      error: "Mitarbeiter konnte nicht gespeichert werden. Bitte spaeter erneut versuchen.",
      departments: getDepartments(),
      positions: getPositions(),
      functionsCatalog: getFunctionsCatalog(),
      trainingsCatalog: getTrainingsCatalog(),
      selectedPositionIds,
      selectedFunctionIds,
      selectedTrainingIds,
    });
  }

  return res.redirect("/");
});

app.get("/employees/:id", (req, res) => {
  const employee = db
    .prepare(
      `SELECT e.id, e.first_name, e.last_name, e.department, u.username AS creator
       FROM employees e
       JOIN users u ON u.id = e.created_by
       WHERE e.id = ?`
    )
    .get(req.params.id);

  if (!employee) return res.status(404).send("Mitarbeiter nicht gefunden.");

  const dienstgrade = db
    .prepare(
      `SELECT p.name
       FROM employee_positions ep
       JOIN positions p ON p.id = ep.position_id
       WHERE ep.employee_id = ?
       ORDER BY p.name ASC`
    )
    .all(req.params.id)
    .map((row) => row.name);

  const funktionen = db
    .prepare(
      `SELECT f.name
       FROM employee_functions ef
       JOIN functions_catalog f ON f.id = ef.function_id
       WHERE ef.employee_id = ?
       ORDER BY f.name ASC`
    )
    .all(req.params.id)
    .map((row) => row.name);

  const ausbildungen = db
    .prepare(
      `SELECT t.name
       FROM employee_trainings et
       JOIN trainings_catalog t ON t.id = et.training_id
       WHERE et.employee_id = ?
       ORDER BY t.name ASC`
    )
    .all(req.params.id)
    .map((row) => row.name);

  return res.render("employee-details", {
    employee,
    dienstgrade,
    funktionen,
    ausbildungen,
  });
});

app.get("/employees/:id/edit", requireLogin, (req, res) => {
  const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(req.params.id);
  if (!employee) return res.status(404).send("Mitarbeiter nicht gefunden.");
  const selectedPositionIds = db
    .prepare("SELECT position_id FROM employee_positions WHERE employee_id = ?")
    .all(req.params.id)
    .map((row) => row.position_id);
  const selectedFunctionIds = db
    .prepare("SELECT function_id FROM employee_functions WHERE employee_id = ?")
    .all(req.params.id)
    .map((row) => row.function_id);
  const selectedTrainingIds = db
    .prepare("SELECT training_id FROM employee_trainings WHERE employee_id = ?")
    .all(req.params.id)
    .map((row) => row.training_id);
  return res.render("employee-form", {
    employee,
    error: null,
    departments: getDepartments(),
    positions: getPositions(),
    functionsCatalog: getFunctionsCatalog(),
    trainingsCatalog: getTrainingsCatalog(),
    selectedPositionIds,
    selectedFunctionIds,
    selectedTrainingIds,
  });
});

app.post("/employees/:id/edit", requireLogin, (req, res) => {
  const { first_name, last_name, department } = req.body;
  const selectedPositionIds = getSelectedPositionIdsFromBody(req.body);
  const selectedFunctionIds = getSelectedFunctionIdsFromBody(req.body);
  const selectedTrainingIds = getSelectedTrainingIdsFromBody(req.body);
  if (!first_name || !last_name) {
    return res.status(400).render("employee-form", {
      employee: { id: req.params.id, ...req.body },
      error: "Vorname und Nachname sind Pflichtfelder.",
      departments: getDepartments(),
      positions: getPositions(),
      functionsCatalog: getFunctionsCatalog(),
      trainingsCatalog: getTrainingsCatalog(),
      selectedPositionIds,
      selectedFunctionIds,
      selectedTrainingIds,
    });
  }

  try {
    db.prepare(
      `UPDATE employees
       SET first_name = ?, last_name = ?, department = ?, position = ?,
           functions_text = ?, trainings_text = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      first_name.trim(),
      last_name.trim(),
      department || "",
      "",
      "",
      "",
      req.params.id
    );

    db.prepare("DELETE FROM employee_positions WHERE employee_id = ?").run(req.params.id);
    const insertEmployeePosition = db.prepare(
      "INSERT OR IGNORE INTO employee_positions (employee_id, position_id) VALUES (?, ?)"
    );
    selectedPositionIds.forEach((positionId) => {
      insertEmployeePosition.run(req.params.id, positionId);
    });

    db.prepare("DELETE FROM employee_functions WHERE employee_id = ?").run(req.params.id);
    const insertEmployeeFunction = db.prepare(
      "INSERT OR IGNORE INTO employee_functions (employee_id, function_id) VALUES (?, ?)"
    );
    selectedFunctionIds.forEach((functionId) => {
      insertEmployeeFunction.run(req.params.id, functionId);
    });

    db.prepare("DELETE FROM employee_trainings WHERE employee_id = ?").run(req.params.id);
    const insertEmployeeTraining = db.prepare(
      "INSERT OR IGNORE INTO employee_trainings (employee_id, training_id) VALUES (?, ?)"
    );
    selectedTrainingIds.forEach((trainingId) => {
      insertEmployeeTraining.run(req.params.id, trainingId);
    });
  } catch (err) {
    console.error("Fehler beim Bearbeiten eines Mitarbeiters:", err);
    return res.status(500).render("employee-form", {
      employee: { id: req.params.id, ...req.body },
      error: "Mitarbeiter konnte nicht aktualisiert werden. Bitte spaeter erneut versuchen.",
      departments: getDepartments(),
      positions: getPositions(),
      functionsCatalog: getFunctionsCatalog(),
      trainingsCatalog: getTrainingsCatalog(),
      selectedPositionIds,
      selectedFunctionIds,
      selectedTrainingIds,
    });
  }

  return res.redirect("/");
});

app.post("/employees/:id/delete", requireLogin, (req, res) => {
  const employeeId = Number(req.params.id);
  db.prepare("DELETE FROM employees WHERE id = ?").run(employeeId);
  return res.redirect("/");
});

app.get("/admin/settings", requireAdmin, (req, res) => {
  return renderAdminSettings(res);
});

app.get("/settings", requireAdmin, (req, res) => {
  return renderAdminSettings(res);
});

app.post("/admin/departments", requireAdmin, (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return renderAdminSettings(res.status(400), {
      error: "Bitte einen Abteilungsnamen eingeben.",
    });
  }
  try {
    db.prepare("INSERT INTO departments (name) VALUES (?)").run(name);
    return renderAdminSettings(res, { success: "Abteilung hinzugefuegt." });
  } catch (err) {
    const message = err.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Diese Abteilung existiert bereits."
      : "Abteilung konnte nicht hinzugefuegt werden.";
    return renderAdminSettings(res.status(400), { error: message });
  }
});

app.post("/admin/departments/:id/delete", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM departments WHERE id = ?").run(Number(req.params.id));
  return renderAdminSettings(res, { success: "Abteilung geloescht." });
});

app.post("/admin/positions", requireAdmin, (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return renderAdminSettings(res.status(400), {
      error: "Bitte einen Dienstgrad eingeben.",
    });
  }
  try {
    db.prepare("INSERT INTO positions (name) VALUES (?)").run(name);
    return renderAdminSettings(res, { success: "Dienstgrad hinzugefuegt." });
  } catch (err) {
    const message = err.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Dieser Dienstgrad existiert bereits."
      : "Dienstgrad konnte nicht hinzugefuegt werden.";
    return renderAdminSettings(res.status(400), { error: message });
  }
});

app.post("/admin/positions/:id/delete", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM positions WHERE id = ?").run(Number(req.params.id));
  return renderAdminSettings(res, { success: "Dienstgrad geloescht." });
});

app.post("/admin/functions", requireAdmin, (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return renderAdminSettings(res.status(400), { error: "Bitte eine Funktion eingeben." });
  }
  try {
    db.prepare("INSERT INTO functions_catalog (name) VALUES (?)").run(name);
    return renderAdminSettings(res, { success: "Funktion hinzugefuegt." });
  } catch (err) {
    const message = err.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Diese Funktion existiert bereits."
      : "Funktion konnte nicht hinzugefuegt werden.";
    return renderAdminSettings(res.status(400), { error: message });
  }
});

app.post("/admin/functions/:id/delete", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM functions_catalog WHERE id = ?").run(Number(req.params.id));
  return renderAdminSettings(res, { success: "Funktion geloescht." });
});

app.post("/admin/trainings", requireAdmin, (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return renderAdminSettings(res.status(400), { error: "Bitte eine Ausbildung eingeben." });
  }
  try {
    db.prepare("INSERT INTO trainings_catalog (name) VALUES (?)").run(name);
    return renderAdminSettings(res, { success: "Ausbildung hinzugefuegt." });
  } catch (err) {
    const message = err.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Diese Ausbildung existiert bereits."
      : "Ausbildung konnte nicht hinzugefuegt werden.";
    return renderAdminSettings(res.status(400), { error: message });
  }
});

app.post("/admin/trainings/:id/delete", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM trainings_catalog WHERE id = ?").run(Number(req.params.id));
  return renderAdminSettings(res, { success: "Ausbildung geloescht." });
});

app.get("/admin/users", requireAdmin, (req, res) => {
  const users = db
    .prepare("SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC")
    .all();
  return res.render("admin-users", { users, error: null, success: null });
});

app.post("/admin/users", requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  const normalizedRole = role === "admin" ? "admin" : "editor";
  if (!username || !password) {
    const users = db
      .prepare("SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC")
      .all();
    return res.status(400).render("admin-users", {
      users,
      error: "Benutzername und Passwort sind erforderlich.",
      success: null,
    });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)")
      .run(username.trim(), hash, normalizedRole);
    return res.redirect("/admin/users");
  } catch (err) {
    const users = db
      .prepare("SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC")
      .all();
    const message = err.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Der Benutzername existiert bereits."
      : "Benutzer konnte nicht angelegt werden.";
    return res.status(400).render("admin-users", {
      users,
      error: message,
      success: null,
    });
  }
});

app.post("/admin/users/:id/toggle-active", requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    const users = db
      .prepare("SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC")
      .all();
    return res.status(400).render("admin-users", {
      users,
      error: "Du kannst dein eigenes Konto nicht deaktivieren.",
      success: null,
    });
  }

  const targetUser = db.prepare("SELECT id, is_active FROM users WHERE id = ?").get(targetId);
  if (!targetUser) return res.redirect("/admin/users");

  const nextActive = targetUser.is_active ? 0 : 1;
  db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(nextActive, targetId);
  return res.redirect("/admin/users");
});

app.post("/admin/users/:id/delete", requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    const users = db
      .prepare("SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC")
      .all();
    return res.status(400).render("admin-users", {
      users,
      error: "Du kannst dein eigenes Konto nicht loeschen.",
      success: null,
    });
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
  return res.redirect("/admin/users");
});

app.get("/debug-routes", (req, res) => {
  const stack = (app._router && app._router.stack) || (app.router && app.router.stack) || [];
  const routes = stack
    .filter((layer) => layer.route && layer.route.path)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods || {}),
    }));
  return res.json(routes);
});

app.use((req, res) => {
  res.status(404).send("Seite nicht gefunden.");
});

app.use((err, req, res, next) => {
  console.error("Unerwarteter Serverfehler:", err);
  if (res.headersSent) return next(err);
  return res.status(500).send("Internal Server Error");
});

app.listen(PORT, () => {
  console.log(`BF Wien Mitarbeiterliste laeuft auf http://localhost:${PORT}`);
});
