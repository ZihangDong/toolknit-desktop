use super::identity::{self, wide, Descriptor, Handle};
use std::{
    io::{self, Read, Write},
    mem::size_of,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{ERROR_BROKEN_PIPE, ERROR_IO_PENDING, ERROR_PIPE_CONNECTED, HANDLE},
        Security::SECURITY_ATTRIBUTES,
        Storage::FileSystem::*,
        System::{
            Pipes::*,
            Threading::{CreateEventW, OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
            IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED},
        },
    },
};

pub(super) struct Pipe {
    pub handle: Handle,
    pub stop: Arc<AtomicBool>,
    pub peer: Option<Handle>,
}
fn error(kind: io::ErrorKind) -> io::Error {
    io::Error::new(kind, "local search service I/O")
}
impl Pipe {
    fn wait(&self, event: HANDLE, operation: &OVERLAPPED) -> io::Result<usize> {
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            let stopped = self.stop.load(Ordering::Acquire)
                || self
                    .peer
                    .as_ref()
                    .is_some_and(|p| unsafe { WaitForSingleObject(p.0, 0) }.0 == 0);
            if stopped || Instant::now() > deadline {
                unsafe {
                    let _ = CancelIoEx(self.handle.0, Some(operation));
                    let mut ignored = 0;
                    let _ = GetOverlappedResult(self.handle.0, operation, &mut ignored, true);
                }
                return Err(error(if stopped {
                    // read_exact/write_all retry Interrupted automatically.
                    // Cancellation is terminal, otherwise they spin forever.
                    io::ErrorKind::ConnectionAborted
                } else {
                    io::ErrorKind::TimedOut
                }));
            }
            match unsafe { WaitForSingleObject(event, 100) }.0 {
                0 => {
                    let mut bytes = 0;
                    unsafe { GetOverlappedResult(self.handle.0, operation, &mut bytes, false) }
                        .map_err(|_| error(io::ErrorKind::BrokenPipe))?;
                    return Ok(bytes as usize);
                }
                258 => {}
                _ => {
                    unsafe {
                        let _ = CancelIoEx(self.handle.0, Some(operation));
                        let mut ignored = 0;
                        let _ = GetOverlappedResult(self.handle.0, operation, &mut ignored, true);
                    }
                    return Err(error(io::ErrorKind::BrokenPipe));
                }
            }
        }
    }
    pub fn watch_peer(&mut self, pid: u32) -> Result<(), String> {
        self.peer = Some(Handle(
            unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }
                .map_err(|_| "file-search:identity")?,
        ));
        Ok(())
    }
    pub fn cancelled(&self) -> bool {
        self.stop.load(Ordering::Acquire)
            || self
                .peer
                .as_ref()
                .is_some_and(|p| unsafe { WaitForSingleObject(p.0, 0) }.0 == 0)
    }
}
impl Read for Pipe {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        if self.cancelled() {
            return Err(error(io::ErrorKind::ConnectionAborted));
        }
        let event = Handle(
            unsafe { CreateEventW(None, true, false, PCWSTR::null()) }
                .map_err(|_| error(io::ErrorKind::Other))?,
        );
        let mut operation = OVERLAPPED {
            hEvent: event.0,
            ..Default::default()
        };
        let mut bytes = 0;
        match unsafe {
            ReadFile(
                self.handle.0,
                Some(buffer),
                Some(&mut bytes),
                Some(&mut operation),
            )
        } {
            Ok(()) => Ok(bytes as usize),
            Err(e) if e.code() == ERROR_IO_PENDING.to_hresult() => self.wait(event.0, &operation),
            Err(e) if e.code() == ERROR_BROKEN_PIPE.to_hresult() => Ok(0),
            Err(_) => Err(error(io::ErrorKind::BrokenPipe)),
        }
    }
}
impl Write for Pipe {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        if self.cancelled() {
            return Err(error(io::ErrorKind::ConnectionAborted));
        }
        let event = Handle(
            unsafe { CreateEventW(None, true, false, PCWSTR::null()) }
                .map_err(|_| error(io::ErrorKind::Other))?,
        );
        let mut operation = OVERLAPPED {
            hEvent: event.0,
            ..Default::default()
        };
        let mut bytes = 0;
        match unsafe {
            WriteFile(
                self.handle.0,
                Some(buffer),
                Some(&mut bytes),
                Some(&mut operation),
            )
        } {
            Ok(()) => Ok(bytes as usize),
            Err(e) if e.code() == ERROR_IO_PENDING.to_hresult() => self.wait(event.0, &operation),
            Err(_) => Err(error(io::ErrorKind::BrokenPipe)),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub(super) fn accept(sid: &str, stop: Arc<AtomicBool>) -> Result<Pipe, String> {
    accept_named(sid, &identity::pipe_name(sid)?, stop)
}
fn accept_named(sid: &str, name: &str, stop: Arc<AtomicBool>) -> Result<Pipe, String> {
    let descriptor =
        Descriptor::from_sddl(&format!("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;{sid})"))?;
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0 .0,
        bInheritHandle: false.into(),
    };
    let name = wide(name);
    let handle = unsafe {
        CreateNamedPipeW(
            PCWSTR(name.as_ptr()),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            512 * 1024,
            512 * 1024,
            0,
            Some(&security),
        )
    };
    if handle.is_invalid() {
        return Err("file-search:service-pipe".into());
    }
    let pipe = Pipe {
        handle: Handle(handle),
        stop,
        peer: None,
    };
    let event = Handle(
        unsafe { CreateEventW(None, true, false, PCWSTR::null()) }
            .map_err(|_| "file-search:service-pipe")?,
    );
    let mut operation = OVERLAPPED {
        hEvent: event.0,
        ..Default::default()
    };
    match unsafe { ConnectNamedPipe(pipe.handle.0, Some(&mut operation)) } {
        Ok(()) => {}
        Err(e) if e.code() == ERROR_PIPE_CONNECTED.to_hresult() => {}
        Err(e) if e.code() == ERROR_IO_PENDING.to_hresult() => {
            pipe.wait(event.0, &operation)
                .map_err(|_| "file-search:service-timeout")?;
        }
        Err(_) => return Err("file-search:service-pipe".into()),
    }
    Ok(pipe)
}
pub(super) fn connect(sid: &str, stop: Arc<AtomicBool>) -> Result<Pipe, String> {
    connect_named(&identity::pipe_name(sid)?, stop)
}
fn connect_named(name: &str, stop: Arc<AtomicBool>) -> Result<Pipe, String> {
    let name = wide(name);
    let deadline = Instant::now() + Duration::from_secs(12);
    loop {
        if stop.load(Ordering::Acquire) {
            return Err("file-search:cancelled".into());
        }
        let opened = unsafe {
            CreateFileW(
                PCWSTR(name.as_ptr()),
                0xC0000000,
                FILE_SHARE_MODE(0),
                None,
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED
                    | FILE_FLAGS_AND_ATTRIBUTES(
                        SECURITY_SQOS_PRESENT.0 | SECURITY_IDENTIFICATION.0,
                    ),
                HANDLE::default(),
            )
        };
        if let Ok(handle) = opened {
            // Identification-level token only: the server can AccessCheck it,
            // but cannot execute arbitrary operations as the desktop account.
            return Ok(Pipe {
                handle: Handle(handle),
                stop,
                peer: None,
            });
        }
        if Instant::now() > deadline {
            return Err("file-search:service-disconnected".into());
        }
        std::thread::sleep(Duration::from_millis(80));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_runtime::file_search::protocol::{self, Request, Response};
    #[test]
    fn real_identification_pipe_checks_account_and_cancels_pending_read() {
        if std::env::var_os("TOOLKNIT_FILE_SEARCH_PIPE_TEST").is_none() {
            let mut child=std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact","native_runtime::file_search::accelerator::pipe::tests::real_identification_pipe_checks_account_and_cancels_pending_read","--nocapture","--test-threads=1"])
                .env("TOOLKNIT_FILE_SEARCH_PIPE_TEST","1").stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
            let deadline = Instant::now() + Duration::from_secs(20);
            while child.try_wait().unwrap().is_none() {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    break;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "pipe cancellation exceeded deadline or failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        let sid = identity::current_sid().unwrap();
        let name = format!(
            "{}_test_{}",
            identity::pipe_name(&sid).unwrap(),
            std::process::id()
        );
        let server_stop = Arc::new(AtomicBool::new(false));
        let done = server_stop.clone();
        let server_name = name.clone();
        let server = std::thread::spawn(move || {
            let mut pipe = accept_named(&sid, &server_name, done).unwrap();
            let hello = protocol::read_frame::<Request>(&mut pipe).unwrap();
            hello.validate().unwrap();
            let token = super::super::access::client_token(pipe.handle.0, &sid).unwrap();
            assert_eq!(identity::sid_of(token.0).unwrap(), sid);
            assert!(
                super::super::access::client_token(pipe.handle.0, "S-1-5-21-999999999").is_err()
            );
            protocol::write_frame(
                &mut pipe,
                &Response::Ready {
                    version: protocol::VERSION,
                    nonce: "fixture".into(),
                },
            )
            .unwrap();
            let started = Instant::now();
            let result = protocol::read_frame::<Request>(&mut pipe);
            assert!(result.is_err());
            assert!(started.elapsed() < Duration::from_secs(3));
        });
        let mut client = connect_named(&name, Arc::new(AtomicBool::new(false))).unwrap();
        protocol::write_frame(
            &mut client,
            &Request::Hello {
                version: protocol::VERSION,
                process: std::process::id(),
                nonce: "0123456789abcdef0123456789abcdef".into(),
            },
        )
        .unwrap();
        assert!(matches!(
            protocol::read_frame::<Response>(&mut client).unwrap(),
            Response::Ready { .. }
        ));
        server_stop.store(true, Ordering::Release);
        server.join().unwrap();
        let mut byte = [0];
        assert_eq!(client.read(&mut byte).unwrap_or(0), 0);
    }
}
