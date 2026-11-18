import { invoke } from '@tauri-apps/api/core';
let developerMode=false;
export const call=async<T,>(name:string,args?:Record<string,unknown>):Promise<T>=>{
 const started=performance.now();
 try{
  const result=await invoke<T>(name,args);
  if(name==='get_preferences')developerMode=Boolean((result as {developer_mode?:boolean})?.developer_mode);
  if(name==='save_preferences')developerMode=Boolean((args?.preferences as {developer_mode?:boolean})?.developer_mode);
  if(developerMode&&name!=='record_diagnostic')void invoke('record_diagnostic',{command:name,phase:'ok',durationMs:Math.round(performance.now()-started)}).catch(()=>{});
  return result;
 }catch(error){
  if(developerMode&&name!=='record_diagnostic')void invoke('record_diagnostic',{command:name,phase:'error',durationMs:Math.round(performance.now()-started)}).catch(()=>{});
  throw error;
 }
};
