
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
  const sid = getCookie(request, "session");
  const user = await requireUser(request, env);
  if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
  if (user) await audit(env, user.username, "logout", "user", user.id, {});
  return json({ ok:true }, 200, { "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" });
}
