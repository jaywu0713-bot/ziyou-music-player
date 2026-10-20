import { converter, formatHex, wcagContrast } from 'culori';
import type { PersonalPreferences } from './preferences.ts';

const presets = {forest:'#75b843',ocean:'#16789c',rose:'#ae5575'} as const;
const oklch = converter('oklch');

export function resolveTheme(value:Pick<PersonalPreferences,'themeMode'|'themePreset'|'accentColor'>,systemDark:boolean) {
  const dark=value.themeMode==='dark'||(value.themeMode==='system'&&systemDark);
  const background=dark?'#111315':'#f5f7f4';
  const requested=/^#[0-9a-f]{6}$/i.test(value.accentColor) ? value.accentColor : presets[value.themePreset]||presets.forest;
  let accent=requested;
  const color=oklch(requested);
  if(color) {
    for(let step=0;step<20&&wcagContrast(accent,background)<4.5;step++) {
      const next=dark ? Math.min(.98,color.l+(step+1)*.035) : Math.max(.05,color.l-(step+1)*.035);
      accent=formatHex({...color,l:next});
    }
  }
  return {dark,background,accent,accentText:wcagContrast(accent,'#ffffff')>=4.5?'#ffffff':'#102015'};
}
