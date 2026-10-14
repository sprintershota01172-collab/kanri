import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_PREFS, DEFAULT_WORKSPACE, Preferences, Task, Workspace, completedTaskExpired } from './model';

// SQLite is the source of truth. Every task is stored locally, including notification IDs.
export async function migrate(db: SQLiteDatabase) {
  await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_updated_idx ON tasks(updated_at);
  `);
}
export async function readTasks(db: SQLiteDatabase): Promise<Task[]> {
  const rows = await db.getAllAsync<{payload:string}>('SELECT payload FROM tasks ORDER BY updated_at DESC');
  const result:Task[]=[];
  const now=Date.now();
  for(const row of rows){
    let task:Task;
    try{task=JSON.parse(row.payload) as Task}catch{continue}
    // Old completed tasks have no timestamp. Retain them for seven days from upgrade.
    if(task.completed && (!task.completedAt || !Number.isFinite(Date.parse(task.completedAt)))){
      task={...task,completedAt:new Date(now).toISOString()};
      await saveTask(db,task);
    }
    if(completedTaskExpired(task,now)){
      await deleteTask(db,task.id);
    }else result.push(task);
  }
  return result;
}
export async function saveTask(db: SQLiteDatabase,task: Task) {
  await db.runAsync('INSERT INTO tasks(id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
    task.id,JSON.stringify(task),task.updatedAt);
}
export async function deleteTask(db: SQLiteDatabase,id: string) {
  await db.runAsync('DELETE FROM tasks WHERE id=?',id);
}
export async function readPreferences(db: SQLiteDatabase): Promise<Preferences> {
  const row=await db.getFirstAsync<{value:string}>('SELECT value FROM meta WHERE key=?','preferences');
  if(!row) return {...DEFAULT_PREFS,names:[...DEFAULT_PREFS.names]};
  try {
    const prefs=JSON.parse(row.value) as Partial<Preferences>;
    return {...DEFAULT_PREFS,...prefs,names:(prefs.names?.length===4?prefs.names:DEFAULT_PREFS.names) as Preferences['names']};
  } catch {return {...DEFAULT_PREFS,names:[...DEFAULT_PREFS.names]};}
}
export async function savePreferences(db: SQLiteDatabase,prefs: Preferences) {
  await db.runAsync('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','preferences',JSON.stringify(prefs));
}

export async function readWorkspace(db:SQLiteDatabase):Promise<Workspace>{
  const row=await db.getFirstAsync<{value:string}>('SELECT value FROM meta WHERE key=?','workspace');
  if(!row)return {...DEFAULT_WORKSPACE,folders:DEFAULT_WORKSPACE.folders.map(f=>({...f}))};
  try{
    const source=JSON.parse(row.value) as Partial<Workspace>;
    const folders=Array.isArray(source.folders)?source.folders.filter(f=>f&&typeof f.id==='string'&&typeof f.name==='string'):DEFAULT_WORKSPACE.folders.map(f=>({...f}));
    const folderId=source.folderId&&folders.some(f=>f.id===source.folderId)?source.folderId:null;
    const tab=['board','calendar','puzzle','settings'].includes(String(source.tab))?source.tab as Workspace['tab']:'board';
    const recentFolderIds=(Array.isArray(source.recentFolderIds)?source.recentFolderIds:[]).filter(id=>typeof id==='string'&&folders.some(f=>f.id===id)).slice(0,4);
    return {folders,folderId,tab,recentFolderIds};
  }catch{return {...DEFAULT_WORKSPACE,folders:DEFAULT_WORKSPACE.folders.map(f=>({...f}))}}
}
export async function saveWorkspace(db:SQLiteDatabase,workspace:Workspace){
  await db.runAsync('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','workspace',JSON.stringify(workspace));
}
