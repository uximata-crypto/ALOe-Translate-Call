import crypto from 'node:crypto';
import { get, put, del } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validate(room, secret, kind) {
  if (!/^\d{6}$/.test(room || '')) throw new Error('Código de sala inválido.');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(secret || '')) throw new Error('Segredo da sala inválido.');
  if (!['offer', 'answer'].includes(kind)) throw new Error('Tipo de sinal inválido.');
}

function roomHash(room, secret) {
  return crypto.createHash('sha256').update(`${room}:${secret}`).digest('hex');
}

function pathname(room, secret, kind) {
  return `aloe-signals/${roomHash(room, secret)}/${kind}.json`;
}

// Prefer the static read-write token when Vercel exposes it for this store.
// This bypasses any stale/mismatched OIDC credential on an older deployment.
// If no static token is available, use the Vercel OIDC pair explicitly.
function blobAuth() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return { token: process.env.BLOB_READ_WRITE_TOKEN };
  }
  if (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID) {
    return {
      oidcToken: process.env.VERCEL_OIDC_TOKEN,
      storeId: process.env.BLOB_STORE_ID,
    };
  }
  throw new Error('Credenciais do Vercel Blob não estão disponíveis neste deployment. Ligue o Blob ao projeto e faça um novo deployment.');
}

export async function POST(request) {
  try {
    const body = await request.json();
    const room = String(body?.room || '');
    const secret = String(body?.secret || '');
    const kind = String(body?.kind || '');
    const sdp = String(body?.sdp || '');
    validate(room, secret, kind);
    if (!sdp.startsWith('v=0') || sdp.length > 250000) {
      return Response.json({ error: 'SDP inválido.' }, { status: 400 });
    }

    await put(
      pathname(room, secret, kind),
      JSON.stringify({ sdp, createdAt: Date.now() }),
      {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        ...blobAuth(),
      },
    );

    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Não foi possível guardar a sinalização.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const room = url.searchParams.get('room') || '';
    const secret = url.searchParams.get('secret') || '';
    const kind = url.searchParams.get('kind') || '';
    validate(room, secret, kind);

    const result = await get(pathname(room, secret, kind), {
      access: 'private',
      useCache: false,
      ...blobAuth(),
    });

    if (!result || result.statusCode !== 200) {
      return Response.json({ found: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const text = await new Response(result.stream).text();
    const payload = JSON.parse(text);
    return Response.json({ found: true, ...payload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error?.message || '';
    if (/not found|404/i.test(message)) {
      return Response.json({ found: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ error: message || 'Erro ao ler sinalização.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const room = url.searchParams.get('room') || '';
    const secret = url.searchParams.get('secret') || '';
    validate(room, secret, 'offer');
    await del(
      [pathname(room, secret, 'offer'), pathname(room, secret, 'answer')],
      blobAuth(),
    ).catch(() => {});
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
