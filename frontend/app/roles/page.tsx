'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission, isSuperAdmin } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { ALL_PERMISSIONS } from '@/lib/types';
import { Plus, Edit2, Trash2, Shield, Loader2, X, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

const ROLE_COLORS = [
  'from-blue-500 to-blue-700',
  'from-violet-500 to-purple-700',
  'from-emerald-500 to-teal-700',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-700',
  'from-cyan-500 to-sky-700',
];

interface RoleForm {
  role_name: string;
  description: string;
  permissions: string[];
}

const emptyForm = (): RoleForm => ({ role_name: '', description: '', permissions: [] });

export default function RolesPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const [expandedRole, setExpandedRole] = useState<number | null>(null);

  const [form, setForm] = useState<RoleForm>(emptyForm());

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('manage_roles')) { router.replace('/access-denied?from=/roles'); return; }
    loadRoles();
  }, [mounted, router]);

  const loadRoles = async () => {
    try { setRoles(await api.getRoles()); }
    catch { toast.error('Failed to load roles'); }
    finally { setLoading(false); }
  };

  const openCreate = () => {
    setForm(emptyForm());
    setShowCreateModal(true);
  };

  const openEdit = (role: Role) => {
    let perms: string[] = [];
    try { perms = JSON.parse(role.permissions); } catch { /* empty */ }
    setForm({ role_name: role.role_name, description: role.description || '', permissions: perms });
    setEditingRole(role);
  };

  const togglePermission = (key: string) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter(p => p !== key)
        : [...f.permissions, key],
    }));
  };

  const handleCreate = async () => {
    if (!form.role_name.trim()) { toast.error('Role name is required'); return; }
    setSaving(true);
    try {
      await api.createRole({ role_name: form.role_name, description: form.description || undefined, permissions: form.permissions });
      toast.success('Role created');
      setShowCreateModal(false);
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to create role');
    } finally { setSaving(false); }
  };

  const handleUpdate = async () => {
    if (!editingRole || !form.role_name.trim()) { toast.error('Role name is required'); return; }
    setSaving(true);
    try {
      await api.updateRole(editingRole.role_id, { role_name: form.role_name, description: form.description || undefined, permissions: form.permissions });
      toast.success('Role updated');
      setEditingRole(null);
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to update role');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deletingRole) return;
    setDeleting(true);
    try {
      await api.deleteRole(deletingRole.role_id);
      toast.success('Role deleted');
      setDeletingRole(null);
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to delete role');
    } finally { setDeleting(false); }
  };

  const getPermissions = (role: Role): string[] => {
    try { return JSON.parse(role.permissions); } catch { return []; }
  };

  if (!mounted) return null;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10 px-4 md:px-6 py-4 md:py-0 md:min-h-[65px] flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Role Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">{roles.length} role{roles.length !== 1 ? 's' : ''} defined</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Add Role
        </Button>
      </div>

      {/* Roles list */}
      <div className="max-w-full px-4 py-6 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : roles.length === 0 ? (
          <div className="text-center py-20 text-slate-500">No roles yet. Create one to get started.</div>
        ) : (
          roles.map((role, idx) => {
            const perms = getPermissions(role);
            const isExpanded = expandedRole === role.role_id;
            const gradient = ROLE_COLORS[idx % ROLE_COLORS.length];
            return (
              <motion.div
                key={role.role_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
              >
                <Card className="overflow-hidden hover:shadow-md transition-shadow">
                  <CardContent className="p-0">
                    {/* Role header row */}
                    <div className="flex items-start gap-3 px-4 py-4">
                      {/* Avatar */}
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 mt-0.5`}>
                        <Shield className="w-4 h-4 text-white" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800 leading-tight">{role.role_name}</span>
                          {isSuperAdmin() && role.company_name && (
                            <span className="text-[11px] font-medium bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full shrink-0">{role.company_name}</span>
                          )}
                          <Badge variant="secondary" className="text-[11px] shrink-0">{perms.length} permission{perms.length !== 1 ? 's' : ''}</Badge>
                        </div>
                        {role.description && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{role.description}</p>
                        )}
                        {/* Permission chips (collapsed preview) */}
                        {!isExpanded && perms.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {perms.slice(0, 3).map(p => {
                              const label = ALL_PERMISSIONS.find(x => x.key === p)?.label ?? p;
                              return <span key={p} className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{label}</span>;
                            })}
                            {perms.length > 3 && (
                              <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">+{perms.length - 3} more</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => setExpandedRole(isExpanded ? null : role.role_id)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                          title={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => openEdit(role)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingRole(role)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded permissions */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden border-t border-slate-100"
                        >
                          <div className="px-5 py-4 bg-slate-50">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Permissions</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {ALL_PERMISSIONS.map(({ key, label }) => {
                                const has = perms.includes(key);
                                return (
                                  <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${has ? 'bg-green-50 text-green-700' : 'bg-white text-slate-400 border border-slate-100'}`}>
                                    <Check className={`w-3.5 h-3.5 ${has ? 'opacity-100' : 'opacity-0'}`} />
                                    {label}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {(showCreateModal || editingRole) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={e => { if (e.target === e.currentTarget) { setShowCreateModal(false); setEditingRole(null); } }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-800">
                  {editingRole ? 'Edit Role' : 'Add New Role'}
                </h2>
                <button
                  onClick={() => { setShowCreateModal(false); setEditingRole(null); }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {/* Role Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.role_name}
                    onChange={e => setForm(f => ({ ...f, role_name: e.target.value }))}
                    placeholder="e.g. Sales Executive"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional description"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Permissions */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Permissions / Visibility</label>
                  <div className="space-y-2">
                    {ALL_PERMISSIONS.map(({ key, label }) => {
                      const checked = form.permissions.includes(key);
                      return (
                        <label
                          key={key}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer border transition-all ${
                            checked ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 transition-all ${
                            checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                          }`}>
                            {checked && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span className={`text-sm font-medium ${checked ? 'text-blue-800' : 'text-slate-600'}`}>{label}</span>
                          <input type="checkbox" className="sr-only" checked={checked} onChange={() => togglePermission(key)} />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Modal footer */}
              <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setShowCreateModal(false); setEditingRole(null); }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={editingRole ? handleUpdate : handleCreate}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingRole ? 'Save Changes' : 'Create Role'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirm Modal */}
      <AnimatePresence>
        {deletingRole && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 text-center mb-2">Delete Role?</h3>
              <p className="text-sm text-slate-500 text-center mb-6">
                <span className="font-semibold text-slate-700">{deletingRole.role_name}</span> will be deleted.
                Users assigned this role will have no role.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setDeletingRole(null)}>Cancel</Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete} disabled={deleting}>
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
