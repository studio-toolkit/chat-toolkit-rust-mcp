use crate::error::{Report, Result};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{extract::State, Json};
use color_eyre::eyre::{eyre, Error, OptionExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::oneshot::Receiver;
use tokio::sync::{mpsc, watch, Mutex};
use tokio::time::Duration;
use uuid::Uuid;

pub const STUDIO_PLUGIN_PORT: u16 = 44755;
const LONG_POLL_DURATION: Duration = Duration::from_secs(15);
const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL: &str = "gemini-2.5-flash";

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ToolArguments {
    pub args: ToolArgumentValues,
    pub id: Option<Uuid>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct RunCommandResponse {
    pub success: bool,
    pub response: String,
    pub id: Uuid,
}

pub struct AppState {
    pub process_queue: VecDeque<ToolArguments>,
    pub output_map: HashMap<Uuid, mpsc::UnboundedSender<Result<String>>>,
    pub waiter: watch::Receiver<()>,
    pub trigger: watch::Sender<()>,
}

pub type PackedState = Arc<Mutex<AppState>>;

impl AppState {
    pub fn new() -> Self {
        let (trigger, waiter) = watch::channel(());
        Self {
            process_queue: VecDeque::new(),
            output_map: HashMap::new(),
            waiter,
            trigger,
        }
    }
}

impl ToolArguments {
    pub fn new(args: ToolArgumentValues) -> (Self, Uuid) {
        Self { args, id: None }.with_id()
    }

    fn with_id(self) -> (Self, Uuid) {
        let id = Uuid::new_v4();
        (
            Self {
                args: self.args,
                id: Some(id),
            },
            id,
        )
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RunCode {
    pub command: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct InsertModel {
    pub query: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GetConsoleOutput {}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GetStudioMode {}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StartStopPlay {
    pub mode: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RunScriptInPlayMode {
    pub code: String,
    pub timeout: Option<u32>,
    pub mode: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum ToolArgumentValues {
    RunCode(RunCode),
    InsertModel(InsertModel),
    GetConsoleOutput(GetConsoleOutput),
    StartStopPlay(StartStopPlay),
    RunScriptInPlayMode(RunScriptInPlayMode),
    GetStudioMode(GetStudioMode),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiRequest {
    pub contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDeclaration>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_instruction: Option<GeminiContent>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeminiPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_call: Option<GeminiFunctionCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_response: Option<GeminiFunctionResponse>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiFunctionCall {
    pub name: String,
    pub args: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiFunctionResponse {
    pub name: String,
    pub response: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolDeclaration {
    #[serde(rename = "functionDeclarations")]
    pub function_declarations: Vec<FunctionDeclaration>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FunctionDeclaration {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiResponse {
    pub candidates: Option<Vec<GeminiCandidate>>,
    pub error: Option<GeminiError>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiError {
    pub message: String,
    pub code: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiCandidate {
    pub content: Option<GeminiContent>,
}

pub fn build_tool_declarations() -> Vec<ToolDeclaration> {
    vec![ToolDeclaration {
        function_declarations: vec![
            FunctionDeclaration {
                name: "run_code".to_string(),
                description: "Runs a command in Roblox Studio and returns the printed output. Can be used to both make changes and retrieve information.".to_string(),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Code to run"
                        }
                    },
                    "required": ["command"]
                })),
            },
            FunctionDeclaration {
                name: "insert_model".to_string(),
                description: "Inserts a model from the Roblox marketplace into the workspace. Returns the inserted model name.".to_string(),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Query to search for the model"
                        }
                    },
                    "required": ["query"]
                })),
            },
            FunctionDeclaration {
                name: "get_console_output".to_string(),
                description: "Get the console output from Roblox Studio.".to_string(),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {}
                })),
            },
            FunctionDeclaration {
                name: "start_stop_play".to_string(),
                description: "Start or stop play mode or run the server. Don't enter run_server mode unless you are sure no client/player is needed.".to_string(),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "mode": {
                            "type": "string",
                            "description": "Mode to start or stop, must be start_play, stop, or run_server. Don't use run_server unless you are sure no client/player is needed.",
                            "enum": ["start_play", "stop", "run_server"]
                        }
                    },
                    "required": ["mode"]
                })),
            },
            FunctionDeclaration {
                name: "run_script_in_play_mode".to_string(),
                description: "Run a script in play mode and automatically stop play after script finishes or timeout. Returns the output of the script. Result format: { success: boolean, value: string, error: string, logs: { level: string, message: string, ts: number }[], errors: { level: string, message: string, ts: number }[], duration: number, isTimeout: boolean }. Prefer using start_stop_play tool instead run_script_in_play_mode. Only use run_script_in_play_mode to run one time unit test code on server datamodel. After calling run_script_in_play_mode, the datamodel status will be reset to stop mode. If it returns 'StudioTestService: Previous call to start play session has not been completed', call start_stop_play tool to stop play mode first then try it again.".to_string(),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "Code to run"
                        },
                        "timeout": {
                            "type": "integer",
                            "description": "Timeout in seconds, defaults to 100 seconds"
                        },
                        "mode": {
                            "type": "string",
                            "description": "Mode to run in, must be start_play or run_server",
                            "enum": ["start_play", "run_server"]
                        }
                    },
                    "required": ["code", "mode"]
                })),
            },
            FunctionDeclaration {
                name: "get_studio_mode".to_string(),
                description: "Get the current studio mode. Returns the studio mode. The result will be one of start_play, run_server, or stop.".to_string(),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {}
                })),
            },
        ],
    }]
}

