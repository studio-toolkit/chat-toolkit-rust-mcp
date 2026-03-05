const { Marked } = require("marked");
const { markedHighlight } = require("marked-highlight");
const hljs = require("highlight.js");
const { shell, ipcRenderer } = require("electron");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");

window.addEventListener('error', (e) => {
    try { fs.appendFileSync('/tmp/renderer.log', (e.error ? e.error.stack : e.message) + '\n'); } catch (err) { }
});
window.addEventListener('unhandledRejection', (e) => {
    try { fs.appendFileSync('/tmp/renderer.log', (e.reason ? (e.reason.stack || e.reason) : 'Promise rejection') + '\n'); } catch (err) { }
});

const API_BASE = "http://127.0.0.1:44755";

// ─── i18n System ───────────────────────────────────────────────
const SUPPORTED_LANGS = ["en", "tr", "ru", "pt", "de", "nl", "fr", "it", "es", "pl", "bg", "sr", "be"];
let currentLang = {};
let currentLangCode = "en";

function loadLanguageSync(code) {
    const langPath = path.join(__dirname, "lang", `${code}.json`);
    try {
        const raw = fs.readFileSync(langPath, "utf-8");
        currentLang = JSON.parse(raw);
        currentLangCode = code;
    } catch (err) {
        console.error(`Failed to load language ${code}:`, err);
        // Fallback to English
        if (code !== "en") loadLanguageSync("en");
    }
}

// Resolve dotted key like "settings.title"
function t(key, replacements) {
    const keys = key.split(".");
    let val = currentLang;
    for (const k of keys) {
        if (val && typeof val === "object" && k in val) {
            val = val[k];
        } else {
            return key; // fallback: return key itself
        }
    }
    if (typeof val === "string" && replacements) {
        for (const [rk, rv] of Object.entries(replacements)) {
            val = val.replace(`{${rk}}`, rv);
        }
    }
    return val;
}

let cachedFullName = null;
function getSystemFullName() {
    if (cachedFullName) return cachedFullName;
    try {
        cachedFullName = os.userInfo().username;
    } catch (e) {
        cachedFullName = os.hostname().split(".")[0] || "User";
    }

    if (cachedFullName) {
        cachedFullName = cachedFullName.charAt(0).toUpperCase() + cachedFullName.slice(1);
    }
    return cachedFullName || "User";
}

// Apply translations to all elements with data-i18n attribute
function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        const translated = t(key);
        if (typeof translated === "string") {
            el.textContent = translated;
        }
    });

    // Apply placeholder translations
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-i18n-placeholder");
        const translated = t(key);
        if (typeof translated === "string") {
            el.placeholder = translated;
        }
    });

    // Apply title translations
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
        const key = el.getAttribute("data-i18n-title");
        const translated = t(key);
        if (typeof translated === "string") {
            el.title = translated;
        }
    });

    const motivationalPhrases = t("landing.motivationalPhrases");
    const headerTitle = document.querySelector(".hero-title");
    if (headerTitle && Array.isArray(motivationalPhrases) && motivationalPhrases.length > 0) {
        if (!headerTitle.hasAttribute('data-set-lang') || headerTitle.getAttribute('data-set-lang') !== currentLangCode) {
            const randomPhrase = motivationalPhrases[Math.floor(Math.random() * motivationalPhrases.length)];
            headerTitle.textContent = randomPhrase;
            headerTitle.setAttribute('data-set-lang', currentLangCode);
        }
    }

    const greetingEl = document.getElementById("hero-greeting");
    if (greetingEl) {
        try {
            const name = getSystemFullName();
            greetingEl.textContent = t("landing.hello", { name });
        } catch (e) {
            greetingEl.textContent = t("landing.hello", { name: os.hostname().split(".")[0] || "User" });
        }
    }
}

function detectOSLanguage() {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || navigator.language || "en";
    const langCode = locale.split("-")[0].toLowerCase();
    return SUPPORTED_LANGS.includes(langCode) ? langCode : "en";
}

function initLanguage() {
    const saved = localStorage.getItem("app_language");
    const code = saved || detectOSLanguage();
    loadLanguageSync(code);
    localStorage.setItem("app_language", code);
    applyTranslations();
    // Set dropdown value
    const langSelect = document.getElementById("language-select");
    if (langSelect) langSelect.value = code;
}

const marked = new Marked(
    markedHighlight({
        langPrefix: "hljs language-",
        highlight(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
    })
);

marked.setOptions({
    breaks: true,
    gfm: true,
});

const messagesEl = document.getElementById("messages");
const welcomeEl = document.getElementById("welcome");
const inputEl = document.getElementById("message-input");
const sendBtn = document.getElementById("btn-send");
const themeBtn = document.getElementById("btn-theme");
const settingsBtn = document.getElementById("btn-settings");
const ghostBtn = document.getElementById("btn-ghost");
const modelBtn = document.getElementById("btn-model-select");
const modelPopover = document.getElementById("model-popover");
const moreModelsBtn = document.getElementById("more-models-btn");
const moreModelsSection = document.getElementById("more-models-section");
const modalOverlay = document.getElementById("modal-overlay");
const apiKeyInput = document.getElementById("api-key-input");
const saveKeyBtn = document.getElementById("btn-save-key");
const toggleKeyBtn = document.getElementById("btn-toggle-key");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const iconMoon = document.getElementById("icon-moon");
const iconSun = document.getElementById("icon-sun");
const getKeyLink = document.getElementById("get-key-link");
const hljsThemeLink = document.getElementById("hljs-theme");

// New UI Elements
const btnAttach = document.getElementById("btn-attach");
const btnSearch = document.getElementById("btn-search");
const btnCode = document.getElementById("btn-code");
const imageUpload = document.getElementById("image-upload");
const imagePreview = document.getElementById("image-preview");
const previewImg = document.getElementById("preview-img");
const btnRemoveImg = document.getElementById("btn-remove-img");

const systemPromptInput = document.getElementById("system-prompt-input");
const tempSlider = document.getElementById("temp-slider");
const tempVal = document.getElementById("temp-val");

// State Variables
let isProcessing = false;
let currentModel = "gemini-1.5-pro";
let currentThinkingLevel = "none"; // Disabled by default until toggle is checked
let useSearch = true; // Web Grounding default ON
let useCode = false;
let attachedImageBase64 = null;
let attachedImageMimeType = null;
let isExplainingError = false; // Guard flag to prevent recursive error loops
let userAvatarBase64 = null;

async function loadUserAvatar() {
    return new Promise((resolve) => {
        if (os.platform() === 'darwin') {
            const username = os.userInfo().username;
            exec(`dscl . -read /Users/${username} JPEGPhoto | tail -n +2 | xxd -r -p | base64`, (err, stdout) => {
                const b64 = stdout ? stdout.trim() : "";
                if (!err && b64.length > 100) {
                    userAvatarBase64 = `data:image/jpeg;base64,${b64}`;
                }
                resolve();
            });
        } else if (os.platform() === 'win32') {
            // Windows 10/11 typically stores the current user's picture path in this registry key
            const script = `
            $path = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AccountPicture' -Name 'SourceId' -ErrorAction SilentlyContinue).SourceId;
            if ($path -and (Test-Path $path)) {
                [Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
            }
            `;
            exec(`powershell -NoProfile -Command "${script.replace(/\n/g, '')}"`, (err, stdout) => {
                const b64 = stdout ? stdout.trim() : "";
                if (!err && b64.length > 100) {
                    // Windows Account pictures can be JPEG or PNG. Data URI jpeg works nicely for both if base64 content is valid, 
                    // or we check the magic bytes. We'll default to jpeg or png based on header, or just use image/jpeg as a fallback.
                    const mime = b64.startsWith("/9j/") ? "image/jpeg" : "image/png";
                    userAvatarBase64 = `data:${mime};base64,${b64}`;
                }
                resolve();
            });
        } else {
            resolve();
        }
    });
}

function initTheme() {
    const saved = localStorage.getItem("theme");
    let theme;
    if (saved) {
        theme = saved;
    } else {
        // Detect OS color scheme (works on macOS & Windows)
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = prefersDark ? "dark" : "light";
        localStorage.setItem("theme", theme);
    }
    document.documentElement.setAttribute("data-theme", theme);
    updateThemeIcons(theme);
    updateHljsTheme(theme);

    // Listen for OS theme changes in real-time
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            const newTheme = e.matches ? "dark" : "light";
            document.documentElement.setAttribute("data-theme", newTheme);
            localStorage.setItem("theme", newTheme);
            updateThemeIcons(newTheme);
            updateHljsTheme(newTheme);
            updateThemeIcons(newTheme);
            updateHljsTheme(newTheme);
        });
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateThemeIcons(next);
    updateHljsTheme(next);
}

