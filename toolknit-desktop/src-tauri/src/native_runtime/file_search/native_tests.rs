use super::*;
use std::time::{Duration, Instant};
#[path = "native_acceptance.rs"]
mod acceptance;
#[path = "native_capture_tests.rs"]
mod capture_tests;
#[path = "native_latency.rs"]
mod latency;
#[path = "native_frame_tests.rs"]
mod frame_tests;
use crate::native_runtime::quick_screenshot::ScreenshotState;

// Real WebView2 and native HWNDs in an isolated process, outside the display.
// No installed app settings, clipboard, user files or foreground input touched.
#[test]
#[ignore = "build frontend first; explicit native WebView2 integration test"]
fn paired_webviews_load_clip_hide_and_reopen() {
    const NAME: &str =
        "native_runtime::file_search::native_tests::paired_webviews_load_clip_hide_and_reopen";
    if std::env::var_os("TOOLKNIT_FILE_SEARCH_ISOLATED").is_none() {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                NAME,
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("TOOLKNIT_FILE_SEARCH_ISOLATED", "1")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let until = Instant::now()
            + Duration::from_secs(
                if std::env::var_os("TOOLKNIT_FILE_SEARCH_VISUAL").is_some()
                    || std::env::var_os("TOOLKNIT_FILE_SEARCH_LATENCY").is_some()
                {
                    if std::env::var_os("TOOLKNIT_FILE_SEARCH_ACCEPTANCE").is_some() {
                        960
                    } else {
                        360
                    }
                } else {
                    180
                },
            );
        while child.try_wait().unwrap().is_none() {
            if Instant::now() > until {
                let _ = child.kill();
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        print!("{}", String::from_utf8_lossy(&output.stdout));
        return;
    }
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.toolknit.file-search-native-test".into();
    for w in &mut context.config_mut().app.windows {
        w.visible = false;
        w.focus = false;
        if w.label == "main" && std::env::var_os("TOOLKNIT_FILE_SEARCH_ACCEPTANCE").is_some() {
            w.url = tauri::WebviewUrl::CustomProtocol(
                "search-acceptance://localhost/".parse().unwrap(),
            );
        }
    }
    let report = std::sync::Arc::new(Mutex::new(None));
    let capture = report.clone();
    let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        file_search,
        crate::native_runtime::quick_screenshot::quick_screenshot,
    ];
    let app = tauri::Builder::default()
        .any_thread()
        .manage(FileSearchState::default())
        .manage(ScreenshotState::default())
        .manage(acceptance::Control::default())
        .manage(crate::platform::auxiliary_windows::Registry::default())
        .register_uri_scheme_protocol("search-acceptance", |_, _| {
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .body(include_bytes!("native_acceptance.html").to_vec())
                .unwrap()
        })
        .invoke_handler(move |invoke| {
            if invoke.message.command() == "file_search_acceptance" {
                acceptance::handle(invoke);
                return true;
            }
            if invoke.message.command() != "file_search"
                && std::env::var_os("TOOLKNIT_FILE_SEARCH_ACCEPTANCE").is_none()
            {
                return false;
            }
            latency::observe(&invoke);
            handler(invoke)
        })
        .setup(move |app| {
            register_capture_group(app.handle());
            lock(&app.state::<FileSearchState>().inner)
                .preferences
                .enabled = true;
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = exercise(&app).await;
                *lock(&capture) = Some(result);
                app.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    assert_eq!(app.run_return(|_, _| {}), 0);
    let result = lock(&report).take().expect("native test must finish");
    result.unwrap();
}

async fn exercise(app: &tauri::AppHandle) -> Result<(), String> {
    let main=app.get_webview_window("main").ok_or("missing main")?;
    assert_eq!(file_search(app.clone(),main.clone(),json!({"action":"search","query":{"text":"合同"}})).await.unwrap_err(),"file-search:cancelled","main IPC is blocked while capsule mode is enabled");
    let fixture =
        std::env::temp_dir().join(format!("toolknit-search-views-{}", std::process::id()));
    std::fs::create_dir(&fixture).map_err(|_| "fixture")?;
    let source = fixture.join("source");
    let other = fixture.join("other");
    std::fs::create_dir(&source).map_err(|_| "fixture")?;
    std::fs::create_dir(&other).map_err(|_| "fixture")?;
    std::fs::write(source.join("合同.txt"), b"fixture").map_err(|_| "fixture")?;
    std::fs::write(source.join("invoice.txt"), b"fixture").map_err(|_| "fixture")?;
    service::configure(app, vec![source.to_string_lossy().into_owned()]).await?;
    let deadline = Instant::now() + Duration::from_secs(10);
    while service::status(app)?["index"]["phase"] != "ready" {
        if Instant::now() > deadline {
            return Err("native fixture index timeout".into());
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    let page = service::search(
        app,
        0,
        query::Query {
            text: "合同".into(),
            ..Default::default()
        },
        None,
    )
    .await?;
    let floating = service::search(
        app,
        1,
        query::Query {
            text: "invoice".into(),
            ..Default::default()
        },
        None,
    )
    .await?;
    assert_eq!(page["result"]["rows"][0]["name"], "合同.txt");
    assert_eq!(floating["result"]["rows"][0]["name"], "invoice.txt");
    assert_ne!(page["ticket"], floating["ticket"]);
    assert_eq!(file_search(app.clone(),main.clone(),json!({"action":"query-check","ticket":page["ticket"]})).await.unwrap_err(),"file-search:cancelled");
    let ticket=page["ticket"].as_str().unwrap();
    assert_eq!(service::check_query(app,0,ticket).await?["changed"],false);
    let unrelated=source.join("unrelated.txt");std::fs::write(&unrelated,b"unrelated").unwrap();
    let deadline=Instant::now()+Duration::from_secs(5);
    while service::status(app)?["index"]["indexed"]!=3 {
        if Instant::now()>deadline{return Err("query-check:unrelated-timeout".into());}
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    assert_eq!(service::check_query(app,0,ticket).await?["changed"],false,"unrelated file does not request refresh");
    let renamed=source.join("合同-new.txt");std::fs::rename(source.join("合同.txt"),&renamed).unwrap();
    let deadline=Instant::now()+Duration::from_secs(5);
    loop {
        if service::check_query(app,0,ticket).await?["changed"]==true {break;}
        if Instant::now()>deadline{return Err("query-check:rename-timeout".into());}
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    std::fs::rename(&renamed,source.join("合同.txt")).unwrap();
    assert!(service::check_query(app,1,ticket).await.is_err(),"checks cannot borrow another surface lease");
    service::invalidate(app,0)?;assert!(service::check_query(app,0,ticket).await.is_err());
    assert!(
        service::reveal(
            app,
            0,
            floating["result"]["rows"][0]["id"].as_str().unwrap(),
            floating["ticket"].as_str().unwrap()
        )
        .await
        .is_err(),
        "one view cannot reveal another view's result"
    );
    service::configure(app, vec![other.to_string_lossy().into_owned()]).await?;
    assert!(
        service::reveal(
            app,
            0,
            page["result"]["rows"][0]["id"].as_str().unwrap(),
            page["ticket"].as_str().unwrap()
        )
        .await
        .is_err(),
        "scope changes revoke old tickets"
    );
    service::clear(app).await?;
    assert_eq!(std::fs::read(source.join("合同.txt")).unwrap(), b"fixture");
    std::fs::remove_dir_all(&fixture).map_err(|_| "fixture cleanup")?;
    windows::set_expanded(app, false, false).await?;
    let until = Instant::now() + Duration::from_secs(25);
    loop {
        if lock(&app.state::<FileSearchState>().inner).ready.len() == 3 {
            break;
        }
        if Instant::now() > until {
            return Err("both real WebViews must complete their boot/ready IPC".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if std::env::var_os("TOOLKNIT_FILE_SEARCH_LATENCY").is_some() {
        latency::measure(app).await?;
    }
    if std::env::var_os("TOOLKNIT_FILE_SEARCH_VISUAL").is_some() {
        let root =
            std::env::temp_dir().join(format!("toolknit-search-visual-{}", std::process::id()));
        std::fs::create_dir(&root).map_err(|_| "visual fixture")?;
        for i in 1..=60 {
            std::fs::write(
                root.join(format!("合同{i}.txt")),
                b"ToolKnit disposable search fixture",
            )
            .map_err(|_| "visual fixture")?;
        }
        std::fs::write(
            root.join("invoice, final.csv"),
            b"item,amount\nfixture,10\n",
        )
        .map_err(|_| "visual fixture")?;
        service::configure(app, vec![root.to_string_lossy().into_owned()]).await?;
        let deadline = Instant::now() + Duration::from_secs(10);
        while service::status(app)?["index"]["phase"] != "ready" {
            if Instant::now() > deadline {
                return Err("visual index timeout".into());
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        lock(&app.state::<FileSearchState>().inner).query =
            json!({"text":"合同","extension":"","sort":"relevance"});
        let acceptance = std::env::var_os("TOOLKNIT_FILE_SEARCH_ACCEPTANCE").is_some();
        if acceptance {
            acceptance::show(app).await?;
        }
        windows::set_expanded(app, true, true).await?;
        println!(
            "FILE_SEARCH_VISUAL_READY pid={} layout={:?}",
            std::process::id(),
            lock(&app.state::<FileSearchState>().inner).layout
        );
        windows::on_main(app, |host| {
            for label in [BAR, RESULTS] {
                if let Some(w) = host.get_webview_window(label) {
                    println!(
                        "VISUAL {} position={:?} size={:?} focused={:?}",
                        label,
                        w.outer_position(),
                        w.inner_size(),
                        w.is_focused()
                    );
                }
            }
            Ok(())
        })
        .await?;
        let stop =
            std::env::var_os("TOOLKNIT_FILE_SEARCH_VISUAL_STOP").map(std::path::PathBuf::from);
        let deadline = Instant::now() + Duration::from_secs(if acceptance { 900 } else { 240 });
        while Instant::now() < deadline
            && !stop.as_ref().is_some_and(|p| p.is_file())
            && !app.state::<acceptance::Control>().0.load(Ordering::Acquire)
        {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        // End the interactive session without replaying the off-screen stress
        // checks visibly. This also lets a stop marker clean up normally.
        windows::hide(app, true).await?;
        crate::native_runtime::quick_screenshot::finish(app);
        service::clear(app).await?;
        std::fs::remove_dir_all(root).map_err(|_| "visual fixture cleanup")?;
        shutdown(app);
        return Ok(());
    }
    frame_tests::exercise(app).await?;
    // Escape from the separate input HWND reaches the results WebView first,
    // allowing its picker to consume it. With no picker open it must collapse.
    windows::set_expanded(app, true, false).await?;
    file_search(
        app.clone(),
        app.get_webview_window(BAR).ok_or("missing bar")?,
        json!({"action":"navigate","key":"Escape"}),
    )
    .await?;
    let escape_until = Instant::now() + Duration::from_secs(3);
    while lock(&app.state::<FileSearchState>().inner).expanded {
        if Instant::now() > escape_until {
            return Err("cross-window Escape did not collapse".into());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    for i in 0..50 {
        windows::set_expanded(app, true, false).await?;
        tokio::time::sleep(Duration::from_millis(350)).await;
        windows::on_main(app, |host| {
            use ::windows::Win32::{
                Foundation::HWND,
                Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, PtInRegion},
                UI::WindowsAndMessaging::{GetWindowRect, IsWindowVisible},
            };
            let a = host.get_webview_window(BAR).ok_or("missing bar")?;
            let b = host.get_webview_window(RESULTS).ok_or("missing results")?;
            let ah = HWND(a.hwnd().unwrap().0 as isize);
            let bh = HWND(b.hwnd().unwrap().0 as isize);
            unsafe {
                assert!(IsWindowVisible(ah).as_bool() && IsWindowVisible(bh).as_bool());
                let mut ar = Default::default();
                let mut br = Default::default();
                GetWindowRect(ah, &mut ar).unwrap();
                GetWindowRect(bh, &mut br).unwrap();
                assert_eq!(br.top - ar.bottom, 20, "gap has no interactive HWND");
                assert_eq!(ar.right - ar.left, br.right - br.left);
                for (h, width, height) in [
                    (ah, ar.right - ar.left, ar.bottom - ar.top),
                    (bh, br.right - br.left, br.bottom - br.top),
                ] {
                    let region = CreateRectRgn(0, 0, 0, 0);
                    assert_ne!(GetWindowRgn(h, region).0, 0);
                    assert!(
                        !PtInRegion(region, 0, 0).as_bool(),
                        "round corners are outside the native hit region"
                    );
                    assert!(PtInRegion(region, width / 2, height / 2).as_bool());
                    let _ = DeleteObject(region);
                }
            }
            Ok(())
        })
        .await?;
        windows::set_expanded(app, false, false).await?;
        if i % 2 == 0 {
            windows::set_expanded(app, true, false).await?;
        }
    }
    // Interrupt a real in-progress morph rather than only testing endpoints.
    for _ in 0..8 {
        windows::set_expanded(app, false, false).await?;
        tokio::time::sleep(Duration::from_millis(70)).await;
        windows::set_expanded(app, true, false).await?;
        tokio::time::sleep(Duration::from_millis(55)).await;
        windows::set_expanded(app, false, false).await?;
        tokio::time::sleep(Duration::from_millis(380)).await;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(tx));
        app.get_webview_window(BAR).ok_or("missing bar")?.eval_with_callback(
            "(() => {const b=document.querySelector('.fs-bar'),r=b.getBoundingClientRect();return {width:r.width,height:r.height,animations:b.getAnimations().length,expanded:b.dataset.expanded};})()",
            move |value|{if let Some(tx)=lock(&sender).take(){let _=tx.send(value);}}
        ).map_err(|_|"motion:eval")?;
        let value = tokio::time::timeout(Duration::from_secs(3), rx)
            .await
            .map_err(|_| "motion:timeout")?
            .map_err(|_| "motion:closed")?;
        let value: Value = serde_json::from_str(&value).map_err(|_| "motion:report")?;
        if value["expanded"] != "false"
            || value["width"] != 148
            || value["height"] != 48
            || value["animations"] != 0
        {
            return Err(format!("motion:interrupted-collapse {value}"));
        }
    }
    println!("WEBVIEW_MOTION repeated mid-animation reversal settles to capsule with no retained animation");
    // Losing one native surface must hide its partner and allow explicit
    // re-enabling, without modifying the user's saved enabled preference.
    windows::on_main(app, |host| {
        host.get_webview_window(RESULTS)
            .ok_or("missing results")?
            .destroy()
            .map_err(|_| "destroy fixture".to_owned())
    })
    .await?;
    let recovery_until = Instant::now() + Duration::from_secs(5);
    while !lock(&app.state::<FileSearchState>().inner).hidden
        || app.get_webview_window(RESULTS).is_some()
    {
        if Instant::now() > recovery_until {
            return Err("destroyed pair did not withdraw".into());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(
        lock(&app.state::<FileSearchState>().inner)
            .preferences
            .enabled
    );
    windows::on_main(app, |host| {
        use ::windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::IsWindowVisible};
        let bar = host.get_webview_window(BAR).ok_or("missing bar")?;
        assert!(
            !unsafe { IsWindowVisible(HWND(bar.hwnd().unwrap().0 as isize)) }.as_bool(),
            "failed results window must not leave an orphan bar"
        );
        Ok(())
    })
    .await?;
    file_search(
        app.clone(),
        app.get_webview_window("main").ok_or("missing main")?,
        json!({"action":"configure","enabled":true}),
    )
    .await?;
    let recovery_until = Instant::now() + Duration::from_secs(25);
    while lock(&app.state::<FileSearchState>().inner).ready.len() != 3 {
        if Instant::now() > recovery_until {
            return Err("pair retry did not become ready".into());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(allowed(&app.state::<FileSearchState>()));
    assert!(!lock(&app.state::<FileSearchState>().inner).expanded);
    windows::menu_open(app).await?;
    let menu_token = lock(&app.state::<FileSearchState>().inner)
        .menu_token
        .expect("menu token");
    windows::menu_close(app, Some(menu_token)).await?;
    assert!(
        windows::menu_close(app, Some(menu_token)).await.is_err(),
        "stale menu actions cannot affect a later session"
    );
    capture_tests::verify(app).await?;
    let token = capture_suspend(app);
    assert!(!allowed(&app.state::<FileSearchState>()));
    windows::hide(app, true).await?;
    capture_restore(app, token);
    assert!(
        !allowed(&app.state::<FileSearchState>()),
        "capture restore honors a newer hide intent"
    );
    windows::hide(app, true).await?;
    tokio::time::sleep(Duration::from_millis(380)).await;
    windows::on_main(app, |host| {
        use ::windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::IsWindowVisible};
        for label in [BAR, RESULTS] {
            let w = host.get_webview_window(label).unwrap();
            assert!(!unsafe { IsWindowVisible(HWND(w.hwnd().unwrap().0 as isize)) }.as_bool());
        }
        Ok(())
    })
    .await?;
    assert!(
        windows::set_expanded(app, true, false).await.is_err(),
        "hidden state rejects late expansion"
    );
    lock(&app.state::<FileSearchState>().inner).hidden = false;
    windows::set_expanded(app, false, false).await?;
    let count = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("file-search-"))
        .count();
    assert_eq!(count, 3, "reopen reuses the pair and prewarmed menu");
    shutdown(app);
    assert!(!allowed(&app.state::<FileSearchState>()));
    Ok(())
}
