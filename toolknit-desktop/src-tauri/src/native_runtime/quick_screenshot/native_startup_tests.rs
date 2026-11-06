use super::*;
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Default)]
pub(super) struct Fixture { large: AtomicBool, frames: AtomicU64 }
impl Fixture {
    pub fn capture(&self) -> Result<(Desktop, Vec<u8>), String> {
        self.frames.fetch_add(1,Ordering::SeqCst);
        let (width,height)=if self.large.load(Ordering::Acquire) {(3840u32,2160u32)} else {(1920u32,1080u32)};
        let image=image::RgbaImage::from_fn(width,height,|x,y|image::Rgba([
            if x%19<3 && y%24<15 {30} else {245},(x%256) as u8,(y%256) as u8,255]));
        let mut png=std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image).write_to(&mut png,image::ImageFormat::Png).unwrap();
        let bounds=Rect{x:-16000,y:-16000,width,height};
        Ok((Desktop{bounds:bounds.clone(),windows:vec![bounds.clone()],monitors:vec![bounds]},png.into_inner()))
    }
}

#[test]
#[ignore = "explicit real WebView2 screenshot startup; synthetic pixels, no foreground or user data"]
fn screenshot_webview_startup() {
    const TEST:&str="native_runtime::quick_screenshot::native_startup_tests::screenshot_webview_startup";
    if std::env::var_os("TOOLKNIT_SHOT_ISOLATED").is_none() {
        let mut child=std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact",TEST,"--ignored","--nocapture","--test-threads=1"])
            .env("TOOLKNIT_SHOT_ISOLATED","1").env("TOOLKNIT_SCREENSHOT_TIMING","1")
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
        let deadline=Instant::now()+Duration::from_secs(180);
        while child.try_wait().unwrap().is_none(){if Instant::now()>deadline {let _=child.kill();break;}std::thread::sleep(Duration::from_millis(40));}
        let output=child.wait_with_output().unwrap();
        assert!(output.status.success(),"{}\n{}",String::from_utf8_lossy(&output.stdout),String::from_utf8_lossy(&output.stderr));
        print!("{}{}",String::from_utf8_lossy(&output.stdout),String::from_utf8_lossy(&output.stderr));return;
    }
    let mut context=tauri::generate_context!();
    context.config_mut().identifier="com.toolknit.screenshot-startup-test".into();
    context.config_mut().app.windows.clear();
    let report=Arc::new(Mutex::new(None));let result=report.clone();
    let handler:fn(tauri::ipc::Invoke<tauri::Wry>)->bool=tauri::generate_handler![quick_screenshot,quick_screenshot_image];
    let app=tauri::Builder::default().any_thread().manage(ScreenshotState::default()).manage(Fixture::default())
        .invoke_handler(move |invoke| {
            if invoke.message.command()=="local_translation" {
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(800)).await;
                    invoke.resolver.resolve(serde_json::json!({"ready":false,"targetLanguage":"zh-Hans"}));
                });return true;
            }
            handler(invoke)
        })
        .setup(move |app| {let app=app.handle().clone();tauri::async_runtime::spawn(async move {
            *lock(&result)=Some(exercise(&app).await);app.exit(0);
        });Ok(())}).build(context).unwrap();
    let running=report.clone();
    assert_eq!(app.run_return(move|_,event|{
        if let tauri::RunEvent::ExitRequested{api,..}=event {
            if lock(&running).is_none(){api.prevent_exit();}
        }
    }),0);
    lock(&report).take().expect("startup test result").unwrap();
}

