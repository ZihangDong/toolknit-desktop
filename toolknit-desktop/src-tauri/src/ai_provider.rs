const AI_PROVIDER_MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const AI_PROVIDER_MAX_MESSAGES: usize = 12;
const AI_PROVIDER_MAX_MESSAGE_CHARS: usize = 50_000;
const AI_PROVIDER_MAX_MULTIMODAL_BYTES: usize = 8 * 1024 * 1024;
const AI_PROVIDER_MAX_TOKENS: u32 = 16_384;
const AI_PROVIDER_MAX_TIMEOUT_MS: u64 = 180_000;
const AI_DIAGNOSTIC_MAX_BYTES: usize = 32 * 1024;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct AiProviderNativeMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AiProviderNativeRequest {
    url: String,
    api_key: String,
    model: String,
    messages: Vec<AiProviderNativeMessage>,
    max_tokens: Option<u32>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    reasoning_effort: Option<String>,
    #[serde(default)]
    allow_private_http: bool,
    #[serde(default)]
    diagnostics: bool,
    #[serde(default)]
    request_id: Option<String>,
}

#[derive(serde::Serialize)]
pub(super) struct AiProviderNativeResponse {
    content: String,
}

fn is_private_ipv4_address(value: std::net::Ipv4Addr) -> bool {
    let [first, second, _, _] = value.octets();
    first == 10 || (first == 172 && (16..=31).contains(&second)) || (first == 192 && second == 168)
}

fn is_private_ipv6_address(value: std::net::Ipv6Addr) -> bool {
    value.octets()[0] & 0xfe == 0xfc
}

fn validate_endpoint(raw_url: &str, allow_private_http: bool) -> Result<url::Url, String> {
    if raw_url.len() > 2048 {
        return Err("ai-provider:invalid_config".to_string());
    }
    let endpoint =
        url::Url::parse(raw_url).map_err(|_| "ai-provider:invalid_config".to_string())?;
    if !matches!(endpoint.scheme(), "http" | "https")
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.fragment().is_some()
    {
        return Err("ai-provider:invalid_config".to_string());
    }
    let is_loopback = match endpoint.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    let is_private = match endpoint.host() {
        Some(url::Host::Ipv4(address)) => is_private_ipv4_address(address),
        Some(url::Host::Ipv6(address)) => is_private_ipv6_address(address),
        _ => false,
    };
    if endpoint.scheme() == "https" || is_loopback || (allow_private_http && is_private) {
        Ok(endpoint)
    } else {
        Err("ai-provider:invalid_config".to_string())
    }
}

fn valid_image_part(part: &serde_json::Value) -> bool {
    let Some(image) = part.get("image_url") else { return false; };
    let Some(url) = image.get("url").and_then(serde_json::Value::as_str) else { return false; };
    let Some((header, data)) = url.split_once(',') else { return false; };
    let detail_valid = image.get("detail").is_none_or(|detail| matches!(detail.as_str(), Some("auto" | "low" | "high")));
    matches!(header, "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64")
        && !data.is_empty() && data.len() % 4 == 0 && url.len() <= AI_PROVIDER_MAX_MULTIMODAL_BYTES
        && data.len() - data.trim_end_matches('=').len() <= 2
        && data.trim_end_matches('=').bytes().all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
        && detail_valid
}

