
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
  const page_id = url.searchParams.get("page_id");
  const download = url.searchParams.get("download");

  if (download) {
    const obj = await env.ATTACHMENTS.get(download);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream" } });
  }

  if (!page_id) return json({ ok:false, error:"page_id required" }, 400);

  const rows = await env.DB.prepare(
    "SELECT id, filename, r2_key, size_bytes, content_type, uploaded_at FROM attachments WHERE page_id=? ORDER BY id DESC"
  ).bind(Number(page_id)).all();

  return json({ ok:true, attachments: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ ok:false, error:"Unauthorised" }, 401);

  const form = await request.formData();
  const page_id = Number(form.get("page_id") || 0);
  const file = form.get("file");

  if (!page_id || !file) return json({ ok:false, error:"page_id and file required" }, 400);

  const filename = String(file.name || "file");
  const contentType = String(file.type || "application/octet-stream");
  const key = `${page_id}/${crypto.randomUUID()}-${filename}`;

  await env.ATTACHMENTS.put(key, file.stream(), { httpMetadata: { contentType } });

  const sizeBytes = Number(file.size || 0);
  await env.DB.prepare(
    "INSERT INTO attachments (page_id, filename, r2_key, size_bytes, content_type) VALUES (?,?,?,?,?)"
  ).bind(page_id, filename, key, sizeBytes, contentType).run();

  await audit(env, user.username, "attachment_add", "page", page_id, { filename });
  return json({ ok:true });
}
