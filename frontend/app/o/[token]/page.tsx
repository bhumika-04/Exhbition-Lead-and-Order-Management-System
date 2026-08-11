'use client';

/**
 * Public self-service ordering — reached by scanning the QR at the booth.
 *
 * Deliberately has NO auth import and no AppShell: it renders for visitors on
 * their own phones, not for staff. The typed mobile number opens a session and
 * is taken at face value — the QR is printed on the stall with staff beside it.
 * The customer never sets their own advance or coupons; the order arrives as a
 * pending draft for a CRR.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, ShoppingBag, Plus, Minus, Trash2, CheckCircle2, AlertTriangle,
  ShieldCheck, ArrowRight, Store, ScanLine, X, ChevronRight, FileText, Pencil,
} from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import {
  splitCsv, money, comboKey, rowCombos, rowPieces, reconcileQty,
} from '@/lib/orders';
import QtyMatrix from '@/components/QtyMatrix';
import ChipRow from '@/components/ChipRow';
import { NumberInput } from '@/components/ui/number-input';

type Step = 'loading' | 'invalid' | 'mobile' | 'register' | 'items' | 'done';

interface ExhibitionInfo {
  exhibition_id: number;
  name: string;
  location?: string | null;
}

interface PastOrder {
  order_number: string;
  status_code: string;
  total: number;
  created_at: string;
  item_count: number;
  total_pieces: number;
}

interface PastOrderLine {
  line_number: number;
  barcode?: string | null;
  size?: string | null;
  colour?: string | null;
  fabric?: string | null;
  pieces: number;
  rate?: number | null;
  amount?: number | null;
  customization?: string | null;
  name?: string | null;
  image_path?: string | null;
  image_url?: string | null;
}

interface PastOrderDetail {
  order_number: string;
  status_code: string;
  created_at: string;
  notes?: string | null;
  total: number;
  items: PastOrderLine[];
}

interface KnownLead {
  lead_id: number;
  name?: string | null;
  company_name?: string | null;
}

interface ScannedProduct {
  product_id: number;
  barcode: string;
  size?: string | null;
  colour?: string | null;
  fabric?: string | null;
  price: number;
  name?: string | null;
  image_path?: string | null;
  image_url?: string | null;
  colour_is_set?: boolean;
  size_is_set?: boolean;
}

interface ItemRow {
  barcode: string;
  sizes: string[];
  colours: string[];
  /** Pieces per size x colour combination, keyed by comboKey(). */
  qty: Record<string, number>;
  sizeIsSet: boolean;
  colourIsSet: boolean;
  customization: string;
  product?: ScannedProduct | null;   // resolved from the barcode
}

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
  const [session, setSession] = useState<string | null>(null);
  const [lead, setLead] = useState<KnownLead | null>(null);

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');

  const [rows, setRows] = useState<ItemRow[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [pastOrders, setPastOrders] = useState<PastOrder[]>([]);
  const [openOrder, setOpenOrder] = useState<PastOrderDetail | null>(null);
  const [openBusy, setOpenBusy] = useState(false);
  /**
   * The order number being edited, or null when building a new one.
   *
   * A customer may change an order that is still with our team — it stays a
   * draft, so staff see whatever it says at the moment they confirm, and that
   * confirmation is the approval.
   */
  const [editingOrder, setEditingOrder] = useState<string | null>(null);

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

  /**
   * The session and basket survive a reload.
   *
   * Held only in React state they did not: a phone locking, a notification, or
   * iOS discarding a backgrounded tab dropped the token and everything the
   * customer had added, and they came back to the mobile-number step with no
   * sign anything had been lost. At a stall that reads as "the order vanished".
   *
   * sessionStorage rather than localStorage on purpose — it is scoped to the
   * tab, so a staff tablet used to demo the flow does not hand one visitor's
   * session to the next. Keyed by exhibition token so two never collide.
   */
  const cacheKey = `tejoo.order.${token}`;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/exhibition/${token}`);
        if (!res.ok) { setStep('invalid'); return; }
        setExhibition(await res.json());

        const saved = sessionStorage.getItem(cacheKey);
        if (saved) {
          const c = JSON.parse(saved);
          if (c?.lead) {
            setLead(c.lead);
            setRows(Array.isArray(c.rows) ? c.rows : []);
            setNotes(typeof c.notes === 'string' ? c.notes : '');
            setEditingOrder(typeof c.editingOrder === 'string' ? c.editingOrder : null);
            // A saved basket with no session is one whose session expired: keep
            // the items and ask for the number again, rather than throwing the
            // order away because the token went stale.
            if (c.session) { setSession(c.session); setStep('items'); return; }
            setStep('mobile');
            setError('Your session timed out — enter your number to pick up where you left off.');
            return;
          }
        }
        setStep('mobile');
      } catch {
        setStep('invalid');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Written on every change rather than only at submit, because the thing being
  // guarded against is the tab going away without warning.
  useEffect(() => {
    // Keyed on the lead, not the session: after a timeout the session is null
    // but the basket is still worth keeping, and requiring both here would have
    // stopped writing at exactly the moment the save matters most.
    if (!lead) return;
    sessionStorage.setItem(cacheKey, JSON.stringify({ session, lead, rows, notes, editingOrder }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, lead, rows, notes, editingOrder]);


  /**
   * The lead's existing orders.
   *
   * Refetched whenever the session changes and again after a submit, so a
   * customer returning to the QR sees what they have already placed instead of
   * an empty page that reads as though the order was lost.
   */
  const loadPastOrders = async (token_: string | null) => {
    if (!token_) return;
    try {
      const res = await fetch(`${API_BASE}/api/public/orders`, {
        headers: { 'X-Public-Session': token_ },
      });
      if (!res.ok) return;              // expired session is handled on submit
      const data = await res.json();
      setPastOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      // Best effort: this is context, not something to block ordering on.
    }
  };

  useEffect(() => { loadPastOrders(session); }, [session]);

  /**
   * Loads a draft back into the basket for editing.
   *
   * The saved lines are one per size x colour, so they are regrouped by design
   * the same way the counter's form does it — otherwise the customer would see
   * the same garment listed once per colour.
   */
  const editPastOrder = async (o: PastOrderDetail) => {
    const groups = new Map<string, PastOrderLine[]>();
    for (const l of o.items) {
      const key = l.barcode ?? `line-${l.line_number}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
    }

    const uniq = (vs: (string | null | undefined)[]) =>
      [...new Set(vs.filter((v): v is string => !!v && v.trim() !== ''))];

    const restored: ItemRow[] = await Promise.all([...groups.values()].map(async lines => {
      const first = lines[0];
      let product: ScannedProduct | null = null;
      if (first.barcode && session) {
        try {
          const res = await fetch(
            `${API_BASE}/api/public/product/${encodeURIComponent(first.barcode)}`,
            { headers: { 'X-Public-Session': session } });
          if (res.ok) product = await res.json();
        } catch { /* design since retired — fall back to the order's own values */ }
      }

      const qty: Record<string, number> = {};
      for (const l of lines) qty[comboKey(l.size ?? null, l.colour ?? null)] = l.pieces;

      return {
        barcode: first.barcode ?? '',
        sizes: uniq(lines.map(l => l.size)),
        colours: uniq(lines.map(l => l.colour)),
        sizeIsSet: !!product?.size_is_set,
        colourIsSet: !!product?.colour_is_set,
        qty,
        customization: first.customization ?? '',
        product,
      };
    }));

    setRows(restored);
    setNotes(o.notes ?? '');
    setEditingOrder(o.order_number);
    setOpenOrder(null);
  };

  /** Full lines for one order — the same picture as the Sales Order document. */
  const openPastOrder = async (orderNumber: string) => {
    if (!session) return;
    setOpenBusy(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/public/orders/${encodeURIComponent(orderNumber)}`,
        { headers: { 'X-Public-Session': session } });
      if (!res.ok) throw new Error();
      setOpenOrder(await res.json());
    } catch {
      setError('Could not open that order. Please ask our staff.');
    } finally { setOpenBusy(false); }
  };

  /** The number opens a session straight away. */
  const startSession = async () => {
    setError(null);
    if (mobile.replace(/\D/g, '').length < 10) { setError('Enter your 10-digit mobile number'); return; }
    setBusy(true);
    try {
      const res = await call('/session', {
        method: 'POST',
        body: JSON.stringify({ token, mobile }),
      });
      setSession(res.session_token);
      setStep(res.known_lead ? 'items' : 'register');
      if (res.known_lead) setLead(res.known_lead);
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const continueFromMobile = () => startSession();

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

    const emptyRows = rows.filter(r => rowPieces(r) === 0);
    if (emptyRows.length > 0) {
      setError(
        emptyRows.length === rows.length
          ? 'Choose how many of each you would like'
          : 'One of your items has no quantity — set it or remove it'
      );
      return;
    }

    // One line per combination actually wanted. Sending "M, L" against a single
    // count would leave the counter unable to tell what to pick.
    const items = rows.flatMap(r =>
      rowCombos(r)
        .filter(c => (r.qty[c.key] ?? 0) > 0)
        .map(c => ({
          barcode: r.barcode.trim() || null,
          size: c.size,
          colour: c.colour,
          pieces: r.qty[c.key],
          customization: r.customization.trim() || null,
          // The server re-reads the product and prices from the catalogue — the
          // page never sends a price of its own.
          product_id: r.product?.product_id ?? null,
        }))
    );

    if (items.length === 0) { setError('Add at least one item'); return; }

    setBusy(true);
    try {
      // Editing replaces the lines of the existing draft; otherwise a new
      // order is raised. Either way the order stays with our team until a
      // member of staff confirms it, and that confirmation is the approval.
      const res = editingOrder
        ? await fetch(`${API_BASE}/api/public/orders/${encodeURIComponent(editingOrder)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Public-Session': session! },
            body: JSON.stringify({ items, notes: notes.trim() || null }),
          })
        : await fetch(`${API_BASE}/api/public/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Public-Session': session! },
            body: JSON.stringify({ items, notes: notes.trim() || null }),
          });
      const data = await res.json().catch(() => ({}));

      // A 401 here means the session went while the basket was being filled.
      // The basket is kept and the customer re-enters their number, rather than
      // being shown an error they cannot act on with their order still on screen.
      if (res.status === 401) {
        sessionStorage.setItem(cacheKey, JSON.stringify({ session: null, lead, rows, notes }));
        setSession(null);
        setStep('mobile');
        setError('Your session timed out — enter your number and we will submit your order.');
        return;
      }

      if (!res.ok) throw new Error(data?.error || 'Could not submit your order');

      // Submitted and safely on the server: the local copy would otherwise be
      // restored on the next visit as a phantom basket.
      sessionStorage.removeItem(cacheKey);
      setOrderNumber(data.order_number);
      setRows([]); setNotes(''); setEditingOrder(null);
      loadPastOrders(session);
      setStep('done');
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  /**
   * Changing either axis reshapes the combination grid, so quantities are
   * reconciled in the same step — otherwise a de-selected size leaves an orphan
   * quantity that still counts toward the total.
   */
  const setRow = (i: number, patch: Partial<ItemRow>) =>
    setRows(rs => rs.map((r, idx) => {
      if (idx !== i) return r;
      const next = { ...r, ...patch };
      return 'sizes' in patch || 'colours' in patch ? reconcileQty(next) : next;
    }));

  const totalPieces = rows.reduce((sum, r) => sum + rowPieces(r), 0);

  // Indicative only: the counter confirms pricing, and an unpriced item
  // contributes nothing rather than a misleading zero.
  const estimatedTotal = rows.reduce(
    (sum, r) => sum + (r.product?.price ?? 0) * rowPieces(r), 0);

  /**
   * A scanned code becomes a row only once the catalogue confirms it.
   *
   * Nothing is added on a code we cannot resolve — the customer would otherwise
   * be left holding a row with no picture and no price, unable to tell whether
   * it is the right garment. The scanner stays open with the reason shown.
   */
  const addScanned = async (barcode: string) => {
    const code = barcode.trim();
    if (!code) return;

    setScanError(null);
    setScanBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/product/${encodeURIComponent(code)}`, {
        headers: { 'X-Public-Session': session! },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScanError(data?.error || `We could not find ${code}. Please check with our staff.`);
        return;
      }

      const sizes   = splitCsv(data.size);
      const colours = splitCsv(data.colour);

      setRows(rs => [...rs, reconcileQty({
        barcode: data.barcode ?? code,
        // Preselect only when there is no choice to make; otherwise leave it to
        // the customer rather than guessing a size for them. A set is not a
        // choice — every value ships together, so all of them are selected and
        // seeded at one piece each.
        sizes:   data.size_is_set   || sizes.length === 1   ? sizes   : [],
        colours: data.colour_is_set || colours.length === 1 ? colours : [],
        sizeIsSet:   !!data.size_is_set,
        colourIsSet: !!data.colour_is_set,
        qty: {},
        customization: '',
        product: data,
      })]);
      setScanOpen(false);
    } catch {
      setScanError('Could not check that code. Please try again.');
    } finally {
      setScanBusy(false);
    }
  };

  if (step === 'loading') {
    return (
      <Shell centered>
        <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" /></div>
      </Shell>
    );
  }

  if (step === 'invalid') {
    return (
      <Shell centered>
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-10 h-10 text-warning" />
          <p className="text-base font-semibold text-foreground">This ordering link isn&apos;t active</p>
          <p className="text-sm text-muted-foreground">Please ask our staff at the counter for help.</p>
        </div>
      </Shell>
    );
  }

  return (
    // The mobile step carries its own logo and title, so the Shell's
    // exhibition chip would be a second header stacked on the first.
    <Shell centered={step === 'mobile'} exhibition={step === 'mobile' ? null : exhibition}>
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
            // Deliberately mirrors the staff sign-in: logo, title, one card,
            // one primary action. A customer arriving from a QR has no idea
            // what this app is, so the first screen has to look like a front
            // door rather than a step in a wizard.
            <div>
              <div className="text-center mb-7">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/tejoo-logo.png"
                  alt="Tejoo"
                  className="h-16 w-auto mx-auto mb-4 rounded-lg"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <h1 className="text-lg font-semibold text-foreground tracking-tight">
                  Place your order
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                  {exhibition?.name
                    ? `At ${exhibition.name} — start with your mobile number`
                    : 'Start with your mobile number'}
                </p>
              </div>

              <div className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-4">
                <label className="block">
                  <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Mobile number
                  </span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="go"
                    autoFocus
                    maxLength={14}
                    value={mobile}
                    // Digits, spaces and a leading + only — a name typed here
                    // would otherwise reach the server and fail validation with
                    // no clue why.
                    onChange={e => setMobile(e.target.value.replace(/[^\d+ ]/g, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') continueFromMobile(); }}
                    placeholder="10-digit mobile number"
                    // h-11 / text-sm to match the staff sign-in exactly. Safe to
                    // drop below 16px here because globals.css raises every
                    // input to 16px under 640px, which is what stops iOS
                    // zooming on focus.
                    className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm
                               text-foreground tracking-wide placeholder:text-muted-foreground/60
                               focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-input transition"
                  />
                </label>

                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 leading-relaxed">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
                  We use this to link your order and send you updates.
                </p>

                <button
                  onClick={continueFromMobile}
                  disabled={busy || mobile.replace(/\D/g, '').length < 10}
                  className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium text-sm
                             inline-flex items-center justify-center gap-2 shadow-sm
                             hover:bg-primary/90 hover:shadow active:translate-y-px
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40
                             disabled:opacity-50 disabled:pointer-events-none transition-all"
                >
                  {busy
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Please wait…</>
                    : <>Continue <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>

              <p className="text-center text-[11px] text-muted-foreground mt-5">
                Tejoo Fashion Exhibition Management System
                <br />
                powered by Indus Analytics Private Limited
              </p>
            </div>
          )}

          {step === 'register' && (
            <>
              <Heading title="Welcome!" sub="We don't have you on file yet — just your name and we're set" />
              <Input value={name} onChange={setName} placeholder="Your name" />
              <Input value={company} onChange={setCompany} placeholder="Agency (optional)" />
              <Primary onClick={register} busy={busy}>Continue <ArrowRight className="w-4 h-4" /></Primary>
            </>
          )}

          {step === 'items' && (
            <>
              <Heading
                title={lead?.name ? `Hi ${lead.name.split(' ')[0]}!` : 'Your order'}
                sub="Scan the tag on each piece you like"
              />

              {/* One button. The customer scans the tag; everything about the
                  garment comes from the catalogue, so there is nothing to fill
                  in but which size, which colour and how many. */}
              <button
                onClick={() => setScanOpen(true)}
                className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-semibold
                           inline-flex items-center justify-center gap-2.5 shadow-sm
                           hover:bg-primary/90 active:translate-y-px transition-all"
              >
                <ScanLine className="w-5 h-5" />
                {rows.length === 0 ? 'Scan an item' : 'Scan another item'}
              </button>

              {/* Without this the basket looks identical whether it is a new
                  order or a rewrite of an existing one, and submitting would
                  silently replace an order the customer thought they were
                  adding to. */}
              {editingOrder && (
                <div className="flex items-center gap-2 rounded-xl border border-primary/30
                                bg-primary/[0.06] px-3 py-2.5">
                  <Pencil className="w-3.5 h-3.5 text-primary shrink-0" />
                  <p className="text-[11px] text-foreground flex-1 min-w-0">
                    Changing <span className="font-semibold">{editingOrder}</span> — submitting
                    replaces what is on it.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setEditingOrder(null); setRows([]); setNotes(''); }}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Orders already placed. Shown above the basket because a
                  returning customer's first question is "did my order go
                  through?", and an empty basket alone answers it wrongly. */}
              {pastOrders.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Your orders with us
                  </p>
                  <div className="space-y-1.5">
                    {pastOrders.map(o => (
                      <button key={o.order_number}
                              type="button"
                              onClick={() => openPastOrder(o.order_number)}
                              disabled={openBusy}
                              className="w-full text-left flex items-center gap-2 rounded-lg bg-secondary/50
                                         px-3 py-2 hover:bg-secondary transition-colors
                                         disabled:opacity-60">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground truncate">
                            {o.order_number}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {o.item_count} item{o.item_count === 1 ? '' : 's'} · {o.total_pieces} pc
                            {' · '}
                            {new Date(o.created_at).toLocaleDateString('en-IN',
                              { day: 'numeric', month: 'short' })}
                          </p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          o.status_code === 'confirmed'
                            ? 'bg-success/15 text-success'
                            : 'bg-warning/15 text-warning'
                        }`}>
                          {o.status_code === 'confirmed' ? 'Confirmed' : 'With our team'}
                        </span>
                        <span className="text-xs font-bold text-foreground tabular shrink-0">
                          {money(o.total)}
                        </span>
                        {openBusy
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/50 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {rows.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <ShoppingBag className="w-9 h-9 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Nothing added yet</p>
                  <p className="text-[11px] text-muted-foreground max-w-[220px]">
                    Point your camera at the barcode on the price tag
                  </p>
                </div>
              )}

              {rows.map((row, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-3 space-y-3">
                  <div className="flex gap-3">
                    <div className="w-16 h-20 rounded-lg bg-secondary overflow-hidden shrink-0
                                    flex items-center justify-center">
                      {row.product?.image_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${API_BASE}/uploads/${row.product.image_path}`}
                             alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ShoppingBag className="w-5 h-5 text-muted-foreground/40" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {row.product?.name || row.barcode}
                      </p>
                      <p className="text-[11px] font-mono text-muted-foreground truncate">
                        {row.barcode}
                      </p>
                      {row.product && (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {row.product.fabric}
                        </p>
                      )}
                      {row.product && row.product.price > 0 && (
                        <p className="text-sm font-semibold text-foreground mt-1 tabular">
                          ₹{row.product.price.toLocaleString('en-IN')}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => setRows(rs => rs.filter((_, idx) => idx !== i))}
                      aria-label="Remove"
                      className="p-1.5 -mt-1 -mr-1 rounded-lg text-muted-foreground/50 hover:text-destructive shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Multi-select: a customer often wants the same design in
                      two sizes or two colours. Options come from that barcode,
                      so they pick only from what can actually be supplied. */}
                  {splitCsv(row.product?.size).length > 0 && (
                    <ChipRow label="Size" options={splitCsv(row.product?.size)}
                             values={row.sizes} onChange={v => setRow(i, { sizes: v })}
                             locked={row.sizeIsSet || splitCsv(row.product?.size).length === 1}
                             lockedHint={row.sizeIsSet
                               ? 'This design is sold in the full size run.'
                               : 'The only size this design comes in.'} />
                  )}
                  {splitCsv(row.product?.colour).length > 0 && (
                    <ChipRow label="Colour" options={splitCsv(row.product?.colour)}
                             values={row.colours} onChange={v => setRow(i, { colours: v })}
                             locked={row.colourIsSet || splitCsv(row.product?.colour).length === 1}
                             lockedHint={row.colourIsSet
                               ? 'This design is sold with all its colours together.'
                               : 'The only colour this design comes in.'} />
                  )}

                  {/* Same grid the counter uses, so "2 medium blue, 1 large red"
                      means exactly one thing on both sides. */}
                  <div className="rounded-lg border border-border bg-secondary/40 p-2.5">
                    <QtyMatrix
                      sizes={row.sizes}
                      colours={row.colours}
                      qty={row.qty}
                      comboKey={comboKey}
                      onChange={(k, v) => setRow(i, { qty: { ...row.qty, [k]: v } })}
                      onBulk={next => setRow(i, { qty: next })}
                    />
                  </div>

                  <Input
                    value={row.customization}
                    onChange={v => setRow(i, { customization: v })}
                    placeholder="Anything special about this piece?"
                  />
                </div>
              ))}

              {rows.length > 0 && (
                <>
                  <Input value={notes} onChange={setNotes} placeholder="Anything else we should know?" />

                  {/* What they are about to send, before they send it. */}
                  <div className="rounded-xl border border-border bg-card p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {rows.length} design{rows.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-sm font-semibold text-foreground tabular">
                        {totalPieces} piece{totalPieces === 1 ? '' : 's'}
                      </span>
                    </div>
                    {estimatedTotal > 0 && (
                      <div className="flex items-center justify-between pt-1.5 border-t border-border">
                        <span className="text-xs text-muted-foreground">Estimated total</span>
                        <span className="text-lg font-semibold text-foreground tabular">
                          {money(estimatedTotal)}
                        </span>
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
                      Indicative only — our team confirms pricing and payment with you at the counter.
                    </p>
                  </div>

                  <Primary onClick={submit} busy={busy} disabled={totalPieces === 0}>
                    <ShoppingBag className="w-4 h-4" />
                    Submit order{totalPieces > 0 ? ` · ${totalPieces} pc` : ''}
                  </Primary>
                </>
              )}
            </>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle2 className="w-14 h-14 text-success" />
              <p className="text-lg font-bold text-foreground">Order received</p>
              <p className="text-sm text-muted-foreground">
                Your reference is <span className="font-semibold text-foreground">{orderNumber}</span>.
              </p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Please visit the counter to confirm your order and complete the advance payment.
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive bg-destructive/[0.07] border border-destructive/25 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Scan sheet. Slides from the bottom so it sits under the thumb, and
          keeps the typed-barcode fallback visible — the in-page camera needs a
          secure origin, and over plain HTTP typing is the only way through. */}
      <AnimatePresence>
        {scanOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { setScanOpen(false); setScanError(null); }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center"
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
              onClick={e => e.stopPropagation()}
              className="bg-card w-full max-w-md rounded-t-2xl border-t border-border p-4 pb-8 space-y-3"
            >
              <div className="flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-primary shrink-0" />
                <h3 className="text-sm font-semibold text-foreground flex-1">Scan the price tag</h3>
                <button onClick={() => { setScanOpen(false); setScanError(null); }} aria-label="Close"
                        className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <BarcodeScanner value="" onChange={addScanned} autoStart />

              {scanBusy && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Looking that up…
                </p>
              )}

              {scanError && (
                <p className="text-[11px] text-warning bg-warning/[0.07] border border-warning/25
                              rounded-lg px-3 py-2">
                  {scanError}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}

        {/* One of the customer's own orders, line by line — the same columns as
            the Sales Order document they are handed, so the phone and the paper
            agree. Read-only: what was ordered is a record, not a form. */}
        {openOrder && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpenOrder(null)}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center"
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
              onClick={e => e.stopPropagation()}
              className="bg-card w-full max-w-md rounded-t-2xl border-t border-border
                         max-h-[86vh] flex flex-col"
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                <FileText className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground truncate">
                    {openOrder.order_number}
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(openOrder.created_at).toLocaleDateString('en-IN',
                      { day: 'numeric', month: 'long', year: 'numeric' })}
                    {openOrder.status_code === 'confirmed' ? ' · Confirmed' : ' · With our team'}
                  </p>
                </div>
                <button onClick={() => setOpenOrder(null)} aria-label="Close"
                        className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 divide-y divide-border">
                {openOrder.items.map(it => (
                  <div key={it.line_number} className="flex gap-3 px-4 py-3">
                    <div className="w-12 h-14 rounded-md bg-secondary shrink-0 overflow-hidden
                                    flex items-center justify-center">
                      {it.image_path || it.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image_path
                                    ? `${API_BASE}/uploads/${it.image_path}`
                                    : it.image_url!}
                             alt={it.barcode ?? ''} className="w-full h-full object-cover" />
                      ) : (
                        <ShoppingBag className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {it.name || it.barcode}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {[it.size && `Size ${it.size}`, it.colour, it.fabric]
                          .filter(Boolean).join(' · ')}
                      </p>
                      {it.customization && (
                        <p className="text-[10px] text-muted-foreground italic mt-0.5">
                          {it.customization}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-foreground tabular">
                        {it.amount != null ? money(it.amount) : '—'}
                      </p>
                      <p className="text-[10px] text-muted-foreground tabular">
                        {it.pieces} × {it.rate != null ? money(it.rate) : '—'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-4 py-3 border-t border-border shrink-0 space-y-2">
                {openOrder.notes && (
                  <p className="text-[10px] text-muted-foreground italic">{openOrder.notes}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Order total</span>
                  <span className="text-base font-bold text-foreground tabular">
                    {money(openOrder.total)}
                  </span>
                </div>
                {/* Advance, balance and coupons are deliberately absent — a CRR
                    sets them from what was actually collected, and a figure the
                    customer cannot verify at the stall starts an argument. */}
                <p className="text-[10px] text-muted-foreground">
                  Our team will confirm the advance and coupons with you at the counter.
                </p>

                {/* Only while it is still with our team. Once confirmed a Sales
                    Order has been issued, and the server refuses the change. */}
                {openOrder.status_code === 'draft' && (
                  <button
                    type="button"
                    onClick={() => editPastOrder(openOrder)}
                    className="w-full h-10 rounded-lg border border-primary/40 text-primary
                               text-sm font-medium inline-flex items-center justify-center gap-2
                               hover:bg-primary/5 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Change this order
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}

/**
 * Two layouts, because this page is two different things.
 *
 * `centered` is the front door — one logo, one card, one action, sitting in the
 * middle of the screen exactly like the staff sign-in. Left top-aligned it
 * stranded the card against a screenful of empty space on anything taller than
 * a phone.
 *
 * The default is the working view: a list that scrolls and therefore has to
 * start at the top. min-h-screen rather than h-screen in both, so a centred
 * column that outgrows the viewport pushes the page taller instead of having
 * its top clipped out of reach.
 */
function Shell({ children, exhibition, centered = false }: {
  children: React.ReactNode;
  exhibition?: ExhibitionInfo | null;
  centered?: boolean;
}) {
  if (centered) {
    return (
      <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
        {/* The same soft wash as the staff sign-in — a paper palette that a
            saturated background would fight. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-24 w-[420px] h-[420px] rounded-full bg-primary/[0.06] blur-3xl" />
          <div className="absolute -bottom-40 -left-24 w-[380px] h-[380px] rounded-full bg-primary/[0.04] blur-3xl" />
        </div>
        <div className="relative w-full max-w-sm">{children}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-6">
        {exhibition && (
          <div className="flex items-center gap-2 mb-5">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <Store className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{exhibition.name}</p>
              {exhibition.location && (
                <p className="text-[11px] text-muted-foreground truncate">{exhibition.location}</p>
              )}
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Size / colour as multi-select chips rather than a dropdown.
 *
 * Multi-select because a customer often wants one design in two sizes. Chips
 * rather than a select because the options come from a single barcode — rarely
 * more than a handful — and tapping a visible chip beats opening a picker,
 * scrolling it and closing it on a phone.
 */
function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  // This page runs on the visitor's own phone, so the keypad matters more here
  // than anywhere else in the app.
  if (type === 'number') {
    return (
      <NumberInput
        value={value}
        onValueChange={onChange}
        mode="integer"
        maxLength={4}
        placeholder={placeholder}
        enterKeyHint="next"
        className="h-11"
      />
    );
  }

  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      enterKeyHint="next"
      className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm
                 focus:outline-none focus:ring-2 focus:ring-ring/30"
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
      className="w-full h-13 py-3.5 rounded-xl bg-primary text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:bg-muted-foreground/40 transition-colors"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : children}
    </button>
  );
}
