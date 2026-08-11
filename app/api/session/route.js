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
    // 1. Confirmar que a chave Gemini existe no servidor
    if (!process.env.GEMINI_API_KEY) {
      return Response.json(
        {
          error: 'GEMINI_API_KEY não configurada no Vercel.',
        },
        {
          status: 500,
        }
      );
    }

    // 2. Ler idioma de destino enviado pela aplicação
    const body = await request.json();

    const requested = String(
      body?.targetLanguage || ''
    ).trim();

    const targetLanguageCode = TARGET_CODES[requested];

    if (!targetLanguageCode) {
      return Response.json(
        {
          error: 'Idioma de destino inválido.',
        },
        {
          status: 400,
        }
      );
    }

    // 3. Datas de validade do token temporário
    const now = Date.now();

    const expireTime = new Date(
      now + 30 * 60 * 1000
    ).toISOString();

    const newSessionExpireTime = new Date(
      now + 60 * 1000
    ).toISOString();

    // 4. Criar token Gemini Live Translate
    // A configuração de tradução fica bloqueada no token.
    const tokenRequest = {
      uses: 1,

      expireTime,

      newSessionExpireTime,

      liveConnectConstraints: {
        model: `models/${MODEL}`,

        config: {
          responseModalities: ['AUDIO'],

          inputAudioTranscription: {},

          outputAudioTranscription: {},

          translationConfig: {
            targetLanguageCode,
            echoTargetLanguage: true,
          },
        },
      },
    };

    // 5. Pedir token efémero à Gemini API
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/auth_tokens',
      {
        method: 'POST',

        headers: {
          'x-goog-api-key': process.env.GEMINI_API_KEY,
          'Content-Type': 'application/json',
        },

        body: JSON.stringify(tokenRequest),

        cache: 'no-store',
      }
    );

    // 6. Ler resposta da Gemini
    const payload = await response
      .json()
      .catch(() => ({}));

    // 7. Mostrar erro real devolvido pela Gemini
    if (!response.ok) {
      const message =
        payload?.error?.message ||
        'Não foi possível criar o token temporário Gemini.';

      return Response.json(
        {
          error: `Gemini: ${message}`,
          status: response.status,
        },
        {
          status: response.status,
        }
      );
    }

    // 8. Confirmar que recebemos o token
    if (!payload?.name) {
      return Response.json(
        {
          error: 'A Gemini não devolveu o token temporário.',
        },
        {
          status: 502,
        }
      );
    }

    // 9. Enviar apenas o token temporário para o navegador
    return Response.json(
      {
        token: payload.name,

        model: MODEL,

        apiVersion: 'v1beta',

        targetLanguageCode,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error(
      'Erro /api/session Gemini:',
      error
    );

    return Response.json(
      {
        error:
          error?.message ||
          'Erro ao criar sessão Gemini.',
      },
      {
        status: 500,
      }
    );
  }
}
