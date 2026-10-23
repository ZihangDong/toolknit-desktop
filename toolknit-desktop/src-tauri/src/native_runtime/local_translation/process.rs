use super::*;
use std::process::{Child, Command, Stdio};
use tokio::time::sleep;

pub(super) struct Engine { child: Child, client: reqwest::Client, endpoint: String, token: String, last_used: Instant,
    #[cfg(windows)] _job: std::os::windows::io::OwnedHandle,
}
#[cfg(windows)]
fn own_process(child: &mut Child) -> Result<std::os::windows::io::OwnedHandle, String> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows::Win32::{Foundation::HANDLE, System::JobObjects::*};
    let attach = || -> windows::core::Result<OwnedHandle> { unsafe {
        let handle=CreateJobObjectW(None,None)?;
        let job=OwnedHandle::from_raw_handle(handle.0 as *mut std::ffi::c_void);
        let mut limits=JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(handle,JobObjectExtendedLimitInformation,&limits as *const _ as *const std::ffi::c_void,std::mem::size_of_val(&limits) as u32)?;
        AssignProcessToJobObject(handle,HANDLE(child.as_raw_handle() as isize))?;
        Ok(job)
    }};
    attach().map_err(|_| {let _=child.kill();let _=child.wait();"translation:start".into()})
}
impl Engine { pub(super) fn idle(&self)->bool { self.last_used.elapsed()>Duration::from_secs(120) } }
impl Drop for Engine {
    fn drop(&mut self){let _=self.child.kill();let _=self.child.wait();}
}
async fn start(dir: &Path) -> Result<Engine,String> {
    if hash_file(&dir.join(ENGINE_NAME)).await?!=ENGINE_HASH {return Err("translation:checksum".into());}
    let socket=std::net::TcpListener::bind("127.0.0.1:0").map_err(|_|"translation:start")?;
    let port=socket.local_addr().map_err(|_|"translation:start")?.port();drop(socket);
    let mut bytes=[0u8;32];getrandom::getrandom(&mut bytes).map_err(|_|"translation:start")?;
    let token=hex::encode(bytes);
    let mut command=Command::new(dir.join(ENGINE_NAME));
    command.current_dir(dir).args(["--host","127.0.0.1","--port",&port.to_string(),"--offline","--no-ui","--no-check-update","--worker-idle-timeout","60","--workers-per-language","1","--cache-size","0"])
        .arg("--config-dir").arg(dir.join("config")).arg("--model-dir").arg(dir.join("models"))
        .env("MT_API_TOKEN",&token).env("MT_LOG_CONSOLE","false").env("MT_LOG_TO_FILE","false").env("MT_LOG_REQUESTS","false")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let client=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_millis(500)).timeout(Duration::from_secs(30)).build().map_err(|_|"translation:start")?;
    let mut child=command.spawn().map_err(|_|"translation:start")?;
    #[cfg(windows)] let job=own_process(&mut child)?;
    Ok(Engine{child,client,endpoint:format!("http://127.0.0.1:{port}/translate/batch"),token,last_used:Instant::now(),
        #[cfg(windows)] _job: job,
    })
}
async fn batch(engine: &mut Engine,texts:&[String],from:&str,to:&str,cancel:&AtomicBool) -> Result<Vec<String>,String> {
    let request=serde_json::json!({"from":from,"to":to,"texts":texts,"html":false});
    let deadline=Instant::now()+Duration::from_secs(30);
    let mut response=loop {
        check_cancel(cancel)?;
        if engine.child.try_wait().map_err(|_|"translation:start")?.is_some(){return Err("translation:start".into());}
        let sending=engine.client.post(&engine.endpoint).bearer_auth(&engine.token).header("Content-Type","application/json").body(request.to_string()).send();
        tokio::pin!(sending);
        let result=loop {tokio::select!{result=&mut sending=>break result,_=sleep(Duration::from_millis(50))=>{check_cancel(cancel)?;if Instant::now()>deadline{return Err("translation:timeout".into());}}}};
        match result {
            Ok(response)=>break response,
            Err(e) if e.is_connect() && Instant::now()<deadline=>sleep(Duration::from_millis(100)).await,
            Err(e)=>return Err(if e.is_timeout(){"translation:timeout"}else{"translation:start"}.into()),
        }
    };
    if !response.status().is_success(){return Err("translation:engine".into());}
    let mut bytes=Vec::new();
    loop {
        check_cancel(cancel)?;
        if Instant::now()>deadline{return Err("translation:timeout".into());}
        let chunk=cancellable(response.chunk(),cancel).await?.map_err(|_|"translation:engine")?;
        let Some(chunk)=chunk else {break};
        if bytes.len()+chunk.len()>256_000{return Err("translation:engine".into());}bytes.extend(chunk);
    }
    #[derive(Deserialize)] struct Response { results: Vec<String> }
    let response:Response=serde_json::from_slice(&bytes).map_err(|_|"translation:engine")?;
    if response.results.len()!=texts.len()||response.results.iter().any(|t|t.is_empty()||t.len()>16_000){return Err("translation:engine".into());}
    engine.last_used=Instant::now();Ok(response.results)
}
pub(super) async fn smoke(dir:&Path,cancel:&AtomicBool) -> Result<(),String> {
    let mut engine=start(dir).await?;
    let zh=batch(&mut engine,&["Hello, world.".into()],"en","zh-Hans",cancel).await?;
    let en=batch(&mut engine,&["你好，世界。".into()],"zh-Hans","en",cancel).await?;
    if !zh[0].chars().any(is_han)||!en[0].chars().any(|c|c.is_ascii_alphabetic()){return Err("translation:engine".into());}
    Ok(())
}
fn is_han(c:char)->bool {matches!(c as u32,0x3400..=0x9fff|0x20000..=0x3134f)}
fn already_target(text:&str,target:&str)->bool {
    let han=text.chars().filter(|c|is_han(*c)).count();
    let latin=text.chars().filter(char::is_ascii_alphabetic).count();
    if target=="en"{han==0}else{han>0&&han*2>=latin||han==0&&latin==0}
}
pub(super) async fn translate(dir:&Path,state:&TranslationState,texts:&[String],target:&str,cancel:&AtomicBool)->Result<Vec<String>,String> {
    let mut guard=state.engine.try_lock().map_err(|_|"translation:busy")?;
    check_cancel(cancel)?;
    if guard.as_mut().is_some_and(|e|e.last_used.elapsed()>Duration::from_secs(120)||e.child.try_wait().ok().flatten().is_some()){*guard=None;}
    if guard.is_none(){*guard=Some(start(dir).await?);}
    let indices:Vec<_>=texts.iter().enumerate().filter(|(_,t)|!already_target(t,target)).map(|(i,_)|i).collect();
    let pending:Vec<_>=indices.iter().map(|i|texts[*i].clone()).collect();
    let mut result=texts.to_vec();
    let from=if target=="en"{"zh-Hans"}else{"en"};
    if !pending.is_empty(){
        match batch(guard.as_mut().unwrap(),&pending,from,target,cancel).await {
            Ok(translated)=>for (i,t) in indices.into_iter().zip(translated){result[i]=t;},
            Err(error)=>{*guard=None;return Err(error);}
        }
    }
    Ok(result)
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn translation_preserves_already_target_text_and_numbers(){assert!(already_target("Hello", "en"));assert!(already_target("你好", "zh-Hans"));assert!(!already_target("你好世界", "en"));assert!(!already_target("Hello world", "zh-Hans"));assert!(already_target("12345", "zh-Hans"));}
    #[tokio::test]
    #[ignore = "Copies an explicitly supplied pinned runtime to an isolated directory; performs no downloads"]
    async fn translation_existing_runtime_bidirectional_smoke() {
        let source = PathBuf::from(std::env::var_os("TOOLKNIT_TRANSLATION_QA_RUNTIME").expect("explicit runtime fixture"));
        assert!(complete(&source), "fixture must be the complete pinned runtime");
        let directory = std::env::temp_dir().join(format!("toolknit-translation-offline-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        safe_dir(&directory).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
        }
        let _cleanup = Cleanup(directory.clone());
        std::fs::copy(source.join(ENGINE_NAME), directory.join(ENGINE_NAME)).unwrap();
        safe_dir(&directory.join("config")).unwrap();
        std::fs::write(directory.join("config/records.json"), RECORDS).unwrap();
        for record in records() {
            let file = model_path(&directory, &record);
            safe_dir(file.parent().unwrap()).unwrap();
            std::fs::copy(model_path(&source, &record), &file).unwrap();
            assert_eq!(hash_file(&file).await.unwrap(), record.decompressed_hash);
        }
        verify_bidirectional_runtime(&directory, TranslationState::default()).await;
    }
    #[tokio::test] #[ignore = "Downloads and executes the pinned optional local translation engine"]
    async fn translation_real_install_and_bidirectional_smoke(){
        let state=TranslationState::default();
        let root=std::env::temp_dir().join(format!("toolknit-translation-smoke-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        if !complete(&installed(&root)) {
            let last=Mutex::new((String::new(),0));
            // Cover both bounded engine-source attempts before testing CDN models.
            tokio::time::timeout(Duration::from_secs(1500),install::install(&root,&state,DownloadSource::Auto,|p|{
                let mut last=last.lock().unwrap();
                if last.0 != format!("{}:{}",p.phase,p.source) || p.received.saturating_sub(last.1)>10*1024*1024 {
                    println!("{} {} {}/{}",p.phase,p.source,p.received,p.total);
                    *last=(format!("{}:{}",p.phase,p.source),p.received);
                }
            })).await.expect("real install exceeded 1500 seconds").unwrap();
        }
        verify_bidirectional_runtime(&installed(&root), state).await;
        std::fs::remove_dir_all(root).unwrap();
    }
    async fn verify_bidirectional_runtime(directory: &Path, state: TranslationState) {
        let started=Instant::now();let cancel=AtomicBool::new(false);
        let texts=vec!["This application processes your files locally.".into(),"Select a screenshot to translate the text.".into()];
        let result=translate(directory,&state,&texts,"zh-Hans",&cancel).await.unwrap();
        println!("cold English to Chinese: {:?}; {} blocks",started.elapsed(),result.len());assert!(result.iter().all(|s|s.chars().any(is_han)));
        let started=Instant::now();let result=translate(directory,&state,&["这个应用在本地处理文件。".into()],"en",&cancel).await.unwrap();
        println!("Chinese to English: {:?}; {} blocks",started.elapsed(),result.len());assert!(result[0].chars().any(|c|c.is_ascii_alphabetic()));
        let started=Instant::now();
        let paragraphs=vec!["The screenshot editor supports rectangles, arrows, text and undo. You can save the image or copy it to the clipboard.".into();20];
        let result=translate(directory,&state,&paragraphs,"zh-Hans",&cancel).await.unwrap();
        println!("warm English to Chinese: {:?}; {} paragraphs",started.elapsed(),result.len());
        assert_eq!(result.len(),20);assert!(result.iter().all(|s|s.chars().any(is_han)));
        let endpoint=state.engine.lock().await.as_ref().unwrap().endpoint.clone();
        drop(state);assert!(reqwest::Client::builder().no_proxy().build().unwrap().post(endpoint).send().await.is_err());
    }
}
