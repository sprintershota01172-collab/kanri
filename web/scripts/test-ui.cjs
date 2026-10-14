const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
function start(cached={}){
 const dom=new JSDOM(html,{url:'https://example.test/kanri/',runScripts:'dangerously',pretendToBeVisual:true,
 beforeParse(win){
   win.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
   win.HTMLElement.prototype.setPointerCapture=function(){this._captured=true};
   win.HTMLElement.prototype.hasPointerCapture=function(){return this._captured===true};
   win.HTMLElement.prototype.releasePointerCapture=function(){this._captured=false};
   for(const [k,v] of Object.entries(cached))win.localStorage.setItem(k,v);
 }});
 return dom;
}
function q(doc,selector){const node=doc.querySelector(selector);assert.ok(node,'Expected selector '+selector);return node}
function click(doc,s){q(doc,s).click()}
function pointer(win,el,type,x,y){const e=new win.MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:1});Object.defineProperty(e,'pointerType',{value:'touch'});el.dispatchEvent(e)}
let dom=start(),d=dom.window.document;
assert.equal(d.querySelectorAll('.folder-tile').length,4,'initial folder roots');
click(d,'[data-folder-open="work"]');
assert.ok(q(d,'.folder-crumb.current').textContent.includes('業務'),'entered work');
click(d,'#folderAdd');
q(d,'#folderName').value='案件A';
click(d,'#folderSave');
assert.ok(q(d,'.folder-crumb.current').textContent.includes('案件A'),'folder creation and navigation');
const storedFolders=JSON.parse(dom.window.localStorage.getItem('kanri_v2_folders'));
const child=storedFolders.find(f=>f.name==='案件A');
assert.equal(child.parentId,'work');
click(d,'.quadrant[data-q="0"]');
q(d,'#fTitle').value='報告書';
assert.equal(q(d,'#fFolder').value,child.id,'default folder selection');
click(d,'#saveTask');
const tasks=JSON.parse(dom.window.localStorage.getItem('kanri_v1_tasks'));
assert.equal(tasks.length,1);
assert.equal(tasks[0].folderId,child.id);
assert.equal(tasks[0].group,'仕事');
const saved=Object.fromEntries(Object.keys(dom.window.localStorage).map(k=>[k,dom.window.localStorage.getItem(k)]));
dom.window.close();
dom=start(saved);d=dom.window.document;
assert.ok(q(d,'.folder-crumb.current').textContent.includes('案件A'),'restore last folder');
assert.equal(d.querySelectorAll('.task-card').length,1,'restore task');
click(d,'[data-tab="settings"]');
assert.equal(JSON.parse(dom.window.localStorage.getItem('kanri_v2_view')).tab,'settings','persist tab');
click(d,'#darkToggle');
assert.ok(q(d,'.device').classList.contains('dark'),'dark mode toggled');
const main=q(d,'.main');
pointer(dom.window,main,'pointerdown',115,450);
pointer(dom.window,main,'pointerup',290,460);
assert.ok(q(d,'#puzzleScreen').classList.contains('active'),'horizontal swipe switches tab');
click(d,'[data-tab="board"]');
const card=q(d,'.task-card');
pointer(dom.window,card,'pointerdown',200,500);
pointer(dom.window,card,'pointermove',106,503);
pointer(dom.window,card,'pointerup',106,503);
click(d,'[data-task-trash]');
assert.ok(q(d,'#confirmDelete'),'delete confirmation opened');
click(d,'#confirmCancel');
assert.equal(JSON.parse(dom.window.localStorage.getItem('kanri_v1_tasks')).length,1,'cancel keeps task');
click(d,'[data-task-trash]');
click(d,'#confirmDelete');
assert.equal(JSON.parse(dom.window.localStorage.getItem('kanri_v1_tasks')).length,0,'confirm deletes task');
click(d,'[data-folder-path="work"]');
const nested=q(d,'[data-folder-open="'+child.id+'"]');
pointer(dom.window,nested,'pointerdown',170,220);
pointer(dom.window,nested,'pointermove',100,221);
pointer(dom.window,nested,'pointerup',100,221);
click(d,'[data-folder-trash="'+child.id+'"]');
assert.ok(q(d,'#confirmDelete'),'folder deletion confirmation');
click(d,'#confirmCancel');
assert.ok(JSON.parse(dom.window.localStorage.getItem('kanri_v2_folders')).some(f=>f.id===child.id),'cancel keeps folder');
click(d,'[data-folder-trash="'+child.id+'"]');
click(d,'#confirmDelete');
assert.ok(!JSON.parse(dom.window.localStorage.getItem('kanri_v2_folders')).some(f=>f.id===child.id),'confirmed folder deletion');
dom.window.close();
console.log('PASS folder create / assign / restore / dark / tab swipe / confirmed task and folder deletion');
