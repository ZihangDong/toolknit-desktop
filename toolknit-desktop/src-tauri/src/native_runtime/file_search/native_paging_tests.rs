use super::*;

pub(super) async fn verify(app: &tauri::AppHandle, fixture: &std::path::Path) -> Result<(), String> {
    let root = fixture.join("paging"); std::fs::create_dir(&root).map_err(|_| "paging:fixture")?;
    for n in 0..160 { std::fs::write(root.join(format!("page-{n:03}.txt")), b"fixture").map_err(|_| "paging:fixture")?; }
    service::configure(app, vec![root.to_string_lossy().into_owned()]).await?;
    wait_count(app, 160).await?;
    let query = query::Query { text:"page-".into(), sort:query::Sort::NameAsc, ..Default::default() };
    let first = service::search(app, 0, query.clone(), None).await?;
    assert_eq!(first["result"]["rows"].as_array().unwrap().len(), 50);
    let second = service::search(app, 0, query.clone(), Some(first["cursor"].clone())).await?;
    assert_eq!(second["result"]["rows"][0]["name"], "page-050.txt");
    // Both unrelated and matching mutations used to invalidate every cursor.
    std::fs::write(root.join("page-000-new.txt"), b"fixture").map_err(|_| "paging:fixture")?;
    std::fs::write(root.join("unrelated.txt"), b"fixture").map_err(|_| "paging:fixture")?;
    wait_count(app, 162).await?;
    let next = service::search(app, 0, query.clone(), Some(second["cursor"].clone())).await?;
    let rows = next["result"]["rows"].as_array().unwrap();
    assert_eq!(next["replace"], true); assert_eq!(rows.len(), 150);
    assert!(rows.iter().any(|row| row["name"] == "page-000-new.txt"));
    assert_eq!(rows.iter().map(|row| row["id"].as_str().unwrap()).collect::<std::collections::HashSet<_>>().len(), 150);
    let refreshed = service::search_window(app, 0, query.clone(), None, 150).await?;
    assert_eq!(refreshed["result"]["rows"].as_array().unwrap().len(), 150);
    // Deleting the pivot also rebases, instead of losing every later page.
    let pivot = refreshed["result"]["rows"].as_array().unwrap().last().unwrap()["name"].as_str().unwrap();
    std::fs::remove_file(root.join(pivot)).map_err(|_| "paging:fixture")?; wait_count(app, 161).await?;
    let final_page = service::search(app, 0, query, Some(refreshed["cursor"].clone())).await?;
    assert_eq!(final_page["replace"], true);
    assert_eq!(final_page["result"]["rows"].as_array().unwrap().len(), 160);
    assert!(final_page["cursor"].is_null());
    service::clear(app).await?;
    println!("WEBVIEW_PAGING live index changes and deleted pivots retain 100/150 loaded rows, append new files without duplicates, and refresh the retained range");
    Ok(())
}
async fn wait_count(app: &tauri::AppHandle, count: usize) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let status = service::status(app)?;
        if status["index"]["indexed"] == count && status["index"]["phase"] == "ready" { return Ok(()); }
        if Instant::now() > deadline { return Err("paging:index-timeout".into()); }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}