function updateThemeIcons(theme) {
    if (theme === "dark") {
        iconMoon.style.display = "block";
        iconSun.style.display = "none";
    } else {
        iconMoon.style.display = "none";
        iconSun.style.display = "block";
    }
}

function updateHljsTheme(theme) {
    if (theme === "dark") {
        hljsThemeLink.href = "node_modules/highlight.js/styles/github-dark.min.css";
    } else {
        hljsThemeLink.href = "node_modules/highlight.js/styles/github.min.css";
    }
}

async function checkStatus() {
    try {
        const res = await fetch(`${API_BASE}/chat/status`);
        const data = await res.json();
        if (data.api_key_set) {
            statusDot.className = "connected";
            statusText.textContent = t("status.connected");
            return true;
        } else {
            statusDot.className = "disconnected";
            statusText.textContent = t("status.apiKeyNotSet");
            return false;
        }
    } catch {
        statusDot.className = "disconnected";
        statusText.textContent = t("status.serverNotRunning");
        return false;
    }
}

async function setApiKey(key) {
    const res = await fetch(`${API_BASE}/chat/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key }),
    });
    return res.ok;
}

let savedApiKeyLoaded = false; // Track if the displayed key is the masked saved one

async function showModal() {
    modalOverlay.classList.remove("hidden");

    // If we have a saved key, show masked version
    try {
        const result = await ipcRenderer.invoke("load-api-key");
        if (result.key) {
            const key = result.key;
            // Mask: show first 4 and last 4, rest as dots
            const masked = key.length > 8
                ? key.substring(0, 4) + "•".repeat(key.length - 8) + key.substring(key.length - 4)
                : "•".repeat(key.length);
            apiKeyInput.value = masked;
            apiKeyInput.type = "password";
            savedApiKeyLoaded = true;
        } else {
            apiKeyInput.value = "";
            savedApiKeyLoaded = false;
        }
    } catch {
        savedApiKeyLoaded = false;
    }

    apiKeyInput.focus();
}

// When user starts typing, clear the masked key
apiKeyInput.addEventListener("focus", () => {
    if (savedApiKeyLoaded) {
        apiKeyInput.value = "";
        apiKeyInput.placeholder = t("settings.enterNewKey");
        savedApiKeyLoaded = false;
    }
});

// Prevent copying the masked value
apiKeyInput.addEventListener("copy", (e) => {
    e.preventDefault();
});

function hideModal() {
    modalOverlay.classList.add("hidden");
}

// ─── Chat Tree State ───────────────────────────────────────────────
const chatTree = {};
let activeNodeId = null;

function createNode(role, content, parentId = null, extraNodesHTML = "", images = [], info = null) {
    const id = "node_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    const node = {
        id,
        parentId,
        role,
        content,
        extraNodesHTML,
        images,
        children: [],
        timestamp: new Date().toISOString(),
        duration: 0,
        info
    };
    chatTree[id] = node;
    if (parentId && chatTree[parentId]) {
        chatTree[parentId].children.push(id);
    }
    return node;
}

function getBranchPath(leafId) {
    const path = [];
    let curr = leafId;
    while (curr && chatTree[curr]) {
        path.unshift(chatTree[curr]);
        curr = chatTree[curr].parentId;
    }
    return path;
}

function getDeepestLeaf(nodeId) {
    let curr = chatTree[nodeId];
    while (curr && curr.children.length > 0) {
        curr = chatTree[curr.children[curr.children.length - 1]];
    }
    return curr ? curr.id : nodeId;
}

function buildGeminiHistory(leafId) {
    const path = getBranchPath(leafId);
    const history = [];
    for (const node of path) {
        let parts = [];
        if (node.images && node.images.length > 0) {
            node.images.forEach(img => {
                const partsMatch = img.match(/^data:(image\/[a-zA-Z]*);base64,(.*)$/);
                if (partsMatch && partsMatch.length === 3) {
                    parts.push({
                        inlineData: {
                            mimeType: partsMatch[1],
                            data: partsMatch[2]
                        }
                    });
                }
            });
        }
        if (node.content) {
            // Check if it was an error message
            if (node.role === "assistant" && node.content.startsWith("Error [")) continue;
            parts.push({ text: node.content });
        }
        // Include tool results if stored in extraNodes
        if (parts.length > 0) {
            history.push({
                role: node.role === "assistant" ? "model" : "user",
                parts: parts
            });
        }
    }
    return history;
}

function deleteNode(nodeId) {
    const node = chatTree[nodeId];
    if (!node) return;

    let variants;
    if (node.parentId && chatTree[node.parentId]) {
        const parent = chatTree[node.parentId];
        parent.children = parent.children.filter(id => id !== nodeId);
        variants = parent.children;
    } else {
        chatTree[nodeId].orphan = true;
        variants = Object.keys(chatTree).filter(k => chatTree[k].parentId === null && !chatTree[k].orphan);
    }

    let newActiveId = node.parentId;
    if (variants.length > 0) {
        newActiveId = variants[variants.length - 1];
    }

    if (newActiveId) {
        activeNodeId = getDeepestLeaf(newActiveId);
        renderBranch(activeNodeId);
    } else {
        activeNodeId = null;
        renderBranch(null);
    }
}

function renderBranch(leafId) {
    messagesEl.innerHTML = "";
    if (!leafId) {
        document.getElementById("chat-container").classList.add("chat-empty");
        welcomeEl.style.display = "flex";
        return;
    }
    const path = getBranchPath(leafId);
    path.forEach(node => {
        const contentEl = addMessageToDOM(node.role, node.content, [], node.images, node.id, true, node.info);
        if (node.extraNodesHTML) {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = node.extraNodesHTML;
            Array.from(wrapper.children).forEach(child => contentEl.appendChild(child));
        }
    });
    scrollToBottom();
}

function addMessageToDOM(role, content, extraNodes = [], images = [], nodeId = null, isReplay = false, info = null) {
    const chatContainer = document.getElementById("chat-container");
    if (chatContainer.classList.contains("chat-empty")) {
        if (document.startViewTransition) {
            document.startViewTransition(() => {
                chatContainer.classList.remove("chat-empty");
            });
        } else {
            chatContainer.classList.remove("chat-empty");
        }
    }

    if (welcomeEl) {
        welcomeEl.style.display = "none";
    }

    const msgEl = document.createElement("div");
    msgEl.className = "message";
    if (nodeId) msgEl.setAttribute("data-id", nodeId);

    const innerEl = document.createElement("div");
    innerEl.className = "message-inner";

    const headerEl = document.createElement("div");
    headerEl.className = "message-header";

    const avatarEl = document.createElement("div");
    avatarEl.className = `message-avatar ${role}`;
    const displayName = role === "user" ? getSystemFullName() : currentModel;

    if (role === "user") {
        if (userAvatarBase64) {
            avatarEl.innerHTML = `<img src="${userAvatarBase64}" alt="User Profile"/>`;
        } else {
            avatarEl.textContent = displayName.charAt(0).toUpperCase();
        }
    } else {
        avatarEl.innerHTML = `<svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.3825 28.3045C22.4796 26.4903 26.4903 22.4796 28.3045 17.3825L31.0579 9.64686C31.3733 8.76063 32.6267 8.76063 32.9421 9.64686L35.6955 17.3825C37.5097 22.4796 41.5204 26.4903 46.6175 28.3045L54.3531 31.0579C55.2394 31.3733 55.2394 32.6267 54.3531 32.9421L46.6175 35.6955C41.5204 37.5097 37.5097 41.5204 35.6955 46.6175L32.9421 54.3531C32.6267 55.2394 31.3733 55.2394 31.0579 54.3531L28.3045 46.6175C26.4903 41.5204 22.4796 37.5097 17.3825 35.6955L9.64686 32.9421C8.76063 32.6267 8.76063 31.3733 9.64686 31.0579L17.3825 28.3045Z" fill="var(--accent)"/></svg>`;
    }

    const roleEl = document.createElement("span");
    roleEl.className = "message-role";
    roleEl.textContent = displayName;

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const fullTimeString = now.toLocaleString();

    const timeEl = document.createElement("span");
    timeEl.className = "message-time";
    timeEl.textContent = ` - ${timeString}`;
    timeEl.title = fullTimeString;

    headerEl.appendChild(avatarEl);
    headerEl.appendChild(roleEl);
    headerEl.appendChild(timeEl);

    if (info) {
        const infoBadge = document.createElement("div");
        infoBadge.className = "message-info-badge";

        const timeIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        const tokensIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`;

        infoBadge.innerHTML = `
            <span class="info-item" title="Tokens generated">${tokensIcon} ${info.tokens}</span>
            <span class="info-item" title="Time taken">${timeIcon} ${info.time}s</span>
        `;
        headerEl.appendChild(infoBadge);
    }

    // Add sticky action bar
    if (nodeId && chatTree[nodeId]) {
        const node = chatTree[nodeId];
        const actionBar = createActionBar(node, role);
        headerEl.appendChild(actionBar);
    }

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";

    // Render attached images at top of message
    if (images.length > 0) {
        const imageRow = document.createElement("div");
        imageRow.className = "message-images";
        images.forEach(imgSrc => {
            const thumb = document.createElement("img");
            thumb.className = "message-image-thumb";
            thumb.src = imgSrc;
            thumb.alt = "Attached image";
            thumb.addEventListener("click", () => openImageLightbox(imgSrc));
            imageRow.appendChild(thumb);
        });
        contentEl.appendChild(imageRow);
    }

    if (extraNodes.length > 0) {
        extraNodes.forEach(child => contentEl.appendChild(child));
    }

    const markdownNode = document.createElement("div");
    markdownNode.innerHTML = renderMarkdown(content);
    if (role === "assistant") {
        addCopyButtons(markdownNode);
    }
    contentEl.appendChild(markdownNode);

    innerEl.appendChild(headerEl);
    innerEl.appendChild(contentEl);
    msgEl.appendChild(innerEl);
    messagesEl.appendChild(msgEl);

    if (!isReplay) {
        scrollToBottom();
    }

    return contentEl;
}

function addMessage(role, content, extraNodes = [], images = [], info = null) {
    let extraNodesHTML = "";
    if (extraNodes.length > 0) {
        const wrapper = document.createElement("div");
        extraNodes.forEach(node => wrapper.appendChild(node.cloneNode(true)));
        extraNodesHTML = wrapper.innerHTML;
    }
    const node = createNode(role, content, activeNodeId, extraNodesHTML, images, info);
    activeNodeId = node.id;
    return addMessageToDOM(role, content, extraNodes, images, node.id, false, info);
}

function createActionBar(node, role) {
    const container = document.createElement("div");
    container.className = "message-actions-container";

    const variants = node.parentId ? chatTree[node.parentId].children : Object.keys(chatTree).filter(k => chatTree[k].parentId === null && !chatTree[k].orphan);
    if (variants.length > 1) {
        const idx = variants.indexOf(node.id);
        const pageEl = document.createElement("div");
        pageEl.className = "action-pagination";

        const prevBtn = document.createElement("button");
        prevBtn.innerHTML = "&lt;";
        prevBtn.disabled = idx === 0;
        prevBtn.onclick = () => {
            if (isProcessing) return;
            if (idx > 0) {
                activeNodeId = getDeepestLeaf(variants[idx - 1]);
                renderBranch(activeNodeId);
            }
        };

        const nextBtn = document.createElement("button");
        nextBtn.innerHTML = "&gt;";
        nextBtn.disabled = idx === variants.length - 1;
        nextBtn.onclick = () => {
            if (isProcessing) return;
            if (idx < variants.length - 1) {
                activeNodeId = getDeepestLeaf(variants[idx + 1]);
                renderBranch(activeNodeId);
            }
        };

        const label = document.createElement("span");
        label.textContent = `${idx + 1} / ${variants.length}`;

        pageEl.appendChild(prevBtn);
        pageEl.appendChild(label);
        pageEl.appendChild(nextBtn);
        container.appendChild(pageEl);
    }

    const btnGroup = document.createElement("div");
    btnGroup.className = "action-btn-group";

    if (role === "user") {
        const editBtn = document.createElement("button");
        editBtn.className = "msg-action-btn icon-only";
        editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
        editBtn.title = "Edit";
        editBtn.onclick = (e) => {
            if (isProcessing) return;
            const messageEl = e.target.closest('.message');
            const contentContainer = messageEl.querySelector('.message-content');
            if (contentContainer.querySelector('.inline-edit-container')) return;

            const markdownNodes = Array.from(contentContainer.children).filter(c => !c.classList.contains('message-images'));
            markdownNodes.forEach(n => n.style.display = 'none');

            const actionBar = messageEl.querySelector('.message-actions-container');
            if (actionBar) actionBar.style.display = 'none';

            const editContainer = document.createElement('div');
            editContainer.className = 'inline-edit-container';

            const textarea = document.createElement('textarea');
            textarea.className = 'inline-edit-textarea';
            textarea.value = node.content;

            const resizeTextarea = () => {
                textarea.style.height = 'auto';
                textarea.style.height = Math.max(56, textarea.scrollHeight) + 'px';
            };
            textarea.addEventListener('input', resizeTextarea);
            setTimeout(resizeTextarea, 0);

            const btnRow = document.createElement('div');
            btnRow.className = 'inline-edit-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'inline-edit-cancel';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => {
                editContainer.remove();
                markdownNodes.forEach(n => n.style.display = '');
                if (actionBar) actionBar.style.display = '';
            };

            const saveBtn = document.createElement('button');
            saveBtn.className = 'inline-edit-save';
            saveBtn.textContent = 'Save & Submit';
            saveBtn.onclick = () => {
                const newText = textarea.value.trim();
                if (!newText) return;

                editContainer.remove();
                markdownNodes.forEach(n => n.style.display = '');
                if (actionBar) actionBar.style.display = '';

                activeNodeId = node.parentId;
                let overrideImages = null;
                if (node.images && node.images.length > 0) {
                    const match = node.images[0].match(/^data:(image\/[a-zA-Z]*);base64,(.*)$/);
                    if (match) { overrideImages = { base64: match[2], mime: match[1], fullArray: node.images }; }
                }
                sendMessage(newText, overrideImages);
            };

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(saveBtn);
            editContainer.appendChild(textarea);
            editContainer.appendChild(btnRow);

            contentContainer.appendChild(editContainer);
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        };

        const rerunBtn = document.createElement("button");
        rerunBtn.className = "msg-action-btn icon-only";
        rerunBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>`;
        rerunBtn.title = "Rerun";
        rerunBtn.onclick = (e) => {
            if (isProcessing) return;
            activeNodeId = node.parentId;
            let overrideImages = null;
            if (node.images && node.images.length > 0) {
                const match = node.images[0].match(/^data:(image\/[a-zA-Z]*);base64,(.*)$/);
                if (match) { overrideImages = { base64: match[2], mime: match[1], fullArray: node.images }; }
            }
            sendMessage(node.content, overrideImages);
        };

        const copyBtn = document.createElement("button");
        copyBtn.className = "msg-action-btn icon-only";
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        copyBtn.title = "Copy";
        copyBtn.onclick = (e) => {
            navigator.clipboard.writeText(node.content);
            showToast("Copied to clipboard", "info");
        };

        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(rerunBtn);
        btnGroup.appendChild(copyBtn);

    } else {
        const rerunBtn = document.createElement("button");
        rerunBtn.className = "msg-action-btn icon-only";
        rerunBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>`;
        rerunBtn.title = "Regenerate";
        rerunBtn.onclick = (e) => {
            if (isProcessing) return;
            const userParent = chatTree[node.parentId];
            if (userParent) {
                activeNodeId = userParent.id;
                let overrideImages = null;
                if (userParent.images && userParent.images.length > 0) {
                    const match = userParent.images[0].match(/^data:(image\/[a-zA-Z]*);base64,(.*)$/);
                    if (match) { overrideImages = { base64: match[2], mime: match[1], fullArray: userParent.images }; }
                }
                sendMessage(userParent.content, overrideImages, true);
            }
        };

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "msg-action-btn danger icon-only";
        deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        deleteBtn.title = "Delete";
        deleteBtn.onclick = (e) => {
            if (isProcessing) return;
            deleteNode(node.id);
        };

        btnGroup.appendChild(rerunBtn);
        btnGroup.appendChild(deleteBtn);
    }

    container.appendChild(btnGroup);
    return container;
}

// Fullscreen image lightbox
function openImageLightbox(src) {
    let overlay = document.getElementById("image-lightbox");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "image-lightbox";
        overlay.innerHTML = `
            <button class="lightbox-close" id="lightbox-close">&times;</button>
            <img class="lightbox-img" id="lightbox-img" draggable="false" />
        `;
        document.body.appendChild(overlay);

        const closeBtn = overlay.querySelector("#lightbox-close");
        const img = overlay.querySelector("#lightbox-img");

        let scale = 1;
        let translateX = 0;
        let translateY = 0;
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartTX = 0;
        let dragStartTY = 0;

        function applyTransform() {
            img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        }

        // Close button
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            overlay.classList.remove("active");
        });

        // Click background to close (only if not zoomed)
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay && scale <= 1) {
                overlay.classList.remove("active");
            }
        });

        // Click image to toggle zoom
        img.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!isDragging) {
                if (scale <= 1) {
                    scale = 2.5;
                    translateX = 0;
                    translateY = 0;
                } else {
                    scale = 1;
                    translateX = 0;
                    translateY = 0;
                }
                applyTransform();
                img.style.cursor = scale > 1 ? "grab" : "zoom-in";
            }
        });

        // Mouse drag to pan when zoomed
        img.addEventListener("mousedown", (e) => {
            if (scale > 1) {
                e.preventDefault();
                isDragging = false;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                dragStartTX = translateX;
                dragStartTY = translateY;
                img.style.cursor = "grabbing";
                img.style.transition = "none"; // Instant movement

                const onMove = (ev) => {
                    const dx = ev.clientX - dragStartX;
                    const dy = ev.clientY - dragStartY;
                    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
                    translateX = dragStartTX + dx;
                    translateY = dragStartTY + dy;
                    applyTransform();
                };

                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    img.style.transition = "transform 0.2s ease"; // Restore
                    img.style.cursor = scale > 1 ? "grab" : "zoom-in";
                    setTimeout(() => { isDragging = false; }, 10);
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            }
        });

        // Scroll wheel zoom
        overlay.addEventListener("wheel", (e) => {
            e.preventDefault();
            scale += e.deltaY * -0.003;
            scale = Math.min(Math.max(0.5, scale), 8);
            if (scale <= 1) { translateX = 0; translateY = 0; }
            applyTransform();
            img.style.cursor = scale > 1 ? "grab" : "zoom-in";
        }, { passive: false });

        // Reset state
        overlay._reset = () => {
            scale = 1;
            translateX = 0;
            translateY = 0;
            isDragging = false;
            img.style.transform = "translate(0px, 0px) scale(1)";
            img.style.cursor = "zoom-in";
        };
    }

    overlay._reset();
    overlay.querySelector("#lightbox-img").src = src;
    overlay.classList.add("active");
}

function showToast(message, type = 'info') {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    let icon = '';
    if (type === 'error') {
        icon = `<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    } else if (type === 'warning') {
        icon = `<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    } else {
        icon = `<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    toast.innerHTML = `${icon}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("removing");
        toast.addEventListener("animationend", () => {
            toast.remove();
        });
    }, 5000);
}

async function fetchModels() {
    try {
        const res = await fetch(`${API_BASE}/chat/models`);
        if (!res.ok) return;
        const data = await res.json();
        const models = data.models || [];
        if (models.length === 0) return;

        const popover = document.getElementById("model-popover");
        const divider = popover.querySelector(".popover-divider");

        let current = popover.firstChild;
        while (current && current !== divider) {
            let next = current.nextSibling;
            if (current.classList && current.classList.contains("model-option")) {
                popover.removeChild(current);
            }
            current = next;
        }

        const moreSection = document.getElementById("more-models-section");
        moreSection.innerHTML = "";

        // Sort prioritized: prefer 3.1 > 2.5 > 2.0 > 1.5 (newest first)
        const scoreName = (name) => {
            if (name.includes('3.1')) return 4;
            if (name.includes('2.5')) return 3;
            if (name.includes('2.0')) return 2;
            if (name.includes('1.5')) return 1;
            return 0;
        };

        function createModelOption(model, isActive = false) {
            const div = document.createElement("div");
            div.className = `model-option${isActive ? " active" : ""}`;
            const shortName = model.name.split("/").pop();
            div.setAttribute("data-model", shortName);

            const displayName = model.display_name || shortName;
            const rawDesc = model.description || '';
            const desc = rawDesc.length > 60 ? rawDesc.substring(0, 60) + '…' : rawDesc;

            div.innerHTML = `
                <div class="model-header">
                    <span class="model-name">${displayName}</span>
                </div>
                <div class="model-desc">${desc}</div>
                <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;

            div.addEventListener("click", () => {
                selectModel(div);
            });

            return div;
        }


        const allSorted = [...models].sort((a, b) => scoreName(b.name) - scoreName(a.name));

        // Top 3 go in main list, rest go under More models
        const topModels = allSorted.slice(0, 3);
        const moreModels = allSorted.slice(3);

        topModels.forEach((m) => {
            const shortName = m.name.split("/").pop();
            const div = createModelOption(m, shortName === currentModel);
            popover.insertBefore(div, divider);
        });

        // Auto-select the first model and update button label
        const firstModel = popover.querySelector(".model-option");
        if (firstModel) {
            selectModel(firstModel, false);
        }

        moreModels.forEach(m => {
            const shortName = m.name.split("/").pop();
            const div = createModelOption(m, shortName === currentModel);
            moreSection.appendChild(div);
        });

    } catch (err) {
        console.error("Failed to fetch models:", err);
    }
}

