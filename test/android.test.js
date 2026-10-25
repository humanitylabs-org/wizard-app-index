import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker, {ANDROID_MD_SRC} from '../src/index.js';

const doc = readFileSync(new URL('../android.md',import.meta.url),'utf8');
test('Android onboarding serves only GET/HEAD and fails closed upstream',async()=>{
  const original=globalThis.fetch;
  try {
    let calls=[];
    globalThis.fetch=async (url)=>{ calls.push(url);return new Response(doc); };
    const get=await worker.fetch(new Request('https://www.aiwizards.com/android.md'),{});
    assert.equal(get.status,200);assert.equal(await get.text(),doc);
    assert.equal(get.headers.get('content-type'),'text/markdown; charset=utf-8');
    assert.deepEqual(calls,[ANDROID_MD_SRC]);
    const head=await worker.fetch(new Request('https://www.aiwizards.com/android.md',{method:'HEAD'}),{});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
    calls=[];
    const post=await worker.fetch(new Request('https://www.aiwizards.com/android.md',{method:'POST'}),{});
    assert.equal(post.status,404);assert.equal(calls.length,0);
    globalThis.fetch=async()=>new Response('missing',{status:404});
    const fail=await worker.fetch(new Request('https://www.aiwizards.com/android.md'),{});
    assert.equal(fail.status,502);assert.equal(fail.headers.get('cache-control'),'no-store');
    assert.match(await fail.text(),/unavailable/);
  }finally {globalThis.fetch=original;}
});
test('Android instructions pin public release and preserve trust, data and stable channel',()=>{
  for (const text of ['4315358891d4bf726c3b98761359092588a98f32','c778c82f240279f7caa039aef929aef6c339cf36d83e3fdd6b7ab3c264b24ee6','ba972d734ec674f0c98ea031caac0fcd0d52d6bf391f69e5ea55cb9e9258c2f7','ai.wizards.shell.test','android-shell-v1.0.1-early-access','versionCode: `2`','Cancel / Pause / Resume','in-place update','phone checks of this signed release remain a separate step','does **not** include','Never clear app storage','Never publish the Wizard','no additional purchase']) assert.ok(doc.includes(text),text);
  assert.doesNotMatch(doc,/tail6adf1a|oscarvps|:8829|:8831|\/home\/oscar|wizard-android-test/);
  const routes=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
  assert.ok(routes.includes('www.aiwizards.com/android.md'));
});