pub fn build_system_instruction() -> GeminiContent {
    GeminiContent {
        role: None,
        parts: vec![GeminiPart {
            text: Some(
                "You are a Roblox Studio assistant. You must be aware of the current studio mode before using any tools. Infer the mode from conversation context or use get_studio_mode.\n\
                Use run_code to query data from Roblox Studio place or to change it.\n\
                After calling run_script_in_play_mode, the datamodel status will be reset to stop mode.\n\
                Prefer using start_stop_play tool instead of run_script_in_play_mode. Only use run_script_in_play_mode to run one time unit test code on server datamodel."
                    .to_string(),
            ),
            function_call: None,
            function_response: None,
        }],
    }
}

pub async fn send_to_gemini(
    client: &reqwest::Client,
    api_key: &str,
    contents: &[GeminiContent],
    tools: &[ToolDeclaration],
    system_instruction: &GeminiContent,
) -> color_eyre::Result<GeminiResponse> {
    let url = format!(
        "{}/{}:generateContent?key={}",
        GEMINI_API_BASE, GEMINI_MODEL, api_key
    );

    let request_body = GeminiRequest {
        contents: contents.to_vec(),
        tools: Some(tools.to_vec()),
        system_instruction: Some(system_instruction.clone()),
    };

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await?;

    let status = response.status();
    let body_text = response.text().await?;

    if !status.is_success() {
        return Err(eyre!(
            "Gemini API returned status {}: {}",
            status,
            body_text
        ));
    }

    let gemini_response: GeminiResponse = serde_json::from_str(&body_text)
        .map_err(|e| eyre!("Failed to parse Gemini response: {} — body: {}", e, body_text))?;

    if let Some(ref err) = gemini_response.error {
        return Err(eyre!("Gemini API error {}: {}", err.code.unwrap_or(0), err.message));
    }

    Ok(gemini_response)
}

pub fn convert_function_call_to_tool_args(
    fc: &GeminiFunctionCall,
) -> color_eyre::Result<ToolArgumentValues> {
    match fc.name.as_str() {
        "run_code" => {
            let command = fc
                .args
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| eyre!("run_code missing 'command' argument"))?
                .to_string();
            Ok(ToolArgumentValues::RunCode(RunCode { command }))
        }
        "insert_model" => {
            let query = fc
                .args
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| eyre!("insert_model missing 'query' argument"))?
                .to_string();
            Ok(ToolArgumentValues::InsertModel(InsertModel { query }))
        }
        "get_console_output" => Ok(ToolArgumentValues::GetConsoleOutput(GetConsoleOutput {})),
        "start_stop_play" => {
            let mode = fc
                .args
                .get("mode")
                .and_then(|v| v.as_str())
                .ok_or_else(|| eyre!("start_stop_play missing 'mode' argument"))?
                .to_string();
            Ok(ToolArgumentValues::StartStopPlay(StartStopPlay { mode }))
        }
        "run_script_in_play_mode" => {
            let code = fc
                .args
                .get("code")
                .and_then(|v| v.as_str())
                .ok_or_else(|| eyre!("run_script_in_play_mode missing 'code' argument"))?
                .to_string();
            let timeout = fc.args.get("timeout").and_then(|v| v.as_u64()).map(|v| v as u32);
            let mode = fc
                .args
                .get("mode")
                .and_then(|v| v.as_str())
                .ok_or_else(|| eyre!("run_script_in_play_mode missing 'mode' argument"))?
                .to_string();
            Ok(ToolArgumentValues::RunScriptInPlayMode(
                RunScriptInPlayMode {
                    code,
                    timeout,
                    mode,
                },
            ))
        }
        "get_studio_mode" => Ok(ToolArgumentValues::GetStudioMode(GetStudioMode {})),
        other => Err(eyre!("Unknown function call: {}", other)),
    }
}

