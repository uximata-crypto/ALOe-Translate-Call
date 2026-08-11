# ALOe Translate Call v1.0.3

## Correção do link público

Esta versão nunca envia ao interlocutor o URL protegido de um deployment (`*-projects.vercel.app`). Os convites usam sempre o domínio público de produção. No projeto atual, o fallback é `https://al-oe-translate-call-woad.vercel.app`. Se no futuro usar um domínio próprio, pode definir opcionalmente `NEXT_PUBLIC_APP_URL` com esse domínio.

# ALOe Translate Call — Fresh v1.0

Web/PWA para chamadas internas entre **duas pessoas**, com **Português (Portugal) sempre como língua principal** e tradução de voz em tempo real para:

- Espanhol (`es`)
- Inglês (`en`)
- Francês (`fr`)
- Alemão (`de`)
- Coreano (`ko`)
- Mandarim / Chinês (`zh`)

## Arquitetura limpa

Esta versão foi refeita de raiz.

- **GitHub** — código-fonte.
- **Vercel** — alojamento, Functions e um **Vercel Blob privado** para a troca inicial do SDP WebRTC.
- **OpenAI Realtime Translation** — `gpt-realtime-translate` para voz + legendas.
- **WebRTC** — áudio da chamada diretamente entre os dois browsers.
- **Upstash / Redis** — **não é usado**.

O Blob do Vercel guarda apenas os dois pequenos documentos de sinalização `offer` e `answer`. O áudio da chamada não é armazenado no Blob. Depois de o anfitrião receber a resposta, a app tenta apagar esses ficheiros.

## Única variável que tem de escrever no Vercel

```text
OPENAI_API_KEY
```

Nunca coloque a chave OpenAI dentro do código ou do GitHub.

## Publicar — passo a passo

### 1. GitHub

Crie um repositório vazio, por exemplo:

```text
aloe-translate-call
```

Carregue **todos os ficheiros desta pasta** para a raiz do repositório.

### 2. Vercel

- `Add New` → `Project`
- Importe `aloe-translate-call` do GitHub.
- Framework: o Vercel deve reconhecer **Next.js** automaticamente.
- Faça o primeiro Deploy.

### 3. OPENAI_API_KEY

No projeto Vercel:

`Settings` → `Environment Variables` → `Add Environment Variable`

Key:

```text
OPENAI_API_KEY
```

Value: a sua chave OpenAI.

Marque como **Sensitive** e grave.

### 4. Criar Blob PRIVADO dentro do próprio Vercel

Não precisa de criar conta Upstash, Redis ou outro fornecedor.

No mesmo projeto Vercel:

`Storage` → `Create Database` → `Blob` → `Continue` → **Private** → ligar ao projeto.

No Vercel, o SDK `@vercel/blob` pode autenticar com **OIDC automaticamente** quando o store está ligado ao projeto. Assim não tem de copiar manualmente `BLOB_READ_WRITE_TOKEN` para esta utilização no Vercel.

Depois faça **Redeploy**.

### 5. Verificação

Abra:

```text
https://SEU-PROJETO.vercel.app/api/health
```

Deverá aparecer algo semelhante a:

```json
{
  "ok": true,
  "openaiConfigured": true,
  "signaling": "vercel-private-blob",
  "upstashRequired": false
}
```

### 6. Primeiro teste

1. Abra a app no primeiro telemóvel.
2. Escolha Espanhol, Inglês, Francês, Alemão, Coreano ou Mandarim.
3. Prima **Nova chamada** e autorize o microfone.
4. Quando aparecer o link, copie-o e envie ao segundo telemóvel.
5. No segundo telemóvel, abra o link e prima **Entrar**.
6. Autorize o microfone.
7. Fale português no primeiro lado; o segundo lado deve ouvir a tradução.
8. O segundo fala a língua dele; o primeiro deve ouvir português.

## Limitação atual importante

Esta versão usa STUN público e WebRTC direto, sem fornecedor TURN externo. Isso mantém o projeto apenas em GitHub + Vercel + OpenAI, mas algumas redes empresariais, hotéis, CGNAT ou firewalls muito restritivos podem impedir a ligação direta. Se isso acontecer, a fase seguinte é acrescentar TURN.

## Segurança

- A chave `OPENAI_API_KEY` existe apenas no servidor Vercel.
- O browser recebe apenas um **client secret temporário** para a sessão Realtime Translation.
- O link de convite inclui um segredo aleatório de alta entropia.
- O Blob é privado.
- Não guarde nem publique `.env.local`.

## Desenvolvimento local (opcional)

Para testar localmente, além de `OPENAI_API_KEY`, o acesso ao Vercel Blob necessita de credenciais locais. O caminho mais simples é usar a CLI Vercel e puxar as variáveis do projeto.

```bash
npm install
vercel link
vercel env pull .env.local
npm run dev
```

Abra `http://localhost:3000`.

## v1.0.2 — autenticação Blob reforçada

Esta revisão prefere `BLOB_READ_WRITE_TOKEN` quando o Vercel o disponibiliza para o store. Se não existir, usa explicitamente `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`. O endpoint `/api/health` mostra apenas indicadores booleanos/modo de autenticação (nunca os segredos) para facilitar diagnóstico.


## Correção OIDC v1.0.2

No runtime de Vercel Functions, o token OIDC é resolvido pelo pacote oficial `@vercel/oidc`, que lê o contexto/cabeçalho `x-vercel-oidc-token`. A aplicação deixou de depender de `process.env.VERCEL_OIDC_TOKEN` no runtime.

Depois de atualizar o GitHub, aguarde o novo deployment e teste:

```text
/api/health
```

O esperado é `blobAuthMode: "oidc"`, `blobStoreIdConfigured: true`, `vercelOidcAvailable: true` e `productionReady: true`.
