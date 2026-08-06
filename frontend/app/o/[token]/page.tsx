'use client';

/**
 * Public self-service ordering — reached by scanning the QR at the booth.
 *
 * Deliberately has NO auth import and no AppShell: it renders for visitors on
 * their own phones, not for staff. Nothing about a lead is shown until the OTP
 * sent to that mobile has been verified, and the customer never sets their own
 * advance or coupons — the order arrives as a pending draft for a CRR.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, ShoppingBag, Plus, Trash2, CheckCircle2, AlertTriangle,
  ShieldCheck, ArrowRight, Store,
} from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { ORDER_ITEM_TYPES } from '@/lib/types';

type Step = 'loading' | 'invalid' | 'mobile' | 'otp' | 'register' | 'items' | 'done';

interface ExhibitionInfo {
  exhibition_id: number;
  name: string;
  location?: string | null;
}

interface KnownLead {
  lead_id: number;
  name?: string | null;
  company_name?: string | null;
}

interface ScannedProduct {
  product_id: number;
  barcode: string;
  product_type: string;
  category?: string | null;
  size?: string | null;
  colour?: string | null;
  fabric?: string | null;
  price: number;
  name?: string | null;
  image_path?: string | null;
}

interface ItemRow {
  item_type: string;
  barcode: string;
  size: string;
  colour: string;
  pieces: string;
  customization: string;
  product?: ScannedProduct | null;   // resolved from the barcode
  lookupError?: string | null;
  looking?: boolean;
}

const emptyRow = (): ItemRow => ({
  item_type: ORDER_ITEM_TYPES[0],
  barcode: '',
  size: '',
  colour: '',
  pieces: '1',
  customization: '',
  product: null,
});

// This page is public, so it cannot use the authenticated api client — that
// attaches employee headers and redirects to /auth/login on 401.
const API_BASE = (() => {
  const env = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (env && env !== 'http://localhost:5008') return env.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:5008`;
  return 'http://localhost:5008';
})();

export default function PublicOrderPage() {
  const params = useParams();
  const token = params.token as string;

  const [step, setStep] = useState<Step>('loading');
  const [exhibition, setExhibition] = useState<ExhibitionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [session, setSession] = useState<string | null>(null);
  const [lead, setLead] = useState<KnownLead | null>(null);

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');

  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);
  const [notes, setNotes] = useState('');
  const [orderNumber, setOrderNumber] = useState('');

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API_BASE}/api/public${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { 'X-Public-Session': session } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status})`);
    return data;
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/exhibition/${token}`);
        if (!res.ok) { setStep('invalid'); return; }
        setExhibition(await res.json());
        setStep('mobile');
      } catch {
        setStep('invalid');
      }
    })();
  }, [token]);

  // Resend cooldown, so the button can't be hammered.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestOtp = async () => {
    setError(null);
    if (mobile.replace(/\D/g, '').length < 10) { setError('Enter your 10-digit mobile number'); return; }
    setBusy(true);
    try {
      const res = await call('/otp/request', {
        method: 'POST',
        body: JSON.stringify({ token, mobile }),
      });
      setCooldown(res.retry_after_seconds ?? 60);
      setStep('otp');
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const verifyOtp = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await call('/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ token, mobile, code }),
      });
      setSession(res.session_token);
      if (res.known_lead) {
        setLead(res.known_lead);
        setStep('items');
      } else {
        setStep('register');
      }
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const register = async () => {
    setError(null);
    if (!name.trim()) { setError('Please enter your name'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Public-Session': session! },
        body: JSON.stringify({ name, company_name: company || null, email: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not register');
      setLead({ lead_id: data.lead_id, name, company_name: company });
      setStep('items');
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setError(null);
    const items = rows
      .filter(r => r.item_type)
      .map(r => ({
        item_type: r.item_type,
        barcode: r.barcode.trim() || null,
        size: r.size.trim() || null,
        colour: r.colour.trim() || null,
        pieces: parseInt(r.pieces) || 1,
        customization: r.customization.trim() || null,
        // The server re-reads the product and prices from the catalogue — the
        // page never sends a price of its own.
        product_id: r.product?.product_id ?? null,
      }));

    if (items.length === 0) { setError('Add at least one item'); return; }

    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Public-Session': session! },
        body: JSON.stringify({ items, notes: notes.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not submit your order');
      setOrderNumber(data.order_number);
      setStep('done');
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const setRow = (i: number, patch: Partial<ItemRow>) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  /**
   * Resolves a scanned barcode against the catalogue so the customer sees the
   * garment — image, fabric, price — instead of trusting they typed the right
   * code. An unknown code is surfaced, not silently accepted.
   */
  const lookupBarcode = async (i: number, barcode: string) => {
    const code = barcode.trim();
    setRow(i, { barcode: code, product: null, lookupError: null });
    if (!code) return;

    setRow(i, { looking: true });
    try {
      const res = await fetch(`${API_BASE}/api/public/product/${encodeURIComponent(code)}`, {
        headers: { 'X-Public-Session': session! },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRow(i, { lookupError: data?.error || 'We could not find that code', looking: false });
        return;
      }
      setRow(i, {
        product: data,
        item_type: data.product_type ?? ORDER_ITEM_TYPES[0],
        size: data.size ?? '',
        colour: data.colour ?? '',
        looking: false,
        lookupError: null,
      });
    } catch {
      setRow(i, { lookupError: 'Could not check that code', looking: false });
    }
  };

  if (step === 'loading') {
    return <Shell><div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div></Shell>;
  }

  if (step === 'invalid') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500" />
          <p className="text-base font-semibold text-slate-800">This ordering link isn&apos;t active</p>
          <p className="text-sm text-slate-500">Please ask our staff at the counter for help.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell exhibition={exhibition}>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="space-y-4"
        >
          {step === 'mobile' && (
            <>
              <Heading title="Place your order" sub="Start with your mobile number" />
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={mobile}
                onChange={e => setMobile(e.target.value)}
                placeholder="10-digit mobile number"
                className="w-full h-14 px-4 rounded-xl border border-slate-200 bg-white text-lg tracking-wide"
              />
              <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
                We&apos;ll send a verification code to this number on WhatsApp.
              </p>
              <Primary onClick={requestOtp} busy={busy}>Send code <ArrowRight className="w-4 h-4" /></Primary>
            </>
          )}

          {step === 'otp' && (
            <>
              <Heading title="Enter the code" sub={`Sent on WhatsApp to ${mobile}`} />
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full h-14 px-4 rounded-xl border border-slate-200 bg-white text-2xl text-center tracking-[0.4em] font-semibold"
              />
              <Primary onClick={verifyOtp} busy={busy} disabled={code.length < 4}>Verify</Primary>
              <button
                onClick={requestOtp}
                disabled={cooldown > 0 || busy}
                className="w-full text-xs text-slate-500 disabled:text-slate-300 py-2"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
            </>
          )}

          {step === 'register' && (
            <>
              <Heading title="Welcome!" sub="We don't have you on file yet — just your name and we're set" />
              <Input value={name} onChange={setName} placeholder="Your name" />
              <Input value={company} onChange={setCompany} placeholder="Company (optional)" />
              <Primary onClick={register} busy={busy}>Continue <ArrowRight className="w-4 h-4" /></Primary>
            </>
          )}

          {step === 'items' && (
            <>
              <Heading
                title={lead?.name ? `Hi ${lead.name.split(' ')[0]}!` : 'Your order'}
                sub="Add what you'd like to order"
              />

              {rows.map((row, i) => (
                <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      Item {i + 1}
                    </span>
                    {rows.length > 1 && (
                      <button
                        onClick={() => setRows(rs => rs.filter((_, idx) => idx !== i))}
                        aria-label={`Remove item ${i + 1}`}
                        className="text-slate-300 hover:text-rose-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {ORDER_ITEM_TYPES.map(t => (
                      <button
                        key={t}
                        onClick={() => setRow(i, { item_type: t })}
                        className={`flex-1 h-10 rounded-lg text-sm font-medium transition-colors ${
                          row.item_type === t
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <BarcodeScanner
                    label="Barcode on the tag"
                    value={row.barcode}
                    onChange={v => lookupBarcode(i, v)}
                  />

                  {row.looking && (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> Looking that up…
                    </p>
                  )}

                  {row.lookupError && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      {row.lookupError}
                    </p>
                  )}

                  {/* Once resolved, show the garment rather than empty boxes —
                      the customer confirms a picture, not a code. */}
                  {row.product && (
                    <div className="flex gap-3 rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                      <div className="w-14 h-18 rounded-lg bg-white overflow-hidden shrink-0 flex items-center justify-center">
                        {row.product.image_path
                          ? <img src={`${API_BASE}/uploads/${row.product.image_path}`}
                                 alt="" className="w-full h-full object-cover" />
                          : <ShoppingBag className="w-4 h-4 text-slate-300" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {row.product.name || row.product.product_type}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {[row.product.category, row.product.size && `Size ${row.product.size}`,
                            row.product.colour, row.product.fabric].filter(Boolean).join(' · ')}
                        </p>
                        <p className="text-sm font-bold text-slate-900 mt-1">
                          ₹{row.product.price.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Size and colour come from the product once scanned; ask only
                      when the code did not resolve. */}
                  <div className="grid grid-cols-3 gap-2">
                    {!row.product && (
                      <>
                        <Input value={row.size}   onChange={v => setRow(i, { size: v })}   placeholder="Size" />
                        <Input value={row.colour} onChange={v => setRow(i, { colour: v })} placeholder="Colour" />
                      </>
                    )}
                    <Input value={row.pieces} onChange={v => setRow(i, { pieces: v })} placeholder="Pcs" type="number" />
                  </div>

                  <Input
                    value={row.customization}
                    onChange={v => setRow(i, { customization: v })}
                    placeholder="Any customization?"
                  />
                </div>
              ))}

              <button
                onClick={() => setRows(rs => [...rs, emptyRow()])}
                className="w-full h-12 rounded-xl border border-dashed border-slate-300 text-sm font-medium text-slate-600 flex items-center justify-center gap-2 hover:bg-slate-50"
              >
                <Plus className="w-4 h-4" /> Add another item
              </button>

              <Input value={notes} onChange={setNotes} placeholder="Anything else we should know?" />

              <p className="text-[11px] text-slate-400">
                Our team will confirm pricing and payment with you at the counter.
              </p>

              <Primary onClick={submit} busy={busy}>
                <ShoppingBag className="w-4 h-4" /> Submit order
              </Primary>
            </>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle2 className="w-14 h-14 text-emerald-500" />
              <p className="text-lg font-bold text-slate-900">Order received</p>
              <p className="text-sm text-slate-500">
                Your reference is <span className="font-semibold text-slate-700">{orderNumber}</span>.
              </p>
              <p className="text-sm text-slate-500 max-w-xs">
                Please visit the counter to confirm your order and complete the advance payment.
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
}

function Shell({ children, exhibition }: { children: React.ReactNode; exhibition?: ExhibitionInfo | null }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-md mx-auto px-4 py-6">
        {exhibition && (
          <div className="flex items-center gap-2 mb-5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
              <Store className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{exhibition.name}</p>
              {exhibition.location && (
                <p className="text-[11px] text-slate-400 truncate">{exhibition.location}</p>
              )}
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <input
      type={type}
      inputMode={type === 'number' ? 'numeric' : undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm"
    />
  );
}

function Primary({ onClick, busy, disabled, children }: {
  onClick: () => void; busy?: boolean; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full h-13 py-3.5 rounded-xl bg-blue-600 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:bg-slate-300 transition-colors"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : children}
    </button>
  );
}
