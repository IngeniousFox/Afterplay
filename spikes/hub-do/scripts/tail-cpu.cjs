const t=require('fs').readFileSync(process.argv[2],'utf8');
const parts=t.split(/\n(?=\{)/).filter(x=>x.trim());
const ev=[];let bad=0;
for(const p of parts){try{ev.push(JSON.parse(p))}catch(e){bad++}}
const by={};const other={};
for(const o of ev){
  const u=new URL(o.event?.request?.url||'http://x/');
  const op=u.searchParams.get('op')||'(none:'+u.pathname+')';
  const k=o.executionModel+' | '+op;
  (by[k]??=[]).push({cpu:o.cpuTime,wall:o.wallTime,out:o.outcome,ex:o.exceptions.length,ts:o.eventTimestamp,st:o.event?.response?.status});
}
const q=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.ceil(p*a.length)-1)]};
console.log('events',ev.length,'bad',bad);
for(const k of Object.keys(by).sort()){const a=by[k];const c=a.map(x=>x.cpu),w=a.map(x=>x.wall);
 console.log(k,'n='+a.length,'cpu p50',q(c,.5),'p99',q(c,.99),'max',Math.max(...c),'| wall p50',q(w,.5),'max',Math.max(...w),'| outcomes',[...new Set(a.map(x=>x.out+'/'+x.st))].join(','),'exc',a.reduce((s,x)=>s+x.ex,0),'| cpu list',c.join(','))}
