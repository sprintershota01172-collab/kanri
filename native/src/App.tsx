import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Alert,Keyboard,Modal,Pressable,StatusBar,StyleSheet,Text,TextInput,View,useWindowDimensions,BackHandler,ScrollView,Platform,AppState} from 'react-native';
import {SQLiteProvider,useSQLiteContext} from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import {Gesture,GestureDetector,GestureHandlerRootView} from 'react-native-gesture-handler';
import {scheduleOnRN} from 'react-native-worklets';
import Animated,{FadeIn,FadeInDown,FadeOut,withSpring,withTiming,withRepeat,cancelAnimation,Easing,useAnimatedStyle,useSharedValue} from 'react-native-reanimated';
import {SafeAreaProvider,useSafeAreaInsets} from 'react-native-safe-area-context';
import {addDays,canSchedule,COLORS,createTask,dateKey,DEFAULT_PREFS,daysUntil,dueLabel,GROUPS,Group,moveToQuadrant,pad,parseDateKey,parseScheduleMinutes,Preferences,priorityScore,quadrant,sortTasks,Task,timeText,Folder,Workspace,DEFAULT_WORKSPACE,folderForTask,folderGroup,completeTaskForTrash,restoreCompletedTask,COMPLETED_RETENTION_MS,workdayKeys,inTaskWorkWindow,taskSlots,withTaskSlots,slotOnDay,durationForSlot,withSlotDuration} from './model';
import {deleteTask,migrate,readPreferences,readTasks,savePreferences,saveTask,readWorkspace,saveWorkspace} from './storage';
import {cancelTaskNotifications,registerNotifications,requestLocalPermissions,scheduleTaskNotifications,snoozeTask} from './reminders';
import {shareExcel} from './xlsxExport';

