// Módulo puro: nenhuma credencial, comunicação HTTP ou armazenamento.
export const VERSIONS = ["7.0","7.2","7.4"];
export const SUPPORTED70 = new Set(["actionlog","clock","dataover","discovery","favgraphs","favmaps","gauge","geomap","graph","graphprototype","honeycomb","hostavail","hostnavigator","itemhistory","itemnavigator","item","map","navtree","piechart","problemhosts","problems","problemsbysv","slareport","svggraph","systeminfo","tophosts","toptriggers","trigover","url","web"]);
export const SUPPORTED74 = new Set([...SUPPORTED70].filter(x=>x!=="dataover").concat(["hostcard","itemcard","topitems"]));
export const REF_TYPES = Object.freeze({
  2:{name:"Grupo de hosts",method:"hostgroup.get",arg:"groupids",id:"groupid",label:"name"},
  3:{name:"Host",method:"host.get",arg:"hostids",id:"hostid",label:"host"},
  4:{name:"Item",method:"item.get",arg:"itemids",id:"itemid",label:"key_"},
  5:{name:"Protótipo de item",method:"itemprototype.get",arg:"itemids",id:"itemid",label:"key_"},
  6:{name:"Gráfico",method:"graph.get",arg:"graphids",id:"graphid",label:"name"},
  7:{name:"Protótipo de gráfico",method:"graphprototype.get",arg:"graphids",id:"graphid",label:"name"},
  8:{name:"Mapa",method:"map.get",arg:"sysmapids",id:"sysmapid",label:"name"},
  9:{name:"Serviço",method:"service.get",arg:"serviceids",id:"serviceid",label:"name"},
  10:{name:"SLA",method:"sla.get",arg:"slaids",id:"slaid",label:"name"},
  11:{name:"Usuário",method:"user.get",arg:"userids",id:"userid",label:"username"},
  12:{name:"Ação",method:"action.get",arg:"actionids",id:"actionid",label:"name"},
  13:{name:"Mídia",method:"mediatype.get",arg:"mediatypeids",id:"mediatypeid",label:"name"}
});
const DASH_KEYS=["name","display_period","auto_start"];
const PAGE_KEYS=["name","display_period"];
const WIDGET_KEYS=["type","name","x","y","width","height","view_mode"];
const FIELD_KEYS=["type","name","value"];
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value||{},k)).map(k=>[k,value[k]]));
const asArray=v=>Array.isArray(v)?v:typeof v==="string"?(()=>{try { const x=JSON.parse(v);return Array.isArray(x)?x:[];}catch{return [];}})():[];
const intOr=(x,n)=>Number.isFinite(Number(x))?Number(x):n;
export function normalizeDashboard(raw){
  if(!raw || typeof raw!=="object" || typeof raw.name!=="string" || !raw.name.trim())throw Error("Dashboard sem nome.");
  const d=pick(raw,DASH_KEYS);
  d.display_period=intOr(d.display_period,30);
  d.auto_start=intOr(d.auto_start,1);
  d.pages=asArray(raw.pages).map(p=>{
    const page=pick(p,PAGE_KEYS);
    page.name=String(page.name||"");
    page.display_period=intOr(page.display_period,0);
    page.widgets=asArray(p.widgets).filter(w=>w&&typeof w.type==="string").map(w=>{
      const wid=pick(w,WIDGET_KEYS);
      ["x","y","width","height","view_mode"].forEach((k)=>{if(k in wid)wid[k]=intOr(wid[k],0);});
      wid.type=String(wid.type);
      wid.fields=asArray(w.fields).filter(f=>f&&f.name!==undefined&&f.type!==undefined).map(f=>{
        const field=pick(f,FIELD_KEYS);
        field.type=intOr(field.type,-1);
        field.name=String(field.name);
        // IDs são strings para preservar precisão; valores de configuração não têm conversão arriscada.
        field.value=typeof field.value==="string"?field.value:String(field.value??"");
        return field;
      });
      return wid;
    });
    return page;
  });
  if(!d.pages.length)throw Error(`Dashboard '${d.name}' sem páginas.`);
  return d;
}
export function collectReferences(dashboard){
 const seen=new Map();
 for(const [pi,page] of dashboard.pages.entries())for(const [wi,w] of page.widgets.entries())for(const field of w.fields||[]){
   const type=Number(field.type), val=String(field.value??"");
   if(type>=2 && type<=13 && /^\d+$/.test(val)){
     const key=`${type}:${val}`;
     if(!seen.has(key))seen.set(key,{key,type,id:val,page:pi+1,widget:wi+1,field:field.name,widgetType:w.type});
   }
 }
 return [...seen.values()];
}
export function createExport(dashboard,refs,sourceUrl,sourceVersion,extras={}){
 return {
  export_type:"zabbix_global_dashboard", export_version:5,
  source:{url:sourceUrl, version:sourceVersion},
  dashboard:normalizeDashboard(dashboard),
  references:{items:extras.items||{},item_prototypes:extras.item_prototypes||{},graph_prototypes:extras.graph_prototypes||{},objects:refs||{}},
  exported_at:new Date().toISOString()
 };
}
export function readExports(value){
 if(!value || typeof value!=="object")throw Error("JSON inválido.");
 if(value.export_type==="zabbix_global_dashboard"){
    return [{...value,dashboard:normalizeDashboard(value.dashboard)}];
 }
 if(value.export_type==="zabbix_global_dashboard_bundle" && Array.isArray(value.exports)){
    return value.exports.map(x=>({...x,dashboard:normalizeDashboard(x.dashboard)}));
 }
 throw Error("Formato não reconhecido. Use JSON exportado pelo migrador Python v7 ou pelo site.");
}
export function reportCompatibility(dashboard,sourceVersion,targetVersion){
 const warnings=[],errors=[];
 const supported=targetVersion==="7.0"?SUPPORTED70:targetVersion==="7.4"?SUPPORTED74:null;
 for(const [pi,page] of dashboard.pages.entries())for(const [wi,w] of page.widgets.entries()){
    if(supported&&!supported.has(w.type))errors.push({page:pi+1,widget:wi+1,message:`Widget '${w.type}' não existe na versão ${targetVersion}.`});
    if(!supported)warnings.push({page:pi+1,widget:wi+1,message:`Widget '${w.type}': compatibilidade da versão ${targetVersion} requer validação manual.`});
 }
 if(sourceVersion&&targetVersion&&Number(sourceVersion)>Number(targetVersion))warnings.unshift({message:`Downgrade ${sourceVersion} → ${targetVersion}: parâmetros específicos de widgets podem ser incompatíveis.`});
 if(collectReferences(dashboard).length)warnings.push({message:"As referências por ID precisam ser remapeadas antes do dashboard.create."});
 warnings.push({message:"A API não valida todos os parâmetros internos dos widgets na criação. Verifique cada widget no frontend após o import."});
 return {errors,warnings};
}
export function prepareDashboard(exportEntry,config){
 const d=normalizeDashboard(exportEntry.dashboard);
 if(config.name)d.name=config.name.trim();
 const refs=collectReferences(d), issues=[],changed=[];
 const targetVersion=config.targetVersion||"7.0";
 const compatibility=reportCompatibility(d,exportEntry.source?.version||config.sourceVersion,targetVersion);
 const unsupported=targetVersion==="7.0"?SUPPORTED70:targetVersion==="7.4"?SUPPORTED74:null;
 const map=config.idMap instanceof Map?config.idMap:new Map();
 d.pages.forEach((page,pi)=>{
   page.widgets=page.widgets.filter((w,wi)=>{
     if(unsupported&&!unsupported.has(w.type)){
       if(config.skipUnsupported){changed.push(`Widget ${w.type} removido (página ${pi+1}).`);return false;}
       issues.push(`Widget ${w.type} não suportado na versão ${targetVersion}, página ${pi+1}.`);
     }
     if(!unsupported&&!config.ackUnknownVersion)issues.push(`Versão ${targetVersion}: catálogo de widgets não homologado.`);
     w.fields=w.fields.filter(f=>{
        const type=Number(f.type),value=String(f.value||"");
        const typed=type>=2&&type<=13&&/^\d+$/.test(value);
        const name=String(f.name||"").toLowerCase();
        const named=/\b(?:hostids?|groupids?|itemids?|graphids?|mapids?|serviceids?|slaids?|triggerids?)\b/i.test(name)||/(?:^|\.)(?:hostids?|groupids?|itemids?|graphids?|mapids?|serviceids?|slaids?|triggerids?)(?:\.|$)/i.test(name);
        const unnamedID=named && /^\d+$/.test(value) && !name.includes("_reference");
        if(config.layoutOnly){
          if(typed||unnamedID){changed.push(`Referência removida: ${w.type} / ${f.name}`);return false;}
          return true;
        }
        if(typed){
          const key=`${type}:${value}`;
          if(map.has(key)){f.value=map.get(key);return true;}
          if(config.skipUnresolved){changed.push(`Referência não resolvida removida: ${w.type} / ${f.name}`);return false;}
          issues.push(`Referência ${key} não resolvida (${w.type} / ${f.name}).`);
        }else if(unnamedID){
          issues.push(`Referência não tipada suspeita: '${f.name}' = ${value}. Exige revisão.`);
        }
        return true;
     });
     return true;
   });
 });
 if(!d.pages.every(p=>p.widgets.length)){changed.push("Uma ou mais páginas ficaram sem widgets.");}
 const distinct=[...new Set(issues)];
 return {payload:d,blockers:distinct,changed,compatibility,references:refs};
}
export function filename(name){
 const value=String(name||"dashboard").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").replace(/^_+|_+$/g,"").slice(0,80);
 return (value||"dashboard")+".json";
}
