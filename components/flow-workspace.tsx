'use client';
import type { ComponentProps, ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import './flow-workspace.css';
import { useTranslation } from '@/lib/i18n/react';
export function FlowWorkspace({
  navigation,
  rail,
  queue,
  active,
  navScale,
  collapsed,
  onToggle,
  children,
  ...props
}: ComponentProps<'main'> & {
  navigation: ReactNode;
  rail: ReactNode;
  queue?: ReactNode;
  active: boolean;
  navScale: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const tr = useTranslation();
  return (
    <main
      {...props}
      className={`${props.className || ''} flow-workspace ${active ? 'flow-library' : 'flow-focus'}`}
    >
      {active && (
        <aside
          className={`flow-navigation ${collapsed ? 'navigation-collapsed' : ''}`}
          style={{ width: (collapsed ? 56 : 256) * navScale }}
          aria-label={tr('音乐库导航')}
        >
          <div className="navigation-scaled" style={{ zoom: navScale }}>
            <button
              className="navigation-toggle"
              onClick={onToggle}
              title={tr(collapsed ? '展开导航栏' : '收起导航栏')}
              aria-label={tr(collapsed ? '展开导航栏' : '收起导航栏')}
            >
              {collapsed ? (
                <PanelLeftOpen size={19} />
              ) : (
                <PanelLeftClose size={19} />
              )}
            </button>
            {collapsed ? (
              <nav className="navigation-rail">{rail}</nav>
            ) : (
              navigation
            )}
          </div>
        </aside>
      )}
      <div className="workspace-content">{children}</div>
      {!!queue && (
        <aside className="flow-queue" aria-label={tr('待播放列表')}>
          {queue}
        </aside>
      )}
    </main>
  );
}
