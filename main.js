const { app, BrowserWindow, powerSaveBlocker } = require('electron');
const path = require('path');

let mainWindow;
let powerSaveBlockerId = null;
let serverPromise = null;

function createWindow() {
  // Configure auto-start on Windows startup
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Lk-Tronics Music player",
    icon: path.join(__dirname, 'public', 'icon.png'), // Add icon if available
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      // Door events are not user clicks; allow the selected welcome sound to
      // start when the ESP32 sends its event.
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  if (powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  }

  // Start the backend after Electron is ready, so server.js can safely use
  // Electron's writable per-user data directory for uploads and settings.
  if (!serverPromise) {
    serverPromise = require('./server.js');
  }

  // Load the running Express application
  serverPromise.then((port) => {
    mainWindow.loadURL(`http://localhost:${port}`);
  }).catch((err) => {
    console.error("Failed to start backend server:", err);
  });

  // Open the DevTools (optional, uncomment for debugging)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// Create window when Electron is ready
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
