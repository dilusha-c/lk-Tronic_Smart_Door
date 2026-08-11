const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3034;

// User-uploaded audio must be stored outside the installed application folder.
// Windows protects Program Files, so use Electron's per-user data directory when
// running from a packaged desktop app.
function getAppDataDirectory() {
  if (!__dirname.includes('app.asar')) {
    return __dirname;
  }

  try {
    const { app: electronApp } = require('electron');
    if (electronApp) {
      return electronApp.getPath('userData');
    }
  } catch (err) {
    console.error('Failed to resolve Electron user data directory:', err);
  }

  // Fallback for unusual packaged launches; do not write inside app.asar.
  return process.env.APPDATA || process.cwd();
}

const appDataDir = getAppDataDirectory();
const uploadsBaseDir = path.join(appDataDir, 'uploads');

const MUSIC_DIR = path.join(uploadsBaseDir, 'music');
const WELCOME_DIR = path.join(uploadsBaseDir, 'welcome');

// Ensure directories exist
fs.mkdirSync(MUSIC_DIR, { recursive: true });
fs.mkdirSync(WELCOME_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/music', express.static(MUSIC_DIR));
app.use('/uploads/welcome', express.static(WELCOME_DIR));

// Memory store for events and state
let eventsLog = [];
let doorStatus = 'closed'; // 'open' or 'closed'
let esp32Connected = false;

// Keep the welcome-sound choice outside the packaged app, so it survives restarts
// and application updates when running in Electron.
const settingsDir = appDataDir;
const WELCOME_SETTINGS_FILE = path.join(settingsDir, 'welcome_settings.json');

function loadWelcomeSettings() {
  try {
    if (!fs.existsSync(WELCOME_SETTINGS_FILE)) return '';
    const settings = JSON.parse(fs.readFileSync(WELCOME_SETTINGS_FILE, 'utf8'));
    const selected = typeof settings.activeWelcomeSound === 'string'
      ? settings.activeWelcomeSound
      : '';
    return fs.existsSync(path.join(WELCOME_DIR, selected)) ? selected : '';
  } catch (err) {
    console.error('Failed to load welcome sound settings:', err);
    return '';
  }
}

function saveWelcomeSettings() {
  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      WELCOME_SETTINGS_FILE,
      JSON.stringify({ activeWelcomeSound }, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error('Failed to save welcome sound settings:', err);
  }
}

let activeWelcomeSound = loadWelcomeSettings(); // filename of active uploaded welcome sound

// Helper to log event
function logEvent(message) {
  const time = new Date().toLocaleTimeString();
  eventsLog.unshift({ time, message });
  if (eventsLog.length > 100) {
    eventsLog.pop();
  }
  io.emit('event_logged', { time, message });
}

// Multer configurations
const musicStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MUSIC_DIR),
  filename: (req, file, cb) => {
    // Preserve original filename, but ensure it's safe
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, Date.now() + '_' + safeName);
  }
});

const welcomeStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, WELCOME_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, Date.now() + '_' + safeName);
  }
});

const uploadMusic = multer({ storage: musicStorage });
const uploadWelcome = multer({ storage: welcomeStorage });

// REST APIs

