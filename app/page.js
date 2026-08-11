'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const LANGUAGES = [
  { code: 'es', name: 'Espanhol', native: 'Español', flag: '🇪🇸' },
  { code: 'en', name: 'Inglês', native: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Francês', native: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Alemão', native: 'Deutsch', flag: '🇩🇪' },
  { code: 'ko', name: 'Coreano', native: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: 'Mandarim / Chinês', native: '中文（普通话）', flag: '🇨🇳' },
];

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

function randomRoom() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

function randomSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function waitForIceGathering(pc, timeout = 8000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && finish();
    const timer = setTimeout(finish, timeout);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimTranscript(text) {
  if (text.length <= 1400) return text;
  return `…${text.slice(-1399)}`;
}

export default function Home() {
  const [language, setLanguage] = useState('es');
  const [role, setRole] = useState('host');
  const [room, setRoom] = useState('');
  const [secret, setSecret] = useState('');
  const [invite, setInvite] = useState('');
  const [status, setStatus] = useState('Pronto para iniciar');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hearOriginal, setHearOriginal] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [error, setError] = useState('');

  const localStreamRef = useRef(null);
  const callPcRef = useRef(null);
  const translationPcRef = useRef(null);
  const translationDcRef = useRef(null);
  const originalAudioRef = useRef(null);
  const translatedAudioRef = useRef(null);
  const pollAbortRef = useRef(false);
  const startedAtRef = useRef(null);

  const selected = useMemo(() => LANGUAGES.find((l) => l.code === language) || LANGUAGES[0], [language]);
  const isGuest = role === 'guest';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const join = params.get('join');
    const k = params.get('k');
    const lang = params.get('lang');
    if (join && k && LANGUAGES.some((l) => l.code === lang)) {
      setRole('guest');
      setRoom(join);
      setSecret(k);
      setLanguage(lang);
      setStatus('Convite recebido — pronto para entrar');
    }

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const handler = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!connected) {
      setElapsed(0);
      return;
    }
    startedAtRef.current = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  useEffect(() => {
    if (originalAudioRef.current) originalAudioRef.current.muted = !hearOriginal;
  }, [hearOriginal]);

  async function ensureMic() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localStreamRef.current = stream;
    return stream;
  }

  function makeCallPeer(stream) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    callPcRef.current = pc;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      if (originalAudioRef.current) {
        originalAudioRef.current.srcObject = remoteStream;
        originalAudioRef.current.muted = !hearOriginal;
        originalAudioRef.current.play().catch(() => {});
      }
      startTranslation(event.track).catch((e) => {
        setError(`A chamada ligou, mas a tradução não iniciou: ${e.message}`);
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setConnected(true);
        setBusy(false);
        setStatus('Chamada ligada — tradução em tempo real');
      } else if (pc.connectionState === 'failed') {
        setError('Não foi possível estabelecer a ligação direta. Tente outra rede Wi‑Fi/4G/5G.');
        setStatus('Ligação falhou');
      } else if (pc.connectionState === 'disconnected') {
        setStatus('Ligação interrompida — a tentar recuperar…');
      } else if (pc.connectionState === 'closed') {
        setConnected(false);
      }
    };
    return pc;
  }

  async function postSignal(kind, sdp, callRoom = room, callSecret = secret) {
    const response = await fetch('/api/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: callRoom, secret: callSecret, kind, sdp }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro de sinalização.');
  }

  async function getSignal(kind, callRoom = room, callSecret = secret) {
    const query = new URLSearchParams({ room: callRoom, secret: callSecret, kind });
    const response = await fetch(`/api/signal?${query}`, { cache: 'no-store' });
    if (response.status === 404) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro de sinalização.');
    return data;
  }

  async function pollFor(kind, callRoom, callSecret, seconds = 600) {
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until && !pollAbortRef.current) {
      const data = await getSignal(kind, callRoom, callSecret);
      if (data?.sdp) return data.sdp;
      await sleep(1200);
    }
    throw new Error('Tempo de espera esgotado. Crie uma nova chamada.');
  }

  async function createCall() {
    setError('');
    setBusy(true);
    pollAbortRef.current = false;
    try {
      const newRoom = randomRoom();
      const newSecret = randomSecret();
      setRoom(newRoom);
      setSecret(newSecret);
      const stream = await ensureMic();
      const pc = makeCallPeer(stream);
      setStatus('A preparar a chamada…');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      await postSignal('offer', pc.localDescription.sdp, newRoom, newSecret);

      const link = `${window.location.origin}/?join=${encodeURIComponent(newRoom)}&k=${encodeURIComponent(newSecret)}&lang=${encodeURIComponent(language)}`;
      setInvite(link);
      setStatus('Convite criado — a aguardar o interlocutor');

      const answerSdp = await pollFor('answer', newRoom, newSecret);
      if (!pc.currentRemoteDescription) await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      setTimeout(() => {
        fetch(`/api/signal?${new URLSearchParams({ room: newRoom, secret: newSecret })}`, { method: 'DELETE' }).catch(() => {});
      }, 5000);
    } catch (e) {
      setBusy(false);
      setStatus('Não foi possível iniciar');
      setError(e.message);
    }
  }

  async function joinCall() {
    setError('');
    setBusy(true);
    pollAbortRef.current = false;
    try {
      const stream = await ensureMic();
      const pc = makeCallPeer(stream);
      setStatus('A ligar à chamada…');
      const offerSdp = await pollFor('offer', room, secret, 120);
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);
      await postSignal('answer', pc.localDescription.sdp, room, secret);
      setStatus('Resposta enviada — a estabelecer ligação…');
    } catch (e) {
      setBusy(false);
      setStatus('Não foi possível entrar');
      setError(e.message);
    }
  }

  async function startTranslation(remoteTrack) {
    if (translationPcRef.current) return;
    const targetLanguage = isGuest ? language : 'pt';
    setStatus('Chamada ligada — a iniciar tradução…');

    const sessionResponse = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage, room, role }),
    });
    const session = await sessionResponse.json();
    if (!sessionResponse.ok) throw new Error(session.error || 'Falha ao obter sessão OpenAI.');
    const clientSecret = session.value;
    if (!clientSecret) throw new Error('A OpenAI não devolveu o client secret.');

    const pc = new RTCPeerConnection();
    translationPcRef.current = pc;
    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (translatedAudioRef.current) {
        translatedAudioRef.current.srcObject = stream;
        translatedAudioRef.current.muted = false;
        translatedAudioRef.current.play().catch(() => {});
      }
    };

    const dc = pc.createDataChannel('oai-events');
    translationDcRef.current = dc;
    dc.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === 'session.input_transcript.delta' && event.delta) {
          setSourceText((old) => trimTranscript(old + event.delta));
        }
        if (event.type === 'session.output_transcript.delta' && event.delta) {
          setTranslatedText((old) => trimTranscript(old + event.delta));
        }
      } catch {}
    };

    const clonedTrack = remoteTrack.clone();
    const clonedStream = new MediaStream([clonedTrack]);
    pc.addTrack(clonedTrack, clonedStream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpResponse = await fetch('https://api.openai.com/v1/realtime/translations/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
    });
    if (!sdpResponse.ok) {
      const text = await sdpResponse.text();
      throw new Error(`OpenAI Realtime: ${text.slice(0, 200) || sdpResponse.status}`);
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
    setStatus('Chamada ligada — tradução em tempo real');
  }

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  async function copyInvite() {
    if (!invite) return;
    await navigator.clipboard.writeText(invite);
    setStatus('Link copiado — envie ao interlocutor');
  }

  function shareWhatsApp() {
    if (!invite) return;
    const text = `Entre na minha chamada ALOe Translate Call: ${invite}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    setInstallPrompt(null);
  }

  function hangup() {
    pollAbortRef.current = true;
    try {
      if (translationDcRef.current?.readyState === 'open') {
        translationDcRef.current.send(JSON.stringify({ type: 'session.close' }));
      }
    } catch {}
    translationDcRef.current = null;
    translationPcRef.current?.close();
    translationPcRef.current = null;
    callPcRef.current?.close();
    callPcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (originalAudioRef.current) originalAudioRef.current.srcObject = null;
    if (translatedAudioRef.current) translatedAudioRef.current.srcObject = null;
    setConnected(false);
    setBusy(false);
    setSourceText('');
    setTranslatedText('');
    setStatus('Chamada terminada');
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brandMark">A</div>
        <div>
          <div className="brand">ALOe Translate Call</div>
          <div className="tagline">Português sempre como língua principal</div>
        </div>
        {installPrompt && <button className="ghost small" onClick={installApp}>Instalar</button>}
      </header>

      <section className="hero card">
        <div className="ptPill">🇵🇹 PORTUGUÊS (PORTUGAL)</div>
        <h1>Fale em português.<br /><span>O outro lado ouve na língua dele.</span></h1>
        <p>Chamada interna WebRTC com tradução de voz e legendas em tempo real.</p>
      </section>

      {!connected && (
        <section className="card setup">
          <div className="sectionTitle">{isGuest ? 'Entrar na chamada' : 'Escolha a língua do interlocutor'}</div>

          <div className="languageGrid">
            {LANGUAGES.map((item) => (
              <button
                key={item.code}
                className={`language ${language === item.code ? 'active' : ''}`}
                disabled={isGuest || busy}
                onClick={() => setLanguage(item.code)}
              >
                <span className="flag">{item.flag}</span>
                <span><strong>{item.name}</strong><small>{item.native}</small></span>
              </button>
            ))}
          </div>

          <div className="pairing">
            <div className="langBig">🇵🇹 <b>Português</b></div>
            <div className="arrow">⇄</div>
            <div className="langBig">{selected.flag} <b>{selected.name}</b></div>
          </div>

          {isGuest ? (
            <button className="primary jumbo" disabled={busy} onClick={joinCall}>
              {busy ? 'A ligar…' : `📞 Entrar — ${room}`}
            </button>
          ) : (
            <button className="primary jumbo" disabled={busy} onClick={createCall}>
              {busy && !invite ? 'A preparar…' : '＋ Nova chamada'}
            </button>
          )}

          {!isGuest && invite && (
            <div className="inviteBox">
              <div>
                <small>Código da chamada</small>
                <strong className="roomCode">{room}</strong>
              </div>
              <div className="inviteActions">
                <button className="secondary" onClick={copyInvite}>🔗 Copiar link</button>
                <button className="secondary" onClick={shareWhatsApp}>WhatsApp</button>
              </div>
              <p>Envie o link apenas à pessoa com quem pretende falar.</p>
            </div>
          )}
        </section>
      )}

      {(connected || busy) && (
        <section className="card callCard">
          <div className="callTop">
            <div className="avatar">{selected.flag}</div>
            <div>
              <h2>{isGuest ? 'Interlocutor português' : `Interlocutor — ${selected.name}`}</h2>
              <div className="status"><span className={`dot ${connected ? 'on' : ''}`}></span>{status}</div>
            </div>
            <div className="timer">{mm}:{ss}</div>
          </div>

          <div className="translateBadge">✨ Tradução automática ativa</div>

          <div className="captions">
            <div className="caption original">
              <small>VOZ RECEBIDA — ORIGINAL</small>
              <p>{sourceText || 'A aguardar fala…'}</p>
            </div>
            <div className="caption translated">
              <small>TRADUÇÃO — {isGuest ? selected.name.toUpperCase() : 'PORTUGUÊS'}</small>
              <p>{translatedText || 'A tradução aparecerá aqui…'}</p>
            </div>
          </div>

          <div className="controls">
            <button className={muted ? 'control dangerSoft' : 'control'} onClick={toggleMute}>{muted ? '🔇' : '🎤'}<span>{muted ? 'Ativar' : 'Microfone'}</span></button>
            <button className={hearOriginal ? 'control activeControl' : 'control'} onClick={() => setHearOriginal((v) => !v)}>🔊<span>Voz original</span></button>
            <button className="hang" onClick={hangup}>☎<span>Desligar</span></button>
          </div>
        </section>
      )}

      <div className="statusLine">{status}</div>
      {error && <div className="errorBox">⚠️ {error}</div>}

      <section className="infoGrid">
        <div className="miniCard"><b>🇵🇹 Principal</b><span>Português fixo</span></div>
        <div className="miniCard"><b>🔒 Privado</b><span>Link com segredo aleatório</span></div>
        <div className="miniCard"><b>⚡ Direto</b><span>Áudio WebRTC entre os dois</span></div>
      </section>

      <footer>
        <span>ALOe Translate Call v1.0</span>
        <span>ES · EN · FR · DE · KO · ZH</span>
      </footer>

      <audio ref={originalAudioRef} autoPlay playsInline />
      <audio ref={translatedAudioRef} autoPlay playsInline />
    </main>
  );
}
