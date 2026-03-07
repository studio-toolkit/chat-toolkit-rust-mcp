const { app, BrowserWindow, safeStorage, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

app.setName("GeminiStudio");
if (process.platform === 'darwin') {
  app.dock.setIcon(path.join(__dirname, 'icons', 'AppLogo.png'));
}

// Encrypted API key storage path
const keyFilePath = path.join(app.getPath("userData"), "api_key.enc");

function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'icons', 'AppLogo.ico')
    : path.join(__dirname, 'icons', 'AppLogo.png');

  mainWindow = new BrowserWindow({
    width: 1050,
    height: 750,
    minWidth: 600,
    minHeight: 500,
    title: "GeminiStudio",
    icon: iconPath,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#00000000",
    transparent: true,
    vibrancy: "fullscreen-ui", // macOS glassmorphism
    visualEffectState: "active",
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Automatically grant media permissions (microphone)
  const session = mainWindow.webContents.session;
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'media' && details.securityOrigin === 'file:///') {
      return true;
    }
    return false;
  });

  // On macOS, we also need to explicitly ask the OS for permission the first time
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    systemPreferences.askForMediaAccess('microphone');
  }
}

// IPC: Save API key encrypted with OS-level encryption
ipcMain.handle("save-api-key", async (_event, key) => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key);
      fs.writeFileSync(keyFilePath, encrypted);
      return { success: true };
    } else {
      // Fallback: save as base64 (not truly encrypted, but better than plaintext)
      fs.writeFileSync(keyFilePath, Buffer.from(key).toString("base64"));
      return { success: true, warning: "OS encryption not available, stored with basic encoding" };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: Load API key
ipcMain.handle("load-api-key", async () => {
  try {
    if (!fs.existsSync(keyFilePath)) return { key: null };

    const data = fs.readFileSync(keyFilePath);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(data);
      return { key: decrypted };
    } else {
      // Fallback: decode base64
      const decoded = Buffer.from(data.toString(), "base64").toString("utf-8");
      return { key: decoded };
    }
  } catch (err) {
    return { key: null, error: err.message };
  }
});

// IPC: Delete stored API key
ipcMain.handle("delete-api-key", async () => {
  try {
    if (fs.existsSync(keyFilePath)) {
      fs.unlinkSync(keyFilePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
