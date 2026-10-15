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
test('weekday LT from due date excludes weekends across month boundary',()=>{
 const task={...base,leadDays:5,dueDate:'2026-11-03'};
 for(const day of ['2026-10-28','2026-10-29','2026-10-30','2026-11-02','2026-11-03'])
   assert.equal(m.ganttCellFilled(task,day),true,day);
 for(const day of ['2026-10-27','2026-10-31','2026-11-01','2026-11-04'])
   assert.equal(m.ganttCellFilled(task,day),false,day);
});
test('five-day deadline with 2 LT paints fourth and fifth (weekdays)',()=>{
 const task={...base,leadDays:2,dueDate:'2026-11-05'};
 assert.equal(m.ganttCellFilled(task,'2026-11-04'),true);
 assert.equal(m.ganttCellFilled(task,'2026-11-05'),true);
 assert.equal(m.ganttCellFilled(task,'2026-11-03'),false);
});
test('single legacy schedule does not replace due-date Gantt base',()=>{
 const task={...base,dueDate:'2026-10-16',leadDays:2,scheduledStart:'2026-10-14T10:00'};
 assert.equal(m.ganttCellFilled(task,'2026-10-15'),true);
 assert.equal(m.ganttCellFilled(task,'2026-10-14'),false);
});
test('daily scheduling slots preserve previous days and detect conflicts',()=>{
 const task=m.withTaskSlots({...base,id:'a',dueDate:'2026-10-19',leadDays:2},['2026-10-16T09:00','2026-10-19T14:00']);
 assert.equal(m.inTaskWorkWindow(task,'2026-10-16'),true);
 assert.equal(m.inTaskWorkWindow(task,'2026-10-17'),false);
 assert.equal(m.slotOnDay(task,'2026-10-19'),'2026-10-19T14:00');
 assert.equal(m.taskSlots(task).length,2);
 assert.equal(m.overlaps([task],'2026-10-19',855,30),true);
 assert.equal(m.overlaps([task],'2026-10-16',570,30),true);
});
test('changing puzzle duration only changes the selected scheduled day',()=>{
 const before=m.withTaskSlots({...base,id:'daily',durationMin:60,dueDate:'2026-10-19'},['2026-10-16T09:00','2026-10-19T14:00']);
 const extended=m.withSlotDuration(before,'2026-10-16T09:00',120);
 assert.equal(m.durationForSlot(extended,'2026-10-16T09:00'),120);
 assert.equal(m.durationForSlot(extended,'2026-10-19T14:00'),60);
 assert.equal(m.durationForSlot(before,'2026-10-16T09:00'),60);
 assert.equal(m.canSchedule([extended],'2026-10-16',630,30,'other').ok,false);
 assert.equal(m.canSchedule([extended],'2026-10-16',660,30,'other').ok,true);
});
test('puzzle duration follows a moved slot and resets on removal',()=>{
 const initial=m.withSlotDuration(m.withTaskSlots({...base,id:'daily',durationMin:60},['2026-10-16T09:00']), '2026-10-16T09:00',120);
 const moved=m.withSlotDuration(m.withTaskSlots(initial,['2026-10-16T10:00']),'2026-10-16T10:00',120);
 assert.equal(m.durationForSlot(moved,'2026-10-16T10:00'),120);
 assert.equal(m.durationForSlot(moved,'2026-10-16T09:00'),60);
 const removed=m.withTaskSlots(moved,[]);
 assert.equal(Object.keys(removed.scheduledDurations).length,0);
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