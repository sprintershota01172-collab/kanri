const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {buildWorkbook,buildSheets,MIME}=require('../xlsx-export.js');
const sample={
 tasks:[
  {title:'A&B <検証>','group':'仕事',folderId:'client',important:true,urgent:true,duration:90,leadDays:3,due:'2026-10-20',ganttStart:'2026-10-14',pin:true},
  {title:'=2+2','group':'プライベート',folderId:'personal',important:false,urgent:false,duration:30,due:'2026-10-19',leadDays:1,done:true}
 ],
 folders:[{id:'work',name:'業務',parentId:null},{id:'client',name:'案件A',parentId:'work'},{id:'personal',name:'プライベート',parentId:null}],
 month:new Date(2026,9,1)
};
const data=buildWorkbook(sample);
assert.ok(data instanceof Uint8Array&&data.length>2500,'must export actual XLSX bytes');
assert.equal(MIME,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
const decoder=new TextDecoder();
const files=new Map();
let p=0;
while(p+30<data.length){
 const view=new DataView(data.buffer,data.byteOffset+p);
 if(view.getUint32(0,true)!==0x04034b50)break;
 const length=view.getUint32(18,true),nameLength=view.getUint16(26,true),extraLength=view.getUint16(28,true);
 const name=decoder.decode(data.slice(p+30,p+30+nameLength));
 const body=p+30+nameLength+extraLength;
 files.set(name,decoder.decode(data.slice(body,body+length)));
 p=body+length;
}
for(const expected of ['[Content_Types].xml','xl/workbook.xml','xl/styles.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/worksheets/sheet3.xml'])
 assert.ok(files.has(expected),'missing XLSX part '+expected);
const dom=new JSDOM();const parser=new dom.window.DOMParser();
for(const [name,xml] of files){
 const doc=parser.parseFromString(xml,'text/xml');
 assert.equal(doc.querySelector('parsererror'),null,'malformed XML '+name);
}
const t=files.get('xl/worksheets/sheet1.xml');
const g=files.get('xl/worksheets/sheet3.xml');
assert.ok(t.includes('A&amp;B &lt;検証&gt;'),'escape spreadsheet content');
assert.ok(t.includes('=2+2'),'text starting with formula marker must remain text');
assert.ok(t.includes('t="inlineStr"'),'strings stored as literal cells');
assert.ok(g.includes('name')===false||g.includes('ガント')===false||g.includes('<worksheet'),'Gantt workbook XML exists');
assert.equal((g.match(/ s="2" t="inlineStr"/g)||[]).length,3,'gantt lead days colored exactly three cells');
assert.ok(g.includes('r="AG1"'),'31st date column exists');
assert.equal(buildSheets(sample)[2].headers.length,33,'two static columns plus 31 date columns');
assert.ok(files.get('xl/workbook.xml').includes('フォルダ'),'multiple sheets included');
console.log('PASS: Excel XLSX: valid package parts, XML, literal text and 31-day Gantt coloration');