pub async fn dispatch_function_call(
    state: &PackedState,
    fc: &GeminiFunctionCall,
) -> color_eyre::Result<String> {
    let tool_args = convert_function_call_to_tool_args(fc)?;
    let (command, id) = ToolArguments::new(tool_args);
    tracing::debug!("Dispatching function call to Roblox Studio: {:?}", command);

    let (tx, mut rx) = mpsc::unbounded_channel::<Result<String>>();

    let trigger = {
        let mut app_state = state.lock().await;
        app_state.process_queue.push_back(command);
        app_state.output_map.insert(id, tx);
        app_state.trigger.clone()
    };

    trigger.send(()).map_err(|e| eyre!("Unable to trigger send: {}", e))?;

    let result = rx
        .recv()
        .await
        .ok_or_else(|| eyre!("Couldn't receive response from Roblox Studio"))?;

    {
        let mut app_state = state.lock().await;
        app_state.output_map.remove_entry(&id);
    }

    match result {
        Ok(response) => Ok(response),
        Err(err) => Ok(format!("Error: {}", err)),
    }
}

pub async fn run_chat_loop(
    state: PackedState,
    api_key: String,
) -> color_eyre::Result<()> {
    let client = reqwest::Client::new();
    let tools = build_tool_declarations();
    let system_instruction = build_system_instruction();
    let mut conversation_history: Vec<GeminiContent> = Vec::new();

    let stdin = tokio::io::stdin();
    let mut reader = tokio::io::BufReader::new(stdin);

    println!("Roblox Studio Gemini Agent is ready.");
    println!("Type your message and press Enter. Type 'exit' to quit.\n");

    loop {
        use tokio::io::AsyncBufReadExt;

        print!("You: ");
        use std::io::Write;
        std::io::stdout().flush().ok();

        let mut input = String::new();
        let bytes_read = reader.read_line(&mut input).await?;

        if bytes_read == 0 {
            break;
        }

        let input = input.trim().to_string();

        if input.is_empty() {
            continue;
        }

        if input.eq_ignore_ascii_case("exit") {
            println!("Goodbye!");
            break;
        }

        conversation_history.push(GeminiContent {
            role: Some("user".to_string()),
            parts: vec![GeminiPart {
                text: Some(input),
                function_call: None,
                function_response: None,
            }],
        });

        loop {
            let response = send_to_gemini(
                &client,
                &api_key,
                &conversation_history,
                &tools,
                &system_instruction,
            )
            .await;

            match response {
                Err(e) => {
                    eprintln!("Gemini API error: {}", e);
                    break;
                }
                Ok(gemini_response) => {
                    let candidate = gemini_response
                        .candidates
                        .as_ref()
                        .and_then(|c| c.first())
                        .and_then(|c| c.content.as_ref());

                    let parts = match candidate {
                        Some(content) => content.parts.clone(),
                        None => {
                            eprintln!("No response content from Gemini.");
                            break;
                        }
                    };

                    let mut has_function_calls = false;
                    let mut function_calls: Vec<GeminiFunctionCall> = Vec::new();
                    let mut text_parts: Vec<String> = Vec::new();

                    for part in &parts {
                        if let Some(ref fc) = part.function_call {
                            has_function_calls = true;
                            function_calls.push(fc.clone());
                        }
                        if let Some(ref text) = part.text {
                            if !text.is_empty() {
                                text_parts.push(text.clone());
                            }
                        }
                    }

                    conversation_history.push(GeminiContent {
                        role: Some("model".to_string()),
                        parts: parts.clone(),
                    });

                    if has_function_calls {
                        let mut function_response_parts: Vec<GeminiPart> = Vec::new();

                        for fc in &function_calls {
                            println!("  [Tool Call] {}({})", fc.name, fc.args);

                            let result = dispatch_function_call(&state, fc).await;

                            let result_str = match result {
                                Ok(r) => r,
                                Err(e) => format!("Error dispatching tool: {}", e),
                            };

                            println!("  [Tool Result] {}", truncate_for_display(&result_str, 200));

                            function_response_parts.push(GeminiPart {
                                text: None,
                                function_call: None,
                                function_response: Some(GeminiFunctionResponse {
                                    name: fc.name.clone(),
                                    response: serde_json::json!({
                                        "result": result_str
                                    }),
                                }),
                            });
                        }

                        conversation_history.push(GeminiContent {
                            role: Some("user".to_string()),
                            parts: function_response_parts,
                        });

                        continue;
                    }

                    if !text_parts.is_empty() {
                        println!("\nGemini: {}\n", text_parts.join(""));
                    }

                    break;
                }
            }
        }
    }

    Ok(())
}