fn validate_native_request(request: &AiProviderNativeRequest) -> Result<url::Url, String> {
    let endpoint = validate_endpoint(&request.url, request.allow_private_http)?;
    let api_key = request.api_key.trim();
    let model = request.model.trim();
    if api_key.is_empty()
        || api_key.chars().count() > 8192
        || api_key.chars().any(char::is_control)
        || model.is_empty()
        || model.chars().count() > 256
        || request.messages.is_empty()
        || request.messages.len() > AI_PROVIDER_MAX_MESSAGES
        || request
            .max_tokens
            .is_some_and(|value| value == 0 || value > AI_PROVIDER_MAX_TOKENS)
        || request.timeout_ms.is_some_and(|value| value == 0 || value > AI_PROVIDER_MAX_TIMEOUT_MS)
        || request.reasoning_effort.as_deref().is_some_and(|value| !matches!(value, "low" | "high" | "max"))
    {
        return Err("ai-provider:invalid_request".to_string());
    }
    let mut image_content_bytes: usize = 0;
    for message in &request.messages {
        let content_valid = match &message.content {
            serde_json::Value::String(value) => value.chars().count() <= AI_PROVIDER_MAX_MESSAGE_CHARS,
            serde_json::Value::Array(parts) => {
                let bytes = serde_json::to_vec(parts).map(|value| value.len()).unwrap_or(usize::MAX);
                image_content_bytes = image_content_bytes.saturating_add(bytes);
                bytes <= AI_PROVIDER_MAX_MULTIMODAL_BYTES
                    && message.role == "user"
                    && !parts.is_empty()
                    && parts.len() <= 8
                    && parts.iter().filter_map(|part| part.get("text").and_then(serde_json::Value::as_str)).map(|text| text.chars().count()).sum::<usize>() <= AI_PROVIDER_MAX_MESSAGE_CHARS
                    && parts.iter().all(|part| {
                        let Some(kind) = part.get("type").and_then(serde_json::Value::as_str) else { return false; };
                        match kind {
                            "text" => part.get("text").and_then(serde_json::Value::as_str)
                                .is_some_and(|value| value.chars().count() <= AI_PROVIDER_MAX_MESSAGE_CHARS),
                            "image_url" => valid_image_part(part),
                            _ => false,
                        }
                    })
            }
            _ => false,
        };
        if !matches!(message.role.as_str(), "system" | "user" | "assistant") || !content_valid || image_content_bytes > AI_PROVIDER_MAX_MULTIMODAL_BYTES {
            return Err("ai-provider:invalid_request".to_string());
        }
    }
    Ok(endpoint)
}

fn request_body(request: &AiProviderNativeRequest, endpoint: &url::Url) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": request.model.trim(),
        "messages": request.messages,
        "temperature": 0.7,
        "stream": false,
    });
    if let Some(max_tokens) = request.max_tokens {
        body["max_tokens"] = serde_json::json!(max_tokens);
    }
    let models: &[&str] = match endpoint.host_str() {
        Some("open.bigmodel.cn") => &["glm-5.3", "glm-5.3-flash"],
        Some("api.deepseek.com") => &["deepseek-v4-pro", "deepseek-v4-flash"],
        _ => &[],
    };
    if models.iter().any(|model| request.model.trim().eq_ignore_ascii_case(model)) {
        body["reasoning_effort"] = serde_json::json!(request.reasoning_effort.as_deref().unwrap_or("low"));
    }
    body
}

fn provider_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() { "ai-provider:timeout" } else { "ai-provider:network_error" }.to_string()
}

fn diagnostics_enabled(request: &AiProviderNativeRequest) -> bool {
    request.diagnostics && cfg!(any(debug_assertions, feature = "qa-devtools"))
}

fn diagnostic_error(code: String, request: &AiProviderNativeRequest, detail: serde_json::Value) -> String {
    if diagnostics_enabled(request) {
        // Local QA IPC only. The frontend projects and redacts this envelope
        // before constructing an Error or writing anything to the console.
        format!("{code}:diagnostic:{detail}")
    } else {
        code
    }
}

fn request_network_error(error: reqwest::Error, request: &AiProviderNativeRequest) -> String {
    let reason = if error.is_timeout() { "timeout" } else if error.is_connect() { "connect" } else { "network_error" };
    diagnostic_error(provider_network_error(error), request, serde_json::json!({"stage":"request", "reason":reason}))
}

