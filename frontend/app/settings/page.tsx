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
import PageHeader from '@/components/PageHeader';

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
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" /></div>;
  }

  // Absent counts as off, so a database that predates 024 still behaves as documented.

  return (
    <>
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        subtitle="WhatsApp templates, self-service and social links"
        actions={
          <Button onClick={save} disabled={saving || !dirty} size="sm" className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>
        }
      />

      {/* Two columns from xl. A single 2xl-wide column left most of a desktop
          window empty, which read as an unfinished page rather than a short one.
          Masonry-style so the cards pack rather than aligning to the tallest. */}
      <div className="px-4 md:px-6 py-4 max-w-5xl
                      xl:columns-2 xl:gap-3 [&>*]:mb-3 xl:[&>*]:break-inside-avoid
                      space-y-3 xl:space-y-0">

      {/* Templates */}
      {/* Social links */}
      <Card className="border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Social links
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Kept for reference. The Instagram and showroom links now travel as
            buttons on the approved WhatsApp templates, not as message text.
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

      </div>
    </>
  );
}

function Field({ label, hint, value, onChange, placeholder }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
      />
      {hint && <span className="text-[10px] text-muted-foreground mt-1 block leading-snug">{hint}</span>}
    </label>
  );
}
