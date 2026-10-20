import assert from 'node:assert/strict';
import test from 'node:test';
import { folderGroups, metadataGroups, smartGroupIndex } from '../lib/music/smart-groups.ts';
import { songMetadata } from '../lib/music/metadata.ts';
import type { IAudioMetadata } from 'music-metadata';

void test('bound roots become distinct groups even when names match', () => {
  const groups = folderGroups([{id:'one',name:'Music'},{id:'two',name:'Music'}], [{id:'a',rootId:'one'},{id:'b',rootId:'two'}]);
  assert.equal(groups.length,2);
  assert.deepEqual(groups.map(group=>group.trackIds),[['a'],['b']]);
});
void test('artist and album grouping preserve unknown tags and separate same-named albums', () => {
  const rows=[
    {id:'a',artists:['A'],album:'Live',albumArtists:['A']},
    {id:'b',artists:['B'],album:'Live',albumArtists:['B']},
    {id:'c',artists:[],album:undefined,albumArtists:[]},
  ];
  assert.equal(metadataGroups('artist',rows).length,3);
  const albums=metadataGroups('album',rows);
  assert.equal(albums.length,3);
  assert.deepEqual(albums.map(group=>group.trackIds[0]).sort(),['a','b','c']);
});
void test('metadata extraction includes album and album artist', () => {
  const info=songMetadata({common:{album:'Live',albumartist:'The Group'},format:{},native:{}} as IAudioMetadata,{size:1,lastModified:2});
  assert.equal(info.album,'Live');
  assert.deepEqual(info.albumArtists,['The Group']);
});
void test('saved artist and album groups index only existing tracks for clickable tags', () => {
  const groups=[
    {id:'folder:root',kind:'folder' as const,name:'Music',trackIds:['a']},
    {id:'artist:a',kind:'artist' as const,name:'Singer',trackIds:['a','deleted']},
    {id:'album:unknown',kind:'album' as const,name:'信息未知',trackIds:['a']},
  ];
  const index=smartGroupIndex(groups,new Set(['a']));
  assert.deepEqual(index.get('a')?.map(group=>group.id),['artist:a','album:unknown']);
  assert.equal(index.has('deleted'),false);
});
