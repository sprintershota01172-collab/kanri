export type Group = '仕事' | 'プライベート' | '学習' | 'その他';
export type BoardMode = 'priority' | 'group';
export type Folder = {id:string;name:string;parentId:string|null;kind?:'vehicle'};
export const DEFAULT_FOLDERS:Folder[]=[
  {id:'work',name:'業務',parentId:null},
  {id:'personal',name:'プライベート',parentId:null},
  {id:'study',name:'学習',parentId:null},
  {id:'other',name:'その他',parentId:null}
];
export type Workspace = {folders:Folder[];folderId:string|null;tab:'board'|'calendar'|'puzzle'|'settings';recentFolderIds?:string[]};
export const DEFAULT_WORKSPACE:Workspace={folders:DEFAULT_FOLDERS,folderId:null,tab:'board',recentFolderIds:[]};
export function folderForTask(t:Task){return t.folderId===undefined?({'仕事':'work','プライベート':'personal','学習':'study','その他':'other'}[t.group]||null):t.folderId;}
export function folderGroup(folders:Folder[],id:string|null):Group{
  let node=folders.find(f=>f.id===id),guard=0;
  while(node?.parentId&&guard++<30)node=folders.find(f=>f.id===node!.parentId);
  return node?.id==='work'?'仕事':node?.id==='personal'?'プライベート':node?.id==='study'?'学習':'その他';
}

export type Task = {
  id: string;
  folderId?: string | null;
  event?: boolean; // calendar appointment, not a completable focus task
  title: string;
  important: boolean;
  urgent: boolean;
  group: Group;
  durationMin: number;
  leadDays?: number; // working days excluding weekends
  ganttStart?: string | null; // manually selected Gantt start date
  dueDate: string | null; // YYYY-MM-DD, local date, deadline 23:59
  scheduledStart: string | null; // first/legacy scheduling slot
  scheduledBlocks?: string[]; // day-specific scheduling slots
  completed: boolean;
  completedAt?: string | null; // completion timestamp; purge after seven days
  pinned: boolean;
  manualOrder: number | null;
  notificationIds: string[];
  createdAt: string;
  updatedAt: string;
};
export type Preferences = {
  mode: BoardMode;
  names: [string, string, string, string];
  dark: boolean;
  remindersEnabled: boolean;
  leadMinutes: number;
  startReminder: boolean;
};
export const GROUPS: Group[] = ['仕事','プライベート','学習','その他'];
export const DEFAULT_PREFS: Preferences = {
  mode: 'priority',
  names: ['重要・緊急','重要・余裕あり','緊急・軽め','あとで考える'],
  dark: false,
  remindersEnabled: false,
  leadMinutes: 60,
  startReminder: true,
};
export const COLORS = ['#C98087','#6D8BC5','#C6A771','#70A094'];
export const pad = (value: number) => `${value}`.padStart(2,'0');
export const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
export function parseDateKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y,m,d] = key.split('-').map(Number);
  const date = new Date(y,m-1,d);
  return dateKey(date) === key ? date : null;
}
export function addDays(date: Date, amount: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}
export function daysUntil(key: string | null, today = new Date()): number | null {
  const date = key ? parseDateKey(key) : null;
  if (!date) return null;
  const atMidnight = new Date(today.getFullYear(),today.getMonth(),today.getDate());
  return Math.round((date.getTime()-atMidnight.getTime())/86400000);
}
export function priorityScore(task: Task, today = new Date()): number {
  const days = daysUntil(task.dueDate,today);
  const urgency = days === null ? 0 : days < 0 ? 1 : 1/(1+days/3);
  const importance = (Number(task.important)+Number(task.urgent))/2;
  const duration = Math.min(task.durationMin,180)/180;
  return Math.round(45*urgency + 35*importance + 20*duration + (days !== null && days < 0 ? 20 : 0));
}
export function quadrant(task: Task, prefs: Preferences): number {
  if (prefs.mode === 'group') return Math.max(0,GROUPS.indexOf(task.group));
  return task.important ? (task.urgent?0:1) : (task.urgent?2:3);
}
export function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a,b)=>{
    if (a.pinned !== b.pinned) return a.pinned ? -1:1;
    if (a.pinned) return (a.manualOrder ?? 999)-(b.manualOrder ?? 999);
    return priorityScore(b)-priorityScore(a) || a.createdAt.localeCompare(b.createdAt);
  });
}
export function moveToQuadrant(task: Task, index: number, prefs: Preferences): Task {
  if (prefs.mode === 'group') return {...task,group:GROUPS[index],pinned:false,manualOrder:null};
  return {...task,important:index<=1,urgent:index===0||index===2,pinned:false,manualOrder:null};
}
export function timeText(minutes: number) {return `${pad(Math.floor(minutes/60))}:${pad(minutes%60)}`;}
export function parseScheduleMinutes(start: string) {
  return Number(start.slice(11,13))*60 + Number(start.slice(14,16));
}
export function workdayKeys(dueDate:string|null,leadDays=1):string[]{
  const due=dueDate?parseDateKey(dueDate):null;if(!due)return [];
  const count=Math.max(1,Math.min(90,Number(leadDays)||1)),keys:string[]=[];
  for(let i=0;keys.length<count&&i<140;i++){
    const date=addDays(due,-i);
    if(date.getDay()!==0&&date.getDay()!==6)keys.push(dateKey(date));
  }
  return keys;
}
export function inTaskWorkWindow(task:Task,day:string):boolean{
  return !!task.dueDate&&(task.dueDate===day||workdayKeys(task.dueDate,task.leadDays||1).includes(day));
}
export function taskSlots(task:Task):string[]{
  return [...new Set([...(task.scheduledBlocks||[]),...(task.scheduledStart?[task.scheduledStart]:[])])].sort();
}
export function withTaskSlots(task:Task,slots:string[]):Task{
  const next=[...new Set(slots)].sort();
  return {...task,scheduledBlocks:next,scheduledStart:next[0]||null};
}
export function slotOnDay(task:Task,day:string):string|null{
  return taskSlots(task).find(slot=>slot.slice(0,10)===day)||null;
}
export function overlaps(tasks: Task[], selectedDate: string, fromMinute: number, durationMin: number, exceptId?: string) {
  return tasks.some(t=>{
    if(t.completed||t.id===exceptId)return false;
    return taskSlots(t).some(slot=>{
      if(slot.slice(0,10)!==selectedDate)return false;
      const start=parseScheduleMinutes(slot);
      return fromMinute<start+t.durationMin&&start<fromMinute+durationMin;
    });
  });
}
/** A 30-minute grid cell can accept a block only when fully inside its daypart. */
export function canSchedule(tasks: Task[], day: string, startMinute: number, durationMin: number, exceptId?: string): {ok:boolean,reason:string} {
  if (!parseDateKey(day)) return {ok:false,reason:'日付が正しくありません'};
  if (!Number.isFinite(startMinute) || startMinute%30!==0 || startMinute<480 || startMinute>=1200)
    return {ok:false,reason:'08:00〜20:00の30分単位で配置してください'};
  if (!Number.isFinite(durationMin) || durationMin<=0 || durationMin%30!==0)
    return {ok:false,reason:'所要時間は30分単位で指定してください'};
  const endOfDaypart = startMinute<840?840:1200;
  if (startMinute+durationMin>endOfDaypart) return {ok:false,reason:'この枠に収まりません'};
  if (overlaps(tasks,day,startMinute,durationMin,exceptId)) return {ok:false,reason:'ほかの予定と重なっています'};
  return {ok:true,reason:''};
}

