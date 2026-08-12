'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import {
  QrCode, Loader2, Printer, Copy, RefreshCw, Check, ExternalLink, Power,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn, siteOrigin } from '@/lib/utils';

/**
 * Self-service ordering QR for an exhibition.
 *
 * The QR encodes the FRONTEND origin (where the visitor's browser goes), not
 * the API origin — a common way to get this wrong, since every other URL in the
 * app points at the backend. siteOrigin() prefers NEXT_PUBLIC_SITE_URL over
 * window.location.origin for exactly this reason: printed from a preview
 * deployment or localhost, window.location.origin would bake in an address
 * nobody but that machine can reach.
 */

/**
 * Branding for the printed sheet. The logo is loaded from /public at print
 * time and simply hidden if absent, so a missing file costs the brand name
 * rather than a broken-image icon on a sheet customers will read.
 */
const BRAND_NAME = 'Tejoo Fashion';
const BRAND_LOGO = '/tejoo-logo.png';

/** Builds the visitor URL, or null when self-service is off. */
export function publicOrderUrl(token?: string | null) {
  if (!token) return null;
  const origin = siteOrigin();
  return origin ? `${origin}/o/${token}` : null;
}

function QrCanvas({ url, size, className }: { url: string; size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, url, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      // Deep ink on white. A tinted QR looks smart and scans badly under the
      // mixed lighting of an exhibition hall.
      color: { dark: '#1C1917', light: '#ffffff' },
    }).catch(() => toast.error('Could not render the QR code'));
  }, [url, size]);

  return <canvas ref={ref} className={className} />;
}

/* ────────────────────────────────────────────────────────────────────────────
   Compact strip — one per exhibition in the list
   ──────────────────────────────────────────────────────────────────────────── */

