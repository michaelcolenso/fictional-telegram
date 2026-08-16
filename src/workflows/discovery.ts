import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

type DiscoveryParams = { lookbackDays?: number; source?: "manual" | "scheduled" | string };
type RuntimeEnv = Env & { GOVINFO_API_KEY?: string; GRANTS_API_KEY?: string };
type LeadCandidate = { sourceId:string;sourceName:string;sourceKind:string;sourceUrl:string;title:string;description:string;dataUrl:string;organization:string;formats:string[];observedAt:string;entityCountEstimate:number|null;reserved:boolean;notes:string;raw:string };
type ScoredLead = LeadCandidate & { scannerScore:number };
type ScanResult = { sourceId:string;sourceName:string;sourceKind:string;sourceUrl:string;leads:LeadCandidate[] };
type SourceHealth = { sourceId:string;sourceName:string;kind:string;url:string;status:"healthy"|"degraded"|"down"|"skipped";detail:string;error?:string };
type Portal = { name:string; domain:string; level:"state"|"city" };

const SIGNAL_TERMS=["data","reporting","disclosure","registry","public access","transparency","database","records","filing","information collection","electronic submission","machine-readable","open data"];
const ENTITY_TERMS=["records","entries","facilities","permits","inspections","transactions","complaints","incidents","licenses","cases","providers","schools","companies","businesses","properties","awards","grants","contracts","recalls"];
const HIGH_VALUE_TERMS=["safety","recall","inspection","health","violation","spending","procurement","contract","grant","license","permit","complaint","price","cost","salary","outcome","rating","score","environmental","pollution","enforcement","penalty","award","funding"];
const RESERVED_TERMS=["nhtsa","micro-purchase","college scorecard","collegescorecard"];

// Socrata Discovery API is centralized at api.us.socrata.com. Using search_context
// avoids assuming every portal hosts /api/catalog/v1 itself.
const SOCRATA_PORTALS:Portal[]=[
  {name:"Washington",domain:"data.wa.gov",level:"state"},
  {name:"New York",domain:"data.ny.gov",level:"state"},
  {name:"Texas",domain:"data.texas.gov",level:"state"},
  {name:"Illinois",domain:"data.illinois.gov",level:"state"},
  {name:"Michigan",domain:"data.michigan.gov",level:"state"},
  {name:"Colorado",domain:"data.colorado.gov",level:"state"},
  {name:"Oregon",domain:"data.oregon.gov",level:"state"},
  {name:"Pennsylvania",domain:"data.pa.gov",level:"state"},
  {name:"Connecticut",domain:"data.ct.gov",level:"state"},
  {name:"Maryland",domain:"data.maryland.gov",level:"state"},
  {name:"Iowa",domain:"data.iowa.gov",level:"state"},
  {name:"Hawaii",domain:"data.hawaii.gov",level:"state"},
  {name:"Seattle",domain:"data.seattle.gov",level:"city"},
  {name:"New York City",domain:"data.cityofnewyork.us",level:"city"},
  {name:"Chicago",domain:"data.cityofchicago.org",level:"city"},
  {name:"San Francisco",domain:"data.sfgov.org",level:"city"},
  {name:"Austin",domain:"data.austintexas.gov",level:"city"},
];
const PORTALS_PER_RUN=7;

const SPECIALTY_SOURCES=[
  {id:"health:nhtsa-recalls",name:"NHTSA Recalls",url:"https://api.nhtsa.gov/recalls/recallsByMake?make=toyota"},
  {id:"health:fda-device-events",name:"FDA Device Adverse Events",url:"https://api.fda.gov/device/event.json?limit=1&sort=date_received:desc"},
  {id:"health:cpsc-recalls",name:"CPSC Recalls",url:"https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2026-01-01"},
  {id:"health:bls-public-data",name:"BLS Public Data",url:"https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000"},
  {id:"health:sec-edgar-search",name:"SEC EDGAR Full-Text Search",url:"https://efts.sec.gov/LATEST/search-index?q=%22annual+report%22&forms=10-K"},
  {id:"health:usaspending",name:"USAspending",url:"https://api.usaspending.gov/api/v2/awards/last_updated/"},
  {id:"health:openfda-enforcement",name:"openFDA Enforcement",url:"https://api.fda.gov/food/enforcement.json?limit=1"},
] as const;

