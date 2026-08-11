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
    version: '1.1.0-gemini',
    translationEngine: 'gemini-3.5-live-translate-preview',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    signaling: 'vercel-private-blob',
    blobAuthMode,
    blobStoreIdConfigured: hasStoreId,
    vercelOidcAvailable: oidcAvailable,
    vercelOidcSource: oidcSource,
    blobStaticTokenConfigured: hasStaticToken,
    productionReady: Boolean(process.env.GEMINI_API_KEY) && blobAuthMode !== 'missing',
    upstashRequired: false,
    openaiRequired: false,
    publicProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://al-oe-translate-call-woad.vercel.app',
    languages: ['pt-PT', 'es', 'en', 'fr', 'de', 'ko', 'zh-Hans'],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
