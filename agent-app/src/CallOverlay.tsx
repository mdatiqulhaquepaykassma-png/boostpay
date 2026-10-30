import { FC, useEffect, useRef, useState, useCallback } from 'react';
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  WifiOff,
  X,
  PhoneIncoming,
  PhoneOutgoing
} from 'lucide-react';
/* ── agent-side call signaling (rides the agent SSE stream) ──────────────── */
const AGENT_TOKEN_KEY = 'bpa_token_v1';
const agentToken = () => {
  try { return localStorage.getItem(AGENT_TOKEN_KEY) || ''; } catch { return ''; }
};
type CallSignalListener = (ev: { from: string; signal: any }) => void;
const agentCallListeners = new Set<CallSignalListener>();
export function onAgentCallSignal(listener: CallSignalListener): () => void {
  agentCallListeners.add(listener);
  return () => { agentCallListeners.delete(listener); };
}
function emitAgentCallSignal(ev: { from: string; signal: any }) {
  for (const l of Array.from(agentCallListeners)) {
    try { l(ev); } catch { /* never break the stream */ }
  }
}
async function sendAgentCallSignal(targetId: string, signal: any): Promise<boolean> {
  try {
    const res = await fetch('/api/chat/call-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken()}` },
      body: JSON.stringify({ targetId, signal })
    });
    return res.ok;
  } catch { return false; }
}
async function logAgentCall(userId: string, text: string): Promise<void> {
  try {
    await fetch('/api/agent/message-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken()}` },
      body: JSON.stringify({ userId, kind: 'text', text })
    });
  } catch { /* logging must never break the UI */ }
}

// ---------------------------------------------------------------------------
// CallManager: 1:1 WebRTC voice/video calling (Telegram style).
// Signaling rides the app's authenticated SSE stream (call_signal events).
// Mount ONCE near the app root. Start calls from anywhere:
//   window.dispatchEvent(new CustomEvent('boostpay:start-call',
//     { detail: { peerId, peerName, media: 'audio' | 'video' } }))
// ---------------------------------------------------------------------------

export type CallMedia = 'audio' | 'video';
type Phase = 'idle' | 'outgoing' | 'incoming' | 'active' | 'ended';

interface PeerInfo {
  id: string;
  name: string;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
];

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Tiny WebAudio ring helpers (no assets needed)
function useRingtone() {
  const ctxRef = useRef<AudioContext | null>(null);
  const ivRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (ivRef.current) {
      clearInterval(ivRef.current);
      ivRef.current = null;
    }
    try { ctxRef.current?.close(); } catch { /* already closed */ }
    ctxRef.current = null;
  }, []);

  const beep = useCallback((freq: number, durMs: number, volume = 0.12) => {
    try {
      if (!ctxRef.current) {
        const AC = (window.AudioContext || (window as any).webkitAudioContext);
        if (!AC) return;
        ctxRef.current = new AC();
      }
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = volume;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durMs / 1000);
    } catch { /* audio unavailable */ }
  }, []);

  /** Outgoing ringback: two short beeps every 1.8s */
  const startRingback = useCallback(() => {
    stop();
    beep(440, 180);
    ivRef.current = window.setInterval(() => {
      beep(440, 180);
      setTimeout(() => beep(440, 180), 260);
    }, 1800);
  }, [beep, stop]);

  /** Incoming ringtone: alternating tones + vibration */
  const startRingtone = useCallback(() => {
    stop();
    beep(660, 300);
    try { navigator.vibrate?.([300, 150, 300]); } catch { /* unsupported */ }
    ivRef.current = window.setInterval(() => {
      beep(660, 300);
      setTimeout(() => beep(520, 300), 380);
      try { navigator.vibrate?.([300, 150, 300]); } catch { /* unsupported */ }
    }, 1600);
  }, [beep, stop]);

  useEffect(() => stop, [stop]);

  return { startRingback, startRingtone, stop, beep };
}

