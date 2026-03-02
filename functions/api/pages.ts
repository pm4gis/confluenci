
export async function onRequestGet({request, env}) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const page = await env.DB.prepare("SELECT * FROM pages WHERE id=?").bind(id).first();
  return Response.json(page);
}

export async function onRequestPut({request, env}) {
  const {id, body} = await request.json();
  await env.DB.prepare("UPDATE pages SET body=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(body,id).run();
  return Response.json({success:true});
}
