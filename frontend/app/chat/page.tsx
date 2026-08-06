'use client';

/**
 * Lead capture.
 *
 * A single manual-entry form is the interface. Scanning a visiting card is an
 * accelerator that pre-fills it — not a separate mode — so a failed or skipped
 * extraction degrades into plain manual entry rather than dead-ending, and the
 * operator always looks at the same layout.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Camera, Upload, Loader2, X, Plus, Check, ScanLine, ChevronDown,
  AlertTriangle, Users, Sparkles, RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated, getEmployee, hasPermission } from '@/lib/auth';
import type { Exhibition, CardExtractionResult } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import CameraDialog from '@/components/CameraDialog';
import { useIsMobile } from '@/lib/useIsMobile';
import { apiErrorMessage } from '@/lib/apiError';

interface FormState {
  company_name: string;
  primary_visitor_name: string;
  primary_visitor_designation: string;
  phones: string[];
  emails: string[];
  address: string;
  city: string;
  state: string;
  websites: string[];
  services: string[];
  category: string;
  vertical: string;
  turn_over: string;
  team_size: string;
  discussion_summary: string;
}

const blank = (): FormState => ({
  company_name: '',
  primary_visitor_name: '',
  primary_visitor_designation: '',
  phones: [],
  emails: [],
  address: '',
  city: '',
  state: '',
  websites: [],
  services: [],
  category: '',
  vertical: '',
  turn_over: '',
  team_size: '',
  discussion_summary: '',
});

interface Duplicate {
  lead_id: number;
  visitor_name?: string;
  company_name?: string;
  phone?: string;
  similarity_score: number;
}

export default function ScanPage() {
  const router = useRouter();

  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const [form, setForm] = useState<FormState>(blank());
  const [lowConfidence, setLowConfidence] = useState<Set<string>>(new Set());
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [tempId, setTempId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<any>(null);

  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showClassification, setShowClassification] = useState(false);

  const [hasTeamPhoto, setHasTeamPhoto] = useState(false);
  const [teamPhoto, setTeamPhoto] = useState<File | null>(null);
  const [teamPreview, setTeamPreview] = useState<string | null>(null);

  // Two inputs per slot: one carries `capture` so a phone opens its camera app,
  // the other omits it so Upload can reach the gallery. Sharing one input made
  // Upload force the camera on mobile.
  const frontCamRef  = useRef<HTMLInputElement>(null);
  const frontFileRef = useRef<HTMLInputElement>(null);
  const backCamRef   = useRef<HTMLInputElement>(null);
  const backFileRef  = useRef<HTMLInputElement>(null);
  const teamCamRef   = useRef<HTMLInputElement>(null);
  const teamFileRef  = useRef<HTMLInputElement>(null);

  // Desktop has no camera app to hand off to, so it gets the in-page webcam.
  const isMobile = useIsMobile();
  const [cameraFor, setCameraFor] = useState<'front' | 'back' | 'team' | null>(null);

  /** Take photo: native camera on mobile, webcam dialog on desktop. */
  const takePhoto = (slot: 'front' | 'back' | 'team') => {
    if (isMobile) {
      const ref = slot === 'front' ? frontCamRef : slot === 'back' ? backCamRef : teamCamRef;
      ref.current?.click();
    } else {
      setCameraFor(slot);
    }
  };

  const onCameraCapture = (file: File) => {
    if (cameraFor === 'front') pickFront(file);
    else if (cameraFor === 'back') pickBack(file);
    else if (cameraFor === 'team') { setTeamPhoto(file); setTeamPreview(URL.createObjectURL(file)); }
  };

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('scan_cards')) { router.replace('/access-denied?from=/chat'); return; }

    api.getExhibitions().then(list => {
      setExhibitions(list);
      const saved = localStorage.getItem('active_exhibition');
      const found = saved ? list.find(e => String(e.exhibition_id) === saved) : null;
      setExhibition(found ?? list[0] ?? null);
    }).catch(() => toast.error('Could not load exhibitions'));
  }, [router]);

  const chooseExhibition = (ex: Exhibition) => {
    setExhibition(ex);
    localStorage.setItem('active_exhibition', String(ex.exhibition_id));
    setShowPicker(false);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  /** Extraction runs against the images and pre-fills the form in place. */
  const runExtraction = useCallback(async (front: File, back: File | null) => {
    if (!exhibition) { toast.error('Choose an exhibition first'); return; }

    setExtracting(true);
    setDuplicates([]);
    try {
      const res: CardExtractionResult = await api.extractCardPreview(front, back, exhibition.exhibition_id);
      const ex = res.extraction;
      if (!ex) { toast.error('Nothing could be read from that card'); return; }

      setExtraction(ex);
      setTempId(res.temp_id ?? null);

      const person = ex.persons?.[0];
      const addr = ex.addresses?.[0];

      setForm(f => ({
        ...f,
        company_name: ex.company_name ?? f.company_name,
        primary_visitor_name: person?.name ?? f.primary_visitor_name,
        primary_visitor_designation: person?.designation ?? f.primary_visitor_designation,
        phones: ex.phones?.length ? ex.phones : f.phones,
        emails: ex.emails?.length ? ex.emails : f.emails,
        address: addr?.address ?? f.address,
        city: addr?.city ?? f.city,
        state: addr?.state ?? f.state,
        websites: ex.websites?.length ? ex.websites : f.websites,
        services: ex.services?.length ? ex.services : f.services,
      }));

      // Low confidence points the operator at the risky fields instead of
      // making them re-read all fifteen.
      if ((ex.confidence ?? 1) < 0.75) {
        setLowConfidence(new Set(['primary_visitor_name', 'company_name']));
      } else {
        setLowConfidence(new Set());
      }

      if (res.duplicate_check?.is_duplicate) {
        setDuplicates(res.duplicate_check.duplicates ?? []);
      }

      toast.success('Card read — check the details');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not read that card'));
    } finally {
      setExtracting(false);
    }
  }, [exhibition]);

  const pickFront = (file: File) => {
    setFrontFile(file);
    setFrontPreview(URL.createObjectURL(file));
    runExtraction(file, backFile);
  };

  const pickBack = (file: File) => {
    setBackFile(file);
    setBackPreview(URL.createObjectURL(file));
    if (frontFile) runExtraction(frontFile, file);
  };

  const clearCard = () => {
    setFrontFile(null); setBackFile(null);
    setFrontPreview(null); setBackPreview(null);
    setTempId(null); setExtraction(null);
    setLowConfidence(new Set()); setDuplicates([]);
  };

  const resetAll = () => {
    clearCard();
    setForm(blank());
    setHasTeamPhoto(false);
    setTeamPhoto(null);
    setTeamPreview(null);
  };

  const save = async () => {
    if (!exhibition) { toast.error('Choose an exhibition'); return; }
    if (!form.primary_visitor_name.trim() && !form.company_name.trim()) {
      toast.error('Enter at least a name or a company'); return;
    }
    // The checkbox is a promise the operator made — hold Save until it's kept.
    if (hasTeamPhoto && !teamPhoto) {
      toast.error('Add the team photo, or untick the box to add it later'); return;
    }

    setSaving(true);
    const employee = getEmployee();

    try {
      let leadId: number;

      if (tempId && extraction) {
        // Confirm path: reuses the extraction and moves the temp card images.
        // Shape must match CardExtractionData exactly: its list members are
        // non-nullable server-side, so a missing one is a 400 rather than a
        // tolerated omission. `emails` is a LIST on a person, not a string.
        const merged = {
          ...extraction,
          company_name: form.company_name || null,
          persons: [{
            name: form.primary_visitor_name || null,
            designation: form.primary_visitor_designation || null,
            phones: form.phones,
            emails: form.emails,
            is_primary: true,
          }],
          phones: form.phones,
          emails: form.emails,
          websites: form.websites,
          services: form.services,
          addresses: (form.address || form.city || form.state)
            ? [{
                address_type: null,
                address: form.address || null,
                city: form.city || null,
                state: form.state || null,
                country: null,
                pin_code: null,
              }]
            : [],
          // Defaulted rather than assumed: a preview response missing either of
          // these would otherwise fail validation with no obvious cause.
          brands: (extraction as any)?.brands ?? [],
          confidence: (extraction as any)?.confidence ?? 0,
        };

        const res = await api.confirmAndSaveLead(
          merged,
          exhibition.exhibition_id,
          employee?.employee_id ?? 0,
          tempId,
        );
        leadId = res.lead_id!;
      } else {
        // Pure manual entry — no card was scanned.
        const res = await api.createLead({
          exhibition_id: exhibition.exhibition_id,
          source_code: 'manual_entry',
          assigned_employee_id: employee?.employee_id,
          company_name: form.company_name || undefined,
          primary_visitor_name: form.primary_visitor_name || undefined,
          primary_visitor_phone: form.phones[0],
          primary_visitor_email: form.emails[0],
          primary_visitor_designation: form.primary_visitor_designation || undefined,
          discussion_summary: form.discussion_summary || undefined,
        });
        leadId = res.lead_id;

        await api.updateLead(leadId, {
          services: form.services,
          category: form.category || undefined,
          vertical: form.vertical || undefined,
          turn_over: form.turn_over || undefined,
          team_size: form.team_size || undefined,
        } as any);
      }

      // Photo goes up after the lead exists. If it fails the lead still stands
      // and the photo can be added from the lead page — same recovery path as
      // leaving the box unticked.
      if (teamPhoto) {
        try { await api.uploadLeadPhoto(leadId, teamPhoto); }
        catch { toast.error('Lead saved, but the team photo failed to upload'); }
      }

      // Welcome fires after the photo so it can carry it.
      try { await api.sendWelcomeWhatsApp(leadId); } catch { /* best effort */ }

      toast.success('Lead saved');
      router.push(`/leads/${leadId}`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save the lead'));
    } finally {
      setSaving(false);
    }
  };

  const flagged = (field: string) =>
    lowConfidence.has(field) ? 'border-l-4 border-l-amber-400' : '';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      {/* Exhibition bar */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-2.5 flex items-center gap-2 shrink-0">
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg px-2.5 py-1.5 transition-colors min-w-0"
        >
          <span className="truncate max-w-[180px]">{exhibition?.name ?? 'Choose exhibition'}</span>
          <ChevronDown className="w-3 h-3 shrink-0 text-slate-400" />
        </button>
        <div className="flex-1" />
        <button onClick={resetAll} className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1">
          <RotateCcw className="w-3 h-3" /> Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
        {/* Card capture */}
        <Card className="border-slate-200">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Visiting card
              </span>
              <span className="text-[10px] text-slate-400 ml-auto">optional</span>
            </div>

            {!frontPreview ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => takePhoto('front')}
                        disabled={extracting} className="h-11 gap-1.5 text-xs">
                  <Camera className="w-3.5 h-3.5" /> Take photo
                </Button>
                <Button variant="outline" onClick={() => frontFileRef.current?.click()}
                        disabled={extracting} className="h-11 gap-1.5 text-xs">
                  <Upload className="w-3.5 h-3.5" /> Upload
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Thumb src={frontPreview} label="Front" onRemove={clearCard} />
                {backPreview
                  ? <Thumb src={backPreview} label="Back"
                           onRemove={() => { setBackFile(null); setBackPreview(null); }} />
                  : (
                    <button onClick={() => takePhoto('back')} disabled={extracting}
                            className="w-20 h-24 rounded-lg border border-dashed border-slate-300 flex flex-col items-center justify-center gap-1 text-slate-400 hover:bg-slate-50">
                      <Plus className="w-4 h-4" />
                      <span className="text-[9px]">Back</span>
                    </button>
                  )}
              </div>
            )}

            {extracting && (
              <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Reading the card…
              </div>
            )}

            <input ref={frontCamRef} type="file" accept="image/*" capture="environment" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) pickFront(f); e.target.value = ''; }} />
            <input ref={frontFileRef} type="file" accept="image/*" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) pickFront(f); e.target.value = ''; }} />
            <input ref={backCamRef} type="file" accept="image/*" capture="environment" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) pickBack(f); e.target.value = ''; }} />
            <input ref={backFileRef} type="file" accept="image/*" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) pickBack(f); e.target.value = ''; }} />
          </CardContent>
        </Card>

        {/* Duplicates — a warning to overrule, not a blocker */}
        {duplicates.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'}
            </p>
            {duplicates.slice(0, 3).map(d => (
              <button key={d.lead_id} onClick={() => router.push(`/leads/${d.lead_id}`)}
                      className="block w-full text-left text-[11px] text-amber-800 hover:underline">
                {d.visitor_name || 'Unknown'}{d.company_name ? ` · ${d.company_name}` : ''}
                {d.phone ? ` · ${d.phone}` : ''} ({d.similarity_score}% match)
              </button>
            ))}
            <p className="text-[10px] text-amber-700">You can still save — this is only a warning.</p>
          </div>
        )}

        {/* Details */}
        <Card className="border-slate-200">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</span>
              {lowConfidence.size > 0 && (
                <span className="text-[10px] text-amber-700 ml-auto flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> check highlighted fields
                </span>
              )}
            </div>

            <Input label="Name" value={form.primary_visitor_name} className={flagged('primary_visitor_name')}
                   onChange={v => set('primary_visitor_name', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Designation" value={form.primary_visitor_designation}
                     onChange={v => set('primary_visitor_designation', v)} />
              <Input label="Company" value={form.company_name} className={flagged('company_name')}
                     onChange={v => set('company_name', v)} />
            </div>

            <ChipInput label="Phone numbers" values={form.phones}
                       onChange={v => set('phones', v)} placeholder="Add a number" inputMode="tel" />
            <ChipInput label="Emails" values={form.emails}
                       onChange={v => set('emails', v)} placeholder="Add an email" />

            <Input label="Address" value={form.address} onChange={v => set('address', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City"  value={form.city}  onChange={v => set('city', v)} />
              <Input label="State" value={form.state} onChange={v => set('state', v)} />
            </div>

            <ChipInput label="Websites" values={form.websites}
                       onChange={v => set('websites', v)} placeholder="Add a website" />

            <ChipInput label="Services / products" values={form.services}
                       onChange={v => set('services', v)}
                       placeholder="Add a service or product" />

            <Input label="Discussion notes" value={form.discussion_summary}
                   onChange={v => set('discussion_summary', v)} />

            {/* Rarely known at the counter — collapsed by default */}
            <button onClick={() => setShowClassification(s => !s)}
                    className="text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <ChevronDown className={`w-3 h-3 transition-transform ${showClassification ? 'rotate-180' : ''}`} />
              Classification (optional)
            </button>

            <AnimatePresence>
              {showClassification && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <Input label="Category"  value={form.category}  onChange={v => set('category', v)} />
                    <Input label="Vertical"  value={form.vertical}  onChange={v => set('vertical', v)} />
                    <Input label="Turn-over" value={form.turn_over} onChange={v => set('turn_over', v)} />
                    <Input label="Team size" value={form.team_size} onChange={v => set('team_size', v)} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        {/* Team photo */}
        <Card className="border-slate-200">
          <CardContent className="p-4 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hasTeamPhoto}
                onChange={e => {
                  setHasTeamPhoto(e.target.checked);
                  if (!e.target.checked) { setTeamPhoto(null); setTeamPreview(null); }
                }}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span className="text-sm font-medium text-slate-700">
                Lead has a photo with the team
              </span>
            </label>

            <AnimatePresence>
              {hasTeamPhoto && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  {teamPreview ? (
                    <div className="flex gap-2 pt-1">
                      <Thumb src={teamPreview} label="Team"
                             onRemove={() => { setTeamPhoto(null); setTeamPreview(null); }} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Button variant="outline" onClick={() => takePhoto('team')}
                              className="h-11 gap-1.5 text-xs">
                        <Camera className="w-3.5 h-3.5" /> Take photo
                      </Button>
                      <Button variant="outline" onClick={() => teamFileRef.current?.click()}
                              className="h-11 gap-1.5 text-xs">
                        <Upload className="w-3.5 h-3.5" /> Upload
                      </Button>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1.5">
                    Not now? Untick and add it later from the lead page.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <input ref={teamCamRef} type="file" accept="image/*" capture="environment" className="hidden"
                   onChange={e => {
                     const f = e.target.files?.[0];
                     if (f) { setTeamPhoto(f); setTeamPreview(URL.createObjectURL(f)); }
                     e.target.value = '';
                   }} />
            <input ref={teamFileRef} type="file" accept="image/*" className="hidden"
                   onChange={e => {
                     const f = e.target.files?.[0];
                     if (f) { setTeamPhoto(f); setTeamPreview(URL.createObjectURL(f)); }
                     e.target.value = '';
                   }} />
          </CardContent>
        </Card>

        <motion.div whileTap={{ scale: 0.99 }}>
          <Button onClick={save} disabled={saving || extracting}
                  className="w-full h-12 gap-2 text-sm font-semibold">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Lead'}
          </Button>
        </motion.div>

        <div className="md:hidden h-20" />
      </div>

      {/* Desktop webcam capture */}
      <CameraDialog
        open={cameraFor !== null}
        title={
          cameraFor === 'front' ? 'Visiting card — front'
          : cameraFor === 'back' ? 'Visiting card — back'
          : 'Photo with the team'
        }
        onCapture={onCameraCapture}
        onClose={() => setCameraFor(null)}
      />

      {/* Exhibition picker */}
      <AnimatePresence>
        {showPicker && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowPicker(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[70vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-900">Choose exhibition</p>
                <button onClick={() => setShowPicker(false)} className="p-1 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              <div className="p-2">
                {exhibitions.map(ex => (
                  <button key={ex.exhibition_id} onClick={() => chooseExhibition(ex)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                            exhibition?.exhibition_id === ex.exhibition_id
                              ? 'bg-blue-50 text-blue-700 font-semibold'
                              : 'hover:bg-slate-50 text-slate-700'}`}>
                    {ex.name}
                    {ex.location && <span className="block text-[11px] text-slate-400">{ex.location}</span>}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Thumb({ src, label, onRemove }: { src: string; label: string; onRemove: () => void }) {
  return (
    <div className="relative w-20 h-24 shrink-0">
      <img src={src} alt={label} className="w-full h-full object-cover rounded-lg border border-slate-200" />
      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] text-center py-0.5 rounded-b-lg">
        {label}
      </span>
      <button onClick={onRemove} aria-label={`Remove ${label}`}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm">
        <X className="w-3 h-3 text-rose-500" />
      </button>
    </div>
  );
}

function Input({ label, value, onChange, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-slate-500 font-medium">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm ${className}`}
      />
    </label>
  );
}

/** Repeatable values as chips — phones, emails, websites and services. */
function ChipInput({ label, values, onChange, placeholder, inputMode }: {
  label: string; values: string[]; onChange: (v: string[]) => void;
  placeholder: string; inputMode?: 'tel';
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };

  return (
    <div className="text-xs">
      <span className="text-slate-500 font-medium">{label}</span>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 rounded-lg pl-2.5 pr-1 py-1 text-[11px]">
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Remove ${v}`}
                    className="p-0.5 hover:text-rose-500">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 mt-1.5">
        <input
          value={draft}
          inputMode={inputMode}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm"
        />
        <button onClick={add}
                className="h-9 w-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0">
          <Plus className="w-4 h-4 text-slate-600" />
        </button>
      </div>
    </div>
  );
}
