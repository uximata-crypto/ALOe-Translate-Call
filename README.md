# ALOe Translate Call — Gemini + Metered TURN v1.1.4

Web/PWA para chamadas internas com Português (Portugal) como língua principal e tradução para Espanhol, Inglês, Francês, Alemão, Coreano e Mandarim/Chinês.

## Serviços usados
- GitHub
- Vercel
- Vercel Blob privado (sinalização WebRTC)
- Gemini Live Translate
- Metered TURN (fallback de conectividade WebRTC)

## Variáveis no Vercel
Crie apenas estas variáveis manuais:

```text
GEMINI_API_KEY
METERED_TURN_API_KEY
```

O domínio Metered está definido no backend como:

```text
aloe-translate-call.metered.live
```

## Atualização a partir da v1.1.2/v1.1.3
Substitua principalmente:

```text
app/api/turn/route.js
app/api/health/route.js
```

Se ainda estiver numa versão sem TURN, substitua também `app/page.js`.

Opcionalmente substitua `package.json`, `.env.example` e `README.md` para manter a versão e documentação sincronizadas.

## Verificação
Depois do deploy abra:

```text
https://al-oe-translate-call-woad.vercel.app/api/health
```

Deve indicar:

```json
{
  "version": "1.1.4-gemini-metered-turn",
  "geminiConfigured": true,
  "turnConfigured": true,
  "turnProvider": "metered-turn",
  "productionReady": true
}
```

Depois crie uma chamada totalmente nova para testar a ligação.
