'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, LogIn, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login({ email, password });
      router.push('/chat');
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
        err.response?.data?.detail ||
        // A network failure is not a wrong password, and telling the operator it
        // is sends them hunting for the wrong problem.
        (err.message === 'Network Error'
          ? 'Could not reach the server. Check that the API is running.'
          : 'Invalid email or password.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* A single soft wash behind the card rather than a full-bleed gradient —
          the palette is a paper one, and a saturated background fought it. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-24 w-[420px] h-[420px] rounded-full bg-primary/[0.06] blur-3xl" />
        <div className="absolute -bottom-40 -left-24 w-[380px] h-[380px] rounded-full bg-primary/[0.04] blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-7">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tejoo-logo.png"
            alt="Tejoo"
            className="h-16 w-auto mx-auto mb-4 rounded-lg"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <h1 className="text-lg font-semibold text-foreground tracking-tight">
            Exhibition Lead &amp; Orders
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sign in to capture leads and take orders
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-sm p-6">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/25
                            bg-destructive/[0.07] px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-px" />
              <p className="text-xs text-destructive leading-relaxed">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                Email or phone
              </span>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground
                           placeholder:text-muted-foreground/60
                           focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-input transition"
                placeholder="you@company.com"
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                enterKeyHint="next"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full h-11 pl-3 pr-11 rounded-lg border border-border bg-card text-sm text-foreground
                             placeholder:text-muted-foreground/60
                             focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-input transition"
                  placeholder="Your password"
                  required
                  autoComplete="current-password"
                  enterKeyHint="go"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md
                             text-muted-foreground hover:text-foreground hover:bg-secondary transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading || !email.trim() || !password}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium text-sm
                         inline-flex items-center justify-center gap-2 shadow-sm
                         hover:bg-primary/90 hover:shadow active:translate-y-px
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40
                         disabled:opacity-50 disabled:pointer-events-none transition-all"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
                : <><LogIn className="w-4 h-4" /> Sign in</>}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-5">
          Tejoo Fashion Exhibition Management System
          <br />
          powered by Indus Analytics Private Limited
        </p>
      </div>
    </div>
  );
}
