'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Package, Plus, Search, X, Loader2, Pencil, Trash2, ImageIcon, Upload,
  FileSpreadsheet, Download, FileDown, AlertTriangle, CheckSquare, Square,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import { usePermission } from '@/lib/usePermission';
import { type Product, type SaveProductRequest } from '@/lib/types';
import { money, splitCsv } from '@/lib/orders';
import { Button } from '@/components/ui/button';
import BarcodeScanner from '@/components/BarcodeScanner';
import PageHeader from '@/components/PageHeader';
import { NumberInput } from '@/components/ui/number-input';
import ProductImportDialog from '@/components/ProductImportDialog';
import { downloadTemplate, exportProducts } from '@/lib/productImport';

const blankForm = (): SaveProductRequest => ({
  barcode: '',
  size: '',
  colour: '',
  fabric: '',
  price: 0,
  name: '',
  image_url: '',
  colour_is_set: false,
  size_is_set: false,
});

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SaveProductRequest>(blankForm());
  const [priceText, setPriceText] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * A live product already using the barcode being typed.
   *
   * The database will refuse the clash regardless — UQ_Products_Barcode is
   * unique over the active rows — but finding out at Save means retyping a
   * whole form. Worse, the operator usually wants that existing design rather
   * than a second copy of it, so the warning offers to open it instead.
   */
  const [duplicate, setDuplicate] = useState<Product | null>(null);

  const canManage = usePermission('manage_products');

  // Retry image download — a product with a link but no stored picture (the
  // download failed at import time, often because the file was not shared
  // publicly yet, or simply predates the Drive API key being configured).
  // Sent in chunks of 10 rather than all at once: a large selection would
  // otherwise fire dozens of Drive fetches from one request, risking a
  // timeout or a burst of load with no visible progress in between.
  const [retrySelected, setRetrySelected] = useState<Set<number>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [retryProgress, setRetryProgress] = useState<{ done: number; total: number } | null>(null);
  const RETRY_CHUNK = 10;

  const missingImageProducts = products.filter(p => p.image_url && !p.image_path);

  const toggleRetrySelect = (productId: number) => {
    setRetrySelected(s => {
      const next = new Set(s);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  };

  const retryImages = async () => {
    const ids = [...retrySelected];
    if (ids.length === 0 || retrying) return;

    setRetrying(true);
    setRetryProgress({ done: 0, total: ids.length });
    let fixed = 0, failed = 0;
    try {
      for (let i = 0; i < ids.length; i += RETRY_CHUNK) {
        const chunk = ids.slice(i, i + RETRY_CHUNK);
        try {
          const res = await api.retryProductImages(chunk);
          fixed += res.results.filter(r => r.ok).length;
          failed += res.results.filter(r => !r.ok).length;
        } catch {
          failed += chunk.length;
        }
        setRetryProgress({ done: Math.min(i + RETRY_CHUNK, ids.length), total: ids.length });
      }
    } finally {
      toast.success(
        `${fixed} image${fixed === 1 ? '' : 's'} fixed` +
        (failed > 0 ? ` — ${failed} still couldn't be downloaded` : '')
      );
      setRetrySelected(new Set());
      setRetrying(false);
      setRetryProgress(null);
      await load();
    }
  };

  // A hardcoded ceiling here is a bug waiting for the catalogue to outgrow it
  // again — this was 200, then 500, silently truncating both times. 2000
  // covers years of growth for a catalogue this size, and totalCount (the
  // server's real count, not products.length) makes truncation visible
  // instead of silent if it is ever hit anyway.
  const FETCH_LIMIT = 2000;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.searchProducts({
        search: search || undefined,
        limit: FETCH_LIMIT,
      });
      setProducts(res.products);
      setTotalCount(res.count);
    } catch {
      toast.error('Could not load products');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    const t = setTimeout(load, search ? 300 : 0);   // debounce typing
    return () => clearTimeout(t);
  }, [load, router, search]);

  // Looks the barcode up as it is typed. Debounced, because a scanner delivers
  // a long code one character at a time and would otherwise fire a request per
  // digit.
  useEffect(() => {
    if (!showForm) { setDuplicate(null); return; }

    const code = form.barcode.trim();
    // Editing a product keeps its own barcode — that is not a clash.
    if (!code || code.toLowerCase() === editing?.barcode.toLowerCase()) {
      setDuplicate(null);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const found = await api.getProductByBarcode(code);
        // Guard against a slow reply landing after the operator typed on.
        if (!cancelled && found && found.product_id !== editing?.product_id) {
          setDuplicate(found);
        }
      } catch {
        // 404 is the normal answer for a new barcode, not a failure.
        if (!cancelled) setDuplicate(null);
      }
    }, 350);

    return () => { cancelled = true; clearTimeout(t); };
  }, [form.barcode, editing, showForm]);

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setPriceText('');
    setPendingImage(null);
    setImagePreview(null);
    setDuplicate(null);
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      barcode: p.barcode,
      size: p.size ?? '',
      colour: p.colour ?? '',
      fabric: p.fabric ?? '',
      price: p.price,
      name: p.name ?? '',
      image_url: p.image_url ?? '',
      colour_is_set: p.colour_is_set,
      size_is_set: p.size_is_set,
    });
    setPriceText(String(p.price ?? ''));
    setPendingImage(null);
    setImagePreview(p.image_path ? api.uploadUrl(p.image_path) : null);
    setDuplicate(null);
    setShowForm(true);
  };

  const pickImage = (file: File | null) => {
    setPendingImage(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const save = async () => {
    if (!form.barcode.trim()) { toast.error('Barcode is required'); return; }

    // The server enforces this too, but stopping here keeps the form and its
    // half-entered colours rather than bouncing back an error over a lost one.
    if (duplicate) {
      toast.error(`${duplicate.barcode} already exists — edit that product instead`);
      return;
    }

    const price = parseFloat(priceText);
    if (!Number.isFinite(price) || price < 0) { toast.error('Enter a valid price'); return; }

    setSaving(true);
    try {
      const payload: SaveProductRequest = { ...form, price };
      const res = editing
        ? await api.updateProduct(editing.product_id, payload)
        : await api.createProduct(payload);

      const productId = editing ? editing.product_id : (res as any).product_id;
      if (pendingImage) {
        try { await api.uploadProductImage(productId, pendingImage); }
        catch { toast.error('Product saved, but the image failed to upload'); }
      }

      toast.success(editing ? 'Product updated' : 'Product added');
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save the product');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Product) => {
    if (!confirm(`Remove ${p.barcode} from the catalogue? Past orders keep their details.`)) return;
    try {
      await api.deactivateProduct(p.product_id);
      toast.success('Product removed');
      await load();
    } catch {
      toast.error('Could not remove the product');
    }
  };

  return (
    <>
      <PageHeader
        icon={Package}
        title="Product Master"
        subtitle={`${totalCount} product${totalCount === 1 ? '' : 's'} · barcodes resolve at the counter and on the customer's phone`}
        actions={(
          <div className="flex items-center gap-1.5">
            {/* Export and Template need no write permission — they only read
                what is already on screen, or produce a blank file. */}
            <Button size="sm" variant="ghost" onClick={downloadTemplate}
                    className="gap-1.5 h-9 text-xs" title="Blank sheet with the expected columns">
              <FileDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Template</span>
            </Button>
            <Button size="sm" variant="ghost" disabled={exporting}
                    onClick={async () => {
                      if (totalCount === 0) { toast.error('Nothing to export yet'); return; }
                      // Exports whatever the catalogue actually is, not just
                      // what happened to be loaded on screen — the two can
                      // differ if a search is narrowing the current view, or
                      // if the catalogue ever outgrows FETCH_LIMIT.
                      setExporting(true);
                      try {
                        const full = totalCount <= products.length
                          ? products
                          : (await api.searchProducts({ search: search || undefined, limit: totalCount })).products;
                        exportProducts(full);
                      } catch {
                        toast.error('Could not export the catalogue');
                      } finally {
                        setExporting(false);
                      }
                    }}
                    className="gap-1.5 h-9 text-xs" title="Download the catalogue as Excel">
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Export</span>
            </Button>
            {canManage && (
              <>
                <Button size="sm" variant="outline" onClick={() => setShowImport(true)}
                        className="gap-1.5 h-9 text-xs">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Import</span>
                </Button>
                <Button size="sm" onClick={openCreate} className="gap-1.5 h-9 text-xs">
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </>
            )}
          </div>
        )}
      />

      <ProductImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={load}
      />

      <div className="px-4 md:px-6 py-4 space-y-3">
      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-muted-foreground/50 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Barcode, name, colour or fabric"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-sm"
          />
        </div>
        {canManage && missingImageProducts.length > 0 && (
          <Button
            size="sm" variant="outline"
            onClick={() => setRetrySelected(new Set(missingImageProducts.map(p => p.product_id)))}
            className="gap-1.5 h-10 text-xs shrink-0"
            title="Select every currently-loaded product with a link but no picture"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Missing images</span> ({missingImageProducts.length})
          </Button>
        )}
      </div>

      {/* Catches the catalogue outgrowing FETCH_LIMIT — shown instead of
          silently displaying (and, before this, exporting) a partial list. */}
      {!loading && !search && products.length < totalCount && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-[11px] text-foreground">
            Showing {products.length} of {totalCount} products — search to narrow the list. The catalogue has outgrown what this page loads at once; ask support to raise the limit.
          </p>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" /></div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Package className="w-10 h-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No products yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {products.map(p => (
            <div key={p.product_id}
                 className="rounded-xl border border-border bg-card p-3 flex gap-3">
              <div className="relative w-16 h-20 rounded-lg bg-secondary shrink-0 overflow-hidden flex items-center justify-center">
                {/* The local upload wins: it is the copy the Sales Order PDF
                    embeds, so what staff see here is what the customer gets. */}
                {p.image_path || p.image_url
                  ? <img src={p.image_path ? api.uploadUrl(p.image_path) : p.image_url!}
                         alt={p.barcode} className="w-full h-full object-cover" />
                  : <ImageIcon className="w-5 h-5 text-muted-foreground/50" />}
                {/* A marker that fabric info exists, not the value — same as the
                    chip below, by request. */}
                {p.fabric && (p.image_path || p.image_url) && (
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[8px] text-center py-0.5">
                    Fabric
                  </span>
                )}
                {/* A link that never became a stored picture — the one thing
                    this checkbox is for. Nothing to retry for a product with
                    no link, or one that already has an image. */}
                {canManage && p.image_url && !p.image_path && (
                  <button
                    type="button"
                    onClick={() => toggleRetrySelect(p.product_id)}
                    aria-label={retrySelected.has(p.product_id) ? 'Deselect' : 'Select to retry its image'}
                    className="absolute top-0.5 left-0.5 p-0.5 rounded bg-card/90 hover:bg-card"
                  >
                    {retrySelected.has(p.product_id)
                      ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
                      : <Square className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {p.name || p.barcode}
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground truncate">{p.barcode}</p>
                  </div>
                  <span className="text-sm font-bold text-foreground shrink-0">{money(p.price)}</span>
                </div>

                <div className="flex flex-wrap gap-1 mt-1.5">
                  {/* One chip per value — a design in four sizes should read as
                      four options, not one run-on string. A set ships whole, so
                      say so rather than let it look like a list of choices. */}
                  {p.size_is_set && <Chip tone="blue">Size set</Chip>}
                  {p.colour_is_set && <Chip tone="blue">Colour set</Chip>}
                  {/* No SIZE at all is not a gap — it is the signal for unstitched
                      material, which never carries a size. See Product.cs. */}
                  {splitCsv(p.size).length === 0 && <Chip tone="blue">Unstitched</Chip>}
                  {splitCsv(p.size).map(s => <Chip key={`s-${s}`}>{s}</Chip>)}
                  {splitCsv(p.colour).map(c => <Chip key={`c-${c}`}>{c}</Chip>)}
                  {p.fabric && <Chip>Fabric</Chip>}
                </div>

                {canManage && (
                  <div className="flex gap-1 mt-2">
                    <button onClick={() => openEdit(p)}
                            className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => remove(p)}
                            className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-1 ml-3">
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {retrySelected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2
                        bg-card border border-border rounded-full shadow-lg px-3 py-2">
          <span className="text-xs font-medium text-foreground pl-1.5">
            {retrySelected.size} selected
          </span>
          <Button
            size="sm" disabled={retrying} onClick={retryImages}
            className="h-8 gap-1.5 text-xs rounded-full"
          >
            {retrying
              ? <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {retryProgress ? `${retryProgress.done}/${retryProgress.total}` : 'Retrying…'}
                </>
              : <><RefreshCw className="w-3.5 h-3.5" /> Retry images</>}
          </Button>
          <button
            onClick={() => setRetrySelected(new Set())} disabled={retrying}
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 pr-1.5"
          >
            Clear
          </button>
        </div>
      )}

      {/* Create / edit */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => !saving && setShowForm(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
                <h2 className="text-base font-bold text-foreground">
                  {editing ? 'Edit product' : 'Add product'}
                </h2>
                <button onClick={() => setShowForm(false)}
                        className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-3">
                <BarcodeScanner
                  label="Barcode"
                  value={form.barcode}
                  onChange={v => setForm(f => ({ ...f, barcode: v }))}
                />

                {/* A barcode identifies one design, so a second product on the
                    same code is almost always someone re-adding what is already
                    there. Offer that product rather than just refusing. */}
                {duplicate && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/30
                                  bg-warning/[0.08] px-3 py-2.5 -mt-1">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-px" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground">
                        {duplicate.barcode} is already in the catalogue
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {[duplicate.name, duplicate.colour, money(duplicate.price)]
                          .filter(Boolean).join(' · ')}
                      </p>
                      <button
                        type="button"
                        onClick={() => openEdit(duplicate)}
                        className="text-[11px] font-medium text-primary hover:underline mt-1"
                      >
                        Edit that product instead
                      </button>
                    </div>
                  </div>
                )}

                <CsvInput label="Sizes" value={form.size ?? ''}
                          onChange={v => setForm(f => ({ ...f, size: v }))}
                          placeholder="38, 40, 42"
                          hint="Every size this design comes in, comma separated" />
                <SetToggle checked={!!form.size_is_set}
                           onChange={v => setForm(f => ({ ...f, size_is_set: v }))}
                           label="Sizes ship as a set"
                           hint="All sizes together — the customer cannot pick one" />

                <CsvInput label="Colours" value={form.colour ?? ''}
                          onChange={v => setForm(f => ({ ...f, colour: v }))}
                          placeholder="Navy, Black, Maroon"
                          hint="Every colour this design comes in, comma separated" />
                <SetToggle checked={!!form.colour_is_set}
                           onChange={v => setForm(f => ({ ...f, colour_is_set: v }))}
                           label="Colours ship as a set"
                           hint="All colours together — the customer cannot pick one" />

                <Input label="Fabric" value={form.fabric ?? ''}
                       onChange={v => setForm(f => ({ ...f, fabric: v }))} />

                {/* Carried on the form even though it is normally set by the
                    import, because the save writes it: leaving it out would
                    blank an imported link every time someone edited a price. */}
                <Input label="Image link (optional)" value={form.image_url ?? ''}
                       onChange={v => setForm(f => ({ ...f, image_url: v }))}
                       placeholder="https://…" />

                <div className="grid grid-cols-2 gap-3">
                  <Input label="Price (₹)" value={priceText} onChange={setPriceText}
                         type="number" placeholder="0" />
                  <Input label="Name (optional)" value={form.name ?? ''}
                         onChange={v => setForm(f => ({ ...f, name: v }))} />
                </div>

                <Field label="Photo">
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-20 rounded-lg bg-secondary overflow-hidden shrink-0 flex items-center justify-center">
                      {imagePreview
                        ? <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                        : <ImageIcon className="w-5 h-5 text-muted-foreground/50" />}
                    </div>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
                           className="hidden"
                           onChange={e => pickImage(e.target.files?.[0] ?? null)} />
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}
                            className="h-9 gap-1.5 text-xs">
                      <Upload className="w-3.5 h-3.5" /> {imagePreview ? 'Change' : 'Upload'}
                    </Button>
                  </div>
                </Field>
              </div>

              <div className="flex gap-2 px-5 py-4 border-t border-border sticky bottom-0 bg-card">
                <Button variant="outline" onClick={() => setShowForm(false)}
                        disabled={saving} className="flex-1 h-10 text-sm">Cancel</Button>
                <Button onClick={save} disabled={saving || duplicate !== null}
                        title={duplicate ? `${duplicate.barcode} already exists` : undefined}
                        className="flex-1 h-10 gap-1.5 text-sm">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editing ? 'Save' : 'Add product'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </>
  );
}

function Chip({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'blue' }) {
  const styles = tone === 'blue'
    ? 'bg-primary/10 text-primary'
    : 'bg-secondary text-muted-foreground';
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${styles}`}>{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Comma-separated list input, with the parsed values shown as chips.
 *
 * The chips are the point: "38,40 ,42" and "38, 40, 42" look different while
 * typing but store identically, and seeing how the text actually parses is the
 * only way to catch a stray comma before it becomes a phantom size on the order
 * page dropdown.
 */
function CsvInput({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string;
}) {
  const parsed = splitCsv(value);
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground font-medium">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
      />
      {parsed.length > 0 ? (
        <span className="flex flex-wrap gap-1 mt-1.5">
          {parsed.map(v => (
            <span key={v} className="text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {v}
            </span>
          ))}
          <span className="text-[10px] text-muted-foreground self-center ml-0.5">
            {parsed.length} option{parsed.length === 1 ? '' : 's'}
          </span>
        </span>
      ) : hint ? (
        <span className="text-[10px] text-muted-foreground mt-1 block">{hint}</span>
      ) : null}
    </label>
  );
}

function Input({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground font-medium">{label}</span>
      {type === 'number' ? (
        <NumberInput mode="decimal" value={value} onValueChange={onChange}
                     placeholder={placeholder} className="mt-1" />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm
                     focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      )}
    </label>
  );
}

/**
 * A set is the catalogue's bracketed list: "(M,L,XL,2XL)" means all four sizes
 * ship together, not that the customer picks one. It is a property of how the
 * design is sold rather than a field on it, so it reads as a statement the user
 * agrees with instead of a value they fill in.
 */
function SetToggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none -mt-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 shrink-0 rounded border-border accent-primary cursor-pointer"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-foreground">{label}</span>
        {hint && <span className="block text-[10px] text-muted-foreground mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}
