'use client';
import { languageOf, setLanguage } from '@/lib/i18n/core';
import { useTranslation } from '@/lib/i18n/react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { PersonalPreferences } from '@/lib/music/preferences';
import { HexColorInput, HexColorPicker } from 'react-colorful';
export function PersonalPreferencesDialog({
  open,
  onOpenChange,
  value,
  onChange,
  disabled,
  extra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: PersonalPreferences;
  onChange: (value: PersonalPreferences) => void;
  disabled: boolean;
  extra?: React.ReactNode;
}) {
  const tr = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="music-dialog preferences-dialog">
        <DialogTitle>{tr('设置')}</DialogTitle>
        <DialogDescription>
          {tr('按你的习惯聆听，设置保存在当前浏览器。')}
        </DialogDescription>
        <details className="settings-management" open><summary>{tr('布局、文件夹、缓存与扩展功能')}</summary>{extra}</details>
        <div className="preference-row">
          <span>
            <strong>{tr('外观')}</strong>
            <small>{tr('默认跟随 macOS，也可以固定明暗外观。')}</small>
          </span>
          <select
            className="visualization-select"
            aria-label={tr('外观模式')}
            disabled={disabled}
            value={value.themeMode}
            onChange={(event) =>
              onChange({
                ...value,
                themeMode: event.target
                  .value as PersonalPreferences['themeMode'],
              })
            }
          >
            <option value="system">{tr('跟随系统')}</option>
            <option value="light">{tr('浅色')}</option>
            <option value="dark">{tr('深色')}</option>
          </select>
        </div>
        <div className="preference-row">
          <span>
            <strong>{tr('主题颜色')}</strong>
            <small>{tr('选择预设，或从调色板选任意主色。')}</small>
          </span>
          <select
            className="visualization-select"
            aria-label={tr('预设主题')}
            disabled={disabled}
            value={value.themePreset}
            onChange={(event) =>
              onChange({
                ...value,
                themePreset: event.target
                  .value as PersonalPreferences['themePreset'],
                accentColor: '',
              })
            }
          >
            <option value="forest">{tr('松绿')}</option>
            <option value="ocean">{tr('海蓝')}</option>
            <option value="rose">{tr('玫瑰')}</option>
          </select>
        </div>
        <details className="preference-color-picker">
          <summary>{tr('自定义主色')}</summary>
          <HexColorPicker
            color={value.accentColor || '#75b843'}
            onChange={(accentColor) => onChange({ ...value, accentColor })}
          />
          <HexColorInput
            color={value.accentColor || '#75b843'}
            onChange={(accentColor) => onChange({ ...value, accentColor })}
            prefixed
            aria-label={tr('主色十六进制值')}
          />
        </details>
        <label className="preference-row" aria-label={tr('旋转专辑封面')}>
          <span>
            <strong>{tr('旋转专辑封面')}</strong>
            <small>{tr('专心听歌时播放旋转；暂停与系统减少动态效果时停止。')}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={value.coverRotation}
            checked={value.coverRotation}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, coverRotation: event.target.checked })
            }
          />
        </label>
        <div className="preference-row">
          <span>
            <strong>{tr('免费在线曲库')}</strong>
            <small>
              {tr(
                '填写 Jamendo Client ID 后，可搜索并串流播放免费授权音乐。标识只保存在本机。',
              )}
            </small>
          </span>
          <input
            id="jamendo-client-id"
            className="visualization-select"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            placeholder={tr('Jamendo Client ID')}
            value={value.jamendoClientId || ''}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, jamendoClientId: event.target.value })
            }
          />
        </div>
        <label
          className="preference-row"
          htmlFor="interface-language"
          aria-label={tr('界面语言')}
        >
          <span>
            <strong>{tr('界面语言')}</strong>
            <small>{tr('选择界面语言，不翻译歌曲、歌词和分类名称。')}</small>
          </span>
          <select
            id="interface-language"
            className="visualization-select"
            value={value.language || 'zh-CN'}
            disabled={disabled}
            onChange={(e) => {
              const language = languageOf(e.target.value);
              setLanguage(language);
              onChange({ ...value, language });
            }}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="preference-row" aria-label={tr('将歌曲封面设为背景')}>
          <span>
            <strong>{tr('将歌曲封面设为背景')}</strong>
            <small>{tr('随当前歌曲更新，没有封面时恢复默认背景。')}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={value.coverBackground}
            checked={value.coverBackground}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, coverBackground: e.target.checked })
            }
          />
        </label>
        <label
          className="preference-row"
          aria-label={tr('无缝切换（交叉淡化）')}
        >
          <span>
            <strong>{tr('无缝切换（交叉淡化）')}</strong>
            <small>
              {tr('上一首渐弱，下一首渐强。仅自动切歌时生效，单曲循环不生效。')}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={value.crossfade}
            checked={value.crossfade}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, crossfade: e.target.checked })
            }
          />
        </label>
        <div className="preference-row">
          <span>
            <strong>{tr('过渡时长')}</strong>
            <small>{tr('每次调整 1 秒，范围 1～12 秒。')}</small>
          </span>
          <div className="duration-stepper">
            <Button
              variant="outline"
              aria-label={tr('减少过渡时长')}
              disabled={disabled || value.crossfadeSeconds <= 1}
              onClick={() =>
                onChange({
                  ...value,
                  crossfadeSeconds: value.crossfadeSeconds - 1,
                })
              }
            >
              −
            </Button>
            <output aria-live="polite">
              {value.crossfadeSeconds} {tr('秒')}
            </output>
            <Button
              variant="outline"
              aria-label={tr('增加过渡时长')}
              disabled={disabled || value.crossfadeSeconds >= 12}
              onClick={() =>
                onChange({
                  ...value,
                  crossfadeSeconds: value.crossfadeSeconds + 1,
                })
              }
            >
              ＋
            </Button>
          </div>
        </div>
        <label
          className="preference-row"
          htmlFor="visualization-style"
          aria-label={tr('音频可视化样式')}
        >
          <span>
            <strong>{tr('音频可视化样式')}</strong>
            <small>
              {tr('从底部歌词旁的按钮打开独立小窗口。该窗口不置顶。')}
            </small>
          </span>
          <select
            id="visualization-style"
            className="visualization-select"
            value={value.visualizationStyle || 'bars'}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                visualizationStyle:
                  e.target.value === 'lines' ? 'lines' : 'bars',
              })
            }
          >
            <option value="bars">{tr('柱状频谱')}</option>
            <option value="lines">{tr('律动线条')}</option>
          </select>
        </label>
      </DialogContent>
    </Dialog>
  );
}
