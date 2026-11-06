import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'test/.test-tmp/audit-panel-export.json')
fs.mkdirSync(path.dirname(out),{recursive:true})
const scratch=path.join(path.dirname(out),path.basename(out,'.json')+'-files')
fs.mkdirSync(scratch,{recursive:true})
const file=path.join(root,'lib/model/MiaoPanelExport.js')
const textUrl=source=>'data:text/javascript,'+encodeURIComponent(source)
const rows={1:{set:'合成套装',name:'合成花',level:20,main:{key:'hpPlus',value:4780},attrs:[{key:'cpct',value:7},{key:'cdmg',value:14},{key:'atkPlus',value:19},{key:'mastery',value:21},{key:'recharge',value:'5.2%'}]}}
globalThis.__exportAvatar={level:90,cons:0,weapon:{name:'黑缨枪',affix:1,level:90},talent:{a:{level:10},e:{level:10},q:{level:10}},getArtisDetail:()=>rows}
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===pathToFileURL(file).href){
  if(specifier==='../dir.js')return {url:textUrl('export const botRoot='+JSON.stringify(scratch)),shortCircuit:true}
  if(specifier==='./MiaoProfile.js')return {url:textUrl('export const resolveUid=async()=>({uid:"999999999"}); export const loadMiaoModels=async()=>({Player:{get:()=>({getAvatar:()=>globalThis.__exportAvatar})},Character:{get:()=>({id:10000030})}})'),shortCircuit:true}
  if(specifier==='./CharacterIndex.js')return {url:textUrl('export const findCharacter=()=>({name:"钟离"})'),shortCircuit:true}
 }
 return next(specifier,context)
}})
const M=await import(pathToFileURL(file).href)
const saved=await M.exportPanelSnapshot({},'钟离')
if(!saved.ok)throw Error(saved.error)
const payload=JSON.parse(fs.readFileSync(saved.file,'utf8'))
const actual=Object.fromEntries(payload.artis[0].subs.map(x=>[x.key,x.value]))
const expected={cpct:.07,cdmg:.14,atk:19,mastery:21,recharge:.052}
const checks=Object.entries(expected).map(([key,value])=>({key,expected:value,actual:actual[key],pass:Math.abs(actual[key]-value)<1e-12}))
const ctx=vm.createContext({console,fetch:()=>new Promise(()=>{}),window:{},document:{},Map,Set})
vm.runInContext(fs.readFileSync(path.join(root,'resources/editor-rotation/panel.js'),'utf8'),ctx)
ctx.tables=JSON.parse(fs.readFileSync(path.join(root,'data/team-sim/stat-tables.json'),'utf8'))
vm.runInContext('P.tables=tables',ctx)
ctx.critValue=actual.cpct
const importedCrit=Number(vm.runInContext('nearestSubValue("cpct",critValue)',ctx))
checks.push({key:'actual editor import crit roll',expected:.07,actual:importedCrit,pass:Math.abs(importedCrit-.07)<.002})
fs.writeFileSync(out,JSON.stringify({source:root,scope:'real exportPanelSnapshot plus real frontend nearestSubValue; only account/model binding and output root isolated; synthetic public numeric fields',payload,passed:checks.filter(c=>c.pass).length,total:checks.length,checks},null,2)+'\n')
console.log(JSON.stringify(checks,null,2));process.exitCode=checks.every(c=>c.pass)?0:1
