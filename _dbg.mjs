const PORT=9229;
const l=await (await fetch("http://127.0.0.1:"+PORT+"/json/list")).json();
const p=l.find(t=>t.type==="page"); const ws=new WebSocket(p.webSocketDebuggerUrl);
let id=0; const pd=new Map();
ws.addEventListener("message",e=>{const m=JSON.parse(e.data); if(m.id&&pd.has(m.id)){const q=pd.get(m.id);pd.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}});
await new Promise((r,j)=>{ws.addEventListener("open",r);ws.addEventListener("error",j);});
const send=(m,pr={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:pr}));return new Promise((res,rej)=>pd.set(i,{res,rej}));};
const ev=async x=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});return r.exceptionDetails?("EXC: "+JSON.stringify(r.exceptionDetails.text||r.exceptionDetails)):r.result.value;};
console.log("has verify:", await ev("typeof AP.Engine.createAgent().verify_timeline"));
console.log("build:", await ev("window.__AP_BUILD__"));
console.log(await ev(`(async()=>{
  var a=AP.Engine.createAgent();
  var v=a.verify_timeline('高才B 2025.9.1 激活的，几时该递件？','首签续签到 2028-09-01');
  var r=await a.chat('高才B 2025.9.1 激活的，几时该递件？',null,null);
  return JSON.stringify({v:{checked:v.checked,replaced:v.replaced,bad:v.bad},tool:r.tool_used,steps:r.steps.map(s=>s.name),reply:String(r.reply).slice(0,120)});
})()`));
ws.close(); process.exit(0);
