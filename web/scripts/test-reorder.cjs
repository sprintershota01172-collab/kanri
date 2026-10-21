// Regression: resorted cards and paired Gantt rows should animate, not snap.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const dateKey=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const dayOffset=n=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+n);return dateKey(d)};
const tasks=[
  {id:'far',title:'遠い納期',due:dayOffset(30),important:true,urgent:true,leadDays:1,duration:60,folderId:'work',group:'仕事',pin:true,rank:0,done:false,created:'2026-01-01T00:00:00.000Z',weekendWork:true},
  {id:'soon',title:'近い納期',due:dayOffset(1),important:true,urgent:true,leadDays:1,duration:60,folderId:'work',group:'仕事',pin:true,rank:1,done:false,created:'2026-01-02T00:00:00.000Z',weekendWork:true}
];
const animated=[];
let reducedMotion=false;
const dom=new JSDOM(html,{
  url:'https://example.test/kanri/',runScripts:'dangerously',pretendToBeVisual:true,
  beforeParse(win){
    win.localStorage.setItem('kanri_v1_tasks',JSON.stringify(tasks));
    win.localStorage.setItem('kanri_v2_view',JSON.stringify({tab:'board',folderId:'work'}));
    win.matchMedia=()=>({matches:reducedMotion,addListener(){},removeListener(){}});
    win.HTMLElement.prototype.getBoundingClientRect=function(){
      const el=this;
      let index=0,left=0,top=0;
      if(el.classList.contains('task-wrap')){
        index=Array.from(el.parentElement.children).indexOf(el);
        const quad=Number(el.closest('.quadrant')?.dataset.q||0);
        left=(quad%2)*160;top=100+Math.floor(quad/2)*170+index*44;
      } else if(el.classList.contains('gantt-label-complete-row')||el.classList.contains('gantt-task-row')){
        index=Array.from(el.parentElement.children).indexOf(el);
        left=el.classList.contains('gantt-task-row')?170:0;top=90+index*28;
      }
      return {x:left,y:top,left,top,width:140,height:28,right:left+140,bottom:top+28};
    };
    win.Element.prototype.animate=function(frames,opts){
      animated.push({id:this.dataset.reorderId,classes:this.className,frames,opts});
      return {addEventListener(){}};
    };
  }
});
const d=dom.window.document;
const order=selector=>Array.from(d.querySelectorAll(selector)).map(x=>x.dataset.reorderId);
const boardSelector='#board .task-wrap[data-reorder-id]';
assert.deepEqual(order(boardSelector),['far','soon'],'initial pinned order');
d.querySelector('#resetRank').click();
assert.deepEqual(order(boardSelector),['soon','far'],'unpin causes automatic due-date resort');
assert.ok(animated.filter(x=>x.classes.includes('task-wrap')).length>=2,'board resort animates old-to-new positions');
animated.length=0;
d.querySelector('[data-tab="calendar"]').click();
const names='#ganttNameBody .gantt-label-complete-row[data-reorder-id]';
const rows='#ganttDayBody .gantt-task-row[data-reorder-id]';
assert.deepEqual(order(names),['soon','far']);
assert.deepEqual(order(rows),['soon','far']);
d.querySelector('[data-gantt="far"][data-day="'+dayOffset(0)+'"]').click();
assert.deepEqual(order(names),['far','soon'],'due edit re-sorts Gantt labels');
assert.deepEqual(order(rows),['far','soon'],'due edit re-sorts Gantt date bars');
assert.ok(animated.some(x=>x.classes.includes('gantt-label-complete-row')),'Gantt names animate');
assert.ok(animated.some(x=>x.classes.includes('gantt-task-row')),'Gantt date bars animate');
assert.ok(animated.some(x=>x.frames[0]?.transform.includes('translate3d(')),'FLIP translation used');
animated.length=0;reducedMotion=true;
d.querySelector('[data-gantt="far"][data-day="'+dayOffset(2)+'"]').click();
assert.equal(animated.length,0,'respect prefers-reduced-motion');
dom.window.close();
console.log('PASS animated task resort, synchronized Gantt rows, reduced-motion preference');
