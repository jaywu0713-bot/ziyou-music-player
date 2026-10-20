import { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { setLanguage, displayMessage as tr, type Language } from '@/lib/i18n/core';
import { VisualizationRenderer, type VisualizationFrame, type VisualizationStyle } from '@/lib/music/visualization';

type Snapshot = { frequencies: number[]; waveform: number[]; sampleRate: number; playing: boolean; style: VisualizationStyle; language: Language; accent?:string };
const EVENT='ziyou:visualization-frame';
const HIDDEN='ziyou:visualization-hidden';
export function DesktopVisualizationView() {
  const canvas=useRef<HTMLCanvasElement>(null);
  const frame=useRef<VisualizationFrame|null>(null);
  const style=useRef<VisualizationStyle>('bars');
  const accent=useRef<string|undefined>(undefined);
  const renderer=useRef(new VisualizationRenderer());
  const [playing,setPlaying]=useState(false);
  const [selected,setSelected]=useState<VisualizationStyle>('bars');
  const [,setLanguageState]=useState<Language>('zh-CN');
  useEffect(()=>{
    let alive=true;
    let unlisten: (()=>void)|undefined;
    let unlistenClose: (()=>void)|undefined;
    void (async()=>{
      unlisten=await listen<Snapshot>(EVENT,({payload})=>{
        if (!alive) return;
        frame.current={frequencies:Uint8Array.from(payload.frequencies),waveform:Uint8Array.from(payload.waveform),sampleRate:payload.sampleRate,playing:payload.playing};
        style.current=payload.style;
        accent.current=payload.accent;
        setSelected(payload.style);
        setPlaying(payload.playing);
        setLanguage(payload.language);
        setLanguageState(payload.language);
      });
      unlistenClose=await getCurrentWindow().onCloseRequested((event)=>{
        event.preventDefault();
        void getCurrentWindow().hide().then(()=>emit(HIDDEN));
      });
    })();
    return()=>{alive=false;unlisten?.();unlistenClose?.();};
  },[]);
  useEffect(()=>{
    let raf=0,last=0;
    const render=(time:number)=>{
      raf=requestAnimationFrame(render);
      if (time-last<1000/30) return;
      const elapsed=last?(time-last)/1000:1/30;last=time;
      const element=canvas.current,ctx=element?.getContext('2d');
      if (!element||!ctx) return;
      const width=Math.max(1,element.clientWidth),height=Math.max(1,element.clientHeight);
      const ratio=Math.min(window.devicePixelRatio||1,2,1920/width,1080/height);
      const w=Math.round(width*ratio),h=Math.round(height*ratio);
      if (element.width!==w||element.height!==h){element.width=w;element.height=h;}
      ctx.setTransform(ratio,0,0,ratio,0,0);
      renderer.current.draw(ctx,width,height,frame.current,style.current,elapsed,accent.current);
    };
    raf=requestAnimationFrame(render);
    return()=>cancelAnimationFrame(raf);
  },[]);
  return <div style={{height:'100vh',display:'flex',flexDirection:'column',background:'#151c19',color:'#dce8df',font:'14px system-ui,sans-serif'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',color:'#a7b9ad'}}>
      <span>{tr(selected==='lines'?'自用 · 律动线条':'自用 · 柱状频谱')}</span>
      <button style={{background:'transparent',color:'#cfe0d3',border:'1px solid #526559',borderRadius:6,padding:'4px 10px',cursor:'pointer'}} onClick={()=>void getCurrentWindow().hide().then(()=>emit(HIDDEN))}>{tr('关闭')}</button>
    </header>
    <canvas ref={canvas} aria-label={tr('随当前音乐变化的音频可视化')} style={{width:'100%',height:'100%',flex:1,minHeight:0}} />
    <p style={{margin:0,padding:'8px 20px 14px',color:'#869c8e',fontSize:12}}>{tr(playing?'跟随当前音乐 · 在个人偏好中切换样式':'等待播放或继续音乐')}</p>
  </div>;
}
