// Live drag regression: neighbor rows make room before the finger is released.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const tasks=['a','b','c'].map((id,rank)=>({
  id,title:'タスク'+id,due:'2026-12-31',important:true,urgent:true,
  leadDays:1,duration:60,folderId:'work',group:'仕事',pin:true,rank,
  done:false,created:'2026-10-01T00:00:0'+rank+'.000Z',weekendWork:true
}));
const shifts=[];
const dom=new JSDOM(html,{
  url:'https://example.test/kanri/',runScripts:'dangerously',pretendToBeVisual:true,
  beforeParse(w){
    w.localStorage.setItem('kanri_v1_tasks',JSON.stringify(tasks));
    w.localStorage.setItem('kanri_v2_view',JSON.stringify({tab:'board',folderId:'work'}));
    w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
    w.HTMLElement.prototype.setPointerCapture=function(){};
    w.HTMLElement.prototype.getAnimations=function(){return []};
    w.HTMLElement.prototype.getBoundingClientRect=function(){
      const node=this;
      const rect=(left,top,width,height)=>({left,top,width,height,x:left,y:top,right:left+width,bottom:top+height});
      if(node.classList.contains('quadrant')){
        const q=Number(node.dataset.q||0);
        return rect((q%2)*170,60+Math.floor(q/2)*310,165,280);
      }
      if(node.classList.contains('kanri-task-drag-ghost'))
        return rect(parseFloat(node.style.left)||0,parseFloat(node.style.top)||0,120,40);
      const item=node.classList.contains('task-wrap')||node.classList.contains('kanri-drag-slot')
        ?node:node.closest?.('.task-wrap');
      if(item&&item.closest('.quadrant')){
        const q=Number(item.closest('.quadrant').dataset.q||0);
        const siblings=Array.from(item.parentElement.children).filter(n=>
          (n.classList.contains('task-wrap')&&n.style.display!=='none')||
          n.classList.contains('kanri-drag-slot'));
        const i=siblings.indexOf(item);
        return rect((q%2)*170+8,100+Math.floor(q/2)*310+Math.max(0,i)*48,120,40);
      }
      return rect(0,0,120,40);
    };
    w.Element.prototype.animate=function(frames,opts){
      shifts.push({id:this.dataset.reorderId,className:this.className,frames,opts});
      return {addEventListener(){},cancel(){}};
    };
  }
});
const d=dom.window.document;
const visibleOrder=q=>Array.from(d.querySelectorAll('.quadrant[data-q="'+q+'"] .task-wrap[data-reorder-id]'))
  .filter(el=>el.style.display!=='none').map(el=>el.dataset.reorderId);
function pointer(el,type,x,y){
  const event=new dom.window.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});
  Object.defineProperty(event,'pointerId',{value:8});
  Object.defineProperty(event,'pointerType',{value:'mouse'});
  Object.defineProperty(event,'target',{value:el});
  el['on'+type](event);
}
(async()=>{
  assert.deepEqual(visibleOrder(0),['a','b','c']);
  const card=d.querySelector('[data-task="c"]');
  pointer(card,'pointerdown',70,214);
  await new Promise(resolve=>setTimeout(resolve,275));
  pointer(card,'pointermove',70,157);
  const area=d.querySelector('.quadrant[data-q="0"] .task-area');
  const slot=area.querySelector('.kanri-drag-slot');
  assert.ok(slot,'placeholder appears while finger is down');
  assert.equal(slot.nextElementSibling?.dataset.reorderId,'b','slot opens before target item');
  assert.ok(shifts.some(s=>s.id==='b'&&s.frames[0].transform.includes('translate3d')),'existing item slides away before drop');
  assert.equal(JSON.parse(dom.window.localStorage.getItem('kanri_v1_tasks')).find(t=>t.id==='c').rank,2,'no save during hover');
  pointer(card,'pointerup',70,157);
  assert.deepEqual(visibleOrder(0),['a','c','b'],'drop persists insertion between neighbors');
  assert.ok(!d.querySelector('.kanri-drag-slot'),'no temporary slot remains');
  assert.ok(!d.querySelector('.kanri-task-drag-ghost'),'floating drag card removed');
  const after=JSON.parse(dom.window.localStorage.getItem('kanri_v1_tasks'));
  assert.deepEqual(after.filter(t=>t.pin).sort((x,y)=>x.rank-y.rank).map(t=>t.id),['a','c','b'],'manual order persisted');
  d.querySelector('#undoBtn').click();
  assert.deepEqual(visibleOrder(0),['a','b','c'],'undo restores all displaced tasks');

  // Moving to an empty quadrant must show the gap at the top, not after filler.
  const toMove=d.querySelector('[data-task="b"]');
  pointer(toMove,'pointerdown',70,165);
  await new Promise(resolve=>setTimeout(resolve,275));
  pointer(toMove,'pointermove',205,157);
  const target=d.querySelector('.quadrant[data-q="1"] .task-area');
  assert.equal(target.firstElementChild?.className,'kanri-drag-slot','empty destination displays drop gap');
  pointer(toMove,'pointerup',205,157);
  assert.deepEqual(visibleOrder(1),['b'],'cross-quadrant drop moves task to destination');

  dom.window.close();
  console.log('PASS live insertion, neighbor animation, saved order, undo, empty destination');
})().catch(error=>{console.error(error);dom.window.close();process.exitCode=1});
