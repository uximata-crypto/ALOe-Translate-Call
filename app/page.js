'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const LANGUAGES = [
  { code: 'es', name: 'Espanhol', native: 'Español', flag: '🇪🇸' },
  { code: 'en', name: 'Inglês', native: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Francês', native: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Alemão', native: 'Deutsch', flag: '🇩🇪' },
  { code: 'ko', name: 'Coreano', native: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: 'Mandarim / Chinês', native: '中文（普通话）', flag: '🇨🇳' },
];

const FALLBACK_PUBLIC_APP_URL =
  'https://al-oe-translate-call-woad.vercel.app';

const FALLBACK_ICE_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
    ],
  },
];

function getPublicAppUrl() {
  const vercelProductionHost =
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;

  const configured =
    process.env.NEXT_PUBLIC_APP_URL;

  const value =
    configured ||
    (vercelProductionHost
      ? `https://${vercelProductionHost}`
      : FALLBACK_PUBLIC_APP_URL);

  return value.replace(/\/$/, '');
}

async function getRtcConfig() {
  let iceServers = [...FALLBACK_ICE_SERVERS];

  try {
    const response = await fetch('/api/turn', {
      method: 'POST',
      cache: 'no-store',
    });

    const data = await response
      .json()
      .catch(() => ({}));

    if (
      response.ok &&
      Array.isArray(data?.iceServers) &&
      data.iceServers.length
    ) {
      iceServers = [
        ...FALLBACK_ICE_SERVERS,
        ...data.iceServers,
      ];
    }
  } catch (error) {
    console.warn(
      'TURN indisponível. A usar apenas STUN.',
      error
    );
  }

  return {
    iceServers,
    iceCandidatePoolSize: 10,
  };
}

function randomRoom() {
  const values = new Uint32Array(1);

  crypto.getRandomValues(values);

  return String(
    100000 + (values[0] % 900000)
  );
}

function randomSecret() {
  const bytes = new Uint8Array(24);

  crypto.getRandomValues(bytes);

  return btoa(
    String.fromCharCode(...bytes)
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function waitForIceGathering(
  pc,
  timeout = 10000
) {
  if (
    pc.iceGatheringState === 'complete'
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) return;

      finished = true;

      clearTimeout(timer);

      pc.removeEventListener(
        'icegatheringstatechange',
        check
      );

      resolve();
    };

    const check = () => {
      if (
        pc.iceGatheringState ===
        'complete'
      ) {
        finish();
      }
    };

    const timer = setTimeout(
      finish,
      timeout
    );

    pc.addEventListener(
      'icegatheringstatechange',
      check
    );
  });
}

function trimTranscript(text) {
  if (!text) return '';

  if (text.length <= 1400) {
    return text;
  }

  return `…${text.slice(-1399)}`;
}

function appendTranscript(
  setter,
  text
) {
  if (!text) return;

  setter((previous) => {
    const separator =
      previous &&
      !previous.endsWith(' ')
        ? ' '
        : '';

    return trimTranscript(
      `${previous}${separator}${text}`
    );
  });
}

function downsampleTo16k(
  input,
  inputRate
) {
  if (inputRate === 16000) {
    return new Float32Array(input);
  }

  const ratio =
    inputRate / 16000;

  const outputLength =
    Math.max(
      1,
      Math.floor(
        input.length / ratio
      )
    );

  const output =
    new Float32Array(
      outputLength
    );

  for (
    let i = 0;
    i < outputLength;
    i += 1
  ) {
    const position =
      i * ratio;

    const left =
      Math.floor(position);

    const right =
      Math.min(
        left + 1,
        input.length - 1
      );

    const fraction =
      position - left;

    output[i] =
      input[left] *
        (1 - fraction) +
      input[right] *
        fraction;
  }

  return output;
}

function pcm16Base64(samples) {
  const bytes =
    new Uint8Array(
      samples.length * 2
    );

  const view =
    new DataView(bytes.buffer);

  for (
    let i = 0;
    i < samples.length;
    i += 1
  ) {
    const sample =
      Math.max(
        -1,
        Math.min(
          1,
          samples[i]
        )
      );

    const value =
      sample < 0
        ? sample * 0x8000
        : sample * 0x7fff;

    view.setInt16(
      i * 2,
      value,
      true
    );
  }

  let binary = '';

  const step = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += step
  ) {
    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i + step
        )
      );
  }

  return btoa(binary);
}

function base64ToPcmFloat32(
  base64
) {
  const binary = atob(base64);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i += 1
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  const view =
    new DataView(
      bytes.buffer
    );

  const samples =
    new Float32Array(
      Math.floor(
        bytes.length / 2
      )
    );

  for (
    let i = 0;
    i < samples.length;
    i += 1
  ) {
    const value =
      view.getInt16(
        i * 2,
        true
      );

    samples[i] =
      value < 0
        ? value / 0x8000
        : value / 0x7fff;
  }

  return samples;
}

async function parseWebSocketMessage(
  data
) {
  if (
    typeof data === 'string'
  ) {
    return JSON.parse(data);
  }

  if (
    typeof Blob !==
      'undefined' &&
    data instanceof Blob
  ) {
    return JSON.parse(
      await data.text()
    );
  }

  if (
    data instanceof ArrayBuffer
  ) {
    const text =
      new TextDecoder().decode(
        data
      );

    return JSON.parse(text);
  }

  throw new Error(
    'Formato de mensagem Gemini desconhecido.'
  );
}

/* -------------------- Diagnóstico de chamada -------------------- */

function createLiveDiagnostics() {
  return {
    webRtcState: 'new',
    iceState: 'new',
    signalingState: 'stable',
    connectionPath: 'A determinar…',
    candidateProtocol: '—',
    localCandidateType: '—',
    remoteCandidateType: '—',
    rttMs: null,
    jitterMs: null,
    packetLossPct: null,
    inboundKbps: null,
    outboundKbps: null,
    inboundAudioLevelPct: null,
    geminiWsState: 'fechado',
    geminiSetupComplete: false,
    geminiApiVersion: '—',
    geminiModel: '—',
    geminiTarget: '—',
    geminiStartupMs: null,
    translationLatencyMs: null,
    reconnects: 0,
    lastError: '',
    lastErrorAt: '',
    updatedAt: '',
  };
}

function numericOrNull(value) {
  return Number.isFinite(value)
    ? value
    : null;
}

function rounded(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor =
    10 ** digits;

  return Math.round(
    value * factor
  ) / factor;
}

