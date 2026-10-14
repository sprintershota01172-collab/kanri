/* kanri Excel export — dependency-free XLSX writer; works offline. */
(function(root){
  'use strict';
  const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const encoder=new TextEncoder();
  function xmlText(x){return String(x??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
  function addr(n){let out='';for(let i=n;i>0;i=Math.floor((i-1)/26))out=String.fromCharCode(65+(i-1)%26)+out;return out}
  function cell(value,row,col,style=0){
    if(value===null||value===undefined||value==='')return '';
    const r=addr(col)+row,sty=style?' s="'+style+'"':'';
    if(typeof value==='number'&&Number.isFinite(value))return '<c r="'+r+'"'+sty+'><v>'+value+'</v></c>';
    if(typeof value==='boolean')return '<c r="'+r+'"'+sty+' t="b"><v>'+(value?'1':'0')+'</v></c>';
    return '<c r="'+r+'"'+sty+' t="inlineStr"><is><t xml:space="preserve">'+xmlText(value)+'</t></is></c>';
  }
  function sheetXml(def){
    const headers=def.headers,rows=def.rows;
    const last=addr(headers.length);
    const widths=headers.map((v,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.min(45,Math.max(i<2?15:11,String(v).length*2+4))+'" customWidth="1"/>').join('');
    const head='<row r="1" ht="23" customHeight="1">'+headers.map((v,i)=>cell(v,1,i+1,1)).join('')+'</row>';
    const body=rows.map((row,i)=>'<row r="'+(i+2)+'">'+row.map((v,j)=>cell(v,i+2,j+1,def.fill&&def.fill(i,j)?2:0)).join('')+'</row>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="'+NS+'">'+
      '<dimension ref="A1:'+last+(rows.length+1)+'"/>'+
      '<sheetViews><sheetView tabSelected="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="18"/><cols>'+widths+'</cols><sheetData>'+head+body+'</sheetData>'+
      '<autoFilter ref="A1:'+last+(rows.length+1)+'"/><pageMargins left=".3" right=".3" top=".5" bottom=".5" header=".2" footer=".2"/></worksheet>';
  }
  function crc32(data){
    let c=-1;
    for(const v of data){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xEDB88320:0)}
    return (c^-1)>>>0;
  }
  function zipStore(entries){
    const parts=[],central=[];let offset=0,cs=0;
    function write16(view,p,v){view.setUint16(p,v,true)}
    function write32(view,p,v){view.setUint32(p,v>>>0,true)}
    for(const [name,text] of entries){
      const n=encoder.encode(name),bytes=encoder.encode(text),crc=crc32(bytes);
      const head=new Uint8Array(30+n.length),h=new DataView(head.buffer);
      write32(h,0,0x04034B50);write16(h,4,20);write16(h,6,0x0800);write16(h,8,0);
      write32(h,14,crc);write32(h,18,bytes.length);write32(h,22,bytes.length);write16(h,26,n.length);
      head.set(n,30);parts.push(head,bytes);
      const dir=new Uint8Array(46+n.length),d=new DataView(dir.buffer);
      write32(d,0,0x02014B50);write16(d,4,20);write16(d,6,20);write16(d,8,0x0800);
      write32(d,16,crc);write32(d,20,bytes.length);write32(d,24,bytes.length);
      write16(d,28,n.length);write32(d,42,offset);dir.set(n,46);
      central.push(dir);offset+=head.length+bytes.length;cs+=dir.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);
    write32(e,0,0x06054B50);write16(e,8,entries.length);write16(e,10,entries.length);
    write32(e,12,cs);write32(e,16,offset);
    const total=offset+cs+end.length,result=new Uint8Array(total);
    let p=0;for(const part of [...parts,...central,end]){result.set(part,p);p+=part.length}
    return result;
  }
  function asDate(x){
    if(!x||!/^\d{4}-\d{2}-\d{2}$/.test(x))return null;
    const [y,m,d]=x.split('-').map(Number),v=new Date(y,m-1,d);
    return v.getFullYear()===y&&v.getMonth()===m-1&&v.getDate()===d?v:null;
  }
  function addDays(date,days){return new Date(date.getFullYear(),date.getMonth(),date.getDate()+days)}
  function dayDiff(a,b){return Math.round((Date.UTC(a.getFullYear(),a.getMonth(),a.getDate())-Date.UTC(b.getFullYear(),b.getMonth(),b.getDate()))/86400000)}
  function folderOf(task,folders){
    let id=task.folderId===undefined?({'仕事':'work','プライベート':'personal','学習':'study','その他':'other'}[task.group]||null):task.folderId;
    const route=[],seen=new Set();let guard=0;
    while(id&&!seen.has(id)&&guard++<30){seen.add(id);const f=folders.find(f=>f.id===id);if(!f)break;route.unshift(f.name);id=f.parentId}
    return route.join(' / ')||'未分類';
  }
  function buildSheets({tasks=[],folders=[],month=new Date()}={}){
    const date=month instanceof Date&&Number.isFinite(month.getTime())?month:new Date();
    const year=date.getFullYear(),m=date.getMonth(),days=new Date(year,m+1,0).getDate();
    const titles=['タスク名','状態','グループ','フォルダ','重要','緊急','スコア','工数（分）','LT（日）','納期','予定開始','ガント開始','固定','登録日時'];
    const calc=t=>{
      const due=asDate(t.due||t.dueDate),start=asDate(t.ganttStart||(t.scheduled||t.scheduledStart||'').slice(0,10));
      const lt=Math.max(1,Math.min(90,Number(t.leadDays)||1));
      return {due,lt,start:start||(due?addDays(due,1-lt):null)};
    };
    function score(t){
      const due=asDate(t.due||t.dueDate),d=due?dayDiff(due,new Date()):null;
      const U=d===null?0:d<0?1:1/(1+Math.max(0,d)/3);
      const duration=Number(t.duration??t.durationMin??60);
      return Math.round(45*U+35*(Number(Boolean(t.important))+Number(Boolean(t.urgent)))/2+20*Math.min(duration,180)/180+(d!==null&&d<0?20:0));
    }
    const rows=tasks.map(t=>[
      String(t.title??''),t.done||t.completed?'完了':'未完了',t.group||'',folderOf(t,folders),
      t.important?'重要':'',t.urgent?'緊急':'',score(t),Number(t.duration??t.durationMin??60),
      calc(t).lt,t.due||t.dueDate||'',t.scheduled||t.scheduledStart||'',t.ganttStart||'',
      t.pin||t.pinned?'固定':'',t.created||t.createdAt||''
    ]);
    const fRows=folders.map(f=>[f.name,folderOf({folderId:f.id},folders),f.parentId||'',tasks.filter(t=>t.folderId===f.id).length]);
    const gantt=tasks.filter(t=>!(t.done||t.completed)).map(t=>{
      const info=calc(t),months=Array.from({length:days},(_,i)=>{
        const day=new Date(year,m,i+1),on=info.start&&dayDiff(day,info.start)>=0&&dayDiff(day,info.start)<info.lt;
        return on?'■':'';
      });
      return [String(t.title??''),info.lt,...months];
    });
    const pad=n=>String(n).padStart(2,'0');
    return [
      {name:'タスク一覧',headers:titles,rows},
      {name:'フォルダ',headers:['フォルダ名','階層','親ID','直接タスク数'],rows:fRows},
      {name:'ガント_'+year+'-'+pad(m+1),headers:['タスク名','LT',...Array.from({length:days},(_,i)=>i+1)],rows:gantt,
       fill:(ri,ci)=>ci>=2&&gantt[ri][ci]==='■'}
    ];
  }
  function buildWorkbook(data={}){
    const sheets=buildSheets(data);
    const manifest='<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
      sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>';
    const book='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="'+NS+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<bookViews><workbookView/></bookViews><sheets>'+sheets.map((s,i)=>'<sheet name="'+xmlText(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>';
    const rel='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+
      '<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="'+NS+'">'+
      '<fonts count="2"><font><sz val="11"/><color rgb="FF23324A"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>'+
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF263E62"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7397CC"/><bgColor indexed="64"/></patternFill></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const files=[
      ['[Content_Types].xml',manifest],
      ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml',book],['xl/_rels/workbook.xml.rels',rel],['xl/styles.xml',styles],
      ...sheets.map((sh,i)=>['xl/worksheets/sheet'+(i+1)+'.xml',sheetXml(sh)])
    ];
    return zipStore(files);
  }
  function exportExcel(data){
    const bytes=buildWorkbook(data),fileDate=new Date(),pad=n=>String(n).padStart(2,'0');
    const name='kanri_'+fileDate.getFullYear()+pad(fileDate.getMonth()+1)+pad(fileDate.getDate())+'.xlsx';
    const blob=new Blob([bytes],{type:MIME});
    const a=document.createElement('a'),url=URL.createObjectURL(blob);
    a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();
    a.remove();setTimeout(()=>URL.revokeObjectURL(url),45000);
    return name;
  }
  const api={buildWorkbook,buildSheets,exportExcel,MIME};
  root.kanriXlsx=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
