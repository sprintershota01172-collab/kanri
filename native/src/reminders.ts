import * as Notifications from 'expo-notifications';
import {Platform} from 'react-native';
import { Preferences, Task } from './model';

const CATEGORY = 'kanritask';
const CHANNEL = 'kanri_reminders';
Notifications.setNotificationHandler({
  handleNotification: async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false}),
});

export async function registerNotifications() {
  await Notifications.setNotificationCategoryAsync(CATEGORY,[
    {identifier:'done',buttonTitle:'完了',options:{opensAppToForeground:true}},
    {identifier:'snooze',buttonTitle:'10分後',options:{opensAppToForeground:true}},
  ]);
  if(Platform.OS==='android') await Notifications.setNotificationChannelAsync(CHANNEL,{
    name:'kanri reminders',importance:Notifications.AndroidImportance.HIGH,
  });
}
export async function requestLocalPermissions(): Promise<boolean> {
  const previous=await Notifications.getPermissionsAsync();
  if(previous.granted) return true;
  const status=await Notifications.requestPermissionsAsync();
  return status.granted;
}
export async function cancelTaskNotifications(task: Task) {
  await Promise.all((task.notificationIds??[]).map(id=>Notifications.cancelScheduledNotificationAsync(id).catch(()=>{})));
}
export async function scheduleTaskNotifications(task: Task,prefs: Preferences): Promise<string[]> {
  if(!prefs.remindersEnabled||task.completed) return [];
  const now=Date.now();
  const events:{at:Date,kind:string,body:string}[]=[];
  if(task.dueDate) {
    const deadline=new Date(`${task.dueDate}T23:59:00`);
    const at=new Date(deadline.getTime()-prefs.leadMinutes*60000);
    if(Number.isFinite(at.getTime())&&at.getTime()>now+1000)events.push({at,kind:'due',body:`納期 ${task.dueDate} / ${task.durationMin}分`});
  }
  if(task.scheduledStart&&prefs.startReminder){
    const at=new Date(`${task.scheduledStart}:00`);
    if(Number.isFinite(at.getTime())&&at.getTime()>now+1000)events.push({at,kind:'start',body:`予定開始です（${task.durationMin}分）`});
  }
  const ids:string[]=[];
  for(const event of events){
    try {
      const id=await Notifications.scheduleNotificationAsync({
        content:{title:task.title,body:event.body,categoryIdentifier:CATEGORY,data:{taskId:task.id,kind:event.kind}},
        trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:event.at,channelId:CHANNEL},
      });
      ids.push(id);
    } catch(err){console.warn('kanri notification scheduling failed',err);}
  }
  return ids;
}
export async function snoozeTask(task: Task) {
  return Notifications.scheduleNotificationAsync({
    content:{title:task.title,body:'10分後のリマインダー',categoryIdentifier:CATEGORY,data:{taskId:task.id,kind:'snooze'}},
    trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:new Date(Date.now()+10*60000),channelId:CHANNEL},
  });
}
