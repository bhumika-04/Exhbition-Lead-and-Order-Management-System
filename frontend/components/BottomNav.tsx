'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ScanLine, Building2, Users, BarChart3, FileSpreadsheet,
  UserCog, Shield, MoreHorizontal, X, LogOut,
  ShoppingBag, Package, Settings as SettingsIcon, Camera,
} from 'lucide-react';
import { getEmployee, hasPermission } from '@/lib/auth';
import { useKeyboardOpen } from '@/lib/useKeyboardOpen';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

// The bar carries only what a CRR touches repeatedly at a stall: capture a
// lead, look one up, take an order, attach a team photo. Four slots plus More
// keeps each a comfortable target at 360px instead of six cramped ones.
const PRIMARY_NAV = [
  { name: 'Scan',   path: '/chat',         icon: ScanLine,    permission: null },
  { name: 'Leads',  path: '/leads',        icon: Users,       permission: 'view_leads' },
  { name: 'Photos', path: '/leads/photos', icon: Camera,      permission: 'view_leads' },
  { name: 'Orders', path: '/orders',       icon: ShoppingBag, permission: 'manage_orders' },
];

// Everything consulted rather than operated. Dashboard and Exhibitions sit here
// because they are read a few times a day, not per visitor.
const SECONDARY_NAV = [
  { name: 'Dashboard',   path: '/dashboard',   icon: BarChart3,       permission: 'view_dashboard' },
  { name: 'Exhibitions', path: '/exhibitions', icon: Building2,       permission: 'view_exhibitions' },
  { name: 'Report',      path: '/report',      icon: FileSpreadsheet, permission: 'view_report' },
  { name: 'Products',    path: '/products',    icon: Package,         permission: 'manage_products' },
  { name: 'Users',       path: '/users',       icon: UserCog,         permission: 'manage_users' },
  { name: 'Roles',       path: '/roles',       icon: Shield,          permission: 'manage_roles' },
  { name: 'Settings',    path: '/settings',    icon: SettingsIcon,    permission: 'manage_settings' },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [initial, setInitial] = useState('U');
  const [employeeName, setEmployeeName] = useState('');
  const [primaryItems, setPrimaryItems] = useState(PRIMARY_NAV);
  const [secondaryItems, setSecondaryItems] = useState(SECONDARY_NAV);
  const [showMore, setShowMore] = useState(false);
  const keyboardOpen = useKeyboardOpen();

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

  // Longest-matching primary path wins — see the comment at its one use below.
  const activePrimaryPath = primaryItems
    .map(i => i.path)
    .filter(p => pathname === p || pathname.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];

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
      {/* More slide-up panel */}
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
              className="md:hidden fixed bottom-16 left-0 right-0 bg-card rounded-t-2xl shadow-lg border-t border-border z-50 px-4 pt-3 pb-8"
            >
              {/* Drag handle */}
              <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />

              {/* Header row */}
              <div className="flex items-center justify-between mb-4 px-1">
                <p className="text-sm font-semibold text-foreground">More Options</p>
                <button
                  onClick={() => setShowMore(false)}
                  className="p-1.5 rounded-full hover:bg-secondary text-muted-foreground"
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
                            ? 'bg-primary/10 text-primary'
                            : 'bg-secondary/60 text-muted-foreground hover:bg-secondary'
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
              <div className="border-t border-border mb-3" />

              {/* Profile row */}
              <button
                onClick={() => navigate('/profile')}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all mb-2 active:scale-[0.98] ${
                  pathname === '/profile'
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-secondary/60'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${
                  pathname === '/profile' ? 'bg-primary' : 'bg-muted-foreground'
                }`}>
                  {initial}
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold">{employeeName || 'Profile'}</p>
                  <p className="text-xs text-muted-foreground">View &amp; edit profile</p>
                </div>
              </button>

              {/* Logout row */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-destructive hover:bg-destructive/12 transition-all active:scale-[0.98]"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-sm font-medium">Logout</span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom nav bar.
          Hidden while the keyboard is up: it is fixed to the bottom, so it
          otherwise sits directly over the field being typed into — worst on the
          order form, where the quantity grid is near the foot of the page.
          Translated rather than unmounted so the tab order and scroll position
          survive, and so it slides back rather than popping. */}
      <nav
        aria-hidden={keyboardOpen}
        className={`md:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md
                    border-t border-border z-50 transition-transform duration-200 ${
          keyboardOpen ? 'translate-y-full pointer-events-none' : 'translate-y-0'
        }`}
      >
        <div className="flex justify-around items-center h-16 w-full">

          {primaryItems.map((item) => {
            const Icon = item.icon;
            // Longest-matching path wins, so /leads/photos lights up only
            // "Photos" and not also its "Leads" parent.
            const isActive = item.path === activePrimaryPath;
            return (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full px-0.5 transition-all duration-200 transform active:scale-95 relative ${
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className={`w-5 h-5 mb-0.5 shrink-0 transition-all duration-200 ${isActive ? 'scale-110' : ''}`} />
                {/* Four slots at 360px leaves ~88px each, so the labels can go
                    back to a readable size. They were 9px to fit six. */}
                <span className="text-[11px] font-medium leading-tight w-full text-center truncate">
                  {item.name}
                </span>
                {isActive && <div className="absolute bottom-0 w-8 h-1 bg-primary rounded-t-full" />}
              </button>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setShowMore(v => !v)}
            className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full px-0.5 transition-all duration-200 transform active:scale-95 relative ${
              isMoreActive || showMore ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MoreHorizontal className={`w-5 h-5 mb-0.5 shrink-0 transition-all duration-200 ${isMoreActive || showMore ? 'scale-110' : ''}`} />
            <span className="text-[11px] font-medium leading-tight">More</span>
            {(isMoreActive || showMore) && (
              <div className="absolute bottom-0 w-8 h-1 bg-primary rounded-t-full" />
            )}
          </button>

        </div>
      </nav>
    </>
  );
}