function findSelectedCandidatePair(
  report
) {
  let transport = null;
  let selectedPair = null;
  let fallbackPair = null;

  report.forEach((stat) => {
    if (
      stat.type === 'transport'
    ) {
      transport = stat;
    }

    if (
      stat.type ===
        'candidate-pair' &&
      stat.state === 'succeeded'
    ) {
      if (
        stat.selected === true
      ) {
        selectedPair = stat;
      }

      if (
        stat.nominated === true
      ) {
        fallbackPair = stat;
      }
    }
  });

  if (
    !selectedPair &&
    transport?.selectedCandidatePairId
  ) {
    selectedPair =
      report.get(
        transport.selectedCandidatePairId
      ) || null;
  }

  return (
    selectedPair ||
    fallbackPair ||
    null
  );
}

function findAudioStats(report) {
  let inbound = null;
  let outbound = null;

  report.forEach((stat) => {
    const isAudio =
      stat.kind === 'audio' ||
      stat.mediaType === 'audio';

    if (
      stat.type ===
        'inbound-rtp' &&
      isAudio &&
      !stat.isRemote
    ) {
      inbound = stat;
    }

    if (
      stat.type ===
        'outbound-rtp' &&
      isAudio &&
      !stat.isRemote
    ) {
      outbound = stat;
    }
  });

  return {
    inbound,
    outbound,
  };
}

function candidatePath(
  localCandidate,
  remoteCandidate
) {
  const localType =
    localCandidate?.candidateType ||
    'desconhecido';

  const remoteType =
    remoteCandidate?.candidateType ||
    'desconhecido';

  if (
    localType === 'relay' ||
    remoteType === 'relay'
  ) {
    return 'TURN / relay';
  }

  if (
    localType === 'srflx' ||
    remoteType === 'srflx'
  ) {
    return 'Direta / STUN';
  }

  if (
    localType === 'host' &&
    remoteType === 'host'
  ) {
    return 'Direta / rede local';
  }

  return 'Direta / ICE';
}

function metricText(
  value,
  suffix = '',
  decimals = 0
) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value)
  ) {
    return '—';
  }

  return `${Number(value).toFixed(decimals)}${suffix}`;
}

function wsStateLabel(ws) {
  if (!ws) return 'fechado';

  if (
    ws.readyState ===
    WebSocket.CONNECTING
  ) {
    return 'a ligar';
  }

  if (
    ws.readyState ===
    WebSocket.OPEN
  ) {
    return 'aberto';
  }

  if (
    ws.readyState ===
    WebSocket.CLOSING
  ) {
    return 'a fechar';
  }

  return 'fechado';
}