const isoDate=(d:Date)=>d.toISOString().slice(0,10);
const compactDate=(date:string)=>date.replaceAll("-","");
const asText=(v:unknown)=>typeof v==="string"?v:"";
const asNumber=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;
const jsonHeaders={"content-type":"application/json"};

function scoreLead(lead:LeadCandidate,now:Date):ScoredLead{
  const text=`${lead.title} ${lead.description}`.toLowerCase();
  const entity=Math.min(5,Math.max(1,ENTITY_TERMS.filter(t=>text.includes(t)).length+1));
  const format=lead.formats.join(" ").toUpperCase();
  const accessibility=format.includes("API")||format.includes("JSON")?5:format.includes("CSV")||format.includes("SOCRATA")?4:format.includes("XML")?3:2;
  const relevance=Math.min(5,Math.max(1,HIGH_VALUE_TERMS.filter(t=>text.includes(t)).length));
  let novelty=2;
  const observed=Date.parse(lead.observedAt);
  if(Number.isFinite(observed)){const days=Math.max(0,Math.floor((now.getTime()-observed)/86_400_000));novelty=days<=7?5:days<=30?4:days<=90?3:2}
  if(["regulatory_signal","federal_spending","federal_funding","product_safety"].includes(lead.sourceKind))novelty=Math.max(novelty,4);
  return{...lead,reserved:lead.reserved||RESERVED_TERMS.some(t=>text.includes(t)),scannerScore:Math.round(((entity+accessibility+relevance+novelty)/4)*100)/100};
}
async function sha256(value:string){const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));return[...bytes].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function leadId(lead:LeadCandidate){return`lead_${(await sha256([lead.sourceId,lead.dataUrl||lead.title,lead.observedAt||"unknown"].join("|"))).slice(0,40)}`}
async function fetchJson(url:URL|string,init:RequestInit={}):Promise<unknown>{const target=typeof url==="string"?new URL(url):url;const r=await fetch(target,{...init,headers:{"user-agent":"PaydirtDiscovery/4.0 (+https://github.com/michaelcolenso/paydirt)",...(init.headers||{})}});if(!r.ok)throw new Error(`${target.hostname} returned HTTP ${r.status}`);return r.json()}

async function scanFederalRegister(since:string):Promise<ScanResult>{
  const sourceId="scanner:federal-register",sourceUrl="https://www.federalregister.gov/api/v1/documents.json",url=new URL(sourceUrl);
  url.searchParams.set("conditions[publication_date][gte]",since);url.searchParams.append("conditions[type][]","RULE");url.searchParams.append("conditions[type][]","NOTICE");
  for(const f of["title","abstract","agencies","publication_date","html_url","type"])url.searchParams.append("fields[]",f);
  url.searchParams.set("per_page","100");url.searchParams.set("order","newest");
  const payload=await fetchJson(url) as {results?:Array<Record<string,unknown>>},leads:LeadCandidate[]=[];
  for(const doc of payload.results??[]){const title=asText(doc.title),description=asText(doc.abstract)||title,matching=SIGNAL_TERMS.filter(t=>`${title} ${description}`.toLowerCase().includes(t));if(matching.length<2)continue;const agencies=Array.isArray(doc.agencies)?doc.agencies.map(a=>asText((a as Record<string,unknown>).name)).filter(Boolean).join(", "):"Unknown";leads.push({sourceId,sourceName:"Federal Register",sourceKind:"regulatory_signal",sourceUrl,title:`[${asText(doc.type)||"NOTICE"}] ${title}`,description:description.slice(0,500),dataUrl:asText(doc.html_url),organization:agencies||"Unknown",formats:["regulation"],observedAt:asText(doc.publication_date),entityCountEstimate:null,reserved:false,notes:`Signal terms: ${matching.join(", ")}`,raw:JSON.stringify(doc)})}
  return{sourceId,sourceName:"Federal Register",sourceKind:"regulatory_signal",sourceUrl,leads};
}