function selectModel(opt, hidePopover = true) {
    document.querySelectorAll(".model-option").forEach(o => o.classList.remove("active"));
    opt.classList.add("active");
    currentModel = opt.getAttribute("data-model");
    const textLabel = opt.querySelector(".model-name").textContent.trim();
    modelBtn.innerHTML = `${textLabel} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px;"><path d="m6 9 6 6 6-6"/></svg>`;
    if (hidePopover) modelPopover.classList.add("hidden");
}

function addTypingIndicator() {
    const chatContainer = document.getElementById("chat-container");
    if (chatContainer.classList.contains("chat-empty")) {
        if (document.startViewTransition) {
            document.startViewTransition(() => {
                chatContainer.classList.remove("chat-empty");
            });
        } else {
            chatContainer.classList.remove("chat-empty");
        }
    }


    const msgEl = document.createElement("div");
    msgEl.className = "message";
    msgEl.id = "typing-message";

    const innerEl = document.createElement("div");
    innerEl.className = "message-inner";

    const headerEl = document.createElement("div");
    headerEl.className = "message-header";

    const avatarEl = document.createElement("div");
    avatarEl.className = "message-avatar assistant";
    const displayName = currentModel;
    avatarEl.innerHTML = `<svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.3825 28.3045C22.4796 26.4903 26.4903 22.4796 28.3045 17.3825L31.0579 9.64686C31.3733 8.76063 32.6267 8.76063 32.9421 9.64686L35.6955 17.3825C37.5097 22.4796 41.5204 26.4903 46.6175 28.3045L54.3531 31.0579C55.2394 31.3733 55.2394 32.6267 54.3531 32.9421L46.6175 35.6955C41.5204 37.5097 37.5097 41.5204 35.6955 46.6175L32.9421 54.3531C32.6267 55.2394 31.3733 55.2394 31.0579 54.3531L28.3045 46.6175C26.4903 41.5204 22.4796 37.5097 17.3825 35.6955L9.64686 32.9421C8.76063 32.6267 8.76063 31.3733 9.64686 31.0579L17.3825 28.3045Z" fill="var(--accent)"/></svg>`;

    const roleEl = document.createElement("span");
    roleEl.className = "message-role";
    roleEl.textContent = displayName;

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const fullTimeString = now.toLocaleString();

    const timeEl = document.createElement("span");
    timeEl.className = "message-time";
    timeEl.textContent = ` - ${timeString}`;
    timeEl.title = fullTimeString;

    headerEl.appendChild(avatarEl);
    headerEl.appendChild(roleEl);
    headerEl.appendChild(timeEl);

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";

    // Phase 1: Connecting indicator with three dots
    const connectingEl = document.createElement("div");
    connectingEl.className = "connecting-indicator";
    connectingEl.id = "connecting-phase";
    connectingEl.innerHTML = `
        <div class="dot-group">
            <span></span><span></span><span></span>
        </div>
        <span class="status-text">${t("status.connecting")}</span>
    `;

    contentEl.appendChild(connectingEl);
    innerEl.appendChild(headerEl);
    innerEl.appendChild(contentEl);
    msgEl.appendChild(innerEl);
    messagesEl.appendChild(msgEl);
    scrollToBottom();

    return contentEl;
}

