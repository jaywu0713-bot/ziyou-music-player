import { languageOf, type Language } from '../i18n/core.ts';
import {
  visualizationStyle,
  type VisualizationStyle,
} from './visualization.ts';
export type PersonalPreferences = {
  language?: Language;
  visualizationStyle?: VisualizationStyle;
  coverBackground: boolean;
  crossfade: boolean;
  crossfadeSeconds: number;
  jamendoClientId?: string;
  listenLayout: 'side' | 'center';
  coverRotation: boolean;
  themeMode: 'system' | 'light' | 'dark';
  themePreset: 'forest' | 'ocean' | 'rose';
  accentColor: string;
};
export function personalPreferences(
  value?: Partial<PersonalPreferences>,
): PersonalPreferences {
  return {
    language: languageOf(value?.language),
    visualizationStyle: visualizationStyle(value?.visualizationStyle),
    coverBackground: value?.coverBackground === true,
    crossfade: value?.crossfade === true,
    crossfadeSeconds: Number.isFinite(value?.crossfadeSeconds)
      ? Math.max(1, Math.min(12, Math.round(value!.crossfadeSeconds!)))
      : 5,
    jamendoClientId:
      typeof value?.jamendoClientId === 'string' &&
      /^[A-Za-z0-9_-]{4,128}$/.test(value.jamendoClientId.trim())
        ? value.jamendoClientId.trim()
        : '',
    listenLayout: value?.listenLayout === 'center' ? 'center' : 'side',
    coverRotation: value?.coverRotation !== false,
    themeMode: value?.themeMode === 'light' || value?.themeMode === 'dark' ? value.themeMode : 'system',
    themePreset: value?.themePreset === 'ocean' || value?.themePreset === 'rose' ? value.themePreset : 'forest',
    accentColor: typeof value?.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.accentColor)
      ? value.accentColor.toLowerCase() : '',
  };
}