export function createTask(title: string, dueDate: string|null, durationMin: number, important: boolean, urgent: boolean, group: Group): Task {
  const now = new Date().toISOString();
  return {id:`t_${Date.now()}_${Math.random().toString(36).slice(2,9)}`,title,dueDate,durationMin,important,urgent,group,
    leadDays:1,ganttStart:null,scheduledStart:null,scheduledBlocks:[],completed:false,completedAt:null,pinned:false,manualOrder:null,notificationIds:[],createdAt:now,updatedAt:now};
}
export function dueLabel(date: string|null) {
  const d=daysUntil(date);
  return d===null?'期限なし':d<0?`${-d}日超過`:d===0?'今日まで':d===1?'明日まで':`${d}日後`;
}

/** Paint the LT backwards from the due date, counting working days only. */
export function ganttCellFilled(task:Task,day:string):boolean{
  if(task.event)return !!task.scheduledStart&&task.scheduledStart.slice(0,10)===day;
  return workdayKeys(task.dueDate,task.leadDays||1).includes(day);
}
/** Seven days after completion a task leaves the recoverable trash. */
export const COMPLETED_RETENTION_MS = 7*24*60*60*1000;
export function completedTaskExpired(task:Task,now=Date.now()):boolean{
  return !!task.completed && !!task.completedAt && Number.isFinite(Date.parse(task.completedAt)) &&
    now-Date.parse(task.completedAt)>=COMPLETED_RETENTION_MS;
}
export function completeTaskForTrash(task:Task,now=new Date()):Task{
  return {...task,completed:true,completedAt:now.toISOString()};
}
export function restoreCompletedTask(task:Task):Task{
  return {...task,completed:false,completedAt:null};
}
