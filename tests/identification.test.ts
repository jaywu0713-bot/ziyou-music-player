import assert from 'node:assert/strict';
import test from 'node:test';
import {
  effectiveCredits,
  chooseAutomaticMatch,
  updateIdentifiedGroups,
  recognitionQuery,
  resetIdentification,
  manualCredits,
  type IdentificationCandidate,
} from '../lib/music/identification.ts';
import type { LibraryState, Track } from '../lib/music/model.ts';

void test('manual credits override identified and file tags independently', () => {
  const track = {id:'a', name:'Song.mp3', format:'MP3', duration:100, groups:[],
    identification:{file:{artists:['File'],album:'File Album'},automatic:{artists:['Auto'],album:'Auto Album'},manual:{artists:['Manual']}},
  } as Track;
  assert.deepEqual(effectiveCredits(track), {artists:['Manual'],album:'Auto Album',albumArtists:[]});
});

void test('saving unchanged multi-artist credits preserves each artist and album artists', () => {
  const credits={artists:['A','B'],album:'Record',albumArtists:['Orchestra']};
  assert.deepEqual(manualCredits('A\nB','Record',credits),credits);
});

void test('editing album preserves existing multi-artist credits', () => {
  const credits={artists:['A','B'],album:'Old',albumArtists:['Orchestra']};
  assert.deepEqual(manualCredits('A\nB','New',credits),{...credits,album:'New'});
});

void test('clearing corrections returns to source file tags', () => {
  const track={id:'a',name:'Song.mp3',format:'MP3',duration:100,groups:[],identification:{file:{artists:['File']},automatic:{artists:['Auto']},manual:{artists:['Manual']}}} as Track;
  assert.deepEqual(effectiveCredits(resetIdentification(track)).artists,['File']);
});

void test('automatic match requires exact title, close duration and no competing edition', () => {
  const candidate: IdentificationCandidate={id:'1',title:'Blue Sky',artists:['Singer'],album:'One',albumArtists:['Singer'],duration:180};
  assert.equal(chooseAutomaticMatch('Singer - Blue Sky.mp3',180,[candidate])?.id,'1');
  assert.equal(chooseAutomaticMatch('Blue Sky.mp3',180,[candidate],'Singer')?.id,'1');
  assert.equal(chooseAutomaticMatch('Singer - Blue Sky.mp3',180,[candidate,{...candidate,id:'2',album:'Two'}]),undefined);
  assert.equal(chooseAutomaticMatch('Singer - Blue Sky.mp3',180,[candidate,{...candidate,id:'2'}]),undefined);
  assert.equal(chooseAutomaticMatch('Blue Sky - Singer[Two].mp3',180,[candidate,{...candidate,id:'1:edition',album:'Two'}])?.album,'Two');
  assert.equal(chooseAutomaticMatch('Other.mp3',180,[candidate]),undefined);
  assert.equal(chooseAutomaticMatch('Singer - Blue Sky.mp3',205,[candidate]),undefined);
});

void test('recognition query removes track number and extracts artist without sending a path', () => {
  assert.deepEqual(recognitionQuery('03 Singer - Blue Sky.flac'), {title:'Blue Sky',artist:'Singer'});
  assert.deepEqual(recognitionQuery('方大同-天气先生.dsf'), {title:'天气先生',artist:'方大同'});
  assert.deepEqual(recognitionQuery('Sample Song - Prince[Sample Song].flac'), {title:'Sample Song',artist:'Prince'});
  assert.deepEqual(recognitionQuery('Live Song.mp3'), {title:'Live Song',artist:''});
});

void test('updating identified credits refreshes existing artist and album groups only', () => {
  const track = {id:'a',name:'Song.mp3',format:'MP3',duration:100,groups:[],identification:{manual:{artists:['New'],album:'New Album'}}} as Track;
  const state={tracks:[track],smartGroups:[
    {id:'artist:unknown',kind:'artist',name:'信息未知',trackIds:['a']},
    {id:'album:unknown',kind:'album',name:'信息未知',trackIds:['a']},
    {id:'folder:root',kind:'folder',name:'Music',trackIds:['a']},
  ]} as LibraryState;
  const next=updateIdentifiedGroups(state,track);
  assert.equal(next.smartGroups?.find(group=>group.kind==='folder')?.trackIds[0],'a');
  assert.equal(next.smartGroups?.some(group=>group.kind==='artist' && group.name==='New' && group.trackIds.includes('a')),true);
  assert.equal(next.smartGroups?.some(group=>group.kind==='album' && group.name.startsWith('New Album') && group.trackIds.includes('a')),true);
  assert.equal(next.smartGroups?.some(group=>group.kind==='artist' && group.name==='信息未知' && group.trackIds.includes('a')),false);
});

void test('manual album artist corrections merge compilations without changing song performers', () => {
  const previous={artists:['Soloist'],album:'Collection',albumArtists:['Old']};
  assert.deepEqual(manualCredits('Soloist','Collection',previous,'Various Artists'),{...previous,albumArtists:['Various Artists']});
  assert.deepEqual(manualCredits('Soloist','Collection',previous,''),{...previous,albumArtists:[]});
});
