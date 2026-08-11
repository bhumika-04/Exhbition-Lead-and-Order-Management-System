'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ShieldOff, ArrowLeft, LogOut } from 'lucide-react';
import { getEmployee, logout } from '@/lib/auth';

function AccessDeniedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [employeeName, setEmployeeName] = useState('');
  const [roleName, setRoleName] = useState('');

  const from = searchParams.get('from') || '';

  useEffect(() => {
    const emp = getEmployee();
    if (!emp) {
      router.replace('/auth/login');
      return;
    }
    setEmployeeName(emp.full_name || '');
    setRoleName((emp as any).role_name || '');
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-card rounded-3xl shadow-xl border border-border w-full max-w-md p-8 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 200 }}
          className="w-20 h-20 bg-destructive/12 rounded-full flex items-center justify-center mx-auto mb-6"
        >
          <ShieldOff className="w-10 h-10 text-destructive" />
        </motion.div>

        <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
        <p className="text-muted-foreground text-sm leading-relaxed mb-2">
          You don&apos;t have permission to view this page.
        </p>

        {from && (
          <div className="bg-secondary/50 border border-border rounded-xl px-4 py-2 mb-4 inline-block">
            <span className="text-xs text-muted-foreground font-medium">Attempted: </span>
            <span className="text-xs text-muted-foreground font-mono">{from}</span>
          </div>
        )}

        {employeeName && (
          <p className="text-sm text-muted-foreground mb-6">
            Logged in as <span className="font-semibold text-foreground">{employeeName}</span>
            {roleName && (
              <> · <span className="text-primary font-medium">{roleName}</span></>
            )}
          </p>
        )}

        <p className="text-xs text-muted-foreground mb-8">
          Contact your administrator if you believe this is a mistake.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.replace('/chat')}
            className="flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-medium py-3 px-6 rounded-xl transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            Go to Scan Page
          </button>
          <button
            onClick={logout}
            className="flex items-center justify-center gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/[0.07] font-medium py-3 px-6 rounded-xl border border-border transition-all"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function AccessDeniedPage() {
  return (
    <Suspense>
      <AccessDeniedContent />
    </Suspense>
  );
}
