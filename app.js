
const DB_NAME = "gpi-db";
const DB_VERSION = 1;
let db;
let catalog = [];
let orders = [];
let currentOrder = null;
let currentQtyProduct = null;
let currentRestoreProduct = null;
let pendingCatalogImport = null;
let undoAction = null;
let dragIndex = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const month3 = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function idbGet(key){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("kv","readonly");
    const r=tx.objectStore("kv").get(key);
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}
function idbSet(key,val){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("kv","readwrite");
    tx.objectStore("kv").put(val,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
async function sha256(text){
  const bytes=new TextEncoder().encode(text);
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

function todayISO(){
  const d=new Date(); return d.toISOString().slice(0,10);
}
function formatDateDisplay(iso){
  if(!iso) return "";
  const [y,m,d]=iso.split("-");
  return `${d}/${m}/${y}`;
}
function sageDate(iso){
  const [y,m,d]=iso.split("-");
  return `${m}/${d}/${y.slice(-2)}`;
}
function poDatePart(iso){
  const [y,m,d]=iso.split("-").map(Number);
  return `${month3[m-1]}${String(d).padStart(2,"0")}-${y}`;
}
function parseSeq(po){
  const m=String(po||"").match(/^PO(\d+)-/i);
  return m ? Number(m[1]) : null;
}
function suggestedPo(){
  const last = orders
    .map(o=>({po:o.poNumber, seq:parseSeq(o.poNumber), created:o.createdAt||""}))
    .filter(x=>Number.isFinite(x.seq))
    .sort((a,b)=>b.seq-a.seq)[0];
  if(!last) return "";
  return `PO${last.seq+1}-${poDatePart($("#orderDate").value || todayISO())}`;
}
function normalize(s){
  return String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
}
function uid(){
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function statusLabel(s){
  return ({
    draft:"BORRADOR", sent:"ENVIADO", complete:"RECIBIDO COMPLETO", incomplete:"RECIBIDO INCOMPLETO"
  })[s] || s;
}
function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

async function init(){
  db=await openDB();
  catalog=await idbGet("catalog");
  if(!catalog){
    if(Array.isArray(window.GPI_EMBEDDED_CATALOG)){
      catalog=structuredClone(window.GPI_EMBEDDED_CATALOG);
    }else if(location.protocol==="http:" || location.protocol==="https:"){
      catalog=await fetch("catalog.json").then(r=>r.json());
    }else{
      catalog=[];
    }
    await idbSet("catalog",catalog);
  }
  orders=await idbGet("orders") || [];
  $("#orderDate").value=todayISO();
  prepareNewOrder();
  bindUI();
  renderAll();
  if(("serviceWorker" in navigator) && (location.protocol==="http:" || location.protocol==="https:")){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
    if(!document.querySelector('link[rel="manifest"]')){
      const mf=document.createElement("link");
      mf.rel="manifest";
      mf.href="manifest.webmanifest";
      document.head.appendChild(mf);
    }
  }
}
function prepareNewOrder(){
  currentOrder={
    id:uid(),
    poNumber:"",
    date:$("#orderDate")?.value || todayISO(),
    requestedBy:"",
    status:"draft",
    lines:[],
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}
function bindUI(){
  $$("[data-close-dialog]").forEach(btn=>btn.addEventListener("click",()=>{
    const dlg=btn.closest("dialog");
    if(dlg) dlg.close();
  }));
  $$(".nav-btn").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
  $("#orderDate").addEventListener("change",()=>{
    currentOrder.date=$("#orderDate").value;
    if(!$("#poNumber").value.trim()) $("#poNumber").value=suggestedPo();
  });
  $("#requestedBy").addEventListener("input",e=>currentOrder.requestedBy=e.target.value);
  $("#poNumber").addEventListener("input",e=>currentOrder.poNumber=e.target.value.trim().toUpperCase());

  $("#productSearch").addEventListener("input",renderSearchResults);
  $("#catalogSearch").addEventListener("input",renderCatalog);
  $("#inactiveSearch").addEventListener("input",renderInactive);
  $("#orderSearch").addEventListener("input",renderOrders);

  $("#saveDraftBtn").addEventListener("click",saveDraft);
  $("#sendOrderBtn").addEventListener("click",sendOrder);
  $("#shareBtn").addEventListener("click",()=>shareCSV(currentOrder));

  $("#qtyForm").addEventListener("submit",e=>{
    e.preventDefault();
    const qty=Number($("#qtyInput").value);
    if(!qty || qty<=0) return;
    addLine(currentQtyProduct,qty);
    $("#qtyDialog").close();
  });
  $("#receiveAllBtn").addEventListener("click",()=>{
    $$("#receiveLines input[data-received]").forEach(inp=>{
      inp.value=inp.dataset.ordered;
      inp.closest(".receive-row").classList.remove("missing");
    });
  });
  $("#receiveForm").addEventListener("submit",e=>{e.preventDefault();saveReception();});
  $("#detailCloseBtn").addEventListener("click",()=>$("#orderDetailDialog").close());
  $("#detailReceiveBtn").addEventListener("click",()=>{
    const id=$("#orderDetailDialog").dataset.orderId;
    $("#orderDetailDialog").close();
    openReceive(id);
  });
  $("#detailCsvBtn").addEventListener("click",()=>{
    const id=$("#orderDetailDialog").dataset.orderId;
    const o=orders.find(x=>x.id===id);
    if(o) shareCSV(o);
  });
  $("#catalogImportBtn").addEventListener("click",()=>$("#catalogFileInput").click());
  $("#catalogFileInput").addEventListener("change",handleCatalogFile);
  $("#catalogImportCancel").addEventListener("click",()=>{
    pendingCatalogImport=null;
    $("#catalogFileInput").value="";
    $("#catalogImportDialog").close();
  });
  $("#catalogImportApply").addEventListener("click",applyCatalogUpdate);
  $("#addProductBtn").addEventListener("click",()=>$("#addProductDialog").showModal());
  $("#addProductForm").addEventListener("submit",e=>{e.preventDefault();addManualProduct();});
  $("#adminKeyBtn").addEventListener("click",openKeyDialog);
  $("#keyForm").addEventListener("submit",e=>{e.preventDefault();saveAdminKey();});
  $("#restoreForm").addEventListener("submit",e=>{e.preventDefault();restoreProduct();});
  $("#undoBtn").addEventListener("click",doUndo);
}

function switchView(view){
  $$(".view").forEach(v=>v.classList.remove("active"));
  $$(".nav-btn").forEach(v=>v.classList.remove("active"));
  $(`#view-${view}`).classList.add("active");
  $(`.nav-btn[data-view="${view}"]`).classList.add("active");
  if(view==="orders") renderOrders();
  if(view==="catalog") renderCatalog();
  if(view==="inactive") renderInactive();
}

function renderAll(){
  const s=suggestedPo();
  const last = orders.map(o=>({po:o.poNumber,seq:parseSeq(o.poNumber)})).filter(x=>x.seq!=null).sort((a,b)=>b.seq-a.seq)[0];
  $("#lastPoText").textContent=last ? `Última PO registrada: ${last.po}` : "Aún no hay una PO anterior registrada.";
  if(!$("#poNumber").value && s) $("#poNumber").value=s;
  currentOrder.poNumber=$("#poNumber").value.trim().toUpperCase();
  renderPriority();
  renderSearchResults();
  renderOrders();
  renderCatalog();
  renderInactive();
  updateStatusUI();
}
function renderSearchResults(){
  const q=normalize($("#productSearch").value.trim());
  const box=$("#searchResults");
  if(q.length<2){ box.innerHTML=""; return; }
  const added=new Set(currentOrder.lines.map(l=>l.itemId));
  const results=catalog.filter(p=>p.active && !added.has(p.itemId) &&
    (normalize(p.itemId).includes(q)||normalize(p.description).includes(q))).slice(0,25);
  box.innerHTML=results.length ? results.map(p=>`
    <div class="search-result">
      <div class="code">${escapeHtml(p.itemId)}</div>
      <div class="desc">${escapeHtml(p.description)}</div>
      <div class="um-col muted">U/M ${escapeHtml(p.umId ?? "—")}</div>
      <button class="btn primary add-result" data-id="${escapeHtml(p.itemId)}">Agregar</button>
    </div>`).join("") : `<div class="empty-state">No hay coincidencias activas.</div>`;
  $$(".add-result").forEach(b=>b.onclick=()=>{
    currentQtyProduct=catalog.find(p=>p.itemId===b.dataset.id);
    $("#qtyTitle").textContent=currentQtyProduct.itemId;
    $("#qtyDescription").textContent=currentQtyProduct.description;
    $("#qtyInput").value="";
    $("#qtyDialog").showModal();
    setTimeout(()=>$("#qtyInput").focus(),80);
  });
}
function addLine(product,qty){
  currentOrder.lines.push({
    itemId:product.itemId, description:product.description, umId:product.umId,
    glAccount:product.glAccount, unitPrice:product.unitPrice, apAccount:product.apAccount,
    quantity:qty, pallets:null
  });
  currentOrder.updatedAt=new Date().toISOString();
  renderPriority(); renderSearchResults();
  showUndo(`Se agregó ${product.itemId}`, ()=>{
    currentOrder.lines=currentOrder.lines.filter(l=>l.itemId!==product.itemId);
    renderPriority();renderSearchResults();
  });
}
function renderPriority(){
  const box=$("#priorityList");
  $("#lineCount").textContent=`${currentOrder.lines.length} ${currentOrder.lines.length===1?"línea":"líneas"}`;
  if(!currentOrder.lines.length){
    box.classList.add("empty");
    box.innerHTML='<div class="empty-state">Busca un producto y agrega una cantidad para comenzar.</div>';
  } else {
    box.classList.remove("empty");
    box.innerHTML=currentOrder.lines.map((l,i)=>`
      <div class="priority-row" data-index="${i}">
        <div class="priority-num">${i+1}</div>
        <div class="drag-handle" title="Arrastrar">☰</div>
        <div class="code">${escapeHtml(l.itemId)}</div>
        <div class="desc">${escapeHtml(l.description)}</div>
        <div class="um-col muted">${escapeHtml(l.umId ?? "—")}</div>
        <input class="qty-edit" data-qty-index="${i}" type="number" min="0.01" step="0.01" value="${l.quantity}">
        <div class="pallet-col muted">${l.pallets==null?"—":l.pallets}</div>
        <button class="icon-btn del-line" data-del-index="${i}" title="Eliminar línea">×</button>
      </div>`).join("");
    bindReorder();
    $$("[data-qty-index]").forEach(inp=>inp.onchange=()=>{
      const i=Number(inp.dataset.qtyIndex), v=Number(inp.value);
      if(v>0) currentOrder.lines[i].quantity=v; else inp.value=currentOrder.lines[i].quantity;
      currentOrder.updatedAt=new Date().toISOString();
    });
    $$(".del-line").forEach(b=>b.onclick=()=>{
      const i=Number(b.dataset.delIndex);
      const removed=currentOrder.lines.splice(i,1)[0];
      renderPriority();renderSearchResults();
      showUndo(`Línea ${removed.itemId} eliminada`,()=>{
        currentOrder.lines.splice(i,0,removed);renderPriority();renderSearchResults();
      });
    });
  }
  updateStatusUI();
}
function bindReorder(){
  const rows=$$(".priority-row");
  rows.forEach(row=>{
    const handle=row.querySelector(".drag-handle");
    handle.addEventListener("pointerdown",e=>startPointerDrag(e,Number(row.dataset.index),row));
  });
}
function startPointerDrag(e,index,row){
  if(currentOrder.status!=="draft") return;
  e.preventDefault();
  dragIndex=index;
  row.classList.add("dragging");
  try{ row.querySelector(".drag-handle").setPointerCapture(e.pointerId); }catch(_){}
  const move=ev=>{
    const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest(".priority-row");
    $$(".priority-row").forEach(r=>r.classList.remove("drag-over"));
    if(target && Number(target.dataset.index)!==dragIndex) target.classList.add("drag-over");
  };
  const up=ev=>{
    document.removeEventListener("pointermove",move);
    document.removeEventListener("pointerup",up);
    row.classList.remove("dragging");
    const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest(".priority-row");
    $$(".priority-row").forEach(r=>r.classList.remove("drag-over"));
    if(target){
      const to=Number(target.dataset.index);
      if(Number.isFinite(to) && to!==dragIndex){
        const from=dragIndex;
        const snapshot=[...currentOrder.lines];
        const [moved]=currentOrder.lines.splice(from,1);
        currentOrder.lines.splice(to,0,moved);
        renderPriority();
        showUndo(`Prioridad modificada`,()=>{currentOrder.lines=snapshot;renderPriority();});
      }
    }
    dragIndex=null;
  };
  document.addEventListener("pointermove",move);
  document.addEventListener("pointerup",up,{once:true});
}
function updateStatusUI(){
  const b=$("#statusBadge");
  b.textContent=statusLabel(currentOrder.status);
  b.className=`badge ${currentOrder.status}`;
  const editable=currentOrder.status==="draft";
  $("#saveDraftBtn").disabled=!editable;
  $("#sendOrderBtn").disabled=!editable || currentOrder.lines.length===0;
  $("#shareBtn").disabled=!editable || currentOrder.lines.length===0;
  $("#requestedBy").disabled=!editable;
  $("#poNumber").disabled=!editable;
  $("#orderDate").disabled=!editable;
  $("#productSearch").disabled=!editable;
  $$(".qty-edit,.del-line").forEach(el=>el.disabled=!editable);
}

function validateOrder(){
  currentOrder.poNumber=$("#poNumber").value.trim().toUpperCase();
  currentOrder.requestedBy=$("#requestedBy").value.trim();
  currentOrder.date=$("#orderDate").value;
  if(!currentOrder.poNumber) return "Debes asignar el número de PO.";
  if(!currentOrder.requestedBy) return "Debes indicar quién solicita el pedido.";
  if(!currentOrder.date) return "Debes indicar la fecha.";
  if(!currentOrder.lines.length) return "El pedido no tiene líneas.";
  const duplicate=orders.find(o=>o.poNumber===currentOrder.poNumber && o.id!==currentOrder.id);
  if(duplicate) return `Ya existe ${currentOrder.poNumber}.`;
  return null;
}
async function saveDraft(){
  const err=validateOrder(); if(err){alert(err);return;}
  currentOrder.status="draft"; currentOrder.updatedAt=new Date().toISOString();
  upsertCurrentOrder();
  await persistOrders();
  showSnack("Borrador guardado");
  renderAll();
}
async function sendOrder(){
  const err=validateOrder(); if(err){alert(err);return;}
  const po=currentOrder.poNumber;
  if(!confirm(`¿Guardar ${po} como pedido enviado?\n\nContiene ${currentOrder.lines.length} líneas. Quedará disponible en Pedidos y se iniciará un nuevo pedido.`)) return;
  currentOrder.status="sent";
  currentOrder.sentAt=new Date().toISOString();
  currentOrder.updatedAt=currentOrder.sentAt;
  upsertCurrentOrder();
  await persistOrders();
  resetNewOrder();
  renderAll();
  showSnack(`${po} guardado como ENVIADO`);
}
function upsertCurrentOrder(){
  const idx=orders.findIndex(o=>o.id===currentOrder.id);
  const copy=structuredClone(currentOrder);
  if(idx>=0) orders[idx]=copy; else orders.push(copy);
}
async function persistOrders(){ await idbSet("orders",orders); }

function renderOrders(){
  const box=$("#ordersList"); if(!box) return;
  const q=normalize($("#orderSearch")?.value||"");
  const list=[...orders]
    .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .filter(o=>!q || normalize(`${o.poNumber} ${o.requestedBy} ${statusLabel(o.status)}`).includes(q));

  box.innerHTML=list.length?list.map(o=>`
    <div class="order-row">
      <div>
        <div class="code">${escapeHtml(o.poNumber)}</div>
        <div class="order-date muted">${formatDateDisplay(o.date)}</div>
      </div>
      <span class="badge ${o.status}">${statusLabel(o.status)}</span>
      <div class="requested">${escapeHtml(o.requestedBy)}</div>
      <div class="order-meta muted">${o.lines.length} líneas</div>
      <div class="actions">
        <button class="btn ghost view-order" data-id="${o.id}">Ver</button>
        ${o.status==="draft"?`<button class="btn secondary open-order" data-id="${o.id}">Continuar</button>`:""}
        ${o.status==="sent"?`<button class="btn primary receive-order" data-id="${o.id}">Recibir</button>`:""}
      </div>
    </div>`).join(""):'<div class="empty-state">No hay pedidos registrados.</div>';

  $$(".view-order").forEach(b=>b.onclick=()=>openOrderDetail(b.dataset.id));
  $$(".open-order").forEach(b=>b.onclick=()=>loadDraft(b.dataset.id));
  $$(".receive-order").forEach(b=>b.onclick=()=>openReceive(b.dataset.id));
}

function openOrderDetail(id){
  const o=orders.find(x=>x.id===id); if(!o)return;
  $("#orderDetailDialog").dataset.orderId=id;
  $("#detailPo").textContent=o.poNumber;
  $("#detailMeta").textContent=`${formatDateDisplay(o.date)} · Solicitado por ${o.requestedBy}`;
  $("#detailStatus").textContent=statusLabel(o.status);
  $("#detailStatus").className=`badge ${o.status}`;

  const receipt=o.receipt||null;
  const missingCount=receipt ? receipt.received.filter(x=>x.received < x.ordered).length : 0;
  const totalOrdered=o.lines.reduce((s,l)=>s+Number(l.quantity||0),0);
  const totalReceived=receipt ? receipt.received.reduce((s,l)=>s+Number(l.received||0),0) : null;

  $("#detailSummary").innerHTML=`
    <div><strong>Líneas</strong>${o.lines.length}</div>
    <div><strong>Cajas pedidas</strong>${totalOrdered}</div>
    <div><strong>Cajas recibidas</strong>${totalReceived==null?"—":totalReceived}</div>
    <div><strong>Faltantes</strong>${receipt?missingCount:"—"}</div>
  `;

  $("#detailLines").innerHTML=o.lines.map((l,i)=>{
    const rr=receipt?.received?.find(x=>x.itemId===l.itemId);
    const rec=rr ? Number(rr.received) : null;
    const diff=rr ? Number(rr.received)-Number(rr.ordered) : null;
    const miss=rr && rec < Number(l.quantity);
    return `
      <tr class="${miss?"missing":""}">
        <td>${i+1}</td>
        <td class="code">${escapeHtml(l.itemId)}</td>
        <td>${escapeHtml(l.description)}</td>
        <td>${l.quantity}</td>
        <td>${rec==null?"—":rec}</td>
        <td class="${diff!=null&&diff<0?"diff-negative":""}">${diff==null?"—":diff}</td>
      </tr>`;
  }).join("");

  const notes=receipt?.notes?.trim();
  $("#detailNotesWrap").hidden=!notes;
  $("#detailNotes").textContent=notes||"";

  $("#detailReceiveBtn").hidden=o.status!=="sent";
  $("#detailCsvBtn").hidden=o.status==="draft";
  $("#orderDetailDialog").showModal();
}

function loadDraft(id){
  const o=orders.find(x=>x.id===id); if(!o)return;
  currentOrder=structuredClone(o);
  $("#orderDate").value=o.date;$("#requestedBy").value=o.requestedBy;$("#poNumber").value=o.poNumber;
  switchView("newOrder");renderPriority();renderSearchResults();updateStatusUI();
}
function resetNewOrder(){
  prepareNewOrder();
  $("#orderDate").value=todayISO();currentOrder.date=todayISO();
  $("#requestedBy").value="";$("#productSearch").value="";
  $("#poNumber").value=suggestedPo();
  currentOrder.poNumber=$("#poNumber").value;
  renderPriority();renderSearchResults();updateStatusUI();
}

function openReceive(id){
  const o=orders.find(x=>x.id===id); if(!o)return;
  $("#receiveDialog").dataset.orderId=id;
  $("#receiveTitle").textContent=`Recibir ${o.poNumber}`;
  $("#receiveNotes").value=o.receipt?.notes||"";
  $("#receiveLines").innerHTML=o.lines.map((l,i)=>{
    const prev=o.receipt?.received?.find(x=>x.itemId===l.itemId);
    const value=prev ? prev.received : l.quantity;
    return `
      <div class="receive-row ${Number(value)<Number(l.quantity)?"missing":""}">
        <div class="code">${escapeHtml(l.itemId)}</div>
        <div>${escapeHtml(l.description)}</div>
        <div class="muted">Pidió: ${l.quantity}</div>
        <div class="received-field">
          <input data-received="${i}" data-ordered="${l.quantity}" type="number" min="0" step="0.01" value="${value}">
          <small>Recibido</small>
        </div>
      </div>`;
  }).join("");
  $("#receiveStatusHint")?.remove();
  $("#receiveLines").insertAdjacentHTML("afterend",
    '<p id="receiveStatusHint" class="receive-status-hint">Si alguna cantidad recibida es menor que la pedida, el pedido quedará como RECIBIDO INCOMPLETO.</p>'
  );
  $$("#receiveLines input").forEach(inp=>inp.oninput=()=>{
    const row=inp.closest(".receive-row");
    row.classList.toggle("missing",Number(inp.value)<Number(inp.dataset.ordered));
  });
  $("#receiveDialog").showModal();
}
async function saveReception(){
  const id=$("#receiveDialog").dataset.orderId;
  const o=orders.find(x=>x.id===id); if(!o)return;
  const received=$$("#receiveLines input[data-received]").map((inp,i)=>({
    itemId:o.lines[i].itemId, ordered:o.lines[i].quantity, received:Number(inp.value||0),
    difference:Number(inp.value||0)-Number(o.lines[i].quantity)
  }));
  const complete=received.every(x=>x.received>=x.ordered);
  o.receipt={received,notes:$("#receiveNotes").value.trim(),receivedAt:new Date().toISOString()};
  o.status=complete?"complete":"incomplete";
  o.updatedAt=new Date().toISOString();
  await persistOrders();
  $("#receiveDialog").close();
  renderOrders();
  showSnack(`${o.poNumber}: ${statusLabel(o.status)}`);
}


function parseCSV(text){
  const rows=[];
  let row=[], field="", quoted=false;
  text=String(text||"").replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){ field+='"'; i++; }
      else if(ch==='"'){ quoted=false; }
      else field+=ch;
    }else{
      if(ch==='"') quoted=true;
      else if(ch===','){ row.push(field); field=""; }
      else if(ch==='\n'){
        row.push(field); rows.push(row); row=[]; field="";
      }else if(ch!=='\r') field+=ch;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r=>r.some(c=>String(c).trim()!==""));
}
function cleanHeader(h){
  return normalize(String(h||"").replace(/\s+/g," ").trim()).replace(/[^a-z0-9]/g,"");
}
function numberOrNull(v){
  const s=String(v??"").trim().replace(/,/g,"");
  if(!s) return null;
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}
function catalogHeaderMap(headers){
  const m={};
  headers.forEach((h,i)=>{
    const k=cleanHeader(h);
    if(["itemid","item"].includes(k)) m.itemId=i;
    else if(["description","descripcion"].includes(k)) m.description=i;
    else if(["umid","um"].includes(k)) m.umId=i;
    else if(["glaccount","glacct"].includes(k)) m.glAccount=i;
    else if(["unitprice","stockingunitprice","precio"].includes(k)) m.unitPrice=i;
    else if(["accountspayableaccount","accounspayableaccount","apaccount"].includes(k)) m.apAccount=i;
  });
  return m;
}
async function handleCatalogFile(e){
  const file=e.target.files?.[0];
  if(!file) return;
  if(!file.name.toLowerCase().endsWith(".csv")){
    alert("Por ahora GPI actualiza el catálogo desde CSV. Exporta el catálogo de Sage como CSV y vuelve a seleccionarlo.");
    e.target.value="";
    return;
  }
  try{
    const text=await file.text();
    const rows=parseCSV(text);
    if(rows.length<2) throw new Error("El archivo no contiene datos suficientes.");
    const headers=rows[0];
    const map=catalogHeaderMap(headers);
    const required=["itemId","description","umId","glAccount","unitPrice","apAccount"];
    const labels={
      itemId:"Item ID",description:"Description",umId:"U/M ID",
      glAccount:"G/L Account",unitPrice:"Unit Price",apAccount:"Accounts Payable Account"
    };
    const missing=required.filter(k=>map[k]===undefined);
    if(missing.length){
      throw new Error(`Faltan columnas requeridas: ${missing.map(k=>labels[k]).join(", ")}.`);
    }

    const incoming=[];
    const issues=[];
    const seen=new Set();

    rows.slice(1).forEach((r,idx)=>{
      const line=idx+2;
      const itemId=String(r[map.itemId]??"").trim().toUpperCase();
      const description=String(r[map.description]??"").trim();
      if(!itemId || !description){
        issues.push(`Fila ${line}: Item ID o Description vacío. Se omitirá.`);
        return;
      }
      if(seen.has(itemId)){
        issues.push(`Fila ${line}: ${itemId} está duplicado en el archivo. Se usará la primera aparición.`);
        return;
      }
      seen.add(itemId);

      const p={
        itemId,
        description,
        umId:String(r[map.umId]??"").trim() || null,
        glAccount:String(r[map.glAccount]??"").trim() || null,
        unitPrice:numberOrNull(r[map.unitPrice]),
        apAccount:String(r[map.apAccount]??"").trim() || null
      };
      if(p.unitPrice===null){
        issues.push(`Fila ${line}: ${itemId} no tiene Unit Price válido.`);
      }
      incoming.push(p);
    });

    const existingById=new Map(catalog.map(p=>[String(p.itemId).toUpperCase(),p]));
    let added=0, updated=0, preservedInactive=0, unchanged=0;
    for(const p of incoming){
      const old=existingById.get(p.itemId);
      if(!old){ added++; continue; }
      if(!old.active) preservedInactive++;
      const changed=
        String(old.description??"")!==String(p.description??"") ||
        String(old.umId??"")!==String(p.umId??"") ||
        String(old.glAccount??"")!==String(p.glAccount??"") ||
        Number(old.unitPrice??0)!==Number(p.unitPrice??0) ||
        String(old.apAccount??"")!==String(p.apAccount??"");
      changed ? updated++ : unchanged++;
    }

    pendingCatalogImport={fileName:file.name,incoming,issues,added,updated,preservedInactive,unchanged};
    $("#catalogImportFile").innerHTML=`<strong>${escapeHtml(file.name)}</strong><br><span class="muted">${incoming.length} códigos válidos detectados</span>`;
    $("#catalogImportSummary").innerHTML=`
      <div><strong>${added}</strong><span>Nuevos</span></div>
      <div><strong>${updated}</strong><span>Actualizados</span></div>
      <div><strong>${preservedInactive}</strong><span>Inactivos conservados</span></div>
      <div><strong>${issues.length}</strong><span>Observaciones</span></div>`;
    $("#catalogImportIssues").innerHTML=issues.length
      ? issues.slice(0,30).map(x=>`<div class="import-issue">${escapeHtml(x)}</div>`).join("") +
        (issues.length>30?`<div class="muted">... y ${issues.length-30} observaciones adicionales.</div>`:"")
      : '<div class="muted">No se detectaron problemas en el archivo.</div>';
    $("#catalogImportApply").disabled=incoming.length===0;
    $("#catalogImportDialog").showModal();
  }catch(err){
    alert(`No se pudo leer el catálogo:\n${err.message}`);
    e.target.value="";
  }
}
async function applyCatalogUpdate(){
  if(!pendingCatalogImport) return;
  const snapshot=structuredClone(catalog);
  const byId=new Map(catalog.map(p=>[String(p.itemId).toUpperCase(),p]));
  let added=0,updated=0;

  for(const inc of pendingCatalogImport.incoming){
    const old=byId.get(inc.itemId);
    if(old){
      old.description=inc.description;
      old.umId=inc.umId;
      old.glAccount=inc.glAccount;
      old.unitPrice=inc.unitPrice;
      old.apAccount=inc.apAccount;
      old.lastCatalogUpdate=new Date().toISOString();
      if(old.createdManually &&
         old.glAccount!=null && old.unitPrice!=null && old.apAccount!=null){
        old.createdManually=false;
      }
      updated++;
    }else{
      const p={
        ...inc,
        active:true,
        createdManually:false,
        importedAt:new Date().toISOString()
      };
      catalog.push(p);byId.set(inc.itemId,p);added++;
    }
  }

  const audit=await idbGet("audit")||[];
  audit.push({
    type:"CATALOG_UPDATE",
    fileName:pendingCatalogImport.fileName,
    added,
    updated,
    issues:pendingCatalogImport.issues.length,
    date:new Date().toISOString()
  });

  await idbSet("catalog",catalog);
  await idbSet("audit",audit);
  const fileName=pendingCatalogImport.fileName;
  pendingCatalogImport=null;
  $("#catalogFileInput").value="";
  $("#catalogImportDialog").close();
  renderCatalog();renderInactive();renderSearchResults();
  showUndo(`Catálogo actualizado desde ${fileName}`,async()=>{
    catalog=snapshot;
    await idbSet("catalog",catalog);
    renderCatalog();renderInactive();renderSearchResults();
  });
}

function renderCatalog(){
  const box=$("#catalogList"); if(!box)return;
  const q=normalize($("#catalogSearch")?.value||"");
  const list=catalog.filter(p=>p.active && (!q || normalize(`${p.itemId} ${p.description}`).includes(q))).slice(0,250);
  box.innerHTML=list.length?list.map(p=>`
    <div class="catalog-row">
      <div class="code">${escapeHtml(p.itemId)}</div>
      <div class="desc">${escapeHtml(p.description)}${p.createdManually?'<div class="muted">Creado manualmente</div>':""}</div>
      <div class="um-col muted">U/M ${escapeHtml(p.umId??"—")}</div>
      <div class="catalog-actions">
        <button class="catalog-icon-btn inactivate" data-id="${escapeHtml(p.itemId)}" title="Inactivar" aria-label="Inactivar ${escapeHtml(p.itemId)}">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M9 8v8M15 8v8"></path>
          </svg>
        </button>
        <button class="catalog-icon-btn delete delete-product" data-id="${escapeHtml(p.itemId)}" title="Eliminar" aria-label="Eliminar ${escapeHtml(p.itemId)}">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h16"></path>
            <path d="M9 7V4h6v3"></path>
            <path d="M7 7l1 13h8l1-13"></path>
            <path d="M10 11v5M14 11v5"></path>
          </svg>
        </button>
      </div>
    </div>`).join(""):'<div class="empty-state">No hay productos activos.</div>';
  $$(".inactivate").forEach(b=>b.onclick=()=>inactivateProduct(b.dataset.id));
  $$(".delete-product").forEach(b=>b.onclick=()=>deleteProductPermanently(b.dataset.id));
}
async function inactivateProduct(id){
  const p=catalog.find(x=>x.itemId===id); if(!p)return;
  if(!confirm(`¿Inactivar ${p.itemId}?\n\nDejará de aparecer en nuevos pedidos, pasará a Inactivos y conservará su historial.`)) return;
  p.active=false;p.inactivatedAt=new Date().toISOString();
  await idbSet("catalog",catalog);
  renderCatalog();renderInactive();renderSearchResults();
  showUndo(`${p.itemId} inactivado`,async()=>{
    p.active=true;delete p.inactivatedAt;await idbSet("catalog",catalog);
    renderCatalog();renderInactive();renderSearchResults();
  });
}

async function deleteProductPermanently(id){
  const p=catalog.find(x=>x.itemId===id); if(!p)return;
  const ok=confirm(
    `¿Eliminar definitivamente ${p.itemId} del catálogo?\n\n` +
    `Esta acción lo quita del catálogo maestro y NO podrá restaurarse desde Inactivos.\n` +
    `Los pedidos históricos conservarán la información que ya tenían.`
  );
  if(!ok) return;

  const index=catalog.findIndex(x=>x.itemId===id);
  const removed=structuredClone(catalog[index]);
  catalog.splice(index,1);

  const audit=await idbGet("audit")||[];
  audit.push({
    type:"DELETE_PRODUCT",
    itemId:id,
    description:removed.description,
    date:new Date().toISOString()
  });

  await idbSet("catalog",catalog);
  await idbSet("audit",audit);
  renderCatalog();renderInactive();renderSearchResults();

  showUndo(`${id} eliminado`,async()=>{
    catalog.splice(index,0,removed);
    await idbSet("catalog",catalog);
    renderCatalog();renderInactive();renderSearchResults();
  });
}

function renderInactive(){
  const box=$("#inactiveList");if(!box)return;
  const q=normalize($("#inactiveSearch")?.value||"");
  const list=catalog.filter(p=>!p.active && (!q || normalize(`${p.itemId} ${p.description}`).includes(q))).slice(0,250);
  box.innerHTML=list.length?list.map(p=>`
    <div class="catalog-row inactive">
      <div class="code">${escapeHtml(p.itemId)}</div>
      <div class="desc">${escapeHtml(p.description)}</div>
      <div class="um-col muted">U/M ${escapeHtml(p.umId??"—")}</div>
      <button class="btn primary restore" data-id="${escapeHtml(p.itemId)}">Restaurar</button>
    </div>`).join(""):'<div class="empty-state">No hay productos inactivos.</div>';
  $$(".restore").forEach(b=>b.onclick=()=>{
    currentRestoreProduct=catalog.find(p=>p.itemId===b.dataset.id);
    $("#restoreProductText").textContent=`${currentRestoreProduct.itemId} — ${currentRestoreProduct.description}`;
    $("#restorePassword").value="";$("#restoreReason").value="";
    $("#restoreDialog").showModal();
  });
}
async function restoreProduct(){
  const stored=await idbGet("adminKeyHash");
  if(!stored){alert("Primero debes configurar la clave administrativa.");$("#restoreDialog").close();openKeyDialog();return;}
  const hash=await sha256($("#restorePassword").value);
  if(hash!==stored){alert("Clave incorrecta.");return;}
  const reason=$("#restoreReason").value.trim();
  if(!reason){alert("Debes indicar el motivo de restauración.");return;}
  currentRestoreProduct.active=true;
  currentRestoreProduct.restoredAt=new Date().toISOString();
  const audit=await idbGet("audit")||[];
  audit.push({type:"RESTORE_PRODUCT",itemId:currentRestoreProduct.itemId,reason,date:new Date().toISOString()});
  await idbSet("catalog",catalog);await idbSet("audit",audit);
  $("#restoreDialog").close();renderInactive();renderCatalog();renderSearchResults();
  showSnack(`${currentRestoreProduct.itemId} restaurado`);
}
function addManualProduct(){
  const itemId=$("#newItemId").value.trim().toUpperCase();
  const desc=$("#newDescription").value.trim();
  if(catalog.some(p=>p.itemId===itemId)){alert("Ese Item ID ya existe.");return;}
  catalog.push({
    itemId,description:desc,umId:$("#newUmId").value.trim()||null,
    glAccount:null,unitPrice:null,apAccount:2000,active:true,createdManually:true
  });
  idbSet("catalog",catalog);
  $("#addProductDialog").close();$("#addProductForm").reset();renderCatalog();
  showSnack(`${itemId} agregado al catálogo`);
}
async function openKeyDialog(){
  const exists=!!(await idbGet("adminKeyHash"));
  $("#currentKeyWrap").hidden=!exists;
  $("#currentKey").value="";$("#newKey").value="";$("#confirmKey").value="";
  $("#keyDialog").showModal();
}
async function saveAdminKey(){
  const existing=await idbGet("adminKeyHash");
  if(existing){
    const current=await sha256($("#currentKey").value);
    if(current!==existing){alert("La clave actual no coincide.");return;}
  }
  if($("#newKey").value!==$("#confirmKey").value){alert("Las claves nuevas no coinciden.");return;}
  await idbSet("adminKeyHash",await sha256($("#newKey").value));
  $("#keyDialog").close();showSnack("Clave administrativa guardada");
}

function csvEscape(v){
  const s=String(v??"");
  return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function buildCSV(order){
  const bad=order.lines.filter(l=>l.glAccount==null || l.unitPrice==null || l.apAccount==null);
  if(bad.length) throw new Error(`Faltan datos técnicos de Sage en: ${bad.map(x=>x.itemId).join(", ")}`);
  const headers=["Date","PO #","Vendor ID","Quantity","Item ID","Description","U/M ID","U/M No. of Stocking Units","G/L Account","Unit Price","Accounts Payable Account","Number of Distributions","Amount"];
  const n=order.lines.length;
  const rows=order.lines.map(l=>[
    sageDate(order.date),order.poNumber,100,l.quantity,l.itemId,l.description,l.umId??"", "1.00",
    l.glAccount,Number(l.unitPrice).toFixed(2),l.apAccount,n,(Number(l.quantity)*Number(l.unitPrice)).toFixed(2)
  ]);
  return [headers,...rows].map(r=>r.map(csvEscape).join(",")).join("\r\n");
}
function makeCSVFile(order){
  const text=buildCSV(order);
  return new File([text],`${order.poNumber}.csv`,{type:"text/csv;charset=utf-8"});
}
function downloadCSV(order){
  try{
    const file=makeCSVFile(order);
    const a=document.createElement("a");
    a.href=URL.createObjectURL(file);a.download=file.name;a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    showSnack("CSV generado para Sage");
  }catch(e){alert(e.message);}
}
async function shareCSV(order){
  try{
    if(order.id===currentOrder.id){
      const err=validateOrder();
      if(err){ alert(err); return; }
    }
    const file=makeCSVFile(order);
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({title:order.poNumber,text:`Proforma ${order.poNumber} para importar en Sage.`,files:[file]});
    }else{
      downloadCSV(order);
      alert("Esta tablet/navegador no permite adjuntar archivos con Compartir. Se descargó el CSV para enviarlo manualmente.");
    }
  }catch(e){
    if(e.name!=="AbortError") alert(e.message);
  }
}

function showUndo(text,fn){
  undoAction=fn;showSnack(text,true);
}
function showSnack(text,undo=false){
  $("#snackbarText").textContent=text;
  $("#undoBtn").style.display=undo?"inline":"none";
  $("#snackbar").classList.add("show");
  clearTimeout(window.__snack);
  window.__snack=setTimeout(()=>{$("#snackbar").classList.remove("show");undoAction=null;},5000);
}
function doUndo(){
  if(undoAction){const fn=undoAction;undoAction=null;fn();}
  $("#snackbar").classList.remove("show");
}

window.addEventListener("DOMContentLoaded",init);
