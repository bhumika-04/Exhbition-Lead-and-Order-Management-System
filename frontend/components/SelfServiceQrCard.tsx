'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import {
  QrCode, Loader2, Printer, Copy, RefreshCw, Check, ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

/**
 * The printable QR for an exhibition's self-service ordering page.
 *
 * The QR encodes the FRONTEND origin (where the visitor's browser goes), not
 * the API origin — a common way to get this wrong, since every other URL in the
 * app points at the backend.
 */
export default function SelfServiceQrCard({
  exhibitionId,
  exhibitionName,
  enabled,
  token,
  onChange,
}: {
  exhibitionId: number;
  exhibitionName: string;
  enabled: boolean;
  token?: string | null;
  onChange?: (enabled: boolean, token: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const publicUrl =
    token && typeof window !== 'undefined' ? `${window.location.origin}/o/${token}` : null;

  useEffect(() => {
    if (!publicUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, publicUrl, {
      width: 260,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    }).catch(() => toast.error('Could not render the QR code'));
  }, [publicUrl]);

  const setSelfService = useCallback(async (nextEnabled: boolean, rotate = false) => {
    setBusy(true);
    try {
      const res = await api.setSelfService(exhibitionId, nextEnabled, rotate);
      onChange?.(res.self_service_enabled, res.public_token ?? null);
      toast.success(
        rotate ? 'New QR link generated — reprint the code'
               : nextEnabled ? 'Self-service ordering enabled'
                             : 'Self-service ordering disabled'
      );
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not update self-service');
    } finally {
      setBusy(false);
    }
  }, [exhibitionId, onChange]);

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the link');
    }
  };

  // Opens a clean print window rather than printing the whole admin page.
  const print = () => {
    if (!publicUrl || !canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const w = window.open('', '_blank', 'width=640,height=800');
    if (!w) { toast.error('Allow pop-ups to print the QR'); return; }

    w.document.write(`<!doctype html><html><head><title>${escapeHtml(exhibitionName)} — Order QR</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:48px 32px;
             text-align:center;color:#0f172a}
        h1{font-size:26px;margin:0 0 4px}
        h2{font-size:15px;font-weight:500;color:#64748b;margin:0 0 28px}
        img{width:340px;height:340px;image-rendering:pixelated}
        .steps{margin:28px auto 0;max-width:380px;text-align:left;font-size:14px;line-height:1.9;color:#334155}
        .url{margin-top:22px;font-size:11px;color:#94a3b8;word-break:break-all}
        @media print{body{padding:24px}}
      </style></head><body>
      <h1>Scan to place your order</h1>
      <h2>${escapeHtml(exhibitionName)}</h2>
      <img src="${dataUrl}" alt="Order QR code" />
      <div class="steps">
        <div>1. Open your phone camera and scan this code</div>
        <div>2. Enter your mobile number</div>
        <div>3. Confirm the code we send on WhatsApp</div>
        <div>4. Add the items you'd like</div>
      </div>
      <div class="url">${escapeHtml(publicUrl)}</div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  if (!enabled || !publicUrl) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-4 flex items-center gap-3">
        <QrCode className="w-5 h-5 text-slate-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-700">Self-service ordering</p>
          <p className="text-[11px] text-slate-400">
            Generate a QR so visitors can place their own orders from their phone.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy}
                onClick={() => setSelfService(true)} className="h-8 text-xs shrink-0">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Enable'}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <QrCode className="w-4 h-4 text-blue-600 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Self-service order QR
        </span>
        <span className="ml-auto text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
          Live
        </span>
      </div>

      <div className="flex justify-center py-1">
        <canvas ref={canvasRef} className="rounded-lg" />
      </div>

      <div className="flex items-center gap-1.5">
        <code className="flex-1 text-[10px] text-slate-500 bg-slate-50 rounded-lg px-2 py-1.5 truncate">
          {publicUrl}
        </code>
        <button onClick={copyLink} aria-label="Copy link"
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <a href={publicUrl} target="_blank" rel="noopener noreferrer" aria-label="Open page"
           className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={print} className="flex-1 h-9 gap-1.5 text-xs">
          <Printer className="w-3.5 h-3.5" /> Print for the stall
        </Button>
        <Button
          size="sm" variant="outline" disabled={busy}
          onClick={() => {
            // Rotating invalidates every printed copy — worth a confirm.
            if (confirm('Generate a new link? Every QR already printed will stop working.')) {
              setSelfService(true, true);
            }
          }}
          className="h-9 gap-1.5 text-xs"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          New link
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
                onClick={() => setSelfService(false)} className="h-9 text-xs text-slate-500">
          Disable
        </Button>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
