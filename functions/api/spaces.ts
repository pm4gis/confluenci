
export async function onRequestGet({env}) {
  const res = await env.DB.prepare("SELECT id,name FROM spaces WHERE archived=0").all();
  return Response.json(res.results);
}