export function SelfServiceQrInline({
  exhibitionId, enabled, token, onChange, onExpand,
}: {
  exhibitionId: number;
  enabled: boolean;
  token?: string | null;
  onChange?: (enabled: boolean, token: string | null) => void;
  onExpand: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const url = publicOrderUrl(token);

  const enable = async () => {
    setBusy(true);
    try {
      const res = await api.setSelfService(exhibitionId, true, false);
      onChange?.(res.self_service_enabled, res.public_token ?? null);
      toast.success('Ordering QR generated');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not enable self-service');
    } finally { setBusy(false); }
  };

  if (!enabled || !url) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="w-10 h-10 rounded-md border border-dashed border-border
                         flex items-center justify-center shrink-0">
          <QrCode className="w-4 h-4 text-muted-foreground/50" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground">Ordering QR</p>
          <p className="text-[10px] text-muted-foreground truncate">
            Let visitors place their own orders
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={enable}
                className="h-7 text-[11px] px-2.5 shrink-0">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Generate'}
        </Button>
      </div>
    );
  }

  return (
    <button onClick={onExpand} className="w-full flex items-center gap-2.5 text-left group">
      {/* Real QR rather than an icon: staff recognise the code itself, and it
          can be scanned straight off the screen while testing. */}
      <span className="rounded-md border border-border bg-white p-0.5 shrink-0">
        <QrCanvas url={url} size={44} className="block w-10 h-10" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
          Ordering QR
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
          <span className="text-[10px] font-normal text-success">Live</span>
        </p>
        <p className="text-[10px] text-muted-foreground truncate font-mono">/o/{token}</p>
      </div>
      <span className="text-[11px] font-medium text-primary shrink-0 group-hover:underline">
        Print
      </span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Full card — inside the dialog
   ──────────────────────────────────────────────────────────────────────────── */

export default function SelfServiceQrCard({
  exhibitionId, exhibitionName, enabled, token, onChange,
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

  const url = publicOrderUrl(token);

  useEffect(() => {
    if (!url || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 240, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#1C1917', light: '#ffffff' },
    }).catch(() => toast.error('Could not render the QR code'));
  }, [url]);

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
    } finally { setBusy(false); }
  }, [exhibitionId, onChange]);

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the link');
    }
  };

  // Opens a clean print window rather than printing the whole admin page.
  const print = () => {
    if (!url || !canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const w = window.open('', '_blank', 'width=680,height=900');
    if (!w) { toast.error('Allow pop-ups to print the QR'); return; }

    // Served from /public. onerror hides it rather than leaving a broken-image
    // icon on a sheet that goes up in front of customers.
    const logoSrc = `${window.location.origin}${BRAND_LOGO}`;

    w.document.write(`<!doctype html><html><head><title>${escapeHtml(BRAND_NAME)} - Order QR</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:40px 32px;
             text-align:center;color:#1C1917}
        .logo{max-width:190px;max-height:90px;margin:0 auto 10px;display:block;object-fit:contain}
        .brand{font-size:22px;font-weight:700;letter-spacing:.02em;margin:0 0 2px}
        .event{font-size:13px;font-weight:500;color:#78716C;margin:0 0 22px}
        .rule{width:64px;height:2px;background:#9F1239;margin:0 auto 22px;border-radius:2px}
        h1{font-size:23px;margin:0 0 18px}
        .qr{width:320px;height:320px;image-rendering:pixelated;border:1px solid #EAE4DE;
            border-radius:10px;padding:8px}
        .steps{margin:24px auto 0;max-width:360px;text-align:left;font-size:13.5px;
               line-height:1.85;color:#44403C}
        .url{margin-top:20px;font-size:10px;color:#A8A29E;word-break:break-all}
        @media print{body{padding:20px} .qr{border-color:#ddd}}
      </style></head><body>
      <img class="logo" src="${logoSrc}" alt=""
           onerror="this.style.display='none'" />
      <p class="brand">${escapeHtml(BRAND_NAME)}</p>
      <p class="event">${escapeHtml(exhibitionName)}</p>
      <div class="rule"></div>
      <h1>Scan to place your order</h1>
      <img class="qr" src="${dataUrl}" alt="Order QR code" />
      <div class="steps">
        <div>1. Open your phone camera and scan this code</div>
        <div>2. Enter your mobile number</div>
        <div>3. Add the items you would like</div>
        <div>4. Our team will confirm your order</div>
      </div>
      <div class="url">${escapeHtml(url)}</div>
      </body></html>`);
    w.document.close();
    w.focus();
    // Wait for the logo to load, or printing can fire before it paints.
    setTimeout(() => w.print(), 600);
  };

  if (!enabled || !url) {
    return (
      <div className="text-center py-6 px-4">
        <span className="inline-flex rounded-lg bg-secondary p-3 mb-3">
          <QrCode className="w-6 h-6 text-muted-foreground" />
        </span>
        <p className="text-sm font-medium text-foreground">Self-service ordering is off</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs mx-auto">
          Generate a QR so visitors can place their own orders from their phone. Orders arrive
          as drafts for a CRR to confirm.
        </p>
        <Button size="sm" disabled={busy} onClick={() => setSelfService(true)}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Generate QR'}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-center">
        <div className="rounded-lg border border-border bg-white p-2.5">
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <code className="flex-1 text-[10px] text-muted-foreground bg-secondary rounded-md px-2 py-1.5 truncate">
          {url}
        </code>
        <Button variant="ghost" size="icon-sm" onClick={copyLink} aria-label="Copy link">
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
        <Button variant="ghost" size="icon-sm" asChild aria-label="Open page">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        The code points at wherever this page is open. Print it from the live site, not from
        localhost, or the stall will get a link nobody can reach.
      </p>

      <div className="flex gap-2">
        <Button size="sm" onClick={print} className="flex-1 gap-1.5">
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
          aria-label="New link" title="New link"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
                onClick={() => setSelfService(false)}
                className="text-muted-foreground" aria-label="Turn off" title="Turn off">
          <Power className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