// Data.gov's public catalog is CKAN. This path does not require an api.data.gov key.
async function scanDataGov(since:string):Promise<ScanResult>{
  const sourceId="scanner:data-gov",sourceUrl="https://catalog.data.gov/api/3/action/package_search",url=new URL(sourceUrl);
  url.searchParams.set("rows","75");url.searchParams.set("sort","metadata_modified desc");url.searchParams.set("fq",`metadata_modified:[${since}T00:00:00Z TO NOW]`);
  const payload=await fetchJson(url) as {result?:{results?:Array<Record<string,unknown>>}},leads:LeadCandidate[]=[];
  for(const ds of payload.result?.results??[]){const resources=Array.isArray(ds.resources)?ds.resources as Array<Record<string,unknown>>:[],formats=[...new Set(resources.map(r=>asText(r.format).toUpperCase()).filter(Boolean))];if(!formats.some(f=>["API","JSON","CSV","GEOJSON","XML"].includes(f)))continue;const org=ds.organization&&typeof ds.organization==="object"?asText((ds.organization as Record<string,unknown>).title):"Unknown",title=asText(ds.title)||"Untitled",modified=asText(ds.metadata_modified),resource=resources.find(r=>["API","JSON","CSV","GEOJSON"].includes(asText(r.format).toUpperCase()))??resources[0],dataUrl=asText(resource?.url)||asText(ds.url);leads.push({sourceId,sourceName:"data.gov",sourceKind:"federal_open_data",sourceUrl,title,description:asText(ds.notes).slice(0,500),dataUrl,organization:org||"Unknown",formats,observedAt:modified||isoDate(new Date()),entityCountEstimate:null,reserved:false,notes:"Recent machine-readable data.gov dataset",raw:JSON.stringify(ds)})}
  return{sourceId,sourceName:"data.gov",sourceKind:"federal_open_data",sourceUrl,leads};
}

async function scanGovInfo(since:string,key:string):Promise<ScanResult>{
  const sourceId="scanner:govinfo",sourceUrl="https://api.govinfo.gov",leads:LeadCandidate[]=[];
  for(const coll of["FR","CFR","ECFR","BUDGET","PLAW","COMPS"]){const url=new URL(`${sourceUrl}/collections/${coll}/${since}T00:00:00Z`);url.searchParams.set("pageSize","10");url.searchParams.set("offsetMark","*");url.searchParams.set("api_key",key);const payload=await fetchJson(url) as {count?:number;packages?:Array<Record<string,unknown>>},count=Number(payload.count??0);if(!count)continue;leads.push({sourceId,sourceName:"govinfo",sourceKind:"federal_publications",sourceUrl,title:`govinfo/${coll}: ${count} updated packages`,description:`${count} packages updated since ${since} in the ${coll} collection.`,dataUrl:`https://api.govinfo.gov/collections/${coll}`,organization:"GPO / govinfo",formats:["XML","PDF","JSON"],observedAt:isoDate(new Date()),entityCountEstimate:count,reserved:false,notes:`Sample package IDs: ${(payload.packages??[]).slice(0,3).map(p=>asText(p.packageId)).filter(Boolean).join(", ")}`,raw:JSON.stringify(payload)})}
  return{sourceId,sourceName:"govinfo",sourceKind:"federal_publications",sourceUrl,leads};
}

