'use client';

import { useMemo, useState } from 'react';

const COLORS = {
  bg: '#07141d',
  card: '#0d2230',
  card2: '#102b3a',
  border: '#1f4658',
  text: '#f4f8fb',
  muted: '#9fb2bf',
  green: '#39e6a3',
  blue: '#7dd9ff',
  yellow: '#ffd166',
  red: '#ff6577',
};

const INITIAL = {
  browser: { status: 'idle', title: 'Navegador', detail: 'Ainda não testado.' },
  microphone: { status: 'idle', title: 'Microfone', detail: 'Ainda não testado.' },
  signaling: { status: 'idle', title: 'Sinalização', detail: 'Ainda não testado.' },
  turn: { status: 'idle', title: 'TURN / Metered', detail: 'Ainda não testado.' },
  geminiSession: { status: 'idle', title: 'Sessão Gemini', detail: 'Ainda não testado.' },
  geminiWs: { status: 'idle', title: 'Gemini WebSocket', detail: 'Ainda não testado.' },
};

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function randomRoom() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

function randomSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function statusLabel(status) {
  if (status === 'ok') return 'OK';
  if (status === 'running') return 'A testar';
  if (status === 'warn') return 'Aviso';
  if (status === 'error') return 'Erro';
  return 'Por testar';
}

function statusColor(status) {
  if (status === 'ok') return COLORS.green;
  if (status === 'running') return COLORS.blue;
  if (status === 'warn') return COLORS.yellow;
  if (status === 'error') return COLORS.red;
  return COLORS.muted;
}

function safeMessage(error) {
  return error?.message || String(error || 'Erro desconhecido');
}

function countTurnServers(iceServers) {
  let total = 0;

  for (const server of iceServers || []) {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];

    for (const url of urls) {
      if (typeof url === 'string' && /^turns?:/i.test(url)) {
        total += 1;
      }
    }
  }

  return total;
}

async function waitForRelayCandidate(iceServers, timeoutMs = 10000) {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('RTCPeerConnection não está disponível neste navegador.');
  }

  const turnOnly = (iceServers || []).filter((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    return urls.some((url) => typeof url === 'string' && /^turns?:/i.test(url));
  });

  if (!turnOnly.length) {
    throw new Error('A API não devolveu servidores TURN.');
  }

  const pc = new RTCPeerConnection({
    iceServers: turnOnly,
    iceTransportPolicy: 'relay',
    iceCandidatePoolSize: 0,
  });

  let finished = false;

  try {
    pc.createDataChannel('aloe-diagnostic');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new Error('Não foi obtido candidato relay dentro de 10 segundos.'));
      }, timeoutMs);

      pc.onicecandidate = (event) => {
        if (finished || !event.candidate) return;

        const candidate = event.candidate;
        const raw = candidate.candidate || '';
        const isRelay =
          candidate.type === 'relay' ||
          raw.includes(' typ relay ') ||
          raw.endsWith(' typ relay');

        if (!isRelay) return;

        finished = true;
        clearTimeout(timer);

        resolve({
          protocol: candidate.protocol || 'desconhecido',
          address: candidate.address || 'oculto pelo navegador',
          port: candidate.port || null,
          type: 'relay',
        });
      };

      pc.onicecandidateerror = (event) => {
        console.warn('ICE candidate error', event);
      };
    });
  } finally {
    try {
      pc.close();
    } catch {}
  }
}

async function parseWsMessage(data) {
  if (typeof data === 'string') return JSON.parse(data);

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return JSON.parse(await data.text());
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data));
  }

  throw new Error('Formato WebSocket desconhecido.');
}

