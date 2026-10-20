'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicPlayer } from '@/lib/music/player';
import type { VisualizationStyle } from '@/lib/music/visualization';
import { isTauri } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getLanguage } from '@/lib/i18n/core';
import {
  openVisualizationWindow,
  type VisualizationWindow,
} from '@/lib/music/visualization-window';
export function useVisualizationWindow(
  player: { current: MusicPlayer | null },
  style: VisualizationStyle,
  notify: (message: string) => void,
  accent?: string,
  inlineActive = false,
) {
  const [opened, setOpened] = useState(false);
  const windowRef = useRef<VisualizationWindow | null>(null),
    styleRef = useRef(style),
    accentRef = useRef(accent),
    inlineActiveRef=useRef(inlineActive);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);
  useEffect(()=>{accentRef.current=accent;},[accent]);
  useEffect(()=>{inlineActiveRef.current=inlineActive;},[inlineActive]);
  useEffect(
    () => () => {
      windowRef.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!isTauri()) return;
    let alive=true;
    let unlisten: (()=>void)|undefined;
    void listen('ziyou:visualization-hidden',()=>{
      if (!alive) return;
      setOpened(false);
      if(!inlineActiveRef.current) player.current?.enableVisualization(false);
    }).then((stop)=>{if (alive) unlisten=stop; else stop();});
    return()=>{alive=false;unlisten?.();};
  },[player]);
  useEffect(()=>{
    if (!isTauri()||!opened) return;
    const timer=window.setInterval(()=>{
      const data=player.current?.readVisualization();
      void emitTo('visualization','ziyou:visualization-frame',{
        frequencies:Array.from(data?.frequencies||[]),waveform:Array.from(data?.waveform||[]),
        sampleRate:data?.sampleRate||44100,playing:data?.playing||false,
        style:styleRef.current,language:getLanguage(),accent:accentRef.current,
      });
    },33);
    return()=>window.clearInterval(timer);
  },[opened,player]);
  const toggle = useCallback(() => {
    if (isTauri()) {
      void (async()=>{
        const child=await WebviewWindow.getByLabel('visualization');
        if (!child) throw new Error('可视化窗口尚未就绪，请重启播放器后重试。');
        if (opened) {
          await child.hide();
          if(!inlineActiveRef.current) player.current?.enableVisualization(false);
          setOpened(false);
        } else {
          await child.show();
          player.current?.enableVisualization(true);
          setOpened(true);
        }
      })().catch((cause:unknown)=>notify(cause instanceof Error?cause.message:'无法打开可视化窗口。'));
      return;
    }
    if (windowRef.current) {
      windowRef.current.close();
      return;
    }
    try {
      const popup = openVisualizationWindow(
        window,
        () => player.current?.readVisualization() || null,
        () => styleRef.current,
        () => {
          windowRef.current = null;
          setOpened(false);
          if(!inlineActiveRef.current) player.current?.enableVisualization(false);
        },
      );
      windowRef.current = popup;
      player.current?.enableVisualization(true);
      setOpened(true);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '无法打开可视化窗口。');
    }
  }, [player, notify, opened]);
  return { opened, toggle };
}