async function scanUsaSpending(since:string):Promise<ScanResult>{
  const sourceId="scanner:usaspending",sourceName="USAspending",sourceKind="federal_spending",sourceUrl="https://api.usaspending.gov/api/v2/search/spending_by_award/";
  const body={filters:{time_period:[{start_date:since,end_date:isoDate(new Date())}],award_type_codes:["A","B","C","D","02","03","04","05"]},fields:["Award ID","Recipient Name","Award Amount","Description","Start Date","Awarding Agency","Award Type"],page:1,limit:50,sort:"Award Amount",order:"desc",subawards:false};
  const payload=await fetchJson(sourceUrl,{method:"POST",headers:jsonHeaders,body:JSON.stringify(body)}) as {results?:Array<Record<string,unknown>>},leads:LeadCandidate[]=[];
  for(const award of payload.results??[]){const awardId=asText(award["Award ID"]),recipient=asText(award["Recipient Name"])||"Unknown recipient",amount=asNumber(award["Award Amount"]),description=asText(award.Description),agency=asText(award["Awarding Agency"])||"Federal agency",start=asText(award["Start Date"])||since;leads.push({sourceId,sourceName,sourceKind,sourceUrl,title:`Federal award: ${recipient}${amount!==null?` — $${Math.round(amount).toLocaleString("en-US")}`:""}`,description:description.slice(0,500),dataUrl:awardId?`https://www.usaspending.gov/award/${encodeURIComponent(awardId)}/`:"https://www.usaspending.gov/search",organization:agency,formats:["API","JSON"],observedAt:start,entityCountEstimate:null,reserved:false,notes:`Award type: ${asText(award["Award Type"])||"unknown"}`,raw:JSON.stringify(award)})}
  return{sourceId,sourceName,sourceKind,sourceUrl,leads};
}

async function scanOpenFda(since:string):Promise<ScanResult>{
  const sourceId="scanner:openfda-enforcement",sourceName="openFDA Enforcement",sourceKind="product_safety",sourceUrl="https://open.fda.gov/apis/",leads:LeadCandidate[]=[];
  const compactSince=compactDate(since),compactNow=compactDate(isoDate(new Date()));
  for(const kind of["food","drug","device"]){const url=new URL(`https://api.fda.gov/${kind}/enforcement.json`);url.searchParams.set("search",`report_date:[${compactSince} TO ${compactNow}]`);url.searchParams.set("sort","report_date:desc");url.searchParams.set("limit","20");const payload=await fetchJson(url) as {results?:Array<Record<string,unknown>>};for(const row of payload.results??[]){const recall=asText(row.recall_number)||asText(row.event_id),firm=asText(row.recalling_firm)||"Unknown firm",product=asText(row.product_description)||`${kind} product`,classification=asText(row.classification),report=asText(row.report_date);leads.push({sourceId,sourceName,sourceKind,sourceUrl,title:`FDA ${kind} recall: ${product.slice(0,120)}`,description:`${classification?classification+". ":""}${asText(row.reason_for_recall)}`.slice(0,500),dataUrl:recall?`https://www.accessdata.fda.gov/scripts/ires/?Event=${encodeURIComponent(asText(row.event_id)||recall)}`:"https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts",organization:firm,formats:["API","JSON"],observedAt:report?`${report.slice(0,4)}-${report.slice(4,6)}-${report.slice(6,8)}`:since,entityCountEstimate:null,reserved:false,notes:`FDA ${kind} enforcement; recall ${recall||"unknown"}`,raw:JSON.stringify(row)})}}
  return{sourceId,sourceName,sourceKind,sourceUrl,leads};
}

