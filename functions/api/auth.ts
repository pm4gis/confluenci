function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type":"application/json; charset=utf-8", ...headers } });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map(p => p.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq > 0 && p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq+1));
  }
  return null;
}

async function requireUser(request, env) {
  const sid = getCookie(request, "session");
  if (!sid) return null;
  const row = await env.DB.prepare(
    "SELECT u.id as id, u.username as username, u.role as role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?"
  ).bind(sid).first();
  return row || null;
}

function setCookie(sessionId) {
  return `session=${encodeURIComponent(sessionId)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600`;
}

async function ensureSchema(env) {
  // Always run CREATE TABLE IF NOT EXISTS so partial schemas get repaired.
  const stmts = [
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT DEFAULT (datetime('now')));",
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS spaces (id INTEGER PRIMARY KEY AUTOINCREMENT, space_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', colour TEXT DEFAULT '#1e293b', archived INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));",
    "CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY AUTOINCREMENT, space_id INTEGER NOT NULL, parent_id INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, body_html TEXT NOT NULL DEFAULT '', labels_csv TEXT NOT NULL DEFAULT '', owner_username TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE, FOREIGN KEY(parent_id) REFERENCES pages(id) ON DELETE SET NULL);",
    "CREATE TABLE IF NOT EXISTS page_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id INTEGER NOT NULL, version_number INTEGER NOT NULL, title TEXT NOT NULL, body_html TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id INTEGER NOT NULL, anchor_text TEXT DEFAULT '', parent_id INTEGER, author_username TEXT NOT NULL, content TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS reactions (page_id INTEGER NOT NULL, username TEXT NOT NULL, emoji TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(page_id, username), FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id INTEGER NOT NULL, description TEXT NOT NULL, assigned_to TEXT NOT NULL DEFAULT '', due_date TEXT DEFAULT '', completed INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS watches (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, scope TEXT NOT NULL, space_id INTEGER, page_id INTEGER, created_at TEXT DEFAULT (datetime('now')));",
    "CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, message TEXT NOT NULL, link TEXT NOT NULL DEFAULT '', read INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));",
    "CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id INTEGER NOT NULL, filename TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, content_type TEXT NOT NULL DEFAULT 'application/octet-stream', uploaded_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')));",
    "CREATE TABLE IF NOT EXISTS search_index (page_id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL, title TEXT NOT NULL, body_text TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "INSERT INTO users (username, password_hash, role) SELECT 'admin','admin','admin' WHERE NOT EXISTS (SELECT 1 FROM users WHERE username='admin');",
    "INSERT INTO spaces (space_key, name, description, colour) SELECT 'COFFEE', 'Coffee Example', 'Example pages about coffee', '#1e293b' WHERE NOT EXISTS (SELECT 1 FROM spaces);",
    "INSERT INTO pages (space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username) SELECT s.id, NULL, 1, 'Home', '<h2>Welcome</h2><p>Use the sidebar to browse and edit pages.</p>', 'example,coffee', 'admin' FROM spaces s WHERE s.space_key='COFFEE' AND NOT EXISTS (SELECT 1 FROM pages WHERE space_id=s.id);"
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
}

export async function onRequestPost({ request, env }) {
  try {
    await ensureSchema(env);

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) return json({ ok:false, error:"Username and password required" }, 400);

    const user = await env.DB.prepare("SELECT id, username, password_hash, role FROM users WHERE username=?")
      .bind(username).first();

    if (!user || user.password_hash !== password) return json({ ok:false, error:"Invalid login" }, 401);

    const sid = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO sessions (id, user_id) VALUES (?,?)").bind(sid, user.id).run();

    await env.DB.prepare(
      "INSERT INTO audit_log (username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)"
    ).bind(user.username, "login", "user", String(user.id), "{}").run();

    return json({ ok:true, user:{ username:user.username, role:user.role } }, 200, { "Set-Cookie": setCookie(sid) });
  } catch (e) {
    return json({ ok:false, error: String(e && e.message ? e.message : e) }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok:false, user:null }, 401);
    return json({ ok:true, user:{ username:user.username, role:user.role } });
  } catch (e) {
    return json({ ok:false, error: String(e && e.message ? e.message : e) }, 500);
  }
}
