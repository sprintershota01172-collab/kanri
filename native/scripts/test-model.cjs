'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/model.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sandbox={exports:{},module:{exports:{}},Date,Math,console};
// TS CommonJS emits exports.*, so module.exports references exports.
sandbox.module.exports=sandbox.exports;
vm.runInNewContext(compiled,sandbox);
const m=sandbox.exports;
function test(name,fn){fn();console.log('PASS',name)}
const base=m.createTask('example',null,60,false,false,'仕事');
test('date string validates leap day',()=>{assert.ok(m.parseDateKey('2028-02-29'));assert.equal(m.parseDateKey('2027-02-29'),null)});
test('quadrant mapping works for four priority cases',()=>{
 const prefs=m.DEFAULT_PREFS;
 assert.equal(m.quadrant({...base,important:true,urgent:true},prefs),0);
 assert.equal(m.quadrant({...base,important:true,urgent:false},prefs),1);
 assert.equal(m.quadrant({...base,important:false,urgent:true},prefs),2);
 assert.equal(m.quadrant({...base,important:false,urgent:false},prefs),3);
});
test('group mode maps each of four groups',()=>{for(let i=0;i<4;i++)assert.equal(m.quadrant({...base,group:m.GROUPS[i]},{...m.DEFAULT_PREFS,mode:'group'}),i)});
test('overdue priority scores above distant task',()=>{
 const today=new Date(2026,9,14),old={...base,dueDate:'2026-10-12'},future={...base,dueDate:'2026-12-14'};
 assert.ok(m.priorityScore(old,today)>m.priorityScore(future,today));
});
test('pinned tasks override auto score',()=>{
 const future={...base,id:'future',pinned:true,manualOrder:1,createdAt:'2026-01-01'},urgent={...base,id:'urgent',important:true,urgent:true,dueDate:m.dateKey(new Date()),pinned:false,createdAt:'2026-01-02'};
 assert.equal(m.sortTasks([urgent,future])[0].id,'future');
});
test('slot overlap treats adjacent events as non-conflicts',()=>{
 const scheduled={...base,id:'scheduled',scheduledStart:'2026-10-14T09:00',durationMin:60};
 assert.equal(m.overlaps([scheduled],'2026-10-14',570,30),true);
 assert.equal(m.overlaps([scheduled],'2026-10-14',600,30),false);
 assert.equal(m.overlaps([scheduled],'2026-10-15',570,30),false);
});
test('moving priority quadrant recalculates properties',()=>{
 const moved=m.moveToQuadrant({...base,pinned:true,manualOrder:9},2,m.DEFAULT_PREFS);
 assert.equal(moved.urgent,true);assert.equal(moved.important,false);assert.equal(moved.pinned,false);
});
test('schedule rejects overlap and accepts adjacent task',()=>{
 const scheduled={...base,id:'a',scheduledStart:'2026-10-14T09:00',durationMin:60};
 assert.equal(m.canSchedule([scheduled],'2026-10-14',570,30,'b').ok,false);
 assert.equal(m.canSchedule([scheduled],'2026-10-14',600,30,'b').ok,true);
});
test('schedule rejects cross-daypart and invalid grid precision',()=>{
 assert.equal(m.canSchedule([],'2026-10-14',810,60).ok,false);
 assert.equal(m.canSchedule([],'2026-10-14',600,45).ok,false);
 assert.equal(m.canSchedule([],'2026-10-14',605,30).ok,false);
 assert.equal(m.canSchedule([],'2026-10-14',840,180).ok,true);
});
test('Gantt lead time fills one day square per day across month boundary',()=>{
 const task={...base,leadDays:5,ganttStart:'2026-10-29'};
 assert.equal(m.ganttCellFilled(task,'2026-10-28'),false);
 assert.equal(m.ganttCellFilled(task,'2026-10-29'),true);
 assert.equal(m.ganttCellFilled(task,'2026-10-31'),true);
 assert.equal(m.ganttCellFilled(task,'2026-11-02'),true);
 assert.equal(m.ganttCellFilled(task,'2026-11-03'),false);
});
test('Gantt falls back to scheduled start and tolerates old tasks without LT',()=>{
 const task={...base,scheduledStart:'2026-10-14T10:00'};
 assert.equal(m.ganttCellFilled(task,'2026-10-14'),true);
 assert.equal(m.ganttCellFilled(task,'2026-10-15'),false);
});
test('completed task is kept for seven days then expires',()=>{
 const completedAt=new Date('2026-10-15T00:00:00.000Z');
 const done=m.completeTaskForTrash(base,completedAt);
 assert.equal(done.completed,true);
 assert.equal(done.completedAt,'2026-10-15T00:00:00.000Z');
 assert.equal(m.completedTaskExpired(done,new Date('2026-10-21T23:59:59.999Z').getTime()),false);
 assert.equal(m.completedTaskExpired(done,new Date('2026-10-22T00:00:00.000Z').getTime()),true);
 const restored=m.restoreCompletedTask(done);
 assert.equal(restored.completed,false);
 assert.equal(restored.completedAt,null);
 assert.equal(m.completedTaskExpired(restored,new Date('2026-11-01T00:00:00.000Z').getTime()),false);
 assert.equal(base.completed,false,'original task is not mutated');
});
console.log('Model tests completed.');