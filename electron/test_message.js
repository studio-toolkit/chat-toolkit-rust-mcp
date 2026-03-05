const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');

app.on('ready', () => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    ipcMain.handle('save-api-key', () => true);
    ipcMain.handle('load-api-key', () => ({ key: 'test' }));

    win.loadFile('index.html');

    win.webContents.on('console-message', (e, level, msgs) => {
        fs.appendFileSync('/tmp/debug.log', 'CONSOLE: ' + msgs + '\n');
    });

    win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript(`
            (async () => {
                try {
                    console.log("STARTING TEST");
                    await new Promise(r => setTimeout(r, 1000));
                    document.getElementById('message-input').value = "Test";
                    document.getElementById('btn-send').click();
                    await new Promise(r => setTimeout(r, 500));
                    let msgs = document.querySelectorAll('.message');
                    console.log("Messages found: " + msgs.length);
                    let welcome = document.getElementById('welcome');
                    console.log("Welcome display: " + (welcome ? window.getComputedStyle(welcome).display : 'null'));
                    
                    if (msgs.length > 0) {
                        console.log("Message HTML: " + msgs[0].outerHTML.substring(0, 100));
                        console.log("Message display: " + window.getComputedStyle(msgs[0]).display);
                        console.log("Message height: " + msgs[0].offsetHeight);
                        let messagesContainer = document.getElementById('messages');
                        console.log("MessagesContainer display: " + window.getComputedStyle(messagesContainer).display);
                        console.log("MessagesContainer children: " + messagesContainer.children.length);
                    }
                } catch(e) {
                    console.error("PAGE SCRIPT ERROR: " + e.message);
                } finally {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.send('quit-app');
                }
            })();
        `);
    });
});

ipcMain.on('quit-app', () => {
    app.quit();
});