type Tab = 'board'|'calendar'|'puzzle'|'settings';
type Mode = 'month'|'week'|'gantt';
type Theme = {bg:string,card:string,ink:string,muted:string,line:string,tint:string,navy:string,inverse:string};
const LIGHT:Theme={bg:'#F3F5F7',card:'#FFFFFF',ink:'#152238',muted:'#8591A3',line:'#E7EBF0',tint:'#E8EDF8',navy:'#101D32',inverse:'#FFFFFF'};
const DARK:Theme={bg:'#0F1727',card:'#213048',ink:'#FFFFFF',muted:'#D0D8E7',line:'#50617C',tint:'#334D71',navy:'#08111F',inverse:'#FFFFFF'};
function typeStyle(color:string,size=12,weight:'400'|'500'|'600'|'700'|'800'='600') {return {color,fontSize:size,fontWeight:weight,fontFamily:Platform.OS==='ios'?'HiraginoSans-W3':'sans-serif',letterSpacing:size<=11?0.03:-0.12} as const;}
function belongsToFolder(task:Task,folderId:string|null,folders:Folder[]):boolean{
  if(!folderId)return true;
  let id=folderForTask(task),guard=0;
  while(id&&guard++<30){if(id===folderId)return true;id=folders.find(f=>f.id===id)?.parentId||null}
  return false;
}
function Chip({title,selected,onPress,theme,flex=1}:{title:string,selected?:boolean,onPress:()=>void,theme:Theme,flex?:number}){
  return <Pressable onPress={onPress} style={[styles.chip,{flex,backgroundColor:selected?theme.tint:theme.bg,borderColor:selected?'#8FAADD':theme.line}]}><Text numberOfLines={1} style={typeStyle(selected?(theme===DARK?'#E6EFFF':'#5475B6'):theme.ink,10,'700')}>{title}</Text></Pressable>;
}
function IconButton({label,onPress,theme}:{label:string,onPress:()=>void,theme:Theme}){
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.iconButton,{backgroundColor:theme.card,borderColor:theme.line}]}><Text style={typeStyle(theme.ink,12,'700')}>{label}</Text></Pressable>;
}
function AppInner(){
  const db=useSQLiteContext();const insets=useSafeAreaInsets();const {height:winHeight}=useWindowDimensions();const stableEditorHeight=useRef(winHeight);
  const [tasks,setTasks]=useState<Task[]>([]);const [prefs,setPrefs]=useState<Preferences>(DEFAULT_PREFS);
  const [loaded,setLoaded]=useState(false);const [tab,setTab]=useState<Tab>('board');
  const [workspace,setWorkspace]=useState<Workspace>({...DEFAULT_WORKSPACE,folders:DEFAULT_WORKSPACE.folders.map(f=>({...f}))});
  const [newFolderOpen,setNewFolderOpen]=useState(false);
  const [folderDraft,setFolderDraft]=useState<{parentId:string|null,name?:string,renameId?:string,label:string}|null>(null);
  const [groupAddOpen,setGroupAddOpen]=useState(false);
  const [groupActionsId,setGroupActionsId]=useState<string|null>(null);
  const [folderMenuOpen,setFolderMenuOpen]=useState(false);
  const [trashOpen,setTrashOpen]=useState(false);
  const [eventEditor,setEventEditor]=useState<Task|'new'|null>(null);
  const swipeStart=useRef<{x:number;y:number;time:number}|null>(null);
  const [editor,setEditor]=useState<Task|'new'|null>(null);const [newQuadrant,setNewQuadrant]=useState<number|null>(null);const [calendarDraftDate,setCalendarDraftDate]=useState<string|null>(null);
  const [renaming,setRenaming]=useState(false);
  const [leadEditor,setLeadEditor]=useState(false);
  const [toast,setToast]=useState('');const toastRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [undo,setUndo]=useState<{label:string,fn:()=>void}|null>(null);
  const undoTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [boardPages,setBoardPages]=useState([0,0,0,0]);const [boardPageMap,setBoardPageMap]=useState<Record<string,number>>({});
  const [boardViewport,setBoardViewport]=useState(Math.max(420,winHeight-195));
  const [newTaskFolderId,setNewTaskFolderId]=useState<string|null>(null);
  const [calMode,setCalMode]=useState<Mode>('gantt');const [focus,setFocus]=useState(new Date());const [ganttPage,setGanttPage]=useState(0);
  const [puzzleDate,setPuzzleDate]=useState(new Date());const [selectedBlock,setSelectedBlock]=useState<string|null>(null);const [selectedPuzzleSlot,setSelectedPuzzleSlot]=useState<string|null>(null);const [inboxPage,setInboxPage]=useState(0);
  const groupScrollRef=useRef<ScrollView>(null),groupScrollX=useRef(0);
  const boardScrollRef=useRef<ScrollView>(null),boardGridRefs=useRef<Record<string,View|null>>({});const morningRef=useRef<View>(null);const afternoonRef=useRef<View>(null);const puzzleInboxRef=useRef<View>(null);
  const [panelHeight,setPanelHeight]=useState(290);const tasksRef=useRef(tasks);const prefsRef=useRef(prefs);
  tasksRef.current=tasks;prefsRef.current=prefs;
  const theme=prefs.dark?DARK:LIGHT;
  function addInQuadrant(index:number,folderId:string|null=workspace.folderId){setNewTaskFolderId(folderId);setCalendarDraftDate(null);setNewQuadrant(index);setEditor('new')}

  const toastMessage=(s:string)=>{setToast(s);if(toastRef.current)clearTimeout(toastRef.current);toastRef.current=setTimeout(()=>setToast(''),2200)};
  function remember(label:string,fn:()=>void){setUndo({label,fn});if(undoTimer.current)clearTimeout(undoTimer.current);undoTimer.current=setTimeout(()=>setUndo(null),7500)}
  function undoAction(){if(!undo)return;undo.fn();setUndo(null);void Haptics.selectionAsync()}

  useEffect(()=>{
    let active=true;
    async function init(){
      try{
        await registerNotifications();
        const [list,config,savedWorkspace]=await Promise.all([readTasks(db),readPreferences(db),readWorkspace(db)]);
        if(active){setTasks(list);setPrefs(config);setWorkspace(savedWorkspace);setTab(savedWorkspace.tab);setLoaded(true)}
      }catch(error){console.error(error);if(active){setLoaded(true);Alert.alert('データ読み込みに失敗','アプリを再起動してください')}}
    }
    void init();return ()=>{active=false};
  },[db]);

  useEffect(()=>{
    if(!loaded)return;
    const refresh=()=>{void readTasks(db).then(items=>setTasks(items)).catch(error=>console.warn('completed task cleanup failed',error))};
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')refresh()});
    const interval=setInterval(refresh,60*60*1000);
    return ()=>{subscription.remove();clearInterval(interval)};
  },[db,loaded]);
  useEffect(()=>{if(loaded){void saveWorkspace(db,{...workspace,tab}).catch(e=>console.warn('folder state persistence',e))}},[db,workspace,tab,loaded]);
  function clearPuzzleSelection(){setSelectedBlock(null);setSelectedPuzzleSlot(null)}
  function selectTab(next:Tab){if(next!=='puzzle')clearPuzzleSelection();setTab(next)}
  function selectFolder(id:string|null){setWorkspace(p=>({...p,folderId:id,recentFolderIds:id?[id,...(p.recentFolderIds||[]).filter(x=>x!==id)].slice(0,4):p.recentFolderIds}));setBoardPages([0,0,0,0]);boardScrollRef.current?.scrollTo({y:0,animated:false})}
  function beginFolderEdit(parentId:string|null,label='子ツリー',renameId?:string){
    const target=renameId?workspace.folders.find(f=>f.id===renameId):undefined;
    setGroupAddOpen(false);setGroupActionsId(null);
    setFolderDraft({parentId,label,renameId,name:target?.name});
    setFolderMenuOpen(false);setNewFolderOpen(true);
  }
  function createFolder(name:string){
    const trimmed=name.trim(),parentId=folderDraft?.parentId??null;
    if(!trimmed){Alert.alert('フォルダ名を入力してください');return}
    if(workspace.folders.some(f=>f.id!==folderDraft?.renameId&&f.parentId===parentId&&f.name===trimmed)){Alert.alert('同じ名前のフォルダがあります');return}
    if(folderDraft?.renameId){
      const id=folderDraft.renameId;
      setWorkspace(p=>({...p,folders:p.folders.map(f=>f.id===id?{...f,name:trimmed}:f)}));
    }else{
      const id='folder_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
      setWorkspace(p=>({...p,folders:[...p.folders,{id,name:trimmed,parentId}],folderId:parentId??id,recentFolderIds:[id,...(p.recentFolderIds||[]).filter(x=>x!==id)].slice(0,4)}));
    }
    setNewFolderOpen(false);setFolderDraft(null);setBoardPages([0,0,0,0]);
  }
  function moveFolder(id:string,delta:number){
    const f=workspace.folders.find(x=>x.id===id);if(!f)return;
    const siblings=workspace.folders.filter(x=>x.parentId===f.parentId);
    const from=siblings.findIndex(x=>x.id===id),to=from+delta;
    if(to<0||to>=siblings.length)return;
    const [item]=siblings.splice(from,1);siblings.splice(to,0,item);
    let idx=0;
    setWorkspace(p=>({...p,folders:p.folders.map(x=>x.parentId===f.parentId?siblings[idx++]:x)}));
    void Haptics.selectionAsync();
  }
  function deleteFolder(id:string){
    const f=workspace.folders.find(x=>x.id===id);if(!f)return;
    const parent=f.parentId??workspace.folders.find(x=>x.parentId===null&&x.id!==id)?.id??null;
    if(!parent){Alert.alert('最後のグループは削除できません');return}
    const linked=tasksRef.current.filter(t=>folderForTask(t)===id);
    Alert.alert('グループ・ツリーを削除',f.name+' を削除しますか？ 中のタスクと子ツリーは別のグループまたは親フォルダに移します。',[
      {text:'キャンセル',style:'cancel'},
      {text:'削除',style:'destructive',onPress:()=>{
        for(const task of linked)void updateTask({...task,folderId:parent,group:folderGroup(workspace.folders,parent)});
        setWorkspace(p=>({...p,folderId:p.folderId===id?parent:p.folderId,folders:p.folders.filter(x=>x.id!==id).map(x=>x.parentId===id?{...x,parentId:parent}:x),recentFolderIds:(p.recentFolderIds||[]).filter(x=>x!==id)}));
        setGroupActionsId(null);
      }}
    ]);
  }
  async function updateTask(next:Task,old:Task|null=tasksRef.current.find(t=>t.id===next.id)??null){
    const item={...next,updatedAt:new Date().toISOString(),notificationIds:[]};
    setTasks(previous=>[...previous.filter(t=>t.id!==item.id),item]);
    try{
      await saveTask(db,item);
      if(old)await cancelTaskNotifications(old);
      const ids=await scheduleTaskNotifications(item,prefsRef.current);
      const stored={...item,notificationIds:ids};
      await saveTask(db,stored);
      setTasks(previous=>previous.map(t=>t.id===item.id&&t.updatedAt===item.updatedAt?stored:t));
    }catch(e){console.warn('kanri task save failed',e);toastMessage('保存できませんでした。再試行してください')}
  }
  function markCompleted(task:Task){
    if(task.completed||task.event)return;
    if(selectedBlock===task.id){setSelectedBlock(null);setSelectedPuzzleSlot(null)}
    void updateTask(completeTaskForTrash(task));
    void Haptics.selectionAsync();
    remember('完了済みに移動しました',()=>{void updateTask(restoreCompletedTask(task))});
  }
  function restoreFromTrash(task:Task){
    void updateTask(restoreCompletedTask(task));
    void Haptics.selectionAsync();
    toastMessage('元のフォルダに復元しました');
  }
  async function removeTask(item:Task){
    setTasks(previous=>previous.filter(t=>t.id!==item.id));
    try{await cancelTaskNotifications(item);await deleteTask(db,item.id)}catch(e){console.warn(e);toastMessage('削除できませんでした')}
  }
  async function updatePreferences(next:Preferences){
    const previous=prefsRef.current;
    setPrefs(next);prefsRef.current=next;
    try{
      await savePreferences(db,next);
      if(previous.remindersEnabled!==next.remindersEnabled||previous.leadMinutes!==next.leadMinutes||previous.startReminder!==next.startReminder){
        for(const task of tasksRef.current){
          await cancelTaskNotifications(task);
          const ids=await scheduleTaskNotifications(task,next);
          const updated={...task,notificationIds:ids};
          await saveTask(db,updated);
          setTasks(old=>old.map(t=>t.id===task.id?updated:t));
        }
      }
    }catch(e){console.warn(e);toastMessage('設定を保存できませんでした')}
  }
  useEffect(()=>{
    if(!loaded)return;
    const seen=new Set<string>();
    const handle=async(response:Notifications.NotificationResponse)=>{
      const notification=response.notification;
      const dedupe=`${notification.request.identifier}:${response.actionIdentifier}`;
      if(seen.has(dedupe))return;seen.add(dedupe);
      const id=String(notification.request.content.data?.taskId??'');
      const task=tasksRef.current.find(t=>t.id===id);
      if(!task)return;
      if(response.actionIdentifier==='done'){
        await updateTask(completeTaskForTrash(task));
        toastMessage('タスクを完了しました');
      }else if(response.actionIdentifier==='snooze'){
        try{const notificationId=await snoozeTask(task);const stored={...task,notificationIds:[...(task.notificationIds??[]),notificationId]};await saveTask(db,stored);setTasks(items=>items.map(x=>x.id===task.id?stored:x));toastMessage('10分後に再通知します')}catch(e){console.warn(e)}
      }else{setTab('board')}
    };
    const listener=Notifications.addNotificationResponseReceivedListener(r=>{void handle(r)});
    void Notifications.getLastNotificationResponseAsync().then(r=>{if(r)void handle(r)});
    return ()=>listener.remove();
    // Initialisation is deliberately once per database load; task data read via refs.
  },[loaded]);
  useEffect(()=>{
    const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(editor||renaming||leadEditor){setEditor(null);setRenaming(false);setLeadEditor(false);return true}if(tab!=='board'){setTab('board');return true}return false});
    return ()=>sub.remove();
  },[editor,renaming,leadEditor,tab]);

  function moveTask(id:string,q:number,targetFolderId?:string|null){
    const before=tasksRef.current.find(x=>x.id===id);if(!before)return;
    const destination=targetFolderId===undefined?workspace.folderId:targetFolderId;
    const oldFolder=folderForTask(before);
    const insideAncestor=destination!==null&&belongsToFolder(before,destination,workspace.folders);
    const resolvedFolder=insideAncestor?oldFolder:destination;
    const sameArea=quadrant(before,prefsRef.current)===q&&oldFolder===resolvedFolder;
    let after={...moveToQuadrant(before,q,prefsRef.current),folderId:resolvedFolder};
    if(prefs.mode==='group'&&resolvedFolder)after={...after,group:folderGroup(workspace.folders,resolvedFolder)};
    if(sameArea){
      const pinned=tasksRef.current.filter(t=>t.pinned&&quadrant(t,prefsRef.current)===q&&folderForTask(t)===destination);
      const best=Math.min(0,...pinned.map(t=>t.manualOrder??0))-1;
      after={...before,pinned:true,manualOrder:best};
      toastMessage('最上位に固定しました');
    }else toastMessage('エリアを移動しました');
    void updateTask(after);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    remember('移動しました',()=>{void updateTask(before)});
  }
  function boardDrop(id:string,absX:number,absY:number){
    for(const folder of boardSectionItems){
      const key=folder.id??'__unassigned__';
      boardGridRefs.current[key]?.measureInWindow((x,y,width,height)=>{
        if(absX<x||absX>x+width||absY<y||absY>y+height)return;
        const q=(absY-y<height/2?0:2)+(absX-x<width/2?0:1);
        moveTask(id,q,folder.id);
      });
    }
  }
  function topPin(id:string){const t=tasksRef.current.find(t=>t.id===id);if(!t)return;
    const order=Math.min(0,...tasksRef.current.filter(x=>x.pinned).map(x=>x.manualOrder??0))-1;
    void updateTask({...t,pinned:true,manualOrder:order});
    toastMessage('最上位に固定しました');
  }
  function resizePuzzleSlot(id:string,slot:string,newDuration:number){
    const task=tasksRef.current.find(t=>t.id===id);
    if(!task||task.completed||task.event||!taskSlots(task).includes(slot))return;
    if(selectedBlock!==id||selectedPuzzleSlot!==slot){toastMessage('タスクをタップして黄色い枠で選択してください');return}
    const day=slot.slice(0,10),start=parseScheduleMinutes(slot);
    const result=canSchedule(tasksRef.current,day,start,newDuration,id);
    const overlapsOwn=taskSlots(task).some(other=>{
      if(other===slot||other.slice(0,10)!==day)return false;
      const minute=parseScheduleMinutes(other);
      return start<minute+durationForSlot(task,other)&&start+newDuration>minute;
    });
    if(!result.ok||overlapsOwn){toastMessage(overlapsOwn?'ほかの予定と重なっています':result.reason);return}
    if(newDuration===durationForSlot(task,slot))return;
    const old={...task};
    void updateTask(withSlotDuration(task,slot,newDuration));
    setSelectedBlock(id);setSelectedPuzzleSlot(slot);
    remember('作業時間を変更しました',()=>{void updateTask(old)});
    toastMessage('作業時間を変更しました');
    void Haptics.selectionAsync();
  }
  function scheduleTask(id:string,minutes:number,moveSlot:string|null=selectedPuzzleSlot,interaction:'tap'|'drag'='tap'){
    const t=tasksRef.current.find(x=>x.id===id);if(!t)return;
    const key=dateKey(puzzleDate);
    if(t.completed||t.event||!inTaskWorkWindow(t,key)){toastMessage('この日は納期・LT対象外です');return}
    if(selectedBlock!==id||(moveSlot?selectedPuzzleSlot!==moveSlot:selectedPuzzleSlot!==null)){toastMessage('タスクをタップして黄色い枠で選択してください');return}
    const oldSlot=moveSlot&&taskSlots(t).includes(moveSlot)&&moveSlot.slice(0,10)===key?moveSlot:null;
    if(slotOnDay(t,key)&&!oldSlot){toastMessage('配置済みです。タスクを選択して時間を変更してください');return}
    const originalDuration=oldSlot?durationForSlot(t,oldSlot):t.durationMin;
    const oldStart=oldSlot?parseScheduleMinutes(oldSlot):null;
    // Tapping a free grid cell after the current block extends its END;
    // dragging still repositions its START, handled by puzzleDrop.
    if(oldSlot&&interaction==='tap'&&oldStart!==null&&minutes>=oldStart+originalDuration){
      resizePuzzleSlot(id,oldSlot,minutes+30-oldStart);
      return;
    }
    const result=canSchedule(tasksRef.current,key,minutes,originalDuration,id);
    if(!result.ok){toastMessage(result.reason);void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);return}
    const ownCollision=taskSlots(t).some(other=>{
      if(other===oldSlot||other.slice(0,10)!==key)return false;
      const start=parseScheduleMinutes(other);
      return minutes<start+durationForSlot(t,other)&&minutes+originalDuration>start;
    });
    if(ownCollision){toastMessage('ほかの予定と重なっています');return}
    const next=`${key}T${timeText(minutes)}`;
    if(oldSlot===next){setSelectedBlock(null);setSelectedPuzzleSlot(null);return}
    const before={...t};
    let moved=withTaskSlots(t,[...taskSlots(t).filter(slot=>slot!==oldSlot),next]);
    if(oldSlot&&originalDuration!==t.durationMin)moved=withSlotDuration(moved,next,originalDuration);
    void updateTask(moved);
    setSelectedBlock(null);setSelectedPuzzleSlot(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    remember(oldSlot?'時間を変更しました':'予定を配置しました',()=>{void updateTask(before)});
    toastMessage(oldSlot?'時間を変更しました':'予定を配置しました');
  }
  function puzzleDrop(id:string,x:number,y:number,oldSlot:string|null=null){
    if(selectedBlock!==id||(oldSlot?selectedPuzzleSlot!==oldSlot:selectedPuzzleSlot!==null))return;
    if(oldSlot){
      puzzleInboxRef.current?.measureInWindow((left,top,width,height)=>{
        if(x>=left&&x<=left+width&&y>=top&&y<=top+height){
          const t=tasksRef.current.find(t=>t.id===id);
          if(!t)return;
          const before={...t};
          void updateTask(withTaskSlots(t,taskSlots(t).filter(s=>s!==oldSlot)));
          setSelectedBlock(null);setSelectedPuzzleSlot(null);setInboxPage(0);
          remember('配置を戻しました',()=>{void updateTask(before)});
          toastMessage('本日の対象タスクに戻しました');
        }
      });
    }
    const refs=[morningRef,afternoonRef];
    let handled=false;
    refs.forEach((ref,col)=>ref.current?.measureInWindow((left,top,width,height)=>{
      if(handled||x<left||x>left+width||y<top||y>top+height)return;
      handled=true;
      const row=Math.max(0,Math.min(11,Math.floor((y-top-5)/Math.max(1,height-10)*12)));
      scheduleTask(id,(col===0?8:14)*60+row*30,oldSlot,'drag');
    }));
  }
  async function changeNotificationEnabled(){
    if(prefs.remindersEnabled){await updatePreferences({...prefs,remindersEnabled:false});return}
    const granted=await requestLocalPermissions();
    if(!granted){Alert.alert('通知を有効にできません','端末の設定からkanriの通知を許可してください');return}
    await updatePreferences({...prefs,remindersEnabled:true});
  }
  const n=tasks.filter(t=>!t.event).length,completed=tasks.filter(t=>!t.event&&t.completed).length,percentage=n?Math.round(completed/n*100):0;
  const top=sortTasks(tasks.filter(t=>!t.event&&!t.completed))[0];
  const puzzleKey=dateKey(puzzleDate);
  const puzzleEligible=sortTasks(tasks.filter(t=>!t.event&&!t.completed&&belongsToFolder(t,workspace.folderId,workspace.folders)&&inTaskWorkWindow(t,puzzleKey)&&!slotOnDay(t,puzzleKey)));
  const puzzlePages=Math.max(1,Math.ceil(puzzleEligible.length/2));
  const puzzlePage=Math.min(inboxPage,puzzlePages-1);
  const folderPath:Folder[]=[];
  {let cursor=workspace.folders.find(f=>f.id===workspace.folderId),guard=0;
   while(cursor&&guard++<20){folderPath.unshift(cursor);cursor=workspace.folders.find(f=>f.id===cursor?.parentId)}}
  const childFolders=workspace.folders.filter(f=>f.parentId===workspace.folderId);
  const groupEntries:{id:string|null,name:string}[]=[
    {id:null,name:'すべて'},
    ...workspace.folders.filter(f=>f.parentId===null).map(f=>({id:f.id,name:f.id==='personal'&&f.name==='プライベート'?'私用':f.name}))
  ];
  for(const id of (workspace.recentFolderIds||[]).filter(id=>workspace.folders.some(f=>f.id===id&&f.parentId!==null)).slice(0,3)){
    if(!groupEntries.some(g=>g.id===id))groupEntries.push({id,name:workspace.folders.find(f=>f.id===id)!.name});
  }
  for(const f of childFolders.filter(f=>f.parentId!==null))if(!groupEntries.some(g=>g.id===f.id))groupEntries.push({id:f.id,name:f.name});

  const boardSectionItems:{id:string|null,name:string,depth:number}[]=[];
  const visited=new Set<string>();
  const appendFolder=(id:string,depth=0)=>{
    if(visited.has(id)||depth>20)return;
    const folder=workspace.folders.find(f=>f.id===id);
    if(!folder)return;
    visited.add(id);boardSectionItems.push({id,name:folder.name,depth});
    workspace.folders.filter(f=>f.parentId===id).forEach(f=>appendFolder(f.id,depth+1));
  };
  if(workspace.folderId)appendFolder(workspace.folderId);
  else workspace.folders.filter(f=>f.parentId===null).forEach(f=>appendFolder(f.id));
  if(!workspace.folderId&&tasks.some(t=>!t.completed&&!t.event&&folderForTask(t)===null))
    boardSectionItems.unshift({id:null,name:'未分類',depth:0});
  if(!boardSectionItems.length)boardSectionItems.push({id:null,name:'すべて',depth:0});

  if(!loaded)return <View style={[styles.root,{backgroundColor:theme.bg,justifyContent:'center',alignItems:'center'}]}><Text style={typeStyle(theme.ink,28,'800')}>kanri</Text><Text style={typeStyle(theme.muted,12)}>データを準備しています</Text></View>;
  return <View style={[styles.root,{backgroundColor:theme.bg,paddingTop:insets.top}]}>
    <StatusBar barStyle={prefs.dark?'light-content':'dark-content'} backgroundColor={theme.bg}/>
    <View style={styles.top}>
      <View style={styles.brandRow}>
        <View><Text style={[styles.brand,{color:theme.ink}]}>kanr<Text style={{color:'#7395D3'}}>i</Text></Text></View>
        <View style={{flexDirection:'row',alignItems:'center',gap:7}}><Text style={typeStyle(theme.muted,11,'700')}>{new Date().getMonth()+1}/{new Date().getDate()} {'日月火水木金土'[new Date().getDay()]}</Text><Pressable onPress={()=>{void updatePreferences({...prefs,dark:!prefs.dark})}} style={[styles.quick,{backgroundColor:theme.card,borderColor:theme.line}]}><Text style={typeStyle(theme.ink,14)}>◐</Text></Pressable></View>
      </View>
    </View>
    <View style={styles.content}
      onTouchStart={event=>{const t=event.nativeEvent.touches?.[0];if(t)swipeStart.current={x:t.pageX,y:t.pageY,time:Date.now()}}}
      onTouchEnd={event=>{
        const start=swipeStart.current;swipeStart.current=null;
        const t=event.nativeEvent.changedTouches?.[0];if(!start||!t||editor||eventEditor||newFolderOpen)return;
        const dx=t.pageX-start.x,dy=t.pageY-start.y;
        if(Math.abs(dx)<75||Math.abs(dx)<Math.abs(dy)*1.35||Date.now()-start.time>850)return;
        if(tab==='board'){
          const idx=groupEntries.findIndex(g=>g.id===workspace.folderId),next=idx+(dx<0?1:-1);
          if(next>=0&&next<groupEntries.length){selectFolder(groupEntries[next].id);void Haptics.selectionAsync()}
          return;
        }
        const order:Tab[]=['board','calendar','puzzle','settings'];
        const next=order.indexOf(tab)+(dx<0?1:-1);
        if(next>=0&&next<order.length){selectTab(order[next]);void Haptics.selectionAsync()}
      }}>
      {tab==='board'&&<>
        <View style={[styles.screenHead,{gap:4}]}>
          <Pressable accessibilityRole="button" accessibilityLabel="すべてのフォルダを開く" onPress={()=>setFolderMenuOpen(true)} style={{minHeight:44,minWidth:66,justifyContent:'center',flexDirection:'row',alignItems:'center',gap:3}}><Text style={typeStyle(theme.ink,18,'800')}>TODO</Text><Text style={typeStyle(theme.muted,12,'700')}>⌄</Text></Pressable>
          <ScrollView ref={groupScrollRef} horizontal showsHorizontalScrollIndicator={false} onScroll={e=>{groupScrollX.current=e.nativeEvent.contentOffset.x}} scrollEventThrottle={16} onContentSizeChange={()=>{groupScrollRef.current?.scrollTo({x:groupScrollX.current,animated:false})}} onTouchStart={e=>{e.stopPropagation();swipeStart.current=null}} style={{flex:1,minWidth:0,marginHorizontal:2}} contentContainerStyle={{alignItems:'center',gap:5,paddingHorizontal:2}}>
            {groupEntries.map(g=>
              <Pressable key={g.id||'all'} accessibilityRole="button" accessibilityLabel={g.name+'。タップで切り替え、長押しで編集・並べ替え'} onPress={()=>selectFolder(g.id)} onLongPress={()=>{if(g.id){setGroupActionsId(g.id);void Haptics.selectionAsync()}}} delayLongPress={420} style={{minHeight:44,minWidth:52,paddingHorizontal:9,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:workspace.folderId===g.id?'#90A8D5':theme.line,borderRadius:10,backgroundColor:workspace.folderId===g.id?theme.tint:theme.card}}>
                <Text numberOfLines={1} style={typeStyle(workspace.folderId===g.id?(prefs.dark?'#F4F7FF':'#456DAA'):theme.muted,10,'700')}>{g.name}</Text>
              </Pressable>
            )}
          </ScrollView>
          <Pressable onPress={()=>setGroupAddOpen(true)} accessibilityLabel="グループまたは子ツリーを追加" style={{minHeight:44,minWidth:62,justifyContent:'center',alignItems:'center',paddingHorizontal:5,backgroundColor:theme.tint,borderRadius:10,borderWidth:1,borderColor:theme.line}}><Text style={typeStyle(theme.ink,10,'800')}>＋ 追加</Text></Pressable>
          <Pressable onPress={()=>{setTasks(t=>[...t]);toastMessage('優先順位を再計算しました')}} accessibilityLabel="優先順位を自動整理" style={{minHeight:44,minWidth:34,justifyContent:'center',alignItems:'center',backgroundColor:theme.card,borderRadius:10,borderWidth:1,borderColor:theme.line}}><Text style={typeStyle(theme.ink,17,'800')}>↕</Text></Pressable>
        </View>
        <View style={{flex:1,minHeight:0}} onLayout={event=>{
          const h=event.nativeEvent.layout.height;if(h>100&&Math.abs(boardViewport-h)>1)setBoardViewport(h);
        }}>
          <ScrollView ref={boardScrollRef} nestedScrollEnabled showsVerticalScrollIndicator={boardSectionItems.length>1}
            pagingEnabled snapToInterval={Math.max(320,boardViewport)} snapToAlignment="start" disableIntervalMomentum decelerationRate="fast" directionalLockEnabled bounces={false}
            style={{flex:1,minHeight:0}} contentContainerStyle={{paddingBottom:0}}>
            {boardSectionItems.map((section,index)=><View key={section.id??'__unassigned__'} style={{height:Math.max(320,boardViewport),minHeight:320}}>
              <View style={{height:25,flexDirection:'row',alignItems:'center',paddingHorizontal:7,gap:8}}>
                <Text numberOfLines={1} style={typeStyle(theme.ink,12,'800')}>{section.name}</Text>
                <Text style={typeStyle(theme.muted,9)}>{section.depth?'子ツリー':'グループ'}</Text>
                <View style={{flex:1}}/>
                <Text style={typeStyle(theme.muted,9,'700')}>{index+1}/{boardSectionItems.length} {index<boardSectionItems.length-1?'↓':''}</Text>
              </View>
              <View ref={element=>{boardGridRefs.current[section.id??'__unassigned__']=element}} collapsable={false}
                style={[styles.board,{flex:1,minHeight:0,marginTop:0}]}>
                {[0,1,2,3].map(q=>{
                  const items=sortTasks(tasks.filter(t=>!t.completed&&!t.event&&quadrant(t,prefs)===q&&(section.id===null?folderForTask(t)===null:belongsToFolder(t,section.id,workspace.folders))));
                  const pageSize=winHeight>=820?8:winHeight>=690?6:4;
                  const count=Math.max(1,Math.ceil(items.length/pageSize));
                  const pageKey=(section.id??'__unassigned__')+':'+q;
                  const page=Math.min(boardPageMap[pageKey]||0,count-1);
                  return <View key={q} style={[styles.quad,winHeight<720&&{padding:7},{backgroundColor:theme.card,borderColor:theme.line,padding:winHeight>=740?12:8}]}>
                    <Pressable accessibilityRole="button" accessibilityLabel={prefs.names[q]+'にタスクを追加'} onPress={()=>addInQuadrant(q,section.id)} style={styles.quadHead}>
                      <Text style={typeStyle(theme.ink,11,'800')} numberOfLines={1}>{prefs.names[q]}</Text>
                      <Text style={typeStyle(theme.muted,10,'800')}>{pad(items.length)}</Text>
                    </Pressable>
                    <View style={{height:3,width:21,borderRadius:2,backgroundColor:COLORS[q],marginTop:5}}/>
                    <View style={{flex:1,minHeight:0,justifyContent:'flex-start',gap:3,marginTop:5}}>
                      <Pressable onPress={()=>addInQuadrant(q,section.id)} accessibilityLabel={prefs.names[q]+'に新しいタスクを追加'} style={StyleSheet.absoluteFill}/>
                      {items.slice(page*pageSize,page*pageSize+pageSize).map(t=><DragTask key={t.id} task={t} theme={theme}
                        onDrop={boardDrop} onOpen={()=>setEditor(t)} onComplete={()=>markCompleted(t)}
                        onPin={()=>topPin(t.id)}
                        onRequestDelete={()=>Alert.alert('タスクを削除',t.title+' を削除しますか？',[{text:'キャンセル',style:'cancel'},{text:'削除',style:'destructive',onPress:()=>void removeTask(t)}])}/>)}
                      {!items.length&&<Pressable onPress={()=>addInQuadrant(q,section.id)} style={{flex:1,justifyContent:'center',alignItems:'center'}}>
                        <Text style={typeStyle(theme.muted,10)}>＋</Text>
                      </Pressable>}
                    </View>
                    <View style={styles.pager}>
                      <Pressable disabled={!page} onPress={()=>setBoardPageMap(old=>({...old,[pageKey]:Math.max(0,page-1)}))}>
                        <Text style={typeStyle(theme.muted,16)}>‹</Text>
                      </Pressable>
                      <Text style={typeStyle(theme.muted,9)}>{page+1}/{count}</Text>
                      <Pressable disabled={page>=count-1} onPress={()=>setBoardPageMap(old=>({...old,[pageKey]:Math.min(count-1,page+1)}))}>
                        <Text style={typeStyle(theme.muted,16)}>›</Text>
                      </Pressable>
                    </View>
                  </View>;
                })}
              </View>
            </View>)}
          </ScrollView>
        </View>
        {tasks.some(t=>t.pinned)&&<View style={styles.bottomHint}><View/><Pressable onPress={()=>{tasks.forEach(t=>{if(t.pinned)void updateTask({...t,pinned:false,manualOrder:null})});toastMessage('自動順位に戻しました')}}><Text style={typeStyle('#5578BB',11,'800')}>固定を解除 ↺</Text></Pressable></View>}
      </>}
      {tab==='calendar'&&<>
        <View style={styles.screenHead}><View style={{flexDirection:'row',alignItems:'center',gap:5}}><Text style={typeStyle(theme.ink,17,'800')}>予定</Text><Pressable onPress={()=>setTrashOpen(true)} accessibilityLabel="完了・削除一覧を開く" style={{paddingVertical:7,paddingHorizontal:6,backgroundColor:theme.tint,borderRadius:9}}><Text style={typeStyle(theme.ink,10,'800')}>完了済み</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="会議や予定を追加" onPress={()=>setEventEditor('new')} style={{paddingVertical:7,paddingHorizontal:7,backgroundColor:theme.tint,borderRadius:9}}><Text style={typeStyle(theme.ink,10,'800')}>＋予定</Text></Pressable></View><View style={[styles.seg,{backgroundColor:theme.line}]}>{(['month','week','gantt'] as Mode[]).map((m,i)=><Pressable key={m} onPress={()=>{setCalMode(m);setGanttPage(0)}} style={[styles.segItem,calMode===m&&{backgroundColor:theme.card}]}><Text style={typeStyle(calMode===m?theme.ink:theme.muted,11,'700')}>{['月','週','ガント'][i]}</Text></Pressable>)}</View></View>
        <CalendarPanel theme={theme} mode={calMode} focus={focus} setFocus={setFocus} tasks={tasks} prefs={prefs} ganttPage={ganttPage} setGanttPage={setGanttPage} folderId={workspace.folderId} folders={workspace.folders} onOpen={task=>task.event?setEventEditor(task):setEditor(task)} onGanttComplete={markCompleted} onGanttStart={(task,date)=>{if(task.event){setEventEditor(task);return}const before={...task};void updateTask({...task,dueDate:date,ganttStart:null});void Haptics.selectionAsync();remember('納期を変更しました',()=>{void updateTask(before)});}}/>
      </>}
      {tab==='puzzle'&&<>
        <View style={styles.screenHead}><Pressable onPress={clearPuzzleSelection} style={{minHeight:35,justifyContent:'center'}}><Text style={typeStyle(theme.ink,18,'800')}>TIME PUZZLE</Text></Pressable><IconButton label="↶ 戻す" theme={theme} onPress={undoAction}/></View>
        <View style={{flex:1,minHeight:0}}><View ref={puzzleInboxRef} collapsable={false} style={[styles.puzzleInbox,{backgroundColor:theme.navy}]}>
          <Pressable onPress={clearPuzzleSelection} style={styles.flexBetween}><Text style={typeStyle('#F3F7FF',11,'800')}>本日の対象タスク</Text><Text style={typeStyle('#A3B5D0',10)}>{puzzleEligible.length} 件 · 納期／LT</Text></Pressable>
          <View style={{flexDirection:'row',gap:7,marginTop:8,minHeight:70,alignItems:'flex-start'}}> 
            {puzzleEligible.slice(puzzlePage*2,puzzlePage*2+2).map(t=><PuzzleTile key={t.id} task={t} selected={selectedBlock===t.id} onSelect={()=>{if(selectedBlock===t.id&&selectedPuzzleSlot===null){setSelectedBlock(null)}else{setSelectedBlock(t.id);setSelectedPuzzleSlot(null);toastMessage('黄色い枠になりました。移動できます')}}} onDrop={puzzleDrop}/>)}
            {!puzzleEligible.length&&<Text style={typeStyle('#AAB9D0',11)}>この日の未配置タスクはありません</Text>}
          </View>
          <View style={[styles.pager,{marginTop:2}]}><Pressable onPress={()=>setInboxPage(n=>Math.max(0,n-1))}><Text style={typeStyle('#B7C6DB',16)}>‹</Text></Pressable><Text style={typeStyle('#B7C6DB',9)}>{puzzlePage+1}/{puzzlePages}</Text><Pressable onPress={()=>setInboxPage(n=>Math.min(puzzlePages-1,n+1))}><Text style={typeStyle('#B7C6DB',16)}>›</Text></Pressable></View>
        </View>
          <View style={[styles.dateNav,{height:43}]}><Pressable onPress={()=>{setSelectedBlock(null);setSelectedPuzzleSlot(null);setInboxPage(0);setPuzzleDate(d=>addDays(d,-1))}}><Text style={typeStyle('#5578BB',11,'800')}>‹ 前日</Text></Pressable><Pressable onPress={clearPuzzleSelection} style={{minHeight:35,justifyContent:'center'}}><Text style={typeStyle(theme.ink,12,'800')}>{puzzleDate.getMonth()+1}月{puzzleDate.getDate()}日 {'日月火水木金土'[puzzleDate.getDay()]}曜日</Text></Pressable><Pressable onPress={()=>{setSelectedBlock(null);setSelectedPuzzleSlot(null);setInboxPage(0);setPuzzleDate(d=>addDays(d,1))}}><Text style={typeStyle('#5578BB',11,'800')}>翌日 ›</Text></Pressable></View>
          <View style={{flex:1,flexDirection:'row',gap:8,minHeight:0}}>
            {[0,1].map((col)=>{
              const ref=col===0?morningRef:afternoonRef;const base=col===0?8*60:14*60;
              return <View key={col} ref={ref} onLayout={event=>{const h=event.nativeEvent.layout.height;if(h>0&&Math.abs(h-panelHeight)>1)setPanelHeight(h)}} style={[styles.timePanel,{backgroundColor:theme.card,borderColor:theme.line}]}>
                {Array.from({length:12},(_,row)=>{
                  const minute=base+row*30;
                  return <Pressable key={minute} onPress={()=>selectedBlock?scheduleTask(selectedBlock,minute):toastMessage('先にタスクを選んでください')} style={[styles.timeSlot,{borderTopColor:theme.line}]}><Text style={[styles.timeLabel,{color:theme.muted}]}>{timeText(minute)}</Text></Pressable>;
                })}
                {tasks.filter(t=>!t.completed&&belongsToFolder(t,workspace.folderId,workspace.folders)).flatMap(t=>
                  taskSlots(t).filter(slot=>slot.slice(0,10)===puzzleKey).map(slot=>({task:t,slot}))
                ).filter(({slot})=>parseScheduleMinutes(slot)>=base&&parseScheduleMinutes(slot)<base+360).map(({task:t,slot})=>{
                  const minute=parseScheduleMinutes(slot);
                  const top=(minute-base)/360*(panelHeight-12),high=durationForSlot(t,slot)/360*(panelHeight-12);
                  return <ScheduledPuzzleBlock key={t.id+slot} task={t} slot={slot} minute={minute} duration={durationForSlot(t,slot)}
                    theme={theme} color={COLORS[quadrant(t,prefs)]}
                    selected={selectedBlock===t.id&&selectedPuzzleSlot===slot}
                    top={5+top} height={Math.max(22,Math.min(high,panelHeight-top-10))}
                    resizeStepPx={(panelHeight-12)/12}
                    onResize={newMinutes=>resizePuzzleSlot(t.id,slot,newMinutes)}
                    onSelect={()=>{if(t.event){setEventEditor(t);return}
                      if(selectedBlock===t.id&&selectedPuzzleSlot===slot){setSelectedBlock(null);setSelectedPuzzleSlot(null)}
                      else{setSelectedBlock(t.id);setSelectedPuzzleSlot(slot);toastMessage('黄色い枠になりました。移動・時間変更できます')}
                    }}
                    onMove={puzzleDrop} onComplete={()=>markCompleted(t)}/>;
                })}
              </View>;
            })}
          </View>
          <View style={[styles.bottomHint,{gap:5}]}><Pressable onPress={clearPuzzleSelection} style={{flex:1,minWidth:0,justifyContent:'center'}}><Text numberOfLines={1} style={typeStyle(theme.muted,9)}>{selectedPuzzleSlot?'タップで選択解除':'タップして黄色い枠で選択'}</Text></Pressable>{selectedPuzzleSlot&&<><Pressable onPress={()=>{
             const t=tasksRef.current.find(t=>t.id===selectedBlock);
             if(t)resizePuzzleSlot(t.id,selectedPuzzleSlot,durationForSlot(t,selectedPuzzleSlot)-30);
           }} style={{minWidth:39,minHeight:24,backgroundColor:theme.tint,borderRadius:6,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle('#5578BB',9,'800')}>−30分</Text></Pressable><Pressable onPress={()=>{
             const t=tasksRef.current.find(t=>t.id===selectedBlock);
             if(t)resizePuzzleSlot(t.id,selectedPuzzleSlot,durationForSlot(t,selectedPuzzleSlot)+30);
           }} style={{minWidth:39,minHeight:24,backgroundColor:theme.tint,borderRadius:6,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle('#5578BB',9,'800')}>＋30分</Text></Pressable></>}{selectedPuzzleSlot&&<Pressable onPress={()=>{
            const t=tasksRef.current.find(t=>t.id===selectedBlock);if(!t)return;
            const before={...t};void updateTask(withTaskSlots(t,taskSlots(t).filter(s=>s!==selectedPuzzleSlot)));
            setSelectedBlock(null);setSelectedPuzzleSlot(null);
            remember('配置を解除しました',()=>{void updateTask(before)});
          }}><Text style={typeStyle('#5578BB',10,'800')}>外す</Text></Pressable>}{!selectedPuzzleSlot&&<Pressable onPress={()=>{
            const onDay=tasks.filter(t=>!t.event&&!t.completed&&belongsToFolder(t,workspace.folderId,workspace.folders)&&!!slotOnDay(t,puzzleKey));
            if(!onDay.length){toastMessage('配置済みの予定はありません');return}
            const backup=onDay.map(t=>({...t}));
            onDay.forEach(t=>void updateTask(withTaskSlots(t,taskSlots(t).filter(slot=>slot.slice(0,10)!==puzzleKey))));
            setSelectedBlock(null);setSelectedPuzzleSlot(null);
            remember('この日の配置を解除しました',()=>backup.forEach(t=>void updateTask(t)));
          }}><Text style={typeStyle('#5578BB',10,'800')}>一括解除</Text></Pressable>}</View>
        </View>
      </>}
      {tab==='settings'&&<SettingsPanel theme={theme} prefs={prefs} tasks={tasks} onOpenTrash={()=>setTrashOpen(true)} onExport={()=>{void shareExcel(tasksRef.current,workspace.folders,focus).catch(e=>{console.warn('Excel export failed',e);Alert.alert('Excel出力できませんでした',String(e?.message||'再試行してください'))})}} onMode={mode=>{void updatePreferences({...prefs,mode,names:(mode==='group'?[...GROUPS]:[...DEFAULT_PREFS.names]) as Preferences['names']})}} onRename={()=>setRenaming(true)} onDark={()=>void updatePreferences({...prefs,dark:!prefs.dark})} onReminder={()=>void changeNotificationEnabled()} onLeadEdit={()=>setLeadEditor(true)} onStart={()=>void updatePreferences({...prefs,startReminder:!prefs.startReminder})}/>}
    </View>
    <View style={[styles.nav,{backgroundColor:theme.navy,paddingBottom:insets.bottom,height:59+insets.bottom}]}>
      {([['board','▦','FOCUS'],['calendar','▤','PLAN'],['add','+',''],['puzzle','▧','PUZZLE'],['settings','☷','SETUP']] as const).map(([id,icon,label])=>id==='add'?<Pressable accessibilityLabel="タスクを追加" key="add" onPress={()=>{setCalendarDraftDate(null);setNewQuadrant(null);setEditor('new')}} style={styles.navButton}><View style={styles.navAdd}><Text style={typeStyle('#FFFFFF',30,'400')}>+</Text></View></Pressable>:<Pressable key={id} onPress={()=>selectTab(id)} style={styles.navButton}><Text style={typeStyle(tab===id?'#FFFFFF':'#9BA9C0',24,'400')}>{icon}</Text><Text style={typeStyle(tab===id?'#FFFFFF':'#9BA9C0',9,'700')}>{label}</Text></Pressable>)}
    </View>
    {undo&&<View style={[styles.undo,{bottom:insets.bottom+78}]}><Text style={typeStyle('#FFFFFF',11)}>{undo.label}</Text><Pressable onPress={undoAction}><Text style={typeStyle('#B4D0FF',11,'800')}>元に戻す</Text></Pressable></View>}
    {!!toast&&<Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(140)} style={[styles.toast,{top:insets.top+149}]}><Text style={typeStyle('#FFFFFF',11)}>{toast}</Text></Animated.View>}
    <Modal visible={trashOpen} animationType="slide" statusBarTranslucent onRequestClose={()=>setTrashOpen(false)}>
      <View style={{flex:1,backgroundColor:theme.bg,paddingTop:insets.top+12,paddingBottom:insets.bottom+12,paddingHorizontal:15}}>
        <View style={[styles.flexBetween,{minHeight:54}]}>
          <View><Text style={typeStyle(theme.ink,19,'800')}>完了・削除一覧</Text><Text style={typeStyle(theme.muted,10)}>完了後7日間保管 · 経過後自動削除</Text></View>
          <Pressable onPress={()=>setTrashOpen(false)} accessibilityRole="button" accessibilityLabel="一覧を閉じる" style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center',borderRadius:12,backgroundColor:theme.card,borderWidth:1,borderColor:theme.line}}><Text style={typeStyle(theme.ink,23)}>×</Text></Pressable>
        </View>
        <ScrollView style={{flex:1,marginTop:10}} contentContainerStyle={{gap:9,paddingBottom:20}}>
          {tasks.filter(t=>t.completed&&!t.event).sort((a,b)=>(b.completedAt||'').localeCompare(a.completedAt||'')).map(t=>{
            const remaining=Math.max(0,Math.ceil((COMPLETED_RETENTION_MS-(Date.now()-Date.parse(t.completedAt||new Date().toISOString())))/86400000));
            return <View key={t.id} style={{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:theme.card,borderColor:theme.line,borderWidth:1,borderRadius:13,padding:10,minHeight:65}}>
              <View style={{flex:1,minWidth:0,gap:5}}><Text style={typeStyle(theme.ink,12,'800')} numberOfLines={2}>{t.title}</Text><Text style={typeStyle(theme.muted,10)}>あと{remaining}日で自動削除</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={t.title+'を復元'} onPress={()=>restoreFromTrash(t)} style={{minHeight:42,paddingHorizontal:9,borderRadius:9,backgroundColor:theme.tint,justifyContent:'center'}}><Text style={typeStyle(theme.ink,11,'800')}>復元</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t.title+'を完全削除'} onPress={()=>Alert.alert('完全に削除',t.title+' を完全に削除しますか？ この操作は取り消せません。',[{text:'キャンセル',style:'cancel'},{text:'完全削除',style:'destructive',onPress:()=>void removeTask(t)}])} style={{minHeight:42,paddingHorizontal:5,justifyContent:'center'}}><Text style={typeStyle('#C98087',11,'800')}>削除</Text></Pressable>
            </View>;
          })}
          {!tasks.some(t=>t.completed&&!t.event)&&<View style={{minHeight:135,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.muted,12)}>完了したタスクはありません</Text></View>}
        </ScrollView>
      </View>
    </Modal>
    <Modal visible={groupAddOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={()=>setGroupAddOpen(false)}>
      <View style={styles.overlay}><Pressable onPress={()=>setGroupAddOpen(false)} style={StyleSheet.absoluteFill}/>
        <View style={[styles.editorSheet,{top:insets.top+25,backgroundColor:theme.card}]}>
          <View style={styles.flexBetween}><Text style={typeStyle(theme.ink,17,'800')}>グループ・ツリーを追加</Text><Pressable onPress={()=>setGroupAddOpen(false)} accessibilityLabel="閉じる" style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.ink,24)}>×</Text></Pressable></View>
          <Pressable onPress={()=>beginFolderEdit(null,'グループ')} style={{minHeight:60,backgroundColor:theme.bg,borderColor:theme.line,borderWidth:1,borderRadius:12,padding:12,marginTop:8,justifyContent:'center'}}>
            <Text style={typeStyle(theme.ink,13,'800')}>＋ グループを追加</Text><Text style={typeStyle(theme.muted,10)}>「業務」「私用」と並ぶ項目を作成</Text>
          </Pressable>
          <Pressable onPress={()=>beginFolderEdit(workspace.folderId,'子ツリー')} style={{minHeight:60,backgroundColor:theme.bg,borderColor:theme.line,borderWidth:1,borderRadius:12,padding:12,marginTop:8,justifyContent:'center'}}>
            <Text style={typeStyle(theme.ink,13,'800')}>＋ 子ツリーを追加</Text><Text style={typeStyle(theme.muted,10)}>現在選択中のグループの内側に追加</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    {groupActionsId&&workspace.folders.some(f=>f.id===groupActionsId)&&(()=>{
      const f=workspace.folders.find(x=>x.id===groupActionsId)!;
      const siblings=workspace.folders.filter(x=>x.parentId===f.parentId);
      const pos=siblings.findIndex(x=>x.id===f.id);
      const action=(label:string,handler:()=>void,destructive=false,disabled=false)=>(
        <Pressable accessibilityRole="button" disabled={disabled} onPress={handler} style={{minHeight:47,justifyContent:'center',paddingHorizontal:12,marginTop:6,borderWidth:1,borderColor:theme.line,borderRadius:11,backgroundColor:theme.bg,opacity:disabled?0.35:1}}>
          <Text style={typeStyle(destructive?'#BA5A63':theme.ink,12,'800')}>{label}</Text>
        </Pressable>
      );
      return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={()=>setGroupActionsId(null)}>
        <View style={styles.overlay}><Pressable onPress={()=>setGroupActionsId(null)} style={StyleSheet.absoluteFill}/>
          <View style={[styles.editorSheet,{top:insets.top+25,backgroundColor:theme.card}]}>
            <View style={styles.flexBetween}><Text numberOfLines={1} style={[typeStyle(theme.ink,16,'800'),{flex:1}]}>{f.name} を操作</Text><Pressable accessibilityLabel="閉じる" onPress={()=>setGroupActionsId(null)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.ink,23)}>×</Text></Pressable></View>
            <Text style={[typeStyle(theme.muted,10),{marginBottom:6}]}>長押しで編集・移動・削除</Text>
            {action('名前を変更',()=>beginFolderEdit(f.parentId,'グループ',f.id))}
            {action('＋ 子ツリーを追加',()=>beginFolderEdit(f.id,'子ツリー'))}
            {action('← 左へ並び替え',()=>{moveFolder(f.id,-1);setGroupActionsId(null)},false,pos<=0)}
            {action('右へ並び替え →',()=>{moveFolder(f.id,1);setGroupActionsId(null)},false,pos>=siblings.length-1)}
            {action('グループ・ツリーを削除',()=>{setGroupActionsId(null);deleteFolder(f.id)},true)}
          </View>
        </View>
      </Modal>;
    })()}
    {folderMenuOpen&&<FolderBrowserSheet theme={theme} insetTop={insets.top} folders={workspace.folders} selectedFolderId={workspace.folderId} onClose={()=>setFolderMenuOpen(false)} onSelect={selectFolder} onCreate={()=>beginFolderEdit(workspace.folderId,'子ツリー')} onDelete={deleteFolder}/>}
    {newFolderOpen&&folderDraft&&<FolderSheet theme={theme} insetTop={insets.top} parentName={folderDraft.parentId?workspace.folders.find(f=>f.id===folderDraft.parentId)?.name||'子ツリー':'最上位グループ'} initialName={folderDraft.name||''} title={folderDraft.renameId?'名前を変更':folderDraft.label+'を追加'} onClose={()=>{setNewFolderOpen(false);setFolderDraft(null)}} onCreate={createFolder}/>}{editor&&<TaskEditor key={editor==='new'?'new':editor.id} entry={editor} initialQuadrant={newQuadrant} initialDueDate={calendarDraftDate} prefs={prefs} folders={workspace.folders} initialFolderId={editor==='new'?(newTaskFolderId??workspace.folderId):workspace.folderId} theme={theme} insetTop={insets.top} height={stableEditorHeight.current} onClose={()=>{Keyboard.dismiss();setEditor(null);setCalendarDraftDate(null)}} onSave={data=>{Keyboard.dismiss();setEditor(null);setCalendarDraftDate(null);void updateTask(data);void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);toastMessage('保存しました')}} onDelete={t=>{Keyboard.dismiss();setEditor(null);void removeTask(t);remember('タスクを削除しました',()=>{void updateTask(t,null)})}}/>}

    {eventEditor&&<EventEditor key={eventEditor==='new'?'new':eventEditor.id} entry={eventEditor} theme={theme} insetTop={insets.top} folders={workspace.folders} initialFolderId={workspace.folderId} initialDate={dateKey(focus)} onClose={()=>{Keyboard.dismiss();setEventEditor(null)}} onSave={item=>{Keyboard.dismiss();setEventEditor(null);void updateTask(item);void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);toastMessage('予定を保存しました')}} onDelete={item=>{Keyboard.dismiss();setEventEditor(null);void removeTask(item)}}/>}
    {leadEditor&&<LeadTimeSheet theme={theme} insetTop={insets.top} current={prefs.leadMinutes} onClose={()=>{Keyboard.dismiss();setLeadEditor(false)}} onSave={minutes=>{Keyboard.dismiss();setLeadEditor(false);void updatePreferences({...prefs,leadMinutes:minutes})}}/>}
    {renaming&&<RenameSheet prefs={prefs} theme={theme} insetTop={insets.top} onClose={()=>setRenaming(false)} onSave={names=>{setRenaming(false);void updatePreferences({...prefs,names})}}/>}
  </View>;
}

