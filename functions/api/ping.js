export async function onRequest(context) {
  let db = 'not bound';
  try {
    const row = await context.env.DB
      .prepare("SELECT value FROM config WHERE key = 'ember_base'")
      .first();
    db = row ? `connected (ember_base=${row.value})` : 'connected (no seed)';
  } catch (e) {
    db = `error: ${e.message}`;
  }
  return Response.json({
    ok: true,
    service: 'muan-api',
    db,
    time: new Date().toISOString(),
  });
}
