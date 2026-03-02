
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
  const scope = String(url.searchParams.get("scope") || "");
  const space_id = url.searchParams.get("space_id");
  const page_id = url.searchParams.get("page_id");

  let rows;
  if (scope === "space" && space_id) {
    rows = await env.DB.prepare("SELECT id FROM watches WHERE username=? AND scope='space' AND space_id=?")
      .bind(user.username, Number(space_id)).all();
  } else if (scope === "page" && page_id) {
    rows = await env.DB.prepare("SELECT id FROM watches WHERE username=? AND scope='page' AND page_id=?")
      .bind(user.username, Number(page_id)).all();
  } else {
    rows = await env.DB.prepare("SELECT scope, space_id, page_id FROM watches WHERE username=? ORDER BY id DESC")
      .bind(user.username).all();
  }

  return json({ ok:true, watches: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ ok:false, error:"Unauthorised" }, 401);

  const body = await request.json().catch(() => ({}));
  const scope = String(body.scope || "").trim();
  const space_id = body.space_id ? Number(body.space_id) : null;
  const page_id = body.page_id ? Number(body.page_id) : null;

  if (scope !== "space" && scope !== "page") return json({ ok:false, error:"scope must be space or page" }, 400);
  if (scope === "space" && !space_id) return json({ ok:false, error:"space_id required" }, 400);
  if (scope === "page" && !page_id) return json({ ok:false, error:"page_id required" }, 400);

  // Deduplicate
  if (scope === "space") {
    await env.DB.prepare("DELETE FROM watches WHERE username=? AND scope='space' AND space_id=?")
      .bind(user.username, space_id).run();
    await env.DB.prepare("INSERT INTO watches (username, scope, space_id) VALUES (?,?,?)")
      .bind(user.username, "space", space_id).run();
    await audit(env, user.username, "watch_space", "space", space_id, {});
  } else {
    await env.DB.prepare("DELETE FROM watches WHERE username=? AND scope='page' AND page_id=?")
      .bind(user.username, page_id).run();
    await env.DB.prepare("INSERT INTO watches (username, scope, page_id) VALUES (?,?,?)")
      .bind(user.username, "page", page_id).run();
    await audit(env, user.username, "watch_page", "page", page_id, {});
  }

  return json({ ok:true });
}

export async function onRequestDelete({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ ok:false, error:"Unauthorised" }, 401);

  const url = new URL(request.url);
  const scope = String(url.searchParams.get("scope") || "").trim();
  const space_id = url.searchParams.get("space_id");
  const page_id = url.searchParams.get("page_id");

  if (scope === "space" && space_id) {
    await env.DB.prepare("DELETE FROM watches WHERE username=? AND scope='space' AND space_id=?")
      .bind(user.username, Number(space_id)).run();
    await audit(env, user.username, "unwatch_space", "space", Number(space_id), {});
    return json({ ok:true });
  }
  if (scope === "page" && page_id) {
    await env.DB.prepare("DELETE FROM watches WHERE username=? AND scope='page' AND page_id=?")
      .bind(user.username, Number(page_id)).run();
    await audit(env, user.username, "unwatch_page", "page", Number(page_id), {});
    return json({ ok:true });
  }

  return json({ ok:false, error:"scope and space_id or page_id required" }, 400);
}
