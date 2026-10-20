'use client';
import {
  defaultLayout,
  type LayoutPreferences,
} from '@/hooks/use-layout-preferences';
import { useTranslation } from '@/lib/i18n/react';
export function LayoutPreferencesControls({
  value,
  onChange,
}: {
  value: LayoutPreferences;
  onChange: (patch: Partial<LayoutPreferences>) => void;
}) {
  const tr = useTranslation();
  return (
    <section className="layout-preferences" aria-label={tr('界面布局')}>
      <h3>{tr('界面布局')}</h3>
      <p>{tr('文字、图标和按钮一起缩放。小窗口会自动限制实际大小，保留你的设置。')}</p>
      {(['navScale', 'playerScale'] as const).map((key) => (
        <label className="layout-scale-setting" key={key}>
          <span>
            {tr(key === 'navScale' ? '导航栏缩放' : '播放栏缩放')}
            <output>{value[key]}%</output>
          </span>
          <input
            type="range"
            min="80"
            max="125"
            step="5"
            value={value[key]}
            aria-label={tr(key === 'navScale' ? '导航栏缩放' : '播放栏缩放')}
            onChange={(e) => onChange({ [key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <button className="layout-reset" onClick={() => onChange(defaultLayout)}>
        {tr('恢复默认布局')}
      </button>
    </section>
  );
}
