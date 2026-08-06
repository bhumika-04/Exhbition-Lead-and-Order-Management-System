'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import type { UserDto, Role } from '@/lib/types';
import { UserPlus, Edit2, Trash2, Loader2, X, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

const AVATAR_COLORS = [
  'from-blue-500 to-blue-700',
  'from-violet-500 to-purple-700',
  'from-emerald-500 to-teal-700',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-700',
  'from-cyan-500 to-sky-700',
];

interface UserForm {
  full_name: string;
  email: string;
  password: string;
  phone: string;
  designation: string;
  company_name: string;
  role_id: string;
}

const emptyForm = (): UserForm => ({
  full_name: '', email: '', password: '', phone: '',
  designation: '', company_name: '', role_id: '',
});

export default function UsersPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDto | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserDto | null>(null);
  const [resetUser, setResetUser] = useState<UserDto | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [form, setForm] = useState<UserForm>(emptyForm());

  const set = (field: keyof UserForm, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('manage_users')) { router.replace('/access-denied?from=/users'); return; }
    loadData();
  }, [mounted, router]);

  const loadData = async () => {
    try {
      const [u, r] = await Promise.all([api.getUsers(), api.getRoles()]);
      setUsers(u);
      setRoles(r);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setForm(emptyForm());
    setShowPassword(false);
    setShowCreateModal(true);
  };

  const openEdit = (user: UserDto) => {
    setForm({
      full_name:    user.full_name,
      email:        user.email,
      password:     '',
      phone:        user.phone || '',
      designation:  user.designation || '',
      company_name: user.company_name || '',
      role_id:      user.role_id?.toString() || '',
    });
    setShowPassword(false);
    setEditingUser(user);
  };

  const handleCreate = async () => {
    if (!form.full_name.trim()) { toast.error('Full name is required'); return; }
    if (!form.email.trim()) { toast.error('Email is required'); return; }
    if (!form.password.trim()) { toast.error('Password is required'); return; }
    setSaving(true);
    try {
      await api.createUser({
        full_name:    form.full_name,
        email:        form.email,
        password:     form.password,
        phone:        form.phone || undefined,
        designation:  form.designation || undefined,
        company_name: form.company_name || undefined,
        role_id:      form.role_id ? parseInt(form.role_id) : null,
      });
      toast.success('User created successfully');
      setShowCreateModal(false);
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to create user');
    } finally { setSaving(false); }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    if (!form.full_name.trim()) { toast.error('Full name is required'); return; }
    if (!form.email.trim()) { toast.error('Email is required'); return; }
    setSaving(true);
    try {
      await api.updateUser(editingUser.employee_id, {
        full_name:    form.full_name,
        email:        form.email,
        phone:        form.phone || undefined,
        designation:  form.designation || undefined,
        company_name: form.company_name || undefined,
        role_id:      form.role_id ? parseInt(form.role_id) : null,
        password:     form.password || undefined,
      });
      toast.success('User updated successfully');
      setEditingUser(null);
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to update user');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    setDeleting(true);
    try {
      await api.deleteUser(deletingUser.employee_id);
      toast.success('User deleted');
      setDeletingUser(null);
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to delete user');
    } finally { setDeleting(false); }
  };

  const openResetPassword = (user: UserDto) => {
    setResetPassword('');
    setResetConfirm('');
    setShowResetPw(false);
    setResetUser(user);
  };

  const handleResetPassword = async () => {
    if (!resetUser) return;
    if (!resetPassword.trim()) { toast.error('New password is required'); return; }
    if (resetPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (resetPassword !== resetConfirm) { toast.error('Passwords do not match'); return; }
    setResetting(true);
    try {
      await api.resetUserPassword(resetUser.employee_id, resetPassword);
      toast.success(`Password reset for ${resetUser.full_name}`);
      setResetUser(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to reset password');
    } finally { setResetting(false); }
  };

  if (!mounted) return null;

  const modalOpen = showCreateModal || !!editingUser;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10 px-4 md:px-6 py-4 md:py-0 md:min-h-[65px] flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">User Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">{users.length} active user{users.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
          <UserPlus className="w-4 h-4" /> Add User
        </Button>
      </div>

      {/* Users list */}
      <div className="max-w-full px-4 py-6 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-20 text-slate-500">No users yet. Create one to get started.</div>
        ) : (
          users.map((user, idx) => {
            const gradient = AVATAR_COLORS[idx % AVATAR_COLORS.length];
            const initial = user.full_name.trim().charAt(0).toUpperCase();
            return (
              <motion.div
                key={user.employee_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-0">
                    <div className="flex items-center gap-4 px-5 py-4">
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 text-white font-bold text-lg`}>
                        {initial}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800">{user.full_name}</span>
                          {user.role_name ? (
                            <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700">{user.role_name}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-slate-400">No role</Badge>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 mt-0.5">{user.email}</p>
                        {(user.designation || user.phone) && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {[user.designation, user.phone].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openResetPassword(user)}
                          className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                          title="Reset Password"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEdit(user)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingUser(user)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={e => { if (e.target === e.currentTarget) { setShowCreateModal(false); setEditingUser(null); } }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-800">
                  {editingUser ? 'Edit User' : 'Add New User'}
                </h2>
                <button
                  onClick={() => { setShowCreateModal(false); setEditingUser(null); }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {/* Full Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Full Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.full_name}
                    onChange={e => set('full_name', e.target.value)}
                    placeholder="John Doe"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    placeholder="john@example.com"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Password {editingUser ? <span className="text-slate-400 font-normal">(leave blank to keep current)</span> : <span className="text-red-500">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => set('password', e.target.value)}
                      placeholder={editingUser ? '••••••••' : 'Min 6 characters'}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Role */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                  <select
                    value={form.role_id}
                    onChange={e => set('role_id', e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">— No role —</option>
                    {roles.map(r => (
                      <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
                    ))}
                  </select>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => set('phone', e.target.value)}
                    placeholder="+91 9876543210"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Designation */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Designation</label>
                  <input
                    type="text"
                    value={form.designation}
                    onChange={e => set('designation', e.target.value)}
                    placeholder="Sales Manager"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Company */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
                  <input
                    type="text"
                    value={form.company_name}
                    onChange={e => set('company_name', e.target.value)}
                    placeholder="Acme Corp"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setShowCreateModal(false); setEditingUser(null); }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={editingUser ? handleUpdate : handleCreate}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingUser ? 'Save Changes' : 'Create User'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirm */}
      <AnimatePresence>
        {deletingUser && (
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
              <h3 className="text-lg font-bold text-slate-800 text-center mb-2">Delete User?</h3>
              <p className="text-sm text-slate-500 text-center mb-6">
                <span className="font-semibold text-slate-700">{deletingUser.full_name}</span> will be deactivated and can no longer log in.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setDeletingUser(null)}>Cancel</Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete} disabled={deleting}>
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Password Modal */}
      <AnimatePresence>
        {resetUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={e => { if (e.target === e.currentTarget) setResetUser(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              {/* Icon + title */}
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <KeyRound className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 text-center mb-1">Reset Password</h3>
              <p className="text-sm text-slate-500 text-center mb-6">
                Set a new password for <span className="font-semibold text-slate-700">{resetUser.full_name}</span>
              </p>

              {/* New password */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showResetPw ? 'text' : 'password'}
                    value={resetPassword}
                    onChange={e => setResetPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showResetPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
                <input
                  type={showResetPw ? 'text' : 'password'}
                  value={resetConfirm}
                  onChange={e => setResetConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                {resetConfirm && resetPassword !== resetConfirm && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setResetUser(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                  onClick={handleResetPassword}
                  disabled={resetting || !resetPassword || resetPassword !== resetConfirm}
                >
                  {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reset Password'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
