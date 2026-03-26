const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database(path.join(__dirname, "database.sqlite"));

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
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some((column) => column.name === "is_active")) {
  db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
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

  defaultDepartments.forEach((name) => insertDepartment.run(name));
  defaultPositions.forEach((name) => insertPosition.run(name));
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
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: __dirname,
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

function renderAdminSettings(res, payload = {}) {
  const departments = getDepartments();
  const positions = getPositions();
  return res.render("admin-settings", {
    departments,
    positions,
    error: payload.error || null,
    success: payload.success || null,
  });
}

function normalizeSelectedIds(rawValue) {
  if (!rawValue) return [];
  const list = Array.isArray(rawValue) ? rawValue : [rawValue];
  return [...new Set(list.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
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
      )
    )`);
    const wildcard = `%${queryText}%`;
    params.push(wildcard, wildcard, wildcard);
  }

  if (departmentFilter) {
    whereParts.push("LOWER(e.department) = LOWER(?)");
    params.push(departmentFilter);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const employees = db
    .prepare(
      `SELECT e.id, e.first_name, e.last_name, e.department, e.position,
              GROUP_CONCAT(p.name, ', ') AS dienstgrade,
              e.created_at, e.updated_at, u.username AS creator
       FROM employees e
       JOIN users u ON u.id = e.created_by
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id
       LEFT JOIN positions p ON p.id = ep.position_id
       ${whereSql}
       GROUP BY e.id
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

app.get("/employees/new", requireLogin, (req, res) => {
  res.render("employee-form", {
    employee: null,
    error: null,
    departments: getDepartments(),
    positions: getPositions(),
  });
});

app.post("/employees", requireLogin, (req, res) => {
  const { first_name, last_name, department } = req.body;
  const selectedPositionIds = normalizeSelectedIds(req.body.position_ids);
  if (!first_name || !last_name) {
    return res.status(400).render("employee-form", {
      employee: req.body,
      error: "Vorname und Nachname sind Pflichtfelder.",
      departments: getDepartments(),
      positions: getPositions(),
      selectedPositionIds,
    });
  }

  try {
    const inserted = db.prepare(
      `INSERT INTO employees (first_name, last_name, department, position, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(first_name.trim(), last_name.trim(), department || "", "", req.user.id);

    const insertEmployeePosition = db.prepare(
      "INSERT OR IGNORE INTO employee_positions (employee_id, position_id) VALUES (?, ?)"
    );
    selectedPositionIds.forEach((positionId) => {
      insertEmployeePosition.run(inserted.lastInsertRowid, positionId);
    });
  } catch (err) {
    console.error("Fehler beim Anlegen eines Mitarbeiters:", err);
    return res.status(500).render("employee-form", {
      employee: req.body,
      error: "Mitarbeiter konnte nicht gespeichert werden. Bitte spaeter erneut versuchen.",
      departments: getDepartments(),
      positions: getPositions(),
      selectedPositionIds,
    });
  }

  return res.redirect("/");
});

app.get("/employees/:id/edit", requireLogin, (req, res) => {
  const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(req.params.id);
  if (!employee) return res.status(404).send("Mitarbeiter nicht gefunden.");
  const selectedPositionIds = db
    .prepare("SELECT position_id FROM employee_positions WHERE employee_id = ?")
    .all(req.params.id)
    .map((row) => row.position_id);
  return res.render("employee-form", {
    employee,
    error: null,
    departments: getDepartments(),
    positions: getPositions(),
    selectedPositionIds,
  });
});

app.post("/employees/:id/edit", requireLogin, (req, res) => {
  const { first_name, last_name, department } = req.body;
  const selectedPositionIds = normalizeSelectedIds(req.body.position_ids);
  if (!first_name || !last_name) {
    return res.status(400).render("employee-form", {
      employee: { id: req.params.id, ...req.body },
      error: "Vorname und Nachname sind Pflichtfelder.",
      departments: getDepartments(),
      positions: getPositions(),
      selectedPositionIds,
    });
  }

  try {
    db.prepare(
      `UPDATE employees
       SET first_name = ?, last_name = ?, department = ?, position = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(first_name.trim(), last_name.trim(), department || "", "", req.params.id);

    db.prepare("DELETE FROM employee_positions WHERE employee_id = ?").run(req.params.id);
    const insertEmployeePosition = db.prepare(
      "INSERT OR IGNORE INTO employee_positions (employee_id, position_id) VALUES (?, ?)"
    );
    selectedPositionIds.forEach((positionId) => {
      insertEmployeePosition.run(req.params.id, positionId);
    });
  } catch (err) {
    console.error("Fehler beim Bearbeiten eines Mitarbeiters:", err);
    return res.status(500).render("employee-form", {
      employee: { id: req.params.id, ...req.body },
      error: "Mitarbeiter konnte nicht aktualisiert werden. Bitte spaeter erneut versuchen.",
      departments: getDepartments(),
      positions: getPositions(),
      selectedPositionIds,
    });
  }

  return res.redirect("/");
});

app.post("/employees/:id/delete", requireAdmin, (req, res) => {
  const employeeId = Number(req.params.id);
  db.prepare("DELETE FROM employees WHERE id = ?").run(employeeId);
  return res.redirect("/");
});

app.get("/admin/settings", requireAdmin, (req, res) => {
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

app.use((req, res) => {
  res.status(404).send("Seite nicht gefunden.");
});

app.listen(PORT, () => {
  console.log(`BF Wien Mitarbeiterliste laeuft auf http://localhost:${PORT}`);
});
