import { getVercelOidcToken } from '@vercel/oidc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const hasStaticToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const hasStoreId = Boolean(process.env.BLOB_STORE_ID);

  let oidcAvailable = false;
  let oidcSource = 'unavailable';
  if (hasStoreId && !hasStaticToken) {
    try {
      const token = await getVercelOidcToken();
      oidcAvailable = Boolean(token);
      if (oidcAvailable) oidcSource = 'vercel-function-header';
    } catch {
      oidcAvailable = false;
    }
  }

  const blobAuthMode = hasStaticToken
    ? 'read-write-token'
    : (hasStoreId && oidcAvailable ? 'oidc' : 'missing');

  return Response.json({
    ok: true,
    app: 'ALOe Translate Call',
    version: '1.0.2',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    signaling: 'vercel-private-blob',
    blobAuthMode,
    blobStoreIdConfigured: hasStoreId,
    vercelOidcAvailable: oidcAvailable,
    vercelOidcSource: oidcSource,
    blobStaticTokenConfigured: hasStaticToken,
    productionReady: Boolean(process.env.OPENAI_API_KEY) && blobAuthMode !== 'missing',
    upstashRequired: false,
    languages: ['pt', 'es', 'en', 'fr', 'de', 'ko', 'zh'],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
