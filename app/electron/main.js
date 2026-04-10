/**
 * Demo Prompt Generator - Electron Main Process
 *
 * Bundles a FastAPI Python backend with a React frontend.
 * Designed for macOS distribution with bundled Python runtime.
 */

const { app, BrowserWindow, dialog, shell, Menu, Tray } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

// Restore full $PATH for GUI apps on macOS
// Without this, GUI apps launched from Finder/Dock lose PATH to Homebrew, pyenv, etc.
if (process.platform === 'darwin') {
  try {
    require('fix-path')();
    console.log('PATH restored for macOS GUI app');
  } catch (e) {
    console.warn('fix-path not available, PATH may be incomplete:', e.message);
  }
}

// Configuration
const BACKEND_PORT = 8765; // Use non-standard port to avoid conflicts
const BACKEND_HOST = '127.0.0.1';
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const STARTUP_TIMEOUT = 30000; // 30 seconds max for backend startup
const HEALTH_CHECK_INTERVAL = 300; // ms between health checks

// State
let mainWindow = null;
let pythonProcess = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Path Resolution
// ---------------------------------------------------------------------------

/**
 * Get the path to a resource, handling both dev and packaged modes.
 */
function getResourcePath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(__dirname, '..', ...parts);
}

/**
 * Get the path to the Python executable.
 * In packaged mode, we use the PyInstaller bundle (no separate Python needed).
 * In dev mode, uses the system Python from venv or PATH.
 */
function getPythonPath() {
  // Development mode - try venv first, then system
  const venvPython = path.join(__dirname, '..', '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  // Fallback to system Python
  return 'python3';
}

/**
 * Get the path to the backend executable or script.
 */
function getBackendPath() {
  if (app.isPackaged) {
    // PyInstaller-bundled backend
    const backendExe = path.join(
      process.resourcesPath,
      'backend',
      process.platform === 'win32' ? 'backend.exe' : 'backend'
    );
    if (fs.existsSync(backendExe)) {
      return { type: 'executable', path: backendExe };
    }

    // Fallback to Python script with bundled Python
    const backendScript = path.join(
      process.resourcesPath,
      'backend',
      'run_server.py'
    );
    if (fs.existsSync(backendScript)) {
      return { type: 'script', path: backendScript };
    }

    console.error('No backend found in Resources');
    return null;
  }

  // Development mode - run uvicorn directly
  return { type: 'dev', path: null };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Load embedded configuration from config.json.
 */
function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('Loaded config:', { lakebaseUrl: config.lakebaseUrl ? '***' : null });
      return config;
    }
  } catch (err) {
    console.warn('Failed to load config:', err.message);
  }
  return {};
}

// ---------------------------------------------------------------------------
// Backend Management
// ---------------------------------------------------------------------------

/**
 * Start the Python backend server.
 */
function startBackend() {
  return new Promise((resolve, reject) => {
    const backend = getBackendPath();
    if (!backend) {
      return reject(new Error('Backend not found'));
    }

    console.log('Starting backend:', backend.type, backend.path || 'dev mode');

    // Load embedded config
    const config = loadConfig();

    // Build environment with restored PATH
    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1', // Prevent stdout buffering
      ELECTRON_RUN: '1', // Signal to backend that we're running in Electron
      BACKEND_PORT: String(BACKEND_PORT),
    };

    // Add Lakebase URL if configured
    if (config.lakebaseUrl) {
      env.LAKEBASE_PG_URL = config.lakebaseUrl;
      console.log('Using embedded Lakebase URL');
    }

    let args;
    let command;
    let cwd;

    if (backend.type === 'executable') {
      // PyInstaller executable
      command = backend.path;
      args = ['--port', String(BACKEND_PORT)];
      cwd = path.dirname(backend.path);
    } else if (backend.type === 'script') {
      // Python script with bundled/system Python
      command = getPythonPath();
      args = [backend.path, '--port', String(BACKEND_PORT)];
      cwd = path.dirname(backend.path);
    } else {
      // Development mode - use uv run uvicorn
      command = 'uv';
      args = [
        'run',
        'uvicorn',
        'demo_prompt_generator.backend.app:app',
        '--host', BACKEND_HOST,
        '--port', String(BACKEND_PORT),
      ];
      cwd = path.join(__dirname, '..');
    }

    console.log(`Spawning: ${command} ${args.join(' ')}`);
    console.log(`CWD: ${cwd}`);

    pythonProcess = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pythonProcess.stdout.on('data', (data) => {
      console.log('[Backend]', data.toString().trim());
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error('[Backend]', data.toString().trim());
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start backend:', err);
      reject(err);
    });

    pythonProcess.on('close', (code) => {
      console.log('Backend exited with code:', code);
      pythonProcess = null;

      // If we're not quitting and the backend died, show an error
      if (!isQuitting && code !== 0 && mainWindow) {
        dialog.showErrorBox(
          'Backend Error',
          `The backend server stopped unexpectedly (code ${code}). The app will close.`
        );
        app.quit();
      }
    });

    // Wait for backend to be ready
    waitForBackend()
      .then(resolve)
      .catch(reject);
  });
}

/**
 * Wait for the backend to be ready by polling the health endpoint.
 */
function waitForBackend(timeout = STARTUP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkHealth = () => {
      if (Date.now() - startTime > timeout) {
        return reject(new Error('Backend startup timeout'));
      }

      http.get(`${BACKEND_URL}/api/health`, (res) => {
        if (res.statusCode === 200) {
          console.log('Backend is ready');
          resolve();
        } else {
          setTimeout(checkHealth, HEALTH_CHECK_INTERVAL);
        }
      }).on('error', () => {
        setTimeout(checkHealth, HEALTH_CHECK_INTERVAL);
      });
    };

    // Start checking after a brief delay to let the process start
    setTimeout(checkHealth, 500);
  });
}

/**
 * Stop the backend server.
 */
function stopBackend() {
  if (pythonProcess) {
    console.log('Stopping backend...');
    pythonProcess.kill('SIGTERM');

    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (pythonProcess) {
        console.log('Force killing backend...');
        pythonProcess.kill('SIGKILL');
      }
    }, 5000);
  }
}

// ---------------------------------------------------------------------------
// Window Management
// ---------------------------------------------------------------------------

/**
 * Create the main application window.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset', // macOS native look
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false, // Don't show until ready
  });

  // Load the frontend
  if (app.isPackaged) {
    // Production: load from bundled static files
    mainWindow.loadFile(path.join(process.resourcesPath, 'frontend', 'index.html'));
  } else {
    // Development: load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create the application menu.
 */
function createMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Application Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  console.log('App ready, starting...');
  console.log('Packaged:', app.isPackaged);
  console.log('Resources path:', process.resourcesPath);
  console.log('__dirname:', __dirname);

  createMenu();

  try {
    await startBackend();
    createWindow();
  } catch (err) {
    console.error('Failed to start:', err);
    dialog.showErrorBox(
      'Startup Error',
      `Failed to start the application:\n\n${err.message}\n\nPlease check that Python is installed and try again.`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep the app running in the dock
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

app.on('will-quit', () => {
  stopBackend();
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  dialog.showErrorBox('Error', err.message);
});
