'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import type { UserDto, Role } from '@/lib/types';
import { UserPlus, Edit2, Trash2, UserX, UserCheck, Loader2, X, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

const AVATAR_COLORS = [
  'from-primary to-primary',
  'from-primary to-primary',
  'from-[hsl(var(--chart-2))] to-[hsl(var(--chart-2))]',
  'from-[hsl(var(--chart-3))] to-[hsl(var(--chart-3))]',
  'from-[hsl(var(--chart-5))] to-[hsl(var(--chart-5))]',
  'from-primary to-primary',
];

interface UserForm {
  full_name: string;
  email: string;
  password: string;
  phone: string;
  role_id: string;
}

const emptyForm = (): UserForm => ({
  full_name: '', email: '', password: '', phone: '',
  role_id: '',
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
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);

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

  /**
   * Settled rather than all: these are two independent lists, and with
   * Promise.all a failure in either blanked both. That is how the Role
   * dropdown came to be empty — nothing was wrong with the roles, the users
   * call beside it had failed and taken them down with it.
   */
  const loadData = async () => {
    const [u, r] = await Promise.allSettled([api.getUsers(), api.getRoles()]);

    if (u.status === 'fulfilled') setUsers(u.value);
    else toast.error('Could not load users');

    if (r.status === 'fulfilled') setRoles(r.value);
    else toast.error('Could not load roles');

    setLoading(false);
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
      toast.success('User deactivated');
      setDeletingUser(null);
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to deactivate user');
    } finally { setDeleting(false); }
  };

  const handleReactivate = async (user: UserDto) => {
    setReactivatingId(user.employee_id);
    try {
      await api.reactivateUser(user.employee_id);
      toast.success(`${user.full_name} reactivated`);
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to reactivate user');
    } finally { setReactivatingId(null); }
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
  const activeCount = users.filter(u => u.is_active).length;
  const inactiveCount = users.length - activeCount;

  return (
    <div className="flex-1 overflow-y-auto bg-background min-h-screen">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-10 px-4 md:px-6 py-4 md:py-0 md:min-h-[65px] flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeCount} active user{activeCount !== 1 ? 's' : ''}
            {inactiveCount > 0 && ` · ${inactiveCount} deactivated`}
          </p>
        </div>
        <Button onClick={openCreate} className="bg-primary hover:bg-primary/90 text-white gap-2">
          <UserPlus className="w-4 h-4" /> Add User
        </Button>
      </div>

      {/* Users list */}
      <div className="max-w-full px-4 py-6 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No users yet. Create one to get started.</div>
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
                <Card className={`hover:shadow-md transition-shadow ${!user.is_active ? 'opacity-60' : ''}`}>
                  <CardContent className="p-0">
                    <div className="flex items-center gap-4 px-5 py-4">
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 text-white font-bold text-lg ${!user.is_active ? 'grayscale' : ''}`}>
                        {initial}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground">{user.full_name}</span>
                          {!user.is_active && (
                            <Badge variant="destructive" className="text-xs">Deactivated</Badge>
                          )}
                          {user.role_name ? (
                            <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">{user.role_name}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">No role</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
                        {(user.designation || user.phone) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[user.designation, user.phone].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>

                      {/* Actions — a deactivated user only gets reactivated,
                          not edited or reset from here; that stays a
                          deliberate second step once they are back. */}
                      <div className="flex items-center gap-1 shrink-0">
                        {user.is_active ? (
                          <>
                            <button
                              onClick={() => openResetPassword(user)}
                              className="p-2 text-muted-foreground hover:text-warning hover:bg-warning/12 rounded-lg transition"
                              title="Reset Password"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openEdit(user)}
                              className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeletingUser(user)}
                              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/12 rounded-lg transition"
                              title="Deactivate"
                            >
                              <UserX className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleReactivate(user)}
                            disabled={reactivatingId === user.employee_id}
                            className="p-2 text-muted-foreground hover:text-success hover:bg-success/12 rounded-lg transition disabled:opacity-50"
                            title="Reactivate"
                          >
                            {reactivatingId === user.employee_id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <UserCheck className="w-4 h-4" />}
                          </button>
                        )}
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
              className="bg-card rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-bold text-foreground">
                  {editingUser ? 'Edit User' : 'Add New User'}
                </h2>
                <button
                  onClick={() => { setShowCreateModal(false); setEditingUser(null); }}
                  className="p-2 text-muted-foreground hover:text-muted-foreground hover:bg-secondary rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {/* Full Name */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Full Name <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={form.full_name}
                    onChange={e => set('full_name', e.target.value)}
                    placeholder="John Doe"
                    className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Email <span className="text-destructive">*</span></label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    placeholder="john@example.com"
                    className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Password {editingUser ? <span className="text-muted-foreground font-normal">(leave blank to keep current)</span> : <span className="text-destructive">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => set('password', e.target.value)}
                      placeholder={editingUser ? '••••••••' : 'Min 6 characters'}
                      className="w-full border border-border rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Role */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Role</label>
                  <select
                    value={form.role_id}
                    onChange={e => set('role_id', e.target.value)}
                    className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 bg-card"
                  >
                    <option value="">— No role —</option>
                    {roles.map(r => (
                      <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
                    ))}
                  </select>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => set('phone', e.target.value)}
                    placeholder="+91 9876543210"
                    className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-border flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setShowCreateModal(false); setEditingUser(null); }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-primary hover:bg-primary/90 text-white"
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
              className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              <div className="w-12 h-12 bg-destructive/12 rounded-full flex items-center justify-center mx-auto mb-4">
                <UserX className="w-6 h-6 text-destructive" />
              </div>
              <h3 className="text-lg font-bold text-foreground text-center mb-2">Deactivate User?</h3>
              <p className="text-sm text-muted-foreground text-center mb-6">
                <span className="font-semibold text-foreground">{deletingUser.full_name}</span> will be deactivated and can no longer log in. Their history and past records are kept.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setDeletingUser(null)}>Cancel</Button>
                <Button className="flex-1 bg-destructive hover:bg-destructive text-white" onClick={handleDelete} disabled={deleting}>
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Deactivate'}
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
              className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              {/* Icon + title */}
              <div className="w-12 h-12 bg-warning/12 rounded-full flex items-center justify-center mx-auto mb-4">
                <KeyRound className="w-6 h-6 text-warning" />
              </div>
              <h3 className="text-lg font-bold text-foreground text-center mb-1">Reset Password</h3>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Set a new password for <span className="font-semibold text-foreground">{resetUser.full_name}</span>
              </p>

              {/* New password */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showResetPw ? 'text' : 'password'}
                    value={resetPassword}
                    onChange={e => setResetPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full border border-border rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showResetPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-foreground mb-1">Confirm Password</label>
                <input
                  type={showResetPw ? 'text' : 'password'}
                  value={resetConfirm}
                  onChange={e => setResetConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                {resetConfirm && resetPassword !== resetConfirm && (
                  <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                )}
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setResetUser(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-warning hover:bg-warning text-white"
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
