export function createHistoryEditor({clipboard,tr,q,showDialog,closeDialog,errorText,onSaved}){
  let revision=0;
  async function open(type,id){
    closeDialog();
    const token=++revision;
    const value=id?await clipboard.request({action:type==='note'?'entry':'phraseDetail',id}):{};
    if(token!==revision)return;
    const form=document.createElement('form');form.className='shot-history-editor';
    const fields={};
    for(const [key,label,max,multiline] of type==='note'?[['note','historyNote',4096,true]]:[['title','phraseTitle',120,false],['text','phraseText',65536,true]]){
      const row=document.createElement('label'),caption=document.createElement('span'),input=document.createElement(multiline?'textarea':'input');
      caption.textContent=tr(label);input.name=key;input.value=value[key]||'';input.maxLength=max;input.autocomplete='off';
      if(key==='text'||key==='title')input.required=true;
      if(multiline)input.rows=key==='text'?5:3;
      row.append(caption,input);form.append(row);fields[key]=input;
    }
    const error=document.createElement('p');error.className='shot-editor-error';error.setAttribute('role','alert');error.hidden=true;form.append(error);
    let saving=false;
    const save=async()=>{
      if(saving||token!==revision||!form.isConnected||!form.reportValidity())return;
      saving=true;q('DialogOk').disabled=true;q('DialogCancel').disabled=true;error.hidden=true;
      try{
        await clipboard.request(type==='note'?{action:'note',id,note:fields.note.value}:{action:'phraseSave',id:id||null,title:fields.title.value,text:fields.text.value});
        if(token===revision){closeDialog();onSaved();}
      }catch(e){if(token===revision&&form.isConnected){error.textContent=errorText(e);error.hidden=false;}}
      finally{saving=false;if(token===revision&&form.isConnected){q('DialogOk').disabled=false;q('DialogCancel').disabled=false;}}
    };
    form.addEventListener('submit',event=>{event.preventDefault();void save();});
    showDialog(tr(type==='note'?'historyNote':id?'phraseEdit':'phraseCreate'),form,{keepOpen:true,confirmLabel:tr('historySave'),onConfirm:()=>void save(),onDismiss:()=>{revision++;}});
    Object.values(fields)[0].focus();
  }
  return {open,dispose(){revision++;}};
}
