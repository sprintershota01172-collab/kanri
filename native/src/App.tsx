import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Alert,Keyboard,Modal,Pressable,StatusBar,StyleSheet,Text,TextInput,View,useWindowDimensions,BackHandler,ScrollView} from 'react-native';
import {SQLiteProvider,useSQLiteContext} from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import {Gesture,GestureDetector,GestureHandlerRootView} from 'react-native-gesture-handler';
import {scheduleOnRN} from 'react-native-worklets';
import Animated,{FadeIn,FadeInDown,FadeOut,withSpring,useAnimatedStyle,useSharedValue} from 'react-native-reanimated';
import {SafeAreaProvider,useSafeAreaInsets} from 'react-native-safe-area-context';
import {addDays,canSchedule,COLORS,createTask,dateKey,DEFAULT_PREFS,daysUntil,dueLabel,GROUPS,Group,moveToQuadrant,pad,parseDateKey,parseScheduleMinutes,Preferences,priorityScore,quadrant,sortTasks,Task,timeText,Folder,Workspace,DEFAULT_WORKSPACE,folderForTask,folderGroup} from './model';
import {deleteTask,migrate,readPreferences,readTasks,savePreferences,saveTask,readWorkspace,saveWorkspace} from './storage';
import {cancelTaskNotifications,registerNotifications,requestLocalPermissions,scheduleTaskNotifications,snoozeTask} from './reminders';