export const AgentCallManager: FC<{ agentId: string; onChatWake?: () => void }> = ({ agentId, onChatWake }) => {
  /* live signaling stream (also wakes the console when a user messages us) */
  const onWakeRef = useRef<() => void>(() => {});
  useEffect(() => { onWakeRef.current = onChatWake || (() => {}); }, [onChatWake]);
  useEffect(() => {
    if (!agentId) return;
    let closed = false;
    let es: EventSource | null = null;
    let retry: number | null = null;
    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource(`/api/agent/stream?token=${encodeURIComponent(agentToken())}`);
        es.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data && data.type === 'call_signal' && data.signal) {
              emitAgentCallSignal({ from: String(data.from || ''), signal: data.signal });
            } else if (data && data.type === 'agent_chat_message') {
              try { onWakeRef.current(); } catch { /* ignore */ }
              try { window.dispatchEvent(new CustomEvent('boostpay:agent-chat-wake')); } catch { /* ignore */ }
            }
          } catch { /* ignore malformed frames */ }
        };
        es.onerror = () => {
          try { es?.close(); } catch { /* ignore */ }
          es = null;
          if (!closed) retry = window.setTimeout(connect, 3000);
        };
      } catch { /* EventSource unavailable */ }
    };
    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      try { es?.close(); } catch { /* ignore */ }
    };
  }, [agentId]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [media, setMedia] = useState<CallMedia>('audio');
  const [peer, setPeer] = useState<PeerInfo>({ id: '', name: '' });
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [error, setError] = useState('');
  const [speakerOn, setSpeakerOn] = useState(true);
  const [netStatus, setNetStatus] = useState<'ok' | 'reconnecting'>('ok');
  const [videoSwitchPrompt, setVideoSwitchPrompt] = useState<{from:string, callId:string} | null>(null);
  const [waitingForVideoAccept, setWaitingForVideoAccept] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingOfferRef = useRef<{ sdp: string; media: CallMedia; callId: string; from: string } | null>(null);
  const callIdRef = useRef('');
  const iAmCallerRef = useRef(false);
  const answeredRef = useRef(false);
  const callMediaRef = useRef<CallMedia>('audio');
  const peerRef = useRef<PeerInfo>({ id: '', name: '' });
  const timeoutRef = useRef<number | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const srcNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ring = useRingtone();

  // Keep refs in sync with state for handlers created once
  useEffect(() => { peerRef.current = peer; }, [peer]);
  useEffect(() => { callMediaRef.current = media; }, [media]);

  const cleanupMedia = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    localStreamRef.current = null;
    try { pcRef.current?.close(); } catch { /* noop */ }
    pcRef.current = null;
    pendingIceRef.current = [];
    ring.stop();
    setMuted(false);
    setCameraOff(false);
    setError('');
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, [ring]);

  const logCall = useCallback(async (outcome: 'completed' | 'missed' | 'declined', durationMs: number) => {
    const p = peerRef.current;
    if (!p.id) return;
    const kindLabel = callMediaRef.current === 'video' ? 'Video call' : 'Voice call';
    const dur = outcome === 'completed' ? ` · ${fmtDuration(durationMs)}` : '';
    const label = outcome === 'missed' ? `Missed ${kindLabel.toLowerCase()}` : outcome === 'declined' ? `${kindLabel} declined` : `${kindLabel}${dur}`;
    await logAgentCall(p.id, `📞 ${label}`);
  }, []);

  const finishCall = useCallback((outcome: 'completed' | 'missed' | 'declined', sendHangup: boolean) => {
    const duration = answeredRef.current ? Date.now() - startedAt : 0;
    if (sendHangup && callIdRef.current && peerRef.current.id) {
      sendAgentCallSignal(peerRef.current.id, { kind: 'hangup', callId: callIdRef.current });
    }
    cleanupMedia();
    answeredRef.current = false;
    iAmCallerRef.current = false;
    callIdRef.current = '';
    pendingOfferRef.current = null;
    setVideoSwitchPrompt(null);
    setWaitingForVideoAccept(false);
    setPhase('idle');
    void logCall(outcome, duration);
  }, [cleanupMedia, logCall, startedAt]);

  // Timer while active
  useEffect(() => {
    if (phase !== 'active') return;
    const iv = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(iv);
  }, [phase]);

  // (Re)attach media streams whenever the video elements appear
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current && media === 'video') {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }
  }, [phase, media, cameraOff]);

  // Route remote audio to earpiece or loudspeaker.
  // setSinkId works on Chrome/Edge/Firefox + newer iOS; older iOS cannot switch
  // (WebKit forces the loudspeaker while the mic is live) — we surface that.
  const applyAudioRoute = useCallback(async (wantSpeaker: boolean): Promise<boolean> => {
    const el = remoteAudioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el) return false;
    try {
      const devs = (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)
        ? await navigator.mediaDevices.enumerateDevices()
        : [];
      const outs = devs.filter((d) => d.kind === 'audiooutput');
      const earpiece = outs.find((d) => /earpiece|receiver/i.test(d.label));
      const loudspeaker = outs.find((d) => /speaker|loudspeaker/i.test(d.label) && !/earpiece|receiver/i.test(d.label));
      if (typeof el.setSinkId === 'function') {
        if (wantSpeaker) {
          await el.setSinkId(loudspeaker?.deviceId || '');
        } else if (earpiece) {
          await el.setSinkId(earpiece.deviceId);
        } else {
          return false; // no earpiece exposed on this device
        }
        setSpeakerOn(wantSpeaker);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const toggleSpeaker = useCallback(async () => {
    const want = !speakerOn;
    const ok = await applyAudioRoute(want);
    if (!ok) {
      setError(want ? 'Cannot switch to loudspeaker on this device.' : 'Earpiece mode is not available on this device — use volume keys or a headset.');
      window.setTimeout(() => setError(''), 3200);
    }
  }, [speakerOn, applyAudioRoute]);

  const setupPeerConnection = useCallback((stream: MediaStream) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = (e) => {
      if (e.candidate && peerRef.current.id && callIdRef.current) {
        void sendAgentCallSignal(peerRef.current.id, {
          kind: 'ice',
          callId: callIdRef.current,
          candidate: e.candidate.toJSON()
        });
      }
    };
    pc.ontrack = (e) => {
      const remoteStream = e.streams[0];
      remoteStreamRef.current = remoteStream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    };
    // Slow/broken internet: surface "Reconnecting" and auto-restart ICE
    const onNet = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        setNetStatus('ok');
      } else if (s === 'disconnected' || s === 'failed' || s === 'checking') {
        setNetStatus('reconnecting');
        if (s === 'failed' || s === 'disconnected') {
          try { pc.restartIce(); } catch { /* older browser */ }
          // Full renegotiation as a fallback (caller side only)
          if (iAmCallerRef.current && pc.signalingState === 'stable') {
            pc.createOffer({ iceRestart: true }).then((o) =>
              pc.setLocalDescription(o).then(() =>
                sendAgentCallSignal(peerRef.current.id, {
                  kind: 'offer',
                  callId: callIdRef.current,
                  media: callMediaRef.current,
                  sdp: o.sdp
                })
              )
            ).catch(() => { /* renegotiation will retry on next drop */ });
          }
        }
      }
    };
    pc.oniceconnectionstatechange = onNet;
    pc.onconnectionstatechange = onNet;
    return pc;
  }, []);

  const getLocalStream = useCallback(async (wantVideo: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantVideo ? { facingMode: 'user', width: { ideal: 640 } } : false
    });
    localStreamRef.current = stream;
    if (localVideoRef.current && wantVideo) localVideoRef.current.srcObject = stream;
    return stream;
  }, []);

  // ------------------------- OUTGOING CALL -------------------------
  const startCall = useCallback(async (peerId: string, peerName: string, wantMedia: CallMedia) => {
    if (phase !== 'idle') return;
    setPeer({ id: peerId, name: peerName });
    setMedia(wantMedia);
    setSpeakerOn(wantMedia === 'video'); // audio calls default to earpiece, video to loudspeaker
    setNetStatus('ok');
    setPhase('outgoing');
    setError('');
    iAmCallerRef.current = true;
    answeredRef.current = false;
    callIdRef.current = 'CALL-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    try {
      const stream = await getLocalStream(wantMedia === 'video');
      const pc = setupPeerConnection(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendAgentCallSignal(peerId, {
        kind: 'offer',
        callId: callIdRef.current,
        media: wantMedia,
        sdp: offer.sdp
      });
      ring.startRingback();
      // No answer within 45s -> missed
      timeoutRef.current = window.setTimeout(() => {
        if (!answeredRef.current) {
          sendAgentCallSignal(peerId, { kind: 'cancel', callId: callIdRef.current });
          finishCall('missed', false);
        }
      }, 45000);
    } catch (e: any) {
      cleanupMedia();
      setPhase('idle');
      setError(e?.name === 'NotAllowedError'
        ? 'Camera/microphone permission denied. Allow access to place calls.'
        : 'Could not start the call. Please try again.');
    }
  }, [phase, getLocalStream, setupPeerConnection, ring, finishCall, cleanupMedia]);

  // ------------------------- INCOMING / ACCEPT -------------------------
  const acceptCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    if (!offer) return;
    try {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      ring.stop();
      const wantVideo = offer.media === 'video';
      setMedia(offer.media);
      const stream = await getLocalStream(wantVideo);
      const pc = setupPeerConnection(stream);
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      for (const c of pendingIceRef.current) {
        try { await pc.addIceCandidate(c); } catch { /* stale candidate */ }
      }
      pendingIceRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendAgentCallSignal(offer.from, {
        kind: 'answer',
        callId: offer.callId,
        sdp: answer.sdp
      });
      answeredRef.current = true;
      setStartedAt(Date.now());
      setPhase('active');
      setNetStatus('ok');
      setSpeakerOn(offer.media === 'video');
      void applyAudioRoute(offer.media === 'video');
    } catch (e: any) {
      cleanupMedia();
      setPhase('idle');
      pendingOfferRef.current = null;
      setError(e?.name === 'NotAllowedError'
        ? 'Camera/microphone permission denied. Allow access to answer calls.'
        : 'Could not answer the call.');
    }
  }, [getLocalStream, setupPeerConnection, ring, cleanupMedia, applyAudioRoute]);

  const rejectCall = useCallback(() => {
    const offer = pendingOfferRef.current;
    if (offer) {
      void sendAgentCallSignal(offer.from, { kind: 'reject', callId: offer.callId });
    }
    ring.stop();
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    pendingOfferRef.current = null;
    setPhase('idle');
    // The caller logs the declined/missed row
  }, [ring]);

  const performVideoUpgrade = useCallback(async () => {
    if (phase !== 'active' || media === 'video') return;
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', width: { ideal: 640 } } });
      const pc = pcRef.current;
      if (!pc) { try { stream.getTracks().forEach(t=>t.stop()); } catch {}; return; }
      try { localStreamRef.current?.getTracks().forEach(t=>t.stop()); } catch {}
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      for (const track of stream.getTracks()) {
        const sender = pc.getSenders().find(s=> s.track && s.track.kind===track.kind);
        if (sender) { try { await sender.replaceTrack(track); } catch { pc.addTrack(track, stream); } }
        else pc.addTrack(track, stream);
      }
      setMedia('video');
      setCameraOff(false);
      setSpeakerOn(true);
      void applyAudioRoute(true);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendAgentCallSignal(peerRef.current.id, { kind: 'offer', callId: callIdRef.current, media: 'video', sdp: offer.sdp });
    } catch (e:any) {
      setError(e?.name==='NotAllowedError' ? 'Camera permission denied.' : 'Could not switch to video.');
      setTimeout(()=>setError(''),3000);
    }
  }, [phase, media, applyAudioRoute]);
  const requestVideoSwitch = useCallback(async () => {
    if (phase !== 'active' || media === 'video') return;
    setWaitingForVideoAccept(true);
    try { await sendAgentCallSignal(peerRef.current.id, { kind: 'video-request', callId: callIdRef.current }); } catch {}
    setTimeout(()=> setWaitingForVideoAccept(false), 30000);
  }, [phase, media]);

  // ------------------------- SIGNAL HANDLING -------------------------
  // ------------------- INCOMING CALL WHILE THE APP WAS CLOSED ---------------
  // The push notification opens /?call=<id>; the offer was kept server-side
  // because SSE events never reach a closed app.
  const pickUpPendingCall = useCallback(async () => {
    if (phase !== 'idle') return;
    try {
      const res = await fetch('/api/chat/call-pending', { headers: { Authorization: `Bearer ${agentToken()}` } });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const call = data && data.call;
      if (!call || !call.sdp || !call.callId) return;
      if (Date.now() - Number(call.at || 0) > 90000) return;
      pendingOfferRef.current = {
        sdp: String(call.sdp),
        media: call.media === 'video' ? 'video' : 'audio',
        callId: String(call.callId),
        from: String(call.from || '')
      };
      callIdRef.current = String(call.callId);
      iAmCallerRef.current = false;
      answeredRef.current = false;
      setPeer({ id: String(call.from || ''), name: `User #${call.from}` });
      setMedia(call.media === 'video' ? 'video' : 'audio');
      setPhase('incoming');
      setError('');
      ring.startRingtone();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        pendingOfferRef.current = null;
        ring.stop();
        setPhase('idle');
      }, 45000);
    } catch { /* non-fatal */ }
  }, [phase, ring]);

  useEffect(() => {
    if (new URL(window.location.href).searchParams.get('call')) void pickUpPendingCall();
    const onVisible = () => { if (document.visibilityState === 'visible') void pickUpPendingCall(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pickUpPendingCall]);

  useEffect(() => {
    const unsub = onAgentCallSignal(({ from, signal }) => {
      const kind = String(signal?.kind || '');
      const callId = String(signal?.callId || '');

      // Video switch handshake (audio -> video requires explicit accept)
      if (kind === 'video-request') {
        if (phase === 'active' && callId && callId === callIdRef.current && callMediaRef.current !== 'video') {
          setVideoSwitchPrompt({ from: String(from), callId });
        }
        return;
      }
      if (kind === 'video-accept') {
        if (phase === 'active' && callId && callId === callIdRef.current) {
          setWaitingForVideoAccept(false);
          void performVideoUpgrade();
        }
        return;
      }
      if (kind === 'video-decline' || kind === 'video-cancel') {
        if (phase === 'active' && callId && callId === callIdRef.current) {
          setWaitingForVideoAccept(false);
          setError(kind === 'video-decline' ? 'Peer declined video switch' : 'Video request cancelled');
          setTimeout(()=> setError(''), 3000);
        }
        return;
      }

      if (kind === 'offer') {
        // ICE-restart or media-switch re-offer on same active call -> renegotiate, handle video upgrade
        if (phase === 'active' && callId && callId === callIdRef.current) {
          void (async () => {
            try {
              const pc = pcRef.current;
              if (!pc || !signal.sdp) return;
              const wantVideo = signal.media === 'video';
              if (wantVideo && callMediaRef.current !== 'video') {
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:{ facingMode:'user', width:{ideal:640}} });
                  try { localStreamRef.current?.getTracks().forEach(t=>t.stop()); } catch {}
                  localStreamRef.current = stream;
                  if (localVideoRef.current) localVideoRef.current.srcObject = stream;
                  for (const track of stream.getTracks()) {
                    const sender = pc.getSenders().find(s=> s.track && s.track.kind===track.kind);
                    if (sender) { try { await sender.replaceTrack(track); } catch { pc.addTrack(track, stream); } }
                    else pc.addTrack(track, stream);
                  }
                  setMedia('video');
                  setSpeakerOn(true);
                  void applyAudioRoute(true);
                } catch {}
              } else if (!wantVideo && callMediaRef.current === 'video') {
                setMedia('audio');
                setSpeakerOn(false);
                void applyAudioRoute(false);
              }
              await pc.setRemoteDescription({ type: 'offer', sdp: String(signal.sdp) });
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await sendAgentCallSignal(from, {
                kind: 'answer',
                callId,
                media: callMediaRef.current,
                sdp: answer.sdp || ''
              });
              setNetStatus('ok');
            } catch { /* ignore malformed renegotiation */ }
          })();
          return;
        }
        // Busy? reject politely
        if (phase !== 'idle') {
          void sendAgentCallSignal(from, { kind: 'reject', callId });
          return;
        }
        pendingOfferRef.current = {
          sdp: String(signal.sdp || ''),
          media: signal.media === 'video' ? 'video' : 'audio',
          callId,
          from
        };
        callIdRef.current = callId;
        const name = /^AGT-/i.test(String(from)) ? `Agent ${from}` : String(from) === 'ADMIN' ? 'BoostPay Support' : `User #${from}`;
        setPeer({ id: String(from), name });
        setMedia(signal.media === 'video' ? 'video' : 'audio');
        setPhase('incoming');
        setError('');
        ring.startRingtone();
        timeoutRef.current = window.setTimeout(() => {
          // Missed (nobody answered)
          pendingOfferRef.current = null;
          ring.stop();
          setVideoSwitchPrompt(null);
          setWaitingForVideoAccept(false);
          setPhase('idle');
        }, 45000);
        return;
      }

      if (callId && callIdRef.current && callId !== callIdRef.current) return; // stale

      if (kind === 'answer') {
        void (async () => {
          try {
            if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
            ring.stop();
            const pc = pcRef.current;
            if (pc && signal.sdp) {
              await pc.setRemoteDescription({ type: 'answer', sdp: String(signal.sdp) });
              for (const c of pendingIceRef.current) {
                try { await pc.addIceCandidate(c); } catch { /* stale */ }
              }
              pendingIceRef.current = [];
            }
            answeredRef.current = true;
            setStartedAt(Date.now());
            setPhase('active');
            setNetStatus('ok');
            void applyAudioRoute(callMediaRef.current === 'video');
          } catch { /* malformed answer */ }
        })();
        return;
      }

      if (kind === 'ice') {
        const cand = signal.candidate;
        if (!cand) return;
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) {
          pc.addIceCandidate(cand as RTCIceCandidateInit).catch(() => {});
        } else {
          pendingIceRef.current.push(cand as RTCIceCandidateInit);
        }
        return;
      }

      if (kind === 'reject') {
        if (iAmCallerRef.current && phase !== 'idle') {
          finishCall('declined', false);
        }
        return;
      }

      if (kind === 'cancel') {
        // Caller gave up while our phone was ringing
        if (phase === 'incoming') {
          ring.stop();
          pendingOfferRef.current = null;
          setVideoSwitchPrompt(null);
          setWaitingForVideoAccept(false);
          setPhase('idle');
        }
        return;
      }

      if (kind === 'hangup') {
        if (phase !== 'idle') {
          finishCall('completed', false);
        }
        return;
      }
    });
    return unsub;
  }, [phase, ring, finishCall, applyAudioRoute, performVideoUpgrade]);

  // Start-call request from anywhere in the app
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.peerId) void startCall(String(d.peerId), String(d.peerName || `User #${d.peerId}`), d.media === 'video' ? 'video' : 'audio');
    };
    window.addEventListener('boostpay:start-call', handler);
    return () => window.removeEventListener('boostpay:start-call', handler);
  }, [startCall]);

  // Mute / camera toggles
  const toggleMute = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    const audio = s.getAudioTracks()[0];
    if (audio) {
      audio.enabled = !audio.enabled;
      setMuted(!audio.enabled);
    }
  }, []);

  const toggleCamera = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    const video = s.getVideoTracks()[0];
    if (video) {
      video.enabled = !video.enabled;
      setCameraOff(!video.enabled);
    }
  }, []);
  const switchToAudio = useCallback(async () => {
    if (phase !== 'active' || media !== 'video') return;
    try {
      const pc = pcRef.current;
      if (pc) {
        const videoSenders = pc.getSenders().filter(s=> s.track && s.track.kind==='video');
        for (const s of videoSenders) { try { pc.removeTrack(s); } catch {} }
      }
      try { localStreamRef.current?.getVideoTracks().forEach(t=>t.stop()); } catch {}
      // keep audio track alive - if removed we need new audio stream
      let audioStream = localStreamRef.current;
      if (!audioStream || !audioStream.getAudioTracks().length) {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
        localStreamRef.current = audioStream;
        if (pc) for (const track of audioStream.getTracks()) pc.addTrack(track, audioStream);
      }
      setMedia('audio');
      setCameraOff(false);
      setSpeakerOn(false);
      void applyAudioRoute(false);
      if (pc) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendAgentCallSignal(peerRef.current.id, { kind: 'offer', callId: callIdRef.current, media: 'audio', sdp: offer.sdp });
      }
    } catch {}
  }, [phase, media, applyAudioRoute]);

  const hangup = useCallback(() => {
    finishCall('completed', true);
  }, [finishCall]);

  if (phase === 'idle') return null;

  const statusText =
    phase === 'outgoing' ? 'Calling…' :
    phase === 'incoming' ? 'Incoming call…' :
    phase === 'active' ? fmtDuration(nowTick - startedAt) : '';

  const isVideo = media === 'video';

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-between bg-zinc-950/98 backdrop-blur-xl">
      <audio ref={remoteAudioRef} autoPlay playsInline />
      {netStatus === 'reconnecting' && phase === 'active' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[210] flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-4 py-2 backdrop-blur-md">
          <WifiOff className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          <span className="text-xs font-bold text-amber-300">Reconnecting…</span>
        </div>
      )}
      {isVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 h-full w-full object-cover ${phase === 'active' ? '' : 'hidden'}`}
        />
      )}

      {/* Header / status */}
      <div className="relative z-10 flex flex-col items-center pt-16 sm:pt-20 px-6">
        <div className="mb-4 h-24 w-24 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-3xl font-black shadow-2xl shadow-amber-500/20">
          {peer.name.slice(0, 1).toUpperCase()}
        </div>
        <h2 className="text-xl font-bold text-white text-center px-4">{peer.name}</h2>
        <div className="mt-1.5 flex items-center gap-2 text-sm text-zinc-400">
          {phase === 'outgoing' && <PhoneOutgoing className="w-4 h-4 text-amber-400 animate-pulse" />}
          {phase === 'incoming' && <PhoneIncoming className="w-4 h-4 text-emerald-400 animate-pulse" />}
          {phase === 'active' && <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}
          <span className="font-mono">{statusText}</span>
          {isVideo && <span className="text-[10px] rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-400">VIDEO</span>}
        </div>
        {error && <p className="mt-3 max-w-xs text-center text-xs text-red-400">{error}</p>}
        {waitingForVideoAccept && (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-xs font-semibold text-amber-300">Waiting for peer to accept video…</p>
            <button onClick={()=> { setWaitingForVideoAccept(false); void sendAgentCallSignal(peerRef.current.id, { kind: 'video-cancel', callId: callIdRef.current }); }} className="rounded-xl bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer">Cancel</button>
          </div>
        )}
        {videoSwitchPrompt && (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-5 py-4">
            <p className="text-xs font-bold text-sky-300 text-center">Peer wants to switch to video — accept?</p>
            <div className="flex gap-3">
              <button onClick={()=> { const p=videoSwitchPrompt; setVideoSwitchPrompt(null); if(p) void sendAgentCallSignal(p.from, { kind: 'video-decline', callId: p.callId }); }} className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-700 cursor-pointer">Decline</button>
              <button onClick={()=> { const p=videoSwitchPrompt; setVideoSwitchPrompt(null); if(p) void sendAgentCallSignal(p.from, { kind: 'video-accept', callId: p.callId }); }} className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-400 cursor-pointer">Accept</button>
            </div>
          </div>
        )}
      </div>

      {/* Local video preview (PiP) */}
      {isVideo && phase === 'active' && (
        <div className="absolute right-4 top-16 z-10 overflow-hidden rounded-2xl border border-zinc-800 shadow-2xl">
          <video ref={localVideoRef} autoPlay playsInline muted className={`h-36 w-24 object-cover ${cameraOff ? 'hidden' : ''}`} />
          {cameraOff && (
            <div className="flex h-36 w-24 items-center justify-center bg-zinc-900">
              <VideoOff className="w-5 h-5 text-zinc-500" />
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="relative z-10 w-full max-w-sm px-8 pb-16">
        {phase === 'incoming' ? (
          <div className="flex items-center justify-center gap-8">
            <button
              onClick={rejectCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-2xl shadow-red-500/30 hover:bg-red-400 active:scale-95 transition cursor-pointer"
              title="Decline"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
            <button
              onClick={acceptCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-2xl shadow-emerald-500/30 hover:bg-emerald-400 active:scale-95 transition cursor-pointer animate-pulse"
              title="Accept"
            >
              <Phone className="w-7 h-7" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-5">
            <button
              onClick={toggleMute}
              className={`flex h-12 w-12 items-center justify-center rounded-full border transition cursor-pointer ${muted ? 'border-red-500/50 bg-red-500/20 text-red-300' : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'}`}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            {isVideo ? (
              <>
                <button
                  onClick={toggleCamera}
                  className={`flex h-12 w-12 items-center justify-center rounded-full border transition cursor-pointer ${cameraOff ? 'border-red-500/50 bg-red-500/20 text-red-300' : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'}`}
                  title={cameraOff ? 'Camera on' : 'Camera off'}
                >
                  {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
                <button onClick={switchToAudio} className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 transition cursor-pointer" title="Switch to voice">
                  <Phone className="w-5 h-5" />
                </button>
              </>
            ) : (
              <button onClick={requestVideoSwitch} disabled={waitingForVideoAccept} className={`flex h-12 w-12 items-center justify-center rounded-full border transition cursor-pointer ${waitingForVideoAccept ? 'border-zinc-700 bg-zinc-900 text-zinc-500' : 'border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'}`} title={waitingForVideoAccept ? 'Waiting for accept…' : 'Switch to video'}>
                <Video className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={toggleSpeaker}
              className={`flex h-12 w-12 items-center justify-center rounded-full border transition cursor-pointer ${speakerOn ? 'border-amber-500/50 bg-amber-500/20 text-amber-300' : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'}`}
              title={speakerOn ? 'Loudspeaker on — switch to earpiece' : 'Earpiece — switch to loudspeaker'}
            >
              {speakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <button
              onClick={() => finishCall(phase === 'outgoing' ? 'missed' : 'completed', true)}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-2xl shadow-red-500/30 hover:bg-red-400 active:scale-95 transition cursor-pointer"
              title="Hang up"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/** Convenience for UI code: start an outgoing call. */
export function startCallTo(peerId: string, peerName: string, media: CallMedia = 'audio') {
  window.dispatchEvent(new CustomEvent('boostpay:start-call', { detail: { peerId, peerName, media } }));
}
