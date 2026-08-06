'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { requireAuth, isSuperAdmin } from '@/lib/auth';
import { Building2, Plus, Users, X, Eye, EyeOff, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BlurFade } from '@/components/ui/blur-fade';
import { cn } from '@/lib/utils';

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<any | null>(null);
  const [companyUsers, setCompanyUsers] = useState<any[]>([]);
  const [showUsers, setShowUsers] = useState(false);

  useEffect(() => {
    try { requireAuth(); } catch { router.push('/auth/login'); return; }
    if (!isSuperAdmin()) { router.replace('/access-denied?from=/companies'); return; }
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    try {
      setCompanies(await api.getCompanies());
    } catch { toast.error('Failed to load companies'); }
    finally { setLoading(false); }
  };

  const handleViewUsers = async (company: any) => {
    setSelectedCompany(company);
    setShowUsers(true);
    try {
      setCompanyUsers(await api.getCompanyUsers(company.company_id));
    } catch { toast.error('Failed to load users'); }
  };

  const handleToggleActive = async (company: any) => {
    try {
      await api.updateCompany(company.company_id, {
        company_name: company.company_name,
        is_active: !company.is_active,
      });
      toast.success(`Company ${company.is_active ? 'deactivated' : 'activated'}`);
      loadCompanies();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-full">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10 md:min-h-[65px] flex items-center">
        <div className="px-4 md:px-6 py-4 md:py-0 flex items-center justify-between w-full">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Companies</h1>
            <p className="text-xs text-slate-400 mt-0.5">Super admin · Manage tenant companies</p>
          </div>
          <Button size="sm" onClick={() => setShowCreateForm(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> New Company
          </Button>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 space-y-4">
        {companies.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Building2 className="w-12 h-12 mx-auto mb-3 text-slate-200" />
            <p className="font-semibold">No companies yet</p>
            <p className="text-sm mt-1">Create your first company to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {companies.map((c, i) => (
              <BlurFade key={c.company_id} delay={0.05 * i} inView>
                <motion.div
                  whileHover={{ y: -2, boxShadow: '0 8px 24px -4px rgba(0,0,0,0.10)' }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    'bg-white rounded-2xl border shadow-sm p-5',
                    c.is_active ? 'border-slate-100' : 'border-slate-200 opacity-60'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded-full',
                      c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    )}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <h3 className="font-bold text-slate-900 mt-3 text-base">{c.company_name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    ID #{c.company_id} · Created {new Date(c.created_at).toLocaleDateString('en-IN')}
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 text-sm text-slate-600">
                    <Users className="w-4 h-4 text-slate-400" />
                    <span className="font-semibold">{c.user_count}</span>
                    <span className="text-slate-400">users</span>
                  </div>
                  <div className="flex gap-2 mt-4 pt-3 border-t border-slate-50">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs gap-1"
                      onClick={() => handleViewUsers(c)}
                    >
                      <Users className="w-3 h-3" /> View Users
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn('flex-1 text-xs gap-1', c.is_active ? 'text-red-500 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50')}
                      onClick={() => handleToggleActive(c)}
                    >
                      {c.is_active ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </motion.div>
              </BlurFade>
            ))}
          </div>
        )}
      </div>

      {/* Create Company Modal */}
      <AnimatePresence>
        {showCreateForm && <CreateCompanyModal onClose={() => setShowCreateForm(false)} onCreated={loadCompanies} />}
      </AnimatePresence>

      {/* Users Drawer */}
      <AnimatePresence>
        {showUsers && selectedCompany && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex justify-end z-50"
            onClick={() => setShowUsers(false)}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <p className="font-bold text-slate-900">{selectedCompany.company_name}</p>
                  <p className="text-xs text-slate-400">{companyUsers.length} users</p>
                </div>
                <button onClick={() => setShowUsers(false)} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {companyUsers.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No users yet</p>
                ) : companyUsers.map(u => (
                  <div key={u.employee_id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center font-bold text-blue-600 text-sm shrink-0">
                      {u.full_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{u.full_name}</p>
                      <p className="text-xs text-slate-400 truncate">{u.email}</p>
                    </div>
                    <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0',
                      u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                    )}>
                      {u.role_name || 'Admin'}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ company_name: '', admin_name: '', admin_email: '', admin_password: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.createCompany({
        company_name:   form.company_name,
        admin_email:    form.admin_email,
        admin_password: form.admin_password,
        admin_name:     form.admin_name || undefined,
      });
      toast.success(`Company "${form.company_name}" created`);
      onClose();
      onCreated();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create company');
    } finally { setLoading(false); }
  };

  const cls = 'w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">New Company</h2>
            <p className="text-xs text-slate-400">Creates the company + its first admin user</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Company Name <span className="text-red-400">*</span></label>
            <input type="text" value={form.company_name} onChange={e => set('company_name', e.target.value)} className={cls} placeholder="Acme Corp" required />
          </div>
          <hr className="border-slate-100" />
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">First Admin User</p>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Admin Name</label>
            <input type="text" value={form.admin_name} onChange={e => set('admin_name', e.target.value)} className={cls} placeholder="John Doe" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Admin Email <span className="text-red-400">*</span></label>
            <input type="email" value={form.admin_email} onChange={e => set('admin_email', e.target.value)} className={cls} placeholder="admin@acme.com" required />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Admin Password <span className="text-red-400">*</span></label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={form.admin_password}
                onChange={e => set('admin_password', e.target.value)}
                className={cls + ' pr-10'}
                placeholder="Min 6 characters"
                minLength={6}
                required
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Creating…</> : <><Plus className="w-3.5 h-3.5 mr-1.5" />Create</>}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
