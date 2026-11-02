export type PropertyValue = string|number|null;
export type Values = Record<string,PropertyValue>;
export type FieldKind = 'text'|'email'|'number'|'select'|'date';
export interface ProjectField { id:string;projectId:string;name:string;kind:FieldKind;options:string[] }
export interface Rule { field:string;op:string;value:PropertyValue }
export interface View { mode:'list'|'table';sort:{key:string;direction:'asc'|'desc'};filters:Rule[];hidden:string[] }

export const fieldKinds:Record<FieldKind,string>={text:'Text',email:'Email',number:'Number',select:'Select',date:'Date'};
export const fieldIcons:Record<FieldKind,string>={text:'Aa',email:'@',number:'#',select:'◇',date:'▦'};
export function sortFields(fields:ProjectField[]) { return [{id:'title',name:'Session title',kind:'text',options:[]},{id:'person',name:'Person',kind:'text',options:[]},{id:'date',name:'Date',kind:'date',options:[]},...fields] as ProjectField[]; }
export function operators(kind:FieldKind):[string,string][] {
  return kind==='number'||kind==='date'?[['is',kind==='date'?'Is on':'Equals'],['gte',kind==='date'?'On or after':'At least'],['lte',kind==='date'?'On or before':'At most'],['empty','Is empty'],['filled','Is not empty']]:kind==='select'?[['is','Is'],['not','Is not'],['empty','Is empty'],['filled','Is not empty']]:[['contains','Contains'],['is','Is'],['not','Is not'],['empty','Is empty'],['filled','Is not empty']];
}
export function defaultView():View { return {mode:'list',sort:{key:'date',direction:'desc'},filters:[],hidden:[]}; }
export function readView(projectId:string,fields:ProjectField[]):View {
  const fallback=defaultView();
  try {
    const raw=JSON.parse(localStorage.getItem('overview:'+projectId)||'null');if(!raw)return fallback;
    const definitions=sortFields(fields),ids=new Set(definitions.map(f=>f.id));
    const filters:Rule[]=Array.isArray(raw.filters)?raw.filters.filter((r:Rule)=>{
      const f=definitions.find(f=>f.id===r?.field);if(!f||!operators(f.kind).some(o=>o[0]===r.op))return false;
      if(r.op==='empty'||r.op==='filled')return true;
      if(f.kind==='number')return typeof r.value==='number'&&Number.isFinite(r.value);
      if(typeof r.value!=='string'||!r.value||r.value.length>10000)return false;
      if(f.kind==='select')return f.options.includes(r.value);
      if(f.kind==='date'){const date=new Date(r.value+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(r.value)&&!isNaN(date.getTime())&&date.toISOString().slice(0,10)===r.value;}
      return true;
    }).slice(0,20):[];
    return {mode:raw.mode==='table'?'table':'list',sort:ids.has(raw.sort?.key)&&['asc','desc'].includes(raw.sort?.direction)?raw.sort:fallback.sort,filters,hidden:Array.isArray(raw.hidden)?raw.hidden.filter((id:unknown)=>typeof id==='string'&&fields.some(f=>f.id===id)):[]};
  } catch { return fallback; }
}
