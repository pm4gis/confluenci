
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

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function audit(env, username, action, entity_type, entity_id, details = {}) {
  await env.DB.prepare(
    "INSERT INTO audit_log (username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)"
  ).bind(username, action, entity_type, String(entity_id), JSON.stringify(details || {})).run();
}

async function notify(env, username, message, link = "") {
  await env.DB.prepare("INSERT INTO notifications (username, message, link) VALUES (?,?,?)")
    .bind(username, message, link).run();
}

async function notifyWatchers(env, scope, spaceId, pageId, message, link) {
  const stmt = scope === "page"
    ? env.DB.prepare("SELECT username FROM watches WHERE scope='page' AND page_id=?").bind(pageId)
    : env.DB.prepare("SELECT username FROM watches WHERE scope='space' AND space_id=?").bind(spaceId);

  const rows = await stmt.all();
  for (const r of (rows.results || [])) {
    await notify(env, r.username, message, link);
  }
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ ok:false, error:"Unauthorised" }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const space_id = url.searchParams.get("space_id");

  if (id) {
    const page = await env.DB.prepare(
      "SELECT id, space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username, created_at, updated_at FROM pages WHERE id=?"
    ).bind(id).first();
    return json({ ok:true, page });
  }

  if (!space_id) return json({ ok:false, error:"space_id required" }, 400);

  const rows = await env.DB.prepare(
    "SELECT id, parent_id, sort_order, title FROM pages WHERE space_id=? ORDER BY parent_id IS NOT NULL, parent_id, sort_order, title"
  ).bind(space_id).all();

  return json({ ok:true, pages: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ ok:false, error:"Unauthorised" }, 401);

  const body = await request.json().catch(() => ({}));
  const space_id = Number(body.space_id || 0);
  const parent_id = body.parent_id ? Number(body.parent_id) : null;
  const title = String(body.title || "").trim() || "Untitled";
  const body_html = String(body.body_html || "");
  const labels_csv = String(body.labels_csv || "");
  const owner_username = user.username;

  if (!space_id) return json({ ok:false, error:"space_id required" }, 400);

  const maxRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order),0) as m FROM pages WHERE space_id=? AND (parent_id IS ? OR parent_id = ?)"
  ).bind(space_id, parent_id, parent_id).first();
  const sort_order = (maxRow?.m || 0) + 1;

  const ins = await env.DB.prepare(
    "INSERT INTO pages (space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username) VALUES (?,?,?,?,?,?,?)"
  ).bind(space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username).run();

  const pageId = ins.meta?.last_row_id;
  await env.DB.prepare("INSERT INTO page_versions (page_id, version_number, title, body_html) VALUES (?,?,?,?)")
    .bind(pageId, 1, title, body_html).run();

  await env.DB.prepare("INSERT OR REPLACE INTO search_index (page_id, space_id, title, body_text, updated_at) VALUES (?,?,?,?,datetime('now'))")
    .bind(pageId, space_id, title, stripHtml(body_html)).run();

  await audit(env, user.username, "create_page", "page", pageId, { title, space_id, parent_id });
  await notifyWatchers(env, "space", space_id, pageId, `Page created: ${title}`, `#page=${pageId}`);
  return json({ ok:true, id: pageId });
}

export async function onRequestPut({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ ok:false, error:"Unauthorised" }, 401);

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id || 0);
  if (!id) return json({ ok:false, error:"id required" }, 400);

  const existing = await env.DB.prepare("SELECT id, space_id, title, body_html FROM pages WHERE id=?").bind(id).first();
  if (!existing) return json({ ok:false, error:"Not found" }, 404);

  const title = String(body.title ?? existing.title).trim() || existing.title;
  const body_html = String(body.body_html ?? existing.body_html);

  const v = await env.DB.prepare("SELECT COALESCE(MAX(version_number),0) as m FROM page_versions WHERE page_id=?").bind(id).first();
  const nextV = (v?.m || 0) + 1;

  await env.DB.prepare("INSERT INTO page_versions (page_id, version_number, title, body_html) VALUES (?,?,?,?)")
    .bind(id, nextV, title, body_html).run();

  await env.DB.prepare("UPDATE pages SET title=?, body_html=?, updated_at=datetime('now') WHERE id=?")
    .bind(title, body_html, id).run();

  await env.DB.prepare("INSERT OR REPLACE INTO search_index (page_id, space_id, title, body_text, updated_at) VALUES (?,?,?,?,datetime('now'))")
    .bind(id, existing.space_id, title, stripHtml(body_html)).run();

  await audit(env, user.username, "update_page", "page", id, { title, version: nextV });
  await notifyWatchers(env, "page", existing.space_id, id, `Page updated: ${title}`, `#page=${id}`);
  return json({ ok:true, version: nextV });
}

export async function onRequestDelete({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ ok:false, error:"Unauthorised" }, 401);

  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id") || 0);
  if (!id) return json({ ok:false, error:"id required" }, 400);

  const existing = await env.DB.prepare("SELECT id, space_id, title FROM pages WHERE id=?").bind(id).first();
  if (!existing) return json({ ok:false, error:"Not found" }, 404);

  await env.DB.prepare("DELETE FROM pages WHERE id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM search_index WHERE page_id=?").bind(id).run();
  await audit(env, user.username, "delete_page", "page", id, { title: existing.title });

  return json({ ok:true });
}
