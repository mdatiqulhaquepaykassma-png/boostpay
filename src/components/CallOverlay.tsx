import { FC, useEffect, useRef, useState, useCallback } from 'react';
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  X,
  PhoneIncoming,
  PhoneOutgoing
} from 'lucide-react';
import { BoostPayStore } from '../services/store';

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

export const CallManager: FC<{ currentUser: { id: string } }> = ({ currentUser }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [media, setMedia] = useState<CallMedia>('audio');
  const [peer, setPeer] = useState<PeerInfo>({ id: '', name: '' });
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [error, setError] = useState('');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
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
    try {
      await BoostPayStore.sendChatMessage(p.id, `📞 ${label}`, undefined, {
        media: callMediaRef.current,
        outcome,
        durationMs: durationMs
      });
    } catch { /* logging must never break the UI */ }
  }, []);

  const finishCall = useCallback((outcome: 'completed' | 'missed' | 'declined', sendHangup: boolean) => {
    const duration = answeredRef.current ? Date.now() - startedAt : 0;
    if (sendHangup && callIdRef.current && peerRef.current.id) {
      BoostPayStore.sendCallSignal(peerRef.current.id, { kind: 'hangup', callId: callIdRef.current });
    }
    cleanupMedia();
    answeredRef.current = false;
    iAmCallerRef.current = false;
    callIdRef.current = '';
    pendingOfferRef.current = null;
    setPhase('idle');
    void logCall(outcome, duration);
  }, [cleanupMedia, logCall, startedAt]);

  // Timer while active
  useEffect(() => {
    if (phase !== 'active') return;
    const iv = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(iv);
  }, [phase]);

  const setupPeerConnection = useCallback((stream: MediaStream) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = (e) => {
      if (e.candidate && peerRef.current.id && callIdRef.current) {
        void BoostPayStore.sendCallSignal(peerRef.current.id, {
          kind: 'ice',
          callId: callIdRef.current,
          candidate: e.candidate.toJSON()
        });
      }
    };
    pc.ontrack = (e) => {
      const remoteStream = e.streams[0];
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    };
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
      await BoostPayStore.sendCallSignal(peerId, {
        kind: 'offer',
        callId: callIdRef.current,
        media: wantMedia,
        sdp: offer.sdp
      });
      ring.startRingback();
      // No answer within 45s -> missed
      timeoutRef.current = window.setTimeout(() => {
        if (!answeredRef.current) {
          BoostPayStore.sendCallSignal(peerId, { kind: 'cancel', callId: callIdRef.current });
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
      await BoostPayStore.sendCallSignal(offer.from, {
        kind: 'answer',
        callId: offer.callId,
        sdp: answer.sdp
      });
      answeredRef.current = true;
      setStartedAt(Date.now());
      setPhase('active');
    } catch (e: any) {
      cleanupMedia();
      setPhase('idle');
      pendingOfferRef.current = null;
      setError(e?.name === 'NotAllowedError'
        ? 'Camera/microphone permission denied. Allow access to answer calls.'
        : 'Could not answer the call.');
    }
  }, [getLocalStream, setupPeerConnection, ring, cleanupMedia]);

  const rejectCall = useCallback(() => {
    const offer = pendingOfferRef.current;
    if (offer) {
      void BoostPayStore.sendCallSignal(offer.from, { kind: 'reject', callId: offer.callId });
    }
    ring.stop();
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    pendingOfferRef.current = null;
    setPhase('idle');
    // The caller logs the declined/missed row
  }, [ring]);

  // ------------------------- SIGNAL HANDLING -------------------------
  useEffect(() => {
    const unsub = BoostPayStore.onCallSignal(({ from, signal }) => {
      const kind = String(signal?.kind || '');
      const callId = String(signal?.callId || '');

      if (kind === 'offer') {
        // Busy? reject politely
        if (phase !== 'idle') {
          void BoostPayStore.sendCallSignal(from, { kind: 'reject', callId });
          return;
        }
        pendingOfferRef.current = {
          sdp: String(signal.sdp || ''),
          media: signal.media === 'video' ? 'video' : 'audio',
          callId,
          from
        };
        callIdRef.current = callId;
        // Resolve caller display name from the local user list if known
        const known = BoostPayStore.getUsers().find((u) => String(u.id) === String(from));
        const name = known?.email || `User #${from}`;
        setPeer({ id: String(from), name });
        setMedia(signal.media === 'video' ? 'video' : 'audio');
        setPhase('incoming');
        setError('');
        ring.startRingtone();
        timeoutRef.current = window.setTimeout(() => {
          // Missed (nobody answered)
          pendingOfferRef.current = null;
          ring.stop();
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
  }, [phase, ring, finishCall]);

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
      {isVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 h-full w-full object-cover ${phase === 'active' && !cameraOff ? '' : 'hidden'}`}
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
              className={`flex h-13 w-13 items-center justify-center rounded-full border transition cursor-pointer ${muted ? 'border-red-500/50 bg-red-500/20 text-red-300' : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'}`}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            {isVideo && (
              <button
                onClick={toggleCamera}
                className={`flex h-13 w-13 items-center justify-center rounded-full border transition cursor-pointer ${cameraOff ? 'border-red-500/50 bg-red-500/20 text-red-300' : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'}`}
                title={cameraOff ? 'Camera on' : 'Camera off'}
              >
                {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>
            )}
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
