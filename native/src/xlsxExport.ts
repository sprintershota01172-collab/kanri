import {zipSync,strToU8} from 'fflate';
import {File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type {Folder,Task} from './model';
import {priorityScore,dateKey,addDays,parseDateKey} from './model';

const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
type Value=string|number|boolean|null|undefined;
type Sheet={name:string;headers:Value[];rows:Value[][];fill?:(row:number,col:number)=>boolean};
const x=(v:Value)=>String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function col(n:number){let out='';for(let i=n;i>0;i=Math.floor((i-1)/26))out=String.fromCharCode(65+(i-1)%26)+out;return out;}
function cell(v:Value,r:number,c:number,style=0){
  if(v===null||v===undefined||v==='')return '';
  const a=' r="'+col(c)+r+'"'+(style?' s="'+style+'"':'');
  if(typeof v==='number'&&Number.isFinite(v))return '<c'+a+'><v>'+v+'</v></c>';
  if(typeof v==='boolean')return '<c'+a+' t="b"><v>'+(v?1:0)+'</v></c>';
  return '<c'+a+' t="inlineStr"><is><t xml:space="preserve">'+x(v)+'</t></is></c>';
}
function sheetXml(sheet:Sheet){
  const columns=sheet.headers.map((v,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.max(10,Math.min(37,i<2?21:String(v).length*2+4))+'" customWidth="1"/>').join('');
  const row1='<row r="1" ht="24" customHeight="1">'+sheet.headers.map((v,i)=>cell(v,1,i+1,1)).join('')+'</row>';
  const body=sheet.rows.map((values,i)=>'<row r="'+(i+2)+'">'+values.map((v,j)=>cell(v,i+2,j+1,sheet.fill?.(i,j)?2:0)).join('')+'</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="'+ns+'"><dimension ref="A1:'+col(sheet.headers.length)+(sheet.rows.length+1)+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>'+columns+'</cols><sheetData>'+row1+body+'</sheetData><autoFilter ref="A1:'+col(sheet.headers.length)+(sheet.rows.length+1)+'"/></worksheet>';
}
function folderPath(t:Task,folders:Folder[]){
  let id=t.folderId===undefined?({'仕事':'work','プライベート':'personal','学習':'study','その他':'other'}[t.group]):t.folderId;
  const names:string[]=[],seen=new Set<string>();let depth=0;
  while(id&&!seen.has(id)&&depth++<32){
    seen.add(id);const folder=folders.find(f=>f.id===id);if(!folder)break;
    names.unshift(folder.name);id=folder.parentId;
  }
  return names.join(' / ')||'未分類';
}
function ltInfo(t:Task){
  const lt=Math.max(1,Math.min(90,t.leadDays||1));
  const due=t.dueDate?parseDateKey(t.dueDate):null;
  const starts=t.ganttStart||t.scheduledStart?.slice(0,10);
  const start=starts?parseDateKey(starts):null;
  return {lt,start:start||(due?addDays(due,1-lt):null)};
}
function utcDay(d:Date){return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());}
export function createExcelBytes(tasks:Task[],folders:Folder[],month:Date):Uint8Array {
  const year=month.getFullYear(),m=month.getMonth(),days=new Date(year,m+1,0).getDate();
  const taskRows:Value[][]=tasks.map(t=>[
    t.title,t.completed?'完了':'未完了',t.group,folderPath(t,folders),
    t.important?'重要':'',t.urgent?'緊急':'',priorityScore(t),t.durationMin,t.leadDays||1,
    t.dueDate||'',t.scheduledStart||'',t.ganttStart||'',t.pinned?'固定':'',t.createdAt
  ]);
  const folderRows:Value[][]=folders.map(f=>[f.name,folderPath({folderId:f.id,group:'その他'} as Task,folders),f.parentId||'',tasks.filter(t=>t.folderId===f.id).length]);
  const ganttTasks=tasks.filter(t=>!t.completed);
  const ganttRows:Value[][]=ganttTasks.map(t=>{
    const {lt,start}=ltInfo(t);
    return [t.title,lt,...Array.from({length:days},(_,i)=>{
      if(!start)return '';
      const day=new Date(year,m,i+1);
      const delta=Math.round((utcDay(day)-utcDay(start))/86400000);
      return delta>=0&&delta<lt?'■':'';
    })];
  });
  const pad=(n:number)=>String(n).padStart(2,'0');
  const sheets:Sheet[]=[
    {name:'タスク一覧',headers:['タスク名','状態','グループ','フォルダ','重要','緊急','スコア','工数（分）','LT（日）','納期','予定開始','ガント開始','固定','登録日時'],rows:taskRows},
    {name:'フォルダ',headers:['フォルダ名','階層','親ID','直接タスク数'],rows:folderRows},
    {name:'ガント_'+year+'-'+pad(m+1),headers:['タスク名','LT',...Array.from({length:days},(_,i)=>i+1)],rows:ganttRows,fill:(i,j)=>j>=2&&ganttRows[i][j]==='■'}
  ];
  const contentTypes='<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>';
  const workbook='<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>'<sheet name="'+x(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>';
  const bookRels='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="'+ns+'"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF263E62"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7397CC"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const files:Record<string,Uint8Array>={
    '[Content_Types].xml':strToU8(contentTypes),
    '_rels/.rels':strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml':strToU8(workbook),
    'xl/_rels/workbook.xml.rels':strToU8(bookRels),
    'xl/styles.xml':strToU8(styles)
  };
  sheets.forEach((sh,i)=>{files['xl/worksheets/sheet'+(i+1)+'.xml']=strToU8(sheetXml(sh))});
  return zipSync(files,{level:1});
}
export async function shareExcel(tasks:Task[],folders:Folder[],month:Date){
  const bytes=createExcelBytes(tasks,folders,month);
  const now=new Date(),pad=(n:number)=>String(n).padStart(2,'0');
  const name='kanri_'+now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+'.xlsx';
  const file=new File(Paths.cache,name);
  file.write(bytes);
  if(!await Sharing.isAvailableAsync())throw new Error('この端末でファイル共有が利用できません');
  await Sharing.shareAsync(file.uri,{mimeType:MIME,UTI:'org.openxmlformats.spreadsheetml.sheet'});
}
