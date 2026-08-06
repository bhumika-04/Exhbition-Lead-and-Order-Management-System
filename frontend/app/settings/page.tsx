'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Settings as SettingsIcon, MessageSquare, Link2, Loader2, Save, Info,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { SETTING_KEYS, type AppSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    api.getSettings()
      .then(setSettings)
      .catch(() => toast.error('Could not load settings'))
      .finally(() => setLoading(false));
  }, [router]);

  const set = (key: string, value: string) => {
    setSettings(s => ({ ...s, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      setSettings(await api.saveSettings(settings));
      setDirty(false);
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>;
  }

  const autoSend = settings[SETTING_KEYS.welcomeAutoSend] !== 'false';

  return (
    <div className="px-4 md:px-6 py-5 space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
          <SettingsIcon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-900">Settings</h1>
          <p className="text-[11px] text-slate-400">WhatsApp templates and social links</p>
        </div>
        <Button onClick={save} disabled={saving || !dirty} className="h-9 gap-1.5 text-xs shrink-0">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </Button>
      </div>

      {/* Templates */}
      <Card className="border-slate-200">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Interakt templates
            </span>
          </div>

          <p className="text-[11px] text-slate-500 flex items-start gap-1.5 bg-slate-50 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400" />
            <span>
              Enter the <strong>approved template name</strong> exactly as it appears in Interakt.
              Templates must be approved by Meta before they can send. Leave a field blank to
              disable that message — it will be skipped and logged rather than failing.
            </span>
          </p>

          <Field
            label="Welcome"
            hint="Sent when a lead is created. Carries their team photo and your social links."
            value={settings[SETTING_KEYS.templateWelcome] ?? ''}
            onChange={v => set(SETTING_KEYS.templateWelcome, v)}
          />
          <Field
            label="Order confirmation"
            hint="Sent on confirming an order. Carries the Sales Order PDF."
            value={settings[SETTING_KEYS.templateOrderConfirmation] ?? ''}
            onChange={v => set(SETTING_KEYS.templateOrderConfirmation, v)}
          />
          <Field
            label="Testimonial"
            hint="Sent manually from the lead page with the testimonial link."
            value={settings[SETTING_KEYS.templateTestimonial] ?? ''}
            onChange={v => set(SETTING_KEYS.templateTestimonial, v)}
          />
          <Field
            label="OTP"
            hint="Verification code for self-service ordering. This must be an AUTHENTICATION template — a separate approval from the marketing ones above."
            value={settings[SETTING_KEYS.templateOtp] ?? ''}
            onChange={v => set(SETTING_KEYS.templateOtp, v)}
          />

          <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={e => set(SETTING_KEYS.welcomeAutoSend, e.target.checked ? 'true' : 'false')}
              className="w-4 h-4 rounded border-slate-300"
            />
            <span className="text-xs text-slate-600">
              Send the welcome message automatically when a lead is created
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Social links */}
      <Card className="border-slate-200">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Social links
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Included in the welcome message. Blank fields are left out.
          </p>

          <Field label="Website"   value={settings[SETTING_KEYS.socialWebsite] ?? ''}
                 onChange={v => set(SETTING_KEYS.socialWebsite, v)} placeholder="https://" />
          <Field label="Instagram" value={settings[SETTING_KEYS.socialInstagram] ?? ''}
                 onChange={v => set(SETTING_KEYS.socialInstagram, v)} placeholder="https://instagram.com/" />
          <Field label="Facebook"  value={settings[SETTING_KEYS.socialFacebook] ?? ''}
                 onChange={v => set(SETTING_KEYS.socialFacebook, v)} placeholder="https://facebook.com/" />
          <Field label="YouTube"   value={settings[SETTING_KEYS.socialYoutube] ?? ''}
                 onChange={v => set(SETTING_KEYS.socialYoutube, v)} placeholder="https://youtube.com/" />
        </CardContent>
      </Card>

      <div className="md:hidden h-20" />
    </div>
  );
}

function Field({ label, hint, value, onChange, placeholder }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm"
      />
      {hint && <span className="text-[10px] text-slate-400 mt-1 block leading-snug">{hint}</span>}
    </label>
  );
}
