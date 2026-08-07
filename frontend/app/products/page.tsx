'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Package, Plus, Search, X, Loader2, Pencil, Trash2, ImageIcon, Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import {
  PRODUCT_TYPES, PRODUCT_CATEGORIES, takesCategory, takesSize,
  type Product, type SaveProductRequest,
} from '@/lib/types';
import { money, splitCsv } from '@/lib/orders';
import { Button } from '@/components/ui/button';
import BarcodeScanner from '@/components/BarcodeScanner';

const blankForm = (): SaveProductRequest => ({
  barcode: '',
  product_type: 'Saree',
  category: null,
  size: null,
  colour: '',
  fabric: '',
  price: 0,
  name: '',
});

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SaveProductRequest>(blankForm());
  const [priceText, setPriceText] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canManage = hasPermission('manage_products');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.searchProducts({
        search: search || undefined,
        product_type: typeFilter || undefined,
        limit: 200,
      });
      setProducts(res.products);
    } catch {
      toast.error('Could not load products');
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter]);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    const t = setTimeout(load, search ? 300 : 0);   // debounce typing
    return () => clearTimeout(t);
  }, [load, router, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setPriceText('');
    setPendingImage(null);
    setImagePreview(null);
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      barcode: p.barcode,
      product_type: p.product_type,
      category: p.category ?? null,
      size: p.size ?? null,
      colour: p.colour ?? '',
      fabric: p.fabric ?? '',
      price: p.price,
      name: p.name ?? '',
    });
    setPriceText(String(p.price ?? ''));
    setPendingImage(null);
    setImagePreview(p.image_path ? api.uploadUrl(p.image_path) : null);
    setShowForm(true);
  };

  // Changing the type or category can invalidate fields the new shape doesn't
  // allow, so clear them rather than silently submitting values the server
  // will reject.
  const setType = (product_type: string) => {
    setForm(f => ({
      ...f,
      product_type,
      category: takesCategory(product_type) ? (f.category ?? 'Readymade') : null,
      size: takesSize(product_type, takesCategory(product_type) ? f.category : null) ? f.size : null,
    }));
  };

  const setCategory = (category: string) => {
    setForm(f => ({ ...f, category, size: category === 'Readymade' ? f.size : null }));
  };

  const pickImage = (file: File | null) => {
    setPendingImage(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const save = async () => {
    if (!form.barcode.trim()) { toast.error('Barcode is required'); return; }

    const price = parseFloat(priceText);
    if (!Number.isFinite(price) || price < 0) { toast.error('Enter a valid price'); return; }

    if (takesCategory(form.product_type) && !form.category) {
      toast.error('Choose Stitched or Readymade'); return;
    }
    if (takesSize(form.product_type, form.category) && !form.size?.trim()) {
      toast.error('Readymade items need a size'); return;
    }

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
    <div className="px-4 md:px-6 py-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
          <Package className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-900">Product Master</h1>
          <p className="text-[11px] text-slate-400">
            {products.length} product{products.length === 1 ? '' : 's'} · barcodes resolve at the counter and on the customer&apos;s phone
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openCreate} className="gap-1.5 h-9 text-xs shrink-0">
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Barcode, name, colour or fabric"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-sm"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm"
        >
          <option value="">All types</option>
          {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Package className="w-10 h-10 text-slate-200" />
          <p className="text-sm text-slate-400">No products yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {products.map(p => (
            <div key={p.product_id}
                 className="rounded-xl border border-slate-200 bg-white p-3 flex gap-3">
              <div className="w-16 h-20 rounded-lg bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
                {p.image_path
                  ? <img src={api.uploadUrl(p.image_path)} alt={p.barcode} className="w-full h-full object-cover" />
                  : <ImageIcon className="w-5 h-5 text-slate-300" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {p.name || p.product_type}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400 truncate">{p.barcode}</p>
                  </div>
                  <span className="text-sm font-bold text-slate-900 shrink-0">{money(p.price)}</span>
                </div>

                <div className="flex flex-wrap gap-1 mt-1.5">
                  <Chip>{p.product_type}</Chip>
                  {p.category && <Chip tone="blue">{p.category}</Chip>}
                  {/* One chip per value — a design in four sizes should read as
                      four options, not one run-on string. */}
                  {splitCsv(p.size).map(s => <Chip key={`s-${s}`}>{s}</Chip>)}
                  {splitCsv(p.colour).map(c => <Chip key={`c-${c}`}>{c}</Chip>)}
                  {p.fabric && <Chip>{p.fabric}</Chip>}
                </div>

                {canManage && (
                  <div className="flex gap-1 mt-2">
                    <button onClick={() => openEdit(p)}
                            className="text-[11px] text-slate-500 hover:text-blue-600 flex items-center gap-1">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => remove(p)}
                            className="text-[11px] text-slate-400 hover:text-rose-600 flex items-center gap-1 ml-3">
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
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
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
                <h2 className="text-base font-bold text-slate-900">
                  {editing ? 'Edit product' : 'Add product'}
                </h2>
                <button onClick={() => setShowForm(false)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-3">
                <BarcodeScanner
                  label="Barcode"
                  value={form.barcode}
                  onChange={v => setForm(f => ({ ...f, barcode: v }))}
                />

                <Field label="Type">
                  <div className="flex gap-2">
                    {PRODUCT_TYPES.map(t => (
                      <button key={t} onClick={() => setType(t)}
                        className={`flex-1 h-10 rounded-lg text-sm font-medium transition-colors ${
                          form.product_type === t
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Sarees carry neither category nor size */}
                {takesCategory(form.product_type) && (
                  <Field label="Category">
                    <div className="flex gap-2">
                      {PRODUCT_CATEGORIES.map(c => (
                        <button key={c} onClick={() => setCategory(c)}
                          className={`flex-1 h-10 rounded-lg text-sm font-medium transition-colors ${
                            form.category === c
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}

                {takesSize(form.product_type, form.category) ? (
                  <CsvInput label="Sizes" value={form.size ?? ''}
                            onChange={v => setForm(f => ({ ...f, size: v }))}
                            placeholder="38, 40, 42"
                            hint="Every size this design comes in, comma separated" />
                ) : takesCategory(form.product_type) && form.category === 'Stitched' ? (
                  <p className="text-[11px] text-slate-400">Stitched items are made to measure — no size.</p>
                ) : null}

                <CsvInput label="Colours" value={form.colour ?? ''}
                          onChange={v => setForm(f => ({ ...f, colour: v }))}
                          placeholder="Navy, Black, Maroon"
                          hint="Every colour this design comes in, comma separated" />

                <Input label="Fabric" value={form.fabric ?? ''}
                       onChange={v => setForm(f => ({ ...f, fabric: v }))} />

                <div className="grid grid-cols-2 gap-3">
                  <Input label="Price (₹)" value={priceText} onChange={setPriceText}
                         type="number" placeholder="0" />
                  <Input label="Name (optional)" value={form.name ?? ''}
                         onChange={v => setForm(f => ({ ...f, name: v }))} />
                </div>

                <Field label="Photo">
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-20 rounded-lg bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {imagePreview
                        ? <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                        : <ImageIcon className="w-5 h-5 text-slate-300" />}
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

              <div className="flex gap-2 px-5 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
                <Button variant="outline" onClick={() => setShowForm(false)}
                        disabled={saving} className="flex-1 h-10 text-sm">Cancel</Button>
                <Button onClick={save} disabled={saving} className="flex-1 h-10 gap-1.5 text-sm">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editing ? 'Save' : 'Add product'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chip({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'blue' }) {
  const styles = tone === 'blue'
    ? 'bg-blue-50 text-blue-700'
    : 'bg-slate-100 text-slate-600';
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${styles}`}>{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-slate-500 font-medium">{label}</span>
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
      <span className="text-slate-500 font-medium">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm"
      />
      {parsed.length > 0 ? (
        <span className="flex flex-wrap gap-1 mt-1.5">
          {parsed.map(v => (
            <span key={v} className="text-[10px] font-medium bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
              {v}
            </span>
          ))}
          <span className="text-[10px] text-slate-400 self-center ml-0.5">
            {parsed.length} option{parsed.length === 1 ? '' : 's'}
          </span>
        </span>
      ) : hint ? (
        <span className="text-[10px] text-slate-400 mt-1 block">{hint}</span>
      ) : null}
    </label>
  );
}

function Input({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-slate-500 font-medium">{label}</span>
      <input
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm"
      />
    </label>
  );
}
