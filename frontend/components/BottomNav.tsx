'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ScanLine, Building2, Users, BarChart3, FileSpreadsheet,
  UserCog, Shield, MoreHorizontal, X, LogOut,
  ShoppingBag, Package, Settings as SettingsIcon,
} from 'lucide-react';
import { getEmployee, hasPermission } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

// Primary items in the bar
const PRIMARY_NAV = [
  { name: 'Scan',        path: '/chat',        icon: ScanLine,    permission: null },
  { name: 'Leads',       path: '/leads',       icon: Users,       permission: 'view_leads' },
  { name: 'Dashboard',   path: '/dashboard',   icon: BarChart3,   permission: 'view_dashboard' },
  { name: 'Exhibitions', path: '/exhibitions', icon: Building2,   permission: 'view_exhibitions' },
  { name: 'Orders',      path: '/orders',      icon: ShoppingBag, permission: 'manage_orders' },
];

// Everything else, in the "More" sheet. Products and Settings are here rather
// than nowhere — without them those screens are unreachable on a phone.
const SECONDARY_NAV = [
  { name: 'Report',   path: '/report',   icon: FileSpreadsheet, permission: 'view_report' },
  { name: 'Products', path: '/products', icon: Package,         permission: 'manage_products' },
  { name: 'Users',    path: '/users',    icon: UserCog,         permission: 'manage_users' },
  { name: 'Roles',    path: '/roles',    icon: Shield,          permission: 'manage_roles' },
  { name: 'Settings', path: '/settings', icon: SettingsIcon,    permission: 'manage_settings' },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [initial, setInitial] = useState('U');
  const [employeeName, setEmployeeName] = useState('');
  const [primaryItems, setPrimaryItems] = useState(PRIMARY_NAV);
  const [secondaryItems, setSecondaryItems] = useState(SECONDARY_NAV);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    const emp = getEmployee();
    setInitial(emp?.full_name?.trim().charAt(0).toUpperCase() || 'U');
    setEmployeeName(emp?.full_name || '');
    setPrimaryItems(PRIMARY_NAV.filter(item =>
      item.permission === null || hasPermission(item.permission)
    ));
    setSecondaryItems(SECONDARY_NAV.filter(item =>
      item.permission === null || hasPermission(item.permission)
    ));
  }, []);

  // "More" tab is active when current path is a secondary item or profile
  const isMoreActive = [...SECONDARY_NAV.map(i => i.path), '/profile'].some(
    p => pathname === p || pathname.startsWith(p + '/')
  );

  const navigate = (path: string) => {
    router.push(path);
    setShowMore(false);
  };

  const handleLogout = () => {
    api.logout();
    router.push('/auth/login');
    setShowMore(false);
  };

  return (
    <>
      {/* ── More Slide-up Panel ── */}
      <AnimatePresence>
        {showMore && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-black/40 z-40"
              onClick={() => setShowMore(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="md:hidden fixed bottom-16 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-50 px-4 pt-3 pb-8"
            >
              {/* Drag handle */}
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-3" />

              {/* Header row */}
              <div className="flex items-center justify-between mb-4 px-1">
                <p className="text-sm font-bold text-slate-800">More Options</p>
                <button
                  onClick={() => setShowMore(false)}
                  className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Secondary nav items grid */}
              {secondaryItems.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {secondaryItems.map(({ name, path, icon: Icon }) => {
                    const isActive = pathname === path || pathname.startsWith(path + '/');
                    return (
                      <button
                        key={path}
                        onClick={() => navigate(path)}
                        className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all active:scale-95 ${
                          isActive
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                        <span className="text-[11px] font-medium">{name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-slate-100 mb-3" />

              {/* Profile row */}
              <button
                onClick={() => navigate('/profile')}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all mb-2 active:scale-[0.98] ${
                  pathname === '/profile'
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${
                  pathname === '/profile' ? 'bg-blue-600' : 'bg-slate-400'
                }`}>
                  {initial}
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold">{employeeName || 'Profile'}</p>
                  <p className="text-xs text-slate-400">View &amp; edit profile</p>
                </div>
              </button>

              {/* Logout row */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-red-500 hover:bg-red-50 transition-all active:scale-[0.98]"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-sm font-medium">Logout</span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Bottom Nav Bar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
        <div className="flex justify-around items-center h-16 w-full">

          {primaryItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path + '/'));
            return (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full px-0.5 transition-all duration-200 transform active:scale-95 relative ${
                  isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className={`w-5 h-5 mb-0.5 shrink-0 transition-all duration-200 ${isActive ? 'scale-110' : ''}`} />
                {/* Six slots at 360px leaves ~58px each — "Exhibitions" needs
                    the smaller size and truncation to stay on one line. */}
                <span className="text-[9px] font-medium leading-tight w-full text-center truncate">
                  {item.name}
                </span>
                {isActive && <div className="absolute bottom-0 w-8 h-1 bg-blue-600 rounded-t-full" />}
              </button>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setShowMore(v => !v)}
            className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full px-0.5 transition-all duration-200 transform active:scale-95 relative ${
              isMoreActive || showMore ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <MoreHorizontal className={`w-5 h-5 mb-0.5 shrink-0 transition-all duration-200 ${isMoreActive || showMore ? 'scale-110' : ''}`} />
            <span className="text-[9px] font-medium leading-tight">More</span>
            {(isMoreActive || showMore) && (
              <div className="absolute bottom-0 w-8 h-1 bg-blue-600 rounded-t-full" />
            )}
          </button>

        </div>
      </nav>
    </>
  );
}