async fn error_response_diagnostics(response: &mut reqwest::Response) -> serde_json::Value {
    let mut detail = serde_json::json!({
        "stage":"response_body",
        "contentType":response.headers().get("content-type").and_then(|value| value.to_str().ok()),
        "requestId":response.headers().get("x-request-id").or_else(|| response.headers().get("request-id")).and_then(|value| value.to_str().ok())
    });
    if response.content_length().is_some_and(|length| length > AI_DIAGNOSTIC_MAX_BYTES as u64) {
        detail["truncated"] = true.into();
        detail["reason"] = "body_too_large".into();
        return detail;
    }
    let read = async {
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "body_read_failed")? {
            if bytes.len().saturating_add(chunk.len()) > AI_DIAGNOSTIC_MAX_BYTES {
                return Err("body_too_large");
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    };
    match tokio::time::timeout(std::time::Duration::from_secs(2), read).await {
        Ok(Ok(body)) => detail["body"] = body.into(),
        result => {
            let reason = match result { Ok(Err(reason)) => reason, _ => "timeout" };
            detail["reason"] = reason.into();
            detail["truncated"] = (reason == "body_too_large").into();
        }
    }
    detail
}

fn completion_diagnostics(payload: &serde_json::Value) -> serde_json::Value {
    let choice = &payload["choices"][0];
    let usage = &payload["usage"];
    serde_json::json!({
        "finishReason": choice["finish_reason"].as_str().filter(|reason| matches!(*reason, "stop" | "length" | "tool_calls" | "function_call" | "content_filter")),
        "contentBytes": choice["message"]["content"].as_str().map(str::len),
        "reasoningBytes": choice["message"]["reasoning_content"].as_str().map(str::len),
        "usage": {
            "promptTokens": usage["prompt_tokens"].as_u64(),
            "completionTokens": usage["completion_tokens"].as_u64(),
            "totalTokens": usage["total_tokens"].as_u64(),
            "reasoningTokens": usage["completion_tokens_details"]["reasoning_tokens"].as_u64().or_else(|| usage["reasoning_tokens"].as_u64())
        }
    })
}

fn completion_content(payload: &serde_json::Value) -> Result<String, String> {
    let choice = &payload["choices"][0];
    if choice["finish_reason"].as_str() == Some("length") {
        return Err("ai-provider:response_truncated".to_string());
    }
    let content = choice["message"]["content"].as_str().unwrap_or("");
    if content.trim().is_empty() { return Err("ai-provider:empty_response".to_string()); }
    Ok(content.to_string())
}

async fn request_impl(
    request: AiProviderNativeRequest,
) -> Result<AiProviderNativeResponse, String> {
    let endpoint = validate_native_request(&request)?;
    let body = request_body(&request, &endpoint);
    let encoded_body =
        serde_json::to_vec(&body).map_err(|_| "ai-provider:invalid_request".to_string())?;
    if encoded_body.len() > AI_PROVIDER_MAX_RESPONSE_BYTES {
        return Err("ai-provider:invalid_request".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("ToolKnit/3.1.0 local-ai-provider")
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_millis(request.timeout_ms.unwrap_or(45_000)))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(provider_network_error)?;
    let mut response = client
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .bearer_auth(request.api_key.trim())
        .body(encoded_body)
        .send()
        .await
        .map_err(|error| request_network_error(error, &request))?;
    if !response.status().is_success() {
        let code = format!("ai-provider:http_error:{}", response.status().as_u16());
        if !diagnostics_enabled(&request) { return Err(code); }
        let detail = error_response_diagnostics(&mut response).await;
        return Err(diagnostic_error(code, &request, detail));
    }
    if response
        .content_length()
        .is_some_and(|value| value > AI_PROVIDER_MAX_RESPONSE_BYTES as u64)
    {
        return Err("ai-provider:response_too_large".to_string());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| if error.is_timeout() { "ai-provider:timeout".to_string() } else { "ai-provider:invalid_response".to_string() })?
    {
        if bytes.len().saturating_add(chunk.len()) > AI_PROVIDER_MAX_RESPONSE_BYTES {
            return Err("ai-provider:response_too_large".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let response_detail = |stage| serde_json::json!({
        "stage":stage, "status": response.status().as_u16(),
        "body": if diagnostics_enabled(&request) && bytes.len() <= AI_DIAGNOSTIC_MAX_BYTES {
            Some(String::from_utf8_lossy(&bytes).into_owned())
        } else { None }, "truncated":bytes.len() > AI_DIAGNOSTIC_MAX_BYTES
    });
    let payload: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
        diagnostic_error("ai-provider:invalid_response".to_string(), &request, response_detail("response_parse"))
    })?;
    let content = completion_content(&payload).map_err(|code| {
        let mut detail = response_detail("completion");
        if diagnostics_enabled(&request) { detail["completion"] = completion_diagnostics(&payload); }
        diagnostic_error(code, &request, detail)
    })?;
    Ok(AiProviderNativeResponse { content })
}

#[tauri::command]
pub async fn request_private_ai_completion(
    request: AiProviderNativeRequest,
) -> Result<AiProviderNativeResponse, String> {
    if let Some(id) = request.request_id.as_deref() {
        let (_guard, cancelled) = crate::ai_provider_cancellation::register(id)?;
        return tokio::select! {
            biased;
            _ = cancelled => Err("ai-provider:aborted".to_string()),
            result = request_impl(request) => result,
        };
    }
    request_impl(request).await
}

#[tauri::command]
pub fn cancel_private_ai_completion(request_id: String) -> Result<(), String> {
    crate::ai_provider_cancellation::cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multimodal_messages_are_bounded_and_local_images_only() {
        let mut request = test_request();
        request.messages[0].content = serde_json::json!([
            {"type":"text", "text":"Synthetic page"},
            {"type":"image_url", "image_url":{"url":"data:image/jpeg;base64,YWJj", "detail":"high"}}
        ]);
        assert!(validate_native_request(&request).is_ok());
        assert!(request_body(&request, &validate_native_request(&request).unwrap())["messages"][0]["content"].is_array());
        for image in ["https://example.test/image.jpg", "data:image/svg+xml;base64,YWJj", "data:image/jpeg;base64,invalid!", "data:image/jpeg;base64,"] {
            request.messages[0].content = serde_json::json!([{"type":"image_url", "image_url":{"url":image}}]);
            assert!(validate_native_request(&request).is_err());
        }
        request.messages[0].content = serde_json::json!([{"type":"image_url", "image_url":{"url":format!("data:image/jpeg;base64,{}", "a".repeat(5 * 1024 * 1024))}}]);
        request.messages.push(request.messages[0].clone());
        assert!(validate_native_request(&request).is_err());
    }

    fn test_request() -> AiProviderNativeRequest {
        serde_json::from_value(serde_json::json!({
            "url": "https://open.bigmodel.cn/api/paas/v4/chat/completions", "apiKey": "test-key",
            "model": "glm-5.3-flash", "messages": [{"role":"user","content":"Synthetic document"}],
            "maxTokens": 8192, "timeoutMs": 180000, "reasoningEffort":"low"
        })).unwrap()
    }

    #[tokio::test]
    async fn cancellation_before_dispatch_does_not_send_request() {
        let mut request = test_request();
        request.request_id = Some("pre-dispatch-native-test".into());
        cancel_private_ai_completion("pre-dispatch-native-test".into()).unwrap();
        assert!(matches!(request_private_ai_completion(request).await, Err(code) if code == "ai-provider:aborted"));
    }

    #[test]
    fn document_options_are_bounded_and_provider_specific() {
        let mut request = test_request();
        let endpoint = validate_native_request(&request).unwrap();
        let body = request_body(&request, &endpoint);
        assert_eq!(body["reasoning_effort"], "low");
        assert_eq!(body["max_tokens"], 8192);
        assert!(body.get("thinking").is_none());
        assert!(body.get("apiKey").is_none());
        assert!(body.get("timeoutMs").is_none());
        assert!(body.get("diagnostics").is_none());
        for model in ["glm-5.3", "glm-5.3-flash", " GLM-5.3 "] {
            request.model = model.into();
            for effort in ["low", "high", "max"] {
                request.reasoning_effort = Some(effort.into());
                assert_eq!(request_body(&request, &endpoint)["reasoning_effort"], effort);
            }
        }
        request.reasoning_effort = Some("low".into());
        let other = url::Url::parse("https://api.example.com/v1/chat/completions").unwrap();
        assert!(request_body(&request, &other).get("reasoning_effort").is_none());
        let lookalike = url::Url::parse("https://open.bigmodel.cn.example.test/v1/chat/completions").unwrap();
        assert!(request_body(&request, &lookalike).get("reasoning_effort").is_none());
        request.model = "glm-5.3-preview".into();
        assert!(request_body(&request, &endpoint).get("reasoning_effort").is_none());
        request.model = "other-model".into();
        assert!(request_body(&request, &endpoint).get("reasoning_effort").is_none());
        for timeout in [0, 180001, u64::MAX] {
            request.timeout_ms = Some(timeout);
            assert!(validate_native_request(&request).is_err());
        }
        request.timeout_ms = None;
        request.reasoning_effort = None;
        assert!(validate_native_request(&request).is_ok(), "legacy requests remain valid");
    }

    #[test]
    fn official_models_share_low_default_without_overriding_explicit_effort() {
        for (url, models) in [
            ("https://api.deepseek.com/chat/completions", ["deepseek-v4-pro", "deepseek-v4-flash"]),
            ("https://api.deepseek.com/v1/chat/completions", [" DEEPSEEK-V4-PRO ", "deepseek-v4-flash"]),
            ("https://open.bigmodel.cn/api/paas/v4/chat/completions", ["glm-5.3", "glm-5.3-flash"]),
        ] {
            for model in models {
                let mut request = test_request();
                request.url = url.into();
                request.model = model.into();
                for effort in [None, Some("low"), Some("high"), Some("max")] {
                    request.reasoning_effort = effort.map(str::to_string);
                    let body = request_body(&request, &validate_native_request(&request).unwrap());
                    assert_eq!(body["reasoning_effort"], effort.unwrap_or("low"));
                    assert_eq!(body["max_tokens"], 8192);
                    assert!(body.get("thinking").is_none());
                }
            }
        }
        for (url, model) in [
            ("https://api.deepseek.com.example.test/chat/completions", "deepseek-v4-pro"),
            ("https://api.deepseek.com/chat/completions", "deepseek-v4-pro-preview"),
            ("https://api.deepseek.com/chat/completions", "glm-5.3"),
            ("https://open.bigmodel.cn/api/paas/v4/chat/completions", "deepseek-v4-pro"),
        ] {
            let mut request = test_request();
            request.url = url.into();
            request.model = model.into();
            let body = request_body(&request, &validate_native_request(&request).unwrap());
            assert!(body.get("reasoning_effort").is_none());
        }
    }

    #[test]
    fn diagnostics_require_opt_in_and_a_debug_or_qa_build() {
        let mut request = test_request();
        assert!(!diagnostics_enabled(&request));
        let detail = serde_json::json!({"body":"synthetic upstream error"});
        assert_eq!(diagnostic_error("ai-provider:http_error:404".into(), &request, detail.clone()), "ai-provider:http_error:404");
        request.diagnostics = true;
        let enabled = cfg!(any(debug_assertions, feature = "qa-devtools"));
        assert_eq!(diagnostics_enabled(&request), enabled);
        assert_eq!(diagnostic_error("ai-provider:http_error:404".into(), &request, detail).contains(":diagnostic:"), enabled);
        assert!(request_body(&request, &validate_native_request(&request).unwrap()).get("diagnostics").is_none());
    }

    #[tokio::test]
    async fn native_http_diagnostics_preserve_status_and_enforce_body_limits() {
        use std::io::{Read, Write};
        for (enabled, size) in [(false, 80), (true, 80), (true, AI_DIAGNOSTIC_MAX_BYTES + 1)] {
            let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut bytes = [0u8; 8192];
                let _ = stream.read(&mut bytes);
                let body = if size > AI_DIAGNOSTIC_MAX_BYTES { "x".repeat(size) }
                    else { r#"{"error":{"code":"model_not_found","message":"No such model"}}"#.to_string() };
                let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nX-Request-Id: synthetic-404\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            });
            let mut request = test_request();
            request.url = format!("http://{address}/v1/chat/completions");
            request.diagnostics = enabled;
            let expected_diagnostics = diagnostics_enabled(&request);
            let error = match request_impl(request).await { Err(error) => error, Ok(_) => panic!("404 must reject") };
            assert!(error.starts_with("ai-provider:http_error:404"));
            if expected_diagnostics {
                let (_, json) = error.split_once(":diagnostic:").unwrap();
                let detail: serde_json::Value = serde_json::from_str(json).unwrap();
                assert_eq!(detail["requestId"], "synthetic-404");
                if size > AI_DIAGNOSTIC_MAX_BYTES {
                    assert_eq!(detail["truncated"], true);
                    assert!(detail.get("body").is_none());
                } else { assert!(detail["body"].as_str().unwrap().contains("model_not_found")); }
            } else { assert_eq!(error, "ai-provider:http_error:404"); }
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn native_network_diagnostics_have_no_response_or_private_url() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let mut request = test_request();
        request.url = format!("http://{address}/v1/chat/completions?token=synthetic-secret");
        request.diagnostics = true;
        let expected_diagnostics = diagnostics_enabled(&request);
        let error = match request_impl(request).await { Err(error) => error, Ok(_) => panic!("closed port must reject") };
        assert!(error.starts_with("ai-provider:network_error"));
        assert!(!error.contains("synthetic-secret"));
        assert!(!error.contains("127.0.0.1"));
        if expected_diagnostics { assert!(error.contains("connect")); }
    }

    #[test]
    fn reasoning_only_and_truncated_responses_are_not_documents() {
        for content in ["", "{partial"] {
            let payload = serde_json::json!({"choices":[{"message":{"content":content,"reasoning_content":"not final output"},"finish_reason":"length"}]});
            assert_eq!(completion_content(&payload).unwrap_err(), "ai-provider:response_truncated");
        }
        let payload = serde_json::json!({"choices":[{"message":{"content":""},"finish_reason":"stop"}]});
        assert_eq!(completion_content(&payload).unwrap_err(), "ai-provider:empty_response");
    }

    #[test]
    fn completion_diagnostics_only_include_safe_metadata() {
        let payload = serde_json::json!({
            "choices":[{"finish_reason":"length", "message":{"content":"\u{4e2d}", "reasoning_content":"private reasoning"}}],
            "usage":{"prompt_tokens":200,"completion_tokens":8192,"total_tokens":8392,
                "completion_tokens_details":{"reasoning_tokens":8000,"secret":"private-value"}}
        });
        let summary = completion_diagnostics(&payload);
        assert_eq!(summary["finishReason"], "length");
        assert_eq!(summary["contentBytes"], 3);
        assert_eq!(summary["reasoningBytes"], 17);
        assert_eq!(summary["usage"]["reasoningTokens"], 8000);
        assert!(!summary.to_string().contains("private"));
        let invalid = completion_diagnostics(&serde_json::json!({
            "choices":[{"finish_reason":"private-value"}],
            "usage":{"prompt_tokens":-1,"completion_tokens":"private-value","total_tokens":1.5}
        }));
        assert!(invalid["finishReason"].is_null());
        assert!(invalid["usage"]["promptTokens"].is_null());
        assert!(invalid["usage"]["completionTokens"].is_null());
        assert!(invalid["usage"]["totalTokens"].is_null());
    }

    #[tokio::test]
    async fn completion_errors_keep_http_status_and_usage_when_body_is_omitted() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0u8; 8192];
            let _ = stream.read(&mut bytes);
            let body = serde_json::json!({
                "choices":[{"finish_reason":"length", "message":{"content":"", "reasoning_content":"r".repeat(40000)}}],
                "usage":{"prompt_tokens":200,"completion_tokens":8192,"total_tokens":8392}
            }).to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let mut request = test_request();
        request.url = format!("http://{address}/v1/chat/completions");
        request.model = "glm-5.3".into();
        request.diagnostics = true;
        let enabled = diagnostics_enabled(&request);
        let error = match request_impl(request).await { Err(error) => error, Ok(_) => panic!("truncated completion must reject") };
        if enabled {
            let (_, json) = error.split_once(":diagnostic:").unwrap();
            let detail: serde_json::Value = serde_json::from_str(json).unwrap();
            assert_eq!(detail["status"], 200);
            assert_eq!(detail["completion"]["finishReason"], "length");
            assert_eq!(detail["completion"]["contentBytes"], 0);
            assert_eq!(detail["completion"]["reasoningBytes"], 40000);
            assert_eq!(detail["completion"]["usage"]["completionTokens"], 8192);
            assert!(detail["body"].is_null());
            assert_eq!(detail["truncated"], true);
        } else { assert_eq!(error, "ai-provider:response_truncated"); }
        server.join().unwrap();
    }

    #[tokio::test]
    async fn native_timeout_is_not_reported_as_generic_network_failure() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0u8; 8192];
            let _ = stream.read(&mut bytes);
            std::thread::sleep(std::time::Duration::from_millis(250));
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}");
        });
        let mut request = test_request();
        request.url = format!("http://{address}/v1/chat/completions");
        request.timeout_ms = Some(80);
        match request_impl(request).await {
            Err(code) => assert_eq!(code, "ai-provider:timeout"),
            Ok(_) => panic!("slow server must exceed the timeout"),
        }
        server.join().unwrap();
    }

    #[test]
    fn endpoint_transport_policy() {
        assert!(validate_endpoint("https://api.example.com/v1/chat/completions", false).is_ok());
        assert!(validate_endpoint("http://127.0.0.1:11434/v1/chat/completions", false).is_ok());
        assert!(validate_endpoint("http://172.23.20.253:3001/v1/chat/completions", false).is_err());
        assert!(validate_endpoint("http://172.23.20.253:3001/v1/chat/completions", true).is_ok());
        assert!(validate_endpoint("http://192.168.1.20/v1/chat/completions", true).is_ok());
        assert!(validate_endpoint("http://8.8.8.8/v1/chat/completions", true).is_err());
        assert!(validate_endpoint("http://example.com/v1/chat/completions", true).is_err());
    }

    #[tokio::test]
    async fn loopback_native_request_returns_only_completion_content() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request_bytes = [0_u8; 8192];
            let read = stream.read(&mut request_bytes).unwrap();
            let request_text = String::from_utf8_lossy(&request_bytes[..read]);
            assert!(request_text
                .to_ascii_lowercase()
                .contains("authorization: bearer test-key"));
            assert!(request_text.contains("POST /v1/chat/completions HTTP/1.1"));
            let body = r#"{"choices":[{"message":{"content":"native response"}}]}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let result = request_impl(AiProviderNativeRequest {
            url: format!("http://{}/v1/chat/completions", address),
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
            messages: vec![AiProviderNativeMessage {
                role: "user".to_string(),
                content: serde_json::Value::String("Hello".to_string()),
            }],
            max_tokens: Some(100),
            timeout_ms: None,
            reasoning_effort: None,
            allow_private_http: false,
            diagnostics: false,
            request_id: None,
        })
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(result.content, "native response");
    }
}
