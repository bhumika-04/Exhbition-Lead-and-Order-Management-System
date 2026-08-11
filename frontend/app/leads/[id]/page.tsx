'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { requireAuth, getEmployee, hasPermission } from '@/lib/auth';
import type { LeadDetails } from '@/lib/types';
import {
  ArrowLeft, Edit3, Check, X, Phone, Mail, Building2, Globe,
  MapPin, Users, MessageSquare, Zap, Loader2, CheckCircle2,
  Tag, Image, Plus, Share2, Copy, ExternalLink, Ticket,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BlurFade } from '@/components/ui/blur-fade';
import LeadOrdersCard from '@/components/LeadOrdersCard';
import LeadMediaCard from '@/components/LeadMediaCard';
import { cn } from '@/lib/utils';
import { money, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from '@/lib/orders';

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams();
  const leadId = parseInt(params.id as string);

  const [lead, setLead] = useState<LeadDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    primary_visitor_name: '',
    primary_visitor_designation: '',
    primary_visitor_phone: '',
    primary_visitor_email: '',
    company_name: '',
  });

  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  useEffect(() => {
    try { requireAuth(); } catch { router.push('/auth/login'); return; }
    if (!hasPermission('view_leads')) { router.replace('/access-denied?from=/leads'); return; }
    if (isNaN(leadId)) { router.replace('/leads'); return; }
    loadLead();
  }, [leadId]);

  const loadLead = async () => {
    try {
      const data = await api.getLead(leadId);
      setLead(data);
      setEditForm({
        primary_visitor_name: data.primary_visitor_name || '',
        primary_visitor_designation: data.primary_visitor_designation || '',
        primary_visitor_phone: data.primary_visitor_phone || '',
        primary_visitor_email: data.primary_visitor_email || '',
        company_name: data.company_name || '',
      });
    } catch (err: any) {
      console.error('Failed to load lead', err);
      toast.error('Failed to load lead details. Please try again.');
    } finally { setLoading(false); }
  };

  const handleEditToggle = () => {
    if (isEditing && lead) {
      setEditForm({
        primary_visitor_name: lead.primary_visitor_name || '',
        primary_visitor_designation: lead.primary_visitor_designation || '',
        primary_visitor_phone: lead.primary_visitor_phone || '',
        primary_visitor_email: lead.primary_visitor_email || '',
        company_name: lead.company_name || '',
      });
    }
    setIsEditing(!isEditing);
  };

  const handleSaveEdit = async () => {
    try {
      await api.updateLead(leadId, { ...editForm } as any);
      toast.success('Lead updated');
      setIsEditing(false);
      await loadLead();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update lead');
    }
  };

  const backendBase = (() => {
    const env = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (env && env !== 'http://localhost:5008') return env;
    if (typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:5008`;
    return 'http://localhost:5008';
  })();
  const imageUrl = (path: string | null | undefined) =>
    path ? `${backendBase}/uploads/${path.replace(/\\/g, '/').split('uploads/').pop()}` : null;

  const handleWhatsApp = () => {
    if (!lead) return;
    const phone = lead.primary_visitor_phone || lead.phones?.[0]?.phone_number;
    if (!phone) { toast.error('No phone number found'); return; }
    const digits = phone.replace(/[^0-9]/g, '').replace(/^0+/, '');
    const normalized = digits.length === 10 ? `91${digits}` : digits;
    const employee = getEmployee();
    const name = lead.primary_visitor_name || 'there';
    const company = lead.company_name ? ` (${lead.company_name})` : '';
    const exhibition = lead.exhibition_name ? `the ${lead.exhibition_name} exhibition` : 'the exhibition';
    const sender = employee?.full_name ?? '';
    const senderCompany = employee?.company_name ?? '';
    const defaultTemplate =
      `Hello {name}{company},\n\nIt was great meeting you at {exhibition}! We are glad to have connected with you.\n\nLooking forward to staying in touch.\n\nBest regards,\n{sender}\n{sender_company}`;
    const template = localStorage.getItem('whatsapp_template') || defaultTemplate;
    const message = template
      .replace('{name}', name)
      .replace('{company}', company)
      .replace('{exhibition}', exhibition)
      .replace('{sender}', sender)
      .replace('{sender_company}', senderCompany);
    window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleAddToContact = async () => {
    if (!lead) return;
    const escape = (v?: string) => (v || '').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    const name = lead.primary_visitor_name || lead.persons?.[0]?.name || '';
    const display = [lead.company_name, name].filter(Boolean).join(' - ');
    if (display) { lines.push(`FN:${escape(display)}`); lines.push(`N:${escape(name)};;;;`); }
    if (lead.company_name) lines.push(`ORG:${escape(lead.company_name)}`);
    const desig = lead.primary_visitor_designation || lead.persons?.[0]?.designation || '';
    if (desig) lines.push(`TITLE:${escape(desig)}`);
    const allPhones = new Set<string>();
    if (lead.primary_visitor_phone) allPhones.add(lead.primary_visitor_phone);
    lead.phones?.forEach(p => p.phone_number && allPhones.add(p.phone_number));
    Array.from(allPhones).forEach((ph, i) => lines.push(`TEL;TYPE=${i === 0 ? 'CELL' : 'WORK'}:${escape(ph)}`));
    const allEmails = new Set<string>();
    if (lead.primary_visitor_email) allEmails.add(lead.primary_visitor_email);
    lead.emails?.forEach(e => e.email_address && allEmails.add(e.email_address));
    Array.from(allEmails).forEach(em => lines.push(`EMAIL:${escape(em)}`));
    lead.addresses?.forEach(addr => {
      lines.push(`ADR;TYPE=${addr.address_type?.toUpperCase() || 'WORK'}:;;${escape(addr.address_text)};${escape(addr.city)};${escape(addr.state)};;${escape(addr.country)}`);
    });
    lead.websites?.forEach(w => w.website_url && lines.push(`URL:${w.website_url}`));
    if (lead.discussion_summary) lines.push(`NOTE:${escape(lead.discussion_summary)}`);
    lines.push('END:VCARD');
    const vcf = lines.join('\r\n');
    const filename = `${(display || 'contact').replace(/\s+/g, '_')}.vcf`;
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    if (navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: 'text/vcard' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; }
        catch (err: any) { if (err?.name === 'AbortError') return; }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    toast.success('Contact saved — open to import');
  };

  const buildShareText = () => {
    if (!lead) return '';
    const lines: string[] = [];
    if (lead.primary_visitor_name) lines.push(lead.primary_visitor_name);
    if (lead.primary_visitor_designation) lines.push(lead.primary_visitor_designation);
    if (lead.company_name) lines.push(lead.company_name);
    lines.push('');
    if (lead.primary_visitor_phone) lines.push(`Phone: ${lead.primary_visitor_phone}`);
    if (lead.primary_visitor_email) lines.push(`Email: ${lead.primary_visitor_email}`);
    if (lead.websites?.[0]?.website_url) lines.push(`Website: ${lead.websites[0].website_url}`);
    if (lead.addresses?.[0]) {
      const a = lead.addresses[0];
      const parts = [a.address_text, a.city, a.state].filter(Boolean);
      if (parts.length) lines.push(`Address: ${parts.join(', ')}`);
    }
    if (lead.exhibition_name) { lines.push(''); lines.push(`Met at: ${lead.exhibition_name}`); }
    return lines.join('\n').trim();
  };

  const handleShare = () => {
    if (!lead) return;
    setShowShareModal(true);
  };

  const handleShareVia = async () => {
    const text = buildShareText();
    setShowShareModal(false);
    try {
      await navigator.share({ title: lead?.company_name || lead?.primary_visitor_name || 'Lead', text });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      toast.error('Could not open share sheet');
    }
  };

  const handleCopyDetails = async () => {
    const text = buildShareText();
    setShowShareModal(false);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Lead details copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const openEmail = async (email: string) => {
    // Set href synchronously so browser treats it as a direct user-gesture
    window.location.href = `mailto:${email}`;
    // Also copy to clipboard as fallback (if mail client isn't configured)
    try {
      await navigator.clipboard.writeText(email);
      toast.success(`Copied to clipboard: ${email}`, { duration: 3000 });
    } catch {
      toast(email, { duration: 3000 });
    }
  };

  // ── Loading / not found ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-3">Lead not found</p>
          <Button variant="outline" onClick={() => router.push('/leads')}>Back to Leads</Button>
        </div>
      </div>
    );
  }

  const initials = (lead.primary_visitor_name || lead.company_name || '?')
    .split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

  const priorityColor = lead.priority === 'high' ? 'text-destructive' : lead.priority === 'medium' ? 'text-warning' : lead.priority === 'low' ? 'text-success' : 'text-muted-foreground';

  const inputCls = 'w-full px-3 py-2 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-ring/30 bg-secondary/50 focus:bg-card transition';

  // Read-only display — recording or changing codes stays on the order page,
  // where the coupon count and the advance that earns it live together.
  let couponCodes: string[] = [];
  try { couponCodes = lead.coupon_numbers ? JSON.parse(lead.coupon_numbers) : []; } catch { /* leave empty */ }

  return (
    <div className="bg-background min-h-full">

      {/* ── Sticky Header ── */}
      <div className="sticky top-0 z-20 bg-card/90 backdrop-blur-sm border-b border-border">
        <div className="px-4 md:px-6 py-3.5 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8 shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {lead.primary_visitor_name || 'Lead Details'}
            </p>
            {lead.company_name && (
              <p className="text-xs text-muted-foreground truncate">{lead.company_name}</p>
            )}
            {lead.order_status && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5',
                  ORDER_STATUS_STYLES[lead.order_status] || 'bg-secondary text-muted-foreground')}>
                  {ORDER_STATUS_LABELS[lead.order_status] || lead.order_status}
                </span>
                <span className="text-[11px] font-semibold text-foreground tabular">
                  {money(lead.order_value ?? 0)}
                </span>
              </div>
            )}
            {couponCodes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                <Ticket className="w-3 h-3 text-warning shrink-0" />
                {couponCodes.map(code => (
                  <span key={code} className="text-[10px] font-mono font-semibold bg-warning/[0.1] text-warning rounded px-1.5 py-0.5">
                    {code}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isEditing ? (
              <>
                <Button size="sm" variant="ghost" onClick={handleEditToggle} className="h-8 text-xs gap-1">
                  <X className="w-3.5 h-3.5" /> Cancel
                </Button>
                <Button size="sm" onClick={handleSaveEdit} variant="success" className="h-8 text-xs gap-1">
                  <Check className="w-3.5 h-3.5" /> Save
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={handleEditToggle} className="h-8 text-xs gap-1">
                <Edit3 className="w-3.5 h-3.5" /> Edit
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-4 md:px-6 py-5 pb-24 md:pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

          {/* ── RIGHT COLUMN (shown first on mobile) ── */}
          <div className="space-y-4 lg:hidden">
            {lead.priority && (
              <BlurFade delay={0.05} inView>
                <Card className="shadow-sm border-border">
                  <CardHeader className="pb-3 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center">
                        <Zap className="w-4 h-4 text-primary" />
                      </span>
                      Lead Intelligence
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5 space-y-2">
                    <div>
                      {lead.priority && (
                        <div className={cn('p-3 rounded-xl', {
                          'bg-destructive/[0.07]': lead.priority === 'high',
                          'bg-warning/[0.07]': lead.priority === 'medium',
                          'bg-success/[0.07]': lead.priority === 'low',
                        })}>
                          <p className={cn('text-[10px] font-semibold uppercase tracking-wide mb-1', priorityColor)}>Priority</p>
                          <p className={cn('font-semibold capitalize text-sm', priorityColor)}>{lead.priority}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </BlurFade>
            )}

            <BlurFade delay={0.08} inView>
              <LeadMediaCard leadId={leadId} />
            </BlurFade>

            <BlurFade delay={0.11} inView>
              <LeadOrdersCard leadId={leadId} />
            </BlurFade>

            <BlurFade delay={0.115} inView>
              <LeadOrdersCard leadId={leadId} show="drafts" />
            </BlurFade>

            <BlurFade delay={0.08} inView>
              <Card className="shadow-sm border-border">
                <CardHeader className="pb-3 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center">
                      <Zap className="w-4 h-4 text-primary" />
                    </span>
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <div className="grid grid-cols-2 gap-2">
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={handleWhatsApp}
                      disabled={!lead.primary_visitor_phone && !lead.phones?.length}
                      className={cn(
                        'flex flex-col items-center justify-center gap-1.5 px-3 py-3 rounded-xl font-semibold text-xs transition-all',
                        !lead.primary_visitor_phone && !lead.phones?.length
                          ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                          : 'bg-success/15 text-success hover:bg-success/25'
                      )}
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                      </svg>
                      WhatsApp
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={handleAddToContact}
                      disabled={!lead.primary_visitor_name && !lead.primary_visitor_phone && !lead.company_name}
                      className={cn(
                        'flex flex-col items-center justify-center gap-1.5 px-3 py-3 rounded-xl font-semibold text-xs transition-all',
                        !lead.primary_visitor_name && !lead.primary_visitor_phone && !lead.company_name
                          ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                          : 'bg-primary/12 text-primary hover:bg-primary/25'
                      )}
                    >
                      <Users className="w-5 h-5" />Save Contact
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={handleShare}
                      className="col-span-2 flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-semibold text-xs bg-primary/12 text-primary hover:bg-primary/25 transition-all"
                    >
                      <Share2 className="w-4 h-4" />Share Lead Details
                    </motion.button>
                  </div>
                </CardContent>
              </Card>
            </BlurFade>

            <BlurFade delay={0.1} inView>
              <Card className="shadow-sm border-border">
                <CardContent className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Status</span>
                      <Badge variant={lead.status_code === 'confirmed' ? 'default' : 'secondary'}>
                        {lead.status_name || lead.status_code}
                      </Badge>
                    </div>
                    {lead.source_name && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Source</span>
                        <span className="text-foreground font-medium">{lead.source_name}</span>
                      </div>
                    )}
                    <span className="text-muted-foreground font-mono text-xs">#{lead.lead_id}</span>
                  </div>
                </CardContent>
              </Card>
            </BlurFade>

            {/* Visiting Card Images — mobile */}
            {(lead.front_image_path || lead.back_image_path) && (
              <BlurFade delay={0.12} inView>
                <Card className="shadow-sm border-border">
                  <CardHeader className="pb-3 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center">
                        <Image className="w-4 h-4 text-primary" />
                      </span>
                      Visiting Card
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5">
                    <div className="flex gap-3 flex-wrap">
                      {imageUrl(lead.front_image_path) && (
                        <div className="flex-1 min-w-[120px]">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Front</p>
                          <img
                            src={imageUrl(lead.front_image_path)!}
                            alt="Front of visiting card"
                            className="w-full rounded-xl border border-border cursor-pointer hover:opacity-90 transition object-contain max-h-40"
                            onClick={() => setLightboxImage(imageUrl(lead.front_image_path)!)}
                          />
                        </div>
                      )}
                      {imageUrl(lead.back_image_path) && (
                        <div className="flex-1 min-w-[120px]">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Back</p>
                          <img
                            src={imageUrl(lead.back_image_path)!}
                            alt="Back of visiting card"
                            className="w-full rounded-xl border border-border cursor-pointer hover:opacity-90 transition object-contain max-h-40"
                            onClick={() => setLightboxImage(imageUrl(lead.back_image_path)!)}
                          />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </BlurFade>
            )}
          </div>

          {/* ── LEFT COLUMN ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Contact Information */}
            <BlurFade delay={0.1} inView>
              <Card className="shadow-sm border-border">
                <CardHeader className="pb-3 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center">
                      <Users className="w-4 h-4 text-primary" />
                    </span>
                    Contact Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {isEditing ? (
                    <div className="space-y-3">
                      {[
                        { label: 'Name', key: 'primary_visitor_name', type: 'text', placeholder: 'Visitor name' },
                        { label: 'Designation', key: 'primary_visitor_designation', type: 'text', placeholder: 'Job title' },
                        { label: 'Agency', key: 'company_name', type: 'text', placeholder: 'Company name' },
                        { label: 'Phone', key: 'primary_visitor_phone', type: 'tel', placeholder: 'Phone number' },
                        { label: 'Email', key: 'primary_visitor_email', type: 'email', placeholder: 'Email address' },
                      ].map(({ label, key, type, placeholder }) => (
                        <div key={key}>
                          <label className="text-xs font-semibold text-muted-foreground mb-1 block">{label}</label>
                          <input
                            type={type}
                            value={(editForm as any)[key]}
                            onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
                            className={inputCls}
                            placeholder={placeholder}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-xl bg-primary/12 flex items-center justify-center text-primary font-bold text-base shrink-0">
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-foreground text-base">{lead.primary_visitor_name || '—'}</p>
                          {lead.primary_visitor_designation && (
                            <p className="text-sm text-muted-foreground">{lead.primary_visitor_designation}</p>
                          )}
                          {lead.company_name && (
                            <p className="text-sm font-semibold text-primary mt-1 flex items-center gap-1">
                              <Building2 className="w-3.5 h-3.5" />{lead.company_name}
                            </p>
                          )}
                          {lead.exhibition_name && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{lead.exhibition_name}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        {lead.primary_visitor_phone && (
                          <a href={`tel:${lead.primary_visitor_phone}`}
                            className="flex items-center gap-3 p-3 bg-primary/[0.07] hover:bg-primary/15 rounded-xl transition group">
                            <div className="w-9 h-9 bg-primary/12 rounded-lg flex items-center justify-center shrink-0">
                              <Phone className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <p className="text-[11px] text-muted-foreground">Phone</p>
                              <p className="text-sm font-semibold text-primary">{lead.primary_visitor_phone}</p>
                            </div>
                          </a>
                        )}
                        {lead.primary_visitor_email && (
                          <button
                            onClick={() => openEmail(lead.primary_visitor_email!)}
                            className="w-full flex items-center gap-3 p-3 bg-primary/[0.07] hover:bg-primary/12 rounded-xl transition text-left">
                            <div className="w-9 h-9 bg-primary/12 rounded-lg flex items-center justify-center shrink-0">
                              <Mail className="w-4 h-4 text-primary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] text-muted-foreground">Email · tap to compose</p>
                              <p className="text-sm font-semibold text-primary truncate">{lead.primary_visitor_email}</p>
                            </div>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </BlurFade>

            {/* Agency — hidden when empty rather than shown as an em-dash */}
            {(lead.company_name || lead.websites?.length || lead.addresses?.length) ? (
            <BlurFade delay={0.15} inView>
              <Card className="shadow-sm border-border">
                <CardHeader className="pb-3 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="w-7 h-7 bg-success/15 rounded-lg flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-success" />
                    </span>
                    Agency
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  <p className="font-semibold text-foreground">{lead.company_name || '—'}</p>
                  {lead.websites?.map(w => w.website_url && (
                    <a key={w.lead_website_id}
                      href={w.website_url.startsWith('http') ? w.website_url : `https://${w.website_url}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                      <Globe className="w-3.5 h-3.5 shrink-0" />{w.website_url}
                    </a>
                  ))}
                  {lead.addresses?.map(addr => (
                    <div key={addr.lead_address_id} className="text-sm text-muted-foreground">
                      {addr.address_type && (
                        <Badge variant="secondary" className="text-[10px] mb-1">{addr.address_type}</Badge>
                      )}
                      <p className="flex items-start gap-1 mt-1"><MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />{addr.address_text}</p>
                      {addr.city && <p className="text-muted-foreground text-xs ml-5">{addr.city}{addr.state && `, ${addr.state}`}</p>}
                    </div>
                  ))}

                </CardContent>
              </Card>
            </BlurFade>
            ) : null}

            {/* Additional phones + emails */}
            {((lead.phones?.length ?? 0) > 0 || (lead.emails?.length ?? 0) > 0) && (
              <BlurFade delay={0.2} inView>
                <Card className="shadow-sm border-border">
                  <CardHeader className="pb-3 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold text-foreground">All Contact Details</CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5 space-y-2">
                    {lead.phones?.map(p => (
                      <a key={p.lead_phone_id} href={`tel:${p.phone_number}`}
                        className="flex items-center justify-between p-2.5 bg-success/12 rounded-xl hover:bg-success/12 transition">
                        <span className="text-sm font-medium text-success flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5" />{p.phone_number}
                        </span>
                        {p.phone_type && <Badge variant="secondary" className="text-[10px]">{p.phone_type}</Badge>}
                      </a>
                    ))}
                    {lead.emails?.map(e => (
                      <button key={e.lead_email_id}
                        onClick={() => openEmail(e.email_address)}
                        className="w-full flex items-center p-2.5 bg-warning/12 rounded-xl hover:bg-warning/12 transition text-left">
                        <Mail className="w-3.5 h-3.5 text-warning mr-2 shrink-0" />
                        <span className="text-sm font-medium text-warning break-all">{e.email_address}</span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </BlurFade>
            )}

            {/* Brands */}
            {(lead.brands?.length ?? 0) > 0 && (
              <BlurFade delay={0.22} inView>
                <Card className="shadow-sm border-border">
                  <CardHeader className="pb-3 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Tag className="w-4 h-4 text-primary" />Associated Brands
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5 space-y-2">
                    {lead.brands?.map(b => (
                      <div key={b.lead_brand_id} className="flex items-center justify-between p-2.5 bg-primary/[0.07] rounded-xl">
                        <span className="font-medium text-primary text-sm">{b.brand_name}</span>
                        {b.relationship && <Badge variant="secondary" className="text-[10px]">{b.relationship}</Badge>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </BlurFade>
            )}

            {/* Additional contacts */}
            {lead.persons?.length > 0 && (
              <BlurFade delay={0.24} inView>
                <Card className="shadow-sm border-border">
                  <CardHeader className="pb-3 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />Additional Contacts
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5 space-y-2">
                    {lead.persons.map(p => (
                      <div key={p.lead_person_id} className="flex items-center gap-3 p-2.5 bg-secondary/50 rounded-xl">
                        <div className="w-9 h-9 bg-secondary rounded-lg flex items-center justify-center text-muted-foreground font-bold text-sm shrink-0">
                          {p.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-foreground">{p.name}</p>
                          {p.designation && <p className="text-xs text-muted-foreground">{p.designation}</p>}
                          {p.phone && <p className="text-xs text-primary">{p.phone}</p>}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </BlurFade>
            )}

            {/* Discussion */}
            {lead.discussion_summary && (
              <BlurFade delay={0.26} inView>
                <Card className="shadow-sm border-border">
                  <CardHeader className="pb-2 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" />Discussion Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5">
                    <p className="text-sm text-muted-foreground leading-relaxed">{lead.discussion_summary}</p>
                  </CardContent>
                </Card>
              </BlurFade>
            )}

            {/*
              Orders live at the foot of the wide column rather than in the
              narrow one. Two reasons: the left column ran out of content long
              before the right did, leaving a screen of nothing beside the
              sidebar; and an order list is a table of numbers that reads badly
              squeezed into a third of the width.
            */}
            <div className="hidden lg:block">
              <BlurFade delay={0.28} inView>
                <LeadOrdersCard leadId={leadId} />
              </BlurFade>
            </div>

          </div>

          {/* ── RIGHT COLUMN (desktop only) ── */}
          <div className="space-y-4 hidden lg:block">

            {/* Lead Intelligence */}
            {lead.priority && (
              <BlurFade delay={0.08} inView>
                <Card className="shadow-sm border-border">
                  <CardHeader className="pb-3 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center">
                        <Zap className="w-4 h-4 text-primary" />
                      </span>
                      Lead Intelligence
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5 space-y-2">
                    {lead.priority && (
                      <div className={cn('p-3 rounded-xl', {
                        'bg-destructive/[0.07]': lead.priority === 'high',
                        'bg-warning/[0.07]': lead.priority === 'medium',
                        'bg-success/[0.07]': lead.priority === 'low',
                      })}>
                        <p className={cn('text-[10px] font-semibold uppercase tracking-wide mb-1', priorityColor)}>Priority</p>
                        <p className={cn('font-semibold capitalize text-sm', priorityColor)}>{lead.priority}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </BlurFade>
            )}

            <BlurFade delay={0.14} inView>
              <LeadMediaCard leadId={leadId} />
            </BlurFade>

            {/* Quick Actions */}
            <BlurFade delay={0.12} inView>
              <Card className="shadow-sm border-border">
                <CardHeader className="pb-3 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center">
                      <Zap className="w-4 h-4 text-primary" />
                    </span>
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-2.5">
                  {/* WhatsApp */}
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    onClick={handleWhatsApp}
                    disabled={!lead.primary_visitor_phone && !lead.phones?.length}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all',
                      !lead.primary_visitor_phone && !lead.phones?.length
                        ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                        : 'bg-success/15 text-success hover:bg-success/25'
                    )}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    {!lead.primary_visitor_phone && !lead.phones?.length ? 'No Phone' : 'Send WhatsApp'}
                  </motion.button>

                  {/* Add to Contact */}
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    onClick={handleAddToContact}
                    disabled={!lead.primary_visitor_name && !lead.primary_visitor_phone && !lead.company_name}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all',
                      !lead.primary_visitor_name && !lead.primary_visitor_phone && !lead.company_name
                        ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                        : 'bg-primary/12 text-primary hover:bg-primary/25'
                    )}
                  >
                    <Users className="w-4 h-4" />Add to Contacts
                  </motion.button>

                  {/* Share */}
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    onClick={handleShare}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm bg-primary/12 text-primary hover:bg-primary/25 transition-all"
                  >
                    <Share2 className="w-4 h-4" />Share Lead Details
                  </motion.button>
                </CardContent>
              </Card>
            </BlurFade>

            {/* Unfinished orders sit apart from placed ones: a draft is work in
                progress, not a sale, and listing the two together made a draft
                read as revenue beside the lead's totals. */}
            <BlurFade delay={0.15} inView>
              <LeadOrdersCard leadId={leadId} show="drafts" />
            </BlurFade>

            {/* Status info */}
            <BlurFade delay={0.16} inView>
              <Card className="shadow-sm border-border">
                <CardContent className="px-5 py-4 space-y-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Status</span>
                    <Badge variant={lead.status_code === 'confirmed' ? 'default' : 'secondary'} className="text-xs">
                      {lead.status_name || lead.status_code}
                    </Badge>
                  </div>
                  {lead.source_name && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Source</span>
                      <span className="text-foreground font-medium text-sm">{lead.source_name}</span>
                    </div>
                  )}
                  {lead.exhibition_name && (
                    <div className="flex items-start justify-between text-sm gap-2">
                      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide shrink-0">Exhibition</span>
                      <span className="text-foreground font-medium text-xs text-right">{lead.exhibition_name}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-border">
                    <span className="text-muted-foreground text-xs">Lead ID</span>
                    <span className="text-muted-foreground font-mono text-xs">#{lead.lead_id}</span>
                  </div>
                </CardContent>
              </Card>
            </BlurFade>

            {/* Visiting Card Images */}
            {(lead.front_image_path || lead.back_image_path) && (
              <BlurFade delay={0.18} inView>
                <Card className="shadow-sm border-border">
                  <CardHeader className="pb-3 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center">
                        <Image className="w-4 h-4 text-primary" />
                      </span>
                      Visiting Card
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5">
                    <div className="flex gap-3 flex-wrap">
                      {imageUrl(lead.front_image_path) && (
                        <div className="flex-1 min-w-[120px]">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Front</p>
                          <img
                            src={imageUrl(lead.front_image_path)!}
                            alt="Front of visiting card"
                            className="w-full rounded-xl border border-border cursor-pointer hover:opacity-90 transition object-contain max-h-40"
                            onClick={() => setLightboxImage(imageUrl(lead.front_image_path)!)}
                          />
                        </div>
                      )}
                      {imageUrl(lead.back_image_path) && (
                        <div className="flex-1 min-w-[120px]">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Back</p>
                          <img
                            src={imageUrl(lead.back_image_path)!}
                            alt="Back of visiting card"
                            className="w-full rounded-xl border border-border cursor-pointer hover:opacity-90 transition object-contain max-h-40"
                            onClick={() => setLightboxImage(imageUrl(lead.back_image_path)!)}
                          />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </BlurFade>
            )}

          </div>
        </div>
      </div>

      {/* ── Image Lightbox ── */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <img
            src={lightboxImage}
            alt="Visiting card"
            className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-card/20 hover:bg-card/30 rounded-full flex items-center justify-center text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* ── Share Options Modal ── */}
      <AnimatePresence>
        {showShareModal && (
          <motion.div
            key="share-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 sm:p-6"
            onClick={() => setShowShareModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.97 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <p className="text-base font-bold text-foreground">Share Lead Details</p>
                <button onClick={() => setShowShareModal(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="flex flex-col gap-2.5">
                {typeof navigator !== 'undefined' && !!navigator.share && (
                  <button
                    onClick={handleShareVia}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-primary/[0.07] hover:bg-primary/12 text-primary font-semibold text-sm transition-colors w-full"
                  >
                    <ExternalLink className="w-4 h-4 shrink-0" />
                    Share via...
                    <span className="ml-auto text-xs font-normal text-primary/70">WhatsApp, Mail…</span>
                  </button>
                )}
                <button
                  onClick={handleCopyDetails}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-secondary/50 hover:bg-secondary text-foreground font-semibold text-sm transition-colors w-full"
                >
                  <Copy className="w-4 h-4 shrink-0" />
                  Copy to Clipboard
                  <span className="ml-auto text-xs font-normal text-muted-foreground">Plain text</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
