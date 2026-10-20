import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { personalPreferences } from '../lib/music/preferences.ts';
import {
  coverStorage,
  readLibrary,
  writeLibrary,
} from '../lib/music/storage.ts';
import { emptyLibrary } from '../lib/music/model.ts';
void test('personal settings default off and bound saved durations', () => {
  assert.deepEqual(personalPreferences(), {
    language: 'zh-CN',
    visualizationStyle: 'bars',
    coverBackground: false,
    crossfade: false,
    crossfadeSeconds: 5,
    jamendoClientId: '',
    listenLayout: 'side',
    coverRotation: true,
    themeMode: 'system',
    themePreset: 'forest',
    accentColor: '',
  });
  assert.equal(
    personalPreferences({ crossfadeSeconds: 99 }).crossfadeSeconds,
    12,
  );
  assert.equal(
    personalPreferences({ crossfadeSeconds: NaN }).crossfadeSeconds,
    5,
  );
  assert.equal(
    personalPreferences({ jamendoClientId: '  client_123  ' }).jamendoClientId,
    'client_123',
  );
  assert.equal(
    personalPreferences({ jamendoClientId: 'bad client id' }).jamendoClientId,
    '',
  );
  assert.equal(personalPreferences({accentColor:'#Ab12cd'}).accentColor,'#ab12cd');
  assert.equal(personalPreferences({accentColor:'red; background:url(x)'}).accentColor,'');
  assert.equal(personalPreferences({listenLayout:'center'}).listenLayout,'center');
});
void test('v1 database upgrades without losing existing music or lyrics', async () => {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ziyou-music', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const state = emptyLibrary();
  state.groups = [{ id: 'saved', name: '收藏' }];
  await new Promise<void>((resolve, reject) => {
    const tx = old.transaction('library', 'readwrite');
    tx.objectStore('library').put(state, 'state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  old.close();
  assert.deepEqual(await readLibrary(), state);
  await coverStorage('migration-check', 'write', new Blob(['cover']));
  assert.deepEqual((await readLibrary())?.groups, state.groups);
});
void test('cover blobs and preferences persist independently; restore removes only the custom cover', async () => {
  const state = emptyLibrary();
  state.personalPreferences = personalPreferences({
    coverBackground: true,
    crossfade: true,
    crossfadeSeconds: 6,
    visualizationStyle: 'lines',
  });
  await writeLibrary(state);
  await coverStorage('embedded:t', 'write', { blob: new Blob(['original']) });
  await coverStorage('custom:t', 'write', { blob: new Blob(['chosen']) });
  assert.equal((await readLibrary())?.personalPreferences?.crossfadeSeconds, 6);
  assert.equal(
    (await readLibrary())?.personalPreferences?.visualizationStyle,
    'lines',
  );
  assert.equal(
    await (await coverStorage<{ blob: Blob }>('custom:t', 'read'))?.blob.text(),
    'chosen',
  );
  await coverStorage('custom:t', 'delete');
  assert.equal(await coverStorage('custom:t', 'read'), undefined);
  assert.equal(
    await (
      await coverStorage<{ blob: Blob }>('embedded:t', 'read')
    )?.blob.text(),
    'original',
  );
  assert.equal(
    (await readLibrary())?.personalPreferences?.coverBackground,
    true,
  );
});

void test('manual song corrections and pending candidates survive a library reopen', async () => {
  const state=emptyLibrary();
  state.tracks=[{id:'identified',name:'Song.flac',format:'FLAC',duration:180,groups:[],identification:{file:{artists:[]},manual:{artists:['My artist']},candidates:[{id:'recording',title:'Song',artists:['Candidate'],album:'Record',duration:180}],status:'needs-review'}}];
  await writeLibrary(state);
  const restored=await readLibrary();
  assert.deepEqual(restored?.tracks[0].identification?.manual?.artists,['My artist']);
  assert.equal(restored?.tracks[0].identification?.candidates?.[0].album,'Record');
});