function DiagnosticsMetric({
  label,
  value,
  accent = false,
}) {
  return (
    <div
      style={{
        padding: '12px 13px',
        borderRadius: 13,
        background:
          'rgba(5, 20, 29, 0.52)',
        border:
          '1px solid rgba(124, 217, 255, 0.13)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: '#8fa8b7',
          marginBottom: 4,
          fontWeight: 800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          color: accent
            ? '#57e5aa'
            : '#eef7fb',
          fontSize: 15,
          fontWeight: 800,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LiveDiagnosticsPanel({
  diagnostics,
  onCopy,
  copied,
}) {
  const geminiOk =
    diagnostics.geminiWsState ===
      'aberto' &&
    diagnostics.geminiSetupComplete;

  return (
    <div
      style={{
        marginTop: 18,
        padding: 16,
        borderRadius: 18,
        background:
          'linear-gradient(145deg, rgba(5, 23, 32, .96), rgba(12, 42, 53, .92))',
        border:
          '1px solid rgba(87, 229, 170, .24)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent:
            'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <div>
          <strong
            style={{
              color: '#f4fbff',
              fontSize: 16,
            }}
          >
            📊 Diagnóstico da chamada
          </strong>

          <div
            style={{
              marginTop: 4,
              color: '#91a9b7',
              fontSize: 12,
            }}
          >
            Atualização automática a cada 2 segundos
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <a
            href="/diagnostico"
            target="_blank"
            rel="noreferrer"
            style={{
              color: '#7dd9ff',
              textDecoration: 'none',
              border:
                '1px solid rgba(125, 217, 255, .28)',
              borderRadius: 11,
              padding: '8px 10px',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            Teste completo
          </a>

          <button
            type="button"
            onClick={onCopy}
            style={{
              color: '#f4fbff',
              background:
                'rgba(255,255,255,.04)',
              border:
                '1px solid rgba(255,255,255,.13)',
              borderRadius: 11,
              padding: '8px 10px',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {copied
              ? '✓ Copiado'
              : 'Copiar diagnóstico'}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(135px, 1fr))',
          gap: 9,
        }}
      >
        <DiagnosticsMetric
          label="WebRTC"
          value={
            diagnostics.webRtcState
          }
          accent={
            diagnostics.webRtcState ===
            'connected'
          }
        />

        <DiagnosticsMetric
          label="Ligação"
          value={
            diagnostics.connectionPath
          }
          accent={
            diagnostics.connectionPath.includes(
              'TURN'
            )
          }
        />

        <DiagnosticsMetric
          label="RTT"
          value={metricText(
            diagnostics.rttMs,
            ' ms',
            0
          )}
        />

        <DiagnosticsMetric
          label="Jitter"
          value={metricText(
            diagnostics.jitterMs,
            ' ms',
            1
          )}
        />

        <DiagnosticsMetric
          label="Perda"
          value={metricText(
            diagnostics.packetLossPct,
            '%',
            2
          )}
        />

        <DiagnosticsMetric
          label="Entrada"
          value={metricText(
            diagnostics.inboundKbps,
            ' kbps',
            1
          )}
        />

        <DiagnosticsMetric
          label="Saída"
          value={metricText(
            diagnostics.outboundKbps,
            ' kbps',
            1
          )}
        />

        <DiagnosticsMetric
          label="Áudio recebido"
          value={metricText(
            diagnostics.inboundAudioLevelPct,
            '%',
            0
          )}
        />

        <DiagnosticsMetric
          label="ICE"
          value={
            diagnostics.iceState
          }
        />

        <DiagnosticsMetric
          label="Protocolo"
          value={
            diagnostics.candidateProtocol
          }
        />

        <DiagnosticsMetric
          label="Gemini WS"
          value={
            geminiOk
              ? 'aberto + setup OK'
              : diagnostics.geminiWsState
          }
          accent={geminiOk}
        />

        <DiagnosticsMetric
          label="Arranque Gemini"
          value={metricText(
            diagnostics.geminiStartupMs,
            ' ms',
            0
          )}
        />

        <DiagnosticsMetric
          label="Tradução aprox."
          value={metricText(
            diagnostics.translationLatencyMs,
            ' ms',
            0
          )}
        />

        <DiagnosticsMetric
          label="Reconexões"
          value={
            diagnostics.reconnects
          }
        />

        <DiagnosticsMetric
          label="API Gemini"
          value={
            diagnostics.geminiApiVersion
          }
        />

        <DiagnosticsMetric
          label="Destino"
          value={
            diagnostics.geminiTarget
          }
        />
      </div>

      <div
        style={{
          marginTop: 11,
          padding: 12,
          borderRadius: 12,
          background:
            diagnostics.lastError
              ? 'rgba(255, 101, 119, .08)'
              : 'rgba(87, 229, 170, .06)',
          border:
            diagnostics.lastError
              ? '1px solid rgba(255, 101, 119, .24)'
              : '1px solid rgba(87, 229, 170, .16)',
          color:
            diagnostics.lastError
              ? '#ffb4be'
              : '#9de9c9',
          fontSize: 12,
          lineHeight: 1.45,
          overflowWrap: 'anywhere',
        }}
      >
        {diagnostics.lastError
          ? `Último erro: ${diagnostics.lastError}${
              diagnostics.lastErrorAt
                ? ` · ${diagnostics.lastErrorAt}`
                : ''
            }`
          : 'Sem erros técnicos registados nesta chamada.'}
      </div>

      <div
        style={{
          marginTop: 8,
          color: '#718b99',
          fontSize: 11,
        }}
      >
        Modelo: {diagnostics.geminiModel} · candidato local:{' '}
        {diagnostics.localCandidateType} · candidato remoto:{' '}
        {diagnostics.remoteCandidateType}
      </div>
    </div>
  );
}

/* -------------------- Aplicação -------------------- */

export default function Home() {
  const [
    language,
    setLanguage,
  ] = useState('es');

  const [
    role,
    setRole,
  ] = useState('host');

  const [
    room,
    setRoom,
  ] = useState('');

  const [
    secret,
    setSecret,
  ] = useState('');

  const [
    invite,
    setInvite,
  ] = useState('');

  const [
    status,
    setStatus,
  ] = useState(
    'Pronto para iniciar'
  );

  const [
    connected,
    setConnected,
  ] = useState(false);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    muted,
    setMuted,
  ] = useState(false);

  const [
    hearOriginal,
    setHearOriginal,
  ] = useState(false);

  const [
    sourceText,
    setSourceText,
  ] = useState('');

  const [
    translatedText,
    setTranslatedText,
  ] = useState('');

  const [
    elapsed,
    setElapsed,
  ] = useState(0);

  const [
    installPrompt,
    setInstallPrompt,
  ] = useState(null);

  const [
    error,
    setError,
  ] = useState('');

  const [
    liveDiagOpen,
    setLiveDiagOpen,
  ] = useState(false);

  const [
    liveDiagCopied,
    setLiveDiagCopied,
  ] = useState(false);

  const [
    liveDiagnostics,
    setLiveDiagnostics,
  ] = useState(
    createLiveDiagnostics
  );

  const localStreamRef =
    useRef(null);

  const callPcRef =
    useRef(null);

  const geminiWsRef =
    useRef(null);

  const geminiReadyRef =
    useRef(false);

  const geminiInputContextRef =
    useRef(null);

  const geminiOutputContextRef =
    useRef(null);

  const geminiSourceRef =
    useRef(null);

  const geminiProcessorRef =
    useRef(null);

  const geminiSilentGainRef =
    useRef(null);

  const geminiRemoteTrackRef =
    useRef(null);

  const geminiNextPlayTimeRef =
    useRef(0);

  const originalAudioRef =
    useRef(null);

  const pollAbortRef =
    useRef(false);

  const startedAtRef =
    useRef(null);

  const liveStatsPreviousRef =
    useRef(null);

  const lastPeerStateRef =
    useRef('new');

  const peerEverConnectedRef =
    useRef(false);

  const peerInterruptedRef =
    useRef(false);

  const geminiStartedAtRef =
    useRef(null);

  const lastInputTranscriptionAtRef =
    useRef(null);

  const selected = useMemo(
    () =>
      LANGUAGES.find(
        (item) =>
          item.code === language
      ) || LANGUAGES[0],
    [language]
  );

  const isGuest =
    role === 'guest';

  function updateLiveDiagnostics(
    patch
  ) {
    setLiveDiagnostics(
      (previous) => ({
        ...previous,
        ...patch,
        updatedAt:
          new Date().toISOString(),
      })
    );
  }

  function recordTechnicalError(
    message
  ) {
    if (!message) return;

    updateLiveDiagnostics({
      lastError: String(message),
      lastErrorAt:
        new Date().toLocaleTimeString(
          'pt-PT'
        ),
    });
  }

  function resetLiveDiagnostics() {
    liveStatsPreviousRef.current =
      null;

    lastPeerStateRef.current =
      'new';

    peerEverConnectedRef.current =
      false;

    peerInterruptedRef.current =
      false;

    geminiStartedAtRef.current =
      null;

    lastInputTranscriptionAtRef.current =
      null;

    setLiveDiagnostics(
      createLiveDiagnostics()
    );

    setLiveDiagCopied(false);
  }

  async function refreshCallStats() {
    const pc =
      callPcRef.current;

    if (
      !pc ||
      pc.connectionState ===
        'closed'
    ) {
      return;
    }

    try {
      const report =
        await pc.getStats();

      const pair =
        findSelectedCandidatePair(
          report
        );

      const localCandidate =
        pair?.localCandidateId
          ? report.get(
              pair.localCandidateId
            )
          : null;

      const remoteCandidate =
        pair?.remoteCandidateId
          ? report.get(
              pair.remoteCandidateId
            )
          : null;

      const {
        inbound,
        outbound,
      } = findAudioStats(
        report
      );

      const now =
        performance.now();

      const inboundBytes =
        Number(
          inbound?.bytesReceived ||
            0
        );

      const outboundBytes =
        Number(
          outbound?.bytesSent ||
            0
        );

      const previous =
        liveStatsPreviousRef.current;

      let inboundKbps = null;
      let outboundKbps = null;

      if (
        previous &&
        now > previous.at
      ) {
        const deltaMs =
          now - previous.at;

        inboundKbps =
          ((inboundBytes -
            previous.inboundBytes) *
            8) /
          deltaMs;

        outboundKbps =
          ((outboundBytes -
            previous.outboundBytes) *
            8) /
          deltaMs;

        if (
          inboundKbps < 0
        ) {
          inboundKbps = null;
        }

        if (
          outboundKbps < 0
        ) {
          outboundKbps = null;
        }
      }

      liveStatsPreviousRef.current =
        {
          at: now,
          inboundBytes,
          outboundBytes,
        };

      const packetsReceived =
        Number(
          inbound?.packetsReceived ||
            0
        );

      const packetsLost =
        Math.max(
          0,
          Number(
            inbound?.packetsLost ||
              0
          )
        );

      const packetTotal =
        packetsReceived +
        packetsLost;

      const lossPct =
        packetTotal > 0
          ? (packetsLost /
              packetTotal) *
            100
          : null;

      let rttMs = null;

      if (
        Number.isFinite(
          pair?.currentRoundTripTime
        )
      ) {
        rttMs =
          pair.currentRoundTripTime *
          1000;
      } else if (
        Number.isFinite(
          pair?.totalRoundTripTime
        ) &&
        Number(
          pair?.responsesReceived
        ) > 0
      ) {
        rttMs =
          (pair.totalRoundTripTime /
            pair.responsesReceived) *
          1000;
      }

      const jitterMs =
        Number.isFinite(
          inbound?.jitter
        )
          ? inbound.jitter * 1000
          : null;

      const audioLevel =
        Number.isFinite(
          inbound?.audioLevel
        )
          ? Math.max(
              0,
              Math.min(
                100,
                inbound.audioLevel *
                  100
              )
            )
          : null;

      const protocol =
        localCandidate?.protocol ||
        pair?.protocol ||
        '—';

      updateLiveDiagnostics({
        webRtcState:
          pc.connectionState,
        iceState:
          pc.iceConnectionState,
        signalingState:
          pc.signalingState,
        connectionPath:
          pair
            ? candidatePath(
                localCandidate,
                remoteCandidate
              )
            : 'A determinar…',
        candidateProtocol:
          String(protocol),
        localCandidateType:
          localCandidate
            ?.candidateType ||
          '—',
        remoteCandidateType:
          remoteCandidate
            ?.candidateType ||
          '—',
        rttMs: rounded(
          numericOrNull(rttMs),
          0
        ),
        jitterMs: rounded(
          numericOrNull(
            jitterMs
          ),
          1
        ),
        packetLossPct:
          rounded(
            numericOrNull(
              lossPct
            ),
            2
          ),
        inboundKbps: rounded(
          numericOrNull(
            inboundKbps
          ),
          1
        ),
        outboundKbps: rounded(
          numericOrNull(
            outboundKbps
          ),
          1
        ),
        inboundAudioLevelPct:
          rounded(
            numericOrNull(
              audioLevel
            ),
            0
          ),
        geminiWsState:
          wsStateLabel(
            geminiWsRef.current
          ),
      });
    } catch (statsError) {
      console.warn(
        'Diagnóstico WebRTC getStats:',
        statsError
      );
    }
  }

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const join =
      params.get('join');

    const key =
      params.get('k');

    const lang =
      params.get('lang');

    if (
      join &&
      key &&
      LANGUAGES.some(
        (item) =>
          item.code === lang
      )
    ) {
      setRole('guest');

      setRoom(join);

      setSecret(key);

      setLanguage(lang);

      setStatus(
        'Convite recebido — pronto para entrar'
      );
    }

    if (
      'serviceWorker' in navigator
    ) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => {});
    }

    const handleInstall =
      (event) => {
        event.preventDefault();

        setInstallPrompt(
          event
        );
      };

    window.addEventListener(
      'beforeinstallprompt',
      handleInstall
    );

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleInstall
      );
    };
  }, []);

  useEffect(() => {
    if (!connected) {
      setElapsed(0);

      return;
    }

    startedAtRef.current =
      Date.now();

    const timer =
      setInterval(() => {
        setElapsed(
          Math.floor(
            (Date.now() -
              startedAtRef.current) /
              1000
          )
        );
      }, 1000);

    return () =>
      clearInterval(timer);
  }, [connected]);

  useEffect(() => {
    if (
      originalAudioRef.current
    ) {
      originalAudioRef.current.muted =
        !hearOriginal;
    }
  }, [hearOriginal]);

  useEffect(() => {
    if (!connected) {
      liveStatsPreviousRef.current =
        null;

      return;
    }

    refreshCallStats();

    const timer =
      setInterval(
        refreshCallStats,
        2000
      );

    return () =>
      clearInterval(timer);
  }, [connected]);

  async function ensureMic() {
    if (
      localStreamRef.current
    ) {
      return localStreamRef.current;
    }

    const stream =
      await navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

    localStreamRef.current =
      stream;

    return stream;
  }

  function makeCallPeer(
    stream,
    rtcConfig
  ) {
    const pc =
      new RTCPeerConnection(
        rtcConfig
      );

    callPcRef.current = pc;

    updateLiveDiagnostics({
      webRtcState:
        pc.connectionState,
      iceState:
        pc.iceConnectionState,
      signalingState:
        pc.signalingState,
    });

    stream
      .getAudioTracks()
      .forEach((track) => {
        pc.addTrack(
          track,
          stream
        );
      });

    pc.ontrack = (event) => {
      const remoteStream =
        event.streams?.[0] ||
        new MediaStream([
          event.track,
        ]);

      if (
        originalAudioRef.current
      ) {
        originalAudioRef.current.srcObject =
          remoteStream;

        originalAudioRef.current.muted =
          !hearOriginal;

        originalAudioRef.current
          .play()
          .catch(() => {});
      }

      startTranslation(
        event.track
      ).catch(
        (translationError) => {
          console.error(
            'Gemini Live:',
            translationError
          );

          recordTechnicalError(
            translationError.message
          );

          stopGeminiTranslation();

          setError(
            `A chamada ligou, mas a tradução não iniciou: ${translationError.message}`
          );
        }
      );
    };

    pc.oniceconnectionstatechange =
      () => {
        updateLiveDiagnostics({
          iceState:
            pc.iceConnectionState,
        });
      };

    pc.onsignalingstatechange =
      () => {
        updateLiveDiagnostics({
          signalingState:
            pc.signalingState,
        });
      };

    pc.onconnectionstatechange =
      () => {
        const state =
          pc.connectionState;

        const previousState =
          lastPeerStateRef.current;

        updateLiveDiagnostics({
          webRtcState: state,
          iceState:
            pc.iceConnectionState,
          signalingState:
            pc.signalingState,
        });

        if (
          state ===
            'disconnected' ||
          state === 'failed'
        ) {
          if (
            peerEverConnectedRef.current
          ) {
            peerInterruptedRef.current =
              true;
          }
        }

        if (
          state === 'connected'
        ) {
          if (
            peerEverConnectedRef.current &&
            peerInterruptedRef.current
          ) {
            setLiveDiagnostics(
              (previous) => ({
                ...previous,
                reconnects:
                  previous.reconnects +
                  1,
                webRtcState:
                  state,
                updatedAt:
                  new Date().toISOString(),
              })
            );

            peerInterruptedRef.current =
              false;
          }

          peerEverConnectedRef.current =
            true;

          setConnected(true);

          setBusy(false);

          setStatus(
            'Chamada ligada — tradução em tempo real'
          );
        } else if (
          state === 'failed'
        ) {
          setConnected(false);

          setBusy(false);

          setStatus(
            'Ligação falhou'
          );

          const message =
            'Não foi possível estabelecer a ligação WebRTC. Verifique a rede ou o serviço TURN.';

          recordTechnicalError(
            message
          );

          setError(message);
        } else if (
          state ===
          'disconnected'
        ) {
          setStatus(
            'Ligação interrompida — a tentar recuperar…'
          );
        } else if (
          state === 'closed'
        ) {
          setConnected(false);
        }

        lastPeerStateRef.current =
          state ||
          previousState;
      };

    return pc;
  }

  async function postSignal(
    kind,
    sdp,
    callRoom = room,
    callSecret = secret
  ) {
    const response =
      await fetch(
        '/api/signal',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            room: callRoom,
            secret:
              callSecret,
            kind,
            sdp,
          }),
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
          'Erro de sinalização.'
      );
    }
  }

  async function getSignal(
    kind,
    callRoom = room,
    callSecret = secret
  ) {
    const query =
      new URLSearchParams({
        room: callRoom,
        secret:
          callSecret,
        kind,
      });

    const response =
      await fetch(
        `/api/signal?${query}`,
        {
          cache:
            'no-store',
        }
      );

    if (
      response.status === 404
    ) {
      return null;
    }

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
          'Erro de sinalização.'
      );
    }

    return data;
  }

  async function pollFor(
    kind,
    callRoom,
    callSecret,
    seconds = 600
  ) {
    const limit =
      Date.now() +
      seconds * 1000;

    while (
      Date.now() < limit &&
      !pollAbortRef.current
    ) {
      const data =
        await getSignal(
          kind,
          callRoom,
          callSecret
        );

      if (data?.sdp) {
        return data.sdp;
      }

      await sleep(1200);
    }

    throw new Error(
      'Tempo de espera esgotado. Crie uma nova chamada.'
    );
  }

  async function createCall() {
    setError('');

    setBusy(true);

    setInvite('');

    pollAbortRef.current =
      false;

    resetLiveDiagnostics();

    try {
      const newRoom =
        randomRoom();

      const newSecret =
        randomSecret();

      setRoom(newRoom);

      setSecret(newSecret);

      setStatus(
        'A preparar a chamada…'
      );

      const [
        stream,
        rtcConfig,
      ] =
        await Promise.all([
          ensureMic(),
          getRtcConfig(),
        ]);

      const pc =
        makeCallPeer(
          stream,
          rtcConfig
        );

      const offer =
        await pc.createOffer();

      await pc.setLocalDescription(
        offer
      );

      await waitForIceGathering(
        pc
      );

      await postSignal(
        'offer',
        pc.localDescription.sdp,
        newRoom,
        newSecret
      );

      const link =
        `${getPublicAppUrl()}/` +
        `?join=${encodeURIComponent(
          newRoom
        )}` +
        `&k=${encodeURIComponent(
          newSecret
        )}` +
        `&lang=${encodeURIComponent(
          language
        )}`;

      setInvite(link);

      setStatus(
        'Convite criado — a aguardar o interlocutor'
      );

      const answerSdp =
        await pollFor(
          'answer',
          newRoom,
          newSecret
        );

      if (
        !pc.currentRemoteDescription
      ) {
        await pc.setRemoteDescription(
          {
            type: 'answer',
            sdp: answerSdp,
          }
        );
      }

      setTimeout(() => {
        const query =
          new URLSearchParams({
            room: newRoom,
            secret:
              newSecret,
          });

        fetch(
          `/api/signal?${query}`,
          {
            method:
              'DELETE',
          }
        ).catch(() => {});
      }, 5000);
    } catch (callError) {
      console.error(
        callError
      );

      recordTechnicalError(
        callError.message
      );

      setBusy(false);

      setStatus(
        'Não foi possível iniciar'
      );

      setError(
        callError.message ||
          'Erro ao iniciar chamada.'
      );
    }
  }

  async function joinCall() {
    setError('');

    setBusy(true);

    pollAbortRef.current =
      false;

    resetLiveDiagnostics();

    try {
      setStatus(
        'A ligar à chamada…'
      );

      const [
        stream,
        rtcConfig,
      ] =
        await Promise.all([
          ensureMic(),
          getRtcConfig(),
        ]);

      const pc =
        makeCallPeer(
          stream,
          rtcConfig
        );

      const offerSdp =
        await pollFor(
          'offer',
          room,
          secret,
          120
        );

      await pc.setRemoteDescription(
        {
          type: 'offer',
          sdp: offerSdp,
        }
      );

      const answer =
        await pc.createAnswer();

      await pc.setLocalDescription(
        answer
      );

      await waitForIceGathering(
        pc
      );

      await postSignal(
        'answer',
        pc.localDescription.sdp,
        room,
        secret
      );

      setStatus(
        'Resposta enviada — a estabelecer ligação…'
      );
    } catch (callError) {
      console.error(
        callError
      );

      recordTechnicalError(
        callError.message
      );

      setBusy(false);

      setStatus(
        'Não foi possível entrar'
      );

      setError(
        callError.message ||
          'Erro ao entrar na chamada.'
      );
    }
  }

  function playGeminiPcm(
    base64Audio
  ) {
    const context =
      geminiOutputContextRef.current;

    if (
      !context ||
      !base64Audio
    ) {
      return;
    }

    const samples =
      base64ToPcmFloat32(
        base64Audio
      );

    if (!samples.length) {
      return;
    }

    const buffer =
      context.createBuffer(
        1,
        samples.length,
        24000
      );

    buffer.copyToChannel(
      samples,
      0
    );

    const source =
      context.createBufferSource();

    source.buffer = buffer;

    source.connect(
      context.destination
    );

    const startAt =
      Math.max(
        context.currentTime +
          0.03,
        geminiNextPlayTimeRef.current ||
          0
      );

    source.start(startAt);

    geminiNextPlayTimeRef.current =
      startAt +
      buffer.duration;
  }

  function stopGeminiTranslation() {
    geminiReadyRef.current =
      false;

    updateLiveDiagnostics({
      geminiSetupComplete:
        false,
      geminiWsState:
        'fechado',
    });

    if (
      geminiProcessorRef.current
    ) {
      try {
        geminiProcessorRef.current.onaudioprocess =
          null;

        geminiProcessorRef.current.disconnect();
      } catch {}
    }

    try {
      geminiSourceRef.current?.disconnect();
    } catch {}

    try {
      geminiSilentGainRef.current?.disconnect();
    } catch {}

    geminiProcessorRef.current =
      null;

    geminiSourceRef.current =
      null;

    geminiSilentGainRef.current =
      null;

    try {
      geminiRemoteTrackRef.current?.stop();
    } catch {}

    geminiRemoteTrackRef.current =
      null;

    const ws =
      geminiWsRef.current;

    geminiWsRef.current =
      null;

    if (
      ws &&
      (
        ws.readyState ===
          WebSocket.OPEN ||
        ws.readyState ===
          WebSocket.CONNECTING
      )
    ) {
      try {
        ws.close(
          1000,
          'hangup'
        );
      } catch {}
    }

    try {
      geminiInputContextRef.current?.close();
    } catch {}

    try {
      geminiOutputContextRef.current?.close();
    } catch {}

    geminiInputContextRef.current =
      null;

    geminiOutputContextRef.current =
      null;

    geminiNextPlayTimeRef.current =
      0;

    geminiStartedAtRef.current =
      null;

    lastInputTranscriptionAtRef.current =
      null;
  }

  async function startTranslation(
    remoteTrack
  ) {
    if (
      geminiWsRef.current
    ) {
      return;
    }

    const targetLanguage =
      isGuest
        ? language
        : 'pt';

    geminiStartedAtRef.current =
      performance.now();

    updateLiveDiagnostics({
      geminiWsState:
        'a preparar sessão',
      geminiSetupComplete:
        false,
      geminiTarget:
        targetLanguage,
    });

    setStatus(
      'Chamada ligada — a iniciar Gemini Live Translate…'
    );

    const sessionResponse =
      await fetch(
        '/api/session',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            targetLanguage,
            room,
            role,
          }),

          cache:
            'no-store',
        }
      );

    const session =
      await sessionResponse
        .json()
        .catch(() => ({}));

    if (
      !sessionResponse.ok
    ) {
      throw new Error(
        session.error ||
          `Falha ao obter sessão Gemini (${sessionResponse.status}).`
      );
    }

    if (!session.token) {
      throw new Error(
        'A Gemini não devolveu o token temporário.'
      );
    }

    if (!session.model) {
      throw new Error(
        'A sessão Gemini não devolveu o modelo.'
      );
    }

    if (
      !session.targetLanguageCode
    ) {
      throw new Error(
        'A sessão Gemini não devolveu o idioma de destino.'
      );
    }

    updateLiveDiagnostics({
      geminiApiVersion:
        session.apiVersion ||
        'v1alpha',
      geminiModel:
        session.model,
      geminiTarget:
        session.targetLanguageCode,
      geminiWsState:
        'a ligar',
    });

    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error(
        'Este navegador não suporta AudioContext.'
      );
    }

    const inputContext =
      new AudioContextClass();

    const outputContext =
      new AudioContextClass();

    geminiInputContextRef.current =
      inputContext;

    geminiOutputContextRef.current =
      outputContext;

    await Promise.all([
      inputContext.resume(),
      outputContext.resume(),
    ]);

    const clonedTrack =
      remoteTrack.clone();

    geminiRemoteTrackRef.current =
      clonedTrack;

    const remoteStream =
      new MediaStream([
        clonedTrack,
      ]);

    const source =
      inputContext.createMediaStreamSource(
        remoteStream
      );

    const processor =
      inputContext.createScriptProcessor(
        4096,
        1,
        1
      );

    const silentGain =
      inputContext.createGain();

    silentGain.gain.value = 0;

    source.connect(
      processor
    );

    processor.connect(
      silentGain
    );

    silentGain.connect(
      inputContext.destination
    );

    geminiSourceRef.current =
      source;

    geminiProcessorRef.current =
      processor;

    geminiSilentGainRef.current =
      silentGain;

    const apiVersion =
      session.apiVersion ||
      'v1alpha';

    const endpoint =
      `wss://generativelanguage.googleapis.com/ws/` +
      `google.ai.generativelanguage.${apiVersion}.GenerativeService.` +
      `BidiGenerateContentConstrained` +
      `?access_token=${encodeURIComponent(
        session.token
      )}`;

    console.log(
      'Gemini Live API:',
      apiVersion,
      session.model,
      session.targetLanguageCode
    );

    const ws =
      new WebSocket(
        endpoint
      );

    geminiWsRef.current =
      ws;

    processor.onaudioprocess =
      (event) => {
        if (
          !geminiReadyRef.current ||
          ws.readyState !==
            WebSocket.OPEN
        ) {
          return;
        }

        const input =
          event.inputBuffer
            .getChannelData(0);

        const pcm =
          downsampleTo16k(
            input,
            inputContext.sampleRate
          );

        try {
          ws.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  data:
                    pcm16Base64(
                      pcm
                    ),
                  mimeType:
                    'audio/pcm;rate=16000',
                },
              },
            })
          );
        } catch (
          sendError
        ) {
          console.error(
            'Erro ao enviar áudio Gemini:',
            sendError
          );

          recordTechnicalError(
            `Envio áudio Gemini: ${sendError.message}`
          );
        }
      };

    await new Promise(
      (resolve, reject) => {
        let settled = false;

        const finishResolve =
          () => {
            if (settled) {
              return;
            }

            settled = true;

            clearTimeout(
              timeout
            );

            resolve();
          };

        const finishReject =
          (message) => {
            if (settled) {
              return;
            }

            settled = true;

            clearTimeout(
              timeout
            );

            recordTechnicalError(
              message
            );

            reject(
              new Error(
                message
              )
            );
          };

        const timeout =
          setTimeout(
            () => {
              finishReject(
                'Tempo esgotado ao aguardar setupComplete do Gemini Live.'
              );
            },
            15000
          );

        ws.onopen = () => {
          console.log(
            'WebSocket Gemini aberto.'
          );

          updateLiveDiagnostics({
            geminiWsState:
              'aberto',
          });

          const setup = {
            setup: {
              model:
                `models/${session.model}`,

              generationConfig:
                {
                  responseModalities:
                    [
                      'AUDIO',
                    ],

                  translationConfig:
                    {
                      targetLanguageCode:
                        session.targetLanguageCode,

                      echoTargetLanguage:
                        true,
                    },
                },

              inputAudioTranscription:
                {},

              outputAudioTranscription:
                {},
            },
          };

          try {
            ws.send(
              JSON.stringify(
                setup
              )
            );

            console.log(
              'Setup Gemini enviado.'
            );
          } catch (
            setupError
          ) {
            finishReject(
              `Falha ao enviar setup Gemini: ${setupError.message}`
            );
          }
        };

        ws.onmessage =
          async (event) => {
            try {
              const message =
                await parseWebSocketMessage(
                  event.data
                );

              console.debug(
                'Gemini:',
                message
              );

              if (
                message.error
              ) {
                const detail =
                  message.error
                    .message ||
                  JSON.stringify(
                    message.error
                  );

                recordTechnicalError(
                  `Gemini Live: ${detail}`
                );

                setError(
                  `Gemini Live: ${detail}`
                );

                finishReject(
                  `Gemini Live: ${detail}`
                );

                return;
              }

              if (
                message.setupComplete
              ) {
                geminiReadyRef.current =
                  true;

                const startupMs =
                  geminiStartedAtRef.current
                    ? performance.now() -
                      geminiStartedAtRef.current
                    : null;

                updateLiveDiagnostics({
                  geminiWsState:
                    'aberto',
                  geminiSetupComplete:
                    true,
                  geminiStartupMs:
                    rounded(
                      numericOrNull(
                        startupMs
                      ),
                      0
                    ),
                });

                setStatus(
                  'Chamada ligada — tradução Gemini em tempo real'
                );

                finishResolve();
              }

              const content =
                message.serverContent;

              if (!content) {
                return;
              }

              if (
                content
                  .inputTranscription
                  ?.text
              ) {
                lastInputTranscriptionAtRef.current =
                  performance.now();

                appendTranscript(
                  setSourceText,
                  content
                    .inputTranscription
                    .text
                );
              }

              if (
                content
                  .outputTranscription
                  ?.text
              ) {
                if (
                  lastInputTranscriptionAtRef.current
                ) {
                  const latency =
                    performance.now() -
                    lastInputTranscriptionAtRef.current;

                  updateLiveDiagnostics({
                    translationLatencyMs:
                      rounded(
                        latency,
                        0
                      ),
                  });

                  lastInputTranscriptionAtRef.current =
                    null;
                }

                appendTranscript(
                  setTranslatedText,
                  content
                    .outputTranscription
                    .text
                );
              }

              if (
                content.modelTurn
                  ?.parts
              ) {
                for (
                  const part of
                  content
                    .modelTurn
                    .parts
                ) {
                  if (
                    part.inlineData
                      ?.data
                  ) {
                    playGeminiPcm(
                      part.inlineData
                        .data
                    );
                  }
                }
              }
            } catch (
              messageError
            ) {
              console.error(
                'Erro ao interpretar mensagem Gemini:',
                messageError
              );

              recordTechnicalError(
                `Mensagem Gemini: ${messageError.message}`
              );
            }
          };

        ws.onerror = (
          event
        ) => {
          console.error(
            'WebSocket Gemini error:',
            event
          );

          updateLiveDiagnostics({
            geminiWsState:
              'erro',
          });

          finishReject(
            'Erro de comunicação com o WebSocket Gemini Live.'
          );
        };

        ws.onclose = (
          event
        ) => {
          const wasReady =
            geminiReadyRef.current;

          geminiReadyRef.current =
            false;

          updateLiveDiagnostics({
            geminiWsState:
              'fechado',
            geminiSetupComplete:
              false,
          });

          console.warn(
            'WebSocket Gemini fechado:',
            event.code,
            event.reason
          );

          if (!wasReady) {
            finishReject(
              `Gemini fechou a ligação antes do setupComplete. Código ${event.code}${event.reason ? ` — ${event.reason}` : ''}`
            );

            return;
          }

          if (
            event.code !== 1000
          ) {
            const message =
              `Gemini Live desligou a tradução. Código ${event.code}${event.reason ? ` — ${event.reason}` : ''}`;

            recordTechnicalError(
              message
            );

            setStatus(
              'Tradução Gemini desligada'
            );

            setError(
              message
            );
          }
        };
      }
    );
  }

  function toggleMute() {
    const next =
      !muted;

    localStreamRef.current
      ?.getAudioTracks()
      .forEach((track) => {
        track.enabled =
          !next;
      });

    setMuted(next);
  }

  async function copyInvite() {
    if (!invite) return;

    await navigator.clipboard
      .writeText(invite);

    setStatus(
      'Link copiado — envie ao interlocutor'
    );
  }

  function shareWhatsApp() {
    if (!invite) return;

    const text =
      `Entre na minha chamada ALOe Translate Call: ${invite}`;

    window.open(
      `https://wa.me/?text=${encodeURIComponent(
        text
      )}`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  async function installApp() {
    if (
      !installPrompt
    ) {
      return;
    }

    await installPrompt.prompt();

    await installPrompt
      .userChoice
      .catch(() => {});

    setInstallPrompt(null);
  }

  async function copyLiveDiagnostics() {
    const report = {
      app:
        'ALOe Translate Call',
      version:
        'v1.2.0-develop-live-diagnostics',
      generatedAt:
        new Date().toISOString(),
      role,
      selectedLanguage:
        language,
      connected,
      status,
      diagnostics:
        liveDiagnostics,
      note:
        'Sem API keys, tokens Gemini, credenciais TURN ou segredo da chamada.',
      userAgent:
        navigator.userAgent,
    };

    await navigator.clipboard
      .writeText(
        JSON.stringify(
          report,
          null,
          2
        )
      );

    setLiveDiagCopied(true);

    setTimeout(
      () =>
        setLiveDiagCopied(
          false
        ),
      2500
    );
  }

  function hangup() {
    pollAbortRef.current =
      true;

    stopGeminiTranslation();

    try {
      callPcRef.current?.close();
    } catch {}

    callPcRef.current =
      null;

    localStreamRef.current
      ?.getTracks()
      .forEach((track) => {
        try {
          track.stop();
        } catch {}
      });

    localStreamRef.current =
      null;

    if (
      originalAudioRef.current
    ) {
      originalAudioRef.current.srcObject =
        null;
    }

    setConnected(false);

    setBusy(false);

    setMuted(false);

    setSourceText('');

    setTranslatedText('');

    setError('');

    setLiveDiagOpen(false);

    setStatus(
      'Chamada terminada'
    );
  }

  const minutes =
    String(
      Math.floor(
        elapsed / 60
      )
    ).padStart(2, '0');

  const seconds =
    String(
      elapsed % 60
    ).padStart(2, '0');

  const interlocutorFlag =
    isGuest
      ? '🇵🇹'
      : selected.flag;

  const interlocutorName =
    isGuest
      ? 'Interlocutor português'
      : `Interlocutor — ${selected.name}`;

  const translationName =
    isGuest
      ? selected.name.toUpperCase()
      : 'PORTUGUÊS';

  return (
    <main className="shell">

      <header className="topbar">

        <div className="brandMark">
          A
        </div>

        <div>

          <div className="brand">
            ALOe Translate Call
          </div>

          <div className="tagline">
            Português sempre como língua principal
          </div>

        </div>

        {installPrompt && (
          <button
            className="ghost small"
            onClick={
              installApp
            }
          >
            Instalar
          </button>
        )}

      </header>

      <section className="hero card">

        <div className="ptPill">
          🇵🇹 PORTUGUÊS (PORTUGAL)
        </div>

        <h1>
          Fale em português.
          <br />
          <span>
            O outro lado ouve na língua dele.
          </span>
        </h1>

        <p>
          Chamada interna WebRTC com Gemini Live Translate, voz e legendas em tempo real.
        </p>

      </section>

      {!connected && (

        <section className="card setup">

          <div className="sectionTitle">
            {isGuest
              ? 'Entrar na chamada'
              : 'Escolha a língua do interlocutor'}
          </div>

          <div className="languageGrid">

            {LANGUAGES.map(
              (item) => (

                <button
                  key={
                    item.code
                  }
                  className={
                    `language ${
                      language ===
                      item.code
                        ? 'active'
                        : ''
                    }`
                  }
                  disabled={
                    isGuest ||
                    busy
                  }
                  onClick={() =>
                    setLanguage(
                      item.code
                    )
                  }
                >

                  <span className="flag">
                    {item.flag}
                  </span>

                  <span>

                    <strong>
                      {item.name}
                    </strong>

                    <small>
                      {item.native}
                    </small>

                  </span>

                </button>

              )
            )}

          </div>

          <div className="pairing">

            <div className="langBig">
              🇵🇹 <b>Português</b>
            </div>

            <div className="arrow">
              ⇄
            </div>

            <div className="langBig">
              {selected.flag}{' '}
              <b>
                {selected.name}
              </b>
            </div>

          </div>

          {isGuest ? (

            <button
              className="primary jumbo"
              disabled={busy}
              onClick={
                joinCall
              }
            >
              {busy
                ? 'A ligar…'
                : `📞 Entrar — ${room}`}
            </button>

          ) : (

            <button
              className="primary jumbo"
              disabled={busy}
              onClick={
                createCall
              }
            >
              {busy &&
              !invite
                ? 'A preparar…'
                : '＋ Nova chamada'}
            </button>

          )}

          {!isGuest &&
            invite && (

              <div className="inviteBox">

                <div>

                  <small>
                    Código da chamada
                  </small>

                  <strong className="roomCode">
                    {room}
                  </strong>

                </div>

                <div className="inviteActions">

                  <button
                    className="secondary"
                    onClick={
                      copyInvite
                    }
                  >
                    🔗 Copiar link
                  </button>

                  <button
                    className="secondary"
                    onClick={
                      shareWhatsApp
                    }
                  >
                    WhatsApp
                  </button>

                </div>

                <p>
                  Envie o link apenas à pessoa com quem pretende falar.
                </p>

              </div>

            )}

        </section>

      )}

      {(connected ||
        busy) && (

        <section className="card callCard">

          <div className="callTop">

            <div className="avatar">
              {interlocutorFlag}
            </div>

            <div>

              <h2>
                {interlocutorName}
              </h2>

              <div className="status">

                <span
                  className={
                    `dot ${
                      connected
                        ? 'on'
                        : ''
                    }`
                  }
                />

                {status}

              </div>

            </div>

            <div className="timer">
              {minutes}:{seconds}
            </div>

          </div>

          <div className="translateBadge">
            ✨ Tradução automática ativa
          </div>

          <div className="captions">

            <div className="caption original">

              <small>
                VOZ RECEBIDA — ORIGINAL
              </small>

              <p>
                {sourceText ||
                  'A aguardar fala…'}
              </p>

            </div>

            <div className="caption translated">

              <small>
                TRADUÇÃO — {translationName}
              </small>

              <p>
                {translatedText ||
                  'A tradução aparecerá aqui…'}
              </p>

            </div>

          </div>

          <div className="controls">

            <button
              className={
                muted
                  ? 'control dangerSoft'
                  : 'control'
              }
              onClick={
                toggleMute
              }
            >

              {muted
                ? '🔇'
                : '🎤'}

              <span>
                {muted
                  ? 'Ativar'
                  : 'Microfone'}
              </span>

            </button>

            <button
              className={
                hearOriginal
                  ? 'control activeControl'
                  : 'control'
              }
              onClick={() =>
                setHearOriginal(
                  (value) =>
                    !value
                )
              }
            >

              🔊

              <span>
                Voz original
              </span>

            </button>

            <button
              className="hang"
              onClick={
                hangup
              }
            >

              ☎

              <span>
                Desligar
              </span>

            </button>

          </div>

          <div
            style={{
              marginTop: 16,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={() =>
                setLiveDiagOpen(
                  (value) =>
                    !value
                )
              }
              style={{
                border:
                  '1px solid rgba(125, 217, 255, .25)',
                borderRadius: 13,
                padding: '10px 14px',
                background:
                  liveDiagOpen
                    ? 'rgba(87, 229, 170, .12)'
                    : 'rgba(255,255,255,.035)',
                color:
                  liveDiagOpen
                    ? '#8ff0c7'
                    : '#a9c4d2',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              📊 {liveDiagOpen
                ? 'Fechar diagnóstico'
                : 'Diagnóstico da chamada'}
            </button>
          </div>

          {liveDiagOpen && (
            <LiveDiagnosticsPanel
              diagnostics={
                liveDiagnostics
              }
              onCopy={
                copyLiveDiagnostics
              }
              copied={
                liveDiagCopied
              }
            />
          )}

        </section>

      )}

      <div className="statusLine">
        {status}
      </div>

      {error && (

        <div className="errorBox">
          ⚠️ {error}
        </div>

      )}

      <section className="infoGrid">

        <div className="miniCard">
          <b>
            🇵🇹 Principal
          </b>
          <span>
            Português fixo
          </span>
        </div>

        <div className="miniCard">
          <b>
            🔒 Privado
          </b>
          <span>
            Link com segredo aleatório
          </span>
        </div>

        <div className="miniCard">
          <b>
            ✨ Gemini Live
          </b>
          <span>
            Tradução voz-para-voz
          </span>
        </div>

      </section>

      <footer>

        <span>
          ALOe Translate Call v1.2.0 · Gemini · develop diagnostics
        </span>

        <span>
          ES · EN · FR · DE · KO · ZH
        </span>

      </footer>

      <audio
        ref={
          originalAudioRef
        }
        autoPlay
        playsInline
      />

    </main>
  );
}
