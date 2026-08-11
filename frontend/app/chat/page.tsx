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
import {
  INDIAN_STATES, INDIAN_UNION_TERRITORIES,
  normaliseIndianState, isKnownIndianState,
} from '@/lib/indianStates';

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
  gst_number: string;
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
  gst_number: '',
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

  /**
   * Text sitting in a ChipInput that was never committed with "+" or Enter.
   *
   * A ref rather than state because save() has to read it synchronously — a
   * setState from the input's blur would not have landed by the time the click
   * handler runs, and at a stall the operator types a number and hits Save
   * without ever reaching for "+". Losing it was silent, which is the worst
   * kind of data loss: the lead saves, just without a phone number.
   */
  type ChipField = 'phones' | 'emails' | 'websites';
  const chipDrafts = useRef<Record<ChipField, string>>({ phones: '', emails: '', websites: '' });

  const withPendingChips = (f: FormState): FormState => {
    const out = { ...f };
    (['phones', 'emails', 'websites'] as const).forEach(key => {
      const pending = chipDrafts.current[key].trim();
      if (pending && !out[key].includes(pending)) out[key] = [...out[key], pending];
    });
    return out;
  };

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
        // Mapped to an official name where possible ("MH", "Maharastra", "Orissa"
        // all land correctly). An unrecognised value is passed through rather
        // than dropped — StateSelect keeps it selectable and flags it.
        state: addr?.state
          ? (normaliseIndianState(addr.state) ?? addr.state)
          : f.state,
        websites: ex.websites?.length ? ex.websites : f.websites,
        // Services/products is no longer captured, so anything the card
        // extraction read for it is deliberately discarded.
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
    chipDrafts.current = { phones: '', emails: '', websites: '' };
    setHasTeamPhoto(false);
    setTeamPhoto(null);
    setTeamPreview(null);
  };

  const save = async () => {
    // Fold in anything still sitting in a chip input before reading the form,
    // so a number typed but not committed with "+" is not silently dropped.
    const entered = withPendingChips(form);
    setForm(entered);

    if (!exhibition) { toast.error('Choose an exhibition'); return; }
    if (!entered.primary_visitor_name.trim() && !entered.company_name.trim()) {
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
          company_name: entered.company_name || null,
          persons: [{
            name: entered.primary_visitor_name || null,
            designation: entered.primary_visitor_designation || null,
            phones: entered.phones,
            emails: entered.emails,
            is_primary: true,
          }],
          phones: entered.phones,
          emails: entered.emails,
          websites: entered.websites,
          // The Services/products field is gone from the form, but the API
          // contract still requires the key — send it empty rather than
          // dropping it and failing validation.
          services: [],
          gst_number: entered.gst_number.trim() || null,
          addresses: (entered.address || entered.city || entered.state)
            ? [{
                address_type: null,
                address: entered.address || null,
                city: entered.city || null,
                state: entered.state || null,
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
          company_name: entered.company_name || undefined,
          primary_visitor_name: entered.primary_visitor_name || undefined,
          primary_visitor_phone: entered.phones[0],
          primary_visitor_email: entered.emails[0],
          primary_visitor_designation: entered.primary_visitor_designation || undefined,
          discussion_summary: entered.discussion_summary || undefined,
          gst_number: entered.gst_number.trim() || undefined,
          // These used to go nowhere: the create call dropped them and the
          // follow-up update was an empty object.
          phones: entered.phones,
          emails: entered.emails,
          websites: entered.websites,
          address: entered.address || undefined,
          city: entered.city || undefined,
          state: entered.state || undefined,
        });
        leadId = res.lead_id;
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
    lowConfidence.has(field) ? 'border-l-4 border-l-warning' : '';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Exhibition bar */}
      <div className="bg-card border-b border-border px-4 md:px-6 py-2.5 flex items-center gap-2 shrink-0">
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground bg-secondary hover:bg-secondary rounded-lg px-2.5 py-1.5 transition-colors min-w-0"
        >
          <span className="truncate max-w-[180px]">{exhibition?.name ?? 'Choose exhibition'}</span>
          <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
        </button>
        <div className="flex-1" />
        <button onClick={resetAll} className="text-[11px] text-muted-foreground hover:text-muted-foreground flex items-center gap-1">
          <RotateCcw className="w-3 h-3" /> Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
        {/* Card capture */}
        <Card className="border-border">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Visiting card
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">optional</span>
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
                            className="w-20 h-24 rounded-lg border border-dashed border-input flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-secondary/60">
                      <Plus className="w-4 h-4" />
                      <span className="text-[9px]">Back</span>
                    </button>
                  )}
              </div>
            )}

            {extracting && (
              <div className="flex items-center gap-2 text-xs text-primary bg-primary/[0.07] rounded-lg px-3 py-2">
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
          <div className="rounded-xl border border-warning/25 bg-warning/[0.07] p-3 space-y-1.5">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'}
            </p>
            {duplicates.slice(0, 3).map(d => (
              <button key={d.lead_id} onClick={() => router.push(`/leads/${d.lead_id}`)}
                      className="block w-full text-left text-[11px] text-warning hover:underline">
                {d.visitor_name || 'Unknown'}{d.company_name ? ` · ${d.company_name}` : ''}
                {d.phone ? ` · ${d.phone}` : ''} ({d.similarity_score}% match)
              </button>
            ))}
            <p className="text-[10px] text-warning">You can still save — this is only a warning.</p>
          </div>
        )}

        {/* Details */}
        <Card className="border-border">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</span>
              {lowConfidence.size > 0 && (
                <span className="text-[10px] text-warning ml-auto flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> check highlighted fields
                </span>
              )}
            </div>

            <Input label="Name" required value={form.primary_visitor_name} className={flagged('primary_visitor_name')}
                   onChange={v => set('primary_visitor_name', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Designation" value={form.primary_visitor_designation}
                     onChange={v => set('primary_visitor_designation', v)} />
              {/* Labelled Agency in the UI; the field is still company_name
                  everywhere below this line, so the API is untouched. */}
              <Input label="Agency" required value={form.company_name} className={flagged('company_name')}
                     onChange={v => set('company_name', v)} />
            </div>

            <ChipInput label="Phone numbers" required values={form.phones}
                       onChange={v => set('phones', v)}
                       onDraft={v => { chipDrafts.current.phones = v; }}
                       placeholder="Add a number" inputMode="tel" />
            <ChipInput label="Emails" values={form.emails}
                       onChange={v => set('emails', v)}
                       onDraft={v => { chipDrafts.current.emails = v; }}
                       placeholder="Add an email" />

            <Input label="Address" value={form.address} onChange={v => set('address', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City"  value={form.city}  onChange={v => set('city', v)} />
              <StateSelect value={form.state} onChange={v => set('state', v)} />
            </div>

            <ChipInput label="Websites" values={form.websites}
                       onChange={v => set('websites', v)}
                       onDraft={v => { chipDrafts.current.websites = v; }}
                       placeholder="Add a website" />

            <Input label="GST number (optional)" value={form.gst_number}
                   onChange={v => set('gst_number', v.toUpperCase())} />

            <Input label="Discussion notes" value={form.discussion_summary}
                   onChange={v => set('discussion_summary', v)} />

          </CardContent>
        </Card>

        {/* Team photo */}
        <Card className="border-border">
          <CardContent className="p-4 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hasTeamPhoto}
                onChange={e => {
                  setHasTeamPhoto(e.target.checked);
                  if (!e.target.checked) { setTeamPhoto(null); setTeamPreview(null); }
                }}
                className="w-4 h-4 rounded border-input"
              />
              <span className="text-sm font-medium text-foreground">
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
                  <p className="text-[10px] text-muted-foreground mt-1.5">
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
              className="bg-card rounded-2xl shadow-2xl w-full max-w-sm max-h-[70vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <p className="text-sm font-bold text-foreground">Choose exhibition</p>
                <button onClick={() => setShowPicker(false)} className="p-1 rounded-lg hover:bg-secondary">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="p-2">
                {exhibitions.map(ex => (
                  <button key={ex.exhibition_id} onClick={() => chooseExhibition(ex)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                            exhibition?.exhibition_id === ex.exhibition_id
                              ? 'bg-primary/[0.07] text-primary font-semibold'
                              : 'hover:bg-secondary/60 text-foreground'}`}>
                    {ex.name}
                    {ex.location && <span className="block text-[11px] text-muted-foreground">{ex.location}</span>}
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
      <img src={src} alt={label} className="w-full h-full object-cover rounded-lg border border-border" />
      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] text-center py-0.5 rounded-b-lg">
        {label}
      </span>
      <button onClick={onRemove} aria-label={`Remove ${label}`}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center shadow-sm">
        <X className="w-3 h-3 text-destructive" />
      </button>
    </div>
  );
}

/**
 * State picker.
 *
 * Card extraction writes here too, and GPT does not always return an official
 * name. Anything it cannot match is kept as a selectable option rather than
 * discarded — a <select> whose value is not among its options renders blank,
 * which would quietly lose what was read off the card.
 */
function StateSelect({ value, onChange }: {
  value: string; onChange: (v: string) => void;
}) {
  const unmatched = value && !isKnownIndianState(value);

  return (
    <label className="block text-xs">
      <span className="text-muted-foreground font-medium">State</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 w-full h-10 px-3 rounded-lg border bg-card text-sm ${
          unmatched ? 'border-warning/40' : 'border-border'
        } ${value ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        <option value="">Select a state</option>

        {unmatched && (
          <option value={value}>{value} — from the card, not recognised</option>
        )}

        <optgroup label="States">
          {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </optgroup>
        <optgroup label="Union Territories">
          {INDIAN_UNION_TERRITORIES.map(s => <option key={s} value={s}>{s}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

function Input({ label, value, onChange, className = '', required = false }: {
  label: string; value: string; onChange: (v: string) => void;
  className?: string; required?: boolean;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground font-medium">
        {label}{required && <RequiredMark />}
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm ${className}`}
      />
    </label>
  );
}

/**
 * Repeatable values as chips — phones, emails, websites.
 *
 * The pending text is mirrored to the parent through `onDraft` on every
 * keystroke, and committed on blur as well as on Enter / "+". Between them the
 * value survives every way out of the field: tabbing away, tapping Save, or
 * hitting Save with the caret still in the box.
 */
function ChipInput({ label, values, onChange, onDraft, placeholder, inputMode, required = false }: {
  label: string; values: string[]; onChange: (v: string[]) => void;
  onDraft?: (v: string) => void;
  placeholder: string; inputMode?: 'tel'; required?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const edit = (v: string) => { setDraft(v); onDraft?.(v); };

  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    edit('');
  };

  return (
    <div className="text-xs">
      <span className="text-muted-foreground font-medium">
        {label}{required && <RequiredMark />}
      </span>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 bg-secondary text-foreground rounded-lg pl-2.5 pr-1 py-1 text-[11px]">
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Remove ${v}`}
                    className="p-0.5 hover:text-destructive">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 mt-1.5">
        <input
          value={draft}
          inputMode={inputMode}
          onChange={e => edit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={placeholder}
          className="flex-1 h-9 px-3 rounded-lg border border-border bg-card text-sm"
        />
        <button onClick={add}
                className="h-9 w-9 rounded-lg bg-secondary hover:bg-secondary flex items-center justify-center shrink-0">
          <Plus className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

/**
 * Marks a field the save will refuse without.
 *
 * aria-hidden with a visually-hidden word beside it: a bare asterisk is
 * announced as "star" or skipped entirely by a screen reader, which tells
 * somebody filling this in on a phone nothing at all.
 */
function RequiredMark() {
  return (
    <>
      <span aria-hidden className="text-destructive ml-0.5">*</span>
      <span className="sr-only"> (required)</span>
    </>
  );
}
