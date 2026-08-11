export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const METERED_DOMAIN = 'aloe-translate-call.metered.live';

function normalizeIceServers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((server) => server && (typeof server.urls === 'string' || Array.isArray(server.urls)))
    .map((server) => ({
      urls: server.urls,
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {}),
    }));
}

export async function POST() {
  const apiKey = process.env.METERED_TURN_API_KEY;

  if (!apiKey) {
    return Response.json({
      error: 'Metered TURN não configurado no Vercel.',
      code: 'TURN_NOT_CONFIGURED',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const query = new URLSearchParams({ apiKey, region: 'global' });
    const response = await fetch(
      `https://${METERED_DOMAIN}/api/v1/turn/credentials?${query.toString()}`,
      { method: 'GET', cache: 'no-store' },
    );

    const data = await response.json().catch(() => null);
    const iceServers = normalizeIceServers(data);

    if (!response.ok || iceServers.length === 0) {
      const message = data?.error || data?.message || `Metered TURN respondeu ${response.status}.`;
      return Response.json({ error: message, code: 'TURN_CREDENTIALS_FAILED' }, {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return Response.json({
      iceServers,
      provider: 'metered',
      region: 'global',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      error: error?.message || 'Falha ao obter credenciais TURN da Metered.',
      code: 'TURN_CREDENTIALS_FAILED',
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
