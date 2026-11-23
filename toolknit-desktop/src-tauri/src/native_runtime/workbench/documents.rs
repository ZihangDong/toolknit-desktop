use super::*;
use rusqlite::params;
use std::collections::HashSet;

const EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "csv", "tsv", "json", "html", "htm", "pdf", "docx",
];
fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| EXTENSIONS.contains(&s.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub(super) fn scan(root: &Path) -> Result<Value, String> {
    let mut stack = vec![(root.to_path_buf(), 0)];
    let mut files = Vec::new();
    let mut visited = 0;
    let mut skipped = 0;
    let mut limited = false;
    while let Some((directory, depth)) = stack.pop() {
        if visited >= 20000 || files.len() >= 2000 {
            limited = true;
            break;
        }
        let listing = match std::fs::read_dir(directory) {
            Ok(list) => list,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        for entry in listing {
            visited += 1;
            if visited > 20000 || files.len() >= 2000 {
                limited = true;
                break;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.')
                || [
                    "node_modules",
                    "target",
                    "Windows",
                    "$RECYCLE.BIN",
                    "System Volume Information",
                ]
                .contains(&name.as_str())
            {
                continue;
            }
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    continue;
                } // reparse points never escape the selected tree
            }
            if meta.is_dir() {
                if depth < 16 {
                    stack.push((path, depth + 1));
                } else {
                    limited = true;
                }
            } else if meta.is_file() && supported(&path) {
                if meta.len() > 64 * 1024 * 1024 {
                    skipped += 1;
                    continue;
                }
                files.push(json!({"path":path.to_string_lossy(),"name":name,"bytes":meta.len(),"modified":modified_ms(&meta)}));
            }
        }
    }
    files.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    Ok(json!({"root":root.to_string_lossy(),"files":files,"skipped":skipped,"limited":limited}))
}

pub(super) fn dispatch(folder: &Path, request: Value) -> Result<Value, String> {
    let action = string(&request, "action")?;
    if action == "scan" {
        return scan(&canonical_directory(string(&request, "root")?)?);
    }
    if action == "inspect" {
        let paths = request["paths"]
            .as_array()
            .ok_or("Invalid file selection")?;
        if paths.len() > 2000 {
            return Err("Maximum 2000 documents".into());
        }
        let mut files = Vec::new();
        for value in paths {
            let path = Path::new(value.as_str().ok_or("Invalid document path")?)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            if !meta.is_file() || !supported(&path) || meta.len() > 64 * 1024 * 1024 {
                return Err("Unsupported document or file exceeds 64 MB".into());
            }
            files.push(json!({"root":path.parent().ok_or("Invalid document parent")?.to_string_lossy(),"path":path.to_string_lossy(),"name":path.file_name().unwrap_or_default().to_string_lossy(),"bytes":meta.len(),"modified":modified_ms(&meta)}));
        }
        return Ok(json!(files));
    }
    let mut connection = db(folder)?;
    match action {
        "status" => {
            let count: i64 = connection
                .query_row("SELECT count(*) FROM documents", [], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            let mut stmt = connection
                .prepare("SELECT DISTINCT root FROM documents ORDER BY root")
                .map_err(|e| e.to_string())?;
            let roots = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(json!({"count":count,"roots":roots}))
        }
        "known" => {
            let root = canonical_directory(string(&request, "root")?)?
                .to_string_lossy()
                .into_owned();
            let mut stmt = connection
                .prepare("SELECT path,bytes,modified FROM documents WHERE root=?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([root], |row| Ok(json!({"path":row.get::<_,String>(0)?,"bytes":row.get::<_,u64>(1)?,"modified":row.get::<_,u64>(2)?}))).map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
            Ok(json!(rows))
        }
        "put" => {
            let root = canonical_directory(string(&request, "root")?)?;
            let path = Path::new(string(&request, "path")?)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if !path.starts_with(&root) || !supported(&path) || !path.is_file() {
                return Err("Document is outside the selected folder".into());
            }
            let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            if Some(meta.len()) != request["bytes"].as_u64()
                || Some(modified_ms(&meta)) != request["modified"].as_u64()
            {
                return Err("Document changed during indexing; scan again".into());
            }
            let text = request["text"].as_str().ok_or("Invalid document text")?;
            if text.len() > 1_000_000 {
                return Err("Extracted document text exceeds index budget".into());
            }
            let count: u64 = connection
                .query_row(
                    "SELECT count(*) FROM documents WHERE path<>?1",
                    [path.to_string_lossy().as_ref()],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if count >= 5000 {
                return Err("Index limit reached (5000 documents); clear the index first".into());
            }
            connection.execute("INSERT OR REPLACE INTO documents(path,root,name,bytes,modified,text,truncated) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![path.to_string_lossy(),root.to_string_lossy(),path.file_name().unwrap_or_default().to_string_lossy(),meta.len(),modified_ms(&meta),text,request["truncated"].as_bool().unwrap_or(false)])
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "remove" => {
            connection
                .execute(
                    "DELETE FROM documents WHERE path=?1",
                    [string(&request, "path")?],
                )
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "finalize" => {
            let root = canonical_directory(string(&request, "root")?)?
                .to_string_lossy()
                .into_owned();
            let paths: HashSet<String> = request["paths"]
                .as_array()
                .ok_or("Invalid paths")?
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            let existing = {
                let mut stmt = connection
                    .prepare("SELECT path FROM documents WHERE root=?1")
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([&root], |row| row.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
            };
            let transaction = connection.transaction().map_err(|e| e.to_string())?;
            for path in existing {
                if !paths.contains(&path) {
                    transaction
                        .execute("DELETE FROM documents WHERE path=?1", [path])
                        .map_err(|e| e.to_string())?;
                }
            }
            transaction.commit().map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "search" => {
            let query = string(&request, "query")?.trim();
            if query.chars().count() < 2 || query.chars().count() > 200 {
                return Err("Search needs 2–200 characters".into());
            }
            let mut stmt = connection.prepare("SELECT path,name,substr(text,max(1,instr(lower(text),lower(?1))-70),220),truncated FROM documents WHERE instr(lower(text),lower(?1))>0 OR instr(lower(name),lower(?1))>0 ORDER BY instr(lower(name),lower(?1))>0 DESC,name LIMIT 101").map_err(|e| e.to_string())?;
            let mut rows = stmt.query_map([query], |row| Ok(json!({"path":row.get::<_,String>(0)?,"name":row.get::<_,String>(1)?,"snippet":row.get::<_,String>(2)?,"truncated":row.get::<_,bool>(3)?}))).map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
            let limited = rows.len() > 100;
            rows.truncate(100);
            Ok(json!({"results":rows,"limited":limited}))
        }
        "clear" => {
            connection
                .execute("DELETE FROM documents", [])
                .map_err(|e| e.to_string())?;
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        _ => Err("Unknown document index action".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn index_survives_connections_and_treats_queries_literally() {
        let folder = std::env::temp_dir().join(format!(
            "toolknit-content-{}",
            super::super::folders::next_id()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("测试.txt");
        std::fs::write(&file, "中文合同 100% _ details").unwrap();
        let meta = std::fs::metadata(&file).unwrap();
        dispatch(&folder,json!({"action":"put","root":folder,"path":file,"bytes":meta.len(),"modified":modified_ms(&meta),"text":"中文合同 100% _ details"})).unwrap();
        let result = dispatch(&folder, json!({"action":"search","query":"中文"})).unwrap();
        assert_eq!(result["results"].as_array().unwrap().len(), 1);
        assert_eq!(
            dispatch(&folder, json!({"action":"search","query":"%%"})).unwrap()["results"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        dispatch(
            &folder,
            json!({"action":"finalize","root":folder,"paths":[]}),
        )
        .unwrap();
        assert_eq!(
            dispatch(&folder, json!({"action":"status"})).unwrap()["count"],
            0
        );
        std::fs::remove_dir_all(folder).unwrap();
    }
}