async function testGeminiWebSocket(session, timeoutMs = 12000) {
  if (!session?.token) {
    throw new Error('Token Gemini temporário em falta.');
  }

  const apiVersion = session.apiVersion || 'v1beta';

  const endpoint =
    'wss://generativelanguage.googleapis.com/ws/' +
    `google.ai.generativelanguage.${apiVersion}.GenerativeService.` +
    'BidiGenerateContentConstrained' +
    `?access_token=${encodeURIComponent(session.token)}`;

  const ws = new WebSocket(endpoint);

  return await new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      try {
        ws.close(1000, 'diagnostic complete');
      } catch {}

      fn(value);
    };

    const timer = setTimeout(() => {
      finish(
        reject,
        new Error('Tempo esgotado ao aguardar setupComplete do Gemini.')
      );
    }, timeoutMs);

    ws.onopen = () => {
      const setup = {
        setup: {
          model: `models/${session.model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            translationConfig: {
              targetLanguageCode: session.targetLanguageCode,
              echoTargetLanguage: true,
            },
          },
          sessionResumption: {},
          contextWindowCompression: {
            slidingWindow: {},
          },
        },
      };

      try {
        ws.send(JSON.stringify(setup));
      } catch (error) {
        finish(reject, error);
      }
    };

    ws.onmessage = async (event) => {
      try {
        const message = await parseWsMessage(event.data);

        if (message?.error) {
          finish(
            reject,
            new Error(
              message.error?.message ||
                JSON.stringify(message.error)
            )
          );
          return;
        }

        if (message?.setupComplete) {
          finish(resolve, {
            apiVersion,
            model: session.model,
            targetLanguageCode: session.targetLanguageCode,
          });
        }
      } catch (error) {
        finish(reject, error);
      }
    };

    ws.onerror = () => {
      finish(reject, new Error('Erro ao abrir o WebSocket Gemini.'));
    };

    ws.onclose = (event) => {
      if (settled) return;

      finish(
        reject,
        new Error(
          `WebSocket fechado antes de setupComplete. Código ${event.code}${
            event.reason ? ` — ${event.reason}` : ''
          }`
        )
      );
    };
  });
}

function TestCard({ item }) {
  const color = statusColor(item.status);

  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 18,
        padding: 18,
        minHeight: 150,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <strong style={{ fontSize: 17 }}>{item.title}</strong>

        <span
          style={{
            border: `1px solid ${color}`,
            color,
            padding: '5px 9px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {statusLabel(item.status)}
        </span>
      </div>

      <div
        style={{
          color: COLORS.muted,
          lineHeight: 1.5,
          fontSize: 14,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {item.detail}
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const [tests, setTests] = useState(INITIAL);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState('');
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => {
    const values = Object.values(tests);
    const ok = values.filter((item) => item.status === 'ok').length;
    const errors = values.filter((item) => item.status === 'error').length;
    const warnings = values.filter((item) => item.status === 'warn').length;

    return { ok, errors, warnings, total: values.length };
  }, [tests]);

  function updateTest(key, patch) {
    setTests((previous) => ({
      ...previous,
      [key]: {
        ...previous[key],
        ...patch,
      },
    }));
  }

  function resetTests() {
    setTests(INITIAL);
    setLastRun('');
    setCopied(false);
  }

  async function runBrowserTest() {
    updateTest('browser', {
      status: 'running',
      detail: 'A verificar capacidades do navegador…',
    });

    const checks = {
      secureContext: window.isSecureContext,
      mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      webRtc: typeof RTCPeerConnection !== 'undefined',
      webSocket: typeof WebSocket !== 'undefined',
      audioContext: Boolean(window.AudioContext || window.webkitAudioContext),
      serviceWorker: 'serviceWorker' in navigator,
    };

    const missing = Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length) {
      updateTest('browser', {
        status: 'error',
        detail: `Faltam capacidades: ${missing.join(', ')}.`,
      });
      return;
    }

    updateTest('browser', {
      status: 'ok',
      detail:
        `HTTPS/contexto seguro: sim\n` +
        `WebRTC: sim\nWebSocket: sim\nAudioContext: sim\n` +
        `Service Worker: sim`,
    });
  }

  async function runMicrophoneTest() {
    updateTest('microphone', {
      status: 'running',
      detail: 'A pedir acesso ao microfone…',
    });

    let stream;

    try {
      const started = performance.now();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() || {};

      updateTest('microphone', {
        status: 'ok',
        detail:
          `Permissão concedida em ${elapsedMs(started)} ms\n` +
          `Dispositivo: ${track?.label || 'microfone disponível'}\n` +
          `Sample rate: ${settings.sampleRate || 'automático'} Hz\n` +
          `Canais: ${settings.channelCount || 'automático'}`,
      });
    } catch (error) {
      updateTest('microphone', {
        status: 'error',
        detail: safeMessage(error),
      });
    } finally {
      stream?.getTracks?.().forEach((track) => track.stop());
    }
  }

  async function runSignalingTest() {
    updateTest('signaling', {
      status: 'running',
      detail: 'A testar escrita, leitura e limpeza no /api/signal…',
    });

    const room = randomRoom();
    const secret = randomSecret();

    const fakeSdp =
      'v=0\r\n' +
      'o=- 0 0 IN IP4 127.0.0.1\r\n' +
      's=ALOe Diagnostic\r\n' +
      't=0 0\r\n';

    const query = new URLSearchParams({
      room,
      secret,
      kind: 'offer',
    });

    const started = performance.now();

    try {
      const post = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          secret,
          kind: 'offer',
          sdp: fakeSdp,
        }),
        cache: 'no-store',
      });

      const postData = await post.json().catch(() => ({}));

      if (!post.ok) {
        throw new Error(postData?.error || `POST /api/signal: ${post.status}`);
      }

      const get = await fetch(`/api/signal?${query}`, {
        cache: 'no-store',
      });

      const getData = await get.json().catch(() => ({}));

      if (!get.ok || !getData?.found || getData?.sdp !== fakeSdp) {
        throw new Error(
          getData?.error ||
            `Leitura da sinalização falhou (${get.status}).`
        );
      }

      await fetch(
        `/api/signal?${new URLSearchParams({ room, secret })}`,
        {
          method: 'DELETE',
          cache: 'no-store',
        }
      ).catch(() => {});

      updateTest('signaling', {
        status: 'ok',
        detail:
          `Vercel Blob: escrita + leitura + limpeza OK\n` +
          `Tempo total: ${elapsedMs(started)} ms\n` +
          `Sala de teste: ${room}`,
      });
    } catch (error) {
      await fetch(
        `/api/signal?${new URLSearchParams({ room, secret })}`,
        {
          method: 'DELETE',
          cache: 'no-store',
        }
      ).catch(() => {});

      updateTest('signaling', {
        status: 'error',
        detail: safeMessage(error),
      });
    }
  }

  async function runTurnTest() {
    updateTest('turn', {
      status: 'running',
      detail: 'A obter credenciais Metered e a forçar candidato relay…',
    });

    const started = performance.now();

    try {
      const response = await fetch('/api/turn', {
        method: 'POST',
        cache: 'no-store',
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.error || `Erro /api/turn (${response.status}).`
        );
      }

      const turnCount = countTurnServers(data?.iceServers);

      if (!turnCount) {
        throw new Error('Foram recebidos ICE servers, mas nenhum é TURN.');
      }

      const relay = await waitForRelayCandidate(data.iceServers);

      updateTest('turn', {
        status: 'ok',
        detail:
          `Fornecedor: ${data?.provider || 'metered'}\n` +
          `Região: ${data?.region || 'global'}\n` +
          `URLs TURN recebidos: ${turnCount}\n` +
          `Candidato relay: sim\n` +
          `Protocolo: ${relay.protocol}\n` +
          `Tempo: ${elapsedMs(started)} ms`,
      });
    } catch (error) {
      updateTest('turn', {
        status: 'error',
        detail: safeMessage(error),
      });
    }
  }

  async function runGeminiTests() {
    updateTest('geminiSession', {
      status: 'running',
      detail: 'A criar token efémero no /api/session…',
    });

    updateTest('geminiWs', {
      status: 'running',
      detail: 'A aguardar sessão Gemini…',
    });

    let session;

    try {
      const started = performance.now();

      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetLanguage: 'en',
          room: 'diagnostic',
          role: 'host',
        }),
        cache: 'no-store',
      });

      session = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          session?.error || `Erro /api/session (${response.status}).`
        );
      }

      if (!session?.token || !session?.model || !session?.targetLanguageCode) {
        throw new Error('Resposta /api/session incompleta.');
      }

      updateTest('geminiSession', {
        status: 'ok',
        detail:
          `Token efémero: recebido (não exibido)\n` +
          `Modelo: ${session.model}\n` +
          `API: ${session.apiVersion || 'não indicada'}\n` +
          `Destino: ${session.targetLanguageCode}\n` +
          `Tempo: ${elapsedMs(started)} ms`,
      });
    } catch (error) {
      updateTest('geminiSession', {
        status: 'error',
        detail: safeMessage(error),
      });

      updateTest('geminiWs', {
        status: 'error',
        detail: 'Não foi possível testar o WebSocket porque a sessão falhou.',
      });

      return;
    }

    try {
      updateTest('geminiWs', {
        status: 'running',
        detail: 'Token recebido. A abrir WebSocket e a aguardar setupComplete…',
      });

      const started = performance.now();
      const result = await testGeminiWebSocket(session);

      updateTest('geminiWs', {
        status: 'ok',
        detail:
          `WebSocket: 101 / ligação aceite\n` +
          `setupComplete: recebido\n` +
          `Session resumption: configurado\n` +
          `Compressão de contexto: configurada\n` +
          `API: ${result.apiVersion}\n` +
          `Modelo: ${result.model}\n` +
          `Destino: ${result.targetLanguageCode}\n` +
          `Tempo: ${elapsedMs(started)} ms`,
      });
    } catch (error) {
      updateTest('geminiWs', {
        status: 'error',
        detail: safeMessage(error),
      });
    }
  }

  async function runAll() {
    if (running) return;

    setRunning(true);
    setCopied(false);
    setLastRun('');

    setTests(INITIAL);

    try {
      await runBrowserTest();
      await runMicrophoneTest();
      await runSignalingTest();
      await runTurnTest();
      await runGeminiTests();
    } finally {
      setLastRun(nowIso());
      setRunning(false);
    }
  }

  async function copyReport() {
    const report = {
      app: 'ALOe Translate Call',
      diagnosticVersion: '1.0',
      createdAt: nowIso(),
      location: window.location.origin,
      userAgent: navigator.userAgent,
      tests,
      note: 'O relatório não inclui API keys, tokens Gemini, credenciais TURN nem segredos de sala.',
    };

    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);

    setTimeout(() => setCopied(false), 2500);
  }

  const overallColor =
    summary.errors > 0
      ? COLORS.red
      : summary.warnings > 0
        ? COLORS.yellow
        : summary.ok === summary.total
          ? COLORS.green
          : COLORS.blue;

  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top right, #0b3a31 0, #07141d 30%, #061019 100%)',
        color: COLORS.text,
        padding: '28px 18px 60px',
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ width: 'min(1040px, 100%)', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                marginBottom: 7,
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  background: COLORS.green,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#061b16',
                  fontSize: 24,
                  fontWeight: 900,
                }}
              >
                A
              </div>

              <div>
                <h1 style={{ margin: 0, fontSize: 26 }}>
                  ALOe Translate Call — Diagnóstico
                </h1>
                <div style={{ color: COLORS.muted, marginTop: 3 }}>
                  Ambiente de testes da branch develop
                </div>
              </div>
            </div>
          </div>

          <a
            href="/"
            style={{
              color: COLORS.blue,
              textDecoration: 'none',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: '10px 14px',
              background: COLORS.card,
              fontWeight: 700,
            }}
          >
            ← Voltar à aplicação
          </a>
        </div>

        <section
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 22,
            padding: 22,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 18,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div
                style={{
                  color: COLORS.muted,
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                }}
              >
                Estado geral
              </div>

              <div
                style={{
                  color: overallColor,
                  fontSize: 30,
                  fontWeight: 900,
                  marginTop: 5,
                }}
              >
                {running
                  ? 'Diagnóstico em curso…'
                  : summary.ok === summary.total
                    ? 'Tudo operacional'
                    : summary.errors
                      ? `${summary.errors} erro(s) detetado(s)`
                      : 'Pronto para testar'}
              </div>

              <div style={{ color: COLORS.muted, marginTop: 8 }}>
                {summary.ok}/{summary.total} testes OK
                {lastRun ? ` · Último teste: ${lastRun}` : ''}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={runAll}
                disabled={running}
                style={{
                  border: 0,
                  borderRadius: 14,
                  padding: '13px 18px',
                  background: running ? '#1c5c4b' : COLORS.green,
                  color: '#051b15',
                  fontWeight: 900,
                  cursor: running ? 'not-allowed' : 'pointer',
                  fontSize: 15,
                }}
              >
                {running ? 'A testar…' : '▶ Executar diagnóstico completo'}
              </button>

              <button
                type="button"
                onClick={copyReport}
                disabled={running}
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 14,
                  padding: '13px 18px',
                  background: COLORS.card2,
                  color: COLORS.text,
                  fontWeight: 800,
                  cursor: running ? 'not-allowed' : 'pointer',
                }}
              >
                {copied ? '✓ Copiado' : 'Copiar relatório'}
              </button>

              <button
                type="button"
                onClick={resetTests}
                disabled={running}
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 14,
                  padding: '13px 18px',
                  background: 'transparent',
                  color: COLORS.muted,
                  fontWeight: 800,
                  cursor: running ? 'not-allowed' : 'pointer',
                }}
              >
                Limpar
              </button>
            </div>
          </div>
        </section>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          <TestCard item={tests.browser} />
          <TestCard item={tests.microphone} />
          <TestCard item={tests.signaling} />
          <TestCard item={tests.turn} />
          <TestCard item={tests.geminiSession} />
          <TestCard item={tests.geminiWs} />
        </div>

        <section
          style={{
            marginTop: 18,
            background: '#0a1b25',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 18,
            color: COLORS.muted,
            lineHeight: 1.6,
            fontSize: 14,
          }}
        >
          <strong style={{ color: COLORS.text }}>O que este painel testa</strong>
          <div style={{ marginTop: 8 }}>
            Navegador e WebRTC · permissão do microfone · Vercel Blob / sinalização ·
            credenciais Metered TURN com candidato relay real · criação do token efémero
            Gemini · abertura do WebSocket Gemini e receção de setupComplete.
          </div>

          <div style={{ marginTop: 10, color: COLORS.green }}>
            Segurança: nunca mostra nem copia GEMINI_API_KEY, METERED_TURN_API_KEY,
            token efémero Gemini, password TURN ou segredo real de uma chamada.
          </div>
        </section>
      </div>
    </main>
  );
}
'use client';

import { useMemo, useState } from 'react';

const COLORS = {
  bg: '#07141d',
  card: '#0d2230',
  card2: '#102b3a',
  border: '#1f4658',
  text: '#f4f8fb',
  muted: '#9fb2bf',
  green: '#39e6a3',
  blue: '#7dd9ff',
  yellow: '#ffd166',
  red: '#ff6577',
};

const INITIAL = {
  browser: { status: 'idle', title: 'Navegador', detail: 'Ainda não testado.' },
  microphone: { status: 'idle', title: 'Microfone', detail: 'Ainda não testado.' },
  signaling: { status: 'idle', title: 'Sinalização', detail: 'Ainda não testado.' },
  turn: { status: 'idle', title: 'TURN / Metered', detail: 'Ainda não testado.' },
  geminiSession: { status: 'idle', title: 'Sessão Gemini', detail: 'Ainda não testado.' },
  geminiWs: { status: 'idle', title: 'Gemini WebSocket', detail: 'Ainda não testado.' },
};

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function randomRoom() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

function randomSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function statusLabel(status) {
  if (status === 'ok') return 'OK';
  if (status === 'running') return 'A testar';
  if (status === 'warn') return 'Aviso';
  if (status === 'error') return 'Erro';
  return 'Por testar';
}

function statusColor(status) {
  if (status === 'ok') return COLORS.green;
  if (status === 'running') return COLORS.blue;
  if (status === 'warn') return COLORS.yellow;
  if (status === 'error') return COLORS.red;
  return COLORS.muted;
}

function safeMessage(error) {
  return error?.message || String(error || 'Erro desconhecido');
}

function countTurnServers(iceServers) {
  let total = 0;

  for (const server of iceServers || []) {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];

    for (const url of urls) {
      if (typeof url === 'string' && /^turns?:/i.test(url)) {
        total += 1;
      }
    }
  }

  return total;
}

async function waitForRelayCandidate(iceServers, timeoutMs = 10000) {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('RTCPeerConnection não está disponível neste navegador.');
  }

  const turnOnly = (iceServers || []).filter((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    return urls.some((url) => typeof url === 'string' && /^turns?:/i.test(url));
  });

  if (!turnOnly.length) {
    throw new Error('A API não devolveu servidores TURN.');
  }

  const pc = new RTCPeerConnection({
    iceServers: turnOnly,
    iceTransportPolicy: 'relay',
    iceCandidatePoolSize: 0,
  });

  let finished = false;

  try {
    pc.createDataChannel('aloe-diagnostic');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new Error('Não foi obtido candidato relay dentro de 10 segundos.'));
      }, timeoutMs);

      pc.onicecandidate = (event) => {
        if (finished || !event.candidate) return;

        const candidate = event.candidate;
        const raw = candidate.candidate || '';
        const isRelay =
          candidate.type === 'relay' ||
          raw.includes(' typ relay ') ||
          raw.endsWith(' typ relay');

        if (!isRelay) return;

        finished = true;
        clearTimeout(timer);

        resolve({
          protocol: candidate.protocol || 'desconhecido',
          address: candidate.address || 'oculto pelo navegador',
          port: candidate.port || null,
          type: 'relay',
        });
      };

      pc.onicecandidateerror = (event) => {
        console.warn('ICE candidate error', event);
      };
    });
  } finally {
    try {
      pc.close();
    } catch {}
  }
}

async function parseWsMessage(data) {
  if (typeof data === 'string') return JSON.parse(data);

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return JSON.parse(await data.text());
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data));
  }

  throw new Error('Formato WebSocket desconhecido.');
}

async function testGeminiWebSocket(session, timeoutMs = 12000) {
  if (!session?.token) {
    throw new Error('Token Gemini temporário em falta.');
  }

  const apiVersion = session.apiVersion || 'v1alpha';

  const endpoint =
    'wss://generativelanguage.googleapis.com/ws/' +
    `google.ai.generativelanguage.${apiVersion}.GenerativeService.` +
    'BidiGenerateContentConstrained' +
    `?access_token=${encodeURIComponent(session.token)}`;

  const ws = new WebSocket(endpoint);

  return await new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      try {
        ws.close(1000, 'diagnostic complete');
      } catch {}

      fn(value);
    };

    const timer = setTimeout(() => {
      finish(
        reject,
        new Error('Tempo esgotado ao aguardar setupComplete do Gemini.')
      );
    }, timeoutMs);

    ws.onopen = () => {
      const setup = {
        setup: {
          model: `models/${session.model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            translationConfig: {
              targetLanguageCode: session.targetLanguageCode,
              echoTargetLanguage: true,
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };

      try {
        ws.send(JSON.stringify(setup));
      } catch (error) {
        finish(reject, error);
      }
    };

    ws.onmessage = async (event) => {
      try {
        const message = await parseWsMessage(event.data);

        if (message?.error) {
          finish(
            reject,
            new Error(
              message.error?.message ||
                JSON.stringify(message.error)
            )
          );
          return;
        }

        if (message?.setupComplete) {
          finish(resolve, {
            apiVersion,
            model: session.model,
            targetLanguageCode: session.targetLanguageCode,
          });
        }
      } catch (error) {
        finish(reject, error);
      }
    };

    ws.onerror = () => {
      finish(reject, new Error('Erro ao abrir o WebSocket Gemini.'));
    };

    ws.onclose = (event) => {
      if (settled) return;

      finish(
        reject,
        new Error(
          `WebSocket fechado antes de setupComplete. Código ${event.code}${
            event.reason ? ` — ${event.reason}` : ''
          }`
        )
      );
    };
  });
}

