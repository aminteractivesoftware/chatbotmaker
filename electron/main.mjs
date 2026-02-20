import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

let mainWindow = null;
let serverInstance = null;

function getUserDataPath(...segments) {
  return path.join(app.getPath('userData'), ...segments);
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Chatbot Maker',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const url = isDev
    ? 'http://localhost:3000'
    : `http://localhost:${port}`;

  mainWindow.loadURL(url);

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    shell.openExternal(linkUrl);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function main() {
  await app.whenReady();

  let actualPort;

  if (isDev) {
    // In dev mode, backend runs separately via nodemon on 3001,
    // and Vite dev server runs on 3000 with proxy to 3001.
    actualPort = 3000;
  } else {
    // In production, start Express inside this process
    const { startServer } = await import('../backend/server.js');

    const uploadsPath = getUserDataPath('uploads');
    const frontendDistPath = path.join(app.getAppPath(), 'frontend', 'dist');

    serverInstance = await startServer({
      port: 0, // OS picks a free port
      uploadsPath,
      frontendDistPath,
    });

    actualPort = serverInstance.address().port;
  }

  await createWindow(actualPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(actualPort);
    }
  });
}

app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
  }
  app.quit();
});

main().catch((err) => {
  console.error('Failed to start application:', err);
  app.quit();
});
