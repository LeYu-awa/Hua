//! MCP stdio 端到端验证：真实启动 `floral-notepaper --mcp` 子进程，
//! 走完 JSON-RPC 全链路：initialize → notifications/initialized → tools/list → tools/call。
//!
//! 为什么用子进程而不是 PowerShell 管道：stdin 全程保持打开，服务器不会因为
//! 管道 EOF 提前退出，`tools/list` / `tools/call` 才能拿到响应。
//! 通过 `FLORAL_NOTEPAPER_DATA_DIR` 指向临时目录，不碰真实数据。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

struct McpProc {
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<String>,
}

impl McpProc {
    fn spawn(data_dir: &std::path::Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_floral-notepaper"))
            .arg("--mcp")
            .env("FLORAL_NOTEPAPER_DATA_DIR", data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("无法启动 floral-notepaper --mcp");
        let stdin = child.stdin.take().expect("子进程 stdin 不可用");
        let stdout = BufReader::new(child.stdout.take().expect("子进程 stdout 不可用"));
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in stdout.lines() {
                let line = line.unwrap_or_default();
                if line.trim().is_empty() {
                    continue;
                }
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Self { child, stdin, rx }
    }

    fn request(&mut self, id: u64, method: &str, params: Value) -> Value {
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        writeln!(self.stdin, "{msg}").expect("写入请求失败");
        self.stdin.flush().expect("刷新 stdin 失败");
        self.await_response(id, method)
    }

    fn notify(&mut self, method: &str, params: Value) {
        let msg = json!({"jsonrpc": "2.0", "method": method, "params": params});
        writeln!(self.stdin, "{msg}").expect("写入通知失败");
        self.stdin.flush().expect("刷新 stdin 失败");
    }

    fn await_response(&mut self, id: u64, method: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            match self.rx.recv_timeout(Duration::from_millis(500)) {
                Ok(line) => {
                    let v: Value = serde_json::from_str(&line)
                        .unwrap_or_else(|e| panic!("无法解析服务器输出 `{line}`: {e}"));
                    if v.get("id") == Some(&json!(id)) {
                        return v;
                    }
                    // 其他消息（日志通知等）跳过
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    panic!("服务器提前退出，等待 {method} (id={id}) 期间管道断开");
                }
            }
        }
        panic!("等待 {method} (id={id}) 响应超时（20s）");
    }
}

impl Drop for McpProc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn stdio_full_handshake_list_and_call() {
    // 临时数据目录：MCP 服务器读到的配置/笔记全为空，不影响真实数据
    let data_dir = std::env::temp_dir().join(format!(
        "floral-mcp-e2e-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&data_dir).expect("创建临时数据目录失败");

    let mut proc = McpProc::spawn(&data_dir);

    // 1) initialize 握手
    let init = proc.request(
        1,
        "initialize",
        json!({
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "floral-mcp-e2e-test", "version": "0.0.0"}
        }),
    );
    assert!(
        init.get("error").is_none(),
        "initialize 返回错误: {init}"
    );
    assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(init["result"]["capabilities"]["tools"], json!({}));
    assert!(
        init["result"]["serverInfo"]["name"].is_string(),
        "initialize 缺 serverInfo"
    );

    // 2) initialized 通知（规范：initialize 成功后必须发送）
    proc.notify("notifications/initialized", json!({}));

    // 3) tools/list：应暴露全部 7 个工具
    let list = proc.request(2, "tools/list", json!({}));
    let tools = list["result"]["tools"]
        .as_array()
        .expect("tools/list 无 tools 数组");
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    for expected in [
        "note_search",
        "note_read",
        "note_create",
        "canvas_read",
        "canvas_node_create",
        "web_search",
        "llm_generate",
    ] {
        assert!(
            names.contains(&expected),
            "tools/list 缺少工具 {expected}，实际: {names:?}"
        );
    }
    for t in tools {
        assert!(
            t["inputSchema"].is_object(),
            "工具 {} 缺 inputSchema",
            t["name"]
        );
    }

    // 4) tools/call：note_search 在空库上执行，应返回 JSON 数组（[]）
    let call = proc.request(
        3,
        "tools/call",
        json!({
            "name": "note_search",
            "arguments": {"query": "测试", "limit": 3}
        }),
    );
    assert!(
        call.get("error").is_none(),
        "tools/call 返回错误: {call}"
    );
    let content = call["result"]["content"]
        .as_array()
        .expect("tools/call 无 content");
    let text = content
        .iter()
        .filter_map(|c| c["text"].as_str())
        .collect::<Vec<_>>()
        .join("");
    let parsed: Value = serde_json::from_str(&text).expect("note_search 应返回 JSON 文本");
    assert!(parsed.is_array(), "note_search 结果应为数组，实际: {parsed}");

    // 5) tools/call：读不存在的笔记 → 应返回协议级错误（isError 标记，而非 JSON-RPC error）
    let miss = proc.request(
        4,
        "tools/call",
        json!({
            "name": "note_read",
            "arguments": {"id": "does-not-exist"}
        }),
    );
    assert!(miss.get("error").is_none(), "note_read 不应 JSON-RPC 报错: {miss}");
    assert_eq!(
        miss["result"]["isError"], json!(true),
        "note_read 缺失应标记 isError: {miss}"
    );

    // 清理临时目录
    std::fs::remove_dir_all(&data_dir).ok();
}