function CheckGlyph(){
  return <View pointerEvents="none" style={{width:20,height:20,borderWidth:1.3,borderColor:'#829D94',borderRadius:10,alignItems:'center',justifyContent:'center'}}>
    <View style={{width:5.5,height:8,borderRightWidth:1.7,borderBottomWidth:1.7,borderColor:'#729187',transform:[{rotate:'45deg'},{translateY:-1}],marginTop:-2}}/>
  </View>;
}
function FullTitle({title,theme}:{title:string,theme:Theme}){
 return <View style={{flex:1,minWidth:0,height:26,justifyContent:'center'}}>
   <Text numberOfLines={2} ellipsizeMode="tail" style={[typeStyle(theme.ink,title.length>38?7:title.length>18?7.5:8,'700'),{lineHeight:9}]}>{title}</Text>
 </View>;
}
function DragTask({task,theme,onDrop,onOpen,onComplete,onPin,onRequestDelete}:{task:Task,theme:Theme,onDrop:(id:string,x:number,y:number)=>void,onOpen:()=>void,onComplete:()=>void,onPin:()=>void,onRequestDelete:()=>void}){
  const dx=useSharedValue(0),dy=useSharedValue(0),swipeX=useSharedValue(0);
  const gesture=useMemo(()=>{
    const drag=Gesture.Pan().activateAfterLongPress(200)
      .onUpdate(e=>{dx.value=e.translationX;dy.value=e.translationY})
      .onEnd(e=>{scheduleOnRN(onDrop,task.id,e.absoluteX,e.absoluteY);dx.value=withSpring(0);dy.value=withSpring(0)})
      .onFinalize(()=>{dx.value=withSpring(0);dy.value=withSpring(0)});
    const swipe=Gesture.Pan().activeOffsetX([-19,19]).failOffsetY([-26,26])
      .onUpdate(e=>{swipeX.value=Math.max(-88,Math.min(0,e.translationX))})
      .onEnd(e=>{if(e.translationX< -68)scheduleOnRN(onRequestDelete);swipeX.value=withSpring(0)})
      .onFinalize(()=>{swipeX.value=withSpring(0)});
    return Gesture.Race(drag,swipe);
  },[task.id,onDrop,onRequestDelete]);
  const motion=useAnimatedStyle(()=>({transform:[{translateX:dx.value+swipeX.value},{translateY:dy.value}],zIndex:dx.value||dy.value?8:0}));
  const dangerReveal=useAnimatedStyle(()=>({opacity:Math.min(1,Math.abs(swipeX.value)/36)}));
  const due=task.dueDate?((daysUntil(task.dueDate)===0)?'今日':(daysUntil(task.dueDate)===1)?'明日':task.dueDate.slice(5).replace('-','/')):'―';
  return <View style={{position:'relative',borderRadius:7,overflow:'hidden',backgroundColor:theme.bg,height:30,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:theme.line}}>
    <Pressable accessibilityRole="button" accessibilityLabel={task.title+'を完了'} onPress={onComplete} hitSlop={{top:6,bottom:6,left:5,right:3}}
      style={{width:29,height:28,alignItems:'center',justifyContent:'center',backgroundColor:'transparent',zIndex:6}}>
      <CheckGlyph/>
    </Pressable>
    <View style={{flex:1,minWidth:0,height:28,overflow:'hidden'}}>
      <Animated.View pointerEvents="none" style={[{position:'absolute',right:0,top:0,bottom:0,width:62,backgroundColor:'#B94756',alignItems:'center',justifyContent:'center'},dangerReveal]}><Text style={typeStyle('#FFFFFF',10,'800')}>削除</Text></Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View onTouchStart={e=>e.stopPropagation()} style={[styles.taskTile,{backgroundColor:theme.bg,borderWidth:0,borderRadius:0,width:'100%',height:28,minHeight:28,paddingVertical:0,paddingHorizontal:2,flexDirection:'row',alignItems:'center',gap:3},motion]}>
          <View style={{flex:1,minWidth:0,height:28,flexDirection:'row',alignItems:'center',gap:2}}>
            <FullTitle title={task.title} theme={theme}/>
            <Text numberOfLines={1} style={typeStyle(theme.muted,7)}>{due}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={task.title+'を編集'} onPress={onOpen} style={{width:21,height:28,justifyContent:'center',alignItems:'center'}}>
              <Text style={typeStyle(theme.muted,13,'800')}>›</Text>
            </Pressable>
          </View>
          <Pressable onPress={onPin} accessibilityLabel="最上位に固定" style={{width:17,height:28,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(task.pinned?'#C7A876':theme.muted,10)}>{task.pinned?'◆':'◇'}</Text></Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  </View>;
}
function PuzzleTile({task,selected,onSelect,onDrop}:{task:Task,selected:boolean,onSelect:()=>void,onDrop:(id:string,x:number,y:number)=>void}){
  const x=useSharedValue(0),y=useSharedValue(0);
  const gesture=useMemo(()=>Gesture.Pan().enabled(selected).minDistance(8).onUpdate(e=>{x.value=e.translationX;y.value=e.translationY}).onEnd(e=>{scheduleOnRN(onDrop,task.id,e.absoluteX,e.absoluteY);x.value=withSpring(0);y.value=withSpring(0)}).onFinalize(()=>{x.value=withSpring(0);y.value=withSpring(0)}),[task.id,onDrop,selected]);
  const animated=useAnimatedStyle(()=>({transform:[{translateX:x.value},{translateY:y.value}],zIndex:10}));
  return <GestureDetector gesture={gesture}><Animated.View style={[styles.puzzleTile,{height:45+Math.round(Math.min(task.durationMin,180)/180*24)},selected&&{borderColor:'#F3D78C',borderWidth:2},animated]}><Pressable onPress={onSelect} style={{flex:1,justifyContent:'center'}}><Text numberOfLines={1} style={typeStyle('#FFFFFF',11,'700')}>{task.title}</Text><Text style={typeStyle('#C0CCDF',9)}>LT{task.leadDays||1}日 · {dueLabel(task.dueDate)}</Text></Pressable></Animated.View></GestureDetector>;
}
function ScheduledPuzzleBlock({task,slot,minute,duration,theme,color,selected,top,height,resizeStepPx,onResize,onSelect,onMove,onComplete}:{
  task:Task;slot:string;minute:number;duration:number;theme:Theme;color:string;selected:boolean;top:number;height:number;
  resizeStepPx:number;onResize:(minutes:number)=>void;
  onSelect:()=>void;onMove:(id:string,x:number,y:number,oldSlot:string|null)=>void;onComplete:()=>void;
}){
  const x=useSharedValue(0),y=useSharedValue(0);
  const resizeSteps=useSharedValue(0);
  const maxMinutes=(minute<14*60?14*60:20*60)-minute;
  const resizeGesture=useMemo(()=>Gesture.Pan().enabled(selected).minDistance(7)
    .onUpdate(e=>{
      const steps=Math.round(e.translationY/Math.max(8,resizeStepPx));
      resizeSteps.value=Math.max(Math.ceil((30-duration)/30),Math.min(Math.floor((maxMinutes-duration)/30),steps));
    })
    .onEnd(()=>{
      const updated=duration+resizeSteps.value*30;
      if(updated!==duration)scheduleOnRN(onResize,updated);
      resizeSteps.value=0;
    })
    .onFinalize(()=>{resizeSteps.value=0}),
  [duration,maxMinutes,resizeStepPx,onResize,selected]);
  const dynamicHeight=useAnimatedStyle(()=>({height:Math.max(22,height+resizeSteps.value*resizeStepPx)}));
  const gesture=useMemo(()=>Gesture.Pan().enabled(selected).minDistance(9)
    .onUpdate(e=>{x.value=e.translationX;y.value=e.translationY})
    .onEnd(e=>{scheduleOnRN(onMove,task.id,e.absoluteX,e.absoluteY,slot);x.value=withSpring(0);y.value=withSpring(0)})
    .onFinalize(()=>{x.value=withSpring(0);y.value=withSpring(0)}),
  [task.id,slot,onMove,selected]);
  const motion=useAnimatedStyle(()=>({transform:[{translateX:x.value},{translateY:y.value}]}));
  return <Animated.View entering={FadeInDown.springify().damping(18)}
    style={[styles.scheduledBar,{top,height,backgroundColor:color,flexDirection:'row',alignItems:'center',borderWidth:selected?2:0,borderColor:'#F5D17B',overflow:'visible'},dynamicHeight]}>
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{flex:1,minWidth:0,height:'100%',justifyContent:'center'},motion]}>
        <Pressable accessibilityRole="button" accessibilityLabel={task.title+'を選択して時間変更'} onPress={onSelect} style={{flex:1,justifyContent:'center'}}>
          <Text numberOfLines={1} style={typeStyle('#FFFFFF',10,'800')}>{task.title}</Text>
          <Text numberOfLines={1} style={typeStyle('#EEF4FF',8)}>{timeText(minute)}–{timeText(minute+duration)}</Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
    {!task.event&&<Pressable accessibilityRole="button" accessibilityLabel={task.title+'を完了'} onPress={onComplete}
       style={{minWidth:25,minHeight:24,alignItems:'center',justifyContent:'center',backgroundColor:'#FFFFFF29',borderRadius:5,marginLeft:2}}>
      <Text style={typeStyle('#FFFFFF',14,'800')}>✓</Text>
    </Pressable>}
    {selected&&!task.event&&<GestureDetector gesture={resizeGesture}>
      <Animated.View style={{position:'absolute',bottom:duration>=maxMinutes?0:-9,right:29,width:39,height:26,backgroundColor:'#FFFFFF',borderColor:'#BAC9D9',borderWidth:1,borderRadius:8,alignItems:'center',justifyContent:'center',flexDirection:'row',zIndex:30,elevation:12}}>
        <Pressable accessibilityRole="button" accessibilityLabel={task.title+'の終了時間を30分延長。上下ドラッグで変更'} onPress={()=>onResize(duration+30)}
          style={{width:39,height:26,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:2}}>
          <Text style={typeStyle('#45617F',10,'800')}>═</Text>
          <Text style={typeStyle('#45617F',15,'800')}>↓</Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>}
  </Animated.View>;
}
function CalendarPanel({theme,mode,focus,setFocus,tasks,prefs,ganttPage,setGanttPage,folderId,folders,onOpen,onGanttStart,onGanttComplete}:{theme:Theme,mode:Mode,focus:Date,setFocus:(date:Date)=>void,tasks:Task[],prefs:Preferences,ganttPage:number,setGanttPage:(n:number)=>void,folderId:string|null,folders:Folder[],onOpen:(task:Task)=>void,onGanttStart:(task:Task,date:string)=>void,onGanttComplete:(task:Task)=>void}){
  const shownTasks=tasks.filter(t=>belongsToFolder(t,folderId,folders));
  const first=new Date(focus.getFullYear(),focus.getMonth(),1);
  const weekStart=addDays(focus,-focus.getDay());
  const title=mode==='gantt'?`${focus.getFullYear()}年 ${focus.getMonth()+1}月`:mode==='month'?`${focus.getFullYear()}年 ${focus.getMonth()+1}月`:mode==='week'?`${weekStart.getMonth()+1}/${weekStart.getDate()} – ${addDays(weekStart,6).getMonth()+1}/${addDays(weekStart,6).getDate()}`:`${focus.getMonth()+1}/${focus.getDate()}から7日間`;
  const selectedDate=dateKey(focus);
  const agenda=sortTasks(shownTasks.filter(t=>!t.completed&&(t.dueDate===selectedDate||!!slotOnDay(t,selectedDate)))).sort((a,b)=>Number(!!b.event)-Number(!!a.event)||(slotOnDay(a,selectedDate)||'').localeCompare(slotOnDay(b,selectedDate)||''));
  const ganttItems=sortTasks(shownTasks.filter(t=>!t.completed));
  const daysInMonth=new Date(focus.getFullYear(),focus.getMonth()+1,0).getDate();
  const [ganttBodyHeight,setGanttBodyHeight]=useState(400);
   const todayForGantt=new Date();
   const ganttInitialX=focus.getFullYear()===todayForGantt.getFullYear()&&focus.getMonth()===todayForGantt.getMonth()
     ?Math.max(0,(todayForGantt.getDate()-2)*30):0;
  const ganttRows=20;
  const ganttRowHeight=Math.max(1,ganttBodyHeight/ganttRows);
  const ganttVisible=ganttItems;
  const ganttNamesRef=useRef<ScrollView>(null),ganttDaysRef=useRef<ScrollView>(null);
  const ganttPositions=useRef({names:0,days:0});
  const syncGanttY=(source:'names'|'days',y:number)=>{
    const target=source==='names'?'days':'names';
    ganttPositions.current[source]=y;
    if(Math.abs(ganttPositions.current[target]-y)>1){ganttPositions.current[target]=y;(target==='names'?ganttNamesRef:ganttDaysRef).current?.scrollTo({y,animated:false})}
  };
  const ganttBlankCount=Math.max(0,ganttRows-ganttVisible.length);
  return <View style={{flex:1,minHeight:0}}>
    <View style={[styles.dateNav,{minHeight:47}]}><Pressable onPress={()=>setFocus(mode==='week'?addDays(focus,-7):new Date(focus.getFullYear(),focus.getMonth()-1,Math.min(28,focus.getDate())))}><Text style={typeStyle(theme.ink,21)}>‹</Text></Pressable><Text style={typeStyle(theme.ink,15,'800')}>{title}</Text><Pressable onPress={()=>setFocus(mode==='week'?addDays(focus,7):new Date(focus.getFullYear(),focus.getMonth()+1,Math.min(28,focus.getDate())))}><Text style={typeStyle(theme.ink,21)}>›</Text></Pressable></View>
    {mode==='month'&&<View style={[styles.monthBox,{backgroundColor:theme.card,borderColor:theme.line,flexGrow:0,flexShrink:0,height:'40%',minHeight:0}]}>
      <View style={styles.weekHeading}>{'日月火水木金土'.split('').map((x,i)=><Text key={i} style={[styles.weekLabel,{color:theme.muted}]}>{x}</Text>)}</View>
      <View style={{flexDirection:'row',flexWrap:'wrap',flex:1,minHeight:0}}>{Array.from({length:42},(_,i)=>{
        const day=addDays(first,-first.getDay()+i),key=dateKey(day);
        const dayTasks=sortTasks(shownTasks.filter(t=>!t.completed&&(t.dueDate===key||!!slotOnDay(t,key))));
        const active=key===selectedDate;
        return <Pressable key={key} onPress={()=>setFocus(day)} accessibilityLabel={key+' '+dayTasks.length+'件'} style={[styles.monthDay,{backgroundColor:active?'#5879B5':key===dateKey(new Date())?theme.tint:'transparent',opacity:day.getMonth()===focus.getMonth()?1:.3,justifyContent:'center',alignItems:'center',paddingVertical:2,paddingHorizontal:2}]}>
          <Text style={typeStyle(active?'#FFFFFF':theme.ink,11,'700')}>{day.getDate()}</Text>
          <View style={{flexDirection:'row',height:5,alignItems:'center',justifyContent:'center',gap:3}}>
            {dayTasks.slice(0,3).map(t=><View key={t.id} style={{height:4,width:4,borderRadius:3,backgroundColor:active?'#FFFFFF':COLORS[quadrant(t,prefs)]}}/>)}
          </View>
        </Pressable>;
      })}</View>
    </View>}
    {mode==='week'&&<View style={{flexDirection:'row',gap:4,paddingVertical:8}}>{Array.from({length:7},(_,i)=>{
      const day=addDays(weekStart,i),key=dateKey(day);
      const count=shownTasks.filter(t=>!t.completed&&(t.dueDate===key||!!slotOnDay(t,key))).length;
      return <Pressable key={i} onPress={()=>setFocus(day)} accessibilityLabel={key+' '+count+'件'} style={[styles.weekTile,{backgroundColor:key===selectedDate?theme.tint:theme.card,borderColor:key===selectedDate?'#8AABD9':theme.line}]}>
        <Text style={typeStyle(theme.muted,9)}>{'日月火水木金土'[day.getDay()]}</Text>
        <Text style={typeStyle(theme.ink,17,'800')}>{day.getDate()}</Text>
        <Text style={typeStyle(theme===DARK?'#C8DAFF':'#5879B5',9,'700')}>{count}件</Text>
      </Pressable>;
    })}</View>}
    {mode==='gantt'?<View style={[styles.ganttBox,{backgroundColor:theme.card,borderColor:theme.line,padding:9}]}>
      <View style={{flexDirection:'row',flex:1,minHeight:0,alignSelf:'stretch',borderWidth:1,borderColor:theme.line,borderRadius:9,overflow:'hidden'}}>
        <View style={{width:148,flexShrink:0,backgroundColor:theme.card,zIndex:2,height:'100%'}}>
          <View style={{height:46,justifyContent:'center',paddingLeft:7,backgroundColor:theme.tint,borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line}}>
            <Text style={typeStyle(theme.ink,10,'800')}>タスク名　　　　　　　 LT</Text>
          </View>
          <ScrollView ref={ganttNamesRef} nestedScrollEnabled scrollEventThrottle={16} bounces={false} showsVerticalScrollIndicator={ganttItems.length>20} onScroll={e=>syncGanttY('names',e.nativeEvent.contentOffset.y)} onLayout={e=>{const h=e.nativeEvent.layout.height;if(h>0&&Math.abs(ganttBodyHeight-h)>1)setGanttBodyHeight(h)}} style={{flex:1,minHeight:0}}>
          {ganttVisible.map(t=><View key={t.id} style={{height:ganttRowHeight,flexDirection:'row',alignItems:'stretch',borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line}}>
            {!t.event&&<Pressable onPress={()=>onGanttComplete(t)} accessibilityRole="button" accessibilityLabel={t.title+'を完了'} style={{width:24,alignItems:'center',justifyContent:'center',backgroundColor:theme.tint}}><Text style={typeStyle('#70A094',14,'800')}>✓</Text></Pressable>}
            <Pressable onPress={()=>onOpen(t)} style={{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:3,paddingHorizontal:3}}>
              <Text numberOfLines={2} ellipsizeMode="tail" style={[typeStyle(theme.ink,7.5,'800'),{flex:1,minWidth:0,lineHeight:8.5}]}>{t.title}</Text>
              <Text numberOfLines={1} style={[typeStyle(theme.muted,7),{width:25,textAlign:'center'}]}>{t.event?'予定':'LT '+(t.leadDays||1)}</Text>
            </Pressable>
          </View>)}
          {Array.from({length:ganttBlankCount},(_,i)=><View key={'blank-name-'+i} style={{height:ganttRowHeight,backgroundColor:theme.card,borderBottomWidth:1,borderRightWidth:1,borderColor:theme.line}}/>)}
          </ScrollView>
        </View>
        <ScrollView key={'gantt-month-'+focus.getFullYear()+'-'+focus.getMonth()} horizontal nestedScrollEnabled showsHorizontalScrollIndicator={true} bounces={false} directionalLockEnabled keyboardShouldPersistTaps="always" contentOffset={{x:ganttInitialX,y:0}} style={{flex:1,minWidth:0}} contentContainerStyle={{height:'100%',minWidth:daysInMonth*30}}>
          <View style={{width:daysInMonth*30,height:'100%'}}>
            <View style={{flexDirection:'row',height:46,backgroundColor:theme.tint}}>
              {Array.from({length:daysInMonth},(_,i)=>{
                const d=new Date(focus.getFullYear(),focus.getMonth(),i+1);
                const weekend=d.getDay()===0||d.getDay()===6;
                return <View key={i} style={{width:30,height:46,alignItems:'center',justifyContent:'center',gap:3,borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line,backgroundColor:weekend?(prefs.dark?'#354356':'#D5DCE6'):theme.tint}}>
                  <Text style={typeStyle(theme.ink,12,'800')}>{i+1}</Text><Text style={typeStyle(theme.muted,9)}>{'日月火水木金土'[d.getDay()]}</Text>
                </View>
              })}
            </View>
            <ScrollView ref={ganttDaysRef} nestedScrollEnabled bounces={false} scrollEventThrottle={16} showsVerticalScrollIndicator={ganttItems.length>20} onScroll={e=>syncGanttY('days',e.nativeEvent.contentOffset.y)} style={{flex:1,minHeight:0}}>
            {ganttVisible.map(t=>{
              const lt=t.event?1:Math.max(1,Math.min(90,t.leadDays||1));
              const filledDates=new Set(t.event?(t.scheduledStart?[t.scheduledStart.slice(0,10)]:[]):workdayKeys(t.dueDate,lt));
               const left=daysUntil(t.dueDate);
               const fillColor=t.event?COLORS[quadrant(t,prefs)]:left===null?'#66A889':left<0?'#D96B74':left<=2?'#E9C454':'#66A889';
              return <View key={t.id} style={{flexDirection:'row',height:ganttRowHeight}}>
                {Array.from({length:daysInMonth},(_,i)=>{
                  const day=new Date(focus.getFullYear(),focus.getMonth(),i+1);
                  const key=dateKey(day);
                  const filled=filledDates.has(key);
                  const isWeekend=day.getDay()===0||day.getDay()===6;
                  return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${t.title} ${key} を納期にする`} onPress={()=>onGanttStart(t,key)} style={{width:30,height:ganttRowHeight,backgroundColor:filled?fillColor:isWeekend?(prefs.dark?'#354356':'#D5DCE6'):theme.card,borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line,alignItems:'flex-end',justifyContent:'flex-start'}}>
                    {key===t.dueDate&&<View style={{position:'absolute',top:0,bottom:0,left:0,right:0,borderWidth:1.5,borderColor:theme.navy}}/>}
                    {key===t.dueDate&&<View style={{width:5,height:5,borderRadius:3,backgroundColor:'#C78086',margin:2}}/>}
                  </Pressable>;
                })}
              </View>
            })}
            {Array.from({length:ganttBlankCount},(_,i)=><View key={'blank-grid-'+i} style={{flexDirection:'row',height:ganttRowHeight}}>
              {Array.from({length:daysInMonth},(_,j)=>{const day=new Date(focus.getFullYear(),focus.getMonth(),j+1);const weekend=day.getDay()===0||day.getDay()===6;return <View key={j} style={{width:30,height:ganttRowHeight,borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line,backgroundColor:weekend?(prefs.dark?'#354356':'#D5DCE6'):theme.card}}/>;})}
            </View>)}
            </ScrollView>
          </View>
        </ScrollView>
      </View>
      <View style={[styles.pager,{marginTop:11,justifyContent:'space-between'}]}>
        <Text style={typeStyle(theme.muted,10)}>{ganttItems.length}件</Text>
        <View style={{flexDirection:'row',alignItems:'center',gap:7}}>
          {([['#66A889','納期前'],['#E9C454','残2日'],['#D96B74','超過']] as const).map(([color,label])=><View key={label} style={{flexDirection:'row',alignItems:'center',gap:2}}><View style={{width:7,height:7,borderRadius:2,backgroundColor:color}}/><Text style={typeStyle(theme.muted,8)}>{label}</Text></View>)}
        </View>
      </View>
    </View>:<View style={{flex:1,minHeight:0,marginTop:mode==='month'?5:8}}><View style={styles.flexBetween}><Text style={typeStyle(theme.ink,12,'800')}>{focus.getMonth()+1}/{focus.getDate()} の予定</Text><Text style={typeStyle(theme.muted,10)}>{agenda.length}件表示</Text></View>
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={agenda.length>5} style={{flex:1,minHeight:0,marginTop:5}} contentContainerStyle={{gap:5,paddingBottom:7}}>{agenda.length?agenda.map(t=><View key={t.id} style={[styles.agendaItem,{backgroundColor:theme.card,borderColor:theme.line,minHeight:28,height:28,paddingVertical:0,paddingHorizontal:4,gap:4,borderRadius:7}]}>
        <View style={{height:17,width:3,borderRadius:2,backgroundColor:COLORS[quadrant(t,prefs)]}}/>
        {!t.event&&<Pressable accessibilityRole="button" accessibilityLabel={t.title+'を完了'} onPress={()=>onGanttComplete(t)} style={{height:26,width:29,alignItems:'center',justifyContent:'center',backgroundColor:'transparent'}}><CheckGlyph/></Pressable>}
        <View style={{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:2,height:27}}>
          <FullTitle title={t.title} theme={theme}/>
          <Text style={typeStyle(theme.muted,8)}>{slotOnDay(t,selectedDate)?.slice(11,16)|| (t.dueDate?t.dueDate.slice(5).replace('-','/'):'―')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t.title+'を編集'} onPress={()=>onOpen(t)} style={{width:21,height:27,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.muted,13,'800')}>›</Text></Pressable>
        </View>
      </View>):<View style={{minHeight:90,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.muted,11)}>予定なし</Text></View>}</ScrollView>
    </View>}
  </View>;
}
function SettingsPanel({theme,prefs,tasks,onMode,onRename,onDark,onReminder,onLeadEdit,onStart,onExport,onOpenTrash}:{theme:Theme,prefs:Preferences,tasks:Task[],onMode:(m:'priority'|'group')=>void,onRename:()=>void,onDark:()=>void,onReminder:()=>void,onLeadEdit:()=>void,onStart:()=>void,onExport:()=>void,onOpenTrash:()=>void}){
  return <View style={{flex:1,minHeight:0}}><View style={styles.screenHead}><View><Text style={typeStyle(theme.ink,18,'800')}>PREFERENCES</Text></View></View>
    <View style={[styles.settingsBox,{backgroundColor:theme.card,borderColor:theme.line}]}>
      <SettingRow theme={theme} title="分類方法" value={prefs.mode==='priority'?'優先度':'グループ'} onPress={()=>onMode(prefs.mode==='priority'?'group':'priority')}/>
      <SettingRow theme={theme} title="エリア名" value="編集 ›" onPress={onRename}/>
      <SettingRow theme={theme} title="ダークモード" value={prefs.dark?'ON':'OFF'} onPress={onDark} last/>
    </View>
    <View style={[styles.settingsBox,{backgroundColor:theme.card,borderColor:theme.line}]}>
      <SettingRow theme={theme} title="リマインダー" value={prefs.remindersEnabled?'ON':'OFF'} onPress={onReminder}/>
      <SettingRow theme={theme} title="納期前の通知" value={prefs.leadMinutes===60?'1時間前':prefs.leadMinutes===1440?'前日':prefs.leadMinutes===0?'当日':`${prefs.leadMinutes}分前`} onPress={onLeadEdit}/>
      <SettingRow theme={theme} title="予定開始時の通知" value={prefs.startReminder?'ON':'OFF'} onPress={onStart} last/>
    </View>
    <View style={[styles.settingsBox,{backgroundColor:theme.card,borderColor:theme.line}]}>
      <SettingRow theme={theme} title="完了・削除一覧" value={tasks.filter(t=>t.completed&&!t.event).length+'件　›'} onPress={onOpenTrash}/><SettingRow theme={theme} title="データ出力" value="Excel出力 ↗" onPress={onExport} last/>
    </View>
    <View style={[styles.statsBox,{backgroundColor:theme.navy}]}><Text style={typeStyle('#FFFFFF',25,'800')}>{tasks.filter(t=>t.completed).length} <Text style={typeStyle('#B8C9E1',12)}>/ {tasks.length} タスク完了</Text></Text><Text style={[typeStyle('#C3CFE1',11),{marginTop:7}]}></Text></View>
    <Text style={[typeStyle(theme.muted,10),{marginTop:12}]}>データは端末内のSQLiteに保存されます。ログイン不要・オフライン対応。</Text>
  </View>;
}
function SettingRow({theme,title,value,onPress,last=false}:{theme:Theme,title:string,value:string,onPress:()=>void,last?:boolean}){
  return <Pressable onPress={onPress} style={[styles.settingRow,!last&&{borderBottomWidth:1,borderColor:theme.line}]}><Text style={typeStyle(theme.ink,12,'700')}>{title}</Text><Text style={typeStyle(theme===DARK?'#CEE0FF':'#5979B5',11,'800')}>{value}</Text></Pressable>;
}
function FolderBrowserSheet({theme,insetTop,folders,selectedFolderId,onClose,onSelect,onCreate,onDelete}:{theme:Theme,insetTop:number,folders:Folder[],selectedFolderId:string|null,onClose:()=>void,onSelect:(id:string|null)=>void,onCreate:()=>void,onDelete:(id:string)=>void}){
  const path:Folder[]=[];
  let current=folders.find(f=>f.id===selectedFolderId),guard=0;
  while(current&&guard++<20){path.unshift(current);current=folders.find(f=>f.id===current?.parentId)}
  const children=folders.filter(f=>f.parentId===selectedFolderId);
  const [page,setPage]=useState(0);
  const pages=Math.max(1,Math.ceil(children.length/6));
  const pageSafe=Math.min(page,pages-1);
  const changeFolder=(id:string|null)=>{onSelect(id);setPage(0)};
  return <Modal transparent visible statusBarTranslucent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><Pressable onPress={onClose} style={StyleSheet.absoluteFill}/>
      <Animated.View entering={FadeInDown.springify().damping(18)} style={[styles.editorSheet,{top:insetTop+20,maxHeight:'80%',backgroundColor:theme.card}]}>
        <View style={styles.flexBetween}>
          <View style={{flexDirection:'row',alignItems:'center',gap:9}}><Pressable accessibilityLabel="フォルダを閉じる" onPress={onClose} style={{height:44,width:44,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:theme.line,borderRadius:11}}><Text style={typeStyle(theme.ink,24)}>×</Text></Pressable><Text style={typeStyle(theme.ink,16,'800')}>フォルダ</Text></View>
          <Pressable onPress={onCreate} style={{minHeight:44,justifyContent:'center',paddingHorizontal:9,backgroundColor:theme.tint,borderRadius:11}}><Text style={typeStyle(theme.ink,12,'800')} >＋ 子ツリー</Text></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0,marginTop:6,marginBottom:7}} contentContainerStyle={{alignItems:'center',gap:5}}>
          <Pressable onPress={()=>changeFolder(null)} style={{backgroundColor:selectedFolderId===null?theme.tint:theme.bg,padding:8,borderRadius:9}}><Text style={typeStyle(theme.ink,11,'700')}>すべて</Text></Pressable>
          {path.map(f=><React.Fragment key={f.id}><Text style={typeStyle(theme.muted,12)}>›</Text><Pressable onPress={()=>changeFolder(f.id)} style={{backgroundColor:f.id===selectedFolderId?theme.tint:theme.bg,padding:8,borderRadius:9}}><Text style={typeStyle(theme.ink,11,'700')}>{f.name}</Text></Pressable></React.Fragment>)}
        </ScrollView>
        {children.slice(pageSafe*6,pageSafe*6+6).map(f=><View key={f.id} style={{flexDirection:'row',alignItems:'stretch',gap:6,marginBottom:5}}>
          <Pressable onPress={()=>changeFolder(f.id)} style={{flex:1,minWidth:0,minHeight:47,paddingHorizontal:11,borderRadius:11,borderWidth:1,borderColor:theme.line,backgroundColor:theme.bg,flexDirection:'row',alignItems:'center',gap:8}}>
            <Text style={typeStyle('#D1A752',17)}>▰</Text><Text numberOfLines={1} style={[typeStyle(theme.ink,12,'700'),{flex:1}]}>{f.name}</Text><Text style={typeStyle(theme.muted,19)}>›</Text>
          </Pressable>
          {(f.parentId!==null||folders.filter(x=>x.parentId===null).length>1)&&<Pressable accessibilityRole="button" accessibilityLabel={f.name+'を削除'} onPress={()=>onDelete(f.id)} style={{minWidth:48,minHeight:47,paddingHorizontal:7,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:theme.bg,borderWidth:1,borderColor:theme.line}}><Text style={typeStyle('#C98087',11,'800')}>削除</Text></Pressable>}
        </View>)}
        {children.length===0&&<View style={{minHeight:46,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.muted,11)}>フォルダなし</Text></View>}
        {selectedFolderId&&(folders.find(f=>f.id===selectedFolderId)?.parentId!==null||folders.filter(f=>f.parentId===null).length>1)&&<Pressable accessibilityRole="button" accessibilityLabel="現在のツリーを削除" onPress={()=>onDelete(selectedFolderId)} style={{minHeight:44,alignItems:'center',justifyContent:'center',marginTop:7,borderRadius:10,borderWidth:1,borderColor:'#D3A2A8',backgroundColor:theme.bg}}><Text style={typeStyle('#B74F59',12,'800')}>現在のツリーを削除</Text></Pressable>}
        {pages>1&&<View style={[styles.pager,{justifyContent:'center',gap:14,marginTop:5,minHeight:36}]}>
          <Pressable disabled={pageSafe===0} onPress={()=>setPage(n=>Math.max(0,n-1))} style={{minWidth:44,minHeight:36,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.muted,21)}>‹</Text></Pressable><Text style={typeStyle(theme.muted,11)}>{pageSafe+1}/{pages}</Text>
          <Pressable disabled={pageSafe>=pages-1} onPress={()=>setPage(n=>n+1)} style={{minWidth:44,minHeight:36,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.muted,21)}>›</Text></Pressable>
        </View>}
        <Pressable onPress={onClose} style={[styles.primaryButton,{backgroundColor:theme.navy,minHeight:44,marginTop:10}]}><Text style={typeStyle('#FFFFFF',12,'800')}>この場所のタスクを見る</Text></Pressable>
      </Animated.View>
    </View>
  </Modal>;
}
function FolderSheet({theme,insetTop,parentName,initialName='',title='子ツリーを追加',onClose,onCreate}:{theme:Theme,insetTop:number,parentName:string,initialName?:string,title?:string,onClose:()=>void,onCreate:(name:string)=>void}){
  const [name,setName]=useState(initialName);
  return <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><Pressable onPress={onClose} style={StyleSheet.absoluteFill}/>
      <Animated.View entering={FadeInDown.springify().damping(18)} style={[styles.editorSheet,{top:insetTop+25,backgroundColor:theme.card}]}>
        <View style={styles.flexBetween}><Text style={typeStyle(theme.ink,16,'800')}>{title}</Text><Pressable onPress={onClose} accessibilityLabel="閉じる" style={{minHeight:44,minWidth:44,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.ink,24)}>×</Text></Pressable></View>
        <Text style={[styles.formLabel,{color:theme.muted}]}>名前（車種・案件・工程など自由）</Text>
        <TextInput value={name} maxLength={32} placeholder="例：車種A / 案件 / 工程" placeholderTextColor={theme.muted} onChangeText={setName} returnKeyType="done" onSubmitEditing={()=>onCreate(name)} style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
        <Text style={[typeStyle(theme.muted,11),{marginTop:8}]}>保存先：{parentName}</Text>
        <View style={{flexDirection:'row',gap:8,marginTop:11}}>
          <Pressable onPress={onClose} style={{minHeight:44,paddingHorizontal:15,justifyContent:'center',borderRadius:11,backgroundColor:theme.bg}}><Text style={typeStyle(theme.ink,12,'800')}>キャンセル</Text></Pressable>
          <Pressable onPress={()=>onCreate(name)} style={[styles.primaryButton,{backgroundColor:theme.navy,minHeight:44}]}><Text style={typeStyle('#fff',12,'800')}>作成</Text></Pressable>
        </View>
      </Animated.View>
    </View>
  </Modal>;
}
function DueCalendarPicker({value,theme,onSelect,onClose}:{value:string,theme:Theme,onSelect:(date:string)=>void,onClose:()=>void}){
  const initial=parseDateKey(value)||new Date();
  const [visibleMonth,setVisibleMonth]=useState(new Date(initial.getFullYear(),initial.getMonth(),1));
  const year=visibleMonth.getFullYear(),month=visibleMonth.getMonth();
  const shift=(n:number)=>setVisibleMonth(new Date(year,month+n,1));
  const initialOffset=visibleMonth.getDay();
  return <View style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:120,backgroundColor:theme.card,borderRadius:16,padding:10,justifyContent:'flex-start'}}>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:44}}>
      <Pressable onPress={()=>shift(-1)} accessibilityLabel="前月" style={{width:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.ink,23)}>‹</Text></Pressable>
      <Text style={typeStyle(theme.ink,15,'800')}>{year}年 {month+1}月</Text>
      <Pressable onPress={()=>shift(1)} accessibilityLabel="翌月" style={{width:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.ink,23)}>›</Text></Pressable>
    </View>
    <View style={{flexDirection:'row',marginBottom:6}}>
      {'日月火水木金土'.split('').map((d,i)=><Text key={i} style={[typeStyle(theme.muted,10,'700'),{width:'14.2857%',textAlign:'center'}]}>{d}</Text>)}
    </View>
    <View style={{flexDirection:'row',flexWrap:'wrap',minHeight:0,justifyContent:'flex-start'}}>
      {Array.from({length:42},(_,i)=>{
        const day=new Date(year,month,i-initialOffset+1),key=dateKey(day);
        const selected=value===key,outside=day.getMonth()!==month;
        return <Pressable key={key} accessibilityRole="button" accessibilityLabel={key+'を納期に設定'} onPress={()=>onSelect(key)}
          style={{width:'14.2857%',height:41,alignItems:'center',justifyContent:'center',padding:2}}>
          <View style={{borderRadius:9,minWidth:35,minHeight:36,alignItems:'center',justifyContent:'center',backgroundColor:selected?'#5879B5':theme.bg,opacity:outside?.5:1}}>
            <Text style={typeStyle(selected?'#FFFFFF':theme.ink,12,'700')}>{day.getDate()}</Text>
          </View>
        </Pressable>;
      })}
    </View>
    <View style={{flexDirection:'row',gap:6,marginTop:'auto'}}>
      <Pressable onPress={()=>onSelect('')} style={{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:theme.tint}}><Text style={typeStyle(theme.ink,12,'700')}>納期なし</Text></Pressable>
      <Pressable onPress={()=>onSelect(dateKey(new Date()))} style={{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:theme.tint}}><Text style={typeStyle(theme.ink,12,'700')}>今日</Text></Pressable>
      <Pressable onPress={onClose} style={{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:theme.tint}}><Text style={typeStyle(theme.ink,12,'700')}>戻る</Text></Pressable>
    </View>
  </View>;
}

function EventEditor({entry,theme,insetTop,folders,initialFolderId,initialDate,onClose,onSave,onDelete}:{entry:Task|'new',theme:Theme,insetTop:number,folders:Folder[],initialFolderId:string|null,initialDate:string,onClose:()=>void,onSave:(task:Task)=>void,onDelete:(task:Task)=>void}){
  const original=entry==='new'?null:entry;
  const [title,setTitle]=useState(original?.title||'');
  const [day,setDay]=useState(original?.scheduledStart?.slice(0,10)||initialDate);
  const [time,setTime]=useState(original?.scheduledStart?.slice(11,16)||'10:00');
  const [duration,setDuration]=useState(original?.durationMin||60);
  const [folderId,setFolderId]=useState<string|null>(original?folderForTask(original):(initialFolderId||'work'));
  const [datePicker,setDatePicker]=useState(false);
  const folderList:{id:string,name:string}[]=[];
  function addFolder(parent:string|null,depth:number){
    if(depth>16)return;
    for(const folder of folders.filter(x=>x.parentId===parent)){
      folderList.push({id:folder.id,name:'　'.repeat(depth)+folder.name});
      addFolder(folder.id,depth+1);
    }
  }
  addFolder(null,0);
  function commit(){
    const text=title.trim();
    if(!text){Alert.alert('予定名を入力してください');return}
    if(!parseDateKey(day)){Alert.alert('予定日が正しくありません');return}
    if(!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)){Alert.alert('時刻が正しくありません','HH:mm 形式で入力してください');return}
    const group=folderId?folderGroup(folders,folderId):'その他';
    const item=original?{...original}:createTask(text,null,duration,false,false,group);
    Object.assign(item,{title:text,event:true,folderId,group,scheduledStart:day+'T'+time,durationMin:duration,dueDate:null,ganttStart:null,leadDays:1,important:false,urgent:false,pinned:false,manualOrder:null,completed:false});
    onSave(item);
  }
  return <Modal transparent visible statusBarTranslucent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onClose}/>
      <Animated.View entering={FadeInDown.springify().damping(18)} style={[styles.editorSheet,{top:insetTop+12,maxHeight:'85%',backgroundColor:theme.card}]}>
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.flexBetween}><View style={{flexDirection:'row',alignItems:'center',gap:8}}><Pressable onPress={onClose} accessibilityLabel="保存せず戻る" style={{minHeight:44,minWidth:44,alignItems:'center',justifyContent:'center',borderWidth:1,borderRadius:11,borderColor:theme.line}}><Text style={typeStyle(theme.ink,24)}>×</Text></Pressable><Text style={typeStyle(theme.ink,16,'800')}>{original?'予定を編集':'会議・予定を追加'}</Text></View><Pressable onPress={commit} hitSlop={8}><Text style={typeStyle('#5879B5',12,'800')}>保存 ✓</Text></Pressable></View>
          <Text style={[styles.formLabel,{color:theme.muted}]}>予定名</Text>
          <TextInput value={title} onChangeText={setTitle} maxLength={70} placeholder="例：定例会議・取引先打ち合わせ" placeholderTextColor={theme.muted} style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
          <Text style={[styles.formLabel,{color:theme.muted}]}>開催日</Text>
          <Pressable onPress={()=>{Keyboard.dismiss();setDatePicker(true)}} accessibilityLabel="日付を選択" style={[styles.input,{backgroundColor:theme.bg,borderColor:theme.line,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}]}><Text style={typeStyle(theme.ink,14,'700')}>{day}</Text><Text style={typeStyle(theme.ink,18)}>▦</Text></Pressable>
          <Text style={[styles.formLabel,{color:theme.muted}]}>開始時刻（HH:mm）</Text>
          <TextInput value={time} onChangeText={setTime} maxLength={5} autoCorrect={false} placeholder="10:00" placeholderTextColor={theme.muted} style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
          <Text style={[styles.formLabel,{color:theme.muted}]}>所要時間</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0}} contentContainerStyle={{flexDirection:'row',gap:5}}>
            {[30,60,90,120,180,240].map(n=><Pressable key={n} onPress={()=>setDuration(n)} style={{minHeight:40,paddingHorizontal:10,justifyContent:'center',borderRadius:9,borderWidth:1,borderColor:duration===n?'#8FAADD':theme.line,backgroundColor:duration===n?theme.tint:theme.bg}}><Text style={typeStyle(theme.ink,10,'700')}>{n}分</Text></Pressable>)}
          </ScrollView>
          <Text style={[styles.formLabel,{color:theme.muted}]}>業務・車種・フォルダ</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0}} contentContainerStyle={{flexDirection:'row',gap:5}}>
            <Pressable onPress={()=>setFolderId(null)} style={{minHeight:40,paddingHorizontal:10,justifyContent:'center',borderRadius:9,backgroundColor:folderId===null?theme.tint:theme.bg}}><Text style={typeStyle(theme.ink,10,'700')}>すべて</Text></Pressable>
            {folderList.map(f=><Pressable key={f.id} onPress={()=>setFolderId(f.id)} style={{minHeight:40,paddingHorizontal:10,justifyContent:'center',borderRadius:9,borderWidth:1,borderColor:folderId===f.id?'#8FAADD':theme.line,backgroundColor:folderId===f.id?theme.tint:theme.bg}}><Text style={typeStyle(theme.ink,10,'700')}>{f.name}</Text></Pressable>)}
          </ScrollView>
          <View style={{flexDirection:'row',alignItems:'center',gap:9,marginTop:15}}>
            {original&&<Pressable onPress={()=>Alert.alert('予定を削除','この予定を削除しますか？',[{text:'キャンセル',style:'cancel'},{text:'削除',style:'destructive',onPress:()=>onDelete(original)}])} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle('#C98087',12,'700')}>削除</Text></Pressable>}
            <Pressable onPress={onClose} style={{minHeight:44,paddingHorizontal:12,justifyContent:'center',borderRadius:10,backgroundColor:theme.bg}}><Text style={typeStyle(theme.ink,12,'800')}>キャンセル</Text></Pressable>
            <Pressable onPress={commit} style={[styles.primaryButton,{minHeight:44,backgroundColor:theme.navy}]}><Text style={typeStyle('#FFFFFF',12,'800')}>予定を保存</Text></Pressable>
          </View>
        </ScrollView>
        {datePicker&&<DueCalendarPicker value={day} theme={theme} onSelect={value=>{if(value)setDay(value);setDatePicker(false)}} onClose={()=>setDatePicker(false)}/>}
      </Animated.View>
    </View>
  </Modal>;
}
function TaskEditor({entry,initialQuadrant,initialDueDate,prefs,theme,insetTop,height,folders,initialFolderId,onClose,onSave,onDelete}:{entry:Task|'new',initialQuadrant:number|null,initialDueDate:string|null,prefs:Preferences,theme:Theme,insetTop:number,height:number,folders:Folder[],initialFolderId:string|null,onClose:()=>void,onSave:(item:Task)=>void,onDelete:(task:Task)=>void}){
  const original=entry==='new'?null:entry;
  const [title,setTitle]=useState(original?.title??'');const [important,setImportant]=useState(original?.important??(initialQuadrant===null?true:initialQuadrant<=1));const [urgent,setUrgent]=useState(original?.urgent??(initialQuadrant===null?false:initialQuadrant===0||initialQuadrant===2));
  const [group,setGroup]=useState<Group>(original?.group??(initialQuadrant===null?'プライベート':GROUPS[initialQuadrant]));
  const [duration,setDuration]=useState(original?.durationMin??60);const [leadDays,setLeadDays]=useState(String(original?.leadDays??1));
  const [date,setDate]=useState(original?.dueDate??initialDueDate??dateKey(addDays(new Date(),1)));
  const [showDueCalendar,setShowDueCalendar]=useState(false);
  const [pin,setPin]=useState(original?.pinned??false);
  const [selectedFolder,setSelectedFolder]=useState<string|null>(original?folderForTask(original):(()=>{const preferred=initialFolderId||(['work','personal','study','other'][initialQuadrant??1]);return folders.some(f=>f.id===preferred)?preferred:(folders.find(f=>f.parentId===null)?.id||null)})());
  const folderList:Folder[]=[];
  function walk(parent:string|null,depth=0){if(depth>16)return;for(const f of folders.filter(f=>f.parentId===parent)){folderList.push({...f,name:'　'.repeat(depth)+f.name});walk(f.id,depth+1)}}
  walk(null);

  function commit(){const text=title.trim();if(!text){Alert.alert('タスク名を入力してください');return}if(date.trim()&&!parseDateKey(date.trim())){Alert.alert('日付の形式が正しくありません','YYYY-MM-DD で入力してください');return}if(!/^\d+$/.test(leadDays)||+leadDays<1||+leadDays>90){Alert.alert('LT日数は1〜90日で指定してください');return}
    const item=original?{...original}:{...createTask(text,date.trim()||null,duration,important,urgent,group)};
    Object.assign(item,{title:text,important,urgent,group:selectedFolder?folderGroup(folders,selectedFolder):group,folderId:selectedFolder,durationMin:duration,leadDays:+leadDays,dueDate:date.trim()||null,pinned:pin,manualOrder:pin?(item.manualOrder??-1):null});
    onSave(item);
  }
  return <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onClose}/><Animated.View entering={FadeInDown.springify().damping(19)} style={[styles.editorSheet,{top:insetTop+12,maxHeight:height-insetTop-35,backgroundColor:theme.card}]}>
      <View style={styles.flexBetween}><View style={{flexDirection:'row',alignItems:'center',gap:10,flexShrink:1}}><Pressable onPress={onClose} accessibilityRole='button' accessibilityLabel='保存せず戻る' hitSlop={8} style={{minWidth:44,minHeight:44,borderRadius:12,borderWidth:1,borderColor:theme.line,backgroundColor:theme.bg,justifyContent:'center',alignItems:'center'}}><Text style={typeStyle(theme.ink,25,'500')}>×</Text></Pressable><Text style={typeStyle(theme.ink,16,'800')}>{original?'タスクを編集':'タスクを追加'}</Text></View><Pressable onPress={commit} hitSlop={8}><Text style={typeStyle('#5879B5',12,'800')}>保存 ✓</Text></Pressable></View>
      <Text style={[styles.formLabel,{color:theme.muted}]}>TASK NAME</Text><TextInput value={title} onChangeText={setTitle} maxLength={70} placeholder="何をする？" placeholderTextColor={theme.muted} autoCorrect={false} style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
      <Text style={[styles.formLabel,{color:theme.muted}]}>重要度・緊急度（4分類から選択）</Text>
       <View style={{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:5}}>
         {(['重要・緊急','重要・余裕あり','緊急・軽め','優先度低め'] as const).map((label,i)=>{
           const selected=(important?(urgent?0:1):(urgent?2:3))===i;
           return <Pressable key={i} accessibilityRole="radio" accessibilityState={{checked:selected}} onPress={()=>{setImportant(i<2);setUrgent(i===0||i===2)}} style={{width:'48.5%',minHeight:45,borderWidth:1,borderRadius:11,alignItems:'center',justifyContent:'center',backgroundColor:selected?theme.tint:theme.bg,borderColor:selected?'#5879B5':theme.line}}>
             <Text style={typeStyle(selected?(prefs.dark?'#E4EDFF':'#4A6AA5'):theme.ink,11,'700')}>{label}</Text>
           </Pressable>;
         })}
       </View>
      <Text style={[styles.formLabel,{color:theme.muted}]}>フォルダ</Text>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{flexGrow:0}} contentContainerStyle={{flexDirection:'row',gap:6,paddingVertical:2}}>
        <Pressable onPress={()=>setSelectedFolder(null)} style={{minHeight:44,paddingHorizontal:10,justifyContent:'center',borderRadius:10,backgroundColor:selectedFolder===null?theme.tint:theme.bg,borderWidth:1,borderColor:theme.line}}><Text style={typeStyle(theme.ink,11,'700')}>すべて</Text></Pressable>
        {folderList.map(f=><Pressable key={f.id} onPress={()=>{setSelectedFolder(f.id);setGroup(folderGroup(folders,f.id))}} style={{minHeight:44,paddingHorizontal:10,justifyContent:'center',borderRadius:10,backgroundColor:selectedFolder===f.id?theme.tint:theme.bg,borderWidth:1,borderColor:selectedFolder===f.id?'#7395D3':theme.line}}><Text numberOfLines={1} style={typeStyle(theme.ink,11,'700')}>{f.name}</Text></Pressable>)}
      </ScrollView>
      <Text style={[styles.formLabel,{color:theme.muted}]}>所要時間</Text><View style={styles.formChoices}>{[30,60,90,120,180].map(n=><Chip key={n} theme={theme} title={`${n}分`} selected={n===duration} onPress={()=>setDuration(n)}/>)}</View>
      <Text style={[styles.formLabel,{color:theme.muted}]}>ガントチャート LT（稼働日・土日を除く／1〜90）</Text><TextInput value={leadDays} onChangeText={setLeadDays} keyboardType="number-pad" style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
      <Text style={[styles.formLabel,{color:theme.muted}]}>納期</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="納期をカレンダーから選ぶ" onPress={()=>{Keyboard.dismiss();setShowDueCalendar(true)}} style={[styles.input,{backgroundColor:theme.bg,borderColor:theme.line,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}]}><Text style={typeStyle(theme.ink,14,'700')}>{date||'納期なし'}</Text><Text style={typeStyle('#6F91CA',21)}>▦</Text></Pressable>
      <Text style={[styles.formLabel,{color:theme.muted}]}>MANUAL ORDER</Text><View style={styles.formChoices}><Chip theme={theme} title="◆ 手動順位を固定" selected={pin} onPress={()=>setPin(!pin)}/><Chip theme={theme} title="自動に戻す" selected={!pin} onPress={()=>setPin(false)}/></View>
      <View style={{flexDirection:'row',gap:12,marginTop:8,alignItems:'center'}}>{original&&<Pressable onPress={()=>Alert.alert('タスクを削除','このタスクを削除しますか？',[{text:'キャンセル',style:'cancel'},{text:'削除',style:'destructive',onPress:()=>onDelete(original)}])}><Text style={typeStyle('#C98087',12,'700')}>削除</Text></Pressable>}<Pressable onPress={onClose} accessibilityRole='button' accessibilityLabel='キャンセルして戻る' style={{minHeight:44,paddingHorizontal:13,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:theme.line,borderRadius:13,backgroundColor:theme.bg}}><Text style={typeStyle(theme.ink,12,'800')}>キャンセル</Text></Pressable><Pressable onPress={commit} style={[styles.primaryButton,{backgroundColor:theme.navy,minHeight:44}]}><Text style={typeStyle('#FFFFFF',12,'800')}>{original?'変更を保存':'タスクを作成'}</Text></Pressable></View>
      {showDueCalendar&&<DueCalendarPicker value={date} theme={theme} onSelect={value=>{setDate(value);setShowDueCalendar(false)}} onClose={()=>setShowDueCalendar(false)}/>}
    </Animated.View></View>
  </Modal>;
}
function LeadTimeSheet({theme,insetTop,current,onClose,onSave}:{theme:Theme,insetTop:number,current:number,onClose:()=>void,onSave:(minutes:number)=>void}){
  const [minutes,setMinutes]=useState(String(current));
  const submit=()=>{
    const value=Number(minutes);
    if(!/^\d+$/.test(minutes)||!Number.isSafeInteger(value)||value<0||value>10080){
      Alert.alert('通知タイミングの入力','0〜10080分（最大7日前）の整数を入力してください');return;
    }
    onSave(value);
  };
  return <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onClose}/>
      <Animated.View entering={FadeInDown.springify().damping(19)} style={[styles.editorSheet,{top:insetTop+30,backgroundColor:theme.card}]}>
        <View style={styles.flexBetween}><Text style={typeStyle(theme.ink,16,'800')}>納期前の通知</Text><Pressable onPress={onClose}><Text style={typeStyle(theme.muted,12,'700')}>閉じる ×</Text></Pressable></View>
        <Text style={[styles.formLabel,{color:theme.muted}]}>通知のタイミング</Text>
        <View style={styles.formChoices}>{[[0,'当日'],[60,'1時間前'],[1440,'前日'],[2880,'2日前']].map(([n,label])=><Chip key={n} theme={theme} title={String(label)} selected={Number(minutes)===n} onPress={()=>setMinutes(String(n))}/>)}</View>
        <Text style={[styles.formLabel,{color:theme.muted}]}>自由入力（分前・0〜10080）</Text>
        <TextInput keyboardType="number-pad" selectTextOnFocus value={minutes} onChangeText={setMinutes} style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
        <Pressable onPress={submit} style={[styles.primaryButton,{marginTop:15,backgroundColor:theme.navy}]}><Text style={typeStyle('#FFFFFF',12,'800')}>設定を保存</Text></Pressable>
      </Animated.View>
    </View>
  </Modal>;
}
function RenameSheet({prefs,theme,insetTop,onClose,onSave}:{prefs:Preferences,theme:Theme,insetTop:number,onClose:()=>void,onSave:(names:Preferences['names'])=>void}){
  const [names,setNames]=useState([...prefs.names]);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent><View style={styles.overlay}><Pressable onPress={onClose} style={StyleSheet.absoluteFill}/><View style={[styles.editorSheet,{top:insetTop+25,backgroundColor:theme.card}]}><View style={styles.flexBetween}><Text style={typeStyle(theme.ink,16,'800')}>エリア名を編集</Text><Pressable onPress={()=>{if(names.every(v=>v.trim()))onSave(names as Preferences['names'])}}><Text style={typeStyle('#5879B5',12,'800')}>保存 ✓</Text></Pressable></View>{names.map((name,i)=><View key={i}><Text style={[styles.formLabel,{color:theme.muted}]}>AREA 0{i+1}</Text><TextInput maxLength={18} value={name} onChangeText={v=>setNames(before=>before.map((x,j)=>i===j?v:x))} style={[styles.input,{color:theme.ink,backgroundColor:theme.bg,borderColor:theme.line}]}/></View>)}</View></View></Modal>;
}
export default function App(){return <GestureHandlerRootView style={{flex:1}}><SafeAreaProvider><SQLiteProvider databaseName="kanri.db" onInit={migrate}><AppInner/></SQLiteProvider></SafeAreaProvider></GestureHandlerRootView>}
const styles=StyleSheet.create({
  root:{flex:1,minHeight:0},top:{paddingHorizontal:11,paddingTop:5,paddingBottom:2},brandRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},brand:{fontSize:26,fontWeight:'800',letterSpacing:-1.4},eyebrow:{fontSize:10,fontWeight:'800',letterSpacing:2.1,marginTop:-1},quick:{height:44,minWidth:44,borderRadius:11,borderWidth:1,alignItems:'center',justifyContent:'center'},hero:{minHeight:83,borderRadius:19,marginTop:12,paddingHorizontal:17,paddingVertical:12,flexDirection:'row',alignItems:'center'},heroEyebrow:{fontSize:10,letterSpacing:1.6,color:'#94A9C5',fontWeight:'800'},heroTitle:{fontSize:17,fontWeight:'800',color:'#FFFFFF',marginTop:5},heroSub:{fontSize:10,color:'#BEC8D9',marginTop:5},percentCircle:{width:55,height:55,borderRadius:30,borderWidth:5,alignItems:'center',justifyContent:'center'},content:{flex:1,minHeight:0,paddingHorizontal:8,paddingTop:0,paddingBottom:2},screenHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:37},iconButton:{borderWidth:1,borderRadius:12,minWidth:44,minHeight:38,paddingHorizontal:9,alignItems:'center',justifyContent:'center'},board:{flex:1,minHeight:0,flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',alignContent:'space-between',marginTop:3},quad:{width:'49.2%',height:'49.5%',borderRadius:15,padding:7,borderWidth:1,minHeight:0},quadHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:5},taskTile:{borderRadius:10,borderWidth:1,padding:7,minHeight:48},check:{width:16,height:16,borderRadius:8,borderWidth:1.6},pager:{height:22,flexDirection:'row',justifyContent:'flex-end',alignItems:'center',gap:10},bottomHint:{height:24,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},nav:{flexDirection:'row',borderTopLeftRadius:16,borderTopRightRadius:16,overflow:'visible'},navButton:{flex:1,alignItems:'center',justifyContent:'center',gap:2},navAdd:{width:46,height:46,backgroundColor:'#7698D5',borderRadius:17,alignItems:'center',justifyContent:'center',transform:[{translateY:-5}]},seg:{flexDirection:'row',gap:3,padding:3,borderRadius:12},segItem:{minWidth:37,paddingHorizontal:7,paddingVertical:7,borderRadius:9,alignItems:'center'},dateNav:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:4},monthBox:{borderRadius:14,borderWidth:1,paddingHorizontal:5,paddingVertical:6},weekHeading:{flexDirection:'row',marginBottom:3},weekLabel:{width:'14.2857%',textAlign:'center',fontSize:10,fontWeight:'800'},monthDay:{width:'14.2857%',height:'16.6667%',justifyContent:'center',alignItems:'center',borderRadius:8,gap:2},weekTile:{flex:1,borderRadius:10,borderWidth:1,minHeight:76,alignItems:'center',justifyContent:'space-evenly'},agendaItem:{minHeight:46,borderWidth:1,borderRadius:11,padding:7,flexDirection:'row',gap:11,alignItems:'center'},ganttBox:{flex:1,minHeight:0,borderRadius:17,borderWidth:1,padding:11},ganttMonthRow:{flexDirection:'row',alignItems:'center',gap:4},ganttDays:{flex:1,flexDirection:'row',alignItems:'center',gap:1,minWidth:0},ganttSquare:{flex:1,aspectRatio:1,minWidth:0,borderRadius:1},ganttRow:{height:49,flexDirection:'row',alignItems:'center',borderBottomWidth:.5,borderBottomColor:'#D7DCE4'},puzzleInbox:{borderRadius:14,padding:7,marginTop:3},puzzleTile:{flex:1,minWidth:0,maxWidth:'49%',paddingHorizontal:8,paddingVertical:5,borderRadius:10,borderWidth:1,borderColor:'#4A5E7D',backgroundColor:'#263953',minHeight:47},timePanel:{flex:1,minHeight:0,borderRadius:15,borderWidth:1,paddingLeft:29,paddingRight:5,paddingTop:5,paddingBottom:5,overflow:'visible'},timeSlot:{flex:1,borderTopWidth:1,borderStyle:'dashed',minHeight:0},timeLabel:{position:'absolute',left:-25,top:-5,fontSize:8},scheduledBar:{position:'absolute',left:30,right:5,borderRadius:7,padding:4,zIndex:5,overflow:'hidden'},flexBetween:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},settingsBox:{borderWidth:1,borderRadius:13,marginTop:6,paddingHorizontal:10},settingRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},statsBox:{padding:10,marginTop:7,borderRadius:13},toast:{position:'absolute',alignSelf:'center',backgroundColor:'#243652',borderRadius:17,paddingHorizontal:15,paddingVertical:9,zIndex:95,maxWidth:'90%'},undo:{position:'absolute',left:17,right:17,padding:13,borderRadius:13,flexDirection:'row',justifyContent:'space-between',backgroundColor:'#233652',zIndex:80},overlay:{flex:1,backgroundColor:'#030814B8',alignItems:'center'},editorSheet:{position:'absolute',left:10,right:10,padding:11,borderRadius:17,overflow:'hidden'},formLabel:{fontSize:10,fontWeight:'800',letterSpacing:.5,marginTop:7,marginBottom:3},input:{borderWidth:1,borderRadius:10,minHeight:44,paddingHorizontal:10,fontSize:16},formChoices:{flexDirection:'row',gap:5},chip:{borderWidth:1,borderRadius:10,minHeight:42,alignItems:'center',justifyContent:'center',paddingHorizontal:4},primaryButton:{flex:1,borderRadius:12,padding:12,alignItems:'center'},
});