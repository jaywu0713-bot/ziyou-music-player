import { english } from './en.ts';
export type Language = 'zh-CN' | 'en';
export const languageOf = (value: unknown): Language => value === 'en' ? 'en' : 'zh-CN';
let language: Language = 'zh-CN';
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setLanguage(value: Language) { if (language !== value) { language = value; listeners.forEach(listener => listener()); } }
export function translate(text: string, locale: Language = language, params?: Record<string, string | number>): string {
  let result = locale === 'en' ? english[text] ?? english[text.replace(/\s+/g, ' ').trim()] ?? text : text;
  if (params && locale === 'en') result = result.replace(/\{(track|second|channel)(\d+)\}/g, (_, word, index) => word + (Number(params[index]) === 1 ? '' : 's'));
  if (params) result = result.replace(/\{(\w+)\}/g, (match, key) => params[key] === undefined ? match : String(params[key]));
  return result;
}
/** Messages remain language-independent while queued, cached or passed across workers. */
export function message(key: string, params: Record<string,string|number>) { return '\u001eziyou:' + JSON.stringify([key,params]); }
export function displayMessage(value: string): string {
  if (value.startsWith('\u001eziyou:')) { try { const [key,params] = JSON.parse(value.slice(7)); return translate(key,language,params); } catch { return value; } }
  return translate(value);
}
export function number(value: number, options?: Intl.NumberFormatOptions) { return new Intl.NumberFormat(language, options).format(value); }
