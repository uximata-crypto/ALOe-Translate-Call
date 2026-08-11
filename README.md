# ALOe Translate Call — Gemini v1.1.0

Web/PWA para chamadas internas entre **duas pessoas**. O Português (Portugal) é sempre a língua principal.

Idiomas do interlocutor:

- Espanhol (`es`)
- Inglês (`en`)
- Francês (`fr`)
- Alemão (`de`)
- Coreano (`ko`)
- Mandarim / Chinês Simplificado (`zh-Hans`)

## Motor de tradução

A versão 1.1.0 usa **Gemini 3.5 Live Translate Preview** (`gemini-3.5-live-translate-preview`) para tradução voz‑para‑voz em tempo real.

A chave Gemini fica apenas no backend Vercel. O endpoint `/api/session` troca a `GEMINI_API_KEY` por um **token temporário de uma utilização**, válido apenas para iniciar uma sessão Live durante um curto período. O browser usa esse token para ligar diretamente à Gemini Live API por WebSocket.

## Arquitetura

- **GitHub** — código-fonte.
- **Vercel** — aplicação Next.js + endpoints serverless.
- **Vercel Blob privado** — apenas sinalização `offer/answer` para estabelecer a chamada WebRTC.
- **WebRTC** — chamada de voz direta entre os dois browsers.
- **Gemini Live Translate** — tradução da pista de áudio recebida por cada participante.
- **Upstash / Redis** — não utilizado.
- **OpenAI API** — não utilizada nesta versão.

## Variável obrigatória no Vercel

Crie apenas:

```text
GEMINI_API_KEY
```

No Vercel: `Settings` → `Environment Variables` → `Add Environment Variable`.

Marque **Sensitive** e aplique a **Production and Preview**.

A antiga `OPENAI_API_KEY` pode ser removida depois de confirmar que esta versão está em produção.

## Vercel Blob

O Blob privado que já está ligado ao projeto continua a ser utilizado. Não precisa de criar outro.

O endpoint `/api/health` deverá mostrar:

```json
{
  "ok": true,
  "version": "1.1.0-gemini",
  "translationEngine": "gemini-3.5-live-translate-preview",
  "geminiConfigured": true,
  "productionReady": true,
  "openaiRequired": false
}
```

## Atualizar um projeto v1.0.3 existente

Pode substituir todo o projeto, mas para esta migração os ficheiros essenciais são:

```text
app/page.js
app/api/session/route.js
app/api/health/route.js
.env.example
package.json
README.md
```

Depois do commit no GitHub, aguarde o novo deployment automático do Vercel.

## Primeiro teste

1. Abra o domínio público de produção, por exemplo `https://al-oe-translate-call-woad.vercel.app`.
2. Crie uma chamada e escolha a língua do interlocutor.
3. Envie o link ao segundo telemóvel.
4. Autorize o microfone nos dois.
5. Fale Português num lado e a língua escolhida no outro.
6. A app envia apenas a pista de áudio **recebida** por cada participante para o Gemini Live Translate, com o idioma de destino apropriado.

## Notas técnicas

- Entrada Gemini Live: PCM linear 16-bit, mono, 16 kHz.
- Saída de áudio: PCM 24 kHz, reproduzida no browser através de Web Audio.
- A tradução usa tokens temporários para não expor a `GEMINI_API_KEY` no frontend.
- O modelo Live Translate é Preview; limites e disponibilidade podem mudar.