type Tab = 'board'|'calendar'|'puzzle'|'settings';
type Mode = 'month'|'week'|'gantt';
type Theme = {bg:string,card:string,ink:string,muted:string,line:string,tint:string,navy:string,inverse:string};
const LIGHT:Theme={bg:'#F3F5F7',card:'#FFFFFF',ink:'#152238',muted:'#8591A3',line:'#E7EBF0',tint:'#E8EDF8',navy:'#101D32',inverse:'#FFFFFF'};
const DARK:Theme={bg:'#0F1727',card:'#213048',ink:'#FFFFFF',muted:'#D0D8E7',line:'#50617C',tint:'#334D71',navy:'#08111F',inverse:'#FFFFFF'};
function typeStyle(color:string,size=12,weight:'400'|'500'|'600'|'700'|'800'='600') {return {color,fontSize:size,fontWeight:weight} as const;}
function Chip({title,selected,onPress,theme,flex=1}:{title:string,selected?:boolean,onPress:()=>void,theme:Theme,flex?:number}){
  return <Pressable onPress={onPress} style={[styles.chip,{flex,backgroundColor:selected?theme.tint:theme.bg,borderColor:selected?'#8FAADD':theme.line}]}><Text numberOfLines={1} style={typeStyle(selected?(theme===DARK?'#E6EFFF':'#5475B6'):theme.ink,10,'700')}>{title}</Text></Pressable>;
}
function IconButton({label,onPress,theme}:{label:string,onPress:()=>void,theme:Theme}){
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.iconButton,{backgroundColor:theme.card,borderColor:theme.line}]}><Text style={typeStyle(theme.ink,12,'700')}>{label}</Text></Pressable>;
}
function AppInner(){
  const db=useSQLiteContext();const insets=useSafeAreaInsets();const {height:winHeight}=useWindowDimensions();
  const [tasks,setTasks]=useState<Task[]>([]);const [prefs,setPrefs]=useState<Preferences>(DEFAULT_PREFS);
  const [loaded,setLoaded]=useState(false);const [tab,setTab]=useState<Tab>('board');
  const [workspace,setWorkspace]=useState<Workspace>({...DEFAULT_WORKSPACE,folders:DEFAULT_WORKSPACE.folders.map(f=>({...f}))});
  const [newFolderOpen,setNewFolderOpen]=useState(false);
  const swipeStart=useRef<{x:number;y:number;time:number}|null>(null);
  const [editor,setEditor]=useState<Task|'new'|null>(null);const [newQuadrant,setNewQuadrant]=useState<number|null>(null);
  const [renaming,setRenaming]=useState(false);
  const [leadEditor,setLeadEditor]=useState(false);
  const [toast,setToast]=useState('');const toastRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [undo,setUndo]=useState<{label:string,fn:()=>void}|null>(null);
  const undoTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [boardPages,setBoardPages]=useState([0,0,0,0]);
  const [calMode,setCalMode]=useState<Mode>('month');const [focus,setFocus]=useState(new Date());const [ganttPage,setGanttPage]=useState(0);
  const [puzzleDate,setPuzzleDate]=useState(new Date());const [selectedBlock,setSelectedBlock]=useState<string|null>(null);const [inboxPage,setInboxPage]=useState(0);
  const boardRef=useRef<View>(null);const morningRef=useRef<View>(null);const afternoonRef=useRef<View>(null);
  const [panelHeight,setPanelHeight]=useState(290);const tasksRef=useRef(tasks);const prefsRef=useRef(prefs);
  tasksRef.current=tasks;prefsRef.current=prefs;
  const theme=prefs.dark?DARK:LIGHT;
  function addInQuadrant(index:number){setNewQuadrant(index);setEditor('new')}

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

  useEffect(()=>{if(loaded){void saveWorkspace(db,{...workspace,tab}).catch(e=>console.warn('folder state persistence',e))}},[db,workspace,tab,loaded]);
  function selectTab(next:Tab){setTab(next)}
  function selectFolder(id:string|null){setWorkspace(p=>({...p,folderId:id}));setBoardPages([0,0,0,0])}
  function createFolder(name:string){
    const trimmed=name.trim();if(!trimmed){Alert.alert('フォルダ名を入力してください');return}
    if(workspace.folders.some(f=>f.parentId===workspace.folderId&&f.name===trimmed)){Alert.alert('同じ名前のフォルダがあります');return}
    const id='folder_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    setWorkspace(p=>({...p,folders:[...p.folders,{id,name:trimmed,parentId:p.folderId}],folderId:id}));
    setNewFolderOpen(false);setBoardPages([0,0,0,0]);
  }
  function deleteFolder(id:string){
    const f=workspace.folders.find(x=>x.id===id);if(!f)return;
    const linked=tasksRef.current.filter(t=>folderForTask(t)===id);
    Alert.alert('フォルダを削除',f.name+' を削除しますか？ 中のタスクと子フォルダは1つ上へ移動します。',[
      {text:'キャンセル',style:'cancel'},
      {text:'削除',style:'destructive',onPress:()=>{
        for(const task of linked)void updateTask({...task,folderId:f.parentId,group:f.parentId?folderGroup(workspace.folders,f.parentId):task.group});
        setWorkspace(p=>({...p,folderId:p.folderId===id?f.parentId:p.folderId,folders:p.folders.filter(x=>x.id!==id).map(x=>x.parentId===id?{...x,parentId:f.parentId}:x)}));
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
        await updateTask({...task,completed:true});
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

  function moveTask(id:string,q:number){const before=tasksRef.current.find(x=>x.id===id);if(!before)return;
    const after={...moveToQuadrant(before,q,prefsRef.current),...(prefs.mode==='group'?{folderId:['work','personal','study','other'][q]}:{})};
    if(quadrant(before,prefsRef.current)===q){
      const pinned=tasksRef.current.filter(t=>t.pinned&&quadrant(t,prefsRef.current)===q);
      const best=Math.min(0,...pinned.map(t=>t.manualOrder??0))-1;
      void updateTask({...before,pinned:true,manualOrder:best});
      toastMessage('最上位に固定しました');
    }else{void updateTask(after);toastMessage('エリアを移動しました')}
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    remember('移動しました',()=>{void updateTask(before)});
  }
  function boardDrop(id:string,absX:number,absY:number){
    boardRef.current?.measureInWindow((x,y,width,height)=>{
      if(absX<x||absX>x+width||absY<y||absY>y+height)return;
      const q=(absY-y<height/2?0:2)+(absX-x<width/2?0:1);
      moveTask(id,q);
    });
  }
  function topPin(id:string){const t=tasksRef.current.find(t=>t.id===id);if(!t)return;
    const order=Math.min(0,...tasksRef.current.filter(x=>x.pinned).map(x=>x.manualOrder??0))-1;
    void updateTask({...t,pinned:true,manualOrder:order});
    toastMessage('最上位に固定しました');
  }
  function scheduleTask(id:string,minutes:number){
    const t=tasksRef.current.find(x=>x.id===id);if(!t)return;
    const key=dateKey(puzzleDate);
    const result=canSchedule(tasksRef.current,key,minutes,t.durationMin,id);
    if(!result.ok){toastMessage(result.reason);void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);return;}
    const before={...t};
    const start=`${key}T${timeText(minutes)}`;
    void updateTask({...t,scheduledStart:start});setSelectedBlock(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    remember('予定を配置しました',()=>{void updateTask(before)});
    toastMessage('カチッ。予定を配置しました');
  }
  function puzzleDrop(id:string,x:number,y:number){
    const refs=[morningRef,afternoonRef];
    refs.forEach((ref,col)=>ref.current?.measureInWindow((left,top,width,height)=>{
      if(x<left||x>left+width||y<top||y>top+height)return;
      const row=Math.max(0,Math.min(11,Math.floor((y-top)/height*12)));
      scheduleTask(id,(col===0?8:14)*60+row*30);
    }));
  }
  async function changeNotificationEnabled(){
    if(prefs.remindersEnabled){await updatePreferences({...prefs,remindersEnabled:false});return}
    const granted=await requestLocalPermissions();
    if(!granted){Alert.alert('通知を有効にできません','端末の設定からkanriの通知を許可してください');return}
    await updatePreferences({...prefs,remindersEnabled:true});
  }
  const n=tasks.length,completed=tasks.filter(t=>t.completed).length,percentage=n?Math.round(completed/n*100):0;
  const top=sortTasks(tasks.filter(t=>!t.completed))[0];
  const folderPath:Folder[]=[];
  {let cursor=workspace.folders.find(f=>f.id===workspace.folderId),guard=0;
   while(cursor&&guard++<20){folderPath.unshift(cursor);cursor=workspace.folders.find(f=>f.id===cursor?.parentId)}}
  const childFolders=workspace.folders.filter(f=>f.parentId===workspace.folderId);

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
        const t=event.nativeEvent.changedTouches?.[0];if(!start||!t||editor||newFolderOpen)return;
        const dx=t.pageX-start.x,dy=t.pageY-start.y;
        if(Math.abs(dx)<95||Math.abs(dx)<Math.abs(dy)*1.5||Date.now()-start.time>175)return;
        const order:Tab[]=['board','calendar','puzzle','settings'];
        const next=order.indexOf(tab)+(dx<0?1:-1);
        if(next>=0&&next<order.length){selectTab(order[next]);void Haptics.selectionAsync()}
      }}>
      {tab==='board'&&<>
        <View style={styles.screenHead}><View><Text style={typeStyle(theme.ink,18,'800')}>FOUR FOCUS</Text></View><IconButton theme={theme} label="↕ 自動整理" onPress={()=>{setTasks(t=>[...t]);toastMessage('現在の優先順位を再計算しました')}}/></View>
        <View style={{flexDirection:'row',alignItems:'center',gap:5,minHeight:35}}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex:1,minWidth:0}} contentContainerStyle={{alignItems:'center',gap:5}}>
            <Pressable onPress={()=>selectFolder(null)} style={{paddingHorizontal:9,paddingVertical:8,backgroundColor:workspace.folderId===null?theme.tint:theme.card,borderColor:theme.line,borderWidth:1,borderRadius:10}}><Text style={typeStyle(theme.ink,11,'800')}>⌂ すべて</Text></Pressable>
            {folderPath.map(f=><React.Fragment key={f.id}><Text style={typeStyle(theme.muted,12)}>›</Text><Pressable onPress={()=>selectFolder(f.id)} style={{paddingHorizontal:9,paddingVertical:8,backgroundColor:f.id===workspace.folderId?theme.tint:theme.card,borderColor:theme.line,borderWidth:1,borderRadius:10}}><Text style={typeStyle(theme.ink,11,'800')}>{f.name}</Text></Pressable></React.Fragment>)}
          </ScrollView>
          <Pressable accessibilityLabel="フォルダを追加" onPress={()=>setNewFolderOpen(true)} style={{minWidth:44,minHeight:38,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:theme.tint}}><Text style={typeStyle(theme===DARK?'#EDF2FF':'#486EB2',22,'700')}>＋</Text></Pressable>
        </View>
        {childFolders.length>0&&<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0,marginBottom:4}} contentContainerStyle={{gap:6,paddingVertical:3}}>
          {childFolders.map(f=><Pressable key={f.id} onPress={()=>selectFolder(f.id)} onLongPress={()=>deleteFolder(f.id)} delayLongPress={480} accessibilityLabel={f.name+'を開く'} style={{minHeight:41,backgroundColor:theme.card,borderColor:theme.line,borderWidth:1,borderRadius:10,paddingHorizontal:13,flexDirection:'row',alignItems:'center',gap:6}}>
            <Text style={typeStyle('#D1A752',15)}>▰</Text><Text style={typeStyle(theme.ink,11,'800')}>{f.name}</Text>
          </Pressable>)}
        </ScrollView>}
        <View ref={boardRef} style={{flex:1,minHeight:0}}><View style={styles.board}>
          {[0,1,2,3].map(q=>{
            const items=sortTasks(tasks.filter(t=>!t.completed&&quadrant(t,prefs)===q&&(workspace.folderId===null||folderForTask(t)===workspace.folderId)));
            const pageSize=winHeight>=820?4:winHeight>=690?3:2;const count=Math.max(1,Math.ceil(items.length/pageSize));const page=Math.min(boardPages[q],count-1);
            return <View key={q} style={[styles.quad,winHeight<720&&{padding:7},{backgroundColor:theme.card,borderColor:theme.line,padding:winHeight>=740?12:8}]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${prefs.names[q]}にタスクを追加`} onPress={()=>addInQuadrant(q)} style={styles.quadHead}><Text style={typeStyle(theme.ink,11,'800')} numberOfLines={1}>{prefs.names[q]}</Text><Text style={typeStyle(theme.muted,10,'800')}>{pad(items.length)}</Text></Pressable>
              <View style={{height:3,width:21,borderRadius:2,backgroundColor:COLORS[q],marginTop:5}}/>
              <View style={{flex:1,minHeight:0,justifyContent:'flex-start',gap:7,marginTop:9}}>
                <Pressable onPress={()=>addInQuadrant(q)} accessibilityLabel={`${prefs.names[q]}に新しいタスクを追加`} style={StyleSheet.absoluteFill}/>
                {items.slice(page*pageSize,page*pageSize+pageSize).map(t=><DragTask key={t.id} task={t} theme={theme} onDrop={boardDrop} onOpen={()=>setEditor(t)} onComplete={()=>{void updateTask({...t,completed:true});void Haptics.selectionAsync();remember('完了しました',()=>{void updateTask(t)})}} onPin={()=>topPin(t.id)}/>)}
                {!items.length&&<Pressable onPress={()=>addInQuadrant(q)} style={{flex:1,justifyContent:'center',alignItems:'center'}}><Text style={typeStyle(theme.muted,10)}>＋</Text></Pressable>}
              </View>
              <View style={styles.pager}><Pressable disabled={!page} onPress={()=>setBoardPages(old=>old.map((v,i)=>i===q?v-1:v))}><Text style={typeStyle(theme.muted,16)}>‹</Text></Pressable><Text style={typeStyle(theme.muted,9)}>{page+1}/{count}</Text><Pressable disabled={page>=count-1} onPress={()=>setBoardPages(old=>old.map((v,i)=>i===q?v+1:v))}><Text style={typeStyle(theme.muted,16)}>›</Text></Pressable></View>
            </View>;
          })}
        </View></View>
        {tasks.some(t=>t.pinned)&&<View style={styles.bottomHint}><View/><Pressable onPress={()=>{tasks.forEach(t=>{if(t.pinned)void updateTask({...t,pinned:false,manualOrder:null})});toastMessage('自動順位に戻しました')}}><Text style={typeStyle('#5578BB',11,'800')}>固定を解除 ↺</Text></Pressable></View>}
      </>}
      {tab==='calendar'&&<>
        <View style={styles.screenHead}><Text style={typeStyle(theme.ink,18,'800')}>SCHEDULE</Text><View style={[styles.seg,{backgroundColor:theme.line}]}>{(['month','week','gantt'] as Mode[]).map((m,i)=><Pressable key={m} onPress={()=>{setCalMode(m);setGanttPage(0)}} style={[styles.segItem,calMode===m&&{backgroundColor:theme.card}]}><Text style={typeStyle(calMode===m?theme.ink:theme.muted,11,'700')}>{['月','週','ガント'][i]}</Text></Pressable>)}</View></View>
        <CalendarPanel theme={theme} mode={calMode} focus={focus} setFocus={setFocus} tasks={tasks} prefs={prefs} ganttPage={ganttPage} setGanttPage={setGanttPage} onOpen={setEditor} onGanttStart={(task,date)=>{const before={...task};void updateTask({...task,ganttStart:date});void Haptics.selectionAsync();remember('ガント開始日を設定しました',()=>{void updateTask(before)});}}/>
      </>}
      {tab==='puzzle'&&<>
        <View style={styles.screenHead}><View><Text style={typeStyle(theme.ink,18,'800')}>TIME PUZZLE</Text></View><IconButton label="↶ 戻す" theme={theme} onPress={undoAction}/></View>
        <View style={{flex:1,minHeight:0}}><View style={[styles.puzzleInbox,{backgroundColor:theme.navy}]}>
          <View style={styles.flexBetween}><Text style={typeStyle('#F3F7FF',11,'800')}>UNPLACED TASKS</Text><Text style={typeStyle('#A3B5D0',10)}>{tasks.filter(t=>!t.completed&&!t.scheduledStart).length} 待機中</Text></View>
          <View style={{flexDirection:'row',gap:7,marginTop:8,minHeight:70,alignItems:'flex-start'}}> 
            {sortTasks(tasks.filter(t=>!t.completed&&!t.scheduledStart)).slice(inboxPage*2,inboxPage*2+2).map(t=><PuzzleTile key={t.id} task={t} selected={selectedBlock===t.id} onSelect={()=>setSelectedBlock(t.id)} onDrop={puzzleDrop}/>)}
            {!tasks.some(t=>!t.completed&&!t.scheduledStart)&&<Text style={typeStyle('#AAB9D0',11)}>すべて配置済みです</Text>}
          </View>
          <View style={[styles.pager,{marginTop:2}]}><Pressable onPress={()=>setInboxPage(n=>Math.max(0,n-1))}><Text style={typeStyle('#B7C6DB',16)}>‹</Text></Pressable><Text style={typeStyle('#B7C6DB',9)}>{inboxPage+1}/{Math.max(1,Math.ceil(tasks.filter(t=>!t.completed&&!t.scheduledStart).length/2))}</Text><Pressable onPress={()=>setInboxPage(n=>Math.min(Math.max(0,Math.ceil(tasks.filter(t=>!t.completed&&!t.scheduledStart).length/2)-1),n+1))}><Text style={typeStyle('#B7C6DB',16)}>›</Text></Pressable></View>
        </View>
          <View style={[styles.dateNav,{height:43}]}><Pressable onPress={()=>setPuzzleDate(d=>addDays(d,-1))}><Text style={typeStyle('#5578BB',11,'800')}>‹ 前日</Text></Pressable><Text style={typeStyle(theme.ink,12,'800')}>{puzzleDate.getMonth()+1}月{puzzleDate.getDate()}日 {'日月火水木金土'[puzzleDate.getDay()]}曜日</Text><Pressable onPress={()=>setPuzzleDate(d=>addDays(d,1))}><Text style={typeStyle('#5578BB',11,'800')}>翌日 ›</Text></Pressable></View>
          <View style={{flex:1,flexDirection:'row',gap:8,minHeight:0}}>
            {[0,1].map((col)=>{
              const ref=col===0?morningRef:afternoonRef;const base=col===0?8*60:14*60;
              return <View key={col} ref={ref} onLayout={event=>{const h=event.nativeEvent.layout.height;if(h>0&&Math.abs(h-panelHeight)>1)setPanelHeight(h)}} style={[styles.timePanel,{backgroundColor:theme.card,borderColor:theme.line}]}>
                {Array.from({length:12},(_,row)=>{
                  const minute=base+row*30;
                  return <Pressable key={minute} onPress={()=>selectedBlock?scheduleTask(selectedBlock,minute):toastMessage('先にタスクを選んでください')} style={[styles.timeSlot,{borderTopColor:theme.line}]}><Text style={[styles.timeLabel,{color:theme.muted}]}>{timeText(minute)}</Text></Pressable>;
                })}
                {tasks.filter(t=>!t.completed&&t.scheduledStart?.startsWith(dateKey(puzzleDate))&&parseScheduleMinutes(t.scheduledStart)>=base&&parseScheduleMinutes(t.scheduledStart)<base+360).map(t=>{
                  const minute=parseScheduleMinutes(t.scheduledStart!);
                  const top=(minute-base)/360*(panelHeight-12);
                  const high=t.durationMin/360*(panelHeight-12);
                  return <Animated.View entering={FadeInDown.springify().damping(18)} key={t.id} style={[styles.scheduledBar,{top:5+top,height:Math.min(high,panelHeight-top-10),backgroundColor:COLORS[quadrant(t,prefs)]}]}><Pressable style={{flex:1,justifyContent:'center'}} onPress={()=>{
                      const old={...t};void updateTask({...t,scheduledStart:null});remember('配置を解除しました',()=>{void updateTask(old)});
                    }}><Text numberOfLines={1} style={typeStyle('#FFFFFF',10,'800')}>{t.title}</Text><Text numberOfLines={1} style={typeStyle('#EEF4FF',8)}>{timeText(minute)}–{timeText(minute+t.durationMin)}</Text></Pressable></Animated.View>;
                })}
              </View>;
            })}
          </View>
          <View style={styles.bottomHint}><Text style={typeStyle(theme.muted,10)}>選択→枠をタップ ／ ドラッグ</Text><Pressable onPress={()=>{
            const onDay=tasks.filter(t=>!t.completed&&t.scheduledStart?.slice(0,10)===dateKey(puzzleDate));
            if(!onDay.length){toastMessage('配置済みの予定はありません');return}
            const backup=onDay.map(t=>({...t}));onDay.forEach(t=>void updateTask({...t,scheduledStart:null}));
            remember('この日の配置を解除しました',()=>backup.forEach(t=>void updateTask(t)));
          }}><Text style={typeStyle('#5578BB',11,'800')}>予定を外す</Text></Pressable></View>
        </View>
      </>}
      {tab==='settings'&&<SettingsPanel theme={theme} prefs={prefs} tasks={tasks} onMode={mode=>{void updatePreferences({...prefs,mode,names:(mode==='group'?[...GROUPS]:[...DEFAULT_PREFS.names]) as Preferences['names']})}} onRename={()=>setRenaming(true)} onDark={()=>void updatePreferences({...prefs,dark:!prefs.dark})} onReminder={()=>void changeNotificationEnabled()} onLeadEdit={()=>setLeadEditor(true)} onStart={()=>void updatePreferences({...prefs,startReminder:!prefs.startReminder})}/>}
    </View>
    <View style={[styles.nav,{backgroundColor:theme.navy,paddingBottom:insets.bottom,height:59+insets.bottom}]}>
      {([['board','▦','FOCUS'],['calendar','▤','PLAN'],['add','+',''],['puzzle','▧','PUZZLE'],['settings','☷','SETUP']] as const).map(([id,icon,label])=>id==='add'?<Pressable accessibilityLabel="タスクを追加" key="add" onPress={()=>{setNewQuadrant(null);setEditor('new')}} style={styles.navButton}><View style={styles.navAdd}><Text style={typeStyle('#FFFFFF',30,'400')}>+</Text></View></Pressable>:<Pressable key={id} onPress={()=>selectTab(id)} style={styles.navButton}><Text style={typeStyle(tab===id?'#FFFFFF':'#9BA9C0',24,'400')}>{icon}</Text><Text style={typeStyle(tab===id?'#FFFFFF':'#9BA9C0',9,'700')}>{label}</Text></Pressable>)}
    </View>
    {undo&&<View style={[styles.undo,{bottom:insets.bottom+78}]}><Text style={typeStyle('#FFFFFF',11)}>{undo.label}</Text><Pressable onPress={undoAction}><Text style={typeStyle('#B4D0FF',11,'800')}>元に戻す</Text></Pressable></View>}
    {!!toast&&<Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(140)} style={[styles.toast,{top:insets.top+149}]}><Text style={typeStyle('#FFFFFF',11)}>{toast}</Text></Animated.View>}
    {newFolderOpen&&<FolderSheet theme={theme} insetTop={insets.top} parentName={folderPath.map(f=>f.name).join(' / ')||'すべて'} onClose={()=>setNewFolderOpen(false)} onCreate={createFolder}/>}{editor&&<TaskEditor key={editor==='new'?'new':editor.id} entry={editor} initialQuadrant={newQuadrant} prefs={prefs} folders={workspace.folders} initialFolderId={workspace.folderId} theme={theme} insetTop={insets.top} height={winHeight} onClose={()=>{Keyboard.dismiss();setEditor(null)}} onSave={data=>{Keyboard.dismiss();setEditor(null);void updateTask(data);void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);toastMessage('保存しました')}} onDelete={t=>{Keyboard.dismiss();setEditor(null);void removeTask(t);remember('タスクを削除しました',()=>{void updateTask(t,null)})}}/>}
    {leadEditor&&<LeadTimeSheet theme={theme} insetTop={insets.top} current={prefs.leadMinutes} onClose={()=>{Keyboard.dismiss();setLeadEditor(false)}} onSave={minutes=>{Keyboard.dismiss();setLeadEditor(false);void updatePreferences({...prefs,leadMinutes:minutes})}}/>}
    {renaming&&<RenameSheet prefs={prefs} theme={theme} insetTop={insets.top} onClose={()=>setRenaming(false)} onSave={names=>{setRenaming(false);void updatePreferences({...prefs,names})}}/>}
  </View>;
}
function DragTask({task,theme,onDrop,onOpen,onComplete,onPin}:{task:Task,theme:Theme,onDrop:(id:string,x:number,y:number)=>void,onOpen:()=>void,onComplete:()=>void,onPin:()=>void}){
  const dx=useSharedValue(0),dy=useSharedValue(0);
  const gesture=useMemo(()=>Gesture.Pan().activateAfterLongPress(180).onUpdate(e=>{dx.value=e.translationX;dy.value=e.translationY}).onEnd(e=>{scheduleOnRN(onDrop,task.id,e.absoluteX,e.absoluteY);dx.value=withSpring(0);dy.value=withSpring(0)}).onFinalize(()=>{dx.value=withSpring(0);dy.value=withSpring(0)}),[task.id,onDrop]);
  const motion=useAnimatedStyle(()=>({transform:[{translateX:dx.value},{translateY:dy.value}],zIndex:dx.value||dy.value?8:0}));
  return <GestureDetector gesture={gesture}><Animated.View style={[styles.taskTile,{backgroundColor:theme.bg,borderColor:theme.line},motion]}>
    <View style={{flexDirection:'row',gap:6,alignItems:'flex-start'}}><Pressable accessibilityLabel="タスクを完了" onPress={onComplete} style={[styles.check,{borderColor:theme.muted}]}/><Pressable style={{flex:1}} onPress={onOpen}><Text numberOfLines={2} style={typeStyle(theme.ink,11,'700')}>{task.title}</Text></Pressable><Pressable accessibilityLabel="最上位に固定" onPress={onPin}><Text style={typeStyle(task.pinned?'#C7A876':theme.muted,11)}>{task.pinned?'◆':'◇'}</Text></Pressable></View>
    <Pressable style={{marginLeft:20,marginTop:5}} onPress={onOpen}><Text numberOfLines={1} style={typeStyle(theme.muted,9)}>{dueLabel(task.dueDate)} · {task.durationMin}分 · {priorityScore(task)}pt</Text></Pressable>
  </Animated.View></GestureDetector>;
}
function PuzzleTile({task,selected,onSelect,onDrop}:{task:Task,selected:boolean,onSelect:()=>void,onDrop:(id:string,x:number,y:number)=>void}){
  const x=useSharedValue(0),y=useSharedValue(0);
  const gesture=useMemo(()=>Gesture.Pan().minDistance(8).onUpdate(e=>{x.value=e.translationX;y.value=e.translationY}).onEnd(e=>{scheduleOnRN(onDrop,task.id,e.absoluteX,e.absoluteY);x.value=withSpring(0);y.value=withSpring(0)}).onFinalize(()=>{x.value=withSpring(0);y.value=withSpring(0)}),[task.id,onDrop]);
  const animated=useAnimatedStyle(()=>({transform:[{translateX:x.value},{translateY:y.value}],zIndex:10}));
  return <GestureDetector gesture={gesture}><Animated.View style={[styles.puzzleTile,{height:45+Math.round(Math.min(task.durationMin,180)/180*24)},selected&&{borderColor:'#C7DBFF',borderWidth:2},animated]}><Pressable onPress={onSelect} style={{flex:1,justifyContent:'center'}}><Text numberOfLines={1} style={typeStyle('#FFFFFF',11,'700')}>{task.title}</Text><Text style={typeStyle('#C0CCDF',9)}>{task.durationMin}分 · {dueLabel(task.dueDate)}</Text></Pressable></Animated.View></GestureDetector>;
}
function CalendarPanel({theme,mode,focus,setFocus,tasks,prefs,ganttPage,setGanttPage,onOpen,onGanttStart}:{theme:Theme,mode:Mode,focus:Date,setFocus:(date:Date)=>void,tasks:Task[],prefs:Preferences,ganttPage:number,setGanttPage:(n:number)=>void,onOpen:(task:Task)=>void,onGanttStart:(task:Task,date:string)=>void}){
  const first=new Date(focus.getFullYear(),focus.getMonth(),1);
  const weekStart=addDays(focus,-focus.getDay());
  const title=mode==='gantt'?`${focus.getFullYear()}年 ${focus.getMonth()+1}月`:mode==='month'?`${focus.getFullYear()}年 ${focus.getMonth()+1}月`:mode==='week'?`${weekStart.getMonth()+1}/${weekStart.getDate()} – ${addDays(weekStart,6).getMonth()+1}/${addDays(weekStart,6).getDate()}`:`${focus.getMonth()+1}/${focus.getDate()}から7日間`;
  const selectedDate=dateKey(focus);
  const agenda=sortTasks(tasks.filter(t=>!t.completed&&(t.dueDate===selectedDate||t.scheduledStart?.slice(0,10)===selectedDate))).slice(0,3);
  const ganttItems=sortTasks(tasks.filter(t=>!t.completed));
  const daysInMonth=new Date(focus.getFullYear(),focus.getMonth()+1,0).getDate();
  const [ganttHeight,setGanttHeight]=useState(540);
  const ganttRows=Math.max(6,Math.min(18,Math.floor((ganttHeight-100)/44)));
  const ganttRowHeight=Math.max(30,(ganttHeight-100)/ganttRows);
  const ganttVisible=ganttItems.slice(ganttPage*ganttRows,(ganttPage+1)*ganttRows);
  const ganttBlankCount=Math.max(0,ganttRows-ganttVisible.length);
  return <View style={{flex:1,minHeight:0}}>
    <View style={[styles.dateNav,{minHeight:47}]}><Pressable onPress={()=>setFocus(mode==='week'?addDays(focus,-7):new Date(focus.getFullYear(),focus.getMonth()-1,Math.min(28,focus.getDate())))}><Text style={typeStyle(theme.ink,21)}>‹</Text></Pressable><Text style={typeStyle(theme.ink,15,'800')}>{title}</Text><Pressable onPress={()=>setFocus(mode==='week'?addDays(focus,7):new Date(focus.getFullYear(),focus.getMonth()+1,Math.min(28,focus.getDate())))}><Text style={typeStyle(theme.ink,21)}>›</Text></Pressable></View>
    {mode==='month'&&<View style={[styles.monthBox,{backgroundColor:theme.card,borderColor:theme.line,flex:1,minHeight:0}]}>
      <View style={styles.weekHeading}>{'日月火水木金土'.split('').map((x,i)=><Text key={i} style={[styles.weekLabel,{color:theme.muted}]}>{x}</Text>)}</View>
      <View style={{flexDirection:'row',flexWrap:'wrap',flex:1,minHeight:0}}>{Array.from({length:42},(_,i)=>{
        const day=addDays(first,-first.getDay()+i),key=dateKey(day);const marked=tasks.some(t=>!t.completed&&(t.dueDate===key||t.scheduledStart?.slice(0,10)===key));const active=key===selectedDate;
        return <Pressable key={key} onPress={()=>setFocus(day)} style={[styles.monthDay,{backgroundColor:active?'#5879B5':key===dateKey(new Date())?theme.tint:'transparent',opacity:day.getMonth()===focus.getMonth()?1:.3}]}><Text style={typeStyle(active?'#FFFFFF':theme.ink,11,'700')}>{day.getDate()}</Text><View style={{height:4,width:4,borderRadius:3,backgroundColor:marked?(active?'#FFFFFF':'#6C9F93'):'transparent'}}/></Pressable>;
      })}</View>
    </View>}
    {mode==='week'&&<View style={{flexDirection:'row',gap:4,paddingVertical:8}}>{Array.from({length:7},(_,i)=>{const day=addDays(weekStart,i),key=dateKey(day),count=tasks.filter(t=>t.dueDate===key||t.scheduledStart?.slice(0,10)===key).length;return <Pressable key={i} onPress={()=>setFocus(day)} style={[styles.weekTile,{backgroundColor:key===selectedDate?theme.tint:theme.card,borderColor:key===selectedDate?'#8AABD9':theme.line}]}><Text style={typeStyle(theme.muted,9)}>{'日月火水木金土'[day.getDay()]}</Text><Text style={typeStyle(theme.ink,17,'800')}>{day.getDate()}</Text><Text style={typeStyle('#5879B5',9,'700')}>{count}件</Text></Pressable>})}</View>}
    {mode==='gantt'?<View onLayout={event=>{const next=event.nativeEvent.layout.height;if(next>150&&Math.abs(next-ganttHeight)>1)setGanttHeight(next)}} style={[styles.ganttBox,{backgroundColor:theme.card,borderColor:theme.line,padding:9}]}>
      <View style={{flexDirection:'row',alignSelf:'stretch',borderWidth:1,borderColor:theme.line,borderRadius:9,overflow:'hidden'}}>
        <View style={{width:104,flexShrink:0,backgroundColor:theme.card,zIndex:2}}>
          <View style={{height:46,justifyContent:'center',paddingLeft:7,backgroundColor:theme.tint,borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line}}>
            <Text style={typeStyle(theme.ink,10,'800')}>タスク / LT</Text>
          </View>
          {ganttVisible.map(t=><Pressable key={t.id} onPress={()=>onOpen(t)} style={{height:ganttRowHeight,paddingHorizontal:7,justifyContent:'center',borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line}}>
            <Text numberOfLines={1} style={typeStyle(theme.ink,11,'800')}>{t.title}</Text>
            <Text style={typeStyle(theme.muted,9)}>LT {t.leadDays||1}日</Text>
          </Pressable>)}
          {Array.from({length:ganttBlankCount},(_,i)=><View key={'blank-name-'+i} style={{height:ganttRowHeight,backgroundColor:theme.card,borderBottomWidth:1,borderRightWidth:1,borderColor:theme.line}}/>)}
        </View>
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={true} bounces={false} keyboardShouldPersistTaps="always" style={{flex:1,minWidth:0}}>
          <View style={{width:daysInMonth*36}}>
            <View style={{flexDirection:'row',height:46,backgroundColor:theme.tint}}>
              {Array.from({length:daysInMonth},(_,i)=>{
                const d=new Date(focus.getFullYear(),focus.getMonth(),i+1);
                const weekend=d.getDay()===0||d.getDay()===6;
                return <View key={i} style={{width:36,height:46,alignItems:'center',justifyContent:'center',gap:3,borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line,backgroundColor:weekend?theme.bg:theme.tint}}>
                  <Text style={typeStyle(theme.ink,12,'800')}>{i+1}</Text><Text style={typeStyle(theme.muted,9)}>{'日月火水木金土'[d.getDay()]}</Text>
                </View>
              })}
            </View>
            {ganttVisible.map(t=>{
              const lt=Math.max(1,Math.min(90,t.leadDays||1));
              const fallbackDue=t.dueDate?parseDateKey(t.dueDate):null;
              const start=t.ganttStart||t.scheduledStart?.slice(0,10)||(fallbackDue?dateKey(addDays(fallbackDue,1-lt)):null);
              const startDate=start?parseDateKey(start):null;
              return <View key={t.id} style={{flexDirection:'row',height:ganttRowHeight}}>
                {Array.from({length:daysInMonth},(_,i)=>{
                  const day=new Date(focus.getFullYear(),focus.getMonth(),i+1);
                  const key=dateKey(day);
                  const duration=startDate?Math.round((day.getTime()-startDate.getTime())/86400000):-999;
                  const filled=duration>=0&&duration<lt;
                  const isWeekend=day.getDay()===0||day.getDay()===6;
                  return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${t.title} ${key} を開始日にする`} onPress={()=>onGanttStart(t,key)} style={{width:36,height:ganttRowHeight,backgroundColor:filled?COLORS[quadrant(t,prefs)]:isWeekend?theme.bg:theme.card,borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line,alignItems:'flex-end',justifyContent:'flex-start'}}>
                    {key===t.ganttStart&&<View style={{position:'absolute',top:0,bottom:0,left:0,right:0,borderWidth:2,borderColor:theme.navy}}/>}
                    {key===t.dueDate&&<View style={{width:5,height:5,borderRadius:3,backgroundColor:'#C78086',margin:2}}/>}
                  </Pressable>;
                })}
              </View>
            })}
            {Array.from({length:ganttBlankCount},(_,i)=><View key={'blank-grid-'+i} style={{flexDirection:'row',height:ganttRowHeight}}>
              {Array.from({length:daysInMonth},(_,j)=>{const day=new Date(focus.getFullYear(),focus.getMonth(),j+1);const weekend=day.getDay()===0||day.getDay()===6;return <View key={j} style={{width:36,height:ganttRowHeight,borderRightWidth:1,borderBottomWidth:1,borderColor:theme.line,backgroundColor:weekend?theme.bg:theme.card}}/>;})}
            </View>)}
          </View>
        </ScrollView>
      </View>
      <View style={[styles.pager,{marginTop:11}]}>
        <Pressable onPress={()=>setGanttPage(Math.max(0,ganttPage-1))} hitSlop={10}><Text style={typeStyle(theme.muted,18)}>‹</Text></Pressable>
        <Text style={typeStyle(theme.muted,10)}>{ganttPage+1}/{Math.max(1,Math.ceil(ganttItems.length/ganttRows))}</Text>
        <Pressable onPress={()=>setGanttPage(Math.min(Math.max(0,Math.ceil(ganttItems.length/ganttRows)-1),ganttPage+1))} hitSlop={10}><Text style={typeStyle(theme.muted,18)}>›</Text></Pressable>
      </View>
    </View>:<View style={{flex:mode==='month'?0:1,minHeight:0,marginTop:mode==='month'?5:8}}><View style={styles.flexBetween}><Text style={typeStyle(theme.ink,12,'800')}>{focus.getMonth()+1}/{focus.getDate()} の予定</Text><Text style={typeStyle(theme.muted,10)}>{agenda.length}件表示</Text></View>
      <View style={{gap:7,marginTop:9,flex:1,minHeight:0}}>{agenda.length?agenda.map(t=><Pressable key={t.id} onPress={()=>onOpen(t)} style={[styles.agendaItem,{backgroundColor:theme.card,borderColor:theme.line}]}><View style={{height:28,width:3,borderRadius:2,backgroundColor:COLORS[quadrant(t,prefs)]}}/><View style={{flex:1}}><Text numberOfLines={1} style={typeStyle(theme.ink,12,'800')}>{t.title}</Text><Text numberOfLines={1} style={typeStyle(theme.muted,10)}>{t.scheduledStart?.slice(11,16)??'未配置'} · {t.durationMin}分 · {dueLabel(t.dueDate)}</Text></View><Text style={typeStyle(theme.muted,17)}>›</Text></Pressable>):<View style={{flex:1,alignItems:'center',justifyContent:'center'}}><Text style={typeStyle(theme.muted,11)}>予定なし</Text></View>}</View>
    </View>}
  </View>;
}
function SettingsPanel({theme,prefs,tasks,onMode,onRename,onDark,onReminder,onLeadEdit,onStart}:{theme:Theme,prefs:Preferences,tasks:Task[],onMode:(m:'priority'|'group')=>void,onRename:()=>void,onDark:()=>void,onReminder:()=>void,onLeadEdit:()=>void,onStart:()=>void}){
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
    <View style={[styles.statsBox,{backgroundColor:theme.navy}]}><Text style={typeStyle('#FFFFFF',25,'800')}>{tasks.filter(t=>t.completed).length} <Text style={typeStyle('#B8C9E1',12)}>/ {tasks.length} タスク完了</Text></Text><Text style={[typeStyle('#C3CFE1',11),{marginTop:7}]}></Text></View>
    <Text style={[typeStyle(theme.muted,10),{marginTop:12}]}>データは端末内のSQLiteに保存されます。ログイン不要・オフライン対応。</Text>
  </View>;
}
function SettingRow({theme,title,value,onPress,last=false}:{theme:Theme,title:string,value:string,onPress:()=>void,last?:boolean}){
  return <Pressable onPress={onPress} style={[styles.settingRow,!last&&{borderBottomWidth:1,borderColor:theme.line}]}><Text style={typeStyle(theme.ink,12,'700')}>{title}</Text><Text style={typeStyle(theme===DARK?'#CEE0FF':'#5979B5',11,'800')}>{value}</Text></Pressable>;
}
function TaskEditor({entry,initialQuadrant,prefs,theme,insetTop,height,onClose,onSave,onDelete}:{entry:Task|'new',initialQuadrant:number|null,prefs:Preferences,theme:Theme,insetTop:number,height:number,onClose:()=>void,onSave:(item:Task)=>void,onDelete:(task:Task)=>void}){
  const original=entry==='new'?null:entry;
  const [title,setTitle]=useState(original?.title??'');const [important,setImportant]=useState(original?.important??(initialQuadrant===null?true:initialQuadrant<=1));const [urgent,setUrgent]=useState(original?.urgent??(initialQuadrant===null?false:initialQuadrant===0||initialQuadrant===2));
  const [group,setGroup]=useState<Group>(original?.group??(initialQuadrant===null?'プライベート':GROUPS[initialQuadrant]));
  const [duration,setDuration]=useState(original?.durationMin??60);const [leadDays,setLeadDays]=useState(String(original?.leadDays??1));
  const [date,setDate]=useState(original?.dueDate??dateKey(addDays(new Date(),1)));
  const [pin,setPin]=useState(original?.pinned??false);
  function commit(){const text=title.trim();if(!text){Alert.alert('タスク名を入力してください');return}if(date.trim()&&!parseDateKey(date.trim())){Alert.alert('日付の形式が正しくありません','YYYY-MM-DD で入力してください');return}if(!/^\d+$/.test(leadDays)||+leadDays<1||+leadDays>90){Alert.alert('LT日数は1〜90日で指定してください');return}
    const item=original?{...original}:{...createTask(text,date.trim()||null,duration,important,urgent,group)};
    Object.assign(item,{title:text,important,urgent,group,durationMin:duration,leadDays:+leadDays,dueDate:date.trim()||null,pinned:pin,manualOrder:pin?(item.manualOrder??-1):null});
    onSave(item);
  }
  return <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onClose}/><Animated.View entering={FadeInDown.springify().damping(19)} style={[styles.editorSheet,{top:insetTop+12,maxHeight:height-insetTop-35,backgroundColor:theme.card}]}>
      <View style={styles.flexBetween}><View style={{flexDirection:'row',alignItems:'center',gap:10,flexShrink:1}}><Pressable onPress={onClose} accessibilityRole='button' accessibilityLabel='保存せず戻る' hitSlop={8} style={{minWidth:44,minHeight:44,borderRadius:12,borderWidth:1,borderColor:theme.line,backgroundColor:theme.bg,justifyContent:'center',alignItems:'center'}}><Text style={typeStyle(theme.ink,25,'500')}>×</Text></Pressable><Text style={typeStyle(theme.ink,16,'800')}>{original?'タスクを編集':'タスクを追加'}</Text></View><Pressable onPress={commit} hitSlop={8}><Text style={typeStyle('#5879B5',12,'800')}>保存 ✓</Text></Pressable></View>
      <Text style={[styles.formLabel,{color:theme.muted}]}>TASK NAME</Text><TextInput value={title} onChangeText={setTitle} maxLength={70} placeholder="何をする？" placeholderTextColor={theme.muted} autoCorrect={false} style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
      <Text style={[styles.formLabel,{color:theme.muted}]}>重要度・緊急度</Text><View style={styles.formChoices}><Chip theme={theme} title="◆ 重要" selected={important} onPress={()=>setImportant(!important)}/><Chip theme={theme} title="⚡ 緊急" selected={urgent} onPress={()=>setUrgent(!urgent)}/></View>
      <Text style={[styles.formLabel,{color:theme.muted}]}>GROUP</Text><View style={styles.formChoices}>{GROUPS.map(g=><Chip key={g} title={g} theme={theme} selected={group===g} onPress={()=>setGroup(g)}/>)}</View>
      <Text style={[styles.formLabel,{color:theme.muted}]}>所要時間</Text><View style={styles.formChoices}>{[30,60,90,120,180].map(n=><Chip key={n} theme={theme} title={`${n}分`} selected={n===duration} onPress={()=>setDuration(n)}/>)}</View>
      <Text style={[styles.formLabel,{color:theme.muted}]}>ガントチャート LT（日数・1〜90）</Text><TextInput value={leadDays} onChangeText={setLeadDays} keyboardType="number-pad" style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
      <Text style={[styles.formLabel,{color:theme.muted}]}>納期（YYYY-MM-DD）</Text><TextInput value={date} onChangeText={setDate} placeholder="2026-10-20" keyboardType="numbers-and-punctuation" autoCorrect={false} placeholderTextColor={theme.muted} style={[styles.input,{backgroundColor:theme.bg,color:theme.ink,borderColor:theme.line}]}/>
      <Text style={[styles.formLabel,{color:theme.muted}]}>MANUAL ORDER</Text><View style={styles.formChoices}><Chip theme={theme} title="◆ 手動順位を固定" selected={pin} onPress={()=>setPin(!pin)}/><Chip theme={theme} title="自動に戻す" selected={!pin} onPress={()=>setPin(false)}/></View>
      <View style={{flexDirection:'row',gap:12,marginTop:8,alignItems:'center'}}>{original&&<Pressable onPress={()=>Alert.alert('タスクを削除','このタスクを削除しますか？',[{text:'キャンセル',style:'cancel'},{text:'削除',style:'destructive',onPress:()=>onDelete(original)}])}><Text style={typeStyle('#C98087',12,'700')}>削除</Text></Pressable>}<Pressable onPress={onClose} accessibilityRole='button' accessibilityLabel='キャンセルして戻る' style={{minHeight:44,paddingHorizontal:13,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:theme.line,borderRadius:13,backgroundColor:theme.bg}}><Text style={typeStyle(theme.ink,12,'800')}>キャンセル</Text></Pressable><Pressable onPress={commit} style={[styles.primaryButton,{backgroundColor:theme.navy,minHeight:44}]}><Text style={typeStyle('#FFFFFF',12,'800')}>{original?'変更を保存':'タスクを作成'}</Text></Pressable></View>
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
  root:{flex:1,minHeight:0},top:{paddingHorizontal:11,paddingTop:5,paddingBottom:2},brandRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},brand:{fontSize:26,fontWeight:'800',letterSpacing:-1.4},eyebrow:{fontSize:10,fontWeight:'800',letterSpacing:2.1,marginTop:-1},quick:{height:44,minWidth:44,borderRadius:11,borderWidth:1,alignItems:'center',justifyContent:'center'},hero:{minHeight:83,borderRadius:19,marginTop:12,paddingHorizontal:17,paddingVertical:12,flexDirection:'row',alignItems:'center'},heroEyebrow:{fontSize:10,letterSpacing:1.6,color:'#94A9C5',fontWeight:'800'},heroTitle:{fontSize:17,fontWeight:'800',color:'#FFFFFF',marginTop:5},heroSub:{fontSize:10,color:'#BEC8D9',marginTop:5},percentCircle:{width:55,height:55,borderRadius:30,borderWidth:5,alignItems:'center',justifyContent:'center'},content:{flex:1,minHeight:0,paddingHorizontal:8,paddingTop:0,paddingBottom:2},screenHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:37},iconButton:{borderWidth:1,borderRadius:12,minWidth:44,minHeight:38,paddingHorizontal:9,alignItems:'center',justifyContent:'center'},board:{flex:1,minHeight:0,flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',alignContent:'space-between',marginTop:3},quad:{width:'49.2%',height:'49.5%',borderRadius:15,padding:7,borderWidth:1,minHeight:0},quadHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:5},taskTile:{borderRadius:10,borderWidth:1,padding:7,minHeight:48},check:{width:16,height:16,borderRadius:8,borderWidth:1.6},pager:{height:22,flexDirection:'row',justifyContent:'flex-end',alignItems:'center',gap:10},bottomHint:{height:24,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},nav:{flexDirection:'row',borderTopLeftRadius:16,borderTopRightRadius:16,overflow:'visible'},navButton:{flex:1,alignItems:'center',justifyContent:'center',gap:2},navAdd:{width:46,height:46,backgroundColor:'#7698D5',borderRadius:17,alignItems:'center',justifyContent:'center',transform:[{translateY:-5}]},seg:{flexDirection:'row',gap:3,padding:3,borderRadius:12},segItem:{minWidth:37,paddingHorizontal:7,paddingVertical:7,borderRadius:9,alignItems:'center'},dateNav:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:4},monthBox:{borderRadius:14,borderWidth:1,paddingHorizontal:5,paddingVertical:6},weekHeading:{flexDirection:'row',marginBottom:3},weekLabel:{width:'14.2857%',textAlign:'center',fontSize:10,fontWeight:'800'},monthDay:{width:'14.2857%',height:'16.6667%',justifyContent:'center',alignItems:'center',borderRadius:8,gap:2},weekTile:{flex:1,borderRadius:10,borderWidth:1,minHeight:76,alignItems:'center',justifyContent:'space-evenly'},agendaItem:{minHeight:46,borderWidth:1,borderRadius:11,padding:7,flexDirection:'row',gap:11,alignItems:'center'},ganttBox:{flex:1,minHeight:0,borderRadius:17,borderWidth:1,padding:11},ganttMonthRow:{flexDirection:'row',alignItems:'center',gap:4},ganttDays:{flex:1,flexDirection:'row',alignItems:'center',gap:1,minWidth:0},ganttSquare:{flex:1,aspectRatio:1,minWidth:0,borderRadius:1},ganttRow:{height:49,flexDirection:'row',alignItems:'center',borderBottomWidth:.5,borderBottomColor:'#D7DCE4'},puzzleInbox:{borderRadius:14,padding:7,marginTop:3},puzzleTile:{flex:1,minWidth:0,maxWidth:'49%',paddingHorizontal:8,paddingVertical:5,borderRadius:10,borderWidth:1,borderColor:'#4A5E7D',backgroundColor:'#263953',minHeight:47},timePanel:{flex:1,minHeight:0,borderRadius:15,borderWidth:1,paddingLeft:29,paddingRight:5,paddingTop:5,paddingBottom:5,overflow:'hidden'},timeSlot:{flex:1,borderTopWidth:1,borderStyle:'dashed',minHeight:0},timeLabel:{position:'absolute',left:-25,top:-5,fontSize:8},scheduledBar:{position:'absolute',left:30,right:5,borderRadius:7,padding:4,zIndex:5,overflow:'hidden'},flexBetween:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},settingsBox:{borderWidth:1,borderRadius:13,marginTop:6,paddingHorizontal:10},settingRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},statsBox:{padding:10,marginTop:7,borderRadius:13},toast:{position:'absolute',alignSelf:'center',backgroundColor:'#243652',borderRadius:17,paddingHorizontal:15,paddingVertical:9,zIndex:95,maxWidth:'90%'},undo:{position:'absolute',left:17,right:17,padding:13,borderRadius:13,flexDirection:'row',justifyContent:'space-between',backgroundColor:'#233652',zIndex:80},overlay:{flex:1,backgroundColor:'#030814B8',alignItems:'center'},editorSheet:{position:'absolute',left:10,right:10,padding:11,borderRadius:17,overflow:'hidden'},formLabel:{fontSize:10,fontWeight:'800',letterSpacing:.5,marginTop:7,marginBottom:3},input:{borderWidth:1,borderRadius:10,minHeight:44,paddingHorizontal:10,fontSize:16},formChoices:{flexDirection:'row',gap:5},chip:{borderWidth:1,borderRadius:10,minHeight:42,alignItems:'center',justifyContent:'center',paddingHorizontal:4},primaryButton:{flex:1,borderRadius:12,padding:12,alignItems:'center'},
});