'use client';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { MusicPlayer } from '@/lib/music/player';
import type { Track, Group, QueueEntry } from '@/lib/music/model';
import type { SmartGroup } from '@/lib/music/smart-groups';
import type { JamendoResult } from '@/lib/catalog/jamendo';
import { activeLyricIndex, centeredLyricPaddingTop, centeredLyricScrollTop, lyricWindow } from '@/lib/music/lyrics';
import type { PersonalPreferences } from '@/lib/music/preferences';
import { VisualizationRenderer } from '@/lib/music/visualization';
import { displayMessage } from '@/lib/i18n/core';
import { Button } from '@/components/ui/button';
import { AudioLines, ListMusic, Search, Play } from 'lucide-react';
import '@braccato/core/styles/variables.css';
import '@braccato/core/styles/lyrics.css';
const EMPTY_LINES: NonNullable<Track['lyrics']>['parsed']['lines'] = [];

type BraccatoElement = HTMLElement & { lyrics: unknown[]; currentTime: number; playing: boolean; host: {getScrollElement:()=>HTMLElement|null} };

export function FocusListening({track, coverUrl, positionMs, playing, player, preferences, onLayout, tracks, groups, smartGroups, queue, currentEntry, query, onQueryChange, chooser, onChooserChange, onlineResults, onPlay, onPlayQueue, onPlayOnline}: {
  track?: Track; coverUrl?: string; positionMs:number; playing:boolean;
  player:{current:MusicPlayer|null}; preferences:PersonalPreferences;
  onLayout:(layout:'side'|'center')=>void;
  tracks:Track[]; groups:Group[]; smartGroups:SmartGroup[]; queue:QueueEntry[]; currentEntry:string|null;
  query:string; onQueryChange:(value:string)=>void;
  chooser:boolean; onChooserChange:(value:boolean)=>void;
  onlineResults:JamendoResult[]; onPlay:(id:string)=>void; onPlayQueue:(entry:QueueEntry)=>void; onPlayOnline:(item:JamendoResult)=>void;
}) {
  const tr=displayMessage;
  const [groupId,setGroupId]=useState('all');
  const [chooserTab,setChooserTab]=useState<'library'|'queue'>('library');
  const [reducedMotion,setReducedMotion]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  const lyricScroll=useRef<HTMLDivElement>(null);
  const record=track?.lyrics;
  const lines=record?.parsed.kind==='synced' ? record.parsed.lines : EMPTY_LINES;
  const hasWordTiming=lines.some((line)=>!!line.parts?.length);
  const active=record ? activeLyricIndex(record.parsed,positionMs,record.adjustmentMs) : -1;
  const visibleIndexes=useMemo(()=>preferences.listenLayout==='center'?lyricWindow(lines.map((_,index)=>index),active):lines.map((_,index)=>index),[lines,active,preferences.listenLayout]);
  const lyricData=useMemo(()=>visibleIndexes.map((index)=>{
    const line=lines[index];
    const start=Math.max(0,line.timeMs-record!.parsed.offsetMs+record!.adjustmentMs);
    const end=lines[index+1] ? Math.max(start+1,lines[index+1].timeMs-record!.parsed.offsetMs+record!.adjustmentMs) : start+4000;
    return {startTimeMs:start,durationMs:end-start,words:line.texts[0]||'',
      translation:line.texts[1] ? {text:line.texts.slice(1).join('\n'),lang:'und'} : undefined,
      parts:line.parts?.map((part,i)=>{const partStart=Math.max(0,part.timeMs-record!.parsed.offsetMs+record!.adjustmentMs);
        const partEnd=line.parts?.[i+1] ? Math.max(0,line.parts[i+1].timeMs-record!.parsed.offsetMs+record!.adjustmentMs) : end;
        return {startTimeMs:partStart,durationMs:Math.max(1,partEnd-partStart),words:part.text};})};
  }),[record,lines,visibleIndexes]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync=()=>setReducedMotion(media.matches);
    sync(); media.addEventListener('change',sync);
    return()=>media.removeEventListener('change',sync);
  },[]);
  useEffect(()=>{
    if (!hasWordTiming) return;
    let alive=true;
    void import('@braccato/core/element').then(()=>{
      const element=lyricScroll.current?.querySelector('braccato-lyrics') as BraccatoElement|null;
      if (!alive || !element) return;
      element.lyrics=lyricData;
      element.host={getScrollElement:()=>lyricScroll.current};
    });
    return()=>{alive=false;};
  },[hasWordTiming,lyricData]);
  useEffect(()=>{
    const element=lyricScroll.current?.querySelector('braccato-lyrics') as BraccatoElement|null;
    if (!hasWordTiming || !element) return;
    element.currentTime=positionMs/1000;
    element.playing=playing;
  },[hasWordTiming,positionMs,playing]);
  useEffect(()=>{
    let enabled=false;
    let owner:MusicPlayer|null=null;
    const renderer=new VisualizationRenderer();
    let frame=0,last=performance.now();
    const draw=(now:number)=>{
      if(!enabled&&player.current){owner=player.current;owner.enableVisualization(true);enabled=true;}
      const node=canvas.current;
      if(node){
        const ratio=window.devicePixelRatio||1;
        const width=Math.max(1,Math.round(node.clientWidth*ratio)),height=Math.max(1,Math.round(node.clientHeight*ratio));
        if(node.width!==width||node.height!==height){node.width=width;node.height=height;}
        const context=node.getContext('2d');
        if(context) renderer.draw(context,width,height,player.current?.readVisualization()||null,preferences.visualizationStyle||'bars',(now-last)/1000,getComputedStyle(node).getPropertyValue('--ui-accent').trim()||undefined);
      }
      last=now;frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(frame);if(enabled)owner?.enableVisualization(false);};
  },[player,preferences.visualizationStyle]);
  useEffect(()=>{
    const container=lyricScroll.current;
    if(!container) return;
    if(active<0){container.style.paddingTop='';return;}
    const target=container?.querySelector(hasWordTiming?'.blyrics--active':`[data-lyric-index="${active}"]`);
    if(!target) return;
    if(preferences.listenLayout==='center'){
      container.style.paddingTop='0px';
      const initialRect=target.getBoundingClientRect();
      const viewportTop=container.getBoundingClientRect().top+container.clientTop;
      const initialTop=initialRect.top-viewportTop;
      container.style.paddingTop=`${centeredLyricPaddingTop(initialTop,initialRect.height,container.clientHeight)}px`;
    } else {
      container.style.paddingTop='';
      if(hasWordTiming) return;
    }
    const containerRect=container.getBoundingClientRect();
    const targetRect=target.getBoundingClientRect();
    const viewportTop=containerRect.top+container.clientTop;
    const rowTop=targetRect.top-viewportTop;
    const nextTop=centeredLyricScrollTop(container.scrollTop,rowTop,targetRect.height,container.clientHeight);
    if(Math.abs(nextTop-container.scrollTop)>1) container.scrollTo({top:nextTop,behavior:reducedMotion?'instant':'smooth'});
  },[active,hasWordTiming,reducedMotion,preferences.listenLayout,lyricData]);
  const smartGroup=smartGroups.find(group=>group.id===groupId);
  const choices=tracks.filter((item)=>!item.catalog && (groupId==='all'||(smartGroup ? smartGroup.trackIds.includes(item.id) : item.groups.includes(groupId))) && item.name.toLowerCase().includes(query.toLowerCase()));
  const queuedTracks=queue.map((entry,index)=>({entry,index,item:tracks.find((candidate)=>candidate.id===entry.trackId)})).filter((value)=>!!value.item);
  return <section className={`focus-listening focus-${preferences.listenLayout}`} aria-label={tr('专心听歌')}>
    <div className="focus-toolbar">
      <div><h1>{tr('专心听歌')}</h1><p>{track?.name||tr('选一首歌，开始听')}</p></div>
      <div className="focus-toolbar-actions">
        <fieldset aria-label={tr('歌词布局')} className="focus-layout-switch">
          <button aria-pressed={preferences.listenLayout==='side'} onClick={()=>onLayout('side')}>{tr('左右布局')}</button>
          <button aria-pressed={preferences.listenLayout==='center'} onClick={()=>onLayout('center')}>{tr('居中布局')}</button>
        </fieldset>
        <Button variant="outline" onClick={()=>{setChooserTab('library');onChooserChange(!chooser);}} aria-expanded={chooser}><Search size={16}/>{tr('选歌')}</Button>
        <Button variant="ghost" onClick={()=>{setChooserTab('queue');onChooserChange(true);}}><ListMusic size={17}/>{tr('队列')} {queue.length}</Button>
      </div>
    </div>
    {chooser&&<div className="focus-chooser">
      <div className="focus-chooser-tabs"><button aria-pressed={chooserTab==='library'} onClick={()=>setChooserTab('library')}>{tr('音乐库')}</button><button aria-pressed={chooserTab==='queue'} onClick={()=>setChooserTab('queue')}>{tr('待播放列表')} {queue.length}</button></div>
      {chooserTab==='library'?<><input aria-label={tr('在曲库中选歌')} placeholder={tr('搜索本地音乐')} value={query} onChange={e=>onQueryChange(e.target.value)}/>
      <select aria-label={tr('选择分类')} value={groupId} onChange={e=>setGroupId(e.target.value)}><option value="all">{tr('全部音乐')}</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}{smartGroups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <div className="focus-choices"><strong>{tr('本地音乐')}</strong>{choices.map(item=><button key={item.id} onClick={()=>{onPlay(item.id);onChooserChange(false);}}><Play size={13}/>{item.name}</button>)}
        {!!onlineResults.length&&<><strong>{tr('在线免费')}</strong>{onlineResults.map(item=><div className="focus-online-choice" key={item.id}><button onClick={()=>{onPlayOnline(item);onChooserChange(false);}}><Play size={13}/>{item.name} · {item.artist}</button><a href={item.licenseUrl} target="_blank" rel="noreferrer">{tr('许可')}</a></div>)}</>}
      </div></>:<div className="focus-choices focus-queue-choices">{queuedTracks.length?queuedTracks.map(({entry,index,item})=><button key={entry.id} className={entry.id===currentEntry?'is-current':''} aria-current={entry.id===currentEntry?'true':undefined} onClick={()=>{onPlayQueue(entry);onChooserChange(false);}}><span>{index+1}.</span><span>{item!.name}{item!.catalog?.artist?` · ${item!.catalog.artist}`:''}</span>{entry.id===currentEntry?<small>{tr('正在播放')}</small>:<Play size={13}/>}</button>):<p className="focus-empty-queue">{tr('播放一首音乐，或将音乐加入队列。')}</p>}</div>}
    </div>}
    <div className="focus-stage">
      <div className="focus-art-column">
        <div className={`focus-art ${preferences.coverRotation && !reducedMotion && coverUrl ? 'is-rotating':''} ${!playing?'is-paused':''}`}>
          {coverUrl ? /* oxlint-disable-next-line next/no-img-element -- Local object URL artwork has no remote optimizer. */ <img src={coverUrl} alt={tr('当前歌曲封面')}/> : <AudioLines size={72} aria-hidden="true"/>}
        </div>
        <canvas ref={canvas} className="focus-visualization" aria-label={tr('音频可视化')}/>
      </div>
      <div className="focus-lyrics" ref={lyricScroll} aria-label={tr('同步歌词')}>
        {record?.parsed.kind==='synced' && (hasWordTiming
          ? createElement('braccato-lyrics',{className:'focus-braccato'})
          : visibleIndexes.map((index)=><div key={`${lines[index].timeMs}-${index}`} data-lyric-index={index} className={`focus-lyric-line ${active===index?'active':''}`}><p>{lines[index].texts[0]}</p>{lines[index].texts.slice(1).map((translation,i)=><small key={i}>{translation}</small>)}</div>))}
      </div>
    </div>
  </section>;
}
