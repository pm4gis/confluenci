PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  colour TEXT DEFAULT '#1e293b',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL,
  parent_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  labels_csv TEXT NOT NULL DEFAULT '',
  owner_username TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_id) REFERENCES pages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  anchor_text TEXT DEFAULT '',
  parent_id INTEGER,
  author_username TEXT NOT NULL,
  content TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reactions (
  page_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(page_id, username),
  FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  assigned_to TEXT NOT NULL DEFAULT '',
  due_date TEXT DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  scope TEXT NOT NULL,
  space_id INTEGER,
  page_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  uploaded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_index (
  page_id INTEGER PRIMARY KEY,
  space_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed
INSERT INTO spaces (space_key, name, description, colour)
SELECT 'COFFEE', 'Coffee Example', 'Example pages about coffee', '#1e293b'
WHERE NOT EXISTS (SELECT 1 FROM spaces);

INSERT INTO pages (space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username)
SELECT s.id, NULL, 1, 'Home', '<h2>Welcome</h2><p>Use the sidebar to browse and edit pages.</p>', 'example,coffee', 'admin'
FROM spaces s
WHERE s.space_key='COFFEE'
AND NOT EXISTS (SELECT 1 FROM pages WHERE space_id=s.id);

INSERT INTO pages (space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username)
SELECT s.id, (SELECT id FROM pages p WHERE p.space_id=s.id AND p.title='Home' LIMIT 1), 1, 'Espresso', '<h2>Espresso</h2><p>18g in, 36g out, 25 to 30 seconds.</p>', 'coffee,guide', 'admin'
FROM spaces s
WHERE s.space_key='COFFEE'
AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.space_id=s.id AND p.title='Espresso');

INSERT INTO pages (space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username)
SELECT s.id, (SELECT id FROM pages p WHERE p.space_id=s.id AND p.title='Home' LIMIT 1), 2, 'French Press', '<h2>French Press</h2><p>Coarse grind. 4 minutes steep.</p>', 'coffee,guide', 'admin'
FROM spaces s
WHERE s.space_key='COFFEE'
AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.space_id=s.id AND p.title='French Press');

INSERT INTO pages (space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username)
SELECT s.id, (SELECT id FROM pages p WHERE p.space_id=s.id AND p.title='Home' LIMIT 1), 3, 'Aeropress', '<h2>Aeropress</h2><p>Fast brew with paper filter.</p>', 'coffee,guide', 'admin'
FROM spaces s
WHERE s.space_key='COFFEE'
AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.space_id=s.id AND p.title='Aeropress');

INSERT INTO pages (space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username)
SELECT s.id, (SELECT id FROM pages p WHERE p.space_id=s.id AND p.title='Home' LIMIT 1), 4, 'Coffee History', '<h2>Coffee History</h2><p>From Ethiopia to the world.</p>', 'coffee,history', 'admin'
FROM spaces s
WHERE s.space_key='COFFEE'
AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.space_id=s.id AND p.title='Coffee History');

-- Build initial search index
INSERT OR REPLACE INTO search_index (page_id, space_id, title, body_text, updated_at)
SELECT id, space_id, title, '' , datetime('now') FROM pages
WHERE NOT EXISTS (SELECT 1 FROM search_index);
