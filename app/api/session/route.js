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
      return Response.json(
        {
          error: 'GEMINI_API_KEY não configurada no Vercel.',
        },
        {
          status: 500,
        }
      );
    }

    const body = await request.json();

    const requested = String(
      body?.targetLanguage || ''
    ).trim();

    const targetLanguageCode =
      TARGET_CODES[requested];

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

    const now = Date.now();

    /*
     * Token efémero simples:
     * - a API key permanente fica apenas no Vercel;
     * - a configuração Live é enviada pelo browser no primeiro frame WebSocket;
     * - o mesmo token pode ser reutilizado para session resumption;
     * - expireTime de 2 horas permite chamadas longas com várias reconexões
     *   de WebSocket (a ligação individual é renovada aproximadamente
     *   a cada 10 minutos).
     */
    const expireTime =
      new Date(
        now + 2 * 60 * 60 * 1000
      ).toISOString();

    const newSessionExpireTime =
      new Date(
        now + 60 * 1000
      ).toISOString();

    const tokenRequest = {
      uses: 1,
      expireTime,
      newSessionExpireTime,
    };

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/auth_tokens',
      {
        method: 'POST',

        headers: {
          'x-goog-api-key':
            process.env.GEMINI_API_KEY,

          'Content-Type':
            'application/json',
        },

        body: JSON.stringify(
          tokenRequest
        ),

        cache: 'no-store',
      }
    );

    const payload = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        JSON.stringify(payload);

      console.error(
        'Erro Gemini auth_tokens:',
        response.status,
        payload
      );

      return Response.json(
        {
          error: `Gemini: ${detail}`,
          geminiStatus:
            response.status,
        },
        {
          status: response.status,
        }
      );
    }

    if (!payload?.name) {
      console.error(
        'Gemini não devolveu token:',
        payload
      );

      return Response.json(
        {
          error:
            'A Gemini não devolveu o token temporário.',
        },
        {
          status: 502,
        }
      );
    }

    return Response.json(
      {
        token: payload.name,
        model: MODEL,
        apiVersion: 'v1beta',
        targetLanguageCode,
        tokenExpiresAt:
          expireTime,
        newSessionExpiresAt:
          newSessionExpireTime,
        setupLocked: false,
        sessionResumption:
          true,
        contextWindowCompression:
          true,
      },
      {
        headers: {
          'Cache-Control':
            'no-store, no-cache, must-revalidate',
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
    // Confirmar que a chave Gemini está configurada no Vercel
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

    // Ler os dados enviados pela aplicação
    const body = await request.json();

    const requested = String(
      body?.targetLanguage || ''
    ).trim();

    const targetLanguageCode =
      TARGET_CODES[requested];

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

    const now = Date.now();

    // Token temporário Gemini Live Translate
    const tokenRequest = {
      uses: 1,

      expireTime: new Date(
        now + 30 * 60 * 1000
      ).toISOString(),

      newSessionExpireTime: new Date(
        now + 60 * 1000
      ).toISOString(),

      bidiGenerateContentSetup: {
        model: `models/${MODEL}`,

        generationConfig: {
          responseModalities: ['AUDIO'],

          translationConfig: {
            targetLanguageCode,
            echoTargetLanguage: true,
          },
        },

        // ATENÇÃO:
        // estes dois campos ficam FORA de generationConfig
        inputAudioTranscription: {},

        outputAudioTranscription: {},
      },
    };

    // Para Gemini Live Translate + ephemeral token:
    // usar atualmente v1alpha
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1alpha/auth_tokens',
      {
        method: 'POST',

        headers: {
          'x-goog-api-key':
            process.env.GEMINI_API_KEY,

          'Content-Type':
            'application/json',
        },

        body: JSON.stringify(tokenRequest),

        cache: 'no-store',
      }
    );

    const payload = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        JSON.stringify(payload);

      console.error(
        'Erro Gemini auth_tokens:',
        response.status,
        payload
      );

      return Response.json(
        {
          error: `Gemini: ${detail}`,
          geminiStatus: response.status,
        },
        {
          status: response.status,
        }
      );
    }

    if (!payload?.name) {
      console.error(
        'Gemini não devolveu token:',
        payload
      );

      return Response.json(
        {
          error:
            'A Gemini não devolveu o token temporário.',
        },
        {
          status: 502,
        }
      );
    }

    return Response.json(
      {
        token: payload.name,

        model: MODEL,

        // IMPORTANTE:
        // page.js já lê este valor automaticamente
        apiVersion: 'v1alpha',

        targetLanguageCode,

        setupLocked: true,
      },
      {
        headers: {
          'Cache-Control':
            'no-store, no-cache, must-revalidate',
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
