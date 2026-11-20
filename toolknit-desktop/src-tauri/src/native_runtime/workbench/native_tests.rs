use super::*;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[test]
#[ignore = "explicit isolated native shortcut and background-folder acceptance test"]
fn native_shortcut_registration_and_folder_worker() {
    const NAME: &str =
        "native_runtime::workbench::native_tests::native_shortcut_registration_and_folder_worker";
    if std::env::var_os("TOOLKNIT_WORKBENCH_NATIVE_CHILD").is_none() {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                NAME,
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("TOOLKNIT_WORKBENCH_NATIVE_CHILD", "1")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(55);
        while child.try_wait().unwrap().is_none() {
            if Instant::now() > deadline {
                let _ = child.kill();
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
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
    context.config_mut().identifier =
        format!("com.toolknit.workbench-acceptance-{}", std::process::id());
    context.config_mut().app.windows.clear();
    let report = Arc::new(Mutex::new(None));
    let capture = report.clone();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(FolderState::default())
        .manage(LauncherState::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = exercise(&app).await;
                shutdown(&app);
                let _ = launcher::dispatch(&app, json!({"action":"save","shortcut":null}));
                if let Ok(folder) = app_folder(&app) {
                    let _ = std::fs::remove_dir_all(folder);
                }
                *capture.lock().unwrap() = Some(result);
                app.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    assert_eq!(app.run_return(|_, _| {}), 0);
    report.lock().unwrap().take().unwrap().unwrap();
}

async fn exercise(app: &tauri::AppHandle) -> Result<(), String> {
    let status = launcher::dispatch(
        app,
        json!({"action":"save","shortcut":"Ctrl+Alt+Shift+F11"}),
    )?;
    if status["shortcut"] != "Ctrl+Alt+Shift+F11"
        || !app.global_shortcut().is_registered("Ctrl+Alt+Shift+F11")
    {
        return Err("System shortcut did not register".into());
    }
    if launcher::dispatch(app, json!({"action":"save","shortcut":"not-a-shortcut"})).is_ok() {
        return Err("Invalid shortcut accepted".into());
    }
    launcher::dispatch(app, json!({"action":"save","shortcut":null}))?;
    if app.global_shortcut().is_registered("Ctrl+Alt+Shift+F11") {
        return Err("System shortcut did not unregister".into());
    }
    let root =
        std::env::temp_dir().join(format!("toolknit-workbench-native-{}", folders::next_id()));
    let input = root.join("input");
    let output = root.join("output");
    std::fs::create_dir_all(&input).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&output).map_err(|e| e.to_string())?;
    std::fs::write(input.join("existing.txt"), "baseline").map_err(|e| e.to_string())?;
    let rule = json!({"id":"acceptance","name":"Native acceptance","input":input,"output":output,"action":"archive-copy","format":"PNG","quality":"medium","enabled":true});
    folders::dispatch(app, json!({"action":"save","rule":rule}))?;
    folders::bootstrap(app);
    std::fs::write(input.join("new.txt"), "new file content").map_err(|e| e.to_string())?;
    let target = output.join("txt/new.txt");
    let deadline = Instant::now() + Duration::from_secs(18);
    while !target.exists() {
        if Instant::now() > deadline {
            return Err("Background worker did not process new file".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if std::fs::read_to_string(&target).map_err(|e| e.to_string())? != "new file content"
        || !input.join("new.txt").exists()
        || output.join("txt/existing.txt").exists()
    {
        return Err("Background file publication or baseline is incorrect".into());
    }
    tokio::time::sleep(Duration::from_secs(4)).await;
    let state = folders::dispatch(app, json!({"action":"list"}))?;
    if state["history"].as_array().map(Vec::len) != Some(1) {
        return Err("Background worker processed the same file more than once".into());
    }
    let mut paused = rule.clone();
    paused["enabled"] = json!(false);
    folders::dispatch(app, json!({"action":"save","rule":paused}))?;
    std::fs::write(input.join("paused.txt"), "skip while paused").map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_secs(7)).await;
    if output.join("txt/paused.txt").exists() {
        return Err("Paused rule processed a new file".into());
    }
    folders::dispatch(app, json!({"action":"save","rule":rule}))?;
    tokio::time::sleep(Duration::from_secs(7)).await;
    if output.join("txt/paused.txt").exists() {
        return Err("Resume failed to re-establish baseline".into());
    }
    folders::dispatch(app, json!({"action":"delete","id":"acceptance"}))?;
    shutdown(app);
    tokio::time::sleep(Duration::from_secs(4)).await;
    std::fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    let folder = app_folder(app)?;
    std::fs::remove_dir_all(folder).map_err(|e| e.to_string())?;
    println!("Native acceptance passed: registered/unregistered system shortcut, background copy, baseline, no duplicate jobs, pause, resume and preserved originals.");
    Ok(())
}
