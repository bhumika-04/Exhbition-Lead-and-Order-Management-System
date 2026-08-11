'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { getEmployee, hasPermission } from '@/lib/auth';
import {
  ScanLine, Building2, Users, BarChart3,
  FileSpreadsheet, LogOut, ChevronLeft, ChevronRight,
  UserCog, Shield, Package, ShoppingBag, Settings as SettingsIcon,
} from 'lucide-react';

// permission: null = always visible
const NAV_ITEMS = [
  { name: 'Scan',        path: '/chat',        icon: ScanLine,        permission: null },
  { name: 'Leads',       path: '/leads',       icon: Users,           permission: 'view_leads' },
  { name: 'Dashboard',   path: '/dashboard',   icon: BarChart3,       permission: 'view_dashboard' },
  { name: 'Exhibitions', path: '/exhibitions', icon: Building2,       permission: 'view_exhibitions' },
  { name: 'Orders',      path: '/orders',      icon: ShoppingBag,     permission: 'manage_orders' },
  { name: 'Report',      path: '/report',      icon: FileSpreadsheet, permission: 'view_report' },
  { name: 'Products',    path: '/products',    icon: Package,         permission: 'manage_products' },
  { name: 'Users',       path: '/users',       icon: UserCog,         permission: 'manage_users' },
  { name: 'Roles',       path: '/roles',       icon: Shield,          permission: 'manage_roles' },
  { name: 'Settings',    path: '/settings',    icon: SettingsIcon,    permission: 'manage_settings' },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [employeeName, setEmployeeName] = useState('');
  const [visibleItems, setVisibleItems] = useState(NAV_ITEMS);

  useEffect(() => {
    const emp = getEmployee();
    setEmployeeName(emp?.full_name ?? '');
    setVisibleItems(NAV_ITEMS.filter(item => {
      if (item.permission === null) return true;
      return hasPermission(item.permission);
    }));
  }, []);

  const initial = employeeName.trim().charAt(0).toUpperCase() || 'U';

  const handleLogout = () => {
    api.logout();
    router.push('/auth/login');
  };

  return (
    // Light rail rather than a dark one. A dark brown slab next to off-white
    // content was muddy, and swapping it for charcoal would just reintroduce the
    // cold/warm clash. Sitting a shade below the page keeps it distinct from the
    // content without becoming a second, competing block of colour.
    <aside
      className={`hidden md:flex flex-col bg-secondary/60 border-r border-border shrink-0 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand + collapse toggle */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-border md:min-h-[65px]">
        {!collapsed && (
          <div className="ml-1 overflow-hidden">
            <p className="text-sm font-semibold tracking-tight text-foreground truncate">Tejoo Fashion</p>
            <p className="text-[11px] text-muted-foreground leading-none mt-0.5">Exhibition Management</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-secondary transition shrink-0 ml-auto"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed
            ? <ChevronRight className="w-4 h-4 text-muted-foreground" />
            : <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          }
        </button>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
        {visibleItems.map(({ name, path, icon: Icon }) => {
          const active =
            pathname === path ||
            (path !== '/' && pathname.startsWith(path + '/'));
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              title={collapsed ? name : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-card hover:text-foreground'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{name}</span>}
            </button>
          );
        })}
      </nav>

      {/* Profile + Logout */}
      <div className="px-2 pb-3 pt-2 border-t border-border space-y-0.5">
        <button
          onClick={() => router.push('/profile')}
          title={collapsed ? 'Profile' : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
            pathname === '/profile'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-card hover:text-foreground'
          }`}
        >
          <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground shrink-0">
            {initial}
          </div>
          {!collapsed && (
            <span className="truncate">{employeeName || 'Profile'}</span>
          )}
        </button>

        <button
          onClick={handleLogout}
          title={collapsed ? 'Logout' : undefined}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
