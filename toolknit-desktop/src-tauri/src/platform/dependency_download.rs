use std::{
    future::Future,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

pub(crate) const NETWORK_IDLE_TIMEOUT: Duration = Duration::from_secs(20);

// A deadline applies to each network wait, not the entire multi-GB transfer.
pub(crate) async fn network<T>(
    future: impl Future<Output = Result<T, reqwest::Error>>,
    cancel: &AtomicBool,
) -> Result<T, String> {
    network_with_timeout(future, cancel, NETWORK_IDLE_TIMEOUT).await
}

async fn network_with_timeout<T>(
    future: impl Future<Output = Result<T, reqwest::Error>>,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<T, String> {
    tokio::pin!(future);
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("dependency-download:cancelled".into());
        }
        tokio::select! {
            result = &mut future => return result.map_err(|_| "dependency-download:network".into()),
            _ = &mut deadline => return Err("dependency-download:timeout".into()),
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
    }
}

pub(crate) fn response_offset(
    response: &reqwest::Response,
    requested: u64,
    size: u64,
) -> Result<u64, String> {
    if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        let range = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .ok_or("dependency-download:range")?;
        validate_range(range, requested, size)?;
        if response
            .content_length()
            .is_some_and(|n| n != size - requested)
        {
            return Err("dependency-download:size".into());
        }
        Ok(requested)
    } else if response.status() == reqwest::StatusCode::OK {
        if response.content_length().is_some_and(|n| n != size) {
            return Err("dependency-download:size".into());
        }
        Ok(0)
    } else {
        Err(format!(
            "dependency-download:http:{}",
            response.status().as_u16()
        ))
    }
}

fn validate_range(value: &str, requested: u64, size: u64) -> Result<(), String> {
    let valid = value
        .strip_prefix("bytes ")
        .and_then(|s| s.split_once('/'))
        .and_then(|(span, total)| span.split_once('-').map(|(start, end)| (start, end, total)))
        .is_some_and(|(start, end, total)| {
            start.parse::<u64>().ok() == Some(requested)
                && end.parse::<u64>().ok() == size.checked_sub(1)
                && total.parse::<u64>().ok() == Some(size)
                && requested < size
        });
    if valid {
        Ok(())
    } else {
        Err("dependency-download:range".into())
    }
}

