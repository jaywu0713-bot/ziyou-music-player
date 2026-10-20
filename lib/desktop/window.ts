export const DESKTOP_LYRICS_LABEL = 'lyrics';
export const DESKTOP_LYRICS_NEXT_LABEL = 'lyrics-next';
export const DESKTOP_LYRICS_EVENT = 'desktop-lyrics-update';
export const DESKTOP_LYRICS_REQUEST_EVENT = 'desktop-lyrics-request';
export const DESKTOP_LYRICS_HIDDEN_EVENT = 'desktop-lyrics-hidden';
export const DESKTOP_LYRICS_SHORTCUT = 'CommandOrControl+Shift+L';

export function isLyricsWindow(search = window.location.search) {
  return new URLSearchParams(search).has('lyrics');
}
