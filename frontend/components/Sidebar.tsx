'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { getEmployee, hasPermission } from '@/lib/auth';
import {
  ScanLine, Building2, Users, BarChart3,
  FileSpreadsheet, LogOut, ChevronLeft, ChevronRight,
  UserCog, Shield,
} from 'lucide-react';

// permission: null = always visible
const NAV_ITEMS = [
  { name: 'Scan',        path: '/chat',        icon: ScanLine,        permission: null },
  { name: 'Leads',       path: '/leads',       icon: Users,           permission: 'view_leads' },
  { name: 'Dashboard',   path: '/dashboard',   icon: BarChart3,       permission: 'view_dashboard' },
  { name: 'Exhibitions', path: '/exhibitions', icon: Building2,       permission: 'view_exhibitions' },
  { name: 'Report',      path: '/report',      icon: FileSpreadsheet, permission: 'view_report' },
  { name: 'Users',       path: '/users',       icon: UserCog,         permission: 'manage_users' },
  { name: 'Roles',       path: '/roles',       icon: Shield,          permission: 'manage_roles' },
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
    <aside
      className={`hidden md:flex flex-col bg-gray-900 text-white shrink-0 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand + collapse toggle */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-gray-800 md:min-h-[65px]">
        {!collapsed && (
          <div className="ml-1 overflow-hidden">
            <p className="text-sm font-bold tracking-tight text-white truncate">INDAS ELCS</p>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">Lead Capture</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-gray-800 transition shrink-0 ml-auto"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed
            ? <ChevronRight className="w-4 h-4 text-gray-400" />
            : <ChevronLeft className="w-4 h-4 text-gray-400" />
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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{name}</span>}
            </button>
          );
        })}
      </nav>

      {/* Profile + Logout */}
      <div className="px-2 pb-3 pt-2 border-t border-gray-800 space-y-0.5">
        <button
          onClick={() => router.push('/profile')}
          title={collapsed ? 'Profile' : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
            pathname === '/profile'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-400 hover:bg-gray-800 hover:text-white'
          }`}
        >
          <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
            {initial}
          </div>
          {!collapsed && (
            <span className="truncate">{employeeName || 'Profile'}</span>
          )}
        </button>

        <button
          onClick={handleLogout}
          title={collapsed ? 'Logout' : undefined}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
