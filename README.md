# 🚀 Roblox Studio Gemini Agent

A state-of-the-art Rust 🦀 and Electron-based AI agent that beautifully bridges the **Google Gemini API** and **Roblox Studio**. It comes with a premium, sleek ChatGPT-style desktop UI, empowering you to control and build in Studio using natural language! ✨

## 🏗️ Architecture

```text
Electron App (UI) ──HTTP──→ Rust Agent
                               ├──→ 🧠 Google Gemini API
                               └──→ 🎮 Roblox Studio Plugin (HTTP long-polling)
```

1. ✍️ **Prompt**: You type a request in the Electron app (e.g., *"Add a red part to Workspace"*).
2. ⚡ **Stream**: The Rust agent streams your prompt to the Gemini API.
3. 🛠️ **Tool Call**: Gemini determines the appropriate tool to use (e.g., `run_code`).
4. 🔄 **Forward**: The agent forwards the command to the Roblox Studio plugin.
5. 🏃‍♂️ **Execute**: The plugin executes the command and sends back the result.
6. 🎨 **Render**: The agent streams the result directly to the UI, rendering it elegantly with markdown and syntax highlighting!

## 🧰 Available Tools

| Tool | Description |
|------|-------------|
| `run_code` | Runs Luau code directly in Roblox Studio and returns the printed output. 📜 |
| `insert_model` | Searches the Roblox Creator Store and inserts a 3D model into the Workspace. 📦 |
| `get_console_output` | Retrieves the latest Studio console output. 🖥️ |
| `start_stop_play` | Seamlessly switches between Play / Stop / Run Server modes. ⏯️ |
| `run_script_in_play_mode` | Runs a script in play mode, automatically stopping when finished or timed out. ⏱️ |
| `get_studio_mode` | Returns the current Studio mode (`start_play`, `run_server`, `stop`). 🔍 |

---

## 🛠️ Setup & Installation

### Prerequisites

- 🦀 [Rust](https://www.rust-lang.org/tools/install) (includes `cargo`)
- 🟢 [Node.js](https://nodejs.org/) (includes `npm`, required for the UI)
- 🟦 [Roblox Studio](https://create.roblox.com/docs/en-us/studio/setup) (installed and launched at least once)
- 🔑 A [Google Gemini API Key](https://aistudio.google.com/apikey)

### 1. Install Dependencies 

**macOS / Linux:**
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

**Windows:**
Download and run [rustup-init.exe](https://win.rustup.rs/).

### 2. Clone the Repository

```bash
git clone https://github.com/hamuzhan/studio-rust-mcp-server-gemini-api.git
cd studio-rust-mcp-server-gemini-api
```

### 3. Build the Project

```bash
cargo build --release
```
*(Note: The first build will take a few minutes as it compiles all dependencies.)*

### 4. Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Click **Create API Key**.
3. Copy the generated key. You can paste this directly into the UI later! 🔐

### 5. Install the Roblox Studio Plugin

```bash
cargo run --release -- --install
```
*This copies the `MCPStudioPlugin.rbxm` file into Roblox Studio's Plugins directory.*

### 6. Restart Roblox Studio

Close and reopen Studio so the plugin loads. Verify that the **MCP** button appears under the **Plugins** tab! 🎉

---

## 🎮 Usage

### Start the Agent

Run the agent from the project root:
```bash
cargo run --release
```

The Rust backend will start and automatically launch the **Electron UI**. *On the first run, it will automatically run `npm install` in the `electron` directory.*

### The UI Experience

Once the beautiful UI opens:
1. Click the **Settings** ⚙️ icon (or wait for the automatic popup).
2. Paste your **Gemini API Key** and click "Save & Connect".
3. Verify the status at the bottom changes to **Connected to Gemini** 🟢.
4. Type your prompt and watch the magic happen! ✨

*Pro-tip: You can also pre-configure the key using an environment variable:*
```bash
export GEMINI_API_KEY="YOUR_API_KEY_HERE"
cargo run --release
```

### ✨ Premium Features
- 🌗 **Dark / Light Theme**: Toggle using the sun/moon icon in the title bar.
- 📝 **Markdown Rendering**: Full support for tables, lists, and rich formatted text.
- 💻 **Syntax Highlighting**: Code snippets are beautifully highlighted with a quick copy button.
- 🌊 **Real-time Streaming**: Watch Gemini type its response and execute tools in real time.
- 🧠 **Persistent Thought Chain**: Glimpse into the mind of Gemini 3.1 with interactive, real-time reasoning visualization!
- 🔽 **Collapsible Tool Calls**: See exactly what commands are sent to Roblox Studio.

---

## 🗺️ Roadmap (To-Do List)

We are constantly leveling up this project! Here is what's coming next:

- [ ] 🧠 **Advanced Chain of Thoughts**: Vastly improved and highly detailed visualization for model reasoning.
- [ ] 🗂️ **Chat History**: Save and resume your previous conversations and sessions.
- [ ] 📂 **Advanced Project Folders**: Organize your chat history into sophisticated project-based folder structures.
- [ ] 🤖 **Multi-Model Support**: Direct integration with **Claude API**, **OpenAI API**, and more!
- [ ] 🖥️ **Desktop App Connections**: Native integration capabilities with ChatGPT and Claude desktop applications.
- [ ] ⚡ **Local & Custom Backends**: Support for **vLLM API** and **Ollama** to run local or highly customized models.

---

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| UI says `Server not running` | Ensure you started the app via `cargo run` and haven't closed the terminal. |
| `API key not set` error in UI | Click the Settings icon and enter your key, or set `GEMINI_API_KEY` env var. |
| Tool call hands with `running...` | Ensure Roblox Studio is open and the MCP plugin is active. |
| `Port busy, using proxy mode` | Another agent instance is already running — close it first. |
| Plugin not visible in Studio | Run `cargo run --release -- --install` again and restart Studio. |
| No `ready for prompts` in console | Click the MCP button in the Plugins tab to enable the connection. |

## 📁 Project Structure

```
├── src/
│   ├── main.rs                 # Rust entry point (HTTP server + Electron auto-launch)
│   ├── rbx_studio_server.rs    # Gemini REST client, SSE streaming, HTTP handlers
│   ├── install.rs              # Plugin installation script
│   └── error.rs                # Error types
├── electron/
│   ├── main.js                 # Electron main process (BrowserWindow config)
│   ├── renderer.js             # SSE parsing, markdown rendering, UI logic
│   ├── index.html              # Premium ChatGPT-style DOM structure
│   ├── styles.css              # Dark/Light themes and beautifully crafted CSS
│   └── package.json            # Node.js dependencies
├── plugin/                     # Roblox Studio Luau Plugin Source
├── Cargo.toml                  # Rust dependencies
└── build.rs                    # Bundles the plugin at compile time
```
