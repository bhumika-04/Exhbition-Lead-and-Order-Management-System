'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import { usePermission } from '@/lib/usePermission';
import type { Exhibition } from '@/lib/types';
import { MapPin, Calendar, Plus, CheckCircle2, X, Edit2, Trash2, Loader2, Building2, QrCode } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AnimatedList, AnimatedListItem } from '@/components/ui/animated-list';
import SelfServiceQrCard, { SelfServiceQrInline } from '@/components/SelfServiceQrCard';
import { cn } from '@/lib/utils';

// One hue, varied in weight. Six unrelated gradients made a list of
// exhibitions look like a list of different products.
const EXHIBITION_GRADIENTS = [
  'from-primary to-primary',
  'from-primary/90 to-primary',
  'from-primary/80 to-primary/95',
  'from-primary/70 to-primary/90',
  'from-primary/85 to-primary',
  'from-primary/75 to-primary/95',
];

export default function ExhibitionsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingExhibition, setEditingExhibition] = useState<Exhibition | null>(null);
  const [deletingExhibition, setDeletingExhibition] = useState<Exhibition | null>(null);
  /** Exhibition whose full printable QR is open, if any. */
  const [qrFor, setQrFor] = useState<Exhibition | null>(null);

  const [formData, setFormData] = useState({
    name: '', location: '', start_date: '', end_date: '', description: '',
  });

  const canManage = usePermission('manage_exhibitions');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('view_exhibitions')) { router.replace('/access-denied?from=/exhibitions'); return; }
    const stored = localStorage.getItem('selected_exhibition');
    if (stored) setSelectedId(parseInt(stored));
    loadExhibitions();
  }, [mounted, router]);

  const loadExhibitions = async () => {
    try { setExhibitions(await api.getExhibitions()); }
    catch { console.error('Failed to load exhibitions'); }
    finally { setLoading(false); }
  };

  const selectExhibition = (id: number) => {
    localStorage.setItem('selected_exhibition', id.toString());
    setSelectedId(id);
    setTimeout(() => router.push('/leads'), 300);
  };

  const handleCreateExhibition = async () => {
    if (!formData.name || !formData.start_date || !formData.end_date) {
      toast.error('Please fill in all required fields'); return;
    }
    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      toast.error('End date must be after start date'); return;
    }
    setCreating(true);
    try {
      await api.createExhibition({
        name: formData.name, location: formData.location || undefined,
        start_date: formData.start_date, end_date: formData.end_date,
        description: formData.description || undefined,
      });
      toast.success('Exhibition created!');
      setShowCreateModal(false);
      setFormData({ name: '', location: '', start_date: '', end_date: '', description: '' });
      loadExhibitions();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to create exhibition');
    } finally { setCreating(false); }
  };

  const openEditModal = (exhibition: Exhibition, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingExhibition(exhibition);
    setFormData({
      name: exhibition.name, location: exhibition.location || '',
      start_date: format(new Date(exhibition.start_date), 'yyyy-MM-dd'),
      end_date: format(new Date(exhibition.end_date), 'yyyy-MM-dd'),
      description: exhibition.description || '',
    });
    setShowEditModal(true);
  };

  const handleUpdateExhibition = async () => {
    if (!editingExhibition || !formData.name || !formData.start_date || !formData.end_date) {
      toast.error('Please fill in all required fields'); return;
    }
    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      toast.error('End date must be after start date'); return;
    }
    setUpdating(true);
    try {
      await api.updateExhibition(editingExhibition.exhibition_id, {
        name: formData.name, location: formData.location || undefined,
        start_date: formData.start_date, end_date: formData.end_date,
        description: formData.description || undefined,
      });
      toast.success('Exhibition updated!');
      setShowEditModal(false); setEditingExhibition(null);
      setFormData({ name: '', location: '', start_date: '', end_date: '', description: '' });
      loadExhibitions();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update');
    } finally { setUpdating(false); }
  };

  const openDeleteConfirm = (exhibition: Exhibition, e: React.MouseEvent) => {
    e.stopPropagation(); setDeletingExhibition(exhibition); setShowDeleteConfirm(true);
  };

  const handleDeleteExhibition = async () => {
    if (!deletingExhibition?.exhibition_id) { toast.error('Invalid exhibition data'); return; }
    setDeleting(true);
    try {
      await api.deleteExhibition(deletingExhibition.exhibition_id);
      toast.success('Exhibition deleted!');
      setShowDeleteConfirm(false); setDeletingExhibition(null);
      if (selectedId === deletingExhibition.exhibition_id) {
        localStorage.removeItem('selected_exhibition'); setSelectedId(null);
      }
      loadExhibitions();
    } catch (err: any) {
      const d = err.response?.data;
      if (d?.lead_count) {
        toast.error(`Cannot delete: ${d.lead_count} lead(s) associated. Please delete or reassign first.`, { duration: 6000 });
      } else {
        toast.error(d?.message || d?.detail || 'Failed to delete');
      }
    } finally { setDeleting(false); }
  };

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground font-medium">Loading exhibitions…</p>
          </div>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full px-3 py-2 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-ring/30 bg-card transition';

  // Inline form fields — do NOT extract as a sub-component here (causes focus loss on each keystroke)
  const formFields = (
    <div className="space-y-3.5">
      <div>
        <label className="text-xs font-semibold text-muted-foreground mb-1 block">Name <span className="text-destructive/70">*</span></label>
        <input type="text" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
          className={inputCls} placeholder="Tech Summit 2025" />
      </div>
      <div>
        <label className="text-xs font-semibold text-muted-foreground mb-1 block">Location</label>
        <input type="text" value={formData.location} onChange={e => setFormData(p => ({ ...p, location: e.target.value }))}
          className={inputCls} placeholder="Mumbai Convention Center" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Start Date <span className="text-destructive/70">*</span></label>
          <input type="date" value={formData.start_date} onChange={e => setFormData(p => ({ ...p, start_date: e.target.value }))}
            className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">End Date <span className="text-destructive/70">*</span></label>
          <input type="date" value={formData.end_date} min={formData.start_date} onChange={e => setFormData(p => ({ ...p, end_date: e.target.value }))}
            className={inputCls} />
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-muted-foreground mb-1 block">Description</label>
        <textarea value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
          rows={3} className={inputCls} placeholder="Brief description…" />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-background">

      {/* ── Header ── */}
      <div className="bg-card/80 backdrop-blur-sm border-b border-border px-4 md:px-6 py-4 md:py-0 shrink-0 md:min-h-[65px] flex items-center">
        <div className="flex items-center justify-between w-full">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-foreground">Exhibitions</h1>
              <span className="bg-primary/12 text-primary text-xs font-bold rounded-full px-2 py-0.5">
                {exhibitions.length}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">Select active exhibition to scan cards</p>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setShowCreateModal(true)} className="gap-1.5 h-8 text-xs px-3">
              <Plus className="w-3.5 h-3.5" /> New
            </Button>
          )}
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {exhibitions.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center mb-4">
              <Building2 className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <p className="font-semibold text-foreground mb-1">No exhibitions yet</p>
            <p className="text-sm text-muted-foreground mb-5">Create your first exhibition to get started</p>
            {canManage && (
              <Button size="sm" onClick={() => setShowCreateModal(true)}>
                <Plus className="w-4 h-4 mr-1.5" />Create Exhibition
              </Button>
            )}
          </motion.div>
        ) : (
          <AnimatedList className="space-y-3">
            {exhibitions.map((ex, idx) => {
              const isSelected = selectedId === ex.exhibition_id;
              const startDate = new Date(ex.start_date);
              const endDate = new Date(ex.end_date);
              const validDates = !isNaN(startDate.getTime()) && !isNaN(endDate.getTime());
              const gradient = EXHIBITION_GRADIENTS[idx % EXHIBITION_GRADIENTS.length];
              const initial = (ex.name || 'E')[0].toUpperCase();

              return (
                <AnimatedListItem key={ex.exhibition_id}>
                  <motion.div
                    whileHover={{ y: -2, boxShadow: '0 8px 30px -4px rgba(0,0,0,0.1)' }}
                    transition={{ duration: 0.15 }}
                    onClick={() => selectExhibition(ex.exhibition_id)}
                    className={cn(
                      'bg-card rounded-2xl border shadow-sm cursor-pointer group relative overflow-hidden transition-all',
                      isSelected ? 'border-primary/30 ring-2 ring-ring/30' : 'border-border'
                    )}
                  >
                    {/* Selected accent */}
                    {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}

                    <div className={cn('px-4 py-4', isSelected && 'pl-5')}>
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0 text-white font-bold text-sm', gradient)}>
                          {initial}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold text-foreground truncate">{ex.name}</h3>
                            {ex.is_active && (
                              <Badge className="bg-success/15 text-success border-success/25 text-[10px] h-4 py-0">
                                Active
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge className="bg-primary/12 text-primary border-primary/30 text-[10px] h-4 py-0">
                                Selected
                              </Badge>
                            )}
                          </div>
                          {ex.location && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 shrink-0 text-muted-foreground/50" />{ex.location}
                            </p>
                          )}
                          {validDates && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Calendar className="w-3 h-3 shrink-0 text-muted-foreground/50" />
                              {format(startDate, 'MMM d')} — {format(endDate, 'MMM d, yyyy')}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-primary mr-1" />}
                          {canManage && (
                            <>
                              <button
                                onClick={e => openEditModal(ex, e)}
                                className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-primary hover:bg-primary/10 transition opacity-0 group-hover:opacity-100"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={e => openDeleteConfirm(ex, e)}
                                className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-destructive hover:bg-destructive/[0.07] transition opacity-0 group-hover:opacity-100"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Ordering QR on EVERY exhibition, not just the selected
                          one — it was effectively hidden before, since nothing
                          on the card suggested selecting it would reveal one.
                          Kept to a single compact strip so a long list stays
                          scannable; the full printable code opens in a dialog. */}
                      {canManage && (
                        <div className="mt-3 pt-3 border-t border-border" onClick={e => e.stopPropagation()}>
                          <SelfServiceQrInline
                            exhibitionId={ex.exhibition_id}
                            enabled={!!ex.self_service_enabled}
                            token={ex.public_token}
                            onExpand={() => setQrFor(ex)}
                            onChange={(enabled, token) =>
                              setExhibitions(list => list.map(e =>
                                e.exhibition_id === ex.exhibition_id
                                  ? { ...e, self_service_enabled: enabled, public_token: token }
                                  : e))}
                          />
                        </div>
                      )}
                    </div>
                  </motion.div>
                </AnimatedListItem>
              );
            })}
          </AnimatedList>
        )}
        <div className="md:hidden h-20" />
      </div>

      {/* ── Create Modal ── */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card rounded-2xl shadow-2xl max-w-md w-full"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <h2 className="text-base font-bold text-foreground">Create Exhibition</h2>
                  <p className="text-xs text-muted-foreground">Add a new exhibition event</p>
                </div>
                <button onClick={() => setShowCreateModal(false)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-muted-foreground transition">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-5">
                {formFields}
              </div>
              <div className="flex gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" className="flex-1" onClick={() => setShowCreateModal(false)} disabled={creating}>Cancel</Button>
                <Button className="flex-1" onClick={handleCreateExhibition} disabled={creating || !formData.name || !formData.start_date || !formData.end_date}>
                  {creating ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Creating…</> : <>Create</>}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Edit Modal ── */}
      <AnimatePresence>
        {showEditModal && editingExhibition && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card rounded-2xl shadow-2xl max-w-md w-full"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <h2 className="text-base font-bold text-foreground">Edit Exhibition</h2>
                  <p className="text-xs text-muted-foreground truncate max-w-[200px]">{editingExhibition.name}</p>
                </div>
                <button onClick={() => { setShowEditModal(false); setEditingExhibition(null); setFormData({ name: '', location: '', start_date: '', end_date: '', description: '' }); }}
                  className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-muted-foreground transition">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-5">
                {formFields}
              </div>
              <div className="flex gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" className="flex-1" onClick={() => { setShowEditModal(false); setEditingExhibition(null); setFormData({ name: '', location: '', start_date: '', end_date: '', description: '' }); }} disabled={updating}>Cancel</Button>
                <Button className="flex-1" onClick={handleUpdateExhibition} disabled={updating || !formData.name || !formData.start_date || !formData.end_date}>
                  {updating ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Updating…</> : <>Update</>}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm ── */}
      <AnimatePresence>
        {showDeleteConfirm && deletingExhibition && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card rounded-2xl shadow-2xl max-w-sm w-full p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 bg-destructive/12 rounded-xl flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Delete Exhibition?</h3>
                  <p className="text-xs text-muted-foreground">This cannot be undone</p>
                </div>
              </div>
              <div className="bg-secondary/50 rounded-xl p-3 mb-5 border border-border">
                <p className="text-sm font-semibold text-foreground">{deletingExhibition.name}</p>
                {deletingExhibition.location && <p className="text-xs text-muted-foreground">{deletingExhibition.location}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setShowDeleteConfirm(false); setDeletingExhibition(null); }} disabled={deleting}>Cancel</Button>
                <Button variant="destructive" className="flex-1" onClick={handleDeleteExhibition} disabled={deleting}>
                  {deleting ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Deleting…</> : 'Delete'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* Full printable ordering QR */}
        {qrFor && (
          <motion.div
            key="qr-dialog"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setQrFor(null)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card rounded-xl shadow-lg border border-border max-w-sm w-full
                         max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border sticky top-0 bg-card">
                <QrCode className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground truncate">Ordering QR</h3>
                  <p className="text-[11px] text-muted-foreground truncate">{qrFor.name}</p>
                </div>
                <button onClick={() => setQrFor(null)} aria-label="Close"
                        className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <SelfServiceQrCard
                exhibitionId={qrFor.exhibition_id}
                exhibitionName={qrFor.name}
                enabled={!!qrFor.self_service_enabled}
                token={qrFor.public_token}
                onChange={(enabled, token) => {
                  setExhibitions(list => list.map(e =>
                    e.exhibition_id === qrFor.exhibition_id
                      ? { ...e, self_service_enabled: enabled, public_token: token }
                      : e));
                  // Keep the open dialog in step, otherwise disabling leaves it
                  // showing a code that no longer resolves.
                  setQrFor(prev => prev && { ...prev, self_service_enabled: enabled, public_token: token });
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
