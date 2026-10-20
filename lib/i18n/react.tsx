'use client';
import { useSyncExternalStore } from 'react';
import { displayMessage, getLanguage, subscribeLanguage } from './core';
export function useTranslation() {
  useSyncExternalStore(subscribeLanguage, getLanguage, () => 'zh-CN' as const);
  return displayMessage;
}
