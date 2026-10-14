const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const dom=new JSDOM(html,{
  url:'https://kanri.example.test/',pretendToBeVisual:true,runScripts:'dangerously',
  beforeParse(win){win.matchMedia=()=>({matches:false,addListener(){},removeListener(){}})}
});
const doc=dom.window.document;
const get=s=>{const el=doc.querySelector(s);assert.ok(el,'Missing '+s);return el};
function click(s){get(s).click()}
function tasks(){return JSON.parse(dom.window.localStorage.getItem('kanri_v1_tasks')||'[]')}
click('#addButton');
assert.ok(get('#fDueButton'),'due date is a calendar picker, not text input');
assert.equal(get('#fDue').type,'hidden','due date cannot trigger text keyboard');
click('#fDueButton');
assert.equal(doc.querySelectorAll('[data-due-date]').length,42,'42 calendar choices');
click('#dateNext');
assert.equal(doc.querySelectorAll('[data-due-date]').length,42,'calendar month navigation');
click('#datePrev');
const date='2026-10-20';
for(let i=0;i<36&&!doc.querySelector('[data-due-date="'+date+'"]');i++)click('#dateNext');
assert.ok(get('[data-due-date="'+date+'"]'));
click('[data-due-date="'+date+'"]');
assert.equal(get('#fDue').value,date,'picked day saved inside form');
assert.equal(get('#fDueText').textContent,date,'chosen due date visible in button');
get('#fTitle').value='週次報告';
click('#saveTask');
assert.equal(tasks().length,1);
assert.equal(tasks()[0].due,date,'calendar selection persists to task');
click('[data-tab="calendar"]');
click('[data-mode="month"]');
for(let i=0;i<20&&!doc.querySelector('[data-caldate="'+date+'"]');i++)click('#nextDate');
assert.ok(get('[data-caldate="'+date+'"]').textContent.includes('週次報告'),'task title visible in month cell');
assert.ok(get('[data-caladd="'+date+'"]'),'date has add task action');
const other='2026-10-21';
click('[data-caladd="'+other+'"]');
assert.equal(get('#fDue').value,other,'calendar add preselects matching due date');
get('#fTitle').value='新規打ち合わせ';
click('#saveTask');
assert.equal(tasks().length,2);
assert.ok(get('[data-caldate="'+other+'"]').textContent.includes('新規打ち合わせ'),'saved task appears immediately on calendar');
click('[data-mode="week"]');
for(let i=0;i<20&&!doc.querySelector('[data-caldate="'+date+'"]');i++)click('#nextDate');
assert.ok(get('[data-caldate="'+date+'"]').textContent.includes('週次報告'),'week cell shows title');
assert.ok(get('[data-caldate="'+other+'"]').textContent.includes('新規打ち合わせ'),'week cell shows multiple tasks on different dates');
click('[data-caladd="'+date+'"]');
assert.equal(get('#fDue').value,date,'week-add uses tapped date');
click('#cancelTask');
assert.equal(tasks().length,2,'cancel closes without saving task');
click('[data-tab="settings"]');
click('#rename');
assert.ok(get('[data-name]'),'settings text-input overlay opens');
assert.equal(dom.window.getComputedStyle(get('#modal')).position,'fixed','settings overlay should not move with page flow');
assert.ok(doc.documentElement.style.getPropertyValue('--kanri-locked-height'),'fixed viewport captured before keyboard');
click('#namesOK');
assert.equal(dom.window.localStorage.getItem('kanri_v1_tasks')!==null,true,'existing data retained');
dom.window.close();
console.log('PASS calendar due picker, task titles on month/week, quick create, stable modal');
