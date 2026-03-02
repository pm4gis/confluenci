
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

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ ok:false, error:"Unauthorised" }, 401);

  const payload = await request.json().catch(() => null);
  if (!payload || !payload.space || !Array.isArray(payload.pages)) return json({ ok:false, error:"Invalid JSON" }, 400);

  const space_key = String(payload.space.space_key || "").trim().toUpperCase() || crypto.randomUUID().slice(0,6).toUpperCase();
  const name = String(payload.space.name || "Imported Space").trim();
  const description = String(payload.space.description || "").trim();
  const colour = String(payload.space.colour || "#1e293b").trim();

  await env.DB.prepare("INSERT INTO spaces (space_key, name, description, colour) VALUES (?,?,?,?)")
    .bind(space_key, name, description, colour).run();

  const space = await env.DB.prepare("SELECT id FROM spaces WHERE space_key=?").bind(space_key).first();
  const space_id = space.id;

  // Map old ids to new ids
  const idMap = new Map();
  for (const p of payload.pages) {
    const title = String(p.title || "Untitled");
    const body_html = String(p.body_html || "");
    const labels_csv = String(p.labels_csv || "");
    const owner_username = String(p.owner_username || user.username);
    const sort_order = Number(p.sort_order || 0);

    const ins = await env.DB.prepare(
      "INSERT INTO pages (space_id, parent_id, sort_order, title, body_html, labels_csv, owner_username) VALUES (?,?,?,?,?,?,?)"
    ).bind(space_id, null, sort_order, title, body_html, labels_csv, owner_username).run();

    const newId = ins.meta?.last_row_id;
    idMap.set(Number(p.id), Number(newId));

    await env.DB.prepare("INSERT INTO page_versions (page_id, version_number, title, body_html) VALUES (?,?,?,?)")
      .bind(newId, 1, title, body_html).run();

    await env.DB.prepare("INSERT OR REPLACE INTO search_index (page_id, space_id, title, body_text, updated_at) VALUES (?,?,?,?,datetime('now'))")
      .bind(newId, space_id, title, stripHtml(body_html)).run();
  }

  // Fix parent_id relationships
  for (const p of payload.pages) {
    const oldId = Number(p.id);
    const oldParent = p.parent_id === null || p.parent_id === undefined ? null : Number(p.parent_id);
    const newId = idMap.get(oldId);
    const newParent = oldParent === null ? null : (idMap.get(oldParent) || null);

    if (newId) {
      await env.DB.prepare("UPDATE pages SET parent_id=? WHERE id=?").bind(newParent, newId).run();
    }
  }

  await audit(env, user.username, "import_space", "space", space_id, { space_key, name });
  return json({ ok:true, space_id });
}
