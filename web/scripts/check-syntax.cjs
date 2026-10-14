// Offline smoke checks for the single-file kanri web app.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
assert.ok(scripts.length>0,'Expected inline application script');
for(const script of scripts) new vm.Script(script,{filename:'web/index.html (inline script)'});
const required=[
  'gantt-scroll','gantt-label-head','gantt-grid-row','gantt-square',
  'ganttScrollX','--days','data-gantt','data-edit','id="closeTask"','id="cancelTask"'
];
for(const keyword of required) assert.ok(html.includes(keyword),'Missing '+keyword);
assert.ok(html.includes('const days=new Date(base.getFullYear(),base.getMonth()+1,0).getDate()'),'Gantt must account for real month lengths');
assert.ok(html.includes('grid-template-columns:repeat(var(--days),36px)'),'Date cells must have uniform width');
assert.ok(!html.includes('YOUR FLOW, IN ORDER.'),'Remove decorative slogans');
assert.ok(html.includes('ganttBlankCount')===false || html.includes('gantt-blank-row'),'Gantt empty grid must be drawn');
assert.ok(html.includes('gantt-blank-row'),'Gantt should render fully bordered rows without tasks');
assert.ok(html.includes('for(let blank=view.length;blank<rowCount;blank++)'),'Gantt should fill remaining rows');
assert.ok(html.includes("Array.from({length:days},(_,i)=>"),'Gantt should show all days in selected month');
assert.ok(html.includes('gantt-empty-square'),'Gantt blank cells must retain borders');
assert.ok(html.includes('--kanri-standalone-height'),'PWA should correct standalone viewport height');
for(const key of ['/* v1.6 - dense, content-first UI','board-foot[hidden]','header-actions','month-grid{flex:1','sheet-actions .primary{min-height:44px']) {
 assert.ok(html.includes(key),'Missing compact UI rule '+key);
}
assert.ok(html.includes("$('#boardScreen .board-foot').hidden=!tasks.some(t=>t.pin)"),'Unneeded ranking controls should be hidden');
assert.doesNotMatch(html,/(?<!\$)\$\([^()\n]+\)\.forEach\(/,'Do not use querySelector on collection loops');
console.log('Web syntax, full Gantt grid, viewport, and compact UI checks passed');