async function scanGrants(since:string,key:string):Promise<ScanResult>{
  const sourceId="scanner:simpler-grants",sourceName="Simpler.Grants.gov",sourceKind="federal_funding",sourceUrl="https://api.simpler.grants.gov/v1/opportunities/search";
  const body={filters:{opportunity_status:{one_of:["posted","forecasted"]},post_date:{start_date:since}},pagination:{page_offset:1,page_size:50,sort_order:[{order_by:"post_date",sort_direction:"descending"}]}};
  const payload=await fetchJson(sourceUrl,{method:"POST",headers:{...jsonHeaders,"x-api-key":key},body:JSON.stringify(body)}) as {data?:Array<Record<string,unknown>>},leads:LeadCandidate[]=[];
  for(const opp of payload.data??[]){const id=asText(opp.opportunity_id),title=asText(opp.opportunity_title)||"Untitled grant",agency=asText(opp.agency_name)||"Federal agency",ceiling=asNumber(opp.award_ceiling),total=asNumber(opp.estimated_total_program_funding),amount=total??ceiling;leads.push({sourceId,sourceName,sourceKind,sourceUrl,title:`Grant opportunity: ${title}`,description:asText(opp.summary).slice(0,500),dataUrl:id?`https://simpler.grants.gov/opportunity/${encodeURIComponent(id)}`:"https://simpler.grants.gov/search",organization:agency,formats:["API","JSON"],observedAt:asText(opp.post_date)||since,entityCountEstimate:asNumber(opp.expected_number_of_awards),reserved:false,notes:`Status: ${asText(opp.opportunity_status)}${amount!==null?`; funding signal: $${Math.round(amount).toLocaleString("en-US")}`:""}`,raw:JSON.stringify(opp)})}
  return{sourceId,sourceName,sourceKind,sourceUrl,leads};
}

async function scanSocrataPortal(portal:Portal,since:string):Promise<ScanResult>{
  const sourceId=`scanner:${portal.level}:${portal.name.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`,sourceName=`${portal.name} Open Data`,sourceKind=portal.level==="state"?"open_data_portal":"municipal_open_data",sourceUrl=`https://${portal.domain}`,url=new URL("https://api.us.socrata.com/api/catalog/v1");
  url.searchParams.set("search_context",portal.domain);url.searchParams.set("only","datasets");url.searchParams.set("limit","40");url.searchParams.set("order","updatedAt");
  const payload=await fetchJson(url) as {results?:Array<Record<string,unknown>>},leads:LeadCandidate[]=[];
  const cutoff=Date.parse(`${since}T00:00:00Z`);
  for(const item of payload.results??[]){const resource=(item.resource??{}) as Record<string,unknown>,metadata=(item.metadata??{}) as Record<string,unknown>,title=asText(resource.name)||"Untitled",description=asText(resource.description).slice(0,500),updated=asText(resource.updatedAt)||asText(resource.data_updated_at)||asText(metadata.updatedAt),id=asText(resource.id),observed=updated||isoDate(new Date());if(updated&&Number.isFinite(Date.parse(updated))&&Date.parse(updated)<cutoff)continue;const dataUrl=asText(item.permalink)||asText(item.link)||(id?`https://${portal.domain}/d/${id}`:sourceUrl),columns=Array.isArray(resource.columns_field_name)?resource.columns_field_name.length:0;leads.push({sourceId,sourceName,sourceKind,sourceUrl,title:`[${portal.name}] ${title}`,description,dataUrl,organization:`${portal.name} Government`,formats:["Socrata","CSV","JSON","API"],observedAt:observed,entityCountEstimate:null,reserved:false,notes:columns?`Columns: ${columns}`:"Recent Socrata dataset",raw:JSON.stringify(item)})}
  return{sourceId,sourceName,sourceKind,sourceUrl,leads};
}

async function probeHealth(source:typeof SPECIALTY_SOURCES[number]):Promise<SourceHealth>{try{const r=await fetch(source.url,{headers:{"user-agent":"PaydirtDiscovery/4.0 (+https://github.com/michaelcolenso/paydirt)"}});return{sourceId:source.id,sourceName:source.name,kind:"api_health",url:source.url,status:r.ok?"healthy":"degraded",detail:JSON.stringify({status:r.status,contentType:r.headers.get("content-type")}),error:r.ok?undefined:`HTTP ${r.status}`}}catch(error){return{sourceId:source.id,sourceName:source.name,kind:"api_health",url:source.url,status:"down",detail:"{}",error:error instanceof Error?error.message:String(error)}}}