// 1. Get all songs
app.get('/songs', (req, res) => {
  try {
    const files = fs.readdirSync(MUSIC_DIR);
    const songs = files.map(file => {
      const filePath = path.join(MUSIC_DIR, file);
      const stats = fs.statSync(filePath);
      return {
        id: file,
        name: file.replace(/^\d+_/, ''), // Remove timestamp prefix for user display
        fileName: file,
        url: `/uploads/music/${file}`,
        size: stats.size,
        createdAt: stats.birthtime
      };
    });
    res.json(songs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read music directory' });
  }
});

// 2. Upload songs (multiple supported)
app.post('/upload-song', uploadMusic.array('songs'), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const uploadedSongs = req.files.map(file => {
      logEvent(`Song uploaded: ${file.filename.replace(/^\d+_/, '')}`);
      return {
        id: file.filename,
        name: file.filename.replace(/^\d+_/, ''),
        fileName: file.filename,
        url: `/uploads/music/${file.filename}`
      };
    });
    res.json({ message: 'Upload successful', songs: uploadedSongs });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// 3. Delete a song
app.delete('/song/:id', (req, res) => {
  try {
    const songId = req.params.id;
    const filePath = path.join(MUSIC_DIR, songId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logEvent(`Song deleted: ${songId.replace(/^\d+_/, '')}`);
      res.json({ message: 'Song deleted successfully' });
    } else {
      res.status(404).json({ error: 'Song not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete song' });
  }
});

// 4. Rename a song
app.post('/rename-song', (req, res) => {
  try {
    const { id, newName } = req.body;
    if (!id || !newName) {
      return res.status(400).json({ error: 'Missing id or newName' });
    }

    // Keep extension
    const ext = path.extname(id);
    let baseNewName = newName.replace(/[^a-zA-Z0-9.-]/g, '_');
    if (!baseNewName.endsWith(ext)) {
      baseNewName += ext;
    }

    const oldPath = path.join(MUSIC_DIR, id);
    // Maintain timestamp prefix if it had one
    const prefixMatch = id.match(/^(\d+_)/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    const newFileName = prefix + baseNewName;
    const newPath = path.join(MUSIC_DIR, newFileName);

    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
      logEvent(`Song renamed to: ${baseNewName}`);
      res.json({ message: 'Song renamed successfully', id: newFileName, name: baseNewName });
    } else {
      res.status(404).json({ error: 'Song not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename song' });
  }
});

// 5. Get welcome sounds
app.get('/welcome', (req, res) => {
  try {
    const files = fs.readdirSync(WELCOME_DIR);
    const sounds = files.map(file => {
      const filePath = path.join(WELCOME_DIR, file);
      const stats = fs.statSync(filePath);
      return {
        id: file,
        name: file.replace(/^\d+_/, ''),
        fileName: file,
        url: `/uploads/welcome/${file}`,
        size: stats.size
      };
    });
    res.json({ sounds, activeWelcomeSound });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read welcome directory' });
  }
});

// 6. Upload welcome sound
app.post('/upload-welcome', uploadWelcome.single('welcome'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const cleanName = req.file.filename.replace(/^\d+_/, '');
    logEvent(`Welcome sound uploaded: ${cleanName}`);
    // Automatically set as active if none is active
    if (!activeWelcomeSound) {
      activeWelcomeSound = req.file.filename;
      saveWelcomeSettings();
    }
    res.json({
      message: 'Upload successful',
      sound: {
        id: req.file.filename,
        name: cleanName,
        fileName: req.file.filename,
        url: `/uploads/welcome/${req.file.filename}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// 7. Select active welcome sound
app.post('/welcome/select', (req, res) => {
  try {
    const { id } = req.body;
    const filePath = path.join(WELCOME_DIR, id);
    if (fs.existsSync(filePath)) {
      activeWelcomeSound = id;
      saveWelcomeSettings();
      logEvent(`Active welcome sound set to: ${id.replace(/^\d+_/, '')}`);
      res.json({ message: 'Active welcome sound updated', activeWelcomeSound });
    } else {
      res.status(404).json({ error: 'Welcome sound not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to set active welcome sound' });
  }
});

// 8. Delete welcome sound
app.delete('/welcome/:id', (req, res) => {
  try {
    const soundId = req.params.id;
    const filePath = path.join(WELCOME_DIR, soundId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logEvent(`Welcome sound deleted: ${soundId.replace(/^\d+_/, '')}`);
      if (activeWelcomeSound === soundId) {
        activeWelcomeSound = '';
        saveWelcomeSettings();
      }
      res.json({ message: 'Welcome sound deleted successfully' });
    } else {
      res.status(404).json({ error: 'Welcome sound not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete welcome sound' });
  }
});

// 9. Get events
app.get('/events', (req, res) => {
  res.json(eventsLog);
});

// 10. Get current status
app.get('/status', (req, res) => {
  res.json({
    doorStatus,
    esp32Connected,
    activeWelcomeSound
  });
});

// YouTube Playlist Cache Persistence
let playlistCacheDir = __dirname;
if (__dirname.includes('app.asar')) {
  playlistCacheDir = __dirname.split('app.asar')[0];
}
try {
  // If running inside Electron, use the user data directory (which is always writeable)
  const { app } = require('electron');
  if (app) {
    playlistCacheDir = app.getPath('userData');
  }
} catch (e) {
  // Fallback to default path if Electron is not available
}
const PLAYLIST_CACHE = path.join(playlistCacheDir, 'playlist_cache.json');

function readPlaylistCache() {
  if (!fs.existsSync(PLAYLIST_CACHE)) {
    return { playlists: [], activePlaylistId: '', playbackState: { playlistId: '', index: 0, currentTime: 0 }, volume: 100 };
  }
  try {
    const data = fs.readFileSync(PLAYLIST_CACHE, 'utf8');
    const parsed = JSON.parse(data);
    // Migration check: if it is the old format (object with just url and id)
    if (parsed.id && !parsed.playlists) {
      const initialPlaylist = { id: parsed.id, url: parsed.url || '', title: parsed.title || `Playlist: ${parsed.id}` };
      return {
        playlists: [initialPlaylist],
        activePlaylistId: parsed.id,
        playbackState: { playlistId: parsed.id, index: 0, currentTime: 0 },
        volume: 100
      };
    }
    // Ensure all keys exist
    if (!parsed.playlists) parsed.playlists = [];
    if (!parsed.activePlaylistId) parsed.activePlaylistId = '';
    if (!parsed.playbackState) parsed.playbackState = { playlistId: '', index: 0, currentTime: 0 };
    if (!Number.isFinite(Number(parsed.volume))) parsed.volume = 100;
    parsed.volume = Math.min(Math.max(Number(parsed.volume), 0), 100);
    return parsed;
  } catch (e) {
    return { playlists: [], activePlaylistId: '', playbackState: { playlistId: '', index: 0, currentTime: 0 }, volume: 100 };
  }
}

function writePlaylistCache(data) {
  fs.writeFileSync(PLAYLIST_CACHE, JSON.stringify(data, null, 2), 'utf8');
}

app.get('/api/youtube/playlist', (req, res) => {
  try {
    const cache = readPlaylistCache();
    res.json(cache);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read playlist cache' });
  }
});

app.post('/api/youtube/playlist', (req, res) => {
  try {
    const { url, id, title } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Missing playlist ID' });
    }
    const cache = readPlaylistCache();
    const existingIndex = cache.playlists.findIndex(p => p.id === id);
    const playlistEntry = { id, url: url || '', title: title || `Playlist: ${id}` };
    
    if (existingIndex > -1) {
      cache.playlists[existingIndex] = playlistEntry;
    } else {
      cache.playlists.push(playlistEntry);
    }
    cache.activePlaylistId = id;
    
    writePlaylistCache(cache);
    res.json({ success: true, cache });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write playlist cache' });
  }
});

app.delete('/api/youtube/playlist/:id', (req, res) => {
  try {
    const playlistId = req.params.id;
    const cache = readPlaylistCache();
    cache.playlists = cache.playlists.filter(p => p.id !== playlistId);
    if (cache.activePlaylistId === playlistId) {
      cache.activePlaylistId = cache.playlists.length > 0 ? cache.playlists[0].id : '';
    }
    writePlaylistCache(cache);
    res.json({ success: true, cache });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

app.post('/api/youtube/state', (req, res) => {
  try {
    const { playlistId, index, currentTime, volume } = req.body;
    const cache = readPlaylistCache();
    if (playlistId !== undefined) {
      cache.playbackState = {
        playlistId: playlistId || '',
        index: index !== undefined ? Number(index) : 0,
        currentTime: currentTime !== undefined ? Number(currentTime) : 0
      };
    }
    if (volume !== undefined && Number.isFinite(Number(volume))) {
      cache.volume = Math.min(Math.max(Number(volume), 0), 100);
    }
    writePlaylistCache(cache);
    res.json({ success: true, cache });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save playback state' });
  }
});

// POST to trigger door status change (both for physical ESP32 or simulated dashboard button)
app.post('/door-event', (req, res) => {
  const { event, time, manual } = req.body;
  if (event === 'door_open') {
    doorStatus = 'open';
    logEvent('Door Open');
    io.emit('door_event', {
      event: 'door_open',
      time: time || new Date().toISOString(),
      manual: Boolean(manual)
    });
    res.json({ success: true, doorStatus });
  } else if (event === 'door_closed') {
    doorStatus = 'closed';
    logEvent('Door Closed');
    io.emit('door_event', { event: 'door_closed', time: time || new Date().toISOString() });
    res.json({ success: true, doorStatus });
  } else {
    res.status(400).json({ error: 'Invalid event' });
  }
});

// Socket.IO communication
io.on('connection', (socket) => {
  // Check if client is ESP32 or browser
  const isEsp32 = socket.handshake.query.device === 'esp32';
  if (isEsp32) {
    esp32Connected = true;
    logEvent('ESP32 Connected');
    io.emit('esp32_status', { connected: true });
  }

  // Send current status immediately to new browser connection
  socket.emit('status_update', {
    doorStatus,
    esp32Connected,
    activeWelcomeSound
  });

  socket.on('esp32_event', (data) => {
    const { event, time } = data;
    if (event === 'door_open') {
      doorStatus = 'open';
      logEvent('Door Open (ESP32)');
      io.emit('door_event', { event: 'door_open', time });
    }
  });

  socket.on('disconnect', () => {
    if (isEsp32) {
      esp32Connected = false;
      logEvent('ESP32 Disconnected');
      io.emit('esp32_status', { connected: false });
    }
  });
});

// Start server dynamically finding an available port if the configured one is in use
const startServer = (port) => {
  return new Promise((resolve, reject) => {
    const srv = server.listen(port, () => {
      console.log(`Server running on port ${port}`);
      resolve(port);
    });
    
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is busy, trying port ${port + 1}...`);
        resolve(startServer(port + 1));
      } else {
        reject(err);
      }
    });
  });
};

module.exports = startServer(PORT);