fn truncate_for_display(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}

pub async fn request_handler(State(state): State<PackedState>) -> Result<impl IntoResponse> {
    let timeout = tokio::time::timeout(LONG_POLL_DURATION, async {
        let mut waiter = { state.lock().await.waiter.clone() };
        loop {
            {
                let mut state = state.lock().await;
                if let Some(task) = state.process_queue.pop_front() {
                    return Ok::<ToolArguments, Error>(task);
                }
            }
            waiter.changed().await?
        }
    })
    .await;
    match timeout {
        Ok(result) => Ok(Json(result?).into_response()),
        _ => Ok((StatusCode::LOCKED, String::new()).into_response()),
    }
}

pub async fn response_handler(
    State(state): State<PackedState>,
    Json(payload): Json<RunCommandResponse>,
) -> Result<impl IntoResponse> {
    tracing::debug!("Received reply from studio {:?}", payload);
    let mut state = state.lock().await;
    let tx = state
        .output_map
        .remove(&payload.id)
        .ok_or_eyre("Unknown ID")?;
    let result: Result<String, Report> = if payload.success {
        Ok(payload.response)
    } else {
        Err(Report::from(eyre!(payload.response)))
    };
    Ok(tx.send(result)?)
}

pub async fn proxy_handler(
    State(state): State<PackedState>,
    Json(command): Json<ToolArguments>,
) -> Result<impl IntoResponse> {
    let id = command.id.ok_or_eyre("Got proxy command with no id")?;
    tracing::debug!("Received request to proxy {:?}", command);
    let (tx, mut rx) = mpsc::unbounded_channel();
    {
        let mut state = state.lock().await;
        state.process_queue.push_back(command);
        state.output_map.insert(id, tx);
    }
    let result = rx.recv().await.ok_or_eyre("Couldn't receive response")?;
    {
        let mut state = state.lock().await;
        state.output_map.remove_entry(&id);
    }
    let (success, response) = match result {
        Ok(s) => (true, s),
        Err(e) => (false, e.to_string()),
    };
    tracing::debug!("Sending back to dud: success={}, response={:?}", success, response);
    Ok(Json(RunCommandResponse {
        success,
        response,
        id,
    }))
}

pub async fn dud_proxy_loop(state: PackedState, exit: Receiver<()>) {
    let client = reqwest::Client::new();

    let mut waiter = { state.lock().await.waiter.clone() };
    while exit.is_empty() {
        let entry = { state.lock().await.process_queue.pop_front() };
        if let Some(entry) = entry {
            let res = client
                .post(format!("http://127.0.0.1:{STUDIO_PLUGIN_PORT}/proxy"))
                .json(&entry)
                .send()
                .await;
            if let Ok(res) = res {
                let tx = {
                    state
                        .lock()
                        .await
                        .output_map
                        .remove(&entry.id.unwrap())
                        .unwrap()
                };
                let res = res
                    .json::<RunCommandResponse>()
                    .await
                    .map(|r| r.response)
                    .map_err(Into::into);
                tx.send(res).unwrap();
            } else {
                tracing::error!("Failed to proxy: {:?}", res);
            };
        } else {
            waiter.changed().await.unwrap();
        }
    }
}
