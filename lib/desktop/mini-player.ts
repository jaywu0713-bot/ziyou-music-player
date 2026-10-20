export const MINI_STATE = 'ziyou:mini-state';
export const MINI_COVER = 'ziyou:mini-cover';
export const MINI_REQUEST = 'ziyou:mini-request';
export const MINI_ACTION = 'ziyou:mini-action';
export const MINI_HIDDEN = 'ziyou:mini-hidden';
export type MiniMode = 'both' | 'mini-only';
export type CollapsedStyle = 'edge-tab' | 'cover-tile';
export type MiniPreferences = {
  mode: MiniMode;
  pinned: boolean;
  collapsedStyle: CollapsedStyle;
  collapsedActive: boolean;
};
export function collapsedWindowSize(style: CollapsedStyle) {
  return style === 'edge-tab' ? { width: 48, height: 84 } : { width: 80, height: 80 };
}
export type MiniSnapshot = {
  trackId: string;
  name: string;
  playing: boolean;
  preparing: boolean;
  position: number;
  duration: number;
  volume: number;
  canPlay: boolean;
  canSkip: boolean;
  version: 'original' | 'instrumental';
  dark: boolean;
  accent: string;
  accentText: string;
  language: 'zh-CN' | 'en';
  message: string;
};
export type MiniAction =
  | { type: 'toggle' | 'previous' | 'next' }
  | { type: 'seek' | 'volume'; value: number }
  | { type: 'mode'; value: MiniMode };
export function parseMiniAction(value: unknown): MiniAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as Record<string, unknown>;
  if (['toggle', 'previous', 'next'].includes(String(action.type)))
    return { type: action.type as 'toggle' | 'previous' | 'next' };
  if (
    action.type === 'mode' &&
    (action.value === 'both' || action.value === 'mini-only')
  )
    return { type: 'mode', value: action.value };
  if (
    (action.type === 'seek' || action.type === 'volume') &&
    typeof action.value === 'number' &&
    Number.isFinite(action.value) &&
    action.value >= 0 &&
    action.value <= (action.type === 'volume' ? 100 : 14400)
  )
    return { type: action.type, value: action.value };
  return null;
}
type WindowPorts = {
  showMini: () => Promise<void>;
  focusMini: () => Promise<void>;
  hideMain: () => Promise<void>;
  showMain: () => Promise<void>;
  restore: () => Promise<void>;
  saveMode: (mode: MiniMode) => Promise<void>;
};
/** Serialize window transitions: a usable control window must exist before hiding main. */
export class MiniWindowController {
  private pending: Promise<unknown> = Promise.resolve();
  private ports: WindowPorts;
  constructor(ports: WindowPorts) {
    this.ports = ports;
  }
  private enqueue(work: () => Promise<void>) {
    const next = this.pending.catch(() => {}).then(work);
    this.pending = next;
    return next;
  }
  open(mode: MiniMode) {
    return this.enqueue(async () => {
      try {
        await this.ports.showMini();
        await this.ports.focusMini();
        if (mode === 'mini-only') await this.ports.hideMain();
        else await this.ports.showMain();
        await this.ports.saveMode(mode);
      } catch (error) {
        await this.ports.restore();
        throw error;
      }
    });
  }
  restore() {
    return this.enqueue(() => this.ports.restore());
  }
}
