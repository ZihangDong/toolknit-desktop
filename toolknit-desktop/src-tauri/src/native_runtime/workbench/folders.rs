use super::*;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Rule {
    id: String,
    name: String,
    input: String,
    output: String,
    action: String,
    format: String,
    quality: String,
    enabled: bool,
}
#[derive(Default)]
pub(crate) struct FolderState {
    rules: Mutex<Vec<Rule>>,
    stop: AtomicBool,
}
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
pub(super) fn next_id() -> String {
    format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}
fn stamp(meta: &std::fs::Metadata) -> String {
    format!("{}:{}", meta.len(), modified_ms(meta))
}

fn valid_rule(mut rule: Rule) -> Result<Rule, String> {
    if rule.id.is_empty()
        || rule.id.len() > 80
        || !rule
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        || rule.name.trim().is_empty()
        || rule.name.chars().count() > 60
    {
        return Err("Invalid rule name or ID".into());
    }
    let input = canonical_directory(&rule.input)?;
    let output = canonical_directory(&rule.output)?;
    if input.starts_with(&output) || output.starts_with(&input) {
        return Err(
            "Input and output folders must be separate, without containing each other".into(),
        );
    }
    if !["image-convert", "image-compress", "archive-copy"].contains(&rule.action.as_str())
        || !["PNG", "JPG", "WEBP"].contains(&rule.format.as_str())
        || !["high", "medium", "low"].contains(&rule.quality.as_str())
    {
        return Err("Unsupported automation settings".into());
    }
    rule.input = input.to_string_lossy().into_owned();
    rule.output = output.to_string_lossy().into_owned();
    Ok(rule)
}
fn candidates(rule: &Rule) -> Result<(Vec<(String, String)>, bool), String> {
    let mut files = Vec::new();
    let mut count = 0;
    let mut limited = false;
    for entry in std::fs::read_dir(&rule.input).map_err(|e| e.to_string())? {
        count += 1;
        if count > 5000 {
            limited = true;
            break;
        }
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.')
            || name.starts_with('~')
            || [".tmp", ".part", ".crdownload", ".download"]
                .iter()
                .any(|end| name.to_lowercase().ends_with(end))
        {
            continue;
        }
        let path = entry.path();
        let meta = match std::fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.len() == 0
            || meta.len() > 200 * 1024 * 1024
        {
            continue;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                continue;
            }
        }
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if rule.action != "archive-copy"
            && !["png", "jpg", "jpeg", "webp", "bmp", "gif"].contains(&extension.as_str())
        {
            continue;
        }
        if rule.action == "image-compress"
            && !["png", "jpg", "jpeg", "webp"].contains(&extension.as_str())
        {
            continue;
        }
        files.push((path.to_string_lossy().into_owned(), stamp(&meta)));
    }
    Ok((files, limited))
}
fn save(folder: &Path, rules: &[Rule]) -> Result<(), String> {
    let pending = folder.join("folder-rules.pending.json");
    std::fs::write(
        &pending,
        serde_json::to_vec(rules).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(pending, folder.join("folder-rules.json")).map_err(|e| e.to_string())
}
fn baseline(folder: &Path, rule: &Rule) -> Result<(), String> {
    let (files, limited) = candidates(rule)?;
    if limited {
        return Err("Folder has more than 5000 entries; choose a smaller folder".into());
    }
    let mut connection = db(folder)?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM folder_seen WHERE rule=?1", [&rule.id])
        .map_err(|e| e.to_string())?;
    for (path, stamp) in files {
        transaction
            .execute(
                "INSERT INTO folder_seen VALUES(?1,?2,?3,'baseline')",
                params![rule.id, path, stamp],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}
fn ready_files(
    connection: &rusqlite::Connection,
    rule: &Rule,
    files: &[(String, String)],
    stable: &mut HashMap<(String, String), (String, u8)>,
) -> Result<Vec<(String, String)>, String> {
    let live: std::collections::HashSet<_> = files.iter().map(|(path, _)| path.clone()).collect();
    stable.retain(|(id, path), _| id != &rule.id || live.contains(path));
    let mut ready = Vec::new();
    for (path, signature) in files {
        let seen = connection
            .query_row(
                "SELECT stamp FROM folder_seen WHERE rule=?1 AND path=?2",
                params![rule.id, path],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if seen.as_ref() == Some(signature) {
            continue;
        }
        let value = stable
            .entry((rule.id.clone(), path.clone()))
            .or_insert((signature.clone(), 0));
        if value.0 != *signature {
            *value = (signature.clone(), 0);
            continue;
        }
        value.1 = value.1.saturating_add(1);
        if value.1 >= 2 {
            ready.push((path.clone(), signature.clone()));
        }
    }
    Ok(ready)
}

pub(super) fn dispatch(app: &tauri::AppHandle, request: Value) -> Result<Value, String> {
    let folder = app_folder(app)?;
    let state = app.state::<FolderState>();
    match string(&request, "action")? {
        "list" => {}
        "save" => {
            let candidate: Rule =
                serde_json::from_value(request["rule"].clone()).map_err(|e| e.to_string())?;
            let mut rules = state.rules.lock().map_err(|e| e.to_string())?;
            let rule = match valid_rule(candidate.clone()) {
                Ok(rule) => rule,
                Err(error) => {
                    let paused = rules
                        .iter()
                        .find(|rule| rule.id == candidate.id)
                        .map(|rule| {
                            let mut value = rule.clone();
                            value.enabled = false;
                            value
                        });
                    if !candidate.enabled
                        && paused
                            .as_ref()
                            .map(|rule| {
                                serde_json::to_string(rule).ok()
                                    == serde_json::to_string(&candidate).ok()
                            })
                            .unwrap_or(false)
                    {
                        candidate
                    } else {
                        return Err(error);
                    }
                }
            };
            if rules.len() >= 8 && !rules.iter().any(|item| item.id == rule.id) {
                return Err("Maximum 8 folder rules".into());
            }
            let old = rules.iter().find(|item| item.id == rule.id);
            for other in rules.iter().filter(|other| other.id != rule.id) {
                let input = Path::new(&rule.input);
                let output = Path::new(&rule.output);
                let other_input = Path::new(&other.input);
                let other_output = Path::new(&other.output);
                if input.starts_with(other_output)
                    || other_output.starts_with(input)
                    || output.starts_with(other_input)
                    || other_input.starts_with(output)
                {
                    return Err("A rule output cannot overlap any watched input folder; choose separate folders".into());
                }
            }
            // Establish a baseline on explicit enable/edit; existing files are never processed implicitly.
            if rule.enabled
                && old
                    .map(|item| {
                        !item.enabled
                            || serde_json::to_string(item).ok() != serde_json::to_string(&rule).ok()
                    })
                    .unwrap_or(true)
            {
                baseline(&folder, &rule)?;
            }
            let mut next = rules.clone();
            next.retain(|item| item.id != rule.id);
            next.push(rule);
            save(&folder, &next)?;
            *rules = next;
        }
        "delete" => {
            let id = string(&request, "id")?;
            let mut rules = state.rules.lock().map_err(|e| e.to_string())?;
            let next: Vec<_> = rules.iter().filter(|rule| rule.id != id).cloned().collect();
            save(&folder, &next)?;
            *rules = next;
            db(&folder)?
                .execute("DELETE FROM folder_seen WHERE rule=?1", [id])
                .map_err(|e| e.to_string())?;
        }
        "retry" => {
            let id = request["id"].as_i64().ok_or("Invalid history ID")?;
            let connection = db(&folder)?;
            let (rule, path): (String, String) = connection
                .query_row(
                    "SELECT rule,path FROM folder_history WHERE id=?1 AND state='failed'",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|e| e.to_string())?;
            if !state
                .rules
                .lock()
                .map_err(|e| e.to_string())?
                .iter()
                .any(|item| item.id == rule && item.enabled)
            {
                return Err("Enable the rule before retrying".into());
            }
            connection
                .execute(
                    "DELETE FROM folder_seen WHERE rule=?1 AND path=?2",
                    params![rule, path],
                )
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unknown folder automation action".into()),
    }
    let rules = state.rules.lock().map_err(|e| e.to_string())?.clone();
    let statuses: HashMap<_, _> = rules
        .iter()
        .map(|rule| {
            let issue = valid_rule(rule.clone())
                .and_then(|rule| {
                    candidates(&rule).and_then(|(_, limited)| {
                        if limited {
                            Err("Folder exceeds 5000 entries; choose a smaller folder".into())
                        } else {
                            Ok(())
                        }
                    })
                })
                .err();
            (rule.id.clone(), issue)
        })
        .collect();
    let connection = db(&folder)?;
    let mut statement=connection.prepare("SELECT id,rule,path,state,message,output,created FROM folder_history ORDER BY id DESC LIMIT 100").map_err(|e|e.to_string())?;
    let history=statement.query_map([],|row|Ok(json!({"id":row.get::<_,i64>(0)?,"rule":row.get::<_,String>(1)?,"path":row.get::<_,String>(2)?,"state":row.get::<_,String>(3)?,"message":row.get::<_,String>(4)?,"output":row.get::<_,String>(5)?,"created":row.get::<_,u64>(6)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(json!({"rules":rules,"history":history,"statuses":statuses}))
}

fn archive_copy(rule: &Rule, path: &str) -> Result<String, String> {
    use std::io;
    let source = Path::new(path);
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .filter(|s| s.len() <= 20 && s.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("other")
        .to_ascii_lowercase();
    let folder = Path::new(&rule.output).join(extension);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let folder = folder.canonicalize().map_err(|e| e.to_string())?;
    if !folder.starts_with(Path::new(&rule.output)) {
        return Err("Archive folder resolves outside the configured output".into());
    }
    let original_stamp = stamp(&std::fs::metadata(source).map_err(|e| e.to_string())?);
    let name = source
        .file_name()
        .ok_or("Invalid filename")?
        .to_string_lossy();
    for index in 0..1000 {
        let target = folder.join(if index == 0 {
            name.to_string()
        } else {
            format!(
                "{}_{index}.{}",
                source.file_stem().unwrap_or_default().to_string_lossy(),
                source.extension().unwrap_or_default().to_string_lossy()
            )
        });
        let mut output = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        };
        let result = std::fs::File::open(source)
            .and_then(|mut input| io::copy(&mut input, &mut output))
            .and_then(|_| output.sync_all());
        drop(output);
        if let Err(error) = result {
            let _ = std::fs::remove_file(&target);
            return Err(error.to_string());
        }
        if stamp(&std::fs::metadata(source).map_err(|e| e.to_string())?) != original_stamp {
            let _ = std::fs::remove_file(&target);
            return Err("Source changed while copying; output discarded".into());
        }
        return Ok(target.to_string_lossy().into_owned());
    }
    Err("Too many output filename conflicts".into())
}

fn record(
    folder: &Path,
    rule: &Rule,
    path: &str,
    state: &str,
    message: &str,
    output: &str,
) -> Result<(), String> {
    let connection = db(folder)?;
    let created = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    connection.execute("INSERT INTO folder_history(rule,path,state,message,output,created) VALUES(?1,?2,?3,?4,?5,?6)",params![rule.id,path,state,message,output,created]).map_err(|e|e.to_string())?;
    connection.execute("DELETE FROM folder_history WHERE id NOT IN(SELECT id FROM folder_history ORDER BY id DESC LIMIT 500)",[]).map_err(|e|e.to_string())?;
    Ok(())
}
pub(super) fn bootstrap(app: &tauri::AppHandle) {
    let folder = match app_folder(app) {
        Ok(folder) => folder,
        Err(_) => return,
    };
    let rules = std::fs::read(folder.join("folder-rules.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<Rule>>(&bytes).ok())
        .unwrap_or_default();
    if let Ok(mut slot) = app.state::<FolderState>().rules.lock() {
        *slot = rules.into_iter().take(8).collect();
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut stable: HashMap<(String, String), (String, u8)> = HashMap::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            if app.state::<FolderState>().stop.load(Ordering::Relaxed) {
                break;
            }
            let rules = app
                .state::<FolderState>()
                .rules
                .lock()
                .map(|rules| rules.clone())
                .unwrap_or_default();
            stable.retain(|(id, _), _| rules.iter().any(|rule| &rule.id == id && rule.enabled));
            for original in rules.into_iter().filter(|rule| rule.enabled) {
                let rule = match valid_rule(original.clone()) {
                    Ok(rule) => rule,
                    Err(_) => continue,
                };
                let scan_rule = rule.clone();
                let scan =
                    tauri::async_runtime::spawn_blocking(move || candidates(&scan_rule)).await;
                let (files, limited) = match scan {
                    Ok(Ok(files)) => files,
                    _ => continue,
                };
                if limited {
                    continue;
                }
                let connection = match db(&folder) {
                    Ok(connection) => connection,
                    Err(_) => continue,
                };
                let ready = match ready_files(&connection, &rule, &files, &mut stable) {
                    Ok(files) => files,
                    Err(_) => continue,
                };
                for (path, signature) in ready {
                    // Recheck enabled/configuration immediately before each job.
                    let allowed = app
                        .state::<FolderState>()
                        .rules
                        .lock()
                        .map(|rules| {
                            rules.iter().any(|current| {
                                current.enabled
                                    && serde_json::to_string(current).ok()
                                        == serde_json::to_string(&rule).ok()
                            })
                        })
                        .unwrap_or(false);
                    if !allowed {
                        break;
                    }
                    if rule.action != "archive-copy"
                        && super::super::IS_CONVERTING.load(Ordering::SeqCst)
                    {
                        break;
                    }
                    let job = next_id();
                    let label = format!(
                        "{} · {}",
                        rule.name,
                        Path::new(&path)
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    );
                    let _ = app.emit(
                        "toolknit-folder-task",
                        json!({"id":job,"state":"running","label":label}),
                    );
                    let result: Result<String, String> = match rule.action.as_str() {
                        "image-convert" => super::super::convert_image_batch(
                            app.clone(),
                            vec![path.clone()],
                            rule.output.clone(),
                            rule.format.clone(),
                        )
                        .await
                        .and_then(|result| {
                            if result.fail_count > 0 {
                                Err(result.errors.join("\n"))
                            } else {
                                Ok(result.output_dir)
                            }
                        }),
                        "image-compress" => super::super::compress_image_batch(
                            app.clone(),
                            vec![path.clone()],
                            rule.output.clone(),
                            rule.quality.clone(),
                        )
                        .await
                        .and_then(|result| {
                            if result.fail_count > 0 {
                                Err(result.errors.join("\n"))
                            } else {
                                Ok(result.output_dir)
                            }
                        }),
                        _ => {
                            let copy_rule = rule.clone();
                            let copy_path = path.clone();
                            tauri::async_runtime::spawn_blocking(move || {
                                archive_copy(&copy_rule, &copy_path)
                            })
                            .await
                            .map_err(|e| e.to_string())
                            .and_then(|result| result)
                        }
                    };
                    match result {
                        Err(error)
                            if error.to_lowercase().contains("already")
                                || error.to_lowercase().contains("busy")
                                || error.contains("正在") =>
                        {
                            let _=app.emit("toolknit-folder-task",json!({"id":job,"state":"deferred","label":label,"message":"等待其他转换完成 / Waiting for another conversion"}));
                            break;
                        }
                        result => {
                            let (status, message, output) = match result {
                                Ok(output) => ("succeeded", String::new(), output),
                                Err(error) => ("failed", error, String::new()),
                            };
                            if let Err(error) = connection.execute(
                                "INSERT OR REPLACE INTO folder_seen VALUES(?1,?2,?3,?4)",
                                params![rule.id, path, signature, status],
                            ) {
                                if let Ok(mut rules) = app.state::<FolderState>().rules.lock() {
                                    if let Some(current) =
                                        rules.iter_mut().find(|item| item.id == rule.id)
                                    {
                                        current.enabled = false;
                                    }
                                    let _ = save(&folder, &rules);
                                }
                                let _=app.emit("toolknit-folder-task",json!({"id":job,"state":"failed","label":label,"output":output,"message":format!("Rule paused because completion could not be saved: {error}")}));
                                break;
                            }
                            let _ = record(&folder, &rule, &path, status, &message, &output);
                            let _=app.emit("toolknit-folder-task",json!({"id":job,"state":status,"label":label,"message":message,"output":output}));
                            let _ = app.emit("toolknit-folder-state", ());
                        }
                    }
                    stable.remove(&(rule.id.clone(), path));
                }
            }
        }
    });
}
pub(super) fn shutdown(app: &tauri::AppHandle) {
    app.state::<FolderState>()
        .stop
        .store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn baseline_and_copy_are_non_destructive() {
        let root = std::env::temp_dir().join(format!("toolknit-folder-{}", next_id()));
        let input = root.join("in");
        let output = root.join("out");
        std::fs::create_dir_all(&input).unwrap();
        std::fs::create_dir_all(&output).unwrap();
        std::fs::write(input.join("a.txt"), "original").unwrap();
        let rule = valid_rule(Rule {
            id: "test".into(),
            name: "test".into(),
            input: input.to_string_lossy().into_owned(),
            output: output.to_string_lossy().into_owned(),
            action: "archive-copy".into(),
            format: "PNG".into(),
            quality: "medium".into(),
            enabled: true,
        })
        .unwrap();
        baseline(&root, &rule).unwrap();
        assert_eq!(
            db(&root)
                .unwrap()
                .query_row("SELECT count(*) FROM folder_seen", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let first = archive_copy(&rule, input.join("a.txt").to_str().unwrap()).unwrap();
        let second = archive_copy(&rule, input.join("a.txt").to_str().unwrap()).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read_to_string(first).unwrap(), "original");
        assert!(input.join("a.txt").exists());
        let invalid = Rule {
            output: input.join("child").to_string_lossy().into_owned(),
            ..rule
        };
        std::fs::create_dir_all(&invalid.output).unwrap();
        assert!(valid_rule(invalid).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_new_stable_fingerprints_run_once() {
        let root = std::env::temp_dir().join(format!("toolknit-folder-stability-{}", next_id()));
        let input = root.join("in");
        let output = root.join("out");
        std::fs::create_dir_all(&input).unwrap();
        std::fs::create_dir_all(&output).unwrap();
        std::fs::write(input.join("old.txt"), "old").unwrap();
        let rule = valid_rule(Rule {
            id: "stable".into(),
            name: "stable".into(),
            input: input.to_string_lossy().into_owned(),
            output: output.to_string_lossy().into_owned(),
            action: "archive-copy".into(),
            format: "PNG".into(),
            quality: "medium".into(),
            enabled: true,
        })
        .unwrap();
        baseline(&root, &rule).unwrap();
        let connection = db(&root).unwrap();
        let mut stable = HashMap::new();
        assert!(ready_files(
            &connection,
            &rule,
            &candidates(&rule).unwrap().0,
            &mut stable
        )
        .unwrap()
        .is_empty());
        std::fs::write(input.join("new.txt"), "first").unwrap();
        std::fs::write(input.join("skip.tmp"), "temporary").unwrap();
        assert!(ready_files(
            &connection,
            &rule,
            &candidates(&rule).unwrap().0,
            &mut stable
        )
        .unwrap()
        .is_empty());
        std::fs::write(input.join("new.txt"), "still writing, size changed").unwrap();
        assert!(ready_files(
            &connection,
            &rule,
            &candidates(&rule).unwrap().0,
            &mut stable
        )
        .unwrap()
        .is_empty());
        assert!(ready_files(
            &connection,
            &rule,
            &candidates(&rule).unwrap().0,
            &mut stable
        )
        .unwrap()
        .is_empty());
        let jobs = ready_files(
            &connection,
            &rule,
            &candidates(&rule).unwrap().0,
            &mut stable,
        )
        .unwrap();
        assert_eq!(jobs.len(), 1);
        let (path, signature) = &jobs[0];
        archive_copy(&rule, path).unwrap();
        connection
            .execute(
                "INSERT OR REPLACE INTO folder_seen VALUES(?1,?2,?3,'succeeded')",
                params![rule.id, path, signature],
            )
            .unwrap();
        assert!(ready_files(
            &connection,
            &rule,
            &candidates(&rule).unwrap().0,
            &mut stable
        )
        .unwrap()
        .is_empty());
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }
}
