import { useLocation, useNavigate } from 'react-router-dom';
import { Home, PlusCircle, FileText, Settings } from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
  primary?: boolean;
}

const navItems: NavItem[] = [
  { path: '/dashboard', label: 'Home', icon: Home },
  { path: '/new', label: 'New', icon: PlusCircle, primary: true },
  { path: '/certificates', label: 'Certs', icon: FileText },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string): boolean => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  // Hide nav on public landing page, during inspection capture, and on auth pages
  if (
    location.pathname === '/' ||
    location.pathname.startsWith('/inspect/') ||
    location.pathname.startsWith('/sign-')
  ) {
    return null;
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t certvoice-border bg-certvoice-surface"
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Safe area spacer for notched devices */}
      <div className="flex items-center justify-around px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {navItems.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={`
                flex flex-col items-center justify-center gap-0.5 
                min-w-[4rem] px-3 py-1.5 rounded-xl
                transition-all duration-200 ease-out
                focus:outline-none focus-visible:ring-2 focus-visible:ring-certvoice-accent
                ${item.primary
                  ? active
                    ? 'bg-certvoice-accent text-white scale-105'
                    : 'bg-certvoice-accent/10 text-certvoice-accent'
                  : active
                    ? 'text-certvoice-accent'
                    : 'text-certvoice-muted hover:text-certvoice-accent/70'
                }
              `}
            >
              <Icon
                size={item.primary ? 26 : 22}
                strokeWidth={active ? 2.5 : 2}
                className="transition-all duration-200"
              />
              <span
                className={`
                  text-[0.65rem] leading-tight font-medium tracking-wide
                  ${active ? 'opacity-100' : 'opacity-70'}
                `}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
