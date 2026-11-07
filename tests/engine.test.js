const SB = require('../js/engine.js');
const assert = require('assert');
const sc = f => SB.scoreCard(f).total;
assert.strictEqual(sc([[10],[10],[10],[10],[10],[10],[10],[10],[10],[10,10,10]]), 300);
assert.strictEqual(sc(Array(10).fill([9,0])), 90);
assert.strictEqual(sc([...Array(9).fill([5,5]),[5,5,5]]), 150);
assert.strictEqual(sc([[10],[7,3],[9,0],[10],[0,8],[8,2],[0,6],[10],[10],[10,8,1]]), 167);
assert.deepStrictEqual(SB.frameMarks([10,7,3],true), ['X','7','/']);
assert.deepStrictEqual(SB.frameMarks([0,10,10],true), ['-','/','X']);
assert.deepStrictEqual(SB.frameMarks([10,10,0],true), ['X','X','-']);
// pending strike shows no total yet
const c = SB.scoreCard([[10],[3]]); assert.strictEqual(c.frames[0].total, null);
// Match flow: 1 player perfect game via record()
const m = new SB.Match(); m.addPlayer('A','#fff'); let n=0;
while(!m.over){ m.record(10,false); n++; } assert.strictEqual(n,12); assert.strictEqual(sc(m.players[0].frames),300);
const m2 = new SB.Match(); m2.addPlayer('A'); m2.addPlayer('B');
let r = m2.record(3); assert(!r.endTurn); r = m2.record(4); assert(r.endTurn && m2.cur===1);
console.log('scoring OK');

// Physics: distribution of results for a range of throws
function roll(x, aim, speed, spin, seed){
  let s = seed; const rng=()=>{s=(s*16807)%2147483647; return s/2147483647;};
  const L = new SB.Lane(rng); L.throwBall({x,aim,speed,spin});
  let t=0, res=null; while(t<20 && !res){ L.update(1/60); t+=1/60; for(const e of L.drainEvents()) if(e.type==='settled') res=e; }
  return {res, t};
}
const tbl = {};
for (const [name,x,aim,spin] of [['center',0,0,0],['pocket-straight',0.06,0,0],['hook',0.30,0,0.55],['wide-left',-0.35,0,0],['gutter',0.42,0.08,0]]){
  const ks=[]; let tt=0; for(let i=1;i<=40;i++){ const {res,t}=roll(x,aim,7.5,spin,i*7919); ks.push(res.knocked); tt+=t; }
  tbl[name] = {avg:(ks.reduce((a,b)=>a+b)/ks.length).toFixed(1), strikes: ks.filter(k=>k===10).length+'/40', secs:(tt/40).toFixed(1)};
}
console.table(tbl);
// where does a hook ball end up laterally?
const L = new SB.Lane(()=>0.5); L.throwBall({x:0.30,aim:0,speed:7.5,spin:0.55}); while(L.ball.z<18){L.step(1/240);} console.log('hook x at pins', L.ball.x.toFixed(3));