function switchToThinkingPhase() {
    const connectingEl = document.getElementById("connecting-phase");
    if (!connectingEl) return;

    const thinkingEl = document.createElement("div");
    thinkingEl.className = "thinking-indicator";
    thinkingEl.id = "thinking-phase";
    thinkingEl.innerHTML = `
        <svg class="think-icon" viewBox="0 0 24 24">
            <circle class="think-circle" cx="12" cy="12" r="6" />
            <circle class="think-dot" cx="9" cy="12" r="1.2" />
            <circle class="think-dot" cx="12" cy="12" r="1.2" />
            <circle class="think-dot" cx="15" cy="12" r="1.2" />
        </svg>
        <span class="status-text">Düşünüyor...</span>
    `;

    connectingEl.replaceWith(thinkingEl);
}

function addThinkingSection(parentEl, thoughtText) {
    // Parse thought text into lines for timeline
    const lines = thoughtText.split('\n').filter(l => l.trim());
    const summaryLine = lines[0] || 'Düşünüyor...';
    const detailLines = lines.slice(1);

    // Check if thought chain already exists
    let chainEl = parentEl.querySelector(".thought-chain");
    if (chainEl) {
        // Update existing
        const summaryEl = chainEl.querySelector(".thought-summary");
        const bodyEl = chainEl.querySelector(".thought-chain-body");
        summaryEl.innerHTML = marked.parseInline(summaryLine);
        bodyEl.innerHTML = '';
        const timelineEl = buildTimeline(detailLines);
        bodyEl.appendChild(timelineEl);
        return;
    }

    chainEl = document.createElement("div");
    chainEl.className = "thought-chain";

    // Header: sparkle + summary + chevron
    const headerEl = document.createElement("div");
    headerEl.className = "thought-chain-header";

    const sparkle = `<svg class="thought-sparkle" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z"/></svg>`;

    const summaryEl = document.createElement("span");
    summaryEl.className = "thought-summary";
    summaryEl.innerHTML = marked.parseInline(summaryLine);

    const chevron = `<svg class="thought-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;

    headerEl.innerHTML = sparkle;
    headerEl.appendChild(summaryEl);
    headerEl.insertAdjacentHTML("beforeend", chevron);

    // Body: vertical timeline
    const bodyEl = document.createElement("div");
    bodyEl.className = "thought-chain-body";
    const timelineEl = buildTimeline(detailLines);
    bodyEl.appendChild(timelineEl);

    headerEl.addEventListener("click", () => {
        headerEl.classList.toggle("expanded");
        bodyEl.classList.toggle("visible");
    });

    chainEl.appendChild(headerEl);
    chainEl.appendChild(bodyEl);

    // Insert before any existing indicator
    const indicator = parentEl.querySelector(".connecting-indicator, .thinking-indicator");
    if (indicator) {
        parentEl.insertBefore(chainEl, indicator);
    } else {
        parentEl.appendChild(chainEl);
    }

    scrollToBottom();
}

function buildTimeline(lines) {
    const timelineEl = document.createElement("div");
    timelineEl.className = "thought-timeline";

    const icons = [
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    ];

    lines.forEach((line, idx) => {
        const item = document.createElement("div");
        item.className = "thought-timeline-item";

        const iconEl = document.createElement("div");
        iconEl.className = "thought-timeline-icon";
        iconEl.innerHTML = icons[idx % icons.length];

        const textEl = document.createElement("div");
        textEl.className = "thought-timeline-text";
        textEl.innerHTML = marked.parseInline(line.trim());

        item.appendChild(iconEl);
        item.appendChild(textEl);
        timelineEl.appendChild(item);
    });

    return timelineEl;
}

function removeTypingIndicator() {
    const el = document.getElementById("typing-message");
    if (el) el.remove();
}

function addToolCall(parentEl, name, args, status) {
    const toolEl = document.createElement("div");
    toolEl.className = "tool-call";

    const headerEl = document.createElement("div");
    headerEl.className = "tool-call-header";

    const chevron = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;

    const nameEl = document.createElement("span");
    nameEl.className = "tool-call-name";
    nameEl.textContent = name;

    const statusEl = document.createElement("span");
    statusEl.className = "tool-call-status";
    statusEl.textContent = status || "running...";

    headerEl.innerHTML = chevron;
    headerEl.appendChild(nameEl);
    headerEl.appendChild(statusEl);

    const bodyEl = document.createElement("div");
    bodyEl.className = "tool-call-body";
    const argsStr = typeof args === "string" ? args : JSON.stringify(args, null, 2);
    bodyEl.innerHTML = `<pre><code class="hljs language-json">${hljs.highlight(argsStr, { language: 'json' }).value}</code></pre>`;

    headerEl.addEventListener("click", () => {
        headerEl.classList.toggle("expanded");
        bodyEl.classList.toggle("visible");
    });

    toolEl.appendChild(headerEl);
    toolEl.appendChild(bodyEl);

    const indicatorEl = parentEl.querySelector(".connecting-indicator, .thinking-indicator");
    if (indicatorEl) {
        parentEl.insertBefore(toolEl, indicatorEl);
    } else {
        parentEl.appendChild(toolEl);
    }

    scrollToBottom();

    return { statusEl, bodyEl };
}

function renderMarkdown(text) {
    let html = marked.parse(text);

    html = html.replace(/<pre><code(.*?)>/g, (match, attrs) => {
        let lang = "";
        const langMatch = attrs.match(/class="hljs language-(\w+)"/);
        if (langMatch) {
            lang = langMatch[1];
        }
        const header = `<div class="code-header"><span>${lang || "code"}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>`;
        return `<pre>${header}<code${attrs}>`;
    });

    return html;
}

function addCopyButtons(el) {
    el.querySelectorAll("pre code").forEach((block) => {
        block.parentElement.addEventListener("dblclick", () => {
            const text = block.textContent;
            navigator.clipboard.writeText(text);
        });
    });
}

window.copyCode = function (btn) {
    const pre = btn.closest("pre");
    const code = pre.querySelector("code");
    navigator.clipboard.writeText(code.textContent);
    btn.textContent = "Copied!";
    setTimeout(() => {
        btn.textContent = "Copy";
    }, 2000);
};

function scrollToBottom() {
    requestAnimationFrame(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });
}

function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
}

// Parse error strings like "Gemini API returned status 400 Bad Request: { "error": { ... } }"
function parseErrorMessage(rawError, fallbackCode) {
    let message = rawError;
    let code = fallbackCode || '';

    // Try direct JSON parse
    try {
        const parsed = JSON.parse(rawError);
        if (parsed.error) {
            message = parsed.error.message || rawError;
            code = parsed.error.code || fallbackCode;
            return { message, code };
        }
    } catch { /* not pure JSON */ }

    // Try extracting JSON from a prefix string like "... Bad Request: { ... }"
    const jsonMatch = rawError.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.error) {
                message = parsed.error.message || rawError;
                code = parsed.error.code || fallbackCode;
                return { message, code };
            }
        } catch { /* couldn't parse extracted JSON */ }
    }

    return { message, code };
}

// Send error to a reliable AI model for user-friendly explanation
async function explainErrorWithAI(errorCode, toastMsg, rawError) {
    // Guard: if we're already explaining an error, don't try again (prevents infinite loops)
    if (isExplainingError) {
        addMessage("assistant", `Error [${errorCode}]: ${toastMsg}`);
        isProcessing = false;
        sendBtn.disabled = false;
        return;
    }

    isExplainingError = true;
    const explanationModel = "gemini-2.0-flash";
    const prompt = t("errors.aiExplainPrompt", { errorCode, toastMsg, rawError });

    try {
        const explainRes = await fetch(`${API_BASE}/chat/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: prompt,
                model: explanationModel,
                thinking_level: "none",
                temperature: 0.7,
            }),
        });
        if (explainRes.ok) {
            const explainData = await explainRes.json();
            const chatId = explainData.chat_id;
            addTypingIndicator();
            const explainSource = new EventSource(`${API_BASE}/chat/events/${chatId}`);
            let explainText = '';
            explainSource.addEventListener("text", (ev) => {
                const p = JSON.parse(ev.data);
                explainText += p.content;
            });
            explainSource.addEventListener("done", () => {
                explainSource.close();
                removeTypingIndicator();
                if (explainText) addMessage("assistant", explainText);
                isProcessing = false;
                sendBtn.disabled = false;
                isExplainingError = false;
            });
            explainSource.addEventListener("error_msg", () => {
                explainSource.close();
                removeTypingIndicator();
                addMessage("assistant", `Error [${errorCode}]: ${toastMsg}`);
                isProcessing = false;
                sendBtn.disabled = false;
                isExplainingError = false;
            });
            explainSource.onerror = () => {
                explainSource.close();
                removeTypingIndicator();
                addMessage("assistant", `Error [${errorCode}]: ${toastMsg}`);
                isProcessing = false;
                sendBtn.disabled = false;
                isExplainingError = false;
            };
        } else {
            addMessage("assistant", `Error [${errorCode}]: ${toastMsg}`);
            isProcessing = false;
            sendBtn.disabled = false;
            isExplainingError = false;
        }
    } catch {
        addMessage("assistant", `Error [${errorCode}]: ${toastMsg}`);
        isProcessing = false;
        sendBtn.disabled = false;
        isExplainingError = false;
    }
}

