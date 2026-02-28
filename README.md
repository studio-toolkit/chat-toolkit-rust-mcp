# Roblox Studio Gemini Agent

A Rust-based AI agent that bridges Google Gemini API and Roblox Studio, allowing you to control Studio using natural language from your terminal.

## How It Works

```
Terminal (You) ←→ Rust Agent ←→ Google Gemini API
                      ↕
               Roblox Studio Plugin (HTTP long-polling)
```

1. You type a prompt in the terminal (e.g., "Add a red part to Workspace")
2. The Rust agent sends the prompt to the Gemini API
3. Gemini returns the appropriate tool call (e.g., `run_code`)
4. The agent forwards the command to the Roblox Studio plugin over HTTP
5. The plugin executes the command and sends back the result
6. The agent passes the result to Gemini, which replies in natural language

## Available Tools

| Tool | Description |
|------|-------------|
| `run_code` | Runs Luau code in Roblox Studio and returns printed output |
| `insert_model` | Searches the Roblox Creator Store and inserts a model into workspace |
| `get_console_output` | Retrieves the Studio console output |
| `start_stop_play` | Switches between Play / Stop / Run Server modes |
| `run_script_in_play_mode` | Runs a script in play mode, auto-stops when finished or timed out |
| `get_studio_mode` | Returns the current Studio mode (`start_play`, `run_server`, `stop`) |

---

## Setup

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (includes cargo)
- [Roblox Studio](https://create.roblox.com/docs/en-us/studio/setup) installed and launched at least once
- A [Google Gemini API Key](https://aistudio.google.com/apikey)

### 1. Install Rust (if not already installed)

**macOS / Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

**Windows:**
Download and run [rustup-init.exe](https://win.rustup.rs/).

Verify the installation:
```bash
cargo --version
```

### 2. Clone the Repository

```bash
git clone https://github.com/user/studio-rust-mcp-server-gemini-api.git
cd studio-rust-mcp-server-gemini-api
```

### 3. Build the Project

```bash
cargo build --release
```

The first build will take a few minutes as it downloads and compiles all dependencies.

### 4. Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click "Create API Key"
3. Copy the generated key

### 5. Install the Roblox Studio Plugin

```bash
cargo run --release -- --install
```

This copies the `MCPStudioPlugin.rbxm` file into Roblox Studio's Plugins directory.

### 6. Restart Roblox Studio

Close and reopen Studio so the plugin loads. Verify that the **MCP** button appears under the **Plugins** tab.

---

## Usage

### Start the Agent

**macOS / Linux:**
```bash
export GEMINI_API_KEY="YOUR_API_KEY_HERE"
cargo run --release
```

**Windows (PowerShell):**
```powershell
$env:GEMINI_API_KEY="YOUR_API_KEY_HERE"
cargo run --release
```

**Windows (CMD):**
```cmd
set GEMINI_API_KEY=YOUR_API_KEY_HERE
cargo run --release
```

On successful startup you will see:
```
Roblox Studio Gemini Agent is ready.
Type your message and press Enter. Type 'exit' to quit.

You:
```

### Example Session

```
You: Add a red part to Workspace and name it "RedBlock"

  [Tool Call] run_code({"command":"local part = Instance.new('Part') ..."})
  [Tool Result] Part created successfully

Gemini: I've added a red Part named "RedBlock" to the Workspace. ...

You: Check the current Studio mode

  [Tool Call] get_studio_mode({})
  [Tool Result] stop

Gemini: Studio is currently in "stop" mode (edit mode).

You: exit
Goodbye!
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `GEMINI_API_KEY environment variable is not set` | Make sure you exported the API key before running |
| `Gemini API returned status 400` | Verify that your API key is valid |
| Tool call hangs with no response | Ensure Roblox Studio is open and the plugin is active |
| `Port busy, using proxy mode` | Another agent instance is already running — close it first |
| Plugin not visible in Studio | Run `cargo run --release -- --install` again and restart Studio |
| No `The MCP Studio plugin is ready for prompts.` in console | Click the MCP button in the Plugins tab to enable the connection |

## Project Structure

```
├── src/
│   ├── main.rs                 # Entry point, CLI, HTTP server + chat loop
│   ├── rbx_studio_server.rs    # Gemini API integration, tool definitions, HTTP handlers
│   ├── error.rs                # Error types
│   └── install.rs              # Plugin installation script
├── plugin/
│   └── src/
│       ├── Main.server.luau    # Roblox Studio plugin entry point
│       └── Tools/              # Luau modules for each tool
├── Cargo.toml
└── build.rs                    # Bundles the plugin at compile time
```

## Notes

- The agent starts an HTTP server on `127.0.0.1:44755`. This port is used for communication with the Roblox Studio plugin.
- Conversation history is kept in memory for the duration of the session. It resets when you type `exit`.
- The default model is `gemini-2.5-flash`.