pub(crate) async fn verified_partial(path: &Path, size: u64, hash: &str) -> Result<bool, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err("dependency-download:storage".into());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err("dependency-download:storage".into());
                }
            }
            meta
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("dependency-download:storage".into()),
    };
    if metadata.len() == size {
        let path = path.to_owned();
        let expected = hash.to_owned();
        return tokio::task::spawn_blocking(move || {
            use sha2::{Digest, Sha256};
            use std::io::Read;
            let mut file = std::fs::File::open(&path).map_err(|_| "dependency-download:storage")?;
            let mut digest = Sha256::new();
            let mut buffer = [0; 64 * 1024];
            loop {
                let count = file
                    .read(&mut buffer)
                    .map_err(|_| "dependency-download:storage")?;
                if count == 0 {
                    break;
                }
                digest.update(&buffer[..count]);
            }
            if format!("{:x}", digest.finalize()) == expected {
                Ok(true)
            } else {
                std::fs::remove_file(path).map_err(|_| "dependency-download:storage")?;
                Ok(false)
            }
        })
        .await
        .map_err(|_| "dependency-download:verify")?;
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn read_request_headers(stream: &mut tokio::net::TcpStream) {
        use tokio::io::AsyncReadExt;
        tokio::time::timeout(Duration::from_secs(5), async {
            let mut request = Vec::new();
            let mut buffer = [0; 512];
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let count = stream.read(&mut buffer).await.unwrap();
                assert!(count > 0, "fixture request ended before its headers");
                request.extend_from_slice(&buffer[..count]);
                assert!(request.len() <= 8192, "fixture request headers are bounded");
            }
        }).await.expect("fixture request timed out");
    }

    async fn response_fixture(bytes: &'static [u8]) -> reqwest::Response {
        use tokio::io::AsyncWriteExt;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_request_headers(&mut stream).await;
            stream.write_all(bytes).await.unwrap();
        });
        let response = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/model"))
            .header(reqwest::header::RANGE, "bytes=2-")
            .send()
            .await
            .unwrap();
        server.await.unwrap();
        response
    }

    #[tokio::test]
    async fn http_resume_validates_partial_and_restarts_when_range_is_ignored() {
        let mut response = response_fixture(b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 2-3/4\r\nContent-Length: 2\r\nConnection: close\r\n\r\nod").await;
        assert_eq!(response_offset(&response, 2, 4).unwrap(), 2);
        assert_eq!(response.chunk().await.unwrap().unwrap().as_ref(), b"od");
        let mut response = response_fixture(
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ngood",
        )
        .await;
        assert_eq!(response_offset(&response, 2, 4).unwrap(), 0);
        assert_eq!(response.chunk().await.unwrap().unwrap().as_ref(), b"good");
        let response = response_fixture(b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-1/4\r\nContent-Length: 2\r\nConnection: close\r\n\r\ngo").await;
        assert_eq!(
            response_offset(&response, 2, 4).unwrap_err(),
            "dependency-download:range"
        );
    }

    #[tokio::test]
    async fn http_stalled_body_times_out_and_is_cancellable() {
        use tokio::io::AsyncWriteExt;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_request_headers(&mut stream).await;
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n")
                .await
                .unwrap();
            std::future::pending::<()>().await;
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut response = client
            .get(format!("http://{address}/model"))
            .send()
            .await
            .unwrap();
        let cancel = AtomicBool::new(false);
        assert_eq!(
            network_with_timeout(response.chunk(), &cancel, Duration::from_millis(20))
                .await
                .unwrap_err(),
            "dependency-download:timeout"
        );
        let trigger = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            cancel.store(true, Ordering::SeqCst);
        };
        let (result, _) = tokio::join!(network(response.chunk(), &cancel), trigger);
        assert_eq!(result.unwrap_err(), "dependency-download:cancelled");
        server.abort();
        let _ = server.await;
    }

    #[test]
    fn resumed_range_must_match_requested_offset_and_pinned_size() {
        assert!(validate_range("bytes 2-3/4", 2, 4).is_ok());
        for value in [
            "bytes 0-3/4",
            "bytes 2-3/5",
            "bytes 2-2/4",
            "bytes 2-3/*",
            "invalid",
        ] {
            assert!(validate_range(value, 2, 4).is_err());
        }
    }

    #[tokio::test]
    async fn stalled_network_and_mid_wait_cancellation_are_bounded() {
        let cancel = AtomicBool::new(false);
        assert_eq!(
            network_with_timeout(
                std::future::pending::<Result<(), reqwest::Error>>(),
                &cancel,
                Duration::from_millis(10)
            )
            .await
            .unwrap_err(),
            "dependency-download:timeout"
        );
        let trigger = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            cancel.store(true, Ordering::SeqCst);
        };
        let request = network(
            std::future::pending::<Result<(), reqwest::Error>>(),
            &cancel,
        );
        let (result, _) = tokio::join!(request, trigger);
        assert_eq!(result.unwrap_err(), "dependency-download:cancelled");
    }

    #[tokio::test]
    async fn complete_partial_is_verified_before_an_eof_range_request() {
        use sha2::{Digest, Sha256};
        let path =
            std::env::temp_dir().join(format!("toolknit-download-{}.part", std::process::id()));
        std::fs::write(&path, b"good").unwrap();
        let hash = format!("{:x}", Sha256::digest(b"good"));
        assert!(verified_partial(&path, 4, &hash).await.unwrap());
        std::fs::write(&path, b"oops").unwrap();
        assert!(!verified_partial(&path, 4, &hash).await.unwrap());
        assert!(!path.exists());
    }
}
