export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    app: 'ALOe Translate Call',
    version: '1.0.0',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    signaling: 'vercel-private-blob',
    upstashRequired: false,
    languages: ['pt', 'es', 'en', 'fr', 'de', 'ko', 'zh'],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