async function sendMessage(overrideText = null, overrideImages = null, isAiRerun = false) {
    const text = overrideText !== null ? overrideText : inputEl.value.trim();
    if (!text || isProcessing) return;

    isProcessing = true;
    sendBtn.disabled = true;
    if (overrideText === null) {
        inputEl.value = "";
        autoResize();
    }

    // Capture image for display before clearing
    const messageImages = [];
    let sendImageBase64 = null;
    let sendImageMime = null;

    if (overrideImages) {
        if (overrideImages.fullArray) {
            messageImages.push(...overrideImages.fullArray);
        } else {
            messageImages.push(`data:${overrideImages.mime};base64,${overrideImages.base64}`);
        }
        sendImageBase64 = overrideImages.base64;
        sendImageMime = overrideImages.mime;
    } else if (attachedImageBase64 && attachedImageMimeType) {
        messageImages.push(`data:${attachedImageMimeType};base64,${attachedImageBase64}`);
        sendImageBase64 = attachedImageBase64;
        sendImageMime = attachedImageMimeType;

        // Clear attachment
        attachedImageBase64 = null;
        attachedImageMimeType = null;
        imagePreview.classList.add("hidden");
        previewImg.src = "";
        imageUpload.value = "";
    }

    let historyNodeId = activeNodeId;
    if (isAiRerun && activeNodeId && chatTree[activeNodeId]) {
        historyNodeId = chatTree[activeNodeId].parentId;
    }

    const historyPayload = buildGeminiHistory(historyNodeId);

    // Sync visual DOM if appending to a historic branching point
    const displayedMessages = document.querySelectorAll('.message');
    const lastMessage = displayedMessages.length > 0 ? displayedMessages[displayedMessages.length - 1] : null;
    const isAtBottom = lastMessage && lastMessage.getAttribute('data-id') === activeNodeId;

    if (!isAtBottom && activeNodeId !== null) {
        renderBranch(activeNodeId);
    } else if (activeNodeId === null && displayedMessages.length > 0) {
        renderBranch(null);
    }

    if (!isAiRerun) {
        addMessage("user", text, [], messageImages);
    }

    const assistantContent = addTypingIndicator();

    // Start tracking time for the assistant node
    const startTimeStamp = Date.now();

    // Build the expanded payload
    const payload = {
        message: text,
        model: currentModel,
        thinking_level: currentThinkingLevel,
        temperature: parseFloat(tempSlider.value),
        enable_google_search: useSearch,
        enable_code_execution: useCode,
        history: historyPayload
    };

    const sysPrompt = systemPromptInput.value.trim();
    if (sysPrompt) {
        payload.system_instruction = sysPrompt;
    }

    if (sendImageBase64 && sendImageMime) {
        payload.image_base64 = sendImageBase64;
        payload.image_mime_type = sendImageMime;
    }

    let infoData = null;

    try {
        const res = await fetch(`${API_BASE}/chat/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const errText = await res.text();
            const { message: toastMessage, code: errorCode } = parseErrorMessage(errText, res.status);
            removeTypingIndicator();
            showToast(toastMessage, "error");

            // Send error to AI model for explanation using a reliable model
            await explainErrorWithAI(errorCode, toastMessage, errText);
            return;
        }

        const data = await res.json();
        const chatId = data.chat_id;

        const evtSource = new EventSource(`${API_BASE}/chat/events/${chatId}`);

        let toolCalls = {};
        let finalText = "";
        let totalTokens = 0;

        let switchedToThinking = false;

        evtSource.addEventListener("tool_call", (e) => {
            if (!switchedToThinking) {
                switchToThinkingPhase();
                switchedToThinking = true;
            }
            const payload = JSON.parse(e.data);
            const refs = addToolCall(
                assistantContent,
                payload.name,
                payload.args,
                "running..."
            );
            toolCalls[payload.name + "_" + (payload.call_index || 0)] = refs;
        });

        evtSource.addEventListener("tool_result", (e) => {
            const payload = JSON.parse(e.data);
            const key = payload.name + "_" + (payload.call_index || 0);
            const refs = toolCalls[key];
            if (refs) {
                refs.statusEl.textContent = "completed";
                const currentText = refs.bodyEl.textContent;
                const newText = currentText + "\n\n--- Result ---\n" + payload.result;
                refs.bodyEl.innerHTML = `<pre><code class="hljs language-json">${hljs.highlightAuto(newText).value}</code></pre>`;
            }
        });

        evtSource.addEventListener("thinking", (e) => {
            if (!switchedToThinking) {
                switchToThinkingPhase();
                switchedToThinking = true;
            }
            const payload = JSON.parse(e.data);
            addThinkingSection(assistantContent, payload.content);
        });

        evtSource.addEventListener("text", (e) => {
            if (!switchedToThinking) {
                switchToThinkingPhase();
                switchedToThinking = true;
            }
            const payload = JSON.parse(e.data);
            finalText += payload.content;

            // Rough estimate mapping if exact tokens aren't streamed
            // Avg 4 chars per token
            totalTokens += Math.ceil(payload.content.length / 4);
        });

        evtSource.addEventListener("done", () => {
            evtSource.close();

            const durationMs = Date.now() - startTimeStamp;
            const durationSec = (durationMs / 1000).toFixed(1);
            infoData = { tokens: totalTokens, time: durationSec };

            // Instead of just collecting inner nodes and removing the typing message which destroys them
            const typingMsg = document.getElementById("typing-message");
            const extraNodes = [];
            if (typingMsg) {
                // Relocate nodes from typingMsg directly to extraNodes list
                const nodesToKeep = typingMsg.querySelectorAll('.thought-chain, .tool-call');
                nodesToKeep.forEach(node => {
                    extraNodes.push(node);
                });
            }

            if (finalText) {
                // addMessage will append extraNodes
                addMessage("assistant", finalText, extraNodes, [], infoData);
                if (activeNodeId && chatTree[activeNodeId]) {
                    chatTree[activeNodeId].info = infoData;
                }
            } else if (extraNodes.length > 0) {
                // Even if no text, keep the thought chain
                addMessage("assistant", "", extraNodes, [], infoData);
                if (activeNodeId && chatTree[activeNodeId]) {
                    chatTree[activeNodeId].info = infoData;
                }
            }

            removeTypingIndicator();

            isProcessing = false;
            sendBtn.disabled = false;
            inputEl.focus();
        });

        evtSource.addEventListener("error_msg", async (e) => {
            evtSource.close();
            removeTypingIndicator();
            const payload = JSON.parse(e.data);
            const rawError = payload.error;
            const { message: toastMsg, code: errorCode } = parseErrorMessage(rawError, '');
            showToast(toastMsg, "error");

            // Send error to AI for explanation using a reliable model
            await explainErrorWithAI(errorCode, toastMsg, rawError);
        });

        evtSource.onerror = () => {
            evtSource.close();
            removeTypingIndicator();
            if (!finalText) {
                const msg = "Connection lost. Please try again.";
                addMessage("assistant", msg);
                showToast(msg, "error");
            }
            isProcessing = false;
            sendBtn.disabled = false;
        };
    } catch (err) {
        removeTypingIndicator();
        const msg = `Connection error: ${err.message}`;
        addMessage("assistant", msg);
        showToast(msg, "error");
        isProcessing = false;
        sendBtn.disabled = false;
    }
}

modelBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    const rect = modelBtn.getBoundingClientRect();
    const titlebarHeight = document.getElementById("titlebar").offsetHeight || 44;
    const spaceAbove = rect.top - titlebarHeight - 8; // Don't overflow past titlebar
    const spaceBelow = window.innerHeight - rect.bottom - 16;
    const popoverHeight = 350;

    if (spaceBelow < popoverHeight && !document.getElementById("chat-container").classList.contains("chat-empty")) {
        modelPopover.classList.add("open-up");
        modelPopover.style.maxHeight = Math.max(200, spaceAbove) + "px";
    } else {
        modelPopover.classList.remove("open-up");
        modelPopover.style.maxHeight = Math.max(200, spaceAbove) + "px";
    }

    modelPopover.classList.toggle("hidden");
});

// Handle Model Selection — fallback for hardcoded HTML models
document.querySelectorAll(".model-option").forEach(opt => {
    opt.addEventListener("click", () => {
        selectModel(opt);
    });
});

// Handle Thinking Level Options
const thinkingToggle = document.getElementById("thinking-toggle");
const thinkingLevelsContainer = document.getElementById("thinking-levels-container");

thinkingToggle.addEventListener("change", (e) => {
    if (e.target.checked) {
        thinkingLevelsContainer.classList.remove("hidden");
        // Ensure there's a valid default selection
        if (currentThinkingLevel === "none") {
            const activeBtn = thinkingLevelsContainer.querySelector(".think-btn.active") || thinkingLevelsContainer.querySelector(".think-btn");
            activeBtn.classList.add("active");
            currentThinkingLevel = activeBtn.getAttribute("data-level");
        }
    } else {
        thinkingLevelsContainer.classList.add("hidden");
        currentThinkingLevel = "none";
    }
});

document.querySelectorAll(".think-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
        e.stopPropagation(); // Keep popover open
        document.querySelectorAll(".think-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (thinkingToggle.checked) {
            currentThinkingLevel = btn.getAttribute("data-level");
        }
    });
});

document.addEventListener("click", (e) => {
    if (!modelPopover.contains(e.target) && e.target !== modelBtn) {
        modelPopover.classList.add("hidden");
        // Also collapse More models when closing popover
        const moreModelsSection = document.getElementById("more-models-section");
        const moreModelsBtn = document.getElementById("more-models-btn");
        if (moreModelsSection && moreModelsBtn) {
            moreModelsSection.classList.remove("visible");
            moreModelsSection.classList.add("hidden");
            moreModelsBtn.classList.remove("expanded");
        }
    }
});

// Handle More Models Toggle
document.getElementById("more-models-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const section = document.getElementById("more-models-section");
    const btn = document.getElementById("more-models-btn");
    const isVisible = section.classList.contains("visible");

    if (isVisible) {
        section.classList.remove("visible");
        section.classList.add("hidden");
        btn.classList.remove("expanded");
    } else {
        section.classList.remove("hidden");
        section.classList.add("visible");
        btn.classList.add("expanded");
    }
});

function getPromptsData() {
    return t("prompts") || {};
}

const suggestedMenuPane = document.getElementById("suggested-menu-pane");
const suggestedMenuList = document.getElementById("suggested-menu-list");
const suggestedMenuTitleText = document.getElementById("suggested-menu-title-text");
const btnCloseSuggestedMenu = document.getElementById("btn-close-suggested-menu");
const suggestedActionsContainer = document.querySelector(".suggested-actions");

// Helper: Shuffle array and pull N items
function getRandomPrompts(array, n) {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, n);
}

// Helper: Word-by-word soft fade-in animation
function softTextEntrance(element, finalString, itemIndex) {
    const words = finalString.split(' ');
    const baseDelay = itemIndex * 0.12; // stagger between menu items
    element.innerHTML = '';
    words.forEach((word, i) => {
        const span = document.createElement('span');
        span.className = 'word-fade';
        span.textContent = word + ' ';
        span.style.animationDelay = `${baseDelay + i * 0.04}s`;
        element.appendChild(span);
    });
}

// Handle Suggested Actions Menu Toggle
document.querySelectorAll(".suggest-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const preset = btn.getAttribute("data-preset");
        const title = btn.textContent.trim();
        const fetchedPrompts = t(`prompts.${preset}`);
        const basePrompts = Array.isArray(fetchedPrompts) ? fetchedPrompts : [];
        const randomPrompts = getRandomPrompts(basePrompts, 5);

        // SVG Transfer
        const svgIcon = btn.querySelector("svg");
        const headerIconContainer = document.querySelector(".suggested-menu-title svg");
        if (svgIcon && headerIconContainer) {
            headerIconContainer.outerHTML = svgIcon.outerHTML; // Replace completely
            document.querySelector(".suggested-menu-title svg").classList.add("suggested-menu-icon"); // Re-add class
        }

        // Set title
        suggestedMenuTitleText.textContent = title;

        // Populate list
        suggestedMenuList.innerHTML = "";
        randomPrompts.forEach((promptText, index) => {
            const item = document.createElement("div");
            item.className = "suggested-menu-item";
            item.addEventListener("click", () => {
                inputEl.value = promptText;
                inputEl.focus();
                autoResize();
                sendBtn.classList.add("active");
                closeSuggestedMenu();
            });
            suggestedMenuList.appendChild(item);

            // Soft staggered fade-in
            softTextEntrance(item, promptText, index);
        });

        // Toggle visibility with CSS transition trigger
        suggestedActionsContainer.classList.remove("anim-in");
        suggestedActionsContainer.classList.add("anim-out");

        setTimeout(() => {
            const updateUI = () => {
                suggestedActionsContainer.style.display = "none";
                suggestedMenuPane.classList.remove("hidden");
                suggestedMenuPane.classList.remove("anim-out");
                suggestedMenuPane.classList.add("anim-in");
            };

            if (document.startViewTransition) {
                document.startViewTransition(updateUI);
            } else {
                updateUI();
            }
        }, 250);
    });
});

function closeSuggestedMenu() {
    suggestedMenuPane.classList.remove("anim-in");
    suggestedMenuPane.classList.add("anim-out");

    setTimeout(() => {
        const updateUI = () => {
            suggestedMenuPane.classList.add("hidden");
            suggestedActionsContainer.style.display = "flex";
            suggestedActionsContainer.classList.remove("anim-out");
            suggestedActionsContainer.classList.add("anim-in");
        };

        if (document.startViewTransition) {
            document.startViewTransition(updateUI);
        } else {
            updateUI();
        }
    }, 250);
}

btnCloseSuggestedMenu.addEventListener("click", closeSuggestedMenu);

themeBtn.addEventListener("click", toggleTheme);

settingsBtn.addEventListener("click", showModal);

ghostBtn.addEventListener("click", () => {
    // Placeholder for future functionality
    console.log("Ghost button clicked - coming soon!");
});

sendBtn.addEventListener("click", () => sendMessage());

inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

inputEl.addEventListener("input", () => {
    autoResize();
    if (inputEl.value.trim() && !isProcessing) {
        sendBtn.classList.add("active");
    } else {
        sendBtn.classList.remove("active");
    }
});

saveKeyBtn.addEventListener("click", async () => {
    // 1. Handle Language Save First
    const langSelect = document.getElementById("language-select");
    if (langSelect && langSelect.value !== currentLangCode) {
        const newLang = langSelect.value;
        loadLanguageSync(newLang);
        localStorage.setItem("app_language", newLang);
        applyTranslations();

        // Clear open suggested prompts so they reload in new language when clicked
        suggestedMenuPane.classList.add("hidden");
        suggestedMenuPane.classList.remove("visible");
        document.querySelectorAll(".suggest-btn").forEach(b => b.classList.remove("expanded"));
    }

    const key = apiKeyInput.value.trim();

    // If key is empty or contains masked dots, check if we already have a saved key
    if (!key || key.includes("\u2022")) {
        const result = await ipcRenderer.invoke("load-api-key");
        if (result.key) {
            // Key already saved, just close
            apiKeyInput.placeholder = t("settings.enterNewKey");
            hideModal();
            return;
        } else {
            // No key saved, and no language change just happened? We need a key.
            // If they just changed language but have no key, still force them to enter a key.
            const existing = document.querySelector("#modal-body .error-text");
            if (existing) existing.remove();
            const err = document.createElement("p");
            err.className = "error-text";
            err.textContent = t("settings.enterApiKey");
            document.getElementById("modal-body").appendChild(err);
            return;
        }
    }

    saveKeyBtn.disabled = true;
    saveKeyBtn.textContent = t("settings.saving");

    const existing = document.querySelector("#modal-body .error-text");
    if (existing) existing.remove();

    try {
        const success = await setApiKey(key);
        if (success) {
            await ipcRenderer.invoke("save-api-key", key);
            apiKeyInput.placeholder = "AIza...";
            hideModal();
            await checkStatus();
            await fetchModels();
            inputEl.focus();
        } else {
            const err = document.createElement("p");
            err.className = "error-text";
            err.textContent = t("settings.apiKeyRejected");
            document.getElementById("modal-body").appendChild(err);
        }
    } catch {
        const err = document.createElement("p");
        err.className = "error-text";
        err.textContent = t("settings.cannotConnect");
        document.getElementById("modal-body").appendChild(err);
    }

    saveKeyBtn.disabled = false;
    saveKeyBtn.textContent = t("settings.saveAndClose");
});

toggleKeyBtn.addEventListener("click", () => {
    if (apiKeyInput.type === "password") {
        apiKeyInput.type = "text";
    } else {
        apiKeyInput.type = "password";
    }
});

apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        saveKeyBtn.click();
    }
});

getKeyLink.addEventListener("click", (e) => {
    e.preventDefault();
    shell.openExternal("https://aistudio.google.com/apikey");
});

// --- New Feature Sub-Toggles ---

tempSlider.addEventListener("input", () => {
    tempVal.textContent = tempSlider.value;
});

btnAttach.addEventListener("click", () => {
    imageUpload.click();
});

imageUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        const fullDataUrl = ev.target.result;
        // e.g. "data:image/png;base64,iVBORw0KGgo..."
        const parts = fullDataUrl.split(",");
        const mimeLine = parts[0];
        attachedImageMimeType = mimeLine.match(/:(.*?);/)[1];
        attachedImageBase64 = parts[1];

        previewImg.src = fullDataUrl;
        imagePreview.classList.remove("hidden");
        btnAttach.classList.add("active");
    };
    reader.readAsDataURL(file);
});

// Make the input preview image clickable
previewImg.addEventListener("click", () => {
    if (previewImg.src) {
        openImageLightbox(previewImg.src);
    }
});
previewImg.style.cursor = "pointer";

// Ctrl+V paste image support
document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith("image/")) {
            e.preventDefault();
            const file = item.getAsFile();
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                const fullDataUrl = ev.target.result;
                const parts = fullDataUrl.split(",");
                const mimeLine = parts[0];
                attachedImageMimeType = mimeLine.match(/:(.*?);/)[1];
                attachedImageBase64 = parts[1];

                previewImg.src = fullDataUrl;
                imagePreview.classList.remove("hidden");
                btnAttach.classList.add("active");
            };
            reader.readAsDataURL(file);
            break;
        }
    }
});

// Escape key to close lightbox
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const lightbox = document.getElementById("image-lightbox");
        if (lightbox && lightbox.classList.contains("active")) {
            lightbox.classList.remove("active");
        }
    }
});

btnRemoveImg.addEventListener("click", () => {
    attachedImageBase64 = null;
    attachedImageMimeType = null;
    imagePreview.classList.add("hidden");
    previewImg.src = "";
    imageUpload.value = "";
    btnAttach.classList.remove("active");
});

btnSearch.addEventListener("click", () => {
    useSearch = !useSearch;
    if (useSearch) {
        btnSearch.classList.add("active");
    } else {
        btnSearch.classList.remove("active");
    }
});

btnCode.addEventListener("click", () => {
    useCode = !useCode;
    if (useCode) {
        btnCode.classList.add("active");
    } else {
        btnCode.classList.remove("active");
    }
});

async function init() {
    initLanguage();
    initTheme();
    await loadUserAvatar();

    // Try to restore saved API key from encrypted storage
    try {
        const result = await ipcRenderer.invoke("load-api-key");
        if (result.key) {
            await setApiKey(result.key);
        }
    } catch (err) {
        console.error("Failed to load saved API key:", err);
    }

    // Migrate from localStorage if exists (one-time)
    const oldKey = localStorage.getItem("gemini_api_key");
    if (oldKey) {
        await setApiKey(oldKey);
        await ipcRenderer.invoke("save-api-key", oldKey);
        localStorage.removeItem("gemini_api_key");
    }

    const hasKey = await checkStatus();
    if (!hasKey) {
        showModal();
    } else {
        inputEl.focus();
        await fetchModels();
    }

    setInterval(checkStatus, 30000);
}

init();
