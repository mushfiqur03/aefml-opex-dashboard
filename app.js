/* =====================================================================
   AEL / AEFML  —  OPEX Command Centre  v2
   Record-level engine: aggregates any [from,to] date range client-side.
   OEE = Effective Availability x Performance(throughput) x Quality
   ===================================================================== */
(function () {
"use strict";

var D = window.AEL_DATA, M = D.meta;

/* field indices (see data.js "fields") */
var I  = { sbu:0,d:1,ln:2,mc:3,pr:4,sh:5,cap:6,tgt:7,out:8,ct:9,op:10,pdt:11,avail:12,npt:13,run:14,good:15,wst:16,flow:17,ps:18,cats:19,mix:20 };
var BI = { sbu:0,d:1,bdtype:2,reason:3,min:4,mc:5,sh:6,pr:7,planned:8 };

var DATES = D.dates, DI = D.dict, SBU = M.sbus, UOM = M.uom, T = M.targets;
var PACKI = SBU.indexOf("Packing");
var MIXK = M.mixkeys, CATK = M.catkeys;

/* ---------------------------------------------------------------- format */
function $id(x){ return document.getElementById(x); }
function nf(n){ return (n==null||isNaN(n))?"\u2014":Math.round(n).toLocaleString("en-US"); }
function f1(n){ return (n==null||isNaN(n))?"\u2014":Number(n).toFixed(1); }
function f2(n){ return (n==null||isNaN(n))?"\u2014":Number(n).toFixed(2); }
function pc(n,dp){ return (n==null||isNaN(n))?"\u2014":Number(n).toFixed(dp==null?1:dp)+"%"; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
function hexOee(v){ if(v>=T.OEE) return "#22c55e"; if(v>=T.OEE-15) return "#f59e0b"; return "#ef4444"; }
function rag(v,t){ if(v==null||isNaN(v)) return "dim"; if(v>=t) return "good"; if(v>=t*0.85) return "warn"; return "bad"; }
var RAGCOL={good:"#22c55e",warn:"#f59e0b",bad:"#ef4444",dim:"#5d7086"};
var CLS_COLOR={"Demand / Order-book":"#f59e0b","Supply / Input":"#a78bfa","Equipment reliability":"#ef4444",
  "Process / Changeover":"#22d3ee","Utility":"#3b82f6","Manpower":"#f472b6","Other / Process":"#64748b"};
var CAT_COLOR={unavailable_order:"#f59e0b",setup:"#22d3ee",utility_gas:"#818cf8",utility_elec:"#3b82f6",
  rm_shortage:"#a78bfa",manpower:"#f472b6",qco:"#2dd4bf",warehouse:"#fb923c",mech:"#ef4444",elec:"#f43f5e",others:"#64748b"};
var SEV={"critical":"#ef4444","high":"#f59e0b","medium":"#22d3ee","low":"#22c55e"};

/* ------------------------------------------------------- date boundaries */
function lb(s){ var lo=0,hi=DATES.length; while(lo<hi){ var m=(lo+hi)>>1; if(DATES[m]<s) lo=m+1; else hi=m; } return lo; }
function ub(s){ var lo=0,hi=DATES.length; while(lo<hi){ var m=(lo+hi)>>1; if(DATES[m]<=s) lo=m+1; else hi=m; } return lo; }
function iso(y,m,d){ return y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0"); }
function dim(y,m){ return new Date(y,m,0).getDate(); }
function firstOf(y,m){ while(m<1){m+=12;y--;} while(m>12){m-=12;y++;} return iso(y,m,1); }
function endOf(y,m){ while(m<1){m+=12;y--;} while(m>12){m-=12;y++;} return iso(y,m,dim(y,m)); }
function daysBetween(a,b){ return Math.round((Date.parse(b)-Date.parse(a))/86400000)+1; }

var LASTM = M.last.slice(0,4)|0, LASTD = M.last.slice(5,7)|0;
function preset(k){
  switch(k){
    case "MTD":  return [iso(LASTM,LASTD,1), M.last];
    case "LM":   return [firstOf(LASTM,LASTD-1), endOf(LASTM,LASTD-1)];
    case "L3M":  return [firstOf(LASTM,LASTD-2), M.last];
    case "L12M": return [firstOf(LASTM,LASTD-11), M.last];
    case "ALL":  return [M.first, M.last];
  }
  return [M.first, M.last];
}
var PRESETS=[["MTD","This month"],["LM","Last month"],["L3M","3 months"],["L12M","12 months"],["ALL","All data"]];

/* ---------------------------------------------------------------- state */
var S = { scope:"Group", from:"", to:"", preset:"L12M" };
var RATES = {};
try { RATES = JSON.parse(localStorage.getItem("ael_rates_v2")||"{}") || {}; } catch(e){ RATES={}; }
function saveRates(){ try { localStorage.setItem("ael_rates_v2", JSON.stringify(RATES)); } catch(e){} }

/* ------------------------------------------------------------ selection */
var memo = { key:"", prod:null, bd:null };
function sel(){
  var key = S.scope+"|"+S.from+"|"+S.to;
  if(memo.key===key) return memo;
  var lo=lb(S.from), hi=ub(S.to)-1;
  var si = S.scope==="Group" ? -1 : SBU.indexOf(S.scope);
  var p=[], b=[];
  for(var i=0;i<D.recs.length;i++){ var r=D.recs[i]; var d=r[I.d]; if(d<lo||d>hi) continue; if(si>=0 && r[I.sbu]!==si) continue; p.push(r); }
  for(var j=0;j<D.bd.length;j++){ var x=D.bd[j]; var dd=x[BI.d]; if(dd<lo||dd>hi) continue; if(si>=0 && x[BI.sbu]!==si) continue; b.push(x); }
  memo = { key:key, prod:p, bd:b };
  return memo;
}

/* ---------------------------------------------------------- aggregation */
function agg(list){
  var o={op:0,pdt:0,avail:0,npt:0,run:0,runEff:0,runIdle:0,out:0,good:0,flow:0,tgt:0,cap:0,wst:0,ideal:0,psw:0,psrw:0,n:0};
  for(var i=0;i<list.length;i++){
    var r=list[i];
    o.op+=r[I.op]; o.pdt+=r[I.pdt]; o.avail+=r[I.avail]; o.npt+=r[I.npt]; o.run+=r[I.run];
    var flow=r[I.flow];
    if(flow>0){ o.runEff+=r[I.run]; o.ideal+=r[I.ct]*flow; } else { o.runIdle+=r[I.run]; }
    o.out+=r[I.out]; o.good+=r[I.good]; o.flow+=flow; o.tgt+=r[I.tgt]; o.cap+=r[I.cap]; o.wst+=r[I.wst];
    if(r[I.run]>0 && r[I.ps]>0){ o.psw+=r[I.ps]*r[I.run]; o.psrw+=r[I.run]; }
    o.n++;
  }
  return finish(o);
}
function finish(o){
  function s(a,b){ return b?a/b:0; }
  var A=s(o.run,o.avail), Aeff=s(o.runEff,o.avail);
  var P=s(o.ideal,o.runEff), Q=o.out>0?s(o.good,o.out):0;
  var Pc=Math.min(P,1);
  var OEE=Aeff*Pc*Q;
  var Ps=s(o.psw,o.psrw)/100, PsC=Math.min(Ps,1);
  var OEERep=A*PsC*Q;
  var loading=s(o.avail,o.op);
  var nptPct=s(o.npt,o.avail)*100, idlePct=s(o.runIdle,o.avail)*100;
  var qLoss=s(o.out-o.good,o.out)*100;
  var rate=s(o.flow,o.runEff);                                  /* throughput units per minute */
  var perfLossMin=Math.max(0,o.runEff-o.ideal);
  var qualLossMin=rate>0?s(o.out-o.good,rate):0;
  return {
    n:o.n, moments:o,
    op:o.op,pdt:o.pdt,avail:o.avail,npt:o.npt,run:o.run,runEff:o.runEff,runIdle:o.runIdle,
    out:o.out,good:o.good,flow:o.flow,tgt:o.tgt,cap:o.cap,wst:o.wst,
    A:A*100, Aeff:Aeff*100, P:P*100, Pc:Pc*100, Q:Q*100, OEE:OEE*100,
    Ps:Ps*100, OEERep:OEERep*100, oeeGap:(OEE*100)-(OEERep*100),
    ach:s(o.flow,o.tgt)*100, achOut:s(o.out,o.tgt)*100, caputil:s(o.flow,o.cap)*100,
    wstpct:s(o.wst,o.flow)*100, nptpct:nptPct, idlepct:idlePct, qlosspct:qLoss,
    loading:loading*100, teep:OEE*loading*100, yield:s(o.out,o.flow)*100, rate:rate,
    /* loss decomposition (pts of OEE) */
    lossNpt:nptPct, lossIdle:idlePct, lossA:(1-Aeff)*100,
    lossP:Aeff*(1-Pc)*100, lossQ:Aeff*Pc*(1-Q)*100,
    /* loss equivalents */
    perfLossMin:perfLossMin, qualLossMin:qualLossMin,
    nptUnits:s(o.npt,1/ (rate||1)), idleUnits:s(o.runIdle,1/(rate||1))
  };
}
function parseSparse(str, bin, map){
  if(!str) return;
  var p=str.split(",");
  for(var i=0;i<p.length;i++){
    var k=p[i].indexOf(":");
    var idx=+p[i].slice(0,k), v=+p[i].slice(k+1);
    bin[map[idx]]+=v;
  }
}
function catsTotals(list){
  var bin={}; for(var i=0;i<CATK.length;i++) bin[CATK[i]]=0;
  var idxMap={}; for(var j=0;j<CATK.length;j++) idxMap[j]=CATK[j];
  for(var n=0;n<list.length;n++) parseSparse(list[n][I.cats], bin, idxMap);
  return bin;
}
function classesTotals(list){
  var ct=catsTotals(list), out={}; for(var i=0;i<CATK.length;i++){ var c=M.catclass[CATK[i]]; out[c]=(out[c]||0)+ct[CATK[i]]; }
  return out;
}
function mixTotals(list){
  var bin={}; for(var i=0;i<MIXK.length;i++) bin[MIXK[i]]=0;
  var idxMap={}; for(var j=0;j<MIXK.length;j++) idxMap[j]=MIXK[j];
  for(var n=0;n<list.length;n++) parseSparse(list[n][I.mix], bin, idxMap);
  return bin;
}
function byEntity(list, fi){
  var g={}, order=[];
  for(var i=0;i<list.length;i++){
    var v=list[i][fi];
    if(!g[v]){ g[v]=[]; order.push(v); }
    g[v].push(list[i]);
  }
  var out=[];
  for(var k=0;k<order.length;k++){ var a=agg(g[order[k]]); a.name=order[k]; out.push(a); }
  out.sort(function(x,y){ return y.out-x.out; });
  return out;
}
function nameOf(kind, idx){
  if(kind==="ln") return DI.ln[idx]||"(blank)";
  if(kind==="mc") return DI.mc[idx]||"(blank)";
  if(kind==="pr") return DI.pr[idx]||"(blank)";
  if(kind==="sh") return DI.sh[idx]||"(blank)";
  return String(idx);
}
function byEntityName(list, kind){
  var fi = kind==="ln"?I.ln : kind==="mc"?I.mc : kind==="pr"?I.pr : I.sh;
  var arr = byEntity(list, fi);
  for(var i=0;i<arr.length;i++) arr[i].label = kind==="sh" ? ("Shift "+nameOf(kind, arr[i].name)) : nameOf(kind, arr[i].name);
  return arr;
}
function reliability(list){
  var ev=0,dt=0,eq=0,dte=0;
  for(var i=0;i<list.length;i++){
    var r=list[i]; if(r[BI.planned]) continue;
    ev++; dt+=r[BI.min];
    var t=DI.bdtype[r[BI.bdtype]];
    if(t==="Mechanical Breakdown"||t==="Electrical Breakdown"){ eq++; dte+=r[BI.min]; }
  }
  var run = sel().prod.length ? 0 : 0;
  return { ev:ev, dt:dt, mttr:ev?dt/ev:0, eq:eq, dte:dte, eqmttr:eq?dte/eq:0 };
}

/* --------------------------------------------------------- delivery/elec */
function deliveryRows(){ return D.delivery.rows||[]; }
function elecRows(){ return D.electrical.rows||[]; }

/* ================================ RENDER ============================== */
function unitLbl(){ return S.scope==="Packing" ? "bags" : "MT"; }
function flowLbl(){ return M.flowlabel[S.scope] || "Throughput"; }

function kpiCard(o){
  return '<div class="card kpi" style="--accent:'+o.color+'">'
    + '<div class="lab">'+o.lab+'</div>'
    + '<div class="val" style="color:'+o.color+'">'+o.val+(o.small?'<small>'+o.small+'</small>':'')+'</div>'
    + '<div class="tgt">'+o.tgt+'</div>'
    + (o.delta ? '<div class="d '+o.dcls+'">'+o.delta+'</div>' : '')
    + '<div class="bar"><i style="width:'+Math.max(0,Math.min(100,o.pct))+'%;background:'+o.color+'"></i>'
    + (o.marker!=null ? '<u style="left:'+o.marker+'%"></u>' : '')+'</div>'
    + '<div class="foot"><span>'+o.f1+'</span><span>'+o.f2+'</span></div>'
    + '</div>';
}
function dcls(v,gapIsGood){ if(gapIsGood===undefined) gapIsGood=true; return gapIsGood?"ok":"bad"; }

function renderKPI(){
  var p = sel().prod, k = agg(p);
  var isGrp = S.scope==="Group";
  var mt = isGrp ? agg(p.filter(function(r){return r[I.sbu]!==PACKI;})) : null;
  var bg = isGrp ? agg(p.filter(function(r){return r[I.sbu]===PACKI;})) : null;
  var u = unitLbl();
  var outTxt = isGrp ? (nf(mt.out)+" MT + "+nf(bg.out)+" bags") : (nf(k.out)+" "+u);
  var ach = isGrp ? mt.ach : k.ach;
  var achOut = isGrp ? mt.achOut : k.achOut;

  /* --- strip 1 --- */
  $id("kpis").innerHTML =
    kpiCard({lab:"Overall OEE", val:pc(k.OEE), color:hexOee(k.OEE), tgt:"vs "+T.OEE+"% target · verified (A_eff × P × Q)", pct:k.OEE, marker:T.OEE,
      delta:(k.OEE>=T.OEE?"\u25B2 +":"\u25BC ")+f1(Math.abs(k.OEE-T.OEE))+" pts vs target", dcls:k.OEE>=T.OEE?"ok":"bad",
      f1:"A_eff "+f1(k.Aeff)+"% × P "+f1(k.Pc)+"% × Q "+f1(k.Q)+"%", f2:"as-logged "+f1(k.OEERep)+"% (Δ "+f1(k.oeeGap)+")"})
    + kpiCard({lab:"Availability (effective)", val:pc(k.Aeff), color:hexOee(k.Aeff*0.9), tgt:"vs "+T.A+"% target · after unlogged idle", pct:k.Aeff, marker:T.A,
      delta:(k.Aeff>=T.A?"\u25B2 +":"\u25BC ")+f1(Math.abs(k.Aeff-T.A))+" pts", dcls:k.Aeff>=T.A?"ok":"bad",
      f1:"NPT "+f1(k.nptpct)+"% · idle "+f1(k.idlepct)+"%", f2:"as-logged "+f1(k.A)+"% of PPT"})
    + kpiCard({lab:"Performance (throughput)", val:pc(k.P), color:(k.P>105?RAGCOL.warn:hexOee(k.P)), tgt:"vs "+T.P+"% target · Σ(CT×thru)÷run", pct:Math.min(k.P,100), marker:T.P,
      delta:(k.P>105?"\u26A0 standard loose":(k.P>=T.P?"\u25B2 on target":"\u25BC "))+f1(Math.abs(k.P-T.P))+" pts", dcls:(k.P>105?"warn":(k.P>=T.P?"ok":"bad")),
      f1:"capped "+f1(k.Pc)+"%", f2:"sheet-reported "+f1(k.Ps)+"%"})
    + kpiCard({lab:"Quality", val:pc(k.Q), color:hexOee(k.Q), tgt:"vs "+T.Q+"% target · good ÷ output", pct:k.Q, marker:T.Q,
      delta:(k.Q>=T.Q?"\u25B2 +":"\u25BC ")+f1(Math.abs(k.Q-T.Q))+" pts", dcls:k.Q>=T.Q?"ok":"bad",
      f1:"Good "+nf(k.good)+" "+u, f2:"Wastage "+f2(k.wstpct)+"% of throughput"})
    + kpiCard({lab:"Plan achievement", val:pc(ach), color:hexOee(ach*0.8), tgt:"throughput ÷ target ("+flowLbl().toLowerCase()+")", pct:ach, marker:100,
      delta:(ach>=100?"\u25B2 +":"\u25BC ")+f1(Math.abs(ach-100))+" pts vs plan", dcls:ach>=100?"ok":"bad",
      f1:"Throughput "+nf(isGrp?mt.flow:k.flow)+" "+u, f2:"output-based "+f1(achOut)+"% (incl. yield)"});

  /* --- strip 2 --- */
  $id("kpis2").innerHTML =
    kpiCard({lab:"Unplanned downtime (NPT)", val:pc(k.nptpct), color:(k.nptpct>35?RAGCOL.bad:(k.nptpct>20?RAGCOL.warn:RAGCOL.good)), tgt:"NPT ÷ planned production time", pct:k.nptpct,
      delta:nf(k.npt)+" min lost", dcls:k.nptpct>20?"bad":"ok",
      f1:"top loss driver", f2:"of "+nf(k.avail)+" min available"})
    + kpiCard({lab:"Unlogged / idle time", val:pc(k.idlepct), color:(k.idlepct>5?RAGCOL.bad:RAGCOL.good), tgt:"run logged with zero throughput", pct:k.idlepct,
      delta:nf(k.runIdle)+" min unaccounted", dcls:k.idlepct>5?"bad":"ok",
      f1:"data-integrity leak", f2:"invisible to sheet OEE"})
    + kpiCard({lab:"Yield / extraction", val:pc(k.yield), color:hexOee(k.yield), tgt:"usable output ÷ throughput", pct:Math.min(k.yield,100),
      delta:(k.yield>=95?"\u25B2 high yield":"\u25BC conversion loss"), dcls:k.yield>=95?"ok":"warn",
      f1:"out "+nf(k.out)+" ÷ in "+nf(k.flow), f2:(S.scope==="Packing"?"packer: 1:1 by design":"incl. by-products")})
    + kpiCard({lab:"Wastage", val:pc(k.wstpct,2), color:(k.wstpct>2?RAGCOL.warn:RAGCOL.good), tgt:"wastage ÷ throughput", pct:k.wstpct*10,
      delta:nf(k.wst)+" units written off", dcls:k.wstpct>2?"bad":"ok",
      f1:"material loss", f2:"on throughput basis (corrected)"})
    + kpiCard({lab:"TEEP / loading", val:pc(k.teep), color:hexOee(k.teep), tgt:"OEE × utilisation of operation time", pct:k.teep, marker:T.OEE,
      delta:"loading "+f1(k.loading)+"%", dcls:k.teep>=T.OEE?"ok":"bad",
      f1:"asset utilisation", f2:"avail "+nf(k.avail)+" ÷ op "+nf(k.op)+" min"});
}

/* ------------------------------------------------------- chart: waterfall */
function renderWaterfall(){
  var k = agg(sel().prod);
  var steps=[
    {n:"World-class", v:100, type:"start", c:"#1f2b3a", lab:"100%"},
    {n:"NPT loss", v:-k.lossNpt, type:"neg", c:"#ef4444", lab:f1(k.lossNpt)},
    {n:"Unlogged idle", v:-k.lossIdle, type:"neg", c:"#f472b6", lab:f1(k.lossIdle)},
    {n:"Performance", v:-k.lossP, type:"neg", c:"#3b82f6", lab:f1(k.lossP)},
    {n:"Quality", v:-k.lossQ, type:"neg", c:"#a78bfa", lab:f1(k.lossQ)},
    {n:"Actual OEE", v:k.OEE, type:"end", c:hexOee(k.OEE), lab:f1(k.OEE)}
  ];
  var W=780,H=260,padL=44,padR=14,padT=26,padB=58,iw=W-padL-padR,ih=H-padT-padB;
  var n=steps.length,bw=iw/n*0.56,gap=iw/n;
  var y=function(v){ return padT+ih*(1-v/100); };
  var s="",cum=100;
  for(var i=0;i<n;i++){
    var st=steps[i],x=padL+gap*(i+0.5),bx=x-bw/2,top,ht;
    if(st.type==="start"){ top=y(100); ht=y(0)-y(100); }
    else if(st.type==="end"){ top=y(st.v); ht=y(0)-y(st.v); }
    else { var base=cum; cum+=st.v; top=y(base); ht=y(cum)-y(base); }
    s+='<rect x="'+bx.toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1,ht).toFixed(1)+'" rx="4" fill="'+st.c+'" opacity="'+(st.type==="neg"?0.92:1)+'"/>';
    s+='<text x="'+x.toFixed(1)+'" y="'+(top-6).toFixed(1)+'" font-size="11" font-weight="800" fill="#e9f0f8" text-anchor="middle">'+st.lab+(st.type==="neg"?"":'%')+'</text>';
    s+='<text x="'+x.toFixed(1)+'" y="'+(H-34)+'" font-size="9.2" fill="#8ea1b5" text-anchor="middle">'+st.n+'</text>';
    if(st.type==="neg"){ var yy=y(cum); s+='<line x1="'+bx.toFixed(1)+'" y1="'+yy.toFixed(1)+'" x2="'+(bx+bw).toFixed(1)+'" y2="'+yy.toFixed(1)+'" stroke="#243447" stroke-dasharray="4 4"/>'; }
  }
  for(var g=0;g<=100;g+=25){ var yv=y(g); s+='<line x1="'+padL+'" y1="'+yv.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yv.toFixed(1)+'" stroke="#141d29"/><text x="'+(padL-6)+'" y="'+(yv+3.5).toFixed(1)+'" font-size="9" fill="#5d7086" text-anchor="end">'+g+'%</text>'; }
  s+='<line x1="'+padL+'" y1="'+y(T.OEE).toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y(T.OEE).toFixed(1)+'" stroke="#f59e0b" stroke-dasharray="6 4" opacity=".8"/>';
  s+='<text x="'+(W-padR)+'" y="'+(y(T.OEE)-4).toFixed(1)+'" font-size="9.5" fill="#f59e0b" text-anchor="end">target '+T.OEE+'%</text>';
  $id("waterfall").innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto">'+s+'</svg>'
    + '<div class="legend"><span><span class="dot" style="background:#ef4444"></span>NPT <b>'+f1(k.lossNpt)+' pts</b></span>'
    + '<span><span class="dot" style="background:#f472b6"></span>Unlogged idle <b>'+f1(k.lossIdle)+' pts</b></span>'
    + '<span><span class="dot" style="background:#3b82f6"></span>Performance <b>'+f1(k.lossP)+' pts</b></span>'
    + '<span><span class="dot" style="background:#a78bfa"></span>Quality <b>'+f1(k.lossQ)+' pts</b></span>'
    + '<span>Total lost <b>'+f1(100-k.OEE)+' pts</b></span></div>';
}

/* --------------------------------------------------------- chart: donut */
function renderDonut(){
  var k = agg(sel().prod);
  var eff=k.runEff, idle=k.runIdle, npt=k.npt, pdt=k.pdt;
  var tot=eff+idle+npt+pdt||1;
  var aEff=eff/tot*100,aIdle=idle/tot*100,aNpt=npt/tot*100,aPdt=pdt/tot*100;
  var seg='#2dd4bf 0 '+aEff+'%, #f472b6 '+aEff+'% '+(aEff+aIdle)+'%, #ef4444 '+(aEff+aIdle)+'% '+(aEff+aIdle+aNpt)+'%, #3b82f6 '+(aEff+aIdle+aNpt)+'% 100%';
  $id("timedonut").innerHTML=
    '<div class="gauge"><div style="width:150px;height:150px;border-radius:50%;background:conic-gradient('+seg+');display:flex;align-items:center;justify-content:center;flex:0 0 auto">'
    + '<div style="width:106px;height:106px;background:#0b121b;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center">'
    + '<b style="font-size:20px">'+nf(k.op)+'</b><span class="dim" style="font-size:9.5px">operation min</span></div></div>'
    + '<div style="flex:1;min-width:190px">'
    + '<div class="legend" style="flex-direction:column;gap:7px;margin:0">'
    + '<span><span class="dot" style="background:#2dd4bf"></span>Effective run <b>'+nf(eff)+' min ('+f1(aEff)+'%)</b></span>'
    + '<span><span class="dot" style="background:#f472b6"></span>Unlogged idle <b>'+nf(idle)+' min ('+f1(aIdle)+'%)</b></span>'
    + '<span><span class="dot" style="background:#ef4444"></span>Unplanned NPT <b>'+nf(npt)+' min ('+f1(aNpt)+'%)</b></span>'
    + '<span><span class="dot" style="background:#3b82f6"></span>Planned DT <b>'+nf(pdt)+' min ('+f1(aPdt)+'%)</b></span></div>'
    + '<div class="insight" style="margin-top:11px"><span class="ic">&#9201;</span><span>Lost throughput capacity &asymp; <b>'+nf(k.nptUnits+k.idleUnits+ (k.rate>0?k.perfLossMin*k.rate:0))+' '+unitLbl()+'</b>; quality loss <b>'+nf(k.out-k.good)+' '+unitLbl()+'</b>.</span></div>'
    + '</div></div>';
}

/* --------------------------------------------------------- insight row */
function renderInsights(){
  var p=sel().prod, k=agg(p), cls=classesTotals(p);
  var rows=topReasons(1);
  var demand=cls["Demand / Order-book"]||0;
  var tot=0; for(var c in cls) tot+=cls[c];
  var a,b,c2;
  var constraint = (k.lossNpt>=k.lossIdle && k.lossNpt>=k.lossP && k.lossNpt>=k.lossQ) ? "NPT"
    : (k.lossIdle>=k.lossP && k.lossIdle>=k.lossQ) ? "unlogged idle" : (k.lossP>=k.lossQ)?"performance":"quality";
  a='<div class="insight"><span class="ic">&#128200;</span><span><b>Binding constraint: '+constraint+'.</b> OEE '+f1(k.OEE)+
    '% = A_eff '+f1(k.Aeff)+'% × P '+f1(k.Pc)+'% × Q '+f1(k.Q)+'%. Availability-side loss '+
    f1(k.lossA)+' pts (NPT '+f1(k.lossNpt)+' + idle '+f1(k.lossIdle)+') dominates.</span></div>';
  var dp = tot>0 ? demand/tot*100 : 0;
  b= dp>0
    ? '<div class="insight warn"><span class="ic">&#128230;</span><span><b>Demand-side drag:</b> '+f1(dp)+'% of all downtime ('+nf(demand)+' min) is order-book driven. Separate <b>Demand-OEE</b> from <b>Equipment-OEE</b> in governance.</span></div>'
    : '<div class="insight good"><span class="ic">&#128230;</span><span>No demand-driven downtime recorded in this range.</span></div>';
  var tr=rows[0];
  c2= tr
    ? '<div class="insight bad"><span class="ic">&#128308;</span><span><b>#1 loss:</b> "'+esc(tr.n)+'" &mdash; '+nf(tr.min)+' min across '+tr.cnt+' events ('+f1(tr.pct)+'% of unplanned downtime).</span></div>'
    : '<div class="insight good"><span class="ic">&#9989;</span><span>No unplanned losses recorded in this range.</span></div>';
  $id("insightRow").innerHTML=a+b+c2;
}

/* ------------------------------------------------------------ loss tree */
function renderLossTree(){
  var k=agg(sel().prod);
  var perfMin=k.perfLossMin, qualMin=k.qualLossMin;
  var ideal=k.moments.ideal;
  function row(nm,sub,val,subv,col,pct){
    return '<div class="row"><span class="nm">'+nm+'<small>'+sub+'</small></span>'
      +'<span class="track" style="height:18px"><i style="width:'+Math.max(1.5,Math.min(100,pct)).toFixed(1)+'%;background:'+col+'"></i></span>'
      +'<span class="v" style="color:'+col+'">'+val+'<small>'+subv+'</small></span></div>';
  }
  var avail=k.avail||1;
  var html = '<div class="tree">';
  html += '<div class="row total"><span class="nm" style="color:#22d3ee">Planned production time<small>operation '+nf(k.op)+' − planned DT '+nf(k.pdt)+' min</small></span>'
        + '<span class="track" style="height:18px"><i style="width:100%;background:#22d3ee"></i></span>'
        + '<span class="v" style="color:#22d3ee">'+nf(k.avail)+'<small>min = 100%</small></span></div>';
  html += row("Unplanned downtime (NPT)","logged breakdowns &amp; stoppages",nf(k.npt),f1(k.nptpct)+"% of PPT","#ef4444",k.npt/avail*100);
  html += row("Unlogged / idle","logged run with zero throughput",nf(k.runIdle),f1(k.idlepct)+"% of PPT","#f472b6",k.runIdle/avail*100);
  html += row("Performance loss","ran slower than ideal CT",nf(perfMin),f1(perfMin/avail*100)+"% of PPT","#3b82f6",perfMin/avail*100);
  html += row("Quality loss","good ÷ output shortfall",nf(qualMin),f1(qualMin/avail*100)+"% of PPT","#a78bfa",qualMin/avail*100);
  var productive=Math.max(0,avail-k.npt-k.runIdle-perfMin-qualMin);
  html += '<div class="row total"><span class="nm" style="color:#22c55e">Effective productive time<small>theoretical time to make good output</small></span>'
        + '<span class="track" style="height:18px"><i style="width:'+Math.max(1.5,productive/avail*100).toFixed(1)+'%;background:#22c55e"></i></span>'
        + '<span class="v" style="color:#22c55e">'+nf(productive)+'<small>'+f1(productive/avail*100)+'% of PPT</small></span></div>';
  html += '</div>';
  html += '<div class="legend"><span>ideal time to make this output <b>'+nf(ideal)+' min</b></span>'
        + '<span>throughput rate <b>'+f2(k.rate)+' '+unitLbl()+'/min</b></span>'
        + '<span>OEE <b style="color:'+hexOee(k.OEE)+'">'+f1(k.OEE)+'%</b></span></div>';
  $id("losstree").innerHTML=html;
}

/* ---------------------------------------------------- data integrity */
function renderDQ(){
  var p=sel().prod, k=agg(p);
  var phantom=0, phantomMin=0, ident=0;
  for(var i=0;i<p.length;i++){ var r=p[i];
    if(Math.abs(r[I.run]-(r[I.op]-r[I.pdt]-r[I.npt]))>0.5) ident++;
    if(r[I.run]>0 && r[I.flow]<=0){ phantom++; phantomMin+=r[I.run]; }
  }
  var pDiv=Math.abs(k.P-k.Ps);
  function stat(l,v,s,col){
    return '<div class="stat"'+(col?' style="border-color:'+col+'35"':'')+'><div class="l">'+l+'</div><div class="v"'+(col?' style="color:'+col+'"':'')+'>'+v+'</div><div class="s">'+s+'</div></div>';
  }
  var html='<div class="grid g2">'
    + stat("Rows in range",nf(p.length),"production records")
    + stat("Run = op−pdt−npt",nf(p.length-ident)+" / "+nf(p.length),"time-identity consistent",ident?"#f59e0b":"#22c55e")
    + stat("Phantom run rows",nf(phantom),nf(phantomMin)+" min with zero throughput",phantom?"#ef4444":"#22c55e")
    + stat("Standard divergence",f1(pDiv)+" pts","P(throughput) "+f1(k.P)+"% vs sheet "+f1(k.Ps)+"%",pDiv>15?"#f59e0b":"#22c55e")
    + '</div>';
  var notes=[];
  if(k.idlepct>5) notes.push('<b>'+f1(k.idlepct)+'%</b> of planned time is logged as running with <b>zero throughput</b> ('+nf(k.runIdle)+' min) &mdash; unlogged downtime. It is invisible to the sheet OEE and depresses true availability to '+f1(k.Aeff)+'%.');
  if(k.P>105) notes.push('Throughput Performance <b>'+f1(k.P)+'%</b> &gt; 100% &rarr; the ideal cycle-time / capacity standard is too loose. Flag for <b>SMV / standard re-validation</b> before using it for incentive or capacity planning.');
  if(phantom>0) notes.push('<b>'+nf(phantom)+'</b> records run with no material flow &mdash; investigate logging discipline at the entry point.');
  if(ident>0) notes.push('<b>'+nf(ident)+'</b> rows break the time identity (run ≠ op−pdt−npt) &mdash; minor rounding / data-entry noise.');
  if(!notes.length) notes.push('No material integrity issues detected in this range.');
  html += '<div class="insight '+(k.idlepct>5?'bad':'good')+'" style="margin-top:12px"><span class="ic">&#128269;</span><span>'+notes.join('<br>')+'</span></div>';
  $id("dqPanel").innerHTML=html;
}

/* ------------------------------------------------------------ bar list */
function barList(el, items, opts){
  opts=opts||{};
  var max=Math.max.apply(null, items.map(function(x){return x.v;}).concat([1]));
  var html=items.map(function(x){
    var w=Math.max(1.5,x.v/max*100);
    var c=opts.color?opts.color(x):"#22d3ee";
    return '<div class="bl" style="--w:'+(opts.w||170)+'px">'
      +'<span class="nm" title="'+esc(x.n)+'">'+esc(x.n)+'</span>'
      +'<span class="track"><i style="width:'+w.toFixed(1)+'%;background:'+c+'"></i>'
      +(opts.target!=null?'<u style="left:'+opts.target+'%"></u>':'')+'</span>'
      +'<span class="v" style="color:'+c+'">'+(opts.fmt?opts.fmt(x.v):nf(x.v))+'</span></div>';
  }).join("");
  $id(el).innerHTML=html||'<div class="muted">No data for this selection.</div>';
}
function renderClasses(){
  var cls=classesTotals(sel().prod);
  var arr=[]; for(var c in cls){ if(cls[c]>0) arr.push({n:c,v:cls[c]}); }
  arr.sort(function(a,b){return b.v-a.v;});
  var tot=arr.reduce(function(a,b){return a+b.v;},0)||1;
  barList("classes", arr.map(function(x){return {n:x.n,v:x.v};}), {color:function(x){return CLS_COLOR[x.n]||"#22d3ee";},w:200,fmt:function(v){return nf(v)+"m";}});
  $id("classes").innerHTML += '<div class="legend">'+arr.map(function(x){
    return '<span><span class="dot" style="background:'+(CLS_COLOR[x.n]||"#22d3ee")+'"></span>'+x.n+' <b>'+f1(x.v/tot*100)+'%</b></span>';
  }).join("")+'<span class="dim">total '+nf(tot)+' min</span></div>';
}
function renderCatPareto(){
  var ct=catsTotals(sel().prod);
  var arr=[]; for(var i=0;i<CATK.length;i++){ if(ct[CATK[i]]>0) arr.push({k:CATK[i],n:M.catlabel[CATK[i]],v:ct[CATK[i]]}); }
  arr.sort(function(a,b){return b.v-a.v;});
  $id("catpareto").innerHTML = paretoSVG(arr);
}
function paretoSVG(items){
  if(!items||!items.length) return '<div class="muted">No data.</div>';
  var W=760,H=300,padL=46,padR=40,padT=16,padB=100,iw=W-padL-padR,ih=H-padT-padB;
  var max=Math.max.apply(null,items.map(function(x){return x.v;}))||1;
  var n=items.length,bw=iw/n*0.62;
  var x=function(i){return padL+iw*(i+0.5)/n;};
  var y=function(v){return padT+ih*(1-v/max);};
  var s="";
  for(var g=0;g<=4;g++){ var yy=padT+ih*g/4, vv=max*(1-g/4);
    s+='<line x1="'+padL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yy.toFixed(1)+'" stroke="#141d29"/>';
    s+='<text x="'+(padL-6)+'" y="'+(yy+3.5).toFixed(1)+'" font-size="9" fill="#5d7086" text-anchor="end">'+Math.round(vv)+'</text>'; }
  var pts=[],cum=0,tot=items.reduce(function(a,b){return a+b.v;},0)||1;
  items.forEach(function(it,i){
    var bx=x(i)-bw/2,by=y(it.v),c=CAT_COLOR[it.k]||"#22d3ee";
    s+='<rect x="'+bx.toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+(padT+ih-by).toFixed(1)+'" rx="3" fill="'+c+'" opacity=".9"/>';
    s+='<text x="'+x(i).toFixed(1)+'" y="'+(by-5).toFixed(1)+'" font-size="9.6" fill="#cfe0ee" text-anchor="middle">'+nf(it.v)+'</text>';
    var t=it.n.replace(/ \(.*?\)/g,"");
    var words=t.split(/\s+/), l1=words.slice(0,2).join(" ");
    s+='<text x="'+x(i).toFixed(1)+'" y="'+(H-padB+16)+'" font-size="9" fill="#8ea1b5" text-anchor="end" transform="rotate(-35 '+x(i).toFixed(1)+' '+(H-padB+16)+')">'+esc(l1.slice(0,18))+'</text>';
    cum+=it.v; pts.push([x(i), padT+ih*(1-cum/tot)]);
  });
  s+='<polyline fill="none" stroke="#f59e0b" stroke-width="2" points="'+pts.map(function(p){return p[0].toFixed(1)+","+p[1].toFixed(1);}).join(" ")+'"/>';
  pts.forEach(function(p){ s+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.8" fill="#f59e0b"/>'; });
  s+='<text x="'+(W-padR)+'" y="'+(padT+8)+'" font-size="9.5" fill="#f59e0b" text-anchor="end">cumulative %</text>';
  return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto">'+s+'</svg>';
}

/* ------------------------------------------------------------- reasons */
function topReasons(max){
  var bd=sel().bd;
  var aggMap={}, tot=0;
  for(var i=0;i<bd.length;i++){
    var r=bd[i]; if(r[BI.planned]) continue;
    var ri=r[BI.reason], key=DI.reason[ri]||"(unspecified)";
    if(!aggMap[key]) aggMap[key]={n:key,min:0,cnt:0,cat:DI.reason_meta[ri]?DI.reason_meta[ri].cat:"",cls:DI.reason_meta[ri]?DI.reason_meta[ri].cls:""};
    aggMap[key].min+=r[BI.min]; aggMap[key].cnt++; tot+=r[BI.min];
  }
  var arr=[]; for(var k in aggMap) arr.push(aggMap[k]);
  arr.sort(function(a,b){return b.min-a.min;});
  var cum=0;
  for(var j=0;j<arr.length;j++){ cum+=arr[j].min; arr[j].pct=tot?arr[j].min/tot*100:0; arr[j].cum=tot?cum/tot*100:0; }
  return max? arr.slice(0,max) : arr;
}
function renderReasons(){
  var rs=topReasons(30);
  if(!rs.length){ $id("reasons").innerHTML='<div class="muted">No unplanned downtime reasons recorded.</div>'; return; }
  var rows=rs.map(function(x,i){
    var c=CLS_COLOR[x.cls]||"#22d3ee";
    var flag = x.cum<=80 ? '<span class="tagc" style="background:rgba(239,68,68,.16);color:#fca5a5">80/20</span>'
      : (x.cum<=95?'<span class="tagc" style="background:rgba(245,158,11,.14);color:#fcd34d">vital</span>':'<span class="tagc" style="background:rgba(100,116,139,.2);color:#cbd5e1">trivial</span>');
    return '<tr><td class="dim num">'+(i+1)+'</td><td>'+esc(x.n)+'<div class="dim" style="font-size:10px">'+esc(x.cat)+'</div></td>'
      +'<td class="num">'+nf(x.min)+'</td><td class="num">'+f1(x.pct)+'%</td><td class="num">'+f1(x.cum)+'%</td>'
      +'<td><span class="tagc" style="background:'+c+'22;color:'+c+'">'+x.cls+'</span></td><td>'+flag+'</td></tr>';
  }).join("");
  $id("reasons").innerHTML='<table><thead><tr><th>#</th><th>Reason</th><th class="num">Min</th><th class="num">%</th><th class="num">Cum</th><th>Loss class</th><th>Flag</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
function renderReliability(){
  var k=agg(sel().prod), rel=reliability(sel().bd);
  var mtbf=rel.ev?k.run/rel.ev:0, eqmtbf=rel.eq?k.run/rel.eq:0;
  $id("reliability").innerHTML=
    '<div class="grid g2">'
    +'<div class="stat"><div class="l">Unplanned events</div><div class="v">'+nf(rel.ev)+'</div><div class="s">logged downtime entries</div></div>'
    +'<div class="stat"><div class="l">Total downtime</div><div class="v">'+nf(rel.dt)+'</div><div class="s">minutes</div></div>'
    +'<div class="stat"><div class="l">MTTR &mdash; all</div><div class="v">'+nf(rel.mttr)+' <small>min</small></div><div class="s">average per event</div></div>'
    +'<div class="stat"><div class="l">MTBF &mdash; all</div><div class="v">'+nf(mtbf)+' <small>min</small></div><div class="s">run &divide; events</div></div>'
    +'<div class="stat" style="border-color:rgba(239,68,68,.35)"><div class="l">Equipment MTTR</div><div class="v" style="color:#fca5a5">'+nf(rel.eqmttr)+' <small>min</small></div><div class="s">'+nf(rel.eq)+' mech/elec failures</div></div>'
    +'<div class="stat" style="border-color:rgba(34,197,94,.3)"><div class="l">Equipment MTBF</div><div class="v" style="color:#86efac">'+nf(eqmtbf)+' <small>min</small></div><div class="s">true reliability interval</div></div>'
    +'</div>';
  var bd=sel().bd, tm={};
  for(var i=0;i<bd.length;i++){ if(bd[i][BI.planned]) continue; var t=DI.bdtype[bd[i][BI.bdtype]]; tm[t]=(tm[t]||0)+bd[i][BI.min]; }
  var arr=[]; for(var k2 in tm) arr.push({n:k2,v:tm[k2]}); arr.sort(function(a,b){return b.v-a.v;});
  var max=Math.max.apply(null,arr.map(function(x){return x.v;}).concat([1]));
  $id("bdtypes").innerHTML='<div class="muted" style="font-size:10px;letter-spacing:1.4px;text-transform:uppercase;margin-bottom:7px">Breakdown type mix</div>'
    + arr.slice(0,8).map(function(x){
      return '<div class="bl" style="--w:160px"><span class="nm">'+esc(x.n)+'</span>'
      +'<span class="track"><i style="width:'+Math.max(1.5,x.v/max*100).toFixed(1)+'%;background:#22d3ee"></i></span>'
      +'<span class="v">'+nf(x.v)+'m</span></div>';
    }).join("");
}

/* ------------------------------------------------------- entity boards */
function entityBoard(el, items, chgAct){
  if(!items||!items.length){ $id(el).innerHTML='<div class="muted">No data for this scope/range.</div>'; return; }
  var best=items.reduce(function(a,b){return b.OEE>a.OEE?b:a;});
  var worst=items.reduce(function(a,b){return b.OEE<a.OEE?b:a;});
  var html=items.map(function(s){
    var c=hexOee(s.OEE);
    var rg=rag(s.Aeff,T.A);
    return '<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;align-items:baseline">'
      +'<span style="font-weight:700;font-size:12.5px">'+esc(s.label||s.name)+'</span>'
      +'<span style="font-weight:800;font-size:15px;color:'+c+'">'+f1(s.OEE)+'%</span></div>'
      +'<span class="track" style="margin:4px 0 3px;height:12px"><i style="width:'+Math.max(0,Math.min(100,s.OEE)).toFixed(1)+'%;background:'+c+'"></i>'
      +'<u style="left:'+T.OEE+'%"></u></span>'
      +'<div class="dim" style="font-size:10.5px">A<sub>eff</sub> <b style="color:'+RAGCOL[rg]+'">'+f1(s.Aeff)+'%</b> · P '+f1(s.Pc)+'% · Q '+f1(s.Q)+'% · NPT '+f1(s.nptpct)+'% · out '+nf(s.out)+'</div></div>';
  }).join("");
  $id(el).innerHTML=html
    +'<div class="legend"><span class="dim">white line = '+T.OEE+'% OEE target</span><span>best <b style="color:#86efac">'+esc(best.label||best.name)+' '+f1(best.OEE)+'%</b></span>'
    +'<span>worst <b style="color:#fca5a5">'+esc(worst.label||worst.name)+' '+f1(worst.OEE)+'%</b></span></div>';
}
function renderBoards(){
  var p=sel().prod;
  entityBoard("shifts", byEntityName(p,"sh"));
  entityBoard("lines", S.scope==="Group"?[]:byEntityName(p,"ln"));
  entityBoard("products", S.scope==="Group"?[]:byEntityName(p,"pr"));
  entityBoard("machines", S.scope==="Group"?[]:byEntityName(p,"mc"));
  if(S.scope==="Group"){
    $id("lines").innerHTML='<div class="muted">Line / mill view is available at SBU scope &mdash; group mixes lines across SBUs. Pick a scope above.</div>';
    $id("products").innerHTML='<div class="muted">Product view is available at SBU scope.</div>';
    $id("machines").innerHTML='<div class="muted">Machine view is available at SBU scope.</div>';
  }
}

/* -------------------------------------------------------- cost of loss */
function renderCost(){
  var p=sel().prod, k=agg(p);
  var isGrp=S.scope==="Group";
  var scopeList = isGrp ? SBU : [S.scope];
  var lostMin=k.npt+k.runIdle+k.perfLossMin;
  var lostUnits = k.rate>0 ? lostMin*k.rate : 0;
  var qualUnits = k.out-k.good;
  var totalUnits = lostUnits+qualUnits;
  var rate = RATES[S.scope]||0;
  var cost = totalUnits*rate;
  var rowsHtml = '<tr><td>Unplanned downtime</td><td class="num">'+nf(k.npt)+'</td><td class="num">'+f1(k.nptpct)+'%</td></tr>'
    +'<tr><td>Unlogged / idle</td><td class="num">'+nf(k.runIdle)+'</td><td class="num">'+f1(k.idlepct)+'%</td></tr>'
    +'<tr><td>Performance (slow running)</td><td class="num">'+nf(k.perfLossMin)+'</td><td class="num">'+f1(k.moments.avail?k.perfLossMin/k.moments.avail*100:0)+'%</td></tr>'
    +'<tr><td>Quality rejects</td><td class="num">'+nf(k.qualLossMin)+'</td><td class="num">'+f1(k.qlosspct)+'%</td></tr>'
    +'<tr style="font-weight:800"><td>Total lost time</td><td class="num">'+nf(lostMin+k.qualLossMin)+'</td><td class="num">min</td></tr>';
  $id("costpanel").innerHTML=
    '<div class="grid g2" style="margin-bottom:12px">'
    +'<div class="stat"><div class="l">Lost throughput capacity</div><div class="v" style="color:#fca5a5">'+nf(lostUnits)+' <small>'+unitLbl()+'</small></div><div class="s">at ideal rate '+f2(k.rate)+' '+unitLbl()+'/min</div></div>'
    +'<div class="stat"><div class="l">Quality loss</div><div class="v" style="color:#fcd34d">'+nf(qualUnits)+' <small>'+unitLbl()+'</small></div><div class="s">output − good output</div></div>'
    +'</div>'
    +'<table><thead><tr><th>Loss bucket</th><th class="num">Minutes</th><th class="num">% of PPT</th></tr></thead><tbody>'+rowsHtml+'</tbody></table>'
    +'<div class="grid g2" style="margin-top:12px;align-items:end">'
    +'<div><div class="l muted" style="font-size:9.6px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800">Conversion value (BDT per '+unitLbl().replace(/s$/,"")+')</div>'
    +'<input class="rate" id="rateIn" type="number" min="0" step="any" placeholder="e.g. 45" value="'+(rate||"")+'"/></div>'
    +'<div class="stat"><div class="l">Cost of loss</div><div class="v" style="color:'+(cost>0?"#fca5a5":"#5d7086")+'">'+(cost>0?("&#2547; "+nf(cost)):"—")+'</div><div class="s">'+(rate>0?nf(totalUnits)+" units × "+f2(rate)+" BDT":"enter a rate to monetise")+'</div></div>'
    +'</div>'
    +'<div class="insight" style="margin-top:12px"><span class="ic">&#128176;</span><span>Enter your contribution margin / conversion cost per unit to convert lost time into BDT. Packing is priced per bag, mills per MT &mdash; set each scope separately (rates are remembered in this browser).</span></div>';
  var ri=$id("rateIn");
  if(ri) ri.addEventListener("input",function(){ RATES[S.scope]=parseFloat(this.value)||0; saveRates(); renderCost(); });
}

/* -------------------------------------------------------------- alerts */
function renderAlerts(){
  var p=sel().prod, k=agg(p);
  var A=[];
  function add(sev,txt){ A.push({sev:sev,txt:txt}); }
  if(k.idlepct>5) add("critical","<b>Unlogged idle time</b> is "+f1(k.idlepct)+"% of planned time ("+nf(k.runIdle)+" min). Effective availability is only "+f1(k.Aeff)+"% vs "+f1(k.A)+"% as-logged. Fix logging discipline + chase the idle root cause.");
  if(k.P>105) add("high","<b>Standard too loose:</b> throughput Performance "+f1(k.P)+"% &gt; 100%. Re-validate ideal cycle time / SMV before using for incentives or capacity promises.");
  if(k.OEE<T.OEE-15) add("critical","<b>OEE "+f1(k.OEE)+"%</b> is "+f1(T.OEE-k.OEE)+" pts below the "+T.OEE+"% target. Availability-side loss dominates.");
  else if(k.OEE<T.OEE) add("high","<b>OEE "+f1(k.OEE)+"%</b> is "+f1(T.OEE-k.OEE)+" pts below the "+T.OEE+"% target.");
  if(k.nptpct>40) add("high","<b>NPT is "+f1(k.nptpct)+"%</b> of planned production time &mdash; more than 2 of every 5 available minutes are lost.");
  var cls=classesTotals(p); var tot=0; for(var c in cls) tot+=cls[c];
  if(tot>0 && (cls["Demand / Order-book"]||0)/tot>0.35) add("high","<b>Demand-side losses</b> are "+f1((cls["Demand / Order-book"]||0)/tot*100)+"% of downtime &mdash; a sales/S&OP issue, not an equipment issue. Split Demand-OEE vs Equipment-OEE.");
  var rs=topReasons(1); if(rs.length && rs[0].cum>=50) add("medium","Single reason <b>\""+esc(rs[0].n)+"\"</b> = "+f1(rs[0].pct)+"% of unplanned downtime &mdash; classic focused-improvement target.");
  if(k.wstpct>2) add("medium","<b>Wastage "+f2(k.wstpct)+"%</b> of throughput &mdash; hits conversion cost and yield directly.");
  if(k.yield>0 && k.yield<90 && S.scope!=="Packing") add("medium","<b>Yield "+f1(k.yield)+"%</b> &mdash; conversion/extraction below the expected band; audit by-product &amp; reject streams.");
  var sh=byEntityName(sel().prod,"sh");
  if(sh.length>1){ var b=Math.max.apply(null,sh.map(function(x){return x.OEE;})), w=Math.min.apply(null,sh.map(function(x){return x.OEE;})); if(b-w>12) add("high","<b>Shift spread "+f1(b-w)+" pts</b> ("+f1(w)+"% to "+f1(b)+"%). Best shift proves the level &mdash; codify standard work."); }
  if(!A.length) add("low","No exceptions in this selection &mdash; performance within expected bands.");
  $id("alerts").innerHTML=A.map(function(a){
    var c=SEV[a.sev]||"#22d3ee";
    return '<div class="alert"><span class="sev" style="background:'+c+'22;color:'+c+'">'+a.sev.toUpperCase()+'</span><span class="tx">'+a.txt+'</span></div>';
  }).join("");
}

/* ------------------------------------------------------------- monthly */
function renderMonthly(){
  var p=sel().prod;
  var bym={}, ord=[];
  for(var i=0;i<p.length;i++){ var m=DATES[p[i][I.d]].slice(0,7); if(!bym[m]){bym[m]=[];ord.push(m);} bym[m].push(p[i]); }
  ord.sort();
  var ms=ord.map(function(m){ var a=agg(bym[m]); a.m=m; return a; });
  if(!ms.length){ $id("monthly").innerHTML='<div class="muted">No monthly data in range.</div>'; return; }
  var W=1180,H=300,padL=46,padR=46,padT=18,padB=42,iw=W-padL-padR,ih=H-padT-padB;
  var maxOut=Math.max.apply(null,ms.map(function(m){return m.out;}).concat([1]));
  var n=ms.length,bw=iw/n*0.56;
  var x=function(i){return padL+iw*(i+0.5)/n;};
  var yO=function(v){return padT+ih*(1-v/maxOut);};
  var yE=function(v){return padT+ih*(1-v/100);};
  var s="",bars="",xt="";
  ms.forEach(function(m,i){
    bars+='<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+yO(m.out).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0,padT+ih-yO(m.out)).toFixed(1)+'" rx="2" fill="#164e63" opacity=".85"/>';
    if(ms.length<=26) xt+='<text x="'+x(i).toFixed(1)+'" y="'+(H-22)+'" font-size="8.6" fill="#5d7086" text-anchor="end" transform="rotate(-38 '+x(i).toFixed(1)+' '+(H-22)+')">'+m.m+'</text>';
  });
  var pts=ms.map(function(m,i){return [x(i),yE(m.OEE)];});
  var line='<polyline fill="none" stroke="#2dd4bf" stroke-width="2.4" points="'+pts.map(function(q){return q[0].toFixed(1)+","+q[1].toFixed(1);}).join(" ")+'"/>';
  var dots=pts.map(function(q,i){ var c=hexOee(ms[i].OEE); return '<circle cx="'+q[0].toFixed(1)+'" cy="'+q[1].toFixed(1)+'" r="3" fill="'+c+'"/>'; }).join("");
  var tgt='<line x1="'+padL+'" y1="'+yE(T.OEE).toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yE(T.OEE).toFixed(1)+'" stroke="#f59e0b" stroke-dasharray="6 4" opacity=".75"/>'
    +'<text x="'+(W-padR)+'" y="'+(yE(T.OEE)-4).toFixed(1)+'" font-size="9" fill="#f59e0b" text-anchor="end">OEE target '+T.OEE+'%</text>';
  for(var g=0;g<=100;g+=25){ var yy=yE(g); s+='<line x1="'+padL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yy.toFixed(1)+'" stroke="#141d29"/><text x="'+(padL-6)+'" y="'+(yy+3.5).toFixed(1)+'" font-size="9" fill="#5d7086" text-anchor="end">'+g+'%</text>'; }
  $id("monthly").innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto">'+s+tgt+bars+line+dots+xt
    +'<text x="'+padL+'" y="11" font-size="9.5" fill="#164e63">\u25a0 output ('+unitLbl()+')</text>'
    +'<text x="'+(padL+170)+'" y="11" font-size="9.5" fill="#2dd4bf">\u2014 OEE % (verified)</text></svg>';
  $id("monthlyTtl").innerHTML='Monthly OEE &amp; output <span class="tag">bars = output \u00b7 line = OEE% \u00b7 '+ms.length+' months \u00b7 range '+S.from+' \u2192 '+S.to+'</span>';
}

/* --------------------------------------------------------------- daily */
function renderDaily(){
  var p=sel().prod;
  var byd={}, ord=[];
  for(var i=0;i<p.length;i++){ var d=DATES[p[i][I.d]]; if(!byd[d]){byd[d]=[];ord.push(d);} byd[d].push(p[i]); }
  ord.sort();
  var ds=ord.map(function(d){ var a=agg(byd[d]); a.d=d; return a; });
  if(ds.length<2){ $id("daily").innerHTML='<div class="muted">Not enough daily data in range.</div>'; return; }
  var W=1180,H=250,padL=46,padR=46,padT=16,padB=30,iw=W-padL-padR,ih=H-padT-padB;
  var step=Math.ceil(ds.length/400);
  ds=ds.filter(function(_,i){return i%step===0||i===ds.length-1;});
  var maxN=Math.max.apply(null,ds.map(function(d){return d.npt;}).concat([1]));
  var n=ds.length,bw=iw/n*0.72;
  var x=function(i){return padL+iw*(i+0.5)/n;};
  var yE=function(v){return padT+ih*(1-v/100);};
  var yN=function(v){return padT+ih*(1-v/maxN);};
  var s="",bars="";
  ds.forEach(function(d,i){ bars+='<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+yN(d.npt).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0,padT+ih-yN(d.npt)).toFixed(1)+'" fill="#7f1d1d" opacity=".55"/>'; });
  var pts=ds.map(function(d,i){return [x(i),yE(d.OEE)];});
  var line='<polyline fill="none" stroke="#2dd4bf" stroke-width="2" points="'+pts.map(function(q){return q[0].toFixed(1)+","+q[1].toFixed(1);}).join(" ")+'"/>';
  var tgt='<line x1="'+padL+'" y1="'+yE(T.OEE).toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yE(T.OEE).toFixed(1)+'" stroke="#f59e0b" stroke-dasharray="6 4" opacity=".7"/>';
  for(var g=0;g<=100;g+=25){ var yy=yE(g); s+='<line x1="'+padL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yy.toFixed(1)+'" stroke="#141d29"/><text x="'+(padL-6)+'" y="'+(yy+3.5).toFixed(1)+'" font-size="9" fill="#5d7086" text-anchor="end">'+g+'%</text>'; }
  var last=ds[ds.length-1];
  $id("daily").innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto">'+s+tgt+bars+line
    +'<text x="'+padL+'" y="11" font-size="9.5" fill="#ef4444">\u25a0 unplanned NPT (min)</text>'
    +'<text x="'+(padL+170)+'" y="11" font-size="9.5" fill="#2dd4bf">\u2014 OEE %</text></svg>'
    +'<div class="legend"><span>latest <b>'+last.d+'</b> \u00b7 OEE <b style="color:'+hexOee(last.OEE)+'">'+f1(last.OEE)+'%</b> \u00b7 NPT <b>'+nf(last.npt)+' min</b> \u00b7 out <b>'+nf(last.out)+'</b></span>'
    +'<span class="dim">'+ds.length+' days shown</span></div>';
}

/* ------------------------------------------------------------ mix/yield */
function renderMix(){
  var p=sel().prod, mix=mixTotals(p), k=agg(p);
  var ks=[]; for(var i=0;i<MIXK.length;i++){ if(mix[MIXK[i]]>0) ks.push(MIXK[i]); }
  if(!ks.length){ $id("mix").innerHTML='<div class="muted">No product-mix columns recorded for this scope (packing reports bags only).</div>'; return; }
  ks.sort(function(a,b){return mix[b]-mix[a];});
  var max=Math.max.apply(null,ks.map(function(x){return mix[x];}).concat([1]));
  var isFlour=ks.indexOf("crush")>=0;
  $id("mix").innerHTML=
    '<div class="muted" style="margin-bottom:9px">'+S.scope+' \u00b7 '+S.from+' \u2192 '+S.to+' \u00b7 '+(isFlour?"wheat crushing \u2192 flour, suji &amp; bran":"raw cleaning \u2192 splits, bran &amp; by-products")+'</div>'
    + ks.map(function(x){
      var c=(x==="crush"||x==="clean_in")?"#f59e0b":"#2dd4bf";
      return '<div class="bl" style="--w:210px"><span class="nm">'+esc(M.mixlabel[x]||x)+'</span>'
        +'<span class="track"><i style="width:'+Math.max(1.5,mix[x]/max*100).toFixed(1)+'%;background:'+c+'"></i></span>'
        +'<span class="v">'+f2(mix[x])+'</span></div>';
    }).join("")
    + (isFlour
      ? '<div class="insight" style="margin-top:11px"><span class="ic">&#127806;</span><span>Wheat crushed <b>'+f2(mix.crush)+' MT</b> \u2192 flour <b>'+nf(k.out)+' MT</b> + suji '+f2(mix.suji||0)+' + coarse bran '+f2(mix.coarse_bran||0)+' + fine bran '+f2(mix.fine_bran||0)+' MT. <b>Extraction yield '+f1(k.yield)+'%</b>.</span></div>'
      : '<div class="insight" style="margin-top:11px"><span class="ic">&#127793;</span><span>Raw cleaned <b>'+f2(mix.clean_in||0)+' MT</b> \u2192 finished <b>'+nf(k.out)+' MT</b> (<b>yield '+f1(k.yield)+'%</b>); by-products '+(f2((mix.bran||0)+(mix.bran1||0)+(mix.bran2||0)+(mix.split||0)+(mix.broken||0)+(mix.dust||0)))+' MT.</span></div>');
}

/* -------------------------------------------------------------- compare */
function renderCompare(){
  var rows=[];
  for(var i=0;i<SBU.length;i++){
    var s=SBU[i], p=D.recs.filter(function(r){ return r[I.sbu]===i; });
    /* filtered by date */
    var lo=lb(S.from), hi=ub(S.to)-1;
    p=p.filter(function(r){ return r[I.d]>=lo && r[I.d]<=hi; });
    var a=agg(p); a.name=s; a.uom=UOM[s];
    var bd=D.bd.filter(function(x){ return x[BI.sbu]===i && x[BI.d]>=lo && x[BI.d]<=hi; });
    var rel=reliability(bd); a.mttr=rel.mttr;
    var ct=catsTotals(p), best=null, bv=-1;
    for(var c in ct){ if(ct[c]>bv){ bv=ct[c]; best=c; } }
    a.topcat = best?M.catlabel[best]:"\u2014";
    rows.push(a);
  }
  var html='<table><thead><tr><th>SBU</th><th class="num">OEE</th><th class="num">A<sub>eff</sub></th><th class="num">Perf</th><th class="num">Qual</th>'
    +'<th class="num">NPT%</th><th class="num">Idle%</th><th class="num">Yield%</th><th class="num">Output</th><th class="num">Ach%</th><th class="num">MTTR</th><th>Top loss category</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var c=hexOee(r.OEE);
    html+='<tr><td style="font-weight:700">'+esc(r.name)+'</td>'
      +'<td class="num" style="color:'+c+';font-weight:800">'+f1(r.OEE)+'%</td>'
      +'<td class="num" style="color:'+RAGCOL[rag(r.Aeff,T.A)]+'">'+f1(r.Aeff)+'%</td>'
      +'<td class="num">'+f1(r.Pc)+'%</td><td class="num">'+f1(r.Q)+'%</td>'
      +'<td class="num" style="color:'+RAGCOL[rag(100-r.nptpct,60)]+'">'+f1(r.nptpct)+'%</td>'
      +'<td class="num" style="color:'+RAGCOL[rag(5-r.idlepct,0)]+'">'+f1(r.idlepct)+'%</td>'
      +'<td class="num">'+f1(r.yield)+'%</td>'
      +'<td class="num">'+nf(r.out)+' <span class="dim">'+r.uom+'</span></td>'
      +'<td class="num">'+f1(r.ach)+'%</td><td class="num">'+nf(r.mttr)+'m</td>'
      +'<td class="dim">'+esc(r.topcat)+'</td></tr>';
  });
  html+='</tbody></table><div class="legend"><span class="dim">RAG on A<sub>eff</sub> vs '+T.A+'%, NPT, idle. Output units differ: Packing in bags, others in MT \u2014 compare OEE/A/P/Q, not raw output.</span></div>';
  $id("compare").innerHTML=html;
}

/* ------------------------------------------------------------- delivery */
function renderDelivery(){
  var dl=deliveryRows();
  if(!dl.length){ $id("delivery").innerHTML='<div class="muted">No delivery data.</div>'; return; }
  var body=dl.map(function(x){
    var ach=x[1]?(x[3]/x[1]*100):0;
    var c=ach>=100?"#22c55e":(ach>=60?"#f59e0b":"#ef4444");
    return '<tr><td>'+esc(x[0])+'</td><td class="num">'+nf(x[1])+'</td><td class="num">'+nf(x[2])+'</td><td class="num">'+nf(x[3])+'</td>'
      +'<td style="width:120px"><span class="track" style="height:12px"><i style="width:'+Math.min(100,ach).toFixed(0)+'%;background:'+c+'"></i></span></td>'
      +'<td class="num" style="color:'+c+'">'+f1(ach)+'%</td></tr>';
  }).join("");
  $id("delivery").innerHTML='<table><thead><tr><th>Product</th><th class="num">Target MT</th><th class="num">Del. bag</th><th class="num">Del. MT</th><th>Achievement</th><th class="num">%</th></tr></thead><tbody>'+body+'</tbody></table>';
}

/* --------------------------------------------------------------- energy */
function renderEnergy(){
  var e=elecRows();
  if(!e.length){ $id("energy").innerHTML='<div class="muted">No energy data captured.</div>'; return; }
  var body=e.map(function(x){
    var inten=x[2]?x[1]/x[2]:0;
    return '<tr><td>'+x[0]+'</td><td class="num">'+nf(x[1])+'</td><td class="num">'+nf(x[2])+'</td>'
      +'<td class="num">'+f2(inten)+'</td><td class="num">'+nf(x[3])+'</td></tr>';
  }).join("");
  var lastE=e[e.length-1]; var lastI=lastE[2]?lastE[1]/lastE[2]:0;
  $id("energy").innerHTML='<table><thead><tr><th>Month</th><th class="num">kWh</th><th class="num">Prod (MT)</th><th class="num">kWh/MT</th><th class="num">Cost (BDT)</th></tr></thead><tbody>'+body+'</tbody></table>'
    +'<div class="insight" style="margin-top:11px"><span class="ic">&#9889;</span><span>Latest specific energy <b>'+f2(lastI)+' kWh/MT</b>. Idle running during no-order days inflates specific energy &mdash; idle-load shedding is the quickest cost lever.</span></div>';
}

/* ----------------------------------------------------- recommendations */
function recs(){
  var out=[]; function add(o){ out.push(o); }
  var scopes = S.scope==="Group" ? SBU : [S.scope];
  var lo=lb(S.from), hi=ub(S.to)-1;
  for(var i=0;i<scopes.length;i++){
    var s=scopes[i], si=SBU.indexOf(s);
    var p=D.recs.filter(function(r){ return r[I.sbu]===si && r[I.d]>=lo && r[I.d]<=hi; });
    var k=agg(p);
    if(!p.length) continue;
    var cls=classesTotals(p), ct=catsTotals(p);
    var tot=0; for(var c in cls) tot+=cls[c];
    if(k.OEE<T.OEE){
      add({sev:k.OEE<T.OEE-15?"critical":"high", sbu:s, area:"OEE",
        title:"OEE "+f1(k.OEE)+"% vs "+T.OEE+"% target \u2014 "+f1(T.OEE-k.OEE)+" pts gap",
        insight:"Effective availability "+f1(k.Aeff)+"% is the binding constraint (NPT "+f1(k.nptpct)+"% + unlogged idle "+f1(k.idlepct)+"%); performance "+f1(k.Pc)+"%, quality "+f1(k.Q)+"%.",
        action:"Convert the top-3 downtime categories into owner-led Why-Why projects with weekly review; 30/60/90 plan to +5/+10/+15 pts OEE.",
        owner:"Plant Head / OPEX"});
    }
    if(k.idlepct>5){
      add({sev:"critical", sbu:s, area:"Data integrity",
        title:"Unlogged idle "+f1(k.idlepct)+"% of planned time ("+nf(k.runIdle)+" min)",
        insight:"Machine logged as running with zero throughput. Invisible to the sheet OEE; true availability is "+f1(k.Aeff)+"% vs "+f1(k.A)+"% as-logged.",
        action:"Enforce 4-hour tracking discipline (no run entry without material flow); reclassify idle as NPT with reason; close the loop in the daily ops meeting.",
        owner:"Production / OPEX"});
    }
    if(k.P>105){
      add({sev:"high", sbu:s, area:"Standard / SMV",
        title:"Throughput Performance "+f1(k.P)+"% > 100% \u2014 standard too loose",
        insight:"Ideal cycle time / nameplate capacity understates real speed; capacity plans and incentives built on it will mislead.",
        action:"Re-validate ideal CT and SMV per line/packer; update the machine standard and re-baseline the OEE target.",
        owner:"Industrial Engineering / OPEX"});
    }
    var demand=cls["Demand / Order-book"]||0;
    if(tot>0 && demand/tot>=0.35){
      add({sev:"high", sbu:s, area:"Demand",
        title:"Demand-side losses "+(demand/tot*100).toFixed(1)+"% of all downtime ("+nf(demand)+" min)",
        insight:"Unavailable order / warehouse block / RM shortage are order-book & intake failures, not equipment faults \u2014 they depress reported OEE and hide true capability.",
        action:"Separate Demand-OEE from Equipment-OEE; drive S&OP order-loading, bin-level and dispatch-sync discipline. Target: cut demand losses 40%.",
        owner:"Sales & Ops / SCM"});
    }
    var eq=cls["Equipment reliability"]||0;
    var rel=reliability(D.bd.filter(function(x){ return x[BI.sbu]===si && x[BI.d]>=lo && x[BI.d]<=hi; }));
    if(eq>0 && rel.ev>0){
      add({sev:"high", sbu:s, area:"Reliability",
        title:"Equipment breakdowns "+nf(eq)+" min \u00b7 MTTR "+nf(rel.eqmttr||rel.mttr)+" min",
        insight:rel.ev+" logged events; every failure costs on average "+nf(rel.mttr)+" minutes of production.",
        action:"Deploy TPM PM + AM pillars: critical-spares list, PM calendar by machine, MTTR kaizen on the top-3 repeated failure modes.",
        owner:"Maintenance"});
    }
    var proc=(cls["Process / Changeover"]||0);
    if(proc>0){
      add({sev:"medium", sbu:s, area:"Changeover",
        title:"Setup + QCO changeover = "+nf(proc)+" min ("+f1(k.npt?proc/k.npt*100:0)+"% of NPT)",
        insight:"Classic SMED opportunity with fast payback.",
        action:"Run a SMED workshop on the biggest changeover; externalise internal steps; target \u226450% reduction; standardise in an SOP.",
        owner:"Production / Process"});
    }
    var sh=byEntityName(p,"sh");
    if(sh.length>1){
      var b=sh.reduce(function(a,x){return x.OEE>a.OEE?x:a;}), w=sh.reduce(function(a,x){return x.OEE<a.OEE?x:a;});
      if(b.OEE-w.OEE>=12) add({sev:"high", sbu:s, area:"Shift",
        title:"Shift gap "+f1(b.OEE-w.OEE)+" pts (best "+esc(b.label)+" "+f1(b.OEE)+"% vs "+esc(w.label)+" "+f1(w.OEE)+"%)",
        insight:"Not a machine problem but a standard-work problem \u2014 the best shift proves the level is achievable.",
        action:"Codify the best shift's method into a Yamazumi/standard-work sheet; peer shadow shifts; audit adherence weekly.",
        owner:"Production / OPEX"});
    }
    if(k.wstpct>2) add({sev:"medium", sbu:s, area:"Yield/Waste",
      title:"Wastage "+f2(k.wstpct)+"% of throughput",
      insight:"Material loss hits conversion cost and yield directly.",
      action:"Root-cause the top wastage reason; tighten process control; standardise and audit.",
      owner:"Production / QC"});
    if(S.scope!=="Packing" && k.yield>0 && k.yield<90) add({sev:"medium", sbu:s, area:"Yield",
      title:"Yield "+f1(k.yield)+"% (out \u00f7 throughput)",
      insight:"Conversion/extraction below the expected band \u2014 by-product or reject stream is leaking value.",
      action:"Mass-balance audit of input vs all outputs; tighten roll gap / grading; recover by-product value.",
      owner:"Production / QC"});
  }
  add({sev:"medium", sbu:"Group", area:"Governance",
    title:"Institutionalise the data-driven CI cadence",
    insight:"Dashboards + Kaizen/PS cards + 4-hour tracking create the data spine for CI.",
    action:"Daily 4-hour tracking \u2192 daily ops meeting \u2192 weekly loss review \u2192 monthly cluster OPEX review; every loss >2% of NPT carries an owner, a card and a due date.",
    owner:"Group OPEX"});
  add({sev:"low", sbu:"Group", area:"Capability",
    title:"Build OPEX capability & sustain gains",
    insight:"Sustained gains need trained belts and audited standards (zero reversal).",
    action:"Run a Kaizen/SMED/5S certification wave linked to the R&R programme; audit implemented improvements quarterly for zero reversal.",
    owner:"OPEX / HR"});
  var order={critical:0,high:1,medium:2,low:3};
  out.sort(function(a,b){ return (order[a.sev]-order[b.sev]) || (a.sbu<b.sbu?-1:1); });
  return out;
}
function renderRecs(){
  var rs=recs();
  $id("recs").innerHTML=rs.map(function(r){
    var c=SEV[r.sev]||"#22d3ee";
    return '<div class="rec" style="--rc:'+c+'">'
      +'<div class="h"><div><div class="m" style="color:'+c+'">'+r.sev+' \u00b7 '+esc(r.sbu)+' \u00b7 '+esc(r.area)+'</div>'
      +'<div class="t">'+esc(r.title)+'</div></div><span class="tagc" style="background:'+c+'22;color:'+c+'">'+esc(r.area)+'</span></div>'
      +'<div class="x"><b>Insight:</b> '+r.insight+'</div>'
      +'<div class="x"><b>Action:</b> '+r.action+'</div>'
      +'<div class="own">Owner \u2192 '+esc(r.owner)+'</div></div>';
  }).join("") || '<div class="muted">No recommendations for this selection.</div>';
}

/* ---------------------------------------------------------------- notes */
function renderNotes(){
  var p=sel().prod;
  $id("notes").innerHTML=
    '<div class="grid g2">'
    +'<div><div class="muted" style="font-size:11px;line-height:1.75">'
    +'<b style="color:#e9f0f8">Source:</b> Google Sheet <code>'+esc(M.source)+'</code> \u2014 tabs: Flour, Packer, Red Lentil, Chickpeas &amp; Yellowpeas (Production Report + Breakdown), Electrical Consumption, Plan vs Actual Delivery.<br>'
    +'<b style="color:#e9f0f8">Range analysed:</b> '+S.from+' \u2192 '+S.to+' &middot; <b>'+nf(p.length)+'</b> production rows &middot; <b>'+nf(sel().bd.length)+'</b> breakdown entries &middot; data window '+M.first+' \u2192 '+M.last+'.<br>'
    +'<b style="color:#e9f0f8">Corrected formulas (v2):</b> Availability<sub>eff</sub> = effective run \u00f7 (operation \u2212 planned DT) &middot; Performance = \u03a3(ideal&nbsp;CT \u00d7 throughput) \u00f7 effective run (capped 100%) &middot; Quality = good \u00f7 output &middot; OEE = A<sub>eff</sub>\u00d7P\u00d7Q &middot; Plan achievement = throughput \u00f7 target (was output \u00f7 target) &middot; Wastage% = wastage \u00f7 throughput.'
    +'</div></div>'
    +'<div><div class="muted" style="font-size:11px;line-height:1.75">'
    +'<b style="color:#f59e0b">Data-quality flags:</b><br>'
    +'\u2022 <b>Throughput basis</b>: achievement/capacity/wastage use the material-flow column (crush for Flour, cleaning input for the mills), not final output \u2014 the v1 basis understated Flour achievement (52.7% vs 79.2% L12M).<br>'
    +'\u2022 <b>Unlogged / phantom run</b>: rows logged as running with zero throughput are counted as idle time and folded into effective availability.<br>'
    +'\u2022 <b>Performance &gt;100%</b> means the ideal cycle-time standard is loose \u2014 flagged for SMV re-validation.<br>'
    +'\u2022 2 Red-Lentil rows with malformed dates dropped &middot; Planned Down Time excluded from unplanned Pareto &middot; blank / #N/A types \u2192 "Unclassified".<br>'
    +'\u2022 Electrical consumption only populated for recent months &middot; Packing output in <b>bags</b> \u2014 never summed with MT.'
    +'</div></div></div>';
}

/* ------------------------------------------------------------- controls */
function buildControls(){
  var scopes=["Group"].concat(SBU);
  $id("scopeBtns").innerHTML=scopes.map(function(s){
    return '<button class="chip'+(s===S.scope?" on":"")+'" data-s="'+s+'">'+(s==="Group"?"Group (all)":s)+'</button>';
  }).join("");
  $id("scopeBtns").onclick=function(e){ if(e.target.dataset.s){ S.scope=e.target.dataset.s; buildControls(); render(); } };
}
function setPreset(k){
  var r=preset(k); S.preset=k; S.from=r[0]; S.to=r[1];
  $id("dFrom").value=S.from; $id("dTo").value=S.to;
  buildControls(); render();
}
function applyDates(){
  var f=$id("dFrom").value, t=$id("dTo").value;
  if(!f||!t) return;
  if(f>t){ var tmp=f; f=t; t=tmp; }
  S.from=f; S.to=t; S.preset="";
  buildControls(); render();
}

/* ------------------------------------------------------------- CSV */
function exportCsv(){
  var p=sel().prod, k=agg(p);
  var L=[];
  L.push(["AEL OPEX Dashboard v2 export"]);
  L.push(["scope",S.scope]);
  L.push(["from",S.from,"to",S.to,"days",daysBetween(S.from,S.to)]);
  L.push(["rows",p.length,"bd",sel().bd.length]);
  L.push([]);
  L.push(["Metric","Value","Unit"]);
  function r(n,v,u){ L.push([n,v,u]); }
  r("OEE",k.OEE.toFixed(2),"%"); r("Availability_eff",k.Aeff.toFixed(2),"%"); r("Availability_logged",k.A.toFixed(2),"%");
  r("Performance_throughput",k.P.toFixed(2),"%"); r("Performance_sheet",k.Ps.toFixed(2),"%"); r("Quality",k.Q.toFixed(2),"%");
  r("Plan_achievement",k.ach.toFixed(2),"%"); r("Yield",k.yield.toFixed(2),"%"); r("Wastage%",k.wstpct.toFixed(2),"%");
  r("NPT%",k.nptpct.toFixed(2),"%"); r("Unlogged_idle%",k.idlepct.toFixed(2),"%"); r("TEEP",k.teep.toFixed(2),"%");
  r("Output",Math.round(k.out),unitLbl()); r("Throughput",Math.round(k.flow),unitLbl()); r("Good",Math.round(k.good),unitLbl());
  L.push([]);
  L.push(["Entity","OEE%","Aeff%","P%","Q%","NPT%","Output"]);
  var kinds=[["sh","shift"],["ln","line"],["pr","product"],["mc","machine"]];
  kinds.forEach(function(kk){
    if(S.scope==="Group" && kk[0]!=="sh") return;
    byEntityName(p,kk[0]).forEach(function(e){ L.push([kk[1]+": "+(e.label||e.name), e.OEE.toFixed(1), e.Aeff.toFixed(1), e.Pc.toFixed(1), e.Q.toFixed(1), e.nptpct.toFixed(1), Math.round(e.out)]); });
  });
  L.push([]);
  L.push(["Reason","Minutes","%","Cum%","Class"]);
  topReasons(100).forEach(function(x){ L.push([x.n, Math.round(x.min), x.pct.toFixed(1), x.cum.toFixed(1), x.cls]); });
  var csv=L.map(function(row){ return row.map(function(c){ c=(c==null?"":String(c)); return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c; }).join(","); }).join("\r\n");
  var blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="AEL-OPEX-"+S.scope.replace(/[^\w]+/g,"_")+"-"+S.from+"_"+S.to+".csv";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); },1500);
}

/* --------------------------------------------------------------- render */
function render(){
  var p=sel().prod;
  $id("hpAsof").textContent=M.asof;
  $id("hpScope").textContent=S.scope;
  $id("hpRange").textContent=S.from.slice(2)+" \u2192 "+S.to.slice(2)+" ("+daysBetween(S.from,S.to)+"d)";
  $id("hpGen").textContent=M.generated;
  $id("ftSrc").textContent=M.source_name;
  $id("rangeLbl").innerHTML="Showing <b>"+nf(p.length)+"</b> production records &middot; <b>"+nf(sel().bd.length)+"</b> breakdown entries &middot; "+S.from+" \u2192 "+S.to+" &middot; scope <b>"+S.scope+"</b>";
  $id("snapNote").textContent=S.from+" \u2192 "+S.to+" \u00b7 "+daysBetween(S.from,S.to)+" days";
  $id("dFrom").value=S.from; $id("dTo").value=S.to;
  renderKPI(); renderWaterfall(); renderDonut(); renderInsights();
  renderLossTree(); renderDQ();
  renderClasses(); renderCatPareto(); renderReasons(); renderReliability();
  renderBoards(); renderCost(); renderAlerts();
  renderMonthly(); renderDaily(); renderMix(); renderCompare();
  renderDelivery(); renderEnergy(); renderRecs(); renderNotes();
}

/* ---------------------------------------------------------------- init */
function init(){
  $id("dFrom").min=M.first; $id("dFrom").max=M.last;
  $id("dTo").min=M.first; $id("dTo").max=M.last;
  $id("btnApply").onclick=applyDates;
  $id("dFrom").onchange=applyDates; $id("dTo").onchange=applyDates;
  $id("btnCsv").onclick=exportCsv;
  $id("btnPrint").onclick=function(){ window.print(); };
  setPreset("L12M");
  window.addEventListener("resize",function(){ renderMonthly(); renderDaily(); });
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();

/* test hook */
window.__AEL={agg:agg,sel:sel,setState:function(o){ for(var k in o) S[k]=o[k]; memo.key=""; buildControls(); },render:render,preset:preset,recs:recs,byEntityName:byEntityName,topReasons:topReasons,catsTotals:catsTotals,classesTotals:classesTotals,mixTotals:mixTotals,S:S,META:M,
  R:{kpi:renderKPI,waterfall:renderWaterfall,donut:renderDonut,insights:renderInsights,tree:renderLossTree,dq:renderDQ,classes:renderClasses,catpareto:renderCatPareto,reasons:renderReasons,reliability:renderReliability,boards:renderBoards,cost:renderCost,alerts:renderAlerts,monthly:renderMonthly,daily:renderDaily,mix:renderMix,compare:renderCompare,delivery:renderDelivery,energy:renderEnergy,recs:renderRecs,notes:renderNotes}};
})();