async function persistSource(env:Env,scan:ScanResult){await env.DB.prepare(`INSERT INTO sources(id,name,kind,url,enabled,scan_cadence,last_scanned_at,health_status,last_error,last_result_json) VALUES (?,?,?,?,1,'weekly',CURRENT_TIMESTAMP,'healthy',NULL,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,url=excluded.url,enabled=1,scan_cadence='weekly',last_scanned_at=CURRENT_TIMESTAMP,health_status='healthy',last_error=NULL,last_result_json=excluded.last_result_json,updated_at=CURRENT_TIMESTAMP`).bind(scan.sourceId,scan.sourceName,scan.sourceKind,scan.sourceUrl,JSON.stringify({leadCount:scan.leads.length})).run()}
async function persistHealth(env:Env,h:SourceHealth){await env.DB.prepare(`INSERT INTO sources(id,name,kind,url,enabled,scan_cadence,last_scanned_at,health_status,last_error,last_result_json) VALUES (?,?,?,?,1,'weekly',CURRENT_TIMESTAMP,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,url=excluded.url,last_scanned_at=CURRENT_TIMESTAMP,health_status=excluded.health_status,last_error=excluded.last_error,last_result_json=excluded.last_result_json,updated_at=CURRENT_TIMESTAMP`).bind(h.sourceId,h.sourceName,h.kind,h.url,h.status,h.error??null,h.detail).run()}
async function persistSkipped(env:Env,id:string,name:string,kind:string,url:string,reason:string){await persistHealth(env,{sourceId:id,sourceName:name,kind,url,status:"skipped",detail:JSON.stringify({reason})})}
async function persistLeads(env:Env,leads:ScoredLead[]){let inserted=0;for(let offset=0;offset<leads.length;offset+=60){const statements=[];for(const lead of leads.slice(offset,offset+60)){const id=await leadId(lead);statements.push(env.DB.prepare(`INSERT OR IGNORE INTO leads(id,source_id,title,description,data_url,organization,formats_json,observed_at,entity_count_estimate,scanner_score,reserved,status,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,'NEW',?)`).bind(id,lead.sourceId,lead.title,lead.description,lead.dataUrl||null,lead.organization,JSON.stringify(lead.formats),lead.observedAt||null,lead.entityCountEstimate,lead.scannerScore,lead.reserved?1:0,JSON.stringify({notes:lead.notes,source:lead.raw})))}if(statements.length){const results=await env.DB.batch(statements);inserted+=results.reduce((t,r)=>t+Number(r.meta?.changes??0),0)}}return inserted}

async function runScan(step:WorkflowStep,label:string,source:string,fn:()=>Promise<ScanResult>,errors:Array<{source:string;error:string}>,timeout:"2 minutes"|"3 minutes"="2 minutes"){try{return await step.do(label,{retries:{limit:3,delay:"10 seconds",backoff:"exponential"},timeout},fn) as ScanResult}catch(e){errors.push({source,error:e instanceof Error?e.message:String(e)});return null}}

