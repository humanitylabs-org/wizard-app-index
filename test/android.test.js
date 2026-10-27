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
  for (const text of ['3a111e612396d7c72f11c4f04dffdb9e4508c7c2bbb83a3d70e1de443ddea9d3','ba972d734ec674f0c98ea031caac0fcd0d52d6bf391f69e5ea55cb9e9258c2f7','ai.wizards.shell.test','android-shell-v1.0.2-early-access','versionCode `3`','Tailscale access is not owner authentication','same Tailscale network','Only connect to a Wizard the owner trusts','Test-app recordings, settings and shortcuts do not transfer automatically','owner confirms it is safe to remove','Never clear its storage','Home-screen shortcuts require support','Android launcher','Installed; phone checks pending.','Never make the Wizard public','Never install a test build','There is no purchase.']) assert.ok(doc.includes(text),text);
  assert.doesNotMatch(doc,/tail6adf1a|oscarvps|:8829|:8831|\/home\/oscar|wizard-android-test/);
  const routes=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
  assert.ok(routes.includes('www.aiwizards.com/android.md'));
});
