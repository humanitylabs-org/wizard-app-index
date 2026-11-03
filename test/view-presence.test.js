import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
const base={owner:'example',repo:'screen-service',app_id:'screen-service',type:'service',category:'app',commit_sha:'a'.repeat(40)};
const query=async(manifest)=>{
 const rows=[{...base,manifest:JSON.stringify(manifest)}];
 const env={DB:{prepare:()=>({bind:()=>({all:async()=>({results:rows})})})}};
 const res=await worker.fetch(new Request('https://index.example/v1/search?q=screen'),env);
 assert.equal(res.status,200);return (await res.json()).apps[0];
};
test('search exposes only view presence from cached pinned manifest, not source/build metadata',async()=>{
 const a=await query({view:{path:'/',source:{build:'DO_NOT_EXPOSE'}}});
 assert.equal(a.has_view,true);assert.equal(a.type,'service');assert.equal(a.category,'app');
 assert.ok(!JSON.stringify(a).includes('DO_NOT_EXPOSE'));assert.equal(a.manifest,undefined);
});
test('only declared valid view paths establish presence',async()=>{
 for(const view of [undefined,null,{},false,{path:''},{path:'//outside'},{path:'/\n'},{path:'/\\outside'},'javascript:bad']) {
  assert.equal((await query({view})).has_view,false,JSON.stringify(view));
 }
});