async fn exercise(app:&tauri::AppHandle)->Result<(),String>{
    lock(&app.state::<ScreenshotState>().inner).context=serde_json::json!({"lang":"zh","theme":"light"});
    startup::ensure_window(app).await?;
    let deadline=Instant::now()+Duration::from_secs(15);
    while !app.state::<ScreenshotState>().capture_prepared.load(Ordering::Acquire) {
        if Instant::now()>deadline{return Err("startup:prepare-timeout".into());}
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(lock(&app.state::<ScreenshotState>().inner).session.is_none(),"prewarming must not capture pixels");
    assert_eq!(app.state::<Fixture>().frames.load(Ordering::Acquire),0);
    for run in 0..100 {
        let large=(30..60).contains(&run);
        app.state::<Fixture>().large.store(large,Ordering::Release);
        let started=Instant::now();begin(app).await?;
        let deadline=Instant::now()+Duration::from_secs(15);
        loop {
            if lock(&app.state::<ScreenshotState>().inner).session.as_ref().is_some_and(|s|s.ready){break;}
            if Instant::now()>deadline{return Err("startup:ready-timeout".into());}
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        println!("WEBVIEW_STARTUP {} {:.2}ms",if run==0 {"prepared-first"} else if large {"4k"} else {"1080p"},started.elapsed().as_secs_f64()*1000.0);
        let window=app.get_webview_window(CAPTURE_LABEL).unwrap();
        assert!(quick_screenshot_image(app.clone(),window.clone(),0).await.is_err(),"a stale session cannot read pixels");
        if run==0 || run==30 {
            let pixels=eval(&window,"(() => {const i=document.getElementById('shotDesktop');const c=document.createElement('canvas');c.width=1;c.height=1;const x=c.getContext('2d');x.drawImage(i,10,10,1,1,0,0,1,1);return {width:i.naturalWidth,height:i.naturalHeight,pixel:[...x.getImageData(0,0,1,1).data]};})()").await?;
            assert_eq!(pixels["width"],if large {3840} else {1920});assert_eq!(pixels["height"],if large {2160} else {1080});
            assert_eq!(pixels["pixel"],serde_json::json!([245,10,10,255]));
            let session=lock(&app.state::<ScreenshotState>().inner).session.as_ref().unwrap().id;
            window.emit("screenshot-opened",session).map_err(|_|"test:emit")?;
            tokio::time::sleep(Duration::from_millis(25)).await;
            assert!(lock(&app.state::<ScreenshotState>().inner).session.as_ref().unwrap().ready);
        }
        assert!(!app.get_webview_window(CAPTURE_LABEL).unwrap().is_visible().unwrap(),"test never displays desktop pixels or activates a window");
        finish(app);
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert!(lock(&app.state::<ScreenshotState>().inner).session.is_none());
        let cleared=eval(&window,"({source:document.getElementById('shotDesktop').getAttribute('src'),width:document.getElementById('shotCanvas').width,toolbar:document.getElementById('shotToolbar').hidden})").await?;
        assert!(cleared["source"].is_null());assert_eq!(cleared["width"],1);assert_eq!(cleared["toolbar"],true);
    }
    assert_eq!(app.webview_windows().len(),1,"repeated capture reuses one shell");
    let old=app.get_webview_window(CAPTURE_LABEL).unwrap();old.destroy().map_err(|_|"test:destroy")?;
    let deadline=Instant::now()+Duration::from_secs(3);
    while app.get_webview_window(CAPTURE_LABEL).is_some(){if Instant::now()>deadline{return Err("test:destroy-timeout".into());}tokio::time::sleep(Duration::from_millis(10)).await;}
    let started=Instant::now();begin(app).await?;
    let deadline=Instant::now()+Duration::from_secs(15);
    while !lock(&app.state::<ScreenshotState>().inner).session.as_ref().is_some_and(|s|s.ready){if Instant::now()>deadline{return Err("test:cold-timeout".into());}tokio::time::sleep(Duration::from_millis(5)).await;}
    println!("WEBVIEW_STARTUP cold-fallback {:.2}ms",started.elapsed().as_secs_f64()*1000.0);
    finish(app);
    println!("WEBVIEW_LIFECYCLE 100 sessions: dimensions/pixels, stale ticket, duplicate notification, release and single shell passed");
    Ok(())
}

async fn eval(window:&tauri::WebviewWindow,script:&str)->Result<Value,String>{
    let (send,receive)=tokio::sync::oneshot::channel();let send=Mutex::new(Some(send));
    window.eval_with_callback(script,move|value|{if let Some(send)=lock(&send).take(){let _=send.send(value);}}).map_err(|_|"test:eval")?;
    let value=tokio::time::timeout(Duration::from_secs(4),receive).await.map_err(|_|"test:eval-timeout")?.map_err(|_|"test:eval-closed")?;
    serde_json::from_str(&value).map_err(|_|"test:eval-json".into())
}
