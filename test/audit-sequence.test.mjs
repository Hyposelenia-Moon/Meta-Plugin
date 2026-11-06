import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'test/.test-tmp/audit-sequence.json')
fs.mkdirSync(path.dirname(out), {recursive:true})
const S = await import(pathToFileURL(path.join(root, 'lib/model/TeamSimStore.js')).href)
const K = await import(pathToFileURL(path.join(root, 'lib/modules/teamSimulation/index.js')).href)
const pack = JSON.parse(fs.readFileSync(path.join(root, 'data/team-sim/packs/bennett.json'), 'utf8'))
const file = {schemaVersion:1,id:'audit-sequence',team:['10000032'],measurementEndFrame:7243,frameTierId:'fps-60',sequence:[...Array(10).fill('bennett.skill'),'bennett.burst']}
const rows=[]
for (const optional of [false,true]) {
 const f = {...file, energyRecharge:{bennett:3},sequence:[...file.sequence.slice(0,-1),optional?{actionId:'bennett.burst',optional:true}:'bennett.burst']}
 const converted = S.toRotation(f,pack)
 const direct=K.simulateTimeline({scheduler:'asap-sequence',steps:f.sequence.map((v,i)=>({id:String(i),kind:'action',actorId:'bennett',actionId:typeof v==='string'?v:v.actionId,...(typeof v==='object'?{optional:true}:{})})),actions:pack.actions,actors:[{actorId:'bennett',energy:0,energyMax:60}],activeActorId:'bennett',frameTier:K.FRAME_TIERS['fps-60'],measurementEndFrame:7243,energyRecharge:f.energyRecharge})
 const burst=converted.rotation?.steps.filter(s=>s.actionId==='bennett.burst').length??0
 const directBurst=direct.requests.filter(r=>r.stepId==='10'&&r.actualFrame!==null).length
 rows.push({name:optional?'300% recharge optional burst preserved':'300% recharge required burst schedules',status:converted.status,burst,issues:converted.issues,directStatus:direct.status,directBurst,pass:converted.status==='ok'&&burst===1&&direct.status==='simulated'&&directBurst===1})
}
const low=S.toRotation({...file,sequence:[...file.sequence.slice(0,-1),{actionId:'bennett.burst',optional:true}]},pack)
rows.push({name:'100% recharge still skips unaffordable optional burst',pass:low.status==='ok'&&!low.rotation.steps.some(s=>s.actionId==='bennett.burst')})
const loop=S.toRotation({...file,loop:true,sequence:['bennett.normal-1']},pack)
const actions=loop.rotation?.steps.filter(s=>s.kind==='action')??[]
const last=actions.at(-1)?.atFrame??0
rows.push({name:'normal-only loop fills 120-second window',status:loop.status,actions:actions.length,lastActionFrame:last,window:7243,pass:loop.status==='ok'&&last>7100&&last<7243})
fs.writeFileSync(out,JSON.stringify({source:root,passed:rows.filter(r=>r.pass).length,total:rows.length,rows},null,2)+'\n')
console.log(JSON.stringify(rows,null,2))
process.exitCode=rows.every(r=>r.pass)?0:1
