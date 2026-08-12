'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Camera, Upload, Search, Loader2, Building2, User, X } from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import { useIsMobile } from '@/lib/useIsMobile';
import type { Lead, Exhibition } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CameraDialog from '@/components/CameraDialog';

const MAX_PHOTOS = 6;
const PAGE_SIZE = 24;

/**
 * One place to work through a exhibition's leads and attach a team photo to
 * each, without opening every lead individually. Photo counts are fetched
 * only for the current page, so this stays fast regardless of how many leads
 * an exhibition has collected.
 */
export default function LeadPhotosPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [mounted, setMounted] = useState(false);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [exhibitionId, setExhibitionId] = useState<string>('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [activeLeadId, setActiveLeadId] = useState<number | null>(null);
  const [showChoice, setShowChoice] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [webcamAvailable, setWebcamAvailable] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWebcamAvailable(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('view_leads')) { router.replace('/access-denied?from=/leads/photos'); return; }
    api.getExhibitions().then(list => {
      setExhibitions(list);
      const active = list.find(e => e.is_active) ?? list[0];
      if (active) setExhibitionId(String(active.exhibition_id));
    }).catch(() => toast.error('Could not load exhibitions'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const load = useCallback(async () => {
    if (!exhibitionId) return;
    setLoading(true);
    try {
      const res = await api.getLeads({
        exhibition_id: Number(exhibitionId),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setLeads(res.leads);
      setTotalCount(res.count);

      const entries = await Promise.all(res.leads.map(async l => {
        try { return [l.lead_id, (await api.getLeadMedia(l.lead_id)).photos.length] as const; }
        catch { return [l.lead_id, 0] as const; }
      }));
      setCounts(Object.fromEntries(entries));
    } catch {
      toast.error('Could not load leads');
    } finally {
      setLoading(false);
    }
  }, [exhibitionId, page]);

  useEffect(() => { setPage(1); }, [exhibitionId]);
  useEffect(() => { load(); }, [load]);

  const visible = leads.filter(l => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [l.primary_visitor_name, l.company_name, l.primary_visitor_phone]
      .some(v => v?.toLowerCase().includes(q));
  });

  const openAttach = (leadId: number) => {
    if ((counts[leadId] ?? 0) >= MAX_PHOTOS) {
      toast.error(`Already at the ${MAX_PHOTOS}-photo limit for this lead`);
      return;
    }
    setActiveLeadId(leadId);
    setShowChoice(true);
  };

  const upload = async (file: File) => {
    if (activeLeadId == null) return;
    setUploadingId(activeLeadId);
    try {
      const res = await api.uploadLeadPhoto(activeLeadId, file);
      setCounts(c => ({ ...c, [activeLeadId]: (c[activeLeadId] ?? 0) + 1 }));
      // Same feedback as the lead page's Team Photo button — the server sends
      // the meeting-photo WhatsApp on the first photo only (see
      // LeadMediaController.UploadPhoto), so say whether that actually went
      // rather than a flat "Photo added" that leaves the operator guessing.
      if (res.whatsapp_sent) toast.success('Photo added · sent to the customer');
      else if (res.whatsapp_error) {
        toast.success('Photo added');
        toast(`Not sent — ${res.whatsapp_error}`, { icon: 'ℹ️' });
      } else {
        toast.success('Photo added');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not upload the photo');
    } finally {
      setUploadingId(null);
      setActiveLeadId(null);
    }
  };

  const useNativeCamera = isMobile || !webcamAvailable;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="bg-card border-b border-border px-4 md:px-6 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => router.push('/leads')} className="p-1.5 -ml-1.5 rounded-lg hover:bg-secondary">
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Team photos</p>
          <p className="text-[11px] text-muted-foreground">Attach a photo to each lead without opening it</p>
        </div>
      </div>

      <div className="px-4 md:px-6 py-3 flex flex-wrap gap-2 items-center border-b border-border shrink-0">
        <Select value={exhibitionId} onValueChange={setExhibitionId}>
          <SelectTrigger className="h-9 w-[220px] text-xs"><SelectValue placeholder="Choose an exhibition" /></SelectTrigger>
          <SelectContent>
            {exhibitions.map(e => (
              <SelectItem key={e.exhibition_id} value={String(e.exhibition_id)}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search this page…"
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-card text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground/50" /></div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            {exhibitionId ? 'No leads for this exhibition' : 'Choose an exhibition to begin'}
          </p>
        ) : (
          <div className="space-y-2">
            {visible.map(lead => {
              const count = counts[lead.lead_id] ?? 0;
              return (
                <div key={lead.lead_id}
                     className="flex items-center gap-3 bg-card border border-border rounded-xl px-3 py-2.5">
                  <span className="w-9 h-9 rounded-full bg-primary/12 flex items-center justify-center shrink-0">
                    {lead.company_name ? <Building2 className="w-4 h-4 text-primary" /> : <User className="w-4 h-4 text-primary" />}
                  </span>
                  <button onClick={() => router.push(`/leads/${lead.lead_id}`)}
                          className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-medium text-foreground truncate">
                      {lead.primary_visitor_name || lead.company_name || 'Unnamed lead'}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {[lead.company_name, lead.primary_visitor_phone].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </button>
                  <span className="text-[11px] font-semibold text-muted-foreground tabular shrink-0">
                    {count}/{MAX_PHOTOS}
                  </span>
                  <Button
                    size="sm" variant="outline"
                    disabled={uploadingId === lead.lead_id || count >= MAX_PHOTOS}
                    onClick={() => openAttach(lead.lead_id)}
                    className="h-8 gap-1.5 text-xs shrink-0"
                  >
                    {uploadingId === lead.lead_id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Camera className="w-3.5 h-3.5" />}
                    {count >= MAX_PHOTOS ? 'Full' : 'Attach'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-4 pb-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-8 text-xs">
              Previous
            </Button>
            <span className="text-[11px] text-muted-foreground">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="h-8 text-xs">
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Camera input hands off to the phone's camera app; the plain one reaches
          the gallery — same split as LeadMediaCard's Team Photo action. */}
      <input
        ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
      />
      <input
        ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
      />

      {showChoice && (
        <div onClick={() => setShowChoice(false)}
             className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div onClick={e => e.stopPropagation()} className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-foreground">Add team photo</p>
              <button onClick={() => setShowChoice(false)} className="p-1 rounded-lg hover:bg-secondary">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowChoice(false);
                  if (useNativeCamera) camRef.current?.click(); else setShowCamera(true);
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg bg-card flex items-center justify-center shrink-0">
                  <Camera className="w-4 h-4 text-muted-foreground" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">Take photo</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {useNativeCamera ? 'Opens your camera' : 'Opens your webcam'}
                  </span>
                </span>
              </button>
              <button
                onClick={() => { setShowChoice(false); fileRef.current?.click(); }}
                className="flex items-center gap-3 px-3 py-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg bg-card flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">Upload image</span>
                  <span className="block text-[11px] text-muted-foreground">Choose an existing photo</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <CameraDialog
        open={showCamera}
        title="Team photo"
        onCapture={upload}
        onClose={() => setShowCamera(false)}
      />
    </div>
  );
}
