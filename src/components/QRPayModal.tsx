import { FC, useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  QrCode,
  Camera,
  ImagePlus,
  Loader2,
  AlertTriangle,
  Check,
  Copy,
  RefreshCw,
  Download,
  Share2
} from 'lucide-react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { User } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  /** When a scan resolves to a payee, hand it back (fills the transfer form). */
  onScannedPayee: (userId: string, name?: string) => void;
}

type Tab = 'MY_QR' | 'SCAN';

export const QRPayModal: FC<Props> = ({ isOpen, onClose, currentUser, onScannedPayee }) => {
  const [tab, setTab] = useState<Tab>('MY_QR');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [payload, setPayload] = useState('');
  const [copied, setCopied] = useState(false);
  const [genError, setGenError] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [imgPreview, setImgPreview] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Generate personal QR
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    (async () => {
      try {
        const data = await BoostPayStore.getQRPayload();
        if (!alive) return;
        setPayload(data.payload);
        const url = await QRCode.toDataURL(data.payload, {
          width: 640,
          margin: 2,
          // Standard dark-on-light QR: inverted (light-on-dark) codes fail on
          // most decoders including jsQR with dontInvert.
          color: { dark: '#09090b', light: '#fafafa' },
          errorCorrectionLevel: 'M'
        });
        setQrDataUrl(url);
        setGenError('');
      } catch (e: any) {
        if (alive) setGenError(e.message || 'Could not generate QR code.');
      }
    })();
    return () => { alive = false; };
  }, [isOpen, currentUser.id]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    if (!isOpen) stopCamera();
    return stopCamera;
  }, [isOpen, stopCamera]);

  // Open the camera automatically when the Scan tab appears
  useEffect(() => {
    if (!isOpen || tab !== 'SCAN') return;
    const t = window.setTimeout(() => { void startCamera(); }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tab]);

  const handlePayeePayload = useCallback((raw: string) => {
    setScanError('');
    let uid = '';
    let name = '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.t === 'boostpay:pay' && parsed.uid) {
        uid = String(parsed.uid);
        name = parsed.name ? String(parsed.name) : '';
      }
    } catch {
      // Also accept a bare user ID (e.g. "890" or "#890")
      const bare = raw.trim().replace(/^#/, '');
      if (/^\d+$/.test(bare)) uid = bare;
    }
    if (!uid) {
      setScanError('Not a valid BoostPay QR code. Ask the recipient to open their personal QR.');
      return;
    }
    stopCamera();
    onScannedPayee(uid, name);
    onClose();
  }, [onClose, onScannedPayee, stopCamera]);

  const scanImageData = useCallback((imageData: ImageData) => {
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
    return code && code.data ? code.data : null;
  }, []);

  const startCamera = async () => {
    setScanError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanError('Camera is not available in this browser. Use the image upload or paste options instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 720 } }
      });
      streamRef.current = stream;
      setScanning(true);
      // The <video> element mounts with this tab — wait for the ref just in case.
      let video = videoRef.current;
      for (let i = 0; i < 20 && !video; i++) {
        await new Promise((r) => setTimeout(r, 50));
        video = videoRef.current;
      }
      if (!video) return;
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay quirk — the stream still feeds frames */ }
      let lastScan = 0;
      const tick = () => {
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        // Decode ~6x/second on a downscaled frame — full-res every frame starves the UI
        const now = performance.now();
        if (now - lastScan < 160) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        lastScan = now;
        const scale = Math.min(1, 720 / (video.videoWidth || 720));
        canvas.width = Math.round((video.videoWidth || 720) * scale);
        canvas.height = Math.round((video.videoHeight || 480) * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = scanImageData(imageData);
        if (data) {
          handlePayeePayload(data);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setScanning(false);
      setScanError(e.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow camera access or upload a QR image below.'
        : 'Could not start the camera. Upload a QR image or paste the payment code instead.');
    }
  };

  const handleImageFile = async (file: File) => {
    setScanError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setImgPreview(dataUrl);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });
      const canvas = document.createElement('canvas');
      const imgScale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * imgScale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * imgScale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas unavailable.');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = scanImageData(imageData);
      if (data) {
        handlePayeePayload(data);
      } else {
        setScanError('No QR code found in that image. Try a clearer screenshot.');
      }
    } catch {
      setScanError('Could not read that image file.');
    }
  };

  const downloadQR = useCallback(() => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `boostpay-qr-${currentUser.id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [qrDataUrl, currentUser.id]);

  const shareQR = useCallback(async () => {
    if (!qrDataUrl) return;
    try {
      const blob = await (await fetch(qrDataUrl)).blob();
      const file = new File([blob], `boostpay-qr-${currentUser.id}.png`, { type: 'image/png' });
      const nav = navigator as any;
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: 'BoostPay payment QR' });
        return;
      }
      if (nav.share) {
        await nav.share({ title: 'BoostPay payment QR', text: `BoostPay payee ID: #${currentUser.id}` });
        return;
      }
      downloadQR();
    } catch (e: any) {
      if (e?.name !== 'AbortError') downloadQR();
    }
  }, [qrDataUrl, currentUser.id, downloadQR]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/30">
              <QrCode className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">QR Pay</h2>
              <p className="text-[10px] text-zinc-400">Show your code or scan to pay</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex rounded-2xl bg-zinc-950 p-1 mx-5 mt-4 border border-zinc-800/80">
          <button
            onClick={() => setTab('MY_QR')}
            className={`flex-1 rounded-xl py-2.5 text-xs font-semibold transition cursor-pointer ${tab === 'MY_QR' ? 'bg-amber-500 text-zinc-950 shadow-md font-bold' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            My QR Code
          </button>
          <button
            onClick={() => { setTab('SCAN'); setScanError(''); }}
            className={`flex-1 rounded-xl py-2.5 text-xs font-semibold transition cursor-pointer ${tab === 'SCAN' ? 'bg-amber-500 text-zinc-950 shadow-md font-bold' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            Scan & Pay
          </button>
        </div>

        <div className="p-5">
          {tab === 'MY_QR' ? (
            <div className="flex flex-col items-center">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-inner">
                {genError ? (
                  <div className="flex h-[260px] w-[260px] flex-col items-center justify-center gap-2 text-center">
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                    <p className="text-[11px] text-red-300 px-4">{genError}</p>
                    <button onClick={() => setTab('MY_QR')} className="mt-1 flex items-center gap-1 text-[11px] text-amber-400 cursor-pointer">
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                ) : qrDataUrl ? (
                  <img src={qrDataUrl} alt="Your BoostPay payment QR code" className="h-[260px] w-[260px] rounded-2xl" />
                ) : (
                  <div className="flex h-[260px] w-[260px] items-center justify-center">
                    <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
                  </div>
                )}
              </div>

              <div className="mt-3 grid w-full grid-cols-2 gap-2">
                <button
                  onClick={downloadQR}
                  className="flex items-center justify-center gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 py-2.5 text-xs font-semibold text-zinc-200 hover:border-amber-500/40 hover:text-amber-400 active:scale-[0.98] transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Save QR
                </button>
                <button
                  onClick={shareQR}
                  className="flex items-center justify-center gap-1.5 rounded-2xl bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition cursor-pointer shadow-md shadow-amber-500/20"
                >
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
              </div>

              <div className="mt-3 w-full rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Payee ID</p>
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-sm text-amber-400 font-bold">#{currentUser.id}</span>
                  <button
                    onClick={async () => {
                      const ok = await copyToClipboard(currentUser.id);
                      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
                    }}
                    className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[10px] text-zinc-300 hover:border-amber-500/40 hover:text-amber-400 active:scale-95 transition cursor-pointer"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Camera scanner */}
              <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
                <canvas ref={canvasRef} className="hidden" />
                {!scanning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
                    <Camera className="w-7 h-7 text-zinc-600" />
                    <button
                      onClick={startCamera}
                      className="rounded-2xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-95 transition cursor-pointer"
                    >
                      Start Camera
                    </button>
                    <p className="px-8 text-center text-[10px] text-zinc-500">
                      Point the camera at the recipient's BoostPay QR code
                    </p>
                  </div>
                )}
                {scanning && (
                  <>
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="h-40 w-40 rounded-3xl border-2 border-amber-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                    </div>
                    <button
                      onClick={stopCamera}
                      className="absolute right-3 top-3 rounded-xl bg-black/60 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-black/80 cursor-pointer"
                    >
                      Stop
                    </button>
                  </>
                )}
              </div>

              {scanError && (
                <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-300">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{scanError}</span>
                </div>
              )}

              {/* Image upload */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (f) handleImageFile(f);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/60 px-4 py-3.5 text-xs font-semibold text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 active:scale-[0.99] transition cursor-pointer"
                >
                  <ImagePlus className="w-4 h-4" />
                  Upload / paste a QR screenshot
                </button>
                {imgPreview && (
                  <img src={imgPreview} alt="Uploaded QR" className="mt-2 max-h-28 rounded-xl border border-zinc-800 mx-auto" />
                )}
              </div>

              {/* Text paste fallback */}
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Or paste the payment code / User ID
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder='{"t":"boostpay:pay","uid":"123"} or #123'
                    className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none font-mono"
                  />
                  <button
                    onClick={() => pasteText.trim() && handlePayeePayload(pasteText.trim())}
                    className="rounded-2xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-95 transition cursor-pointer"
                  >
                    Use
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
