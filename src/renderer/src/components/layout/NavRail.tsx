import { BarChart3, Clock, Gamepad2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';

type NavItem = {
  to: string;
  Icon: typeof Gamepad2;
  size: number;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/games', Icon: Gamepad2, size: 22, label: 'Games' },
  { to: '/sessions', Icon: Clock, size: 21, label: 'Sessions' },
  { to: '/stats', Icon: BarChart3, size: 21, label: 'Stats' },
];

export const NavRail = (): React.JSX.Element => (
  <div
    className="relative z-2 flex w-15.5 flex-none flex-col items-center gap-1.5 border-r border-border py-3.5 backdrop-blur-md"
    style={{ background: 'rgba(13,15,14,.925)' }}
  >
    <div
      className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-[10px]"
      style={{
        background: 'linear-gradient(150deg,#2fdc7e,#16a35a)',
        boxShadow: '0 4px 14px rgba(47,220,126,.32)',
      }}
    >
      <Gamepad2 size={20} color="#08120c" />
    </div>

    {NAV_ITEMS.map(({ to, Icon, size, label }) => (
      <NavLink
        key={to}
        to={to}
        title={label}
        className="relative flex h-10.5 w-10.5 items-center justify-center rounded-[11px]"
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <>
                <div
                  className="absolute inset-0 rounded-[11px]"
                  style={{ background: 'rgba(255,255,255,.07)' }}
                />
                <div
                  className="absolute top-2.75 bottom-2.75 w-0.75 rounded-[3px]"
                  style={{ left: '-14px', background: 'rgba(255,255,255,.5)' }}
                />
              </>
            )}
            <div className="relative z-1">
              <Icon size={size} color={isActive ? '#e9ebe9' : 'var(--muted-foreground)'} />
            </div>
          </>
        )}
      </NavLink>
    ))}
  </div>
);
