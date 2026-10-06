import { NATIVE_APP, nativePlugin } from './platform.js';

export function createReminders(state, { showToast, closeDetail, closeHomePortMap, goToWelcome }) {
  function sailReminderKey(){return state.city?.id?`portlore-sail-reminder:${state.city.id}`:'';}
  function sailReminderMinutesKey(){return state.city?.id?`portlore-sail-reminder-minutes:${state.city.id}`:'';}
  function sailReminderEnabled(){const key=sailReminderKey();return key?localStorage.getItem(key)==='1':false;}
  function sailReminderMinutes(){
    const key=sailReminderMinutesKey();
    const value=key?parseInt(localStorage.getItem(key),10):NaN;
    return Number.isFinite(value)&&value>0?value:45;
  }
  let sailReminderFired=false;
  function renderSailReminder(){
    const enabled=sailReminderEnabled();
    const mins=sailReminderMinutes();
    const status=document.getElementById('sail-reminder-status');
    const sub=document.getElementById('sail-reminder-sub');
    if(status){status.textContent=enabled?formatReminderTime(mins):'Off';status.classList.toggle('on',enabled);}
    if(sub){
      if(!enabled)sub.textContent='Choose when to be alerted before departure';
      else if(!NATIVE_APP&&'Notification' in window&&Notification.permission==='denied')sub.textContent='In-app alert only · browser notifications blocked';
      else sub.textContent=`Alert set for ${formatReminderTime(mins)} before departure`;
    }
  }
  let reminderPickerHours=0;
  let reminderPickerMins=45;
  function formatReminderTime(total){
    const hours=Math.floor(total/60), mins=total%60;
    if(hours&&mins)return `${hours} hr ${mins} min`;
    if(hours)return `${hours} hr`;
    return `${mins} min`;
  }
  function buildReminderWheel(id,values,onSelect){
    const wheel=document.getElementById(id);
    if(wheel.dataset.ready)return;
    wheel.dataset.ready='1';
    values.forEach(value=>{
      const option=document.createElement('div');
      option.className='reminder-wheel-option';
      option.dataset.value=String(value);
      option.textContent=String(value).padStart(2,'0');
      option.addEventListener('click',()=>option.scrollIntoView({behavior:'smooth',block:'center'}));
      wheel.appendChild(option);
    });
    let timer;
    wheel.addEventListener('scroll',()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>{
        const center=wheel.scrollTop+wheel.clientHeight/2;
        let nearest=null, distance=Infinity;
        wheel.querySelectorAll('.reminder-wheel-option').forEach(option=>{
          const optionCenter=option.offsetTop+option.offsetHeight/2;
          const d=Math.abs(optionCenter-center);
          if(d<distance){distance=d;nearest=option;}
        });
        if(!nearest)return;
        wheel.querySelectorAll('.reminder-wheel-option').forEach(option=>option.classList.toggle('selected',option===nearest));
        onSelect(Number(nearest.dataset.value));
      },70);
    },{passive:true});
  }
  function setReminderWheelValue(id,value){
    const wheel=document.getElementById(id);
    const option=wheel.querySelector(`[data-value="${value}"]`);
    if(!option)return;
    wheel.scrollTop=option.offsetTop-(wheel.clientHeight-option.offsetHeight)/2;
    wheel.querySelectorAll('.reminder-wheel-option').forEach(item=>item.classList.toggle('selected',item===option));
  }
  function closeReminderPicker(){
    const picker=document.getElementById('reminder-picker');
    picker.classList.remove('open');
    picker.setAttribute('aria-hidden','true');
    document.documentElement.classList.remove('detail-open');
    document.body.classList.remove('detail-open');
  }
  function openReminderPicker(){
    buildReminderWheel('reminder-hours',Array.from({length:13},(_,i)=>i),value=>{reminderPickerHours=value;});
    buildReminderWheel('reminder-minutes',Array.from({length:12},(_,i)=>i*5),value=>{reminderPickerMins=value;});
    const current=sailReminderEnabled()?sailReminderMinutes():45;
    reminderPickerHours=Math.min(12,Math.floor(current/60));
    reminderPickerMins=Math.round((current%60)/5)*5;
    if(reminderPickerMins===60){reminderPickerHours=Math.min(12,reminderPickerHours+1);reminderPickerMins=0;}
    const picker=document.getElementById('reminder-picker');
    picker.classList.add('open');
    picker.setAttribute('aria-hidden','false');
    document.documentElement.classList.add('detail-open');
    document.body.classList.add('detail-open');
    requestAnimationFrame(()=>{
      setReminderWheelValue('reminder-hours',reminderPickerHours);
      setReminderWheelValue('reminder-minutes',reminderPickerMins);
    });
  }
  async function saveSailReminder(){
    const key=sailReminderKey();
    const minsKey=sailReminderMinutesKey();
    if(!key||!minsKey)return;
    const mins=reminderPickerHours*60+reminderPickerMins;
    if(mins<5){showToast('Choose at least 5 minutes');return;}
    if(!NATIVE_APP&&'Notification' in window&&Notification.permission==='default'){
      try{await Notification.requestPermission();}catch{}
    }
    localStorage.setItem(key,'1');
    localStorage.setItem(minsKey,String(mins));
    sailReminderFired=false;
    closeReminderPicker();
    renderSailReminder();
    scheduledSailAt=0;
    syncNativeSailReminder();
    if(!NATIVE_APP&&'Notification' in window&&Notification.permission==='denied')showToast(`Reminder set for ${formatReminderTime(mins)} · in-app alert only`);
    else showToast(`Reminder set for ${formatReminderTime(mins)} before departure`);
  }
  function disableSailReminder(){
    const key=sailReminderKey();
    const minsKey=sailReminderMinutesKey();
    if(key)localStorage.removeItem(key);
    if(minsKey)localStorage.removeItem(minsKey);
    sailReminderFired=false;
    closeReminderPicker();
    renderSailReminder();
    syncNativeSailReminder();
    showToast('Sail-away reminder turned off');
  }
  function toggleSailReminder(){openReminderPicker();}
  function sendSailReminder(){
    const mins=sailReminderMinutes();
    const message=`${formatReminderTime(mins)} until departure. Start heading back to the ship.`;
    if(!NATIVE_APP&&'Notification' in window&&Notification.permission==='granted'){
      try{new Notification('Portlore sail-away reminder',{body:message});}catch{}
    }
    showToast(message);
  }
  const SAIL_NOTIFICATION_ID=1;
  let scheduledSailAt=0;
  let askedForExactAlarms=false;
  // In the app the reminder is scheduled with Android, so it fires with the screen off or the app closed.
  async function syncNativeSailReminder(){
    const notifications=nativePlugin('LocalNotifications');
    if(!notifications)return;
    const at=sailReminderEnabled()&&state.cdownMins>0?Date.now()+(state.cdownMins-sailReminderMinutes())*60000:0;
    if(Math.abs(at-scheduledSailAt)<60000)return;
    scheduledSailAt=at;
    try{
      await notifications.cancel({notifications:[{id:SAIL_NOTIFICATION_ID}]});
      if(at<=Date.now())return;
      let permission=await notifications.checkPermissions();
      if(permission.display!=='granted')permission=await notifications.requestPermissions();
      if(permission.display!=='granted')return;
      // Android 14 turns exact alarms off by default, and without them the reminder can arrive minutes late.
      // Asking for an exact one makes the plugin jump straight to settings, so it is only asked for once allowed.
      const exact=notifications.checkExactNotificationSetting
        ?(await notifications.checkExactNotificationSetting()).exact_alarm==='granted'
        :true;
      await notifications.schedule({notifications:[{
        id:SAIL_NOTIFICATION_ID,
        title:'Portlore sail-away reminder',
        body:`${formatReminderTime(sailReminderMinutes())} until all aboard. Start heading back to the ship.`,
        schedule:{at:new Date(at),allowWhileIdle:true},
        isExactNotification:exact,
      }]});
      if(!exact&&!askedForExactAlarms){
        askedForExactAlarms=true;
        if(confirm('Get your sail-away reminder at the exact minute?\n\nAndroid needs you to allow "Alarms & reminders" for Portlore. Without it, the reminder can arrive a few minutes late.')){
          await notifications.changeExactNotificationSetting();
        }
      }
    }catch{}
  }
  // Coming back from Android settings, the reminder is set again so it picks up exact timing.
  nativePlugin('App')?.addListener('appStateChange',({isActive})=>{
    if(isActive){scheduledSailAt=0;syncNativeSailReminder();}
  });
  nativePlugin('App')?.addListener('backButton',()=>{
    if(document.getElementById('reminder-picker').classList.contains('open'))return closeReminderPicker();
    if(document.getElementById('detail').classList.contains('open'))return closeDetail();
    if(document.getElementById('port-map-overlay').classList.contains('open'))return closeHomePortMap();
    if(!document.getElementById('page-welcome').classList.contains('active'))return goToWelcome();
    nativePlugin('App').exitApp();
  });
  document.getElementById('b-sail').addEventListener('click',toggleSailReminder);
  document.getElementById('reminder-picker-backdrop').addEventListener('click',closeReminderPicker);
  document.getElementById('reminder-picker-cancel').addEventListener('click',closeReminderPicker);
  document.getElementById('reminder-picker-save').addEventListener('click',saveSailReminder);
  document.getElementById('reminder-picker-off').addEventListener('click',disableSailReminder);
  function checkSailReminder() {
    if(sailReminderEnabled()&&!sailReminderFired&&state.cdownMins<=sailReminderMinutes()&&state.cdownMins>0){sailReminderFired=true;sendSailReminder();}
  }
  return { checkSailReminder, renderSailReminder, syncNativeSailReminder };
}