function TestCard({ item }) {
  const color = statusColor(item.status);

  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 18,
        padding: 18,
        minHeight: 150,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <strong style={{ fontSize: 17 }}>{item.title}</strong>

        <span
          style={{
            border: `1px solid ${color}`,
            color,
            padding: '5px 9px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {statusLabel(item.status)}
        </span>
      </div>

      <div
        style={{
          color: COLORS.muted,
          lineHeight: 1.5,
          fontSize: 14,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {item.detail}
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const [tests, setTests] = useState(INITIAL);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState('');
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => {
    const values = Object.values(tests);
    const ok = values.filter((item) => item.status === 'ok').length;
    const errors = values.filter((item) => item.status === 'error').length;
    const warnings = values.filter((item) => item.status === 'warn').length;

    return { ok, errors, warnings, total: values.length };
  }, [tests]);

  function updateTest(key, patch) {
    setTests((previous) => ({
      ...previous,
      [key]: {
        ...previous[key],
        ...patch,
      },
    }));
  }

  function resetTests() {
    setTests(INITIAL);
    setLastRun('');
    setCopied(false);
  }

  async function runBrowserTest() {
    updateTest('browser', {
      status: 'running',
      detail: 'A verificar capacidades do navegador…',
    });

    const checks = {
      secureContext: window.isSecureContext,
      mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      webRtc: typeof RTCPeerConnection !== 'undefined',
      webSocket: typeof WebSocket !== 'undefined',
      audioContext: Boolean(window.AudioContext || window.webkitAudioContext),
      serviceWorker: 'serviceWorker' in navigator,
    };

    const missing = Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length) {
      updateTest('browser', {
        status: 'error',
        detail: `Faltam capacidades: ${missing.join(', ')}.`,
      });
      return;
    }

    updateTest('browser', {
      status: 'ok',
      detail:
        `HTTPS/contexto seguro: sim\n` +
        `WebRTC: sim\nWebSocket: sim\nAudioContext: sim\n` +
        `Service Worker: sim`,
    });
  }

  async function runMicrophoneTest() {
    updateTest('microphone', {
      status: 'running',
      detail: 'A pedir acesso ao microfone…',
    });

    let stream;

    try {
      const started = performance.now();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() || {};

      updateTest('microphone', {
        status: 'ok',
        detail:
          `Permissão concedida em ${elapsedMs(started)} ms\n` +
          `Dispositivo: ${track?.label || 'microfone disponível'}\n` +
          `Sample rate: ${settings.sampleRate || 'automático'} Hz\n` +
          `Canais: ${settings.channelCount || 'automático'}`,
      });
    } catch (error) {
      updateTest('microphone', {
        status: 'error',
        detail: safeMessage(error),
      });
    } finally {
      stream?.getTracks?.().forEach((track) => track.stop());
    }
  }

  async function runSignalingTest() {
    updateTest('signaling', {
      status: 'running',
      detail: 'A testar escrita, leitura e limpeza no /api/signal…',
    });

    const room = randomRoom();
    const secret = randomSecret();

    const fakeSdp =
      'v=0\r\n' +
      'o=- 0 0 IN IP4 127.0.0.1\r\n' +
      's=ALOe Diagnostic\r\n' +
      't=0 0\r\n';

    const query = new URLSearchParams({
      room,
      secret,
      kind: 'offer',
    });

    const started = performance.now();

    try {
      const post = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          secret,
          kind: 'offer',
          sdp: fakeSdp,
        }),
        cache: 'no-store',
      });

      const postData = await post.json().catch(() => ({}));

      if (!post.ok) {
        throw new Error(postData?.error || `POST /api/signal: ${post.status}`);
      }

      const get = await fetch(`/api/signal?${query}`, {
        cache: 'no-store',
      });

      const getData = await get.json().catch(() => ({}));

      if (!get.ok || !getData?.found || getData?.sdp !== fakeSdp) {
        throw new Error(
          getData?.error ||
            `Leitura da sinalização falhou (${get.status}).`
        );
      }

      await fetch(
        `/api/signal?${new URLSearchParams({ room, secret })}`,
        {
          method: 'DELETE',
          cache: 'no-store',
        }
      ).catch(() => {});

      updateTest('signaling', {
        status: 'ok',
        detail:
          `Vercel Blob: escrita + leitura + limpeza OK\n` +
          `Tempo total: ${elapsedMs(started)} ms\n` +
          `Sala de teste: ${room}`,
      });
    } catch (error) {
      await fetch(
        `/api/signal?${new URLSearchParams({ room, secret })}`,
        {
          method: 'DELETE',
          cache: 'no-store',
        }
      ).catch(() => {});

      updateTest('signaling', {
        status: 'error',
        detail: safeMessage(error),
      });
    }
  }

  async function runTurnTest() {
    updateTest('turn', {
      status: 'running',
      detail: 'A obter credenciais Metered e a forçar candidato relay…',
    });

    const started = performance.now();

    try {
      const response = await fetch('/api/turn', {
        method: 'POST',
        cache: 'no-store',
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.error || `Erro /api/turn (${response.status}).`
        );
      }

      const turnCount = countTurnServers(data?.iceServers);

      if (!turnCount) {
        throw new Error('Foram recebidos ICE servers, mas nenhum é TURN.');
      }

      const relay = await waitForRelayCandidate(data.iceServers);

      updateTest('turn', {
        status: 'ok',
        detail:
          `Fornecedor: ${data?.provider || 'metered'}\n` +
          `Região: ${data?.region || 'global'}\n` +
          `URLs TURN recebidos: ${turnCount}\n` +
          `Candidato relay: sim\n` +
          `Protocolo: ${relay.protocol}\n` +
          `Tempo: ${elapsedMs(started)} ms`,
      });
    } catch (error) {
      updateTest('turn', {
        status: 'error',
        detail: safeMessage(error),
      });
    }
  }

  async function runGeminiTests() {
    updateTest('geminiSession', {
      status: 'running',
      detail: 'A criar token efémero no /api/session…',
    });

    updateTest('geminiWs', {
      status: 'running',
      detail: 'A aguardar sessão Gemini…',
    });

    let session;

    try {
      const started = performance.now();

      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetLanguage: 'en',
          room: 'diagnostic',
          role: 'host',
        }),
        cache: 'no-store',
      });

      session = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          session?.error || `Erro /api/session (${response.status}).`
        );
      }

      if (!session?.token || !session?.model || !session?.targetLanguageCode) {
        throw new Error('Resposta /api/session incompleta.');
      }

      updateTest('geminiSession', {
        status: 'ok',
        detail:
          `Token efémero: recebido (não exibido)\n` +
          `Modelo: ${session.model}\n` +
          `API: ${session.apiVersion || 'não indicada'}\n` +
          `Destino: ${session.targetLanguageCode}\n` +
          `Tempo: ${elapsedMs(started)} ms`,
      });
    } catch (error) {
      updateTest('geminiSession', {
        status: 'error',
        detail: safeMessage(error),
      });

      updateTest('geminiWs', {
        status: 'error',
        detail: 'Não foi possível testar o WebSocket porque a sessão falhou.',
      });

      return;
    }

    try {
      updateTest('geminiWs', {
        status: 'running',
        detail: 'Token recebido. A abrir WebSocket e a aguardar setupComplete…',
      });

      const started = performance.now();
      const result = await testGeminiWebSocket(session);

      updateTest('geminiWs', {
        status: 'ok',
        detail:
          `WebSocket: 101 / ligação aceite\n` +
          `setupComplete: recebido\n` +
          `API: ${result.apiVersion}\n` +
          `Modelo: ${result.model}\n` +
          `Destino: ${result.targetLanguageCode}\n` +
          `Tempo: ${elapsedMs(started)} ms`,
      });
    } catch (error) {
      updateTest('geminiWs', {
        status: 'error',
        detail: safeMessage(error),
      });
    }
  }

  async function runAll() {
    if (running) return;

    setRunning(true);
    setCopied(false);
    setLastRun('');

    setTests(INITIAL);

    try {
      await runBrowserTest();
      await runMicrophoneTest();
      await runSignalingTest();
      await runTurnTest();
      await runGeminiTests();
    } finally {
      setLastRun(nowIso());
      setRunning(false);
    }
  }

  async function copyReport() {
    const report = {
      app: 'ALOe Translate Call',
      diagnosticVersion: '1.0',
      createdAt: nowIso(),
      location: window.location.origin,
      userAgent: navigator.userAgent,
      tests,
      note: 'O relatório não inclui API keys, tokens Gemini, credenciais TURN nem segredos de sala.',
    };

    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);

    setTimeout(() => setCopied(false), 2500);
  }

  const overallColor =
    summary.errors > 0
      ? COLORS.red
      : summary.warnings > 0
        ? COLORS.yellow
        : summary.ok === summary.total
          ? COLORS.green
          : COLORS.blue;

  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top right, #0b3a31 0, #07141d 30%, #061019 100%)',
        color: COLORS.text,
        padding: '28px 18px 60px',
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ width: 'min(1040px, 100%)', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                marginBottom: 7,
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  background: COLORS.green,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#061b16',
                  fontSize: 24,
                  fontWeight: 900,
                }}
              >
                A
              </div>

              <div>
                <h1 style={{ margin: 0, fontSize: 26 }}>
                  ALOe Translate Call — Diagnóstico
                </h1>
                <div style={{ color: COLORS.muted, marginTop: 3 }}>
                  Ambiente de testes da branch develop
                </div>
              </div>
            </div>
          </div>

          <a
            href="/"
            style={{
              color: COLORS.blue,
              textDecoration: 'none',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: '10px 14px',
              background: COLORS.card,
              fontWeight: 700,
            }}
          >
            ← Voltar à aplicação
          </a>
        </div>

        <section
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 22,
            padding: 22,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 18,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div
                style={{
                  color: COLORS.muted,
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                }}
              >
                Estado geral
              </div>

              <div
                style={{
                  color: overallColor,
                  fontSize: 30,
                  fontWeight: 900,
                  marginTop: 5,
                }}
              >
                {running
                  ? 'Diagnóstico em curso…'
                  : summary.ok === summary.total
                    ? 'Tudo operacional'
                    : summary.errors
                      ? `${summary.errors} erro(s) detetado(s)`
                      : 'Pronto para testar'}
              </div>

              <div style={{ color: COLORS.muted, marginTop: 8 }}>
                {summary.ok}/{summary.total} testes OK
                {lastRun ? ` · Último teste: ${lastRun}` : ''}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={runAll}
                disabled={running}
                style={{
                  border: 0,
                  borderRadius: 14,
                  padding: '13px 18px',
                  background: running ? '#1c5c4b' : COLORS.green,
                  color: '#051b15',
                  fontWeight: 900,
                  cursor: running ? 'not-allowed' : 'pointer',
                  fontSize: 15,
                }}
              >
                {running ? 'A testar…' : '▶ Executar diagnóstico completo'}
              </button>

              <button
                type="button"
                onClick={copyReport}
                disabled={running}
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 14,
                  padding: '13px 18px',
                  background: COLORS.card2,
                  color: COLORS.text,
                  fontWeight: 800,
                  cursor: running ? 'not-allowed' : 'pointer',
                }}
              >
                {copied ? '✓ Copiado' : 'Copiar relatório'}
              </button>

              <button
                type="button"
                onClick={resetTests}
                disabled={running}
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 14,
                  padding: '13px 18px',
                  background: 'transparent',
                  color: COLORS.muted,
                  fontWeight: 800,
                  cursor: running ? 'not-allowed' : 'pointer',
                }}
              >
                Limpar
              </button>
            </div>
          </div>
        </section>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          <TestCard item={tests.browser} />
          <TestCard item={tests.microphone} />
          <TestCard item={tests.signaling} />
          <TestCard item={tests.turn} />
          <TestCard item={tests.geminiSession} />
          <TestCard item={tests.geminiWs} />
        </div>

        <section
          style={{
            marginTop: 18,
            background: '#0a1b25',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 18,
            color: COLORS.muted,
            lineHeight: 1.6,
            fontSize: 14,
          }}
        >
          <strong style={{ color: COLORS.text }}>O que este painel testa</strong>
          <div style={{ marginTop: 8 }}>
            Navegador e WebRTC · permissão do microfone · Vercel Blob / sinalização ·
            credenciais Metered TURN com candidato relay real · criação do token efémero
            Gemini · abertura do WebSocket Gemini e receção de setupComplete.
          </div>

          <div style={{ marginTop: 10, color: COLORS.green }}>
            Segurança: nunca mostra nem copia GEMINI_API_KEY, METERED_TURN_API_KEY,
            token efémero Gemini, password TURN ou segredo real de uma chamada.
          </div>
        </section>
      </div>
    </main>
  );
}