export class DiscoveryWorkflow extends WorkflowEntrypoint<Env,DiscoveryParams>{
  async run(event:WorkflowEvent<DiscoveryParams>,step:WorkflowStep){
    const runId=event.instanceId,lookbackDays=Math.max(1,Math.min(90,Number(event.payload?.lookbackDays??30))),triggeredBy=event.schedule?"schedule":(event.payload?.source??"manual"),since=isoDate(new Date(event.timestamp.getTime()-lookbackDays*86_400_000)),runtime=this.env as RuntimeEnv;
    await step.do("record run start",async()=>{await this.env.DB.prepare(`INSERT INTO runs(id,run_type,status,workflow_instance_id,started_at,trigger_source,summary_json) VALUES (?,'discovery','running',?,CURRENT_TIMESTAMP,?,?) ON CONFLICT(id) DO UPDATE SET status='running',workflow_instance_id=excluded.workflow_instance_id,started_at=COALESCE(runs.started_at,CURRENT_TIMESTAMP),trigger_source=excluded.trigger_source,error=NULL`).bind(runId,event.instanceId,triggeredBy,JSON.stringify({triggeredBy,lookbackDays,since,phase:"starting"})).run()});
    try{
      const scans:ScanResult[]=[],errors:Array<{source:string;error:string}>=[];
      for(const [label,name,fn,timeout] of [
        ["scan federal register","Federal Register",()=>scanFederalRegister(since),"2 minutes"],
        ["scan data.gov","data.gov",()=>scanDataGov(since),"2 minutes"],
        ["scan usaspending","USAspending",()=>scanUsaSpending(since),"2 minutes"],
        ["scan openfda enforcement","openFDA Enforcement",()=>scanOpenFda(since),"3 minutes"],
      ] as const){const scan=await runScan(step,label,name,fn,errors,timeout);if(scan)scans.push(scan)}

      if(runtime.GOVINFO_API_KEY){const scan=await runScan(step,"scan govinfo","govinfo",()=>scanGovInfo(since,runtime.GOVINFO_API_KEY!),errors,"3 minutes");if(scan)scans.push(scan)}
      else await step.do("record govinfo skipped",()=>persistSkipped(this.env,"scanner:govinfo","govinfo","federal_publications","https://api.govinfo.gov","GOVINFO_API_KEY not configured"));

      if(runtime.GRANTS_API_KEY){const scan=await runScan(step,"scan simpler grants","Simpler.Grants.gov",()=>scanGrants(since,runtime.GRANTS_API_KEY!),errors,"2 minutes");if(scan)scans.push(scan)}
      else await step.do("record grants skipped",()=>persistSkipped(this.env,"scanner:simpler-grants","Simpler.Grants.gov","federal_funding","https://api.simpler.grants.gov/v1/opportunities/search","GRANTS_API_KEY not configured"));

      const rotation=Math.floor(event.timestamp.getTime()/(7*86_400_000))%SOCRATA_PORTALS.length;
      for(let i=0;i<PORTALS_PER_RUN;i++){const portal=SOCRATA_PORTALS[(rotation*PORTALS_PER_RUN+i)%SOCRATA_PORTALS.length];const scan=await runScan(step,`scan portal ${portal.name}`,portal.name,()=>scanSocrataPortal(portal,since),errors);if(scan)scans.push(scan)}

      const health=await step.do("probe specialty source health",{retries:{limit:1,delay:"5 seconds"},timeout:"2 minutes"},async()=>Promise.all(SPECIALTY_SOURCES.map(probeHealth))) as SourceHealth[];
      const scored=await step.do("score candidate leads",async()=>{const now=new Date(event.timestamp);return scans.flatMap(s=>s.leads).map(l=>scoreLead(l,now))});
      await step.do("record source scans",async()=>{for(const scan of scans)await persistSource(this.env,scan);for(const h of health)await persistHealth(this.env,h)});
      const inserted=await step.do("persist leads to D1",()=>persistLeads(this.env,scored));
      const attempted=4+2+PORTALS_PER_RUN+SPECIALTY_SOURCES.length;
      const summary={triggeredBy,since,lookbackDays,sourcesAttempted:attempted,sourcesSucceeded:scans.length,healthHealthy:health.filter(h=>h.status==="healthy").length,candidateEvents:scored.length,newLeads:inserted,sourceBreakdown:scans.map(s=>({source:s.sourceName,leads:s.leads.length})),errors};
      await step.do("record run complete",async()=>{await this.env.DB.prepare("UPDATE runs SET status='complete',finished_at=CURRENT_TIMESTAMP,summary_json=?,error=NULL WHERE id=?").bind(JSON.stringify(summary),runId).run()});
      return summary;
    }catch(error){const message=error instanceof Error?error.message:String(error);await step.do("record run failure",async()=>{await this.env.DB.prepare("UPDATE runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error=? WHERE id=?").bind(message,runId).run()});throw error}
  }
}
