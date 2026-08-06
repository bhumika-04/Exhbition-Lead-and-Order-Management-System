'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Camera, Link2, Trash2, Loader2, X, Upload, Video, Send,
  ShoppingBag, Users, ImageIcon, ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { hasPermission } from '@/lib/auth';
import type { LeadMedia, LeadPhoto } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * The three lead actions — Create Order, Team Photo, Testimonial — plus a strip
 * showing every piece of media attached to the lead in one place.
 */
export default function LeadMediaCard({ leadId }: { leadId: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [media, setMedia] = useState<LeadMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showPhotoLink, setShowPhotoLink] = useState(false);
  const [photoLink, setPhotoLink] = useState('');
  const [showTestimonial, setShowTestimonial] = useState(false);
  const [testimonialUrl, setTestimonialUrl] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);

  const canOrder = hasPermission('manage_orders');

  const load = useCallback(async () => {
    try {
      const m = await api.getLeadMedia(leadId);
      setMedia(m);
      setTestimonialUrl(m.testimonial_url ?? '');
    } catch {
      // A lead with no media is normal — stay quiet.
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const uploadPhoto = async (file: File) => {
    setBusy(true);
    try {
      await api.uploadLeadPhoto(leadId, file);
      toast.success('Photo added');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not upload the photo');
    } finally { setBusy(false); }
  };

  const addLink = async () => {
    if (!photoLink.trim()) { toast.error('Paste a link'); return; }
    setBusy(true);
    try {
      await api.addLeadPhotoLink(leadId, photoLink.trim());
      toast.success('Link added');
      setPhotoLink('');
      setShowPhotoLink(false);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not add the link');
    } finally { setBusy(false); }
  };

  const removePhoto = async (p: LeadPhoto) => {
    if (!confirm('Remove this photo from the lead?')) return;
    try {
      await api.deleteLeadPhoto(p.lead_photo_id);
      await load();
    } catch { toast.error('Could not remove the photo'); }
  };

  const saveTestimonial = async () => {
    setBusy(true);
    try {
      await api.setTestimonial(leadId, testimonialUrl.trim() || null);
      toast.success(testimonialUrl.trim() ? 'Testimonial saved' : 'Testimonial removed');
      setShowTestimonial(false);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save the testimonial');
    } finally { setBusy(false); }
  };

  const sendWhatsApp = async (which: 'welcome' | 'testimonial') => {
    setBusy(true);
    try {
      const res = which === 'welcome'
        ? await api.sendWelcomeWhatsApp(leadId)
        : await api.sendTestimonialWhatsApp(leadId);

      // Skipped is not a failure — it means WhatsApp isn't configured yet.
      if (res.sent) toast.success('WhatsApp sent');
      else if (res.status === 'skipped') toast(`Not sent — ${res.error ?? 'not configured'}`, { icon: 'ℹ️' });
      else toast.error(`Failed — ${res.error ?? 'unknown error'}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not send');
    } finally { setBusy(false); }
  };

  const photoUrl = (p: LeadPhoto) =>
    p.source_type === 'file' && p.file_path ? api.uploadUrl(p.file_path) : p.external_url ?? '';

  const cardImages = [media?.front_image_path, media?.back_image_path].filter(Boolean) as string[];

  return (
    <>
      <Card className="shadow-sm border-slate-100">
        <CardContent className="px-5 py-4 space-y-3">
          {/* Three primary actions */}
          <div className="grid grid-cols-3 gap-2">
            {canOrder && (
              <ActionButton
                icon={ShoppingBag} label="Create Order" tone="blue"
                onClick={() => router.push(`/leads/${leadId}/orders/new`)}
              />
            )}
            <ActionButton
              icon={Camera} label="Team Photo" tone="violet"
              badge={media?.photos.length || undefined}
              onClick={() => fileRef.current?.click()}
              onLongPress={() => setShowPhotoLink(true)}
            />
            <ActionButton
              icon={Video} label="Testimonial" tone={media?.testimonial_url ? 'emerald' : 'slate'}
              onClick={() => setShowTestimonial(true)}
            />
          </div>

          <button
            onClick={() => setShowPhotoLink(true)}
            className="w-full text-[11px] text-slate-400 hover:text-slate-600 flex items-center justify-center gap-1"
          >
            <Link2 className="w-3 h-3" /> or paste a Drive link for the team photo
          </button>

          <input
            ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }}
          />

          {/* Media strip — card images, team photos, testimonial in one place */}
          {loading ? (
            <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-slate-300" /></div>
          ) : (
            <>
              {(cardImages.length > 0 || (media?.photos.length ?? 0) > 0) && (
                <div className="flex gap-2 overflow-x-auto pt-1 pb-1">
                  {cardImages.map(path => (
                    <button key={path} onClick={() => setLightbox(api.uploadUrl(path))}
                            className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 shrink-0 relative group">
                      <img src={api.uploadUrl(path)} alt="Visiting card" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[8px] text-center py-0.5">
                        Card
                      </span>
                    </button>
                  ))}

                  {media?.photos.map(p => (
                    <div key={p.lead_photo_id} className="relative shrink-0 group">
                      {p.source_type === 'file' ? (
                        <button onClick={() => setLightbox(photoUrl(p))}
                                className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 block">
                          <img src={photoUrl(p)} alt="Team" className="w-full h-full object-cover" />
                        </button>
                      ) : (
                        <a href={photoUrl(p)} target="_blank" rel="noopener noreferrer"
                           className="w-16 h-16 rounded-lg bg-slate-100 flex flex-col items-center justify-center gap-0.5">
                          <Link2 className="w-4 h-4 text-slate-400" />
                          <span className="text-[8px] text-slate-400">Drive</span>
                        </a>
                      )}
                      <button
                        onClick={() => removePhoto(p)}
                        aria-label="Remove photo"
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-slate-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-2.5 h-2.5 text-rose-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {media?.testimonial_url && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                  <Video className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <a href={media.testimonial_url} target="_blank" rel="noopener noreferrer"
                     className="text-[11px] text-emerald-800 truncate flex-1 hover:underline">
                    Testimonial link
                  </a>
                  <ExternalLink className="w-3 h-3 text-emerald-500 shrink-0" />
                </div>
              )}
            </>
          )}

          {/* WhatsApp touchpoints */}
          <div className="flex gap-2 pt-1 border-t border-slate-100">
            <Button variant="outline" size="sm" disabled={busy}
                    onClick={() => sendWhatsApp('welcome')}
                    className="flex-1 h-8 gap-1.5 text-[11px]">
              <Send className="w-3 h-3" /> Welcome
            </Button>
            <Button variant="outline" size="sm" disabled={busy || !media?.testimonial_url}
                    onClick={() => sendWhatsApp('testimonial')}
                    className="flex-1 h-8 gap-1.5 text-[11px]">
              <Send className="w-3 h-3" /> Testimonial
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Drive link for a team photo */}
      {showPhotoLink && (
        <Modal title="Team photo link" onClose={() => setShowPhotoLink(false)}>
          <input
            value={photoLink}
            onChange={e => setPhotoLink(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            For WhatsApp to attach it, the file must be shared publicly on Drive.
          </p>
          <div className="flex gap-2 mt-3">
            <Button variant="outline" onClick={() => setShowPhotoLink(false)} className="flex-1 h-9 text-xs">
              Cancel
            </Button>
            <Button onClick={addLink} disabled={busy} className="flex-1 h-9 gap-1.5 text-xs">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add link
            </Button>
          </div>
        </Modal>
      )}

      {/* Testimonial link */}
      {showTestimonial && (
        <Modal title="Testimonial" onClose={() => setShowTestimonial(false)}>
          <input
            value={testimonialUrl}
            onChange={e => setTestimonialUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Paste the Drive link to the testimonial video. Clear the box to remove it.
          </p>
          <div className="flex gap-2 mt-3">
            <Button variant="outline" onClick={() => setShowTestimonial(false)} className="flex-1 h-9 text-xs">
              Cancel
            </Button>
            <Button onClick={saveTestimonial} disabled={busy} className="flex-1 h-9 gap-1.5 text-xs">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Save
            </Button>
          </div>
        </Modal>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)}
             className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </>
  );
}

function ActionButton({ icon: Icon, label, tone, badge, onClick, onLongPress }: {
  icon: any; label: string; tone: 'blue' | 'violet' | 'emerald' | 'slate';
  badge?: number; onClick: () => void; onLongPress?: () => void;
}) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
    violet: 'bg-violet-50 text-violet-700 hover:bg-violet-100',
    emerald: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    slate: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
  };
  return (
    <button
      onClick={onClick}
      onContextMenu={onLongPress ? e => { e.preventDefault(); onLongPress(); } : undefined}
      className={`relative flex flex-col items-center justify-center gap-1 py-3 rounded-xl font-semibold text-[11px] transition-colors ${tones[tone]}`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-white text-[9px] font-bold flex items-center justify-center shadow-sm">
          {badge}
        </span>
      )}
    </button>
  );
}

function Modal({ title, children, onClose }: {
  title: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-slate-900">{title}</p>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
