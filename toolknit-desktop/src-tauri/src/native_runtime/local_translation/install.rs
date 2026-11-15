use super::*;
use crate::platform::dependency_download;
use std::io::{Read, Write};
use tokio::io::AsyncWriteExt;

async fn network<T>(future: impl std::future::Future<Output = Result<T, reqwest::Error>>, cancel: &AtomicBool, timeout: Duration) -> Result<T, String> {
    cancellable(tokio::time::timeout(timeout, future), cancel).await?
        .map_err(|_| "translation:download")?.map_err(|_| "translation:download".into())
}

async fn download(client: &reqwest::Client, url: &str, source: &str, path: &Path, size: u64, hash: &str, state: &TranslationState, received: &mut u64, report: &impl Fn(Progress)) -> Result<(), String> {
    check_cancel(&state.install_cancel)?;
    if regular_size(path,size) && hash_file(path).await? == hash {
        *received+=size;report(Progress{phase:"download".into(),received:*received,total:DOWNLOAD_BYTES,source:source.into()});return Ok(());
    }
    let part=path.with_extension("part");
    let metadata = match std::fs::symlink_metadata(&part) {
        Ok(meta) => {
            if !regular_size(&part, meta.len()) { return Err("translation:storage".into()); }
            Some(meta)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err("translation:storage".into()),
    };
    let mut count=metadata.map(|m|m.len()).unwrap_or(0);
    if count > size || (count == size && hash_file(&part).await? != hash) {
        std::fs::remove_file(&part).map_err(|_|"translation:storage")?;
        count=0;
    }
    if count < size {
    let mut request=client.get(url);
    if count>0 { request=request.header(reqwest::header::RANGE,format!("bytes={count}-")); }
    let mut response=network(request.send(), &state.install_cancel, Duration::from_secs(20)).await?;
    count=dependency_download::response_offset(&response,count,size).map_err(|_|"translation:download")?;
    let mut output=tokio::fs::OpenOptions::new().create(true).write(true)
        .append(count>0).truncate(count==0).open(&part).await.map_err(|_|"translation:storage")?;
    let mut last_report=Instant::now();
    while let Some(chunk)=network(response.chunk(), &state.install_cancel, Duration::from_secs(20)).await? {
        check_cancel(&state.install_cancel)?;count+=chunk.len() as u64;
        if count>size{return Err("translation:download".into());}
        output.write_all(&chunk).await.map_err(|_|"translation:storage")?;
        if last_report.elapsed() >= Duration::from_millis(100) || count == size {
            report(Progress{phase:"download".into(),received:*received+count,total:DOWNLOAD_BYTES,source:source.into()});
            last_report=Instant::now();
        }
    }
    output.flush().await.map_err(|_|"translation:storage")?;drop(output);
    }
    if count!=size { return Err("translation:download".into()); }
    if hash_file(&part).await?!=hash {
        std::fs::remove_file(&part).map_err(|_|"translation:storage")?;
        return Err("translation:checksum".into());
    }
    check_cancel(&state.install_cancel)?;
    if path.exists(){std::fs::remove_file(path).map_err(|_|"translation:storage")?;}
    std::fs::rename(part,path).map_err(|_|"translation:storage")?;
    *received+=count;Ok(())
}

async fn download_candidates(client: &reqwest::Client, candidates: &[(&str, String)], path: &Path, size: u64, hash: &str, state: &TranslationState, received: &mut u64, report: &impl Fn(Progress)) -> Result<(), String> {
    let mut last_error = "translation:download".to_string();
    for (source, url) in candidates {
        check_cancel(&state.install_cancel)?;
        report(Progress{phase:"download".into(),received:*received,total:DOWNLOAD_BYTES,source:(*source).into()});
        match download(client,url,source,path,size,hash,state,received,report).await {
            Ok(()) => return Ok(()),
            Err(error) if matches!(error.as_str(), "translation:download" | "translation:checksum") => last_error=error,
            Err(error) => return Err(error),
        }
    }
    Err(last_error)
}

pub(super) async fn install(root: &Path,state: &TranslationState,source: DownloadSource,report: impl Fn(Progress)) -> Result<(),String> {
    safe_dir(root)?;
    let staging=root.join("staging-4.0.33");safe_dir(&staging)?;
    let cache=root.join("downloads-4.0.33");safe_dir(&cache)?;
    let client=reqwest::Client::builder().https_only(true).redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(20)).build().map_err(|_|"translation:download")?;
    let mut received=0;
    download_candidates(&client,&source.candidates(),&cache.join(ENGINE_NAME),ENGINE_BYTES,ENGINE_HASH,state,&mut received,&report).await?;
    std::fs::copy(cache.join(ENGINE_NAME),staging.join(ENGINE_NAME)).map_err(|_|"translation:storage")?;
    for record in records() {
        let source=cache.join(&record.attachment.filename);
        let url=dependency_download::resource_url(&format!("translation/4.0.33/models/{}",record.attachment.filename));
        download_candidates(&client,&[("7caiyun",url.clone()),("7caiyun",url)],&source,record.attachment.size,&record.attachment.hash,state,&mut received,&report).await?;
        check_cancel(&state.install_cancel)?;
        report(Progress{phase:"verify".into(),received,total:DOWNLOAD_BYTES,source:"7caiyun".into()});
        let destination=model_path(&staging,&record);
        safe_dir(destination.parent().ok_or("translation:storage")?)?;
        let limit=record.decompressed_size;
        let hash=record.decompressed_hash;
        tokio::task::spawn_blocking(move || -> Result<(),String> {
            let input=std::fs::File::open(source).map_err(|_|"translation:storage")?;
            let mut decoder=zstd::stream::read::Decoder::new(input).map_err(|_|"translation:checksum")?.take(limit+1);
            let part=destination.with_extension("unpacked");
            let mut file=std::fs::File::create(&part).map_err(|_|"translation:storage")?;
            let count=std::io::copy(&mut decoder,&mut file).map_err(|_|"translation:checksum")?;
            file.flush().map_err(|_|"translation:storage")?;drop(file);
            if count!=limit||sha256_file(&part)?!=hash{return Err("translation:checksum".into());}
            if destination.exists(){std::fs::remove_file(&destination).map_err(|_|"translation:storage")?;}
            std::fs::rename(part,destination).map_err(|_|"translation:storage".into())
        }).await.map_err(|_|"translation:checksum")??;
    }
    check_cancel(&state.install_cancel)?;
    safe_dir(&staging.join("config"))?;
    std::fs::write(staging.join("config/records.json"),RECORDS).map_err(|_|"translation:storage")?;
    report(Progress{phase:"testing".into(),received,total:DOWNLOAD_BYTES,source:String::new()});
    process::smoke(&staging,&state.install_cancel).await?;
    check_cancel(&state.install_cancel)?;
    std::fs::write(staging.join("ready"),ENGINE_HASH).map_err(|_|"translation:storage")?;
    let mut engine=state.engine.lock().await;*engine=None;
    let destination=installed(root);
    let backup=root.join("previous-4.0.33");
    if backup.exists(){safe_dir(&backup)?;std::fs::remove_dir_all(&backup).map_err(|_|"translation:storage")?;}
    if destination.exists(){safe_dir(&destination)?;std::fs::rename(&destination,&backup).map_err(|_|"translation:storage")?;}
    if std::fs::rename(&staging,&destination).is_err(){if backup.exists(){let _=std::fs::rename(&backup,&destination);}return Err("translation:storage".into());}
    if backup.exists(){let _=std::fs::remove_dir_all(backup);}
    // Validated downloads are retained after a failure, but a completed installation needs no duplicate cache.
    let _=std::fs::remove_dir_all(cache);
    report(Progress{phase:"ready".into(),received,total:DOWNLOAD_BYTES,source:String::new()});Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[tokio::test]
    async fn translation_resumes_partial_and_reuses_completed_partial() {
        use tokio::io::AsyncReadExt;
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address=listener.local_addr().unwrap();
        let server=tokio::spawn(async move {
            let (mut stream,_)=listener.accept().await.unwrap();
            let mut request=[0;2048];
            let n=stream.read(&mut request).await.unwrap();
            assert!(String::from_utf8_lossy(&request[..n]).to_lowercase().contains("range: bytes=2-"));
            stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 2-3/4\r\nContent-Length: 2\r\nConnection: close\r\n\r\nod").await.unwrap();
        });
        let root=std::env::temp_dir().join(format!("toolknit-translation-resume-{}",std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path=root.join("engine");
        let hash=format!("{:x}",Sha256::digest(b"good"));
        let client=reqwest::Client::builder().no_proxy().build().unwrap();
        let state=TranslationState::default();
        let mut received=0;
        std::fs::write(path.with_extension("part"),b"go").unwrap();
        download(&client,&format!("http://{address}/good"),"test",&path,4,&hash,&state,&mut received,&|_|{}).await.unwrap();
        server.await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(),b"good");
        assert_eq!(received,4);
        std::fs::remove_file(&path).unwrap();
        std::fs::write(path.with_extension("part"),b"good").unwrap();
        download(&client,"http://127.0.0.1:1/unreachable","test",&path,4,&hash,&state,&mut received,&|_|{}).await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(),b"good");
        assert_eq!(received,8);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn translation_download_fallback_cache_and_failure_boundaries() {
        use tokio::io::AsyncReadExt;
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address=listener.local_addr().unwrap();
        let hits=Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count=hits.clone();
        let server=tokio::spawn(async move {
            loop {
                let (mut stream,_)=listener.accept().await.unwrap();
                let mut request=[0u8;2048];
                let n=stream.read(&mut request).await.unwrap();
                count.fetch_add(1,Ordering::SeqCst);
                let request=String::from_utf8_lossy(&request[..n]);
                let response=if request.starts_with("GET /good ") {
                    "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ngood"
                } else if request.starts_with("GET /corrupt ") {
                    "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\noops"
                } else {
                    "HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                };
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root=std::env::temp_dir().join(format!("toolknit-translation-download-{}-{stamp}",std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let path=root.join("engine");
        let hash=format!("{:x}",Sha256::digest(b"good"));
        let client=reqwest::Client::builder().no_proxy().build().unwrap();
        let candidates=|first:&str|vec![("official",format!("http://{address}/{first}")),("accelerated",format!("http://{address}/good"))];
        let state=TranslationState::default();
        let progress=Mutex::new(Vec::new());
        let report=|p|lock(&progress).push(p);
        let mut received=10;
        download_candidates(&client,&candidates("unavailable"),&path,4,&hash,&state,&mut received,&report).await.unwrap();
        assert_eq!(received,14);
        assert_eq!(std::fs::read(&path).unwrap(),b"good");
        assert_eq!(hits.load(Ordering::SeqCst),2);
        assert!(lock(&progress).iter().any(|p|p.source=="accelerated"));
        download_candidates(&client,&candidates("unavailable"),&path,4,&hash,&state,&mut received,&report).await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst),2,"verified cache avoids the network");
        std::fs::remove_file(&path).unwrap();
        download_candidates(&client,&candidates("corrupt"),&path,4,&hash,&state,&mut received,&report).await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst),4,"checksum failure falls back without publishing corrupt bytes");
        std::fs::remove_file(&path).unwrap();
        assert_eq!(download_candidates(&client,&[("official",format!("http://{address}/corrupt"))],&path,4,&hash,&state,&mut received,&report).await.unwrap_err(),"translation:checksum");
        assert!(!path.exists());
        assert_eq!(received,22,"failed attempts do not inflate committed progress");
        state.install_cancel.store(true,Ordering::Relaxed);
        assert_eq!(download_candidates(&client,&candidates("good"),&path,4,&hash,&state,&mut received,&report).await.unwrap_err(),"translation:cancelled");
        assert_eq!(hits.load(Ordering::SeqCst),5);
        state.install_cancel.store(false,Ordering::Relaxed);
        assert_eq!(download_candidates(&client,&candidates("good"),&root.join("missing/engine"),4,&hash,&state,&mut received,&report).await.unwrap_err(),"translation:storage");
        assert_eq!(hits.load(Ordering::SeqCst),6,"storage errors never trigger a second network attempt");
        server.abort();let _=server.await;
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn translation_network_idle_timeout_and_cancel() {
        let cancel=AtomicBool::new(false);
        assert_eq!(network(std::future::pending::<Result<(),reqwest::Error>>(),&cancel,Duration::from_millis(10)).await.unwrap_err(),"translation:download");
        cancel.store(true,Ordering::Relaxed);
        assert_eq!(network(std::future::pending::<Result<(),reqwest::Error>>(),&cancel,Duration::from_secs(20)).await.unwrap_err(),"translation:cancelled");
    }

    #[tokio::test]
    async fn translation_network_timeout_restarts_for_each_active_chunk() {
        let cancel=AtomicBool::new(false);
        let start=Instant::now();
        for _ in 0..3 {
            network(async { tokio::time::sleep(Duration::from_millis(50)).await; Ok::<_,reqwest::Error>(()) },&cancel,Duration::from_millis(100)).await.unwrap();
        }
        assert!(start.elapsed() >= Duration::from_millis(100));
    }
}
