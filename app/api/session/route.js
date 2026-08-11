export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = 'gemini-3.5-live-translate-preview';
const TARGET_CODES = {
  pt: 'pt-PT',
  es: 'es',
  en: 'en',
  fr: 'fr',
  de: 'de',
  ko: 'ko',
  zh: 'zh-Hans',
};

export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return Response.json({ error: 'GEMINI_API_KEY não configurada no Vercel.' }, { status: 500 });
    }

    const body = await request.json();
    const requested = String(body?.targetLanguage || '').trim();
    const targetLanguageCode = TARGET_CODES[requested];
    if (!targetLanguageCode) {
      return Response.json({ error: 'Idioma de destino inválido.' }, { status: 400 });
    }

    const now = Date.now();
    // Token temporário simples, de uma utilização. A configuração Live Translate
    // é enviada no setup inicial do WebSocket. O endpoint oficial atual para
    // ephemeral tokens é v1beta.
    const tokenRequest = {
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    };

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tokenRequest),
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || 'Não foi possível criar o token temporário Gemini.';
      return Response.json({ error: `Gemini: ${message}` }, { status: response.status });
    }

    if (!payload?.name) {
      return Response.json({ error: 'A Gemini não devolveu o token temporário.' }, { status: 502 });
    }

    return Response.json({
      token: payload.name,
      model: MODEL,
      apiVersion: 'v1beta',
      targetLanguageCode,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error?.message || 'Erro ao criar sessão Gemini.' }, { status: 500 });
  }
}
