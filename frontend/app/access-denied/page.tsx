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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-md p-8 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 200 }}
          className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6"
        >
          <ShieldOff className="w-10 h-10 text-red-500" />
        </motion.div>

        <h1 className="text-2xl font-bold text-slate-800 mb-2">Access Denied</h1>
        <p className="text-slate-500 text-sm leading-relaxed mb-2">
          You don&apos;t have permission to view this page.
        </p>

        {from && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 mb-4 inline-block">
            <span className="text-xs text-slate-400 font-medium">Attempted: </span>
            <span className="text-xs text-slate-600 font-mono">{from}</span>
          </div>
        )}

        {employeeName && (
          <p className="text-sm text-slate-500 mb-6">
            Logged in as <span className="font-semibold text-slate-700">{employeeName}</span>
            {roleName && (
              <> · <span className="text-blue-600 font-medium">{roleName}</span></>
            )}
          </p>
        )}

        <p className="text-xs text-slate-400 mb-8">
          Contact your administrator if you believe this is a mistake.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.replace('/chat')}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-xl transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            Go to Scan Page
          </button>
          <button
            onClick={logout}
            className="flex items-center justify-center gap-2 text-slate-500 hover:text-red-600 hover:bg-red-50 font-medium py-3 px-6 rounded-xl border border-slate-200 transition-all"
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
