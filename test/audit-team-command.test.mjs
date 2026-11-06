import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'test/.test-tmp/audit-team-command.json')
fs.mkdirSync(path.dirname(out),{recursive:true})
const config=path.join(path.dirname(out),'command-config.yaml')
fs.writeFileSync(config,'networkEnabled: false\nmodules:\n  teamDamage: true\n')
process.env.META_CONFIG_FILE=config
globalThis.logger={info(){},warn(){},error(){},debug(){}}
const load=rel=>import(pathToFileURL(path.join(root,'lib',rel)).href)
const A=await load('model/TeamBuildAdapter.js')
const specs=[['10000030','钟离','13303'],['10000038','阿贝多','11415'],['10000055','五郎','15401'],['10000057','荒泷一斗','12510']]
const result=[]
const members=specs.map(([id,name,weapon])=>{
 const rows=['hpPlus','atkPlus','def','geo','cdmg'].map((key,i)=>({mainId:i+1,main:{id:i+1,key,value:[4780,311,58.3,46.6,62.2][i]},star:5,level:20,name:'合成圣遗物',set:'400189',attrIds:[11,12,13,14],attrs:[['cpct',3.9],['mastery',16],['recharge',5.2],['atk',4.1]].map(([key,value])=>({key,value,upNum:1}))}))
 const a={game:'gs',id, char:{id,name},elem:'geo',level:90,promote:6,cons:0,weapon:{id:weapon,name:weapon,level:90,promote:6,affix:1},talent:Object.fromEntries(['a','e','q'].map(k=>[k,{original:10}])),artis:{forEach(fn){rows.forEach((r,i)=>fn(r,i+1))}}}
 const adapted=A.adaptMiaoAvatar(a,{provider:'synthetic-public-avatar',providerVersion:null,sourceTime:null})
 if(adapted.status!=='raw-complete')throw Error(JSON.stringify(adapted))
 return adapted
})
globalThis.__auditMembers=members
const textUrl=code=>'data:text/javascript,'+encodeURIComponent(code)
registerHooks({resolve(specifier,context,next){
 if(specifier.endsWith('/lib/plugins/plugin.js'))return {url:textUrl('export default class {constructor(c){Object.assign(this,c)}}'),shortCircuit:true}
 if(specifier==='../model/TeamBuildAdapter.js'&&context.parentURL?.endsWith('/apps/teamDamage.js'))return {url:textUrl('export const readTeamBuilds=async()=>({status:"raw-complete",members:globalThis.__auditMembers,issues:[],simulationReady:false})'),shortCircuit:true}
 return next(specifier,context)
}})
const {MetaTeamDamage}=await load('apps/teamDamage.js')
const app=new MetaTeamDamage()
for(const [name,msg,expect] of [['real numeric adapter IDs through four-geo command','#队伍伤害 钟离 阿贝多 五郎 荒泷一斗','damage'],['legacy axis rejected control','#队伍伤害2 钟离 阿贝多 五郎 荒泷一斗','序号轴已废除']]){
 const replies=[]
 await app.handleTeamDamage({msg,reply:async x=>{replies.push(String(x));return true}})
 const pass=expect==='damage'?replies.some(x=>/DPS/.test(x)&&!x.includes('模拟没有算出来')):replies.some(x=>x.includes(expect))
 result.push({name,msg,adapterActorIds:members.map(m=>m.build.actorId),replies,pass})
}
fs.writeFileSync(out,JSON.stringify({source:root,scope:'real adaptMiaoAvatar, actual command handler, real packs/axis/permanent modules; only account/framework/message boundaries replaced',passed:result.filter(r=>r.pass).length,total:result.length,rows:result},null,2)+'\n')
console.log(JSON.stringify(result,null,2));process.exitCode=result.every(r=>r.pass)?0:1
