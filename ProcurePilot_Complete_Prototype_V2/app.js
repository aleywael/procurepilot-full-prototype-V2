
const App = (() => {
  const DEFAULT_DASH = ["kpi-otd","kpi-spend","kpi-overdue","kpi-risk","chart-otd","chart-spend","chart-risk","chart-quality","chart-delay","chart-category"];
  const S = {
    rows:[], suppliers:[], issues:[], metrics:{}, readiness:{}, quality:{},
    previous:null, selectedIssue:null, selectedSupplier:null,
    decisions:JSON.parse(localStorage.getItem("pp2_decisions")||"[]"),
    dashboard:JSON.parse(localStorage.getItem("pp2_dashboard")||"null")||DEFAULT_DASH,
    audit:JSON.parse(localStorage.getItem("pp2_audit")||"[]")
  };
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const fmtMoney=v=>new Intl.NumberFormat("en-US",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(v||0);
  const fmtPct=v=>`${(v||0).toFixed(1)}%`;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const pd=s=>s?new Date(`${s}T00:00:00Z`):null;
  const days=(a,b)=>Math.round((b-a)/86400000);
  const TODAY=new Date("2026-10-14T00:00:00Z");
  const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,"-");

  function audit(action,detail){
    S.audit.unshift({time:new Date().toLocaleString(),action,detail});
    S.audit=S.audit.slice(0,30);localStorage.setItem("pp2_audit",JSON.stringify(S.audit));renderAudit();
  }

  function parseCSV(text){
    const out=[];let row=[],cell="",q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c=='"'){if(q&&n=='"'){cell+='"';i++;}else q=!q}
      else if(c==','&&!q){row.push(cell);cell=""}
      else if((c=='\n'||c=='\r')&&!q){if(c=='\r'&&n=='\n')i++;row.push(cell);cell="";if(row.some(x=>x!==""))out.push(row);row=[]}
      else cell+=c;
    }
    if(cell||row.length){row.push(cell);out.push(row)}
    if(out.length<2)return[];
    const h=out[0].map(x=>x.trim());
    return out.slice(1).map(r=>Object.fromEntries(h.map((k,i)=>[k,(r[i]||"").trim()])));
  }

  function normalize(raw){
    const aliases={
      PO_ID:["PO_ID","Purch.Doc.","PO"],PO_Line:["PO_Line","Item"],
      Supplier_ID:["Supplier_ID","Vendor"],Supplier_Name:["Supplier_Name","Vendor Name","Supplier"],
      Category:["Category","Item_Category"],Order_Date:["Order_Date","PO_Date"],
      Promised_Date:["Promised_Date","Deliv. Date","Delivery_Date"],
      Actual_Receipt_Date:["Actual_Receipt_Date","GR Date","Receipt_Date"],
      Quantity:["Quantity","PO Qty"],Received_Qty:["Received_Qty"],
      Rejected_Qty:["Rejected_Qty","Defective_Units"],Unit_Price:["Unit_Price","Net Price"],
      Currency:["Currency","Curr."],UOM:["UOM"],Status:["Status","Order_Status"],Compliance:["Compliance"]
    };
    const pick=(r,ns)=>{for(const n of ns)if(Object.prototype.hasOwnProperty.call(r,n))return r[n];return ""};
    return raw.map((r,i)=>{
      const o={};for(const [k,ns] of Object.entries(aliases))o[k]=pick(r,ns);
      o.PO_ID=o.PO_ID||`AUTO-${i+1}`;o.PO_Line=o.PO_Line||"10";
      ["Quantity","Received_Qty","Rejected_Qty","Unit_Price"].forEach(k=>o[k]=Number(o[k])||0);
      return o;
    });
  }

  function calc(rows=S.rows){
    const delivered=rows.filter(r=>r.Promised_Date&&r.Actual_Receipt_Date);
    const ontime=delivered.filter(r=>pd(r.Actual_Receipt_Date)<=pd(r.Promised_Date));
    const posDelays=delivered.map(r=>Math.max(0,days(pd(r.Promised_Date),pd(r.Actual_Receipt_Date)))).filter(x=>x>0);
    const open=rows.filter(r=>String(r.Status).toUpperCase()!=="CLOSED"&&!r.Actual_Receipt_Date);
    const overdue=open.filter(r=>r.Promised_Date&&pd(r.Promised_Date)<TODAY);
    const spend=rows.reduce((s,r)=>s+r.Quantity*r.Unit_Price,0);
    const recv=rows.reduce((s,r)=>s+r.Received_Qty,0),rej=rows.reduce((s,r)=>s+r.Rejected_Qty,0);
    return {
      otd:delivered.length?ontime.length/delivered.length*100:0,
      delivered:delivered.length,
      avgDelay:posDelays.length?posDelays.reduce((a,b)=>a+b,0)/posDelays.length:0,
      overdue:overdue.length,
      exposure:overdue.reduce((s,r)=>s+r.Quantity*r.Unit_Price,0),
      spend,
      rejection:recv?rej/recv*100:0,
      open:open.length
    };
  }

  function rebuild(){
    S.metrics=calc(S.rows);
    const miss=f=>S.rows.filter(r=>!r[f]).length;
    S.quality={
      promised:miss("Promised_Date"),supplier:miss("Supplier_Name"),currency:miss("Currency"),uom:miss("UOM"),
      dup:S.rows.length-new Set(S.rows.map(r=>`${r.PO_ID}|${r.PO_Line}`)).size
    };
    const comp=fields=>{
      const total=S.rows.length*fields.length;if(!total)return 0;
      let good=0;S.rows.forEach(r=>fields.forEach(f=>{if(r[f]!==""&&r[f]!=null)good++}));return good/total*100;
    };
    S.readiness={
      otd:comp(["Supplier_Name","Promised_Date","Actual_Receipt_Date"]),
      overdue:comp(["Supplier_Name","Promised_Date","Status","Quantity","Unit_Price"]),
      quality:comp(["Supplier_Name","Received_Qty","Rejected_Qty"]),
      price:comp(["Supplier_Name","Unit_Price","Currency","UOM"]),
      spend:comp(["Supplier_Name","Unit_Price","Quantity"])
    };

    const groups={};
    S.rows.forEach(r=>{const k=r.Supplier_Name||r.Supplier_ID||"Unknown";(groups[k]??=[]).push(r)});
    S.suppliers=Object.entries(groups).map(([name,rs])=>{
      const m=calc(rs);
      const avgPrice=rs.filter(r=>r.Unit_Price>0).reduce((a,r)=>a+r.Unit_Price,0)/Math.max(1,rs.filter(r=>r.Unit_Price>0).length);
      const risk=clamp((100-m.otd)*0.58+m.avgDelay*3+m.overdue*5.2+m.rejection*1.6,5,96);
      const evidenceCompleteness=rs.reduce((s,r)=>s+["Supplier_Name","Promised_Date","Unit_Price","Currency"].filter(f=>r[f]).length,0)/(rs.length*4)*100;
      const reliability=clamp(evidenceCompleteness*0.46+Math.min(rs.length,60)/60*35+19,25,97);
      const overdueRows=rs.filter(r=>String(r.Status).toUpperCase()!=="CLOSED"&&!r.Actual_Receipt_Date&&r.Promised_Date&&pd(r.Promised_Date)<TODAY);
      return {name,rows:rs,...m,avgPrice,risk,reliability,quality:100-m.rejection,overdueRows};
    }).sort((a,b)=>b.risk-a.risk);

    S.issues=[];
    S.suppliers.forEach(s=>{
      if(s.risk>=65)S.issues.push(issue(s,`risk-${slug(s.name)}`,"Predictive Risk",s.risk>=80?"Critical":"High",`${s.name} has elevated future delivery risk`,`Predicted risk ${s.risk.toFixed(0)}%; OTD ${s.otd.toFixed(1)}%; ${s.overdue} overdue open PO lines.`,"High predictive risk when score ≥ 65%.","65% risk"));
      if(s.otd<80&&s.delivered>=10)S.issues.push(issue(s,`otd-${slug(s.name)}`,"Delivery Performance",s.otd<65?"Critical":"High",`${s.name} OTD is below target`,`OTD ${s.otd.toFixed(1)}% versus configured 80% target.`,"Flag OTD below 80% with at least 10 eligible deliveries.","80% OTD"));
      if(s.rejection>5)S.issues.push(issue(s,`qual-${slug(s.name)}`,"Quality",s.rejection>8?"Critical":"High",`${s.name} rejection rate is high`,`Quality rejection ${s.rejection.toFixed(1)}%, above 5% threshold.`,"Flag rejection above 5%.","5% rejection"));
    });
    S.issues.sort((a,b)=>rank(b.severity)-rank(a.severity)||b.exposure-a.exposure);
    renderAll();
  }

  function issue(s,id,type,severity,title,summary,rule,threshold){
    return {id,type,severity,title,summary,supplier:s.name,rule,threshold,reliability:s.reliability,exposure:s.overdueRows.reduce((x,r)=>x+r.Quantity*r.Unit_Price,0)}
  }
  function rank(s){return s==="Critical"?3:s==="High"?2:1}
  function ready(v){return v>=90?["READY","good"]:v>=70?["CAUTION","warn"]:["NOT READY","bad"]}

  function renderAll(){
    renderOverview();renderDashboard();renderImport();renderIssues();renderRisk();renderSuppliers();renderScenarioSelectors();renderDecisions();renderBuilder();renderAudit();
    $("#datasetBadge").textContent=`${S.rows.length} PO lines`;
  }

  function renderOverview(){
    const top=S.suppliers[0]||{};
    const cards=[
      ["Overall OTD",fmtPct(S.metrics.otd),`${S.metrics.delivered} eligible deliveries`],
      ["Overdue open POs",S.metrics.overdue,`${fmtMoney(S.metrics.exposure)} exposure`],
      ["Highest predicted risk",top.risk?`${top.risk.toFixed(0)}%`:"—",top.name||"No supplier"],
      ["Average delay",`${S.metrics.avgDelay.toFixed(1)} d`,"Positive-delay calculation"]
    ];
    $("#overviewKpis").innerHTML=cards.map(c=>`<div class="kpi"><span>${c[0]}</span><strong>${c[1]}</strong><em>${c[2]}</em></div>`).join("");

    $("#readinessMini").innerHTML=[
      ["On-time delivery",S.readiness.otd],["Overdue exposure",S.readiness.overdue],["Quality",S.readiness.quality],["Price comparison",S.readiness.price]
    ].map(([n,v])=>`<div class="progress-item"><div class="progress-head"><span>${n}</span><strong>${ready(v)[0]} · ${v.toFixed(1)}%</strong></div><div class="bar"><span style="width:${v}%"></span></div></div>`).join("");

    const ch=changes();
    $("#changeSummary").innerHTML=[["New",ch.new],["Persistent",ch.persistent],["Improving",ch.improving],["Resolved",ch.resolved]].map(x=>`<div class="change"><strong>${x[1]}</strong><span>${x[0]}</span></div>`).join("");

    $("#overviewIssues").innerHTML=S.issues.slice(0,5).map(issueHTML).join("")||`<div class="empty">No priority issues detected.</div>`;
    $$("#overviewIssues [data-issue]").forEach(b=>b.onclick=()=>openIssue(b.dataset.issue));

    $("#overviewDecisions").innerHTML=S.decisions.length?S.decisions.slice(0,3).map(d=>`<div class="history"><strong>${esc(d.decision)}</strong><div class="issue-meta">${esc(d.owner)} · ${esc(d.kpi)} target ${esc(String(d.target))} · review ${esc(d.reviewDate||"not set")}</div></div>`).join(""):`<div class="empty">No decisions recorded yet.</div>`;
  }

  function changes(){
    if(!S.previous)return{new:S.issues.length,persistent:0,improving:0,resolved:0};
    const p=new Set(S.previous.issues.map(i=>i.id)),c=new Set(S.issues.map(i=>i.id));
    const nw=S.issues.filter(i=>!p.has(i.id)).length,pers=S.issues.filter(i=>p.has(i.id)).length,res=S.previous.issues.filter(i=>!c.has(i.id)).length;
    return{new:nw,persistent:pers,improving:Math.max(0,Math.round(pers*.35)),resolved:res};
  }

  function issueHTML(i){return `<div class="issue"><div><div class="row wrap"><span class="sev ${i.severity.toLowerCase()}">${i.severity}</span><span class="issue-title">${esc(i.title)}</span></div><div class="issue-meta">${esc(i.summary)}</div></div><button class="btn ghost" data-issue="${i.id}">Evidence</button></div>`}

  function dashboardRows(){
    const supplier=$("#filterSupplier")?.value||"ALL",cat=$("#filterCategory")?.value||"ALL",status=$("#filterStatus")?.value||"ALL";
    return S.rows.filter(r=>(supplier==="ALL"||r.Supplier_Name===supplier)&&(cat==="ALL"||r.Category===cat)&&(status==="ALL"||String(r.Status).toUpperCase()===status));
  }

  function renderDashboard(){
    const rows=dashboardRows(),m=calc(rows);
    const topRisk=(() => {
      const names=[...new Set(rows.map(r=>r.Supplier_Name).filter(Boolean))];
      return S.suppliers.filter(s=>names.includes(s.name)).sort((a,b)=>b.risk-a.risk)[0];
    })();

    const KPI=[
      ["kpi-otd","OTD",fmtPct(m.otd),`${m.delivered} eligible deliveries`],
      ["kpi-spend","Total spend",fmtMoney(m.spend),"Filtered procurement spend"],
      ["kpi-overdue","Overdue open POs",m.overdue,`${fmtMoney(m.exposure)} exposure`],
      ["kpi-risk","Highest supplier risk",topRisk?`${topRisk.risk.toFixed(0)}%`:"—",topRisk?.name||"No supplier"]
    ];
    $("#dashboardKpis").innerHTML=KPI.filter(x=>S.dashboard.includes(x[0])).map(x=>`<div class="kpi"><span>${x[1]}</span><strong>${x[2]}</strong><em>${x[3]}</em></div>`).join("");

    const chartDefs=[
      ["chart-otd","On-Time Delivery Trend","Monthly percentage of eligible deliveries delivered on time.","line",monthlyOTD(rows)],
      ["chart-spend","Monthly Procurement Spend","Spend trend based on PO order date.","bar",monthlySpend(rows)],
      ["chart-risk","Supplier Risk Ranking","Current modeled late-delivery risk by supplier.","hbar",supplierRisk(rows)],
      ["chart-quality","Quality Rejection by Supplier","Rejected quantity as a percentage of received quantity.","hbar",supplierQuality(rows)],
      ["chart-delay","Average Delay by Supplier","Average positive delay days for delivered POs.","hbar",supplierDelay(rows)],
      ["chart-category","Spend by Category","Distribution of procurement spend across categories.","bar",categorySpend(rows)]
    ];
    $("#dashboardCharts").innerHTML=chartDefs.filter(c=>S.dashboard.includes(c[0])).map(c=>`<div class="chart-card"><h3>${c[1]}</h3><p>${c[2]}</p><div class="chart-wrap"><canvas data-chart="${c[0]}"></canvas></div></div>`).join("");
    requestAnimationFrame(()=>chartDefs.filter(c=>S.dashboard.includes(c[0])).forEach(c=>drawChart($(`[data-chart="${c[0]}"]`),c[3],c[4])));
  }

  function monthlySpend(rows){
    const g={};rows.forEach(r=>{const k=(r.Order_Date||"").slice(0,7);if(k)g[k]=(g[k]||0)+r.Quantity*r.Unit_Price});
    return Object.entries(g).sort((a,b)=>a[0].localeCompare(b[0])).slice(-8).map(([k,v])=>({label:k,value:v}));
  }
  function monthlyOTD(rows){
    const g={};rows.filter(r=>r.Promised_Date&&r.Actual_Receipt_Date).forEach(r=>{const k=r.Actual_Receipt_Date.slice(0,7);g[k]??={n:0,on:0};g[k].n++;if(pd(r.Actual_Receipt_Date)<=pd(r.Promised_Date))g[k].on++});
    return Object.entries(g).sort((a,b)=>a[0].localeCompare(b[0])).slice(-8).map(([k,v])=>({label:k,value:v.n?v.on/v.n*100:0}));
  }
  function supplierRisk(rows){
    const names=[...new Set(rows.map(r=>r.Supplier_Name).filter(Boolean))];return S.suppliers.filter(s=>names.includes(s.name)).sort((a,b)=>b.risk-a.risk).slice(0,7).map(s=>({label:s.name,value:s.risk}));
  }
  function supplierQuality(rows){
    const names=[...new Set(rows.map(r=>r.Supplier_Name).filter(Boolean))];return S.suppliers.filter(s=>names.includes(s.name)).sort((a,b)=>b.rejection-a.rejection).slice(0,7).map(s=>({label:s.name,value:s.rejection}));
  }
  function supplierDelay(rows){
    const names=[...new Set(rows.map(r=>r.Supplier_Name).filter(Boolean))];return S.suppliers.filter(s=>names.includes(s.name)).sort((a,b)=>b.avgDelay-a.avgDelay).slice(0,7).map(s=>({label:s.name,value:s.avgDelay}));
  }
  function categorySpend(rows){
    const g={};rows.forEach(r=>g[r.Category||"Unknown"]=(g[r.Category||"Unknown"]||0)+r.Quantity*r.Unit_Price);
    return Object.entries(g).sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value}));
  }

  function drawChart(canvas,type,data){
    if(!canvas)return;const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(300,rect.width),h=Math.max(220,rect.height);
    canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
    const css=getComputedStyle(document.documentElement),line=css.getPropertyValue("--line").trim(),text=css.getPropertyValue("--text").trim(),muted=css.getPropertyValue("--muted").trim(),accent=css.getPropertyValue("--accent").trim();
    ctx.font="12px system-ui";ctx.fillStyle=muted;
    if(!data.length){ctx.fillText("No data for the current filters.",20,30);return}
    if(type==="hbar"){
      const left=120,right=20,top=18,bottom=18,plotW=w-left-right,rowH=(h-top-bottom)/data.length,max=Math.max(...data.map(d=>d.value),1);
      data.forEach((d,i)=>{const y=top+i*rowH+rowH*.18,bh=rowH*.5;ctx.fillStyle=muted;ctx.textAlign="right";ctx.fillText(d.label.length>16?d.label.slice(0,16)+"…":d.label,left-8,y+bh*.8);ctx.fillStyle=line;ctx.fillRect(left,y,plotW,bh);ctx.fillStyle=accent;ctx.fillRect(left,y,plotW*(d.value/max),bh);ctx.fillStyle=text;ctx.textAlign="left";ctx.fillText(d.value>=1000?compact(d.value):d.value.toFixed(1),left+Math.min(plotW*(d.value/max)+6,plotW-36),y+bh*.8)});
      return;
    }
    const left=46,right=15,top=18,bottom=48,plotW=w-left-right,plotH=h-top-bottom,max=Math.max(...data.map(d=>d.value),1),step=plotW/Math.max(1,data.length);
    ctx.strokeStyle=line;ctx.fillStyle=muted;ctx.textAlign="right";
    for(let i=0;i<=4;i++){const y=top+plotH*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillText(compact(max*(1-i/4)),left-7,y+4)}
    if(type==="bar"){
      data.forEach((d,i)=>{const bw=Math.min(44,step*.62),x=left+i*step+(step-bw)/2,bh=plotH*(d.value/max),y=top+plotH-bh;ctx.fillStyle=accent;ctx.fillRect(x,y,bw,bh);ctx.fillStyle=muted;ctx.textAlign="center";ctx.save();ctx.translate(left+i*step+step/2,h-18);ctx.rotate(-.35);ctx.fillText(d.label,0,0);ctx.restore()});
    }else{
      ctx.strokeStyle=accent;ctx.lineWidth=2.5;ctx.beginPath();data.forEach((d,i)=>{const x=left+i*step+step/2,y=top+plotH-plotH*(d.value/max);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();
      data.forEach((d,i)=>{const x=left+i*step+step/2,y=top+plotH-plotH*(d.value/max);ctx.fillStyle=accent;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.fillStyle=muted;ctx.textAlign="center";ctx.fillText(d.label,x,h-18)});
    }
  }
  function compact(v){return v>=1e6?(v/1e6).toFixed(1)+"M":v>=1e3?(v/1e3).toFixed(0)+"k":v.toFixed(0)}

  function renderImport(){
    $("#mappingPreview").innerHTML=`<div class="table-wrap"><table><thead><tr><th>Source column</th><th>ProcurePilot field</th><th>Status</th></tr></thead><tbody>
      <tr><td>Vendor / Supplier_Name</td><td>Supplier_Name</td><td>Confirmed</td></tr>
      <tr><td>Deliv. Date / Promised_Date</td><td>Promised_Date</td><td>AI-assisted if uncertain</td></tr>
      <tr><td>GR Date / Actual_Receipt_Date</td><td>Actual_Receipt_Date</td><td>Confirmed</td></tr>
      <tr><td>Net Price / Unit_Price</td><td>Unit_Price</td><td>Confirmed</td></tr></tbody></table></div>`;

    $("#qualityGrid").innerHTML=[
      ["Missing promised dates",S.quality.promised],["Missing supplier names",S.quality.supplier],["Missing currency",S.quality.currency],["Missing UOM",S.quality.uom],["Duplicate PO lines",S.quality.dup]
    ].map(x=>`<div class="quality"><strong>${x[1]}</strong><span>${x[0]}</span></div>`).join("");

    $("#readinessFull").innerHTML=[
      ["On-Time Delivery",S.readiness.otd,"Promised date + actual receipt date + supplier"],
      ["Overdue Open",S.readiness.overdue,"Promised date + status + quantity + unit price"],
      ["Quality",S.readiness.quality,"Received quantity + rejected quantity + supplier"],
      ["Price",S.readiness.price,"Unit price + currency + UOM + supplier"],
      ["Spend",S.readiness.spend,"Unit price + quantity + supplier"]
    ].map(([n,v,why])=>`<div class="issue"><div><strong>${n}</strong><div class="issue-meta">${why}</div></div><span class="badge">${ready(v)[0]} · ${v.toFixed(1)}%</span></div>`).join("");
  }

  function renderIssues(){
    $("#issuesList").innerHTML=S.issues.map(issueHTML).join("")||`<div class="empty">No issues detected.</div>`;
    $$("#issuesList [data-issue]").forEach(b=>b.onclick=()=>openIssue(b.dataset.issue));
    if(S.selectedIssue)renderEvidence();
  }
  function openIssue(id){
    S.selectedIssue=S.issues.find(i=>i.id===id)||null;go("issues");renderEvidence();
  }
  function renderEvidence(){
    const i=S.selectedIssue;if(!i)return;
    const s=S.suppliers.find(x=>x.name===i.supplier);
    $("#evidenceSubtitle").textContent=i.title;$("#evidenceSeverity").textContent=i.severity;
    const affected=(s?.rows||[]).filter(r=>{
      if(i.type==="Quality")return r.Rejected_Qty>0;
      if(i.type==="Delivery Performance")return r.Promised_Date&&r.Actual_Receipt_Date&&pd(r.Actual_Receipt_Date)>pd(r.Promised_Date);
      return r.Promised_Date&&(!r.Actual_Receipt_Date||pd(r.Actual_Receipt_Date)>pd(r.Promised_Date));
    }).slice(0,10);
    $("#evidenceBody").className="top";
    $("#evidenceBody").innerHTML=`<div class="evidence-grid">
      <div class="metric"><span>Current OTD</span><strong>${fmtPct(s.otd)}</strong></div>
      <div class="metric"><span>Predicted risk</span><strong>${fmtPct(s.risk)}</strong></div>
      <div class="metric"><span>Overdue lines</span><strong>${s.overdue}</strong></div>
      <div class="metric"><span>Open exposure</span><strong>${fmtMoney(i.exposure)}</strong></div>
    </div>
    <div class="evidence-meta top"><div><strong>Rule / threshold</strong><p>${esc(i.rule)} Threshold: ${esc(i.threshold)}.</p></div><div><strong>Evidence confidence</strong><p>Decision Reliability ${i.reliability.toFixed(0)}%. OTD readiness ${S.readiness.otd.toFixed(1)}%.</p></div></div>
    <div class="table-wrap top"><table><thead><tr><th>PO</th><th>Promised</th><th>Actual</th><th>Delay</th><th>Value</th></tr></thead><tbody>${affected.map(r=>`<tr><td>${esc(r.PO_ID)}</td><td>${esc(r.Promised_Date||"—")}</td><td>${esc(r.Actual_Receipt_Date||"Open")}</td><td>${r.Promised_Date&&r.Actual_Receipt_Date?Math.max(0,days(pd(r.Promised_Date),pd(r.Actual_Receipt_Date)))+"d":"Open"}</td><td>${fmtMoney(r.Quantity*r.Unit_Price)}</td></tr>`).join("")}</tbody></table></div>
    <div class="row wrap top"><button class="btn" id="askIssueAI">Ask AI about this issue</button><button class="btn ghost" id="recordIssueDecision">Record decision</button></div>`;
    $("#askIssueAI").onclick=()=>{go("copilot");setTimeout(()=>ask(`What should I do about ${i.supplier}?`),10)};
    $("#recordIssueDecision").onclick=()=>{go("decisions");$("#decisionIssue").value=i.id};
  }

  function renderRisk(){
    $("#riskList").innerHTML=S.suppliers.map(s=>`<div class="risk-row"><div><strong>${esc(s.name)}</strong><div class="issue-meta">OTD ${fmtPct(s.otd)} · ${s.overdue} overdue · Avg delay ${s.avgDelay.toFixed(1)}d</div></div><div class="row"><span class="risk-score ${s.risk>=65?"risk-high":s.risk>=40?"risk-med":"risk-low"}">${s.risk.toFixed(0)}%</span><button class="btn ghost" data-supplier="${esc(s.name)}">Explain</button></div></div>`).join("");
    $$("#riskList [data-supplier]").forEach(b=>b.onclick=()=>{S.selectedSupplier=S.suppliers.find(s=>s.name===b.dataset.supplier);renderRiskExplain()});
    if(!S.selectedSupplier&&S.suppliers.length)S.selectedSupplier=S.suppliers[0];
    renderRiskExplain();
  }
  function renderRiskExplain(){
    const s=S.selectedSupplier;if(!s)return;
    const factors=[
      ["Recent OTD weakness",clamp(100-s.otd,0,100)],
      ["Historical delay severity",clamp(s.avgDelay*11,0,100)],
      ["Open overdue exposure",clamp(s.overdue*18,0,100)],
      ["Quality signal",clamp(s.rejection*8,0,100)]
    ];
    $("#riskExplain").className="top";
    $("#riskExplain").innerHTML=`<div class="row between"><div><strong>${esc(s.name)}</strong><div class="issue-meta">Estimated future late-delivery risk</div></div><span class="risk-score ${s.risk>=65?"risk-high":s.risk>=40?"risk-med":"risk-low"}">${s.risk.toFixed(0)}%</span></div>
      ${factors.map(([n,v])=>`<div class="factor"><div class="factor-head"><span>${n}</span><strong>${v.toFixed(0)}/100</strong></div><div class="factor-bar"><span style="width:${v}%"></span></div></div>`).join("")}
      <div class="notice top">Transparent prototype score for demonstration. A production model should be trained and validated on sufficient historical data.</div>`;
    $("#reliabilityBox").innerHTML=`<div class="reliability"><div class="score-ring">${s.reliability.toFixed(0)}%</div><div><strong>${s.reliability>=80?"HIGH":s.reliability>=60?"MEDIUM":"LOW"} reliability</strong><ul><li>Data completeness</li><li>Historical sample size</li><li>Freshness of evidence</li><li>Visible model factors</li></ul><div class="notice">This is different from supplier risk. It asks: how much weight should we give this recommendation?</div></div></div>`;
  }

  function renderSuppliers(){
    let arr=S.suppliers.slice(),sort=$("#supplierSort")?.value||"risk";
    if(sort==="risk")arr.sort((a,b)=>b.risk-a.risk);
    if(sort==="otd")arr.sort((a,b)=>a.otd-b.otd);
    if(sort==="spend")arr.sort((a,b)=>b.spend-a.spend);
    $("#supplierTable").innerHTML=arr.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${fmtPct(s.otd)}</td><td>${s.avgDelay.toFixed(1)}d</td><td>${fmtPct(s.quality)}</td><td>${fmtMoney(s.spend)}</td><td>${s.overdue}</td><td><strong>${fmtPct(s.risk)}</strong></td></tr>`).join("");
  }

  function renderScenarioSelectors(){
    const opts=S.suppliers.map(s=>`<option>${esc(s.name)}</option>`).join("");
    $("#scenarioFrom").innerHTML=opts;$("#scenarioTo").innerHTML=opts;
    if(S.suppliers.length>1){$("#scenarioFrom").value=S.suppliers[0].name;$("#scenarioTo").value=S.suppliers[1].name}
    runScenario();
  }
  function runScenario(){
    const a=S.suppliers.find(s=>s.name===$("#scenarioFrom").value),b=S.suppliers.find(s=>s.name===$("#scenarioTo").value),share=Number($("#shareRange").value)/100;
    if(!a||!b)return;
    const risk=(1-share)*a.risk+share*b.risk,cost=a.avgPrice?((b.avgPrice-a.avgPrice)/a.avgPrice*100)*share:0;
    $("#scenarioOutput").innerHTML=`<div class="scenario-grid"><div class="scenario"><span>Current modeled risk</span><strong>${a.risk.toFixed(0)}%</strong></div><div class="scenario"><span>Scenario modeled risk</span><strong>${risk.toFixed(0)}%</strong></div><div class="scenario"><span>Estimated cost effect</span><strong>${cost>=0?"+":""}${cost.toFixed(1)}%</strong></div></div><div class="notice top">Moving ${Math.round(share*100)}% from ${esc(a.name)} to ${esc(b.name)} reduces modeled exposure if the alternative has stronger historical performance, but may change cost and concentration.</div>`;
  }

  function ask(q){
    if(q)$("#chatInput").value=q;
    const question=$("#chatInput").value.trim();if(!question)return;
    $("#chatMessages").insertAdjacentHTML("beforeend",`<div class="bubble user">${esc(question)}</div>`);
    const a=answer(question);
    $("#chatMessages").insertAdjacentHTML("beforeend",`<div class="bubble ai"><strong>ProcurePilot Copilot</strong><div class="top">${a.text}</div>${a.challenge?`<div class="challenge"><strong>AI Challenger</strong><br>${a.challenge}</div>`:""}</div>`);
    $("#chatMessages").scrollTop=$("#chatMessages").scrollHeight;$("#chatInput").value="";audit("AI Copilot query",question);
  }
  function answer(q){
    const l=q.toLowerCase(),worst=S.suppliers.slice().sort((a,b)=>a.otd-b.otd)[0],top=S.suppliers[0],gamma=S.suppliers.find(s=>/gamma/i.test(s.name)),beta=S.suppliers.find(s=>/beta/i.test(s.name));
    if(/why exactly|root cause|cause.*late/.test(l))return{text:"The procurement data proves that late deliveries occurred, but it does not contain enough operational evidence to identify the exact root cause. Supplier communication, production constraints, logistics events or other operational evidence would be required.",challenge:null};
    if(/worst.*otd|lowest.*otd/.test(l))return{text:`${esc(worst.name)} has the lowest current OTD at <strong>${worst.otd.toFixed(1)}%</strong>.`,challenge:"Low OTD alone should not determine a supplier decision; review price, quality, risk and evidence volume too."};
    if(/investigate first|priority|top problem/.test(l))return{text:`Investigate <strong>${esc(top.name)}</strong> first. Current modeled risk is ${top.risk.toFixed(0)}%, OTD is ${top.otd.toFixed(1)}%, and there are ${top.overdue} overdue open PO lines.`,challenge:"This prioritization uses the current internal dataset only; external market and capacity intelligence are not included."};
    if(/compare.*gamma.*beta|compare.*beta.*gamma/.test(l)&&gamma&&beta)return{text:`Gamma: OTD ${gamma.otd.toFixed(1)}%, risk ${gamma.risk.toFixed(0)}%, avg delay ${gamma.avgDelay.toFixed(1)}d. Beta: OTD ${beta.otd.toFixed(1)}%, risk ${beta.risk.toFixed(0)}%, avg delay ${beta.avgDelay.toFixed(1)}d.`,challenge:"Check capacity, contract terms and category fit before shifting volume."};
    if(/why.*gamma.*risk|gamma.*high risk/.test(l)&&gamma)return{text:`Gamma is flagged because its OTD is ${gamma.otd.toFixed(1)}%, average positive delay is ${gamma.avgDelay.toFixed(1)} days, and it has ${gamma.overdue} overdue open PO lines. Current modeled risk is ${gamma.risk.toFixed(0)}%.`,challenge:"A high risk score is an early-warning estimate, not proof that the next order will be late."};
    if(/what should i do.*gamma|recommend.*gamma|action.*gamma/.test(l)&&gamma)return{text:"Consider escalating overdue POs, comparing qualified alternatives, and testing a partial future-volume reallocation before changing sourcing.",challenge:"An alternative supplier may cost more, have less capacity, or have less historical evidence. Use the scenario simulator before deciding."};
    return{text:"I can answer questions about supplier performance, issues, risk, comparisons, overdue POs and decision options using the data loaded in ProcurePilot.",challenge:"If evidence is not available, I should say so instead of inventing an answer."};
  }

  function renderDecisions(){
    $("#decisionIssue").innerHTML=`<option value="">Select issue</option>`+S.issues.map(i=>`<option value="${i.id}">${esc(i.title)}</option>`).join("");
    $("#decisionHistory").innerHTML=S.decisions.length?S.decisions.map(d=>{
      const o=evaluateDecision(d);
      return `<div class="history"><div class="row between wrap"><strong>${esc(d.decision)}</strong><span class="badge">${o.label}</span></div><div class="issue-meta">${esc(d.owner)} · target ${esc(d.kpi)} ${esc(String(d.target))} · review ${esc(d.reviewDate||"—")}</div><div class="top">${o.detail}</div></div>`
    }).join(""):`<div class="empty">No decisions saved yet.</div>`;
    $("#decisionMemory").innerHTML=`<div class="memory"><strong>Historical case memory</strong><div class="issue-meta">Similar case: Delta Logistics delivery deterioration</div><p>A partial reallocation was followed by an OTD improvement from 71% to 85%, while purchase cost increased by approximately 2.8%.</p></div>`+(S.decisions.length?`<div class="memory"><strong>Your latest saved decision</strong><p>${esc(S.decisions[0].decision)}</p><div class="issue-meta">This can be surfaced when a similar future case appears.</div></div>`:"");
  }
  function evaluateDecision(d){
    if(d.kpi==="OTD"){const i=S.issues.find(x=>x.id===d.issueId),s=i?S.suppliers.find(x=>x.name===i.supplier):null;if(!s)return{label:"Pending",detail:"No matching supplier evidence available."};const ok=s.otd>=Number(d.target);return{label:ok?"Target achieved":"Below target",detail:`Current observed OTD is ${s.otd.toFixed(1)}% versus target ${Number(d.target).toFixed(0)}%. This is an outcome check, not proof of causality.`}}
    return{label:"Review",detail:"Current import is available for manual outcome review."}
  }

  function renderBuilder(){
    const items=[
      ["kpi-otd","KPI · OTD"],["kpi-spend","KPI · Total Spend"],["kpi-overdue","KPI · Overdue Open POs"],["kpi-risk","KPI · Highest Supplier Risk"],
      ["chart-otd","Chart · OTD Trend"],["chart-spend","Chart · Monthly Spend"],["chart-risk","Chart · Supplier Risk Ranking"],["chart-quality","Chart · Quality Rejection"],["chart-delay","Chart · Average Delay"],["chart-category","Chart · Spend by Category"]
    ];
    $("#builderOptions").innerHTML=items.map(([k,n])=>`<label class="check"><input type="checkbox" value="${k}" ${S.dashboard.includes(k)?"checked":""}><span>${n}</span></label>`).join("");
  }

  function renderAudit(){
    $("#auditLog").innerHTML=S.audit.length?S.audit.slice(0,12).map(a=>`<div class="audit"><strong>${esc(a.action)}</strong><span>${esc(a.time)} · ${esc(a.detail)}</span></div>`).join(""):`<div class="empty">No activity yet.</div>`;
  }

  function fillFilters(){
    const supplierVal=$("#filterSupplier").value,catVal=$("#filterCategory").value;
    $("#filterSupplier").innerHTML=`<option value="ALL">All suppliers</option>`+[...new Set(S.rows.map(r=>r.Supplier_Name).filter(Boolean))].sort().map(x=>`<option>${esc(x)}</option>`).join("");
    $("#filterCategory").innerHTML=`<option value="ALL">All categories</option>`+[...new Set(S.rows.map(r=>r.Category).filter(Boolean))].sort().map(x=>`<option>${esc(x)}</option>`).join("");
    if([...$("#filterSupplier").options].some(o=>o.value===supplierVal))$("#filterSupplier").value=supplierVal;
    if([...$("#filterCategory").options].some(o=>o.value===catVal))$("#filterCategory").value=catVal;
  }

  function snapshot(){if(S.rows.length)S.previous={issues:S.issues.map(i=>({id:i.id,severity:i.severity,title:i.title}))}}
  async function loadURL(url,name){
    snapshot();
    const text=await fetch(url).then(r=>r.text());
    S.rows=normalize(parseCSV(text));$("#importStatus").textContent=`Processed ${S.rows.length} PO lines from ${name}.`;audit("Data import",`${name} · ${S.rows.length} lines`);rebuild();fillFilters();
  }

  function go(p){
    $$(".page").forEach(x=>x.classList.remove("active"));$(`#page-${p}`).classList.add("active");
    $$(".nav").forEach(x=>x.classList.toggle("active",x.dataset.page===p));
    const meta={
      overview:["Overview","What needs attention, what may happen next, and what decisions need review."],
      dashboard:["Dashboard","Visual analysis of procurement performance, trends, suppliers, spend and risk."],
      import:["Import & Readiness","From ERP export to trustworthy analytical data."],
      issues:["Priority Issues","Investigate exact PO evidence behind alerts."],
      risk:["Predictive Risk","Look forward, explain the model and judge recommendation reliability."],
      suppliers:["Suppliers","Compare supplier performance and risk."],
      scenario:["What-if Simulator","Test supplier allocation options before deciding."],
      copilot:["AI Copilot","Conversational investigation grounded in system data."],
      decisions:["Decisions & Outcomes","Record the human decision and review later results."],
      builder:["Dashboard Builder","Choose the KPIs and charts you want to see."],
      admin:["Admin & Audit","Rules, thresholds and traceability."]
    };
    $("#pageTitle").textContent=meta[p][0];$("#pageSubtitle").textContent=meta[p][1];
    if(p==="dashboard")renderDashboard();
  }

  function wire(){
    $$(".nav").forEach(b=>b.onclick=()=>go(b.dataset.page));$$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
    $("#openTopIssue").onclick=()=>S.issues[0]?openIssue(S.issues[0].id):go("issues");
    $("#supplierSort").onchange=renderSuppliers;

    ["filterSupplier","filterCategory","filterStatus"].forEach(id=>$("#"+id).onchange=renderDashboard);
    $("#clearFilters").onclick=()=>{$("#filterSupplier").value="ALL";$("#filterCategory").value="ALL";$("#filterStatus").value="ALL";renderDashboard()};

    $("#shareRange").oninput=()=>$("#shareLabel").textContent=`${$("#shareRange").value}%`;
    $("#runScenario").onclick=()=>{runScenario();audit("What-if scenario",`${$("#shareRange").value}% volume shift tested`)};

    $("#chatForm").onsubmit=e=>{e.preventDefault();ask()};
    $$(".quick button").forEach(b=>b.onclick=()=>ask(b.textContent));

    $("#saveDecision").onclick=()=>{
      const issueId=$("#decisionIssue").value,decision=$("#decisionText").value.trim();
      if(!issueId||!decision){$("#decisionStatus").textContent="Select an issue and enter a decision first.";return}
      const d={id:Date.now(),issueId,owner:$("#decisionOwner").value.trim()||"Procurement Employee",decision,rationale:$("#decisionRationale").value.trim(),kpi:$("#decisionKpi").value,target:Number($("#decisionTarget").value),reviewDate:$("#decisionDate").value};
      S.decisions.unshift(d);localStorage.setItem("pp2_decisions",JSON.stringify(S.decisions));$("#decisionStatus").textContent="Decision saved with evidence context and review target.";audit("Decision saved",decision);renderDecisions();renderOverview();
    };

    $("#applyDashboard").onclick=()=>{
      S.dashboard=$$("#builderOptions input:checked").map(x=>x.value);
      localStorage.setItem("pp2_dashboard",JSON.stringify(S.dashboard));audit("Dashboard customized",S.dashboard.join(", "));renderDashboard();go("dashboard");
    };

    $$(".preset").forEach(b=>b.onclick=()=>{
      const P={
        analyst:["kpi-otd","kpi-overdue","kpi-risk","chart-otd","chart-risk","chart-delay","chart-quality","chart-spend"],
        manager:["kpi-otd","kpi-spend","kpi-overdue","kpi-risk","chart-spend","chart-risk","chart-category","chart-otd"],
        quality:["kpi-otd","kpi-risk","chart-quality","chart-otd","chart-delay","chart-risk"]
      };
      S.dashboard=P[b.dataset.preset];localStorage.setItem("pp2_dashboard",JSON.stringify(S.dashboard));renderBuilder();
    });

    $("#loadBaseline").onclick=()=>loadURL("sample_baseline.csv","sample_baseline.csv");
    $("#loadFollowup").onclick=()=>loadURL("sample_followup.csv","sample_followup.csv");
    $("#fileInput").onchange=async e=>{
      const f=e.target.files[0];if(!f)return;snapshot();S.rows=normalize(parseCSV(await f.text()));$("#importStatus").textContent=`Processed ${S.rows.length} PO lines from ${f.name}.`;audit("Data import",`${f.name} · ${S.rows.length} lines`);rebuild();fillFilters();
    };

    $("#resetDemo").onclick=()=>{localStorage.removeItem("pp2_decisions");localStorage.removeItem("pp2_dashboard");localStorage.removeItem("pp2_audit");location.reload()};
    window.addEventListener("resize",()=>{if($("#page-dashboard").classList.contains("active"))renderDashboard()});
  }

  async function init(){
    wire();$("#decisionDate").value="2026-11-14";
    if(!S.audit.length)audit("Prototype initialized","New session");
    await loadURL("sample_baseline.csv","sample_baseline.csv");
    go("overview");
  }

  return {init};
})();
App.init();
