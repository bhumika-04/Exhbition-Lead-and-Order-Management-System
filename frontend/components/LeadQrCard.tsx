'use client';

/**
 * A lead's personal ordering QR — same idea as the exhibition-wide one in
 * SelfServiceQrCard, but bound to one customer: scanning it skips straight to
 * a name confirmation instead of asking for a mobile number, because the
 * token already says who this is.
 *
 * Deliberately its own small component rather than an extension of
 * SelfServiceQrCard — that one's enable/disable/rotate model is about a
 * whole exhibition's booth code, this is a single always-available link per
 * customer, and forcing the two into one component would have made both
 * harder to read for what is a few lines of genuine overlap (drawing a QR to
 * a canvas).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import { QrCode, Loader2, Download, Copy, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { siteOrigin } from '@/lib/utils';

function leadOrderUrl(token: string) {
  return `${siteOrigin()}/o/${token}`;
}

function QrCanvas({ url, size }: { url: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, url, {
      width: size, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#1C1917', light: '#ffffff' },
    }).catch(() => toast.error('Could not render the QR code'));
  }, [url, size]);

  return <canvas ref={ref} className="block" />;
}

export default function LeadQrCard({ leadId, leadName, token, onTokenChange }: {
  leadId: number;
  leadName?: string | null;
  token?: string | null;
  onTokenChange: (token: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const modalCanvasRef = useRef<HTMLCanvasElement>(null);

  const url = token ? leadOrderUrl(token) : null;

  // The modal canvas is drawn at a fixed, larger size so a download is crisp
  // regardless of how small the thumbnail that opened it was.
  useEffect(() => {
    if (!showPreview || !url || !modalCanvasRef.current) return;
    QRCode.toCanvas(modalCanvasRef.current, url, {
      width: 220, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#1C1917', light: '#ffffff' },
    }).catch(() => toast.error('Could not render the QR code'));
  }, [showPreview, url]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await api.setLeadPublicToken(leadId);
      onTokenChange(res.public_token);
      setShowPreview(true);
    } catch {
      toast.error('Could not generate the QR');
    } finally {
      setBusy(false);
    }
  };

  if (!token || !url) {
    return (
      <button
        onClick={generate}
        disabled={busy}
        className="flex items-center gap-2.5 rounded-lg bg-primary px-3 py-2.5 text-left w-full shadow-sm
                   hover:bg-primary/90 hover:shadow active:translate-y-px
                   disabled:opacity-60 disabled:pointer-events-none transition-all"
      >
        <span className="w-9 h-9 rounded-md bg-primary-foreground/15 flex items-center justify-center shrink-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin text-primary-foreground" /> : <QrCode className="w-4 h-4 text-primary-foreground" />}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-primary-foreground">Generate ordering QR</span>
          <span className="block text-[10px] text-primary-foreground/80">Customer scans it to order themselves — no number to type</span>
        </span>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowPreview(true)}
        className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 hover:bg-secondary/40 transition-colors text-left w-full"
      >
        <span className="rounded-md border border-border bg-white p-0.5 shrink-0">
          <QrCanvas url={url} size={40} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground">Ordering QR</span>
          <span className="block text-[10px] text-muted-foreground">Tap to show — customer scans it off this screen</span>
        </span>
      </button>

      {showPreview && createPortal(
        <div onClick={() => setShowPreview(false)}
             className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div onClick={e => e.stopPropagation()}
               className="bg-card rounded-2xl shadow-2xl w-full max-w-xs p-5 text-center">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-foreground truncate">
                {leadName ? `${leadName}'s order QR` : 'Order QR'}
              </p>
              <button onClick={() => setShowPreview(false)} className="p-1 rounded-lg hover:bg-secondary shrink-0">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground mb-3">
              Hand them the phone, or hold this up to theirs
            </p>

            <div className="flex justify-center mb-3">
              <div className="rounded-lg border border-border bg-white p-3">
                <canvas ref={modalCanvasRef} className="block" />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm" variant="outline" className="flex-1 gap-1.5 text-xs"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  } catch { toast.error('Could not copy the link'); }
                }}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button
                size="sm" className="flex-1 gap-1.5 text-xs"
                onClick={() => {
                  if (!modalCanvasRef.current) return;
                  const a = document.createElement('a');
                  a.href = modalCanvasRef.current.toDataURL('image/png');
                  a.download = `order-qr-${leadName?.replace(/\s+/g, '-').toLowerCase() || leadId}.png`;
                  a.click();
                }}
              >
                <Download className="w-3.5 h-3.5" /> Download
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
