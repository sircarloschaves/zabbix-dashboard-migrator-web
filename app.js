import {VERSIONS, REF_TYPES, normalizeDashboard, collectReferences, createExport, readExports, reportCompatibility, prepareDashboard, filename} from "./core.mjs";
const $=id=>document.getElementById(id);
const state={listed:[],selected:new Set(),imports:[],exported:[],prepared:null,logs:[],busy:false};
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const idSafe=s=>String(s||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,100);
const apiFields={src:["src-url","src-token","src-ver"],dst:["dst-url","dst-token","dst-ver"]};
function log(message,level="INFO"){
 let msg=String(message??"");
 for(const id of ["src-token","dst-token"]){let t=$(id).value.trim();if(t)msg=msg.split(t).join("[TOKEN OCULTO]");}
 state.logs.push(`${new Date().toLocaleTimeString("pt-BR")}  [${level}]  ${msg}`);
 $("log-output").textContent=state.logs.join("\n");$("log-output").scrollTop=$("log-output").scrollHeight;
}
function notice(message,type="info"){const el=$("notice");el.hidden=false;el.textContent=message;el.className="alert "+(type==="error"?"error":type==="success"?"success":"");}
function resetNotice(){$("notice").hidden=true;}
function setBusy(v){state.busy=v;document.body.classList.toggle("busy",v);}
async function run(name,fn){if(state.busy)return;setBusy(true);resetNotice();log(name);try{await fn();}catch(e){notice(e.message||String(e),"error");log(e.message||String(e),"ERRO");}finally{setBusy(false);}}
function section(name){
 document.querySelectorAll(".view").forEach(el=>el.hidden=el.id!==`view-${name}`);
 document.querySelectorAll(".nav-btn").forEach(el=>el.classList.toggle("active",el.dataset.view===name));
 $("crumb-current").textContent={connections:"Conexões",export:"Exportar",import:"Importar",logs:"Diagnóstico"}[name];
 window.scrollTo?.({top:0,behavior:"smooth"});
}
document.querySelectorAll(".nav-btn").forEach(btn=>btn.onclick=()=>section(btn.dataset.view));
document.querySelectorAll("[data-go]").forEach(btn=>btn.onclick=()=>section(btn.dataset.go));
document.querySelectorAll("[data-toggle]").forEach(btn=>btn.onclick=()=>{const inp=$(btn.dataset.toggle);inp.type=inp.type==="password"?"text":"password";});
function connection(env){
 const [urlKey,tokenKey,verKey]=apiFields[env];
 const u=$(urlKey).value.trim(), t=$(tokenKey).value.trim(), v=$(verKey).value;
 if(!u)throw Error(`Informe a URL da API no ambiente ${env}.`);
 let uri;try{uri=new URL(u);}catch{throw Error("URL da API inválida. Informe o endereço completo com https://.");}
 const local=["localhost","127.0.0.1","[::1]"].includes(uri.hostname);
 if(uri.protocol!=="https:"&&!(local&&uri.protocol==="http:"))throw Error("Por segurança, use HTTPS. HTTP é permitido somente no localhost.");
 if(!uri.pathname.endsWith("/api_jsonrpc.php"))throw Error("URL deve terminar em /api_jsonrpc.php (pode haver uma instalação em subpasta).");
 if(!t)throw Error(`Informe o token do ambiente ${env}.`);
 return {url:uri.toString(),token:t,version:v};
}
async function api(env,method,params={}){
 let conf=typeof env==="string"?connection(env):env;
 let headers={"Content-Type":"application/json-rpc","Accept":"application/json"};
 if(method!=="apiinfo.version")headers.Authorization=`Bearer ${conf.token}`;
 let response;
 try{
   response=await fetch(conf.url,{method:"POST",headers,body:JSON.stringify({jsonrpc:"2.0",method,params,id:1}),mode:"cors",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(60000)});
 }catch(err){
   throw Error(`Falha de rede/CORS ao executar ${method}. Verifique HTTPS, VPN, acesso ao endpoint, certificado e CORS no Zabbix. Detalhe: ${err.message}`);
 }
 if(!response.ok)throw Error(`HTTP ${response.status} (${method}). Verifique servidor e proxy de API.`);
 let data;
 try{data=await response.json();}catch{throw Error(`Resposta não JSON na API (${method}).`);}
 if(data.error)throw Error(`API ${method}: ${data.error.message||"Erro"} — ${data.error.data||""}`);
 return data.result;
}
async function testConnection(env){
 const conf=connection(env);
 const status=$(env==="src"?"src-status":"dst-status"),result=$(env==="src"?"src-result":"dst-result");
 status.className="status";status.textContent="Testando...";
 try{
  const ver=String(await api(conf,"apiinfo.version",{}));
  const apiMajor=ver.match(/^(\d+\.\d+)/)?.[1]||ver;
  const objs=await api(conf,"dashboard.get",{output:["dashboardid","name"],limit:1});
  const hint=apiMajor!==conf.version?` A seleção foi ajustada de ${conf.version} para ${ver}.`:"";
  if(VERSIONS.includes(apiMajor)){
    $(env==="src"?"src-ver":"dst-ver").value=apiMajor;
    if(env==="dst")invalidate();
  }
  status.className="status good";status.textContent="Conectado";
  result.textContent=`Servidor ${ver}. Permissão dashboard.get OK.${hint}`;
  log(`${env==="src"?"Origem":"Destino"} conectado: versão ${ver}.`);
  if(hint)notice(hint.trim());
 }catch(e){
   status.className="status bad";status.textContent="Erro";
   result.textContent=e.message;throw e;
 }
}
$("btn-src-test").onclick=()=>run("Testando conexão de origem",()=>testConnection("src"));
$("btn-dst-test").onclick=()=>run("Testando conexão de destino",()=>testConnection("dst"));
function invalidate(){
 state.prepared=null;$("btn-apply").disabled=true;$("btn-save-payload").disabled=true;
 $("payload-preview").textContent="Execute o DRY-RUN para gerar uma prévia.";
 $("report").innerHTML='<div class="empty">Opções alteradas. Execute o DRY-RUN novamente.</div>';
}
["dst-url","dst-token","dst-ver","new-name","migration-mode","skip-unsupported","skip-unresolved","ack-unknown-version","import-dash"].forEach(id=>$(id).addEventListener("change",invalidate));
["dst-token","new-name"].forEach(id=>$(id).addEventListener("input",invalidate));
function renderList(){
 const search=$("search-dashboard").value.toLocaleLowerCase("pt-BR");
 const arr=state.listed.filter(d=>String(d.name).toLocaleLowerCase("pt-BR").includes(search));
 const cont=$("dashboard-list");cont.replaceChildren();
 if(!arr.length){cont.innerHTML='<div class="empty">Nenhum dashboard encontrado.</div>';}
 else for(const dash of arr){
  const label=document.createElement("label");label.className="dash-row";
  const check=document.createElement("input");check.type="checkbox";check.checked=state.selected.has(String(dash.dashboardid));
  check.addEventListener("change",()=>{check.checked?state.selected.add(String(dash.dashboardid)):state.selected.delete(String(dash.dashboardid));updateSelection();});
  const desc=document.createElement("div");const strong=document.createElement("strong");strong.textContent=dash.name||"(sem nome)";
  const small=document.createElement("small");small.textContent=`ID ${dash.dashboardid} · ${String(dash.private)==="0"?"Público":"Privado"}`;
  desc.append(strong,small);label.append(check,desc);cont.append(label);
 }
 updateSelection();
}
function updateSelection(){$("selected-count").textContent=`${state.selected.size} selecionado(s)`;}
$("search-dashboard").addEventListener("input",renderList);
$("select-all").onclick=()=>{const q=$("search-dashboard").value.toLocaleLowerCase("pt-BR");state.listed.filter(d=>d.name.toLocaleLowerCase("pt-BR").includes(q)).forEach(d=>state.selected.add(String(d.dashboardid)));renderList();};
$("clear-all").onclick=()=>{state.selected.clear();renderList();};
$("btn-list").onclick=()=>run("Listando dashboards globais",async()=>{
 const res=await api("src","dashboard.get",{output:["dashboardid","name","private"],sortfield:"dashboardid"});
 state.listed=[...res].sort((a,b)=>String(a.name).localeCompare(String(b.name),"pt-BR"));
 state.selected.clear();$("export-count").textContent=`${state.listed.length} dashboard(s) visível(is) para o token.`;
 renderList();log(`Listagem concluída: ${state.listed.length} dashboards.`);
 notice(`${state.listed.length} dashboards globais listados.`,"success");
});
const unique=arr=>[...new Set(arr)];
async function getMetadata(dashboard){
 const refs=collectReferences(dashboard);
 const objects={},errors=[];
 const grouped=new Map();
 for(const ref of refs){if(!grouped.has(ref.type))grouped.set(ref.type,[]);grouped.get(ref.type).push(ref.id);}
 for(const [type,ids] of grouped){
  const def=REF_TYPES[type];if(!def)continue;
  for(let i=0;i<ids.length;i+=75){
    const chunk=unique(ids.slice(i,i+75)),params={output:"extend",[def.arg]:chunk};
    if([4,5,6,7].includes(type))params.selectHosts=["hostid","host","name"];
    let response;
    try{response=await api("src",def.method,params);}
    catch(e){
      if(params.selectHosts){
        delete params.selectHosts;
        try{response=await api("src",def.method,params);}
        catch(err){errors.push(`${def.name}: ${err.message}`);continue;}
      }else{errors.push(`${def.name}: ${e.message}`);continue;}
    }
    for(const obj of response||[]){
      if(obj[def.id]!==undefined)objects[`${type}:${obj[def.id]}`]=obj;
    }
  }
  log(`Metadados ${def.name}: ${ids.length} referência(s) solicitada(s).`);
 }
 const legacy={items:{},item_prototypes:{},graph_prototypes:{}};
 for(const [key,obj] of Object.entries(objects)){
    const [type,id]=key.split(":");const host=obj.hosts?.[0]||{};
    const normalized={...obj,host:host.host||obj.host||"",host_name:host.name||obj.host_name||""};
    if(type==="4")legacy.items[id]={source_itemid:id,item_name:obj.name,key_:obj.key_,hostid:obj.hostid,host:normalized.host,host_name:normalized.host_name};
    if(type==="5")legacy.item_prototypes[id]={source_itemid:id,item_name:obj.name,key_:obj.key_,hostid:obj.hostid,host:normalized.host,host_name:normalized.host_name};
    if(type==="7")legacy.graph_prototypes[id]={source_graphid:id,graph_name:obj.name,host:normalized.host,host_name:normalized.host_name};
 }
 return {objects,legacy,errors};
}
function downloadJson(data,name){
 const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
 const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=name;
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),6000);
}
$("btn-export").onclick=()=>run("Exportando dashboards",async()=>{
 if(!state.selected.size)throw Error("Selecione ao menos um dashboard.");
 const src=connection("src"),exports=[],failures=[];
 for(const id of state.selected){
  try{
   const ret=await api("src","dashboard.get",{output:"extend",dashboardids:[id],selectPages:"extend"});
   if(ret.length!==1)throw Error(`dashboardid ${id}: acesso não encontrado ou ambíguo.`);
   const dash=normalizeDashboard(ret[0]);
   const metadata=await getMetadata(dash);
   const exp=createExport(dash,metadata.objects,src.url,src.version,metadata.legacy);
   exports.push(exp);
   log(`Exportado '${dash.name}', ${dash.pages.length} página(s), ${collectReferences(dash).length} referência(s).`);
   if(metadata.errors.length){failures.push(...metadata.errors);log(`Avisos de metadados: ${metadata.errors.join(" | ")}`,"AVISO");}
  }catch(e){failures.push(`ID ${id}: ${e.message}`);log(`Falha ${id}: ${e.message}`,"ERRO");}
 }
 if(!exports.length)throw Error(`Nenhum dashboard exportado. ${failures.join(" | ")}`);
 const data=exports.length===1?exports[0]:{export_type:"zabbix_global_dashboard_bundle",export_version:5,source:{url:src.url,version:src.version},exports};
 const name=exports.length===1?filename(exports[0].dashboard.name):"zabbix_dashboards_bundle.json";
 downloadJson(data,name);
 notice(`Exportado(s): ${exports.length}. Arquivo ${name}. ${failures.length?failures.length+" aviso(s)/falha(s) registrados no diagnóstico.":""}`,failures.length?"info":"success");
});
function renderImportSelection(){
 $("import-dash").replaceChildren();
 for(const [i,entry] of state.imports.entries()){const option=document.createElement("option");option.value=String(i);option.textContent=entry.dashboard.name;$("import-dash").append(option);}
 if(state.imports.length){$("import-dash").value="0";showImportSummary();}else $("import-summary").textContent="Nenhum dashboard carregado.";
}
function selectedExport(){if(!state.imports.length)throw Error("Carregue um arquivo JSON.");const idx=Number($("import-dash").value);if(!state.imports[idx])throw Error("Selecione um dashboard do arquivo.");return state.imports[idx];}
function showImportSummary(){
 const exp=selectedExport(),d=exp.dashboard;
 const refs=collectReferences(d);const widgets=d.pages.reduce((n,p)=>n+p.widgets.length,0);
 $("import-summary").innerHTML=`<div class="summary-meta"><span><b>${d.pages.length}</b> página(s)</span><span><b>${widgets}</b> widget(s)</span><span><b>${refs.length}</b> referência(s) tipada(s)</span><span>Origem: ${esc(exp.source?.version||"não informada")}</span></div>
 <ul class="summary-list">${d.pages.map(p=>`<li>${esc(p.name||"(sem nome)")} — ${p.widgets.length} widget(s)</li>`).join("")}</ul>`;
 $("new-name").value=`MIGRACAO - ${d.name}`.slice(0,250);
 invalidate();
}
$("import-file").addEventListener("change",async e=>run("Lendo arquivo JSON local",async()=>{
 const file=e.target.files?.[0];if(!file)return;
 if(file.size>30*1024*1024)throw Error("JSON maior que 30 MB. Divida o arquivo antes.");
 const raw=await file.text();let parsed;
 try{parsed=JSON.parse(raw);}catch{throw Error("Arquivo não contém JSON válido.");}
 state.imports=readExports(parsed);
 renderImportSelection();log(`Arquivo carregado: ${state.imports.length} dashboard(s).`);
 notice(`${state.imports.length} dashboard(s) carregado(s) localmente.`,"success");
}));
$("import-dash").addEventListener("change",showImportSummary);
function sourceMeta(entry,ref){
 const key=ref.key;
 const obj=entry.references?.objects?.[key];if(obj)return obj;
 const r=entry.references||{};
 if(ref.type===4)return r.items?.[ref.id]||null;
 if(ref.type===5)return r.item_prototypes?.[ref.id]||null;
 if(ref.type===7)return r.graph_prototypes?.[ref.id]||null;
 return null;
}
const getOwners=m=>{
 const arr=[];
 for(const o of m?.hosts||[]){if(o?.host)arr.push(String(o.host));if(o?.name)arr.push(String(o.name));}
 if(m?.host&&typeof m.host==="string")arr.push(m.host);
 if(m?.host_name)arr.push(m.host_name);
 return unique(arr.filter(Boolean));
};
async function ownerIds(meta){
 const out={hostids:[],templateids:[]};
 for(const owner of getOwners(meta)){
  for(const method of ["host.get","template.get"]){
   for(const field of ["host","name"]){
    try{
     const idField=method==="host.get"?"hostid":"templateid";
     const arr=await api("dst",method,{output:[idField,"host","name"],filter:{[field]:[owner]}});
     out[idField==="hostid"?"hostids":"templateids"].push(...arr.map(x=>String(x[idField])));
    }catch(e){log(`Consulta de vínculo ${method}: ${e.message}`,"AVISO");}
   }
  }
 }
 out.hostids=unique(out.hostids);out.templateids=unique(out.templateids);
 return out;
}
async function findTarget(ref,meta,cache){
 const def=REF_TYPES[ref.type];if(!def||!meta)return {reason:"Sem metadados no arquivo de origem"};
 const label=ref.type===4||ref.type===5?"key_":ref.type===7?"name":def.label;
 const value=meta[label]||((ref.type===4||ref.type===5)?meta.item_name:null)||((ref.type===7)?meta.graph_name:null);
 if(!value)return {reason:`Metadados incompletos (campo ${label}).`};
 const fingerprint=JSON.stringify([ref.type,label,value,getOwners(meta)]);
 if(cache.has(fingerprint))return cache.get(fingerprint);
 async function query(filterField,filterValue,scope={}){
  const params={output:"extend",filter:{[filterField]:[filterValue]}};
  if([4,5,6,7].includes(ref.type)){
   if(scope.hostids?.length)params.hostids=scope.hostids;
   if(scope.templateids?.length)params.templateids=scope.templateids;
   params.selectHosts=["hostid","host","name"];
  }
  let result;
  try{result=await api("dst",def.method,params);}
  catch(e){
   if(params.selectHosts){delete params.selectHosts;result=await api("dst",def.method,params);}
   else throw e;
  }
  return (result||[]).filter(r=>String(r[filterField]??"")===String(filterValue));
 }
 const owners=getOwners(meta);let candidates=[],notes=[];
 try{
   if([4,5,6,7].includes(ref.type)&&owners.length){
     const ids=await ownerIds(meta);
     if(ids.hostids.length)candidates.push(...await query(label,value,{hostids:ids.hostids}));
     if(ids.templateids.length)candidates.push(...await query(label,value,{templateids:ids.templateids}));
     // Escopos retornam candidatos separados, evitando associação por ID da origem.
     candidates=[...new Map(candidates.map(c=>[String(c[def.id]),c])).values()];
     if(!ids.hostids.length&&!ids.templateids.length)notes.push("Host/template de origem não encontrado pelo nome no destino.");
   }
   if(!candidates.length && !owners.length)candidates=await query(label,value);
   if(!candidates.length && [4,5].includes(ref.type) && meta.item_name && String(meta.item_name)!==String(value)){
     if(!owners.length)candidates=await query("name",meta.item_name);
   }
   // Nunca cair em correspondência global de item associado a host conhecido.
   if(candidates.length===1){
      const res={id:String(candidates[0][def.id]),reason:"Correspondência única por nome/key e escopo."};cache.set(fingerprint,res);return res;
   }
   const res={reason:candidates.length>1?`${candidates.length} candidatos ambíguos no destino.`:notes.join(" ")||"Nenhum equivalente no destino."};
   cache.set(fingerprint,res);return res;
 }catch(e){const res={reason:`Erro de busca: ${e.message}`};cache.set(fingerprint,res);return res;}
}
const reportLine=(title,items,cssClass)=>`<h4 class="${cssClass}">${esc(title)} (${items.length})</h4>${items.length?`<ul>${items.slice(0,50).map(x=>`<li>${esc(x)}</li>`).join("")}${items.length>50?"<li>... restante omitido nesta prévia.</li>":""}</ul>`:""}`;
$("btn-dryrun").onclick=()=>run("DRY-RUN de importação",async()=>{
 invalidate();
 const entry=selectedExport(),config=connection("dst"),layoutOnly=$("migration-mode").value==="layout";
 const idMap=new Map(),resolution=[],unresolved=[];
 const refs=collectReferences(entry.dashboard);
 if(!layoutOnly){
  const cache=new Map();
  for(const [index,ref] of refs.entries()){
    const meta=sourceMeta(entry,ref);
    const found=await findTarget(ref,meta,cache);
    if(found.id){idMap.set(ref.key,found.id);resolution.push(`${ref.key} → ${found.id} (${REF_TYPES[ref.type]?.name||"Objeto"})`);}
    else unresolved.push(`${ref.key} (${REF_TYPES[ref.type]?.name||"Objeto"}): ${found.reason}`);
    if((index+1)%10===0)log(`Remapeamento: ${index+1}/${refs.length} referências analisadas.`);
  }
 }
 const name=$("new-name").value.trim();
 if(!name)throw Error("Informe o nome do dashboard no destino.");
 const duplicate=await api("dst","dashboard.get",{output:["dashboardid","name"],filter:{name:[name]}});
 let prep=prepareDashboard(entry,{
  name,targetVersion:config.version,sourceVersion:entry.source?.version||$("src-ver").value,
  layoutOnly,skipUnsupported:$("skip-unsupported").checked,
  skipUnresolved:$("skip-unresolved").checked,
  ackUnknownVersion:$("ack-unknown-version").checked,idMap
 });
 if(duplicate?.length)prep.blockers.push(`Já existe dashboard chamado '${name}' no destino. Não será sobrescrito.`);
 // Se referências não resolvidas foram ignoradas por opção, registrar aviso.
 if(unresolved.length && $("skip-unresolved").checked)prep.changed.push(`${unresolved.length} referência(s) não resolvida(s) removida(s).`);
 state.prepared={...prep,envSnapshot:JSON.stringify({url:config.url,version:config.version,name,mode:$("migration-mode").value,token:config.token})};
 const warnings=prep.compatibility.warnings.map(w=>w.message);
 $("report").innerHTML=`<div class="report-stat"><span>Remapeadas: <b>${resolution.length}</b></span><span>Não resolvidas: <b>${unresolved.length}</b></span><span>Bloqueios: <b>${prep.blockers.length}</b></span></div>`
  +reportLine("Bloqueios",prep.blockers,"err")
  +reportLine("Não resolvidas",unresolved,"warn")
  +reportLine("Alterações",prep.changed,"warn")
  +reportLine("Avisos de compatibilidade",warnings,"warn")
  +reportLine("IDs remapeados",resolution,"ok");
 $("payload-preview").textContent=JSON.stringify(prep.payload,null,2);
 $("btn-save-payload").disabled=false;
 $("btn-apply").disabled=prep.blockers.length!==0||!$("apply-confirm").value.trim();
 const msg=prep.blockers.length?`DRY-RUN com ${prep.blockers.length} bloqueio(s). Nenhum dashboard criado.`:"DRY-RUN concluído. Nenhum dashboard criado. Confira os avisos e confirme explicitamente antes de importar.";
 log(msg,prep.blockers.length?"AVISO":"OK");
 notice(msg,prep.blockers.length?"info":"success");
});
$("apply-confirm").addEventListener("input",()=>{
 $("btn-apply").disabled=!state.prepared||state.prepared.blockers.length>0||$("apply-confirm").value.trim()!=="CREATE_GLOBAL_DASHBOARD";
});
$("btn-save-payload").onclick=()=>{if(state.prepared)downloadJson(state.prepared.payload,filename(state.prepared.payload.name).replace(".json","_payload.json"));};
$("btn-apply").onclick=()=>run("Criação de dashboard",async()=>{
 const prep=state.prepared;if(!prep||prep.blockers.length)throw Error("Execute DRY-RUN sem bloqueios.");
 if($("apply-confirm").value.trim()!=="CREATE_GLOBAL_DASHBOARD")throw Error("Confirmação manual inválida.");
 const conf=connection("dst");
 const now=JSON.stringify({url:conf.url,version:conf.version,name:$("new-name").value.trim(),mode:$("migration-mode").value,token:conf.token});
 if(now!==prep.envSnapshot)throw Error("A conexão ou o nome mudaram. Execute DRY-RUN novamente.");
 const exist=await api("dst","dashboard.get",{output:["dashboardid","name"],filter:{name:[prep.payload.name]}});
 if(exist?.length)throw Error("Dashboard com mesmo nome já existe. Cancelado.");
 const result=await api("dst","dashboard.create",prep.payload);
 $("btn-apply").disabled=true;state.prepared=null;
 log(`dashboard.create retornou ${JSON.stringify(result)}.`,"OK");
 notice(`Dashboard criado no Zabbix de destino! ID(s): ${(result.dashboardids||[]).join(", ")}. Verifique cada widget no frontend.`,"success");
 $("report").insertAdjacentHTML("afterbegin",'<p class="ok">Dashboard criado. Confira os widgets no Zabbix.</p>');
});
$("btn-copy-logs").onclick=async()=>{try{await navigator.clipboard.writeText(state.logs.join("\n"));notice("Log copiado.","success");}catch{notice("Copie o texto manualmente.","error");}};
$("btn-clear-logs").onclick=()=>{state.logs=[];$("log-output").textContent="Log limpo.";};
log("Interface iniciada. Nenhum token armazenado.");
