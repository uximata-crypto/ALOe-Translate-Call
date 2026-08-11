export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const hasStaticToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const hasStoreId = Boolean(process.env.BLOB_STORE_ID);
  const hasOidc = Boolean(process.env.VERCEL_OIDC_TOKEN);
  const blobAuthMode = hasStaticToken
    ? 'read-write-token'
    : (hasStoreId && hasOidc ? 'oidc' : 'missing');

  return Response.json({
    ok: true,
    app: 'ALOe Translate Call',
    version: '1.0.1',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    signaling: 'vercel-private-blob',
    blobAuthMode,
    blobStoreIdConfigured: hasStoreId,
    vercelOidcAvailable: hasOidc,
    blobStaticTokenConfigured: hasStaticToken,
    productionReady: Boolean(process.env.OPENAI_API_KEY) && blobAuthMode !== 'missing',
    upstashRequired: false,
    languages: ['pt', 'es', 'en', 'fr', 'de', 'ko', 'zh'],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
