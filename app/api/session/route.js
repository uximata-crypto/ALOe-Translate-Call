import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_LANGUAGES = new Set(['pt', 'es', 'en', 'fr', 'de', 'ko', 'zh']);

export async function POST(request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: 'OPENAI_API_KEY não configurada no Vercel.' }, { status: 500 });
    }

    const body = await request.json();
    const targetLanguage = String(body?.targetLanguage || '').trim();
    if (!ALLOWED_LANGUAGES.has(targetLanguage)) {
      return Response.json({ error: 'Idioma de destino inválido.' }, { status: 400 });
    }

    const rawSafety = `${body?.room || 'room'}:${body?.role || 'participant'}`;
    const safetyId = crypto.createHash('sha256').update(rawSafety).digest('hex');

    const openai = await fetch('https://api.openai.com/v1/realtime/translations/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': safetyId,
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          model: 'gpt-realtime-translate',
          audio: {
            input: {
              transcription: { model: 'gpt-realtime-whisper' },
              noise_reduction: null,
            },
            output: { language: targetLanguage },
          },
        },
      }),
    });

    const payload = await openai.json();
    if (!openai.ok) {
      return Response.json(
        { error: payload?.error?.message || 'Não foi possível criar a sessão de tradução.' },
        { status: openai.status },
      );
    }

    return Response.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Erro ao criar sessão de tradução.' }, { status: 500 });
  }
}
