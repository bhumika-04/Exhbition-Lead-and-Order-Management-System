'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { isAuthenticated, getEmployee } from '@/lib/auth';
import { User, Mail, Phone, Briefcase, Building2, Save, Loader2, MessageSquare, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

const DEFAULT_WA_TEMPLATE =
`Hello {name}{company},

It was great meeting you at {exhibition}! We are glad to have connected with you.

Looking forward to staying in touch.

Best regards,
{sender}
{sender_company}`;

interface ProfileForm {
  full_name: string;
  email: string;
  phone: string;
  designation: string;
  company_name: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [waTemplate, setWaTemplate] = useState(DEFAULT_WA_TEMPLATE);
  const [form, setForm] = useState<ProfileForm>({
    full_name:    '',
    email:        '',
    phone:        '',
    designation:  '',
    company_name: '',
  });

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/auth/login');
      return;
    }

    const employee = getEmployee();
    if (!employee) {
      router.push('/auth/login');
      return;
    }

    // Load WhatsApp template from localStorage
    const saved = localStorage.getItem('whatsapp_template');
    if (saved) setWaTemplate(saved);

    // Fetch fresh profile from API
    api.getProfile(employee.employee_id)
      .then((data) => {
        setForm({
          full_name:    data.full_name    ?? '',
          email:        data.email        ?? '',
          phone:        data.phone        ?? '',
          designation:  data.designation  ?? '',
          company_name: data.company_name ?? '',
        });
      })
      .catch(() => {
        // Fall back to localStorage values
        setForm({
          full_name:    employee.full_name    ?? '',
          email:        employee.email        ?? '',
          phone:        employee.phone        ?? '',
          designation:  employee.designation  ?? '',
          company_name: employee.company_name ?? '',
        });
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handleSave = async () => {
    const employee = getEmployee();
    if (!employee) return;

    if (!form.full_name.trim()) {
      toast.error('Name is required');
      return;
    }

    setSaving(true);
    try {
      await api.updateProfile(employee.employee_id, {
        full_name:    form.full_name.trim(),
        phone:        form.phone.trim()        || undefined,
        designation:  form.designation.trim()  || undefined,
        company_name: form.company_name.trim() || undefined,
      });

      // Re-fetch from DB to get the verified saved values, then update localStorage
      const fresh = await api.getProfile(employee.employee_id);
      const stored = localStorage.getItem('employee');
      localStorage.setItem('employee', JSON.stringify({
        ...(stored ? JSON.parse(stored) : {}),
        full_name:    fresh.full_name    ?? form.full_name.trim(),
        phone:        fresh.phone        ?? null,
        designation:  fresh.designation  ?? null,
        company_name: fresh.company_name ?? null,
      }));

      toast.success('Profile updated');
    } catch {
      toast.error('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const initials = form.full_name
    ? form.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-8">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 py-4 md:px-8 md:min-h-[65px] flex items-center gap-4">
        <h1 className="text-xl font-bold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your account details</p>
      </div>

      <div className="max-w-lg md:max-w-none mx-auto px-4 md:px-8 py-6 space-y-4">
        {/* Avatar card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Card className="border-0 shadow-sm">
            <CardContent className="flex items-center gap-4 pt-5 pb-5">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary flex items-center justify-center text-white text-xl font-bold shrink-0">
                {initials}
              </div>
              <div>
                <p className="font-semibold text-foreground text-base">{form.full_name || '—'}</p>
                {form.designation && (
                  <p className="text-sm text-muted-foreground">{form.designation}</p>
                )}
                {form.company_name && (
                  <p className="text-sm text-primary font-medium">{form.company_name}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Edit form */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 }}
        >
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2 pt-5 px-5">
              <p className="text-sm font-semibold text-foreground uppercase tracking-wide">Account Info</p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Full Name */}
                <Field
                  icon={<User className="w-4 h-4 text-muted-foreground" />}
                  label="Full Name"
                >
                  <input
                    type="text"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className="w-full text-foreground bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    placeholder="Your full name"
                  />
                </Field>

                {/* Email (read-only) */}
                <Field
                  icon={<Mail className="w-4 h-4 text-muted-foreground" />}
                  label="Email"
                  readOnly
                >
                  <span className="text-muted-foreground text-sm">{form.email || '—'}</span>
                </Field>

                {/* Phone */}
                <Field
                  icon={<Phone className="w-4 h-4 text-muted-foreground" />}
                  label="Phone"
                >
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full text-foreground bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    placeholder="Mobile number"
                  />
                </Field>

                {/* Designation */}
                <Field
                  icon={<Briefcase className="w-4 h-4 text-muted-foreground" />}
                  label="Designation"
                >
                  <input
                    type="text"
                    value={form.designation}
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                    className="w-full text-foreground bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    placeholder="Your job title"
                  />
                </Field>

                {/* Agency name */}
                <Field
                  icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
                  label="Agency Name"
                >
                  <input
                    type="text"
                    value={form.company_name}
                    onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                    className="w-full text-foreground bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    placeholder="Your company"
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* WhatsApp Template */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12 }}
        >
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2 pt-5 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-success" />
                  <p className="text-sm font-semibold text-foreground uppercase tracking-wide">WhatsApp Template</p>
                </div>
                <button
                  onClick={() => setWaTemplate(DEFAULT_WA_TEMPLATE)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground transition"
                  title="Reset to default"
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Placeholders: <code className="bg-secondary px-1 rounded">{'{name}'}</code>{' '}
                <code className="bg-secondary px-1 rounded">{'{company}'}</code>{' '}
                <code className="bg-secondary px-1 rounded">{'{exhibition}'}</code>{' '}
                <code className="bg-secondary px-1 rounded">{'{sender}'}</code>{' '}
                <code className="bg-secondary px-1 rounded">{'{sender_company}'}</code>
              </p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <textarea
                value={waTemplate}
                onChange={e => setWaTemplate(e.target.value)}
                rows={8}
                className="w-full text-sm text-foreground border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-success resize-none bg-secondary/50 focus:bg-card transition font-mono"
              />
              <Button
                onClick={() => {
                  localStorage.setItem('whatsapp_template', waTemplate);
                  toast.success('WhatsApp template saved');
                }}
                className="mt-3 h-9 px-5 bg-success hover:bg-success/90 text-success-foreground font-medium rounded-xl shadow-sm text-sm"
              >
                <Save className="w-4 h-4 mr-2" /> Save Template
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Save Profile */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.18 }}
          className=""
        >
          <Button
            onClick={handleSave}
            disabled={saving}
            className="h-9 px-6 bg-primary hover:bg-primary/90 text-white font-medium rounded-xl shadow-sm text-sm"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

// ── Helper component ──────────────────────────────────────────
function Field({
  icon,
  label,
  readOnly = false,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 ${
      readOnly ? 'bg-secondary/50 border-border' : 'border-border focus-within:border-input focus-within:ring-1 focus-within:ring-ring/30 transition'
    }`}>
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-none mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  );
}
