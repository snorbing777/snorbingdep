const {test}=require('node:test');const assert=require('node:assert/strict');
const {Events}=require('../notification_center.js');
const token={mint:'mint',symbol:'TEST'},now=1000;
const fullChecks=Object.fromEntries(['chain_enabled','pump_filter','price','age','liquidity','volume','buys','buy_pressure','momentum','narrative_evidence'].map(key=>[key,true]));
function fixture(){const events=[],memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};const ledger=new Events({now:()=>now,storage,onEvent:e=>events.push(e)});return {events,ledger,storage};}
test('each new completed analysis alerts once, including blocked entries; polls and reloads do not replay',()=>{
 const f=fixture(),data={observed_at:now,eligible:false,checks:{narrative_evidence:false},narrative_reason:'No narrative measurements'};
 f.ledger.analysis(token,data);f.ledger.analysis(token,data);assert.equal(f.events.length,1);assert.match(f.events[0].detail,/No narrative measurements/);
 const restored=new Events({now:()=>now,storage:f.storage,onEvent:e=>f.events.push(e)});restored.analysis(token,data);assert.equal(f.events.length,1);
 restored.analysis(token,{...data,observed_at:1001});assert.equal(f.events.length,2);
});
test('potential runner requires fresh complete passed checks and triggers only on a transition',()=>{
 const f=fixture(),good={observed_at:now,eligible:true,score:75,checks:fullChecks};
 f.ledger.analysis(token,{...good,checks:{liquidity:true,narrative_evidence:false}});assert.equal(f.events.filter(e=>e.type==='runner').length,0);
 f.ledger.analysis(token,{...good,checks:{narrative_evidence:true}});assert.equal(f.events.filter(e=>e.type==='runner').length,0);
 f.ledger.analysis(token,good);f.ledger.analysis(token,{...good,observed_at:1001});assert.equal(f.events.filter(e=>e.type==='runner').length,1);
 f.ledger.analysis(token,{...good,observed_at:1002,eligible:false});f.ledger.analysis(token,{...good,observed_at:1003});assert.equal(f.events.filter(e=>e.type==='runner').length,2);
 f.ledger.analysis(token,{...good,observed_at:500});assert.equal(f.events.filter(e=>e.type==='runner').length,2);
 assert.match(f.events.find(e=>e.type==='runner').detail,/No order placed/);
});
test('paper and confirmed live fills alert independently and stale history or proposals cannot become fills',()=>{
 const f=fixture(),fill={id:'fill',time:now,kind:'entry',title:'PAPER ENTRY · TEST',detail:'Virtual funds'};
 f.ledger.report({mode:'paper',time:now,candidates:[{...token,address:'mint',eligible:false,checks:{price:false}}],alerts:[fill]});
 f.ledger.report({mode:'paper',time:now,alerts:[fill]});assert.equal(f.events.filter(e=>e.type==='trade').length,1);
 f.ledger.report({mode:'live-pump',time:now,alerts:[{...fill,title:'LIVE BUY CONFIRMED · TEST'}]});assert.equal(f.events.filter(e=>e.type==='trade').length,2);
 f.ledger.report({mode:'waiting',time:now,alerts:[{...fill,id:'fake'}]});f.ledger.report({mode:'paper',time:500,alerts:[{...fill,id:'old',time:500}]});assert.equal(f.events.filter(e=>e.type==='trade').length,2);
});
