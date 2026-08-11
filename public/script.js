// Connect to Socket.IO server
const socket = io();

// State management
let ytPlayer = null;
let playlistVideos = []; // List of video IDs in the active playlist
let videoTitles = {};    // Cache of video titles mapping ID -> Title
let currentPlaylistId = '';
let currentPlaylistUrl = '';
let savedPlaylists = []; // List of all saved playlists
let savedVolume = 100;
const deletedPlaylistIds = new Set();
let welcomeSounds = [];
let activeWelcomeId = ''; // local welcome sound
let isWelcomePlaying = false;
let isFading = false;
let fadeInterval = null;
let originalYtVolume = 50;
let isShuffle = false;
let isRepeat = 'none';
let isMuted = false;
let ytPlayerReady = false;
let pendingPlaylistLoad = null;
let welcomeRecoveryTimer = null;
let welcomeCooldownUntil = 0;
let welcomeDelaySeconds = 90;

// Audio elements
const welcomeAudio = new Audio();
const previewAudio = new Audio();

// DOM Elements
const doorStatusBadge = document.getElementById('door-status-badge');
const espStatusBadge = document.getElementById('esp-status-badge');
const currentTimeEl = document.getElementById('current-time');
const songCountBadge = document.getElementById('song-count-badge');

// Player DOM
const btnPlay = document.getElementById('btn-play');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnStop = document.getElementById('btn-stop');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const btnMute = document.getElementById('btn-mute');
const volumeSlider = document.getElementById('volume-slider');
const seekBar = document.getElementById('seek-bar');
const timeCurrent = document.getElementById('current-time-display');
const timeDuration = document.getElementById('total-duration-display');
const songTitle = document.getElementById('current-song-title');
const songMeta = document.getElementById('current-song-meta');
const vinylRecord = document.getElementById('vinyl');

// Welcome sounds DOM
const welcomeListUl = document.getElementById('welcome-list-ul');
const activeWelcomeName = document.getElementById('active-welcome-name');
const welcomeFileInput = document.getElementById('welcome-file-input');
const welcomeDelayInput = document.getElementById('welcome-delay-input');
const btnSetWelcomeDelay = document.getElementById('btn-set-welcome-delay');

// YouTube Inputs DOM
const ytPlaylistInput = document.getElementById('yt-playlist-input');
const btnLoadYt = document.getElementById('btn-load-yt');
const ytPlaylistThumb = document.getElementById('yt-playlist-thumb');
const ytPlaylistTitle = document.getElementById('yt-playlist-title');
const ytPlaylistCount = document.getElementById('yt-playlist-count');
const ytPlaylistStatus = document.getElementById('yt-playlist-status');

// Playlist Table DOM
const playlistTbody = document.getElementById('playlist-tbody');
const playlistSearch = document.getElementById('playlist-search');
const btnRefresh = document.getElementById('btn-refresh');

// Log & Simulator DOM
const logList = document.getElementById('log-list');
const btnClearLogs = document.getElementById('btn-clear-logs');
const simOpenBtn = document.getElementById('sim-open-btn');

// Initialize Lucide Icons
function refreshIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

// -------------------------------------------------------------
// YouTube IFrame Player API Implementation
// -------------------------------------------------------------

// Inject YouTube IFrame API script tag dynamically
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// Automatically called by the API when ready
window.onYouTubeIframeAPIReady = function() {
  ytPlayer = new YT.Player('yt-player', {
    height: '1px',
    width: '1px',
    playerVars: {
      'autoplay': 0,
      'controls': 0,
      'disablekb': 1,
      'fs': 0,
      'modestbranding': 1,
      'rel': 0,
      'showinfo': 0
    },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': onPlayerError
    }
  });
};

function onPlayerReady(event) {
  ytPlayerReady = true;
  event.target.setPlaybackQuality('tiny');
  addLogEntry("YouTube Player API Ready");
  if (pendingPlaylistLoad) {
    const pending = pendingPlaylistLoad;
    pendingPlaylistLoad = null;
    loadPlaylistById(pending.playlistId, pending.originalUrl, pending.startIndex, pending.startSeconds, pending.autoPlay);
  } else {
    loadLastPlaylist();
  }
}

function onPlayerStateChange(event) {
  // YT.PlayerState: -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering), 5 (cued)
  if (event.data === YT.PlayerState.PLAYING) {
    event.target.setPlaybackQuality('tiny');
    btnPlay.innerHTML = '<i data-lucide="pause"></i>';
    vinylRecord.classList.add('spinning');
    updatePlaybackDisplay();
    updateActiveHighlight();
  } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
    btnPlay.innerHTML = '<i data-lucide="play"></i>';
    vinylRecord.classList.remove('spinning');
  }
  refreshIcons();
  updateStatusDashboard();
}

function onPlayerError(event) {
  console.error("YouTube Player Error:", event.data);
  let errorMsg = "YouTube playback error occurred";
  if (event.data === 2) errorMsg = "Invalid YouTube URL or ID";
  if (event.data === 5) errorMsg = "Embedded playback unavailable (Restricted)";
  if (event.data === 100 || event.data === 150) errorMsg = "Video not found or unavailable";
  addLogEntry(`Error: ${errorMsg}`);
  alert(errorMsg);
}

// -------------------------------------------------------------
// YouTube Playlist Utilities
// -------------------------------------------------------------

function extractPlaylistId(input) {
  const reg = /[&?]list=([^&]+)/i;
  const match = input.match(reg);
  if (match && match[1]) {
    return match[1];
  }
  return input.trim();
}

btnLoadYt.addEventListener('click', () => {
  const value = ytPlaylistInput.value.trim();
  if (!value) return;
  const playlistId = extractPlaylistId(value);
  loadPlaylistById(playlistId, value);
});

async function loadPlaylistById(playlistId, originalUrl = '', startIndex = 0, startSeconds = 0, autoPlay = false) {
  if (!ytPlayer || !ytPlayerReady) {
    pendingPlaylistLoad = { playlistId, originalUrl, startIndex, startSeconds, autoPlay };
    ytPlaylistStatus.textContent = "Starting YouTube player...";
    ytPlaylistStatus.style.color = "var(--primary-color)";
    return;
  }
  
  ytPlaylistStatus.textContent = "Loading...";
  ytPlaylistStatus.style.color = "var(--primary-color)";
  
  try {
    const playlistOptions = {
      listType: 'playlist',
      list: playlistId,
      index: startIndex,
      startSeconds: startSeconds
    };

    // At startup load (and play) the last saved playlist. Manually loading a
    // playlist still only cues it until the user presses Play.
    if (autoPlay) {
      ytPlayer.loadPlaylist(playlistOptions);
    } else {
      ytPlayer.cuePlaylist(playlistOptions);
    }
    
    currentPlaylistId = playlistId;
    currentPlaylistUrl = originalUrl || `https://www.youtube.com/playlist?list=${playlistId}`;
    
    // Save to server cache (will be updated with a proper title later if fetched)
    savePlaylistState(currentPlaylistUrl, playlistId);

    // Retrieve playlist details asynchronously
    setTimeout(async () => {
      playlistVideos = ytPlayer.getPlaylist() || [];
      songCountBadge.textContent = `${playlistVideos.length} Videos`;
      ytPlaylistCount.textContent = `${playlistVideos.length} Videos`;
      ytPlaylistTitle.textContent = `Playlist ID: ${playlistId}`;
      
      // Load title details using oEmbed free JSON endpoint
      renderPlaylistTable();
      renderSavedPlaylists();
      fetchPlaylistMetadata(playlistId);
      
      ytPlaylistStatus.textContent = "Loaded";
      ytPlaylistStatus.style.color = "var(--success-color)";
      addLogEntry(`Playlist Loaded: ${playlistId}`);
      updateStatusDashboard();
    }, 1500);

  } catch (err) {
    console.error(err);
    ytPlaylistStatus.textContent = "Error";
    ytPlaylistStatus.style.color = "var(--error-color)";
    addLogEntry("Failed to load playlist");
  }
}

// Save playlist details to server backend
async function savePlaylistState(url, id, title = '') {
  // A title lookup can finish after the user deletes a playlist. Do not let
  // that delayed request add the deleted playlist back into saved history.
  if (deletedPlaylistIds.has(id)) return;

  try {
    const res = await fetch('/api/youtube/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, id, title })
    });
    const data = await res.json();
    if (data.cache) {
      savedPlaylists = data.cache.playlists || [];
      renderSavedPlaylists();
    }
  } catch (err) {
    console.error("Error saving playlist:", err);
  }
}

// Render Saved Playlists list
function renderSavedPlaylists() {
  const listUl = document.getElementById('saved-playlists-list-ul');
  if (!listUl) return;
  listUl.innerHTML = '';
  if (savedPlaylists.length === 0) {
    listUl.innerHTML = `<li style="text-align:center; font-size:12px; color: var(--text-secondary); padding: 8px;">No saved playlists</li>`;
    return;
  }
  savedPlaylists.forEach(pl => {
    const isActive = pl.id === currentPlaylistId;
    const li = document.createElement('li');
    li.className = `welcome-item ${isActive ? 'active' : ''}`;
    li.innerHTML = `
      <span style="font-weight: 500; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;" onclick="loadSavedPlaylist('${pl.id}')" title="${pl.title || pl.id}">
        ${pl.title || pl.id}
      </span>
      <div class="welcome-item-actions">
        <button class="btn-small btn-small-success" onclick="loadSavedPlaylist('${pl.id}')" title="Load Playlist"><i data-lucide="play-circle"></i></button>
        <button class="btn-small btn-small-danger" onclick="deletePlaylist('${pl.id}')" title="Delete Playlist"><i data-lucide="trash-2"></i></button>
      </div>
    `;
    listUl.appendChild(li);
  });
  refreshIcons();
}

window.loadSavedPlaylist = (id) => {
  const pl = savedPlaylists.find(p => p.id === id);
  if (pl) {
    deletedPlaylistIds.delete(id);
    ytPlaylistInput.value = pl.url || pl.id;
    loadPlaylistById(id, pl.url);
  }
};

window.deletePlaylist = async (id) => {
  if (!confirm("Delete this playlist from saved history?")) return;
  deletedPlaylistIds.add(id);
  try {
    const res = await fetch(`/api/youtube/playlist/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
    const data = await res.json();
    if (data.cache) {
      savedPlaylists = data.cache.playlists || [];
      renderSavedPlaylists();
      if (currentPlaylistId === id) {
        currentPlaylistId = '';
        currentPlaylistUrl = '';
        playlistVideos = [];
        renderPlaylistTable();
        ytPlaylistTitle.textContent = "No Playlist Loaded";
        ytPlaylistCount.textContent = "0 Videos";
        songCountBadge.textContent = "0 Videos";
      }
    }
  } catch (err) {
    deletedPlaylistIds.delete(id);
    console.error("Error deleting playlist:", err);
    alert("Could not delete the playlist. Please try again.");
  }
};

// Fetch persisted playlist details
async function loadLastPlaylist() {
  try {
    const res = await fetch('/api/youtube/playlist');
    const data = await res.json();
    savedPlaylists = data.playlists || [];
    savedVolume = Number.isFinite(Number(data.volume)) ? Number(data.volume) : 100;
    volumeSlider.value = savedVolume;
    ytPlayer.setVolume(savedVolume);
    renderSavedPlaylists();
    
    const activeId = data.activePlaylistId;
    if (activeId) {
      const activePL = savedPlaylists.find(p => p.id === activeId);
      if (activePL) {
        ytPlaylistInput.value = activePL.url || activePL.id;
      }
      const state = data.playbackState;
      if (state && state.playlistId === activeId) {
        loadPlaylistById(activeId, activePL ? activePL.url : '', state.index, state.currentTime, true);
      } else {
        loadPlaylistById(activeId, activePL ? activePL.url : '', 0, 0, true);
      }
    }
  } catch (err) {
    console.error("Failed to load last playlist:", err);
  }
}

// Fetch YouTube playlist details to get title/thumbnail
async function fetchPlaylistMetadata(playlistId) {
  if (playlistVideos.length > 0) {
    const firstVideoId = playlistVideos[0];
    ytPlaylistThumb.src = `https://img.youtube.com/vi/${firstVideoId}/mqdefault.jpg`;
    
    // Fetch title from noembed
    try {
      const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/playlist?list=${playlistId}`);
      const data = await response.json();
      if (data.title) {
        ytPlaylistTitle.textContent = data.title;
        // Save only if this is still the selected playlist. The user may have
        // deleted it while its metadata request was in progress.
        if (currentPlaylistId === playlistId) {
          savePlaylistState(currentPlaylistUrl, playlistId, data.title);
        }
      }
    } catch {
      ytPlaylistTitle.textContent = `Playlist: ${playlistId}`;
    }
  }
  updateStatusDashboard();
}

// oEmbed Video title fetching
async function fetchVideoTitle(videoId) {
  if (videoTitles[videoId]) return videoTitles[videoId];
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await res.json();
    if (data.title) {
      videoTitles[videoId] = data.title;
      return data.title;
    }
  } catch (e) {
    console.error(e);
  }
  return `Video: ${videoId}`;
}

// -------------------------------------------------------------
// Playback Control Handlers
// -------------------------------------------------------------

btnPlay.addEventListener('click', () => {
  if (!ytPlayer) return;
  const state = ytPlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    ytPlayer.pauseVideo();
  } else {
    ytPlayer.playVideo();
  }
});

btnStop.addEventListener('click', () => {
  if (ytPlayer) ytPlayer.stopVideo();
});

btnNext.addEventListener('click', () => {
  if (ytPlayer) ytPlayer.nextVideo();
});

btnPrev.addEventListener('click', () => {
  if (ytPlayer) ytPlayer.previousVideo();
});

btnShuffle.addEventListener('click', () => {
  if (!ytPlayer) return;
  isShuffle = !isShuffle;
  ytPlayer.setShuffle(isShuffle);
  btnShuffle.classList.toggle('btn-active', isShuffle);
});

btnRepeat.addEventListener('click', () => {
  if (!ytPlayer) return;
  // Repeat playlist
  if (isRepeat === 'all') {
    isRepeat = 'none';
    ytPlayer.setLoop(false);
    btnRepeat.classList.remove('btn-active');
  } else {
    isRepeat = 'all';
    ytPlayer.setLoop(true);
    btnRepeat.classList.add('btn-active');
  }
  refreshIcons();
});

// Sync volume
volumeSlider.addEventListener('input', () => {
  if (!ytPlayer) return;
  const vol = Number(volumeSlider.value);
  savedVolume = vol;
  ytPlayer.setVolume(vol);
  if (vol > 0) {
    isMuted = false;
    btnMute.innerHTML = '<i data-lucide="volume-2"></i>';
  } else {
    isMuted = true;
    btnMute.innerHTML = '<i data-lucide="volume-x"></i>';
  }
  refreshIcons();
  updateStatusDashboard();
  savePlaybackState();
});

btnMute.addEventListener('click', () => {
  if (!ytPlayer) return;
  isMuted = !isMuted;
  if (isMuted) {
    ytPlayer.mute();
    btnMute.innerHTML = '<i data-lucide="volume-x"></i>';
  } else {
    ytPlayer.unmute();
    btnMute.innerHTML = '<i data-lucide="volume-2"></i>';
  }
  refreshIcons();
});

// Update seekBar tracking progress
setInterval(() => {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
  const duration = ytPlayer.getDuration();
  if (duration > 0) {
    const cur = ytPlayer.getCurrentTime();
    const pct = (cur / duration) * 100;
    seekBar.value = pct;
    timeCurrent.textContent = formatTime(cur);
    timeDuration.textContent = formatTime(duration);
  }
}, 500);

seekBar.addEventListener('input', () => {
  if (!ytPlayer || typeof ytPlayer.getDuration !== 'function') return;
  const duration = ytPlayer.getDuration();
  if (duration > 0) {
    const target = (seekBar.value / 100) * duration;
    ytPlayer.seekTo(target, true);
  }
});

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// -------------------------------------------------------------
// UI Rendering & Table Updates
// -------------------------------------------------------------

async function renderPlaylistTable() {
  playlistTbody.innerHTML = '';
  
  if (playlistVideos.length === 0) {
    playlistTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: var(--text-secondary);">No videos loaded</td></tr>`;
    return;
  }

  // Display initial IDs/loading text
  playlistVideos.forEach((videoId, idx) => {
    const tr = document.createElement('tr');
    tr.id = `yt-row-${idx}`;
    tr.addEventListener('dblclick', () => {
      ytPlayer.playVideoAt(idx);
    });

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td id="yt-title-${videoId}" class="yt-video-title">Loading Video Name...</td>
      <td style="text-align: right;">
        <button class="btn-small btn-small-success" onclick="playVideoAtIdx(${idx})" title="Play"><i data-lucide="play"></i></button>
      </td>
    `;
    playlistTbody.appendChild(tr);
    
    // Fetch individual video title details in background
    fetchVideoTitle(videoId).then(title => {
      const el = document.getElementById(`yt-title-${videoId}`);
      if (el) el.textContent = title;
    });
  });

  refreshIcons();
}

window.playVideoAtIdx = (idx) => {
  if (ytPlayer) ytPlayer.playVideoAt(idx);
};

// Highlight the currently playing index
function updateActiveHighlight() {
  if (!ytPlayer || typeof ytPlayer.getPlaylistIndex !== 'function') return;
  const activeIdx = ytPlayer.getPlaylistIndex();
  playlistVideos.forEach((_, idx) => {
    const row = document.getElementById(`yt-row-${idx}`);
    if (row) {
      if (idx === activeIdx) {
        row.className = 'playing';
      } else {
        row.className = '';
      }
    }
  });
}

function updatePlaybackDisplay() {
  if (!ytPlayer || typeof ytPlayer.getVideoData !== 'function') return;
  const data = ytPlayer.getVideoData();
  if (data && data.title) {
    songTitle.textContent = data.title;
    songMeta.textContent = `Channel: ${data.author || 'Unknown'}`;
    
    // Rotate vinyl center art
    const art = document.getElementById('album-art');
    if (art && data.video_id) {
      art.style.background = `url(https://img.youtube.com/vi/${data.video_id}/mqdefault.jpg) no-repeat center`;
      art.style.backgroundSize = 'cover';
    }
  }
}

// -------------------------------------------------------------
// Volume Fading for Door Open Event
// -------------------------------------------------------------

function fadeYtVolume(targetVolume, duration = 1000, callback = null) {
  if (!ytPlayer || typeof ytPlayer.getVolume !== 'function') {
    if (callback) callback();
    return;
  }
  
  if (fadeInterval) clearInterval(fadeInterval);

  let startVolume;
  try {
    startVolume = ytPlayer.getVolume();
  } catch (err) {
    console.error('Unable to read YouTube player volume:', err);
    if (callback) callback();
    return;
  }
  const volumeDelta = targetVolume - startVolume;
  const intervalTime = 50;
  const steps = duration / intervalTime;
  const volumeStep = volumeDelta / steps;
  let currentStep = 0;

  fadeInterval = setInterval(() => {
    currentStep++;
    let nextVolume = Math.round(startVolume + (volumeStep * currentStep));
    
    if (nextVolume < 0) nextVolume = 0;
    if (nextVolume > 100) nextVolume = 100;
    
    try {
      ytPlayer.setVolume(nextVolume);
    } catch (err) {
      console.error('Unable to set YouTube player volume:', err);
      clearInterval(fadeInterval);
      fadeInterval = null;
      if (callback) callback();
      return;
    }
    updateStatusDashboard();

    if (currentStep >= steps) {
      ytPlayer.setVolume(targetVolume);
      clearInterval(fadeInterval);
      fadeInterval = null;
      if (callback) callback();
    }
  }, intervalTime);
}

function finishWelcomePlayback(reason = '') {
  if (!isWelcomePlaying) return;

  clearTimeout(welcomeRecoveryTimer);
  welcomeRecoveryTimer = null;
  isWelcomePlaying = false;
  if (reason) console.warn(`Welcome sound stopped: ${reason}`);

  fadeYtVolume(originalYtVolume, 1000, () => {
    addLogEntry("Volume Restored");
    updateStatusDashboard();
  });
}

function handleDoorOpenAction(forcePlay = false) {
  if (isWelcomePlaying) {
    console.log("Ignored door open event. Welcome sound is already playing.");
    return;
  }

  if (!forcePlay && Date.now() < welcomeCooldownUntil) {
    console.log("Ignored door open event. Welcome sound cooldown is active.");
    return;
  }

  isWelcomePlaying = true;
  const delaySeconds = getWelcomeDelaySeconds();
  welcomeCooldownUntil = Date.now() + (delaySeconds * 1000);
  try {
    originalYtVolume = ytPlayer && ytPlayerReady ? ytPlayer.getVolume() : 50;
  } catch (err) {
    originalYtVolume = 50;
  }

  addLogEntry("Welcome Sound Played");
  updateStatusDashboard();

  // Target volume: 20% of original volume level
  const targetFadeVol = Math.round(originalYtVolume * 0.2);

  // Fade the playlist down before the welcome sound begins.
  fadeYtVolume(targetFadeVol, 1000);

  const playWelcomeSound = () => {
    // Use the selected uploaded sound; fall back to the bundled default.
    const selectedSound = welcomeSounds.find(sound => sound.id === activeWelcomeId);
    const welcomeUrl = activeWelcomeId
      ? `/uploads/welcome/${encodeURIComponent(activeWelcomeId)}`
      : "/audio/welcome.mp3";
    clearTimeout(welcomeRecoveryTimer);
    welcomeAudio.pause();
    welcomeAudio.currentTime = 0;
    welcomeAudio.src = welcomeUrl;
    welcomeAudio.load();
    welcomeAudio.play()
      .then(() => {
        addLogEntry(`Playing ${selectedSound ? selectedSound.name : "welcome.mp3"}`);
        const duration = Number.isFinite(welcomeAudio.duration) ? welcomeAudio.duration : 60;
        welcomeRecoveryTimer = setTimeout(
          () => finishWelcomePlayback('playback timed out'),
          Math.min(Math.max(duration + 3, 10), 600) * 1000
        );
      })
      .catch(err => {
        console.error("Welcome sound playback failed:", err);
        finishWelcomePlayback('could not start');
      });
  };

  // Physical door detections wait two seconds; the top-bar test button plays
  // immediately so it can always be used for quick testing.
  if (forcePlay) {
    playWelcomeSound();
  } else {
    setTimeout(playWelcomeSound, 2000);
  }
}

welcomeAudio.addEventListener('ended', () => {
  finishWelcomePlayback();
});

welcomeAudio.addEventListener('error', () => finishWelcomePlayback('audio file could not be played'));

function getWelcomeDelaySeconds() {
  return welcomeDelaySeconds;
}

function normalizeWelcomeDelay(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 3600) : 90;
}

function loadWelcomeDelaySetting() {
  const saved = localStorage.getItem('welcomeDelaySeconds');
  welcomeDelaySeconds = normalizeWelcomeDelay(saved === null ? welcomeDelayInput.value : saved);
  welcomeDelayInput.value = welcomeDelaySeconds;
}

btnSetWelcomeDelay.addEventListener('click', () => {
  welcomeDelaySeconds = normalizeWelcomeDelay(welcomeDelayInput.value);
  welcomeDelayInput.value = welcomeDelaySeconds;
  localStorage.setItem('welcomeDelaySeconds', welcomeDelaySeconds);
});

// -------------------------------------------------------------
// System Status Dashboard Sync
// -------------------------------------------------------------

function updateStatusDashboard() {
  // Dashboard panel removed
}

// -------------------------------------------------------------
// Welcome Manager (local settings configuration)
// -------------------------------------------------------------

async function loadWelcomeSounds() {
  try {
    const res = await fetch('/welcome');
    const data = await res.json();
    welcomeSounds = data.sounds;
    activeWelcomeId = data.activeWelcomeSound;
    renderWelcomeSounds();
  } catch (err) {
    console.error("Failed to load welcome sounds:", err);
  }
}

function renderWelcomeSounds() {
  welcomeListUl.innerHTML = '';
  let activeName = 'welcome.mp3 (Default)';
  
  if (welcomeSounds.length === 0) {
    welcomeListUl.innerHTML = `<li style="text-align:center; font-size:12px; color: var(--text-secondary); padding: 8px;">No custom overrides</li>`;
    activeWelcomeName.textContent = activeName;
    return;
  }

  welcomeSounds.forEach(sound => {
    const isActive = sound.id === activeWelcomeId;
    if (isActive) activeName = sound.name;

    const li = document.createElement('li');
    li.className = `welcome-item ${isActive ? 'active' : ''}`;
    li.innerHTML = `
      <span>${sound.name}</span>
      <div class="welcome-item-actions">
        <button class="btn-small btn-small-success" onclick="previewWelcome('${sound.url}')"><i data-lucide="volume-2"></i></button>
        <button class="btn-small ${isActive ? 'btn-active' : ''}" onclick="selectWelcome('${sound.id}')"><i data-lucide="check-circle"></i></button>
        <button class="btn-small btn-small-danger" onclick="deleteWelcome('${sound.id}')"><i data-lucide="trash-2"></i></button>
      </div>
    `;
    welcomeListUl.appendChild(li);
  });
  activeWelcomeName.textContent = activeName;
  refreshIcons();
}

window.previewWelcome = (url) => {
  previewAudio.src = url;
  previewAudio.play().catch(e => console.error(e));
};

window.selectWelcome = async (id) => {
  try {
    const res = await fetch('/welcome/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      activeWelcomeId = id;
      loadWelcomeSounds();
    }
  } catch (err) {
    console.error(err);
  }
};

window.deleteWelcome = async (id) => {
  if (!confirm("Delete welcome sound?")) return;
  try {
    const res = await fetch(`/welcome/${id}`, { method: 'DELETE' });
    if (res.ok) loadWelcomeSounds();
  } catch (err) {
    console.error(err);
  }
};

welcomeFileInput.addEventListener('change', async () => {
  if (welcomeFileInput.files.length === 0) return;
  const formData = new FormData();
  formData.append('welcome', welcomeFileInput.files[0]);
  try {
    const res = await fetch('/upload-welcome', { method: 'POST', body: formData });
    if (res.ok) loadWelcomeSounds();
  } catch (err) {
    console.error(err);
  }
});

// -------------------------------------------------------------
// Live Event Logs
// -------------------------------------------------------------
function addLogEntry(message, time = null) {
  if (!message.toLowerCase().includes('door open')) return;
  const t = time || new Date().toLocaleTimeString();
  const item = document.createElement('div');
  item.className = 'log-item';
  item.innerHTML = `<span class="log-time">[${t}]</span> <span class="log-msg">${message}</span>`;
  logList.insertBefore(item, logList.firstChild);
  if (logList.children.length > 100) logList.removeChild(logList.lastChild);
}

btnClearLogs.addEventListener('click', () => { logList.innerHTML = ''; });

// -------------------------------------------------------------
// WebSocket Listeners (Socket.IO)
// -------------------------------------------------------------

socket.on('status_update', (status) => {
  updateDoorStatus(status.doorStatus);
  updateEspUI(status.esp32Connected);
  activeWelcomeId = status.activeWelcomeSound;
});

socket.on('esp32_status', (data) => {
  updateEspUI(data.connected);
});

socket.on('event_logged', (data) => {
  addLogEntry(data.message, data.time);
});

socket.on('door_event', (data) => {
  if (data.event === 'door_open') {
    updateDoorStatus('open');
    handleDoorOpenAction(Boolean(data.manual));
  }
});

function updateDoorStatus(status) {
  if (status === 'open') {
    doorStatusBadge.className = 'status-indicator status-open';
    doorStatusBadge.innerHTML = '<i data-lucide="door-open"></i> <span>Door: Opened!</span>';
    setTimeout(() => {
      doorStatusBadge.className = 'status-indicator';
      doorStatusBadge.innerHTML = '<i data-lucide="door-closed"></i> <span>Door: Idle</span>';
      refreshIcons();
      updateStatusDashboard();
    }, 5000);
  } else {
    doorStatusBadge.className = 'status-indicator';
    doorStatusBadge.innerHTML = '<i data-lucide="door-closed"></i> <span>Door: Idle</span>';
  }
  refreshIcons();
  updateStatusDashboard();
}

function updateEspUI(connected) {
  if (connected) {
    espStatusBadge.className = 'status-indicator status-online';
    espStatusBadge.innerHTML = '<i data-lucide="wifi"></i> <span>ESP32: Online</span>';
  } else {
    espStatusBadge.className = 'status-indicator status-offline';
    espStatusBadge.innerHTML = '<i data-lucide="wifi-off"></i> <span>ESP32: Offline</span>';
  }
  refreshIcons();
  updateStatusDashboard();
}

// -------------------------------------------------------------
// Simulator Event triggers
// -------------------------------------------------------------
simOpenBtn.addEventListener('click', async () => {
  try {
    await fetch('/door-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'door_open',
        manual: true,
        time: new Date().toISOString()
      })
    });
  } catch (err) {
    console.error(err);
  }
});

// App Clock
setInterval(() => {
  currentTimeEl.textContent = new Date().toLocaleTimeString();
}, 1000);

btnRefresh.addEventListener('click', () => {
  if (currentPlaylistId) {
    loadPlaylistById(currentPlaylistId, currentPlaylistUrl);
  }
});

// Playlist search filter
playlistSearch.addEventListener('input', () => {
  const query = playlistSearch.value.trim().toLowerCase();
  playlistVideos.forEach((videoId, idx) => {
    const row = document.getElementById(`yt-row-${idx}`);
    if (row) {
      const title = videoTitles[videoId] ? videoTitles[videoId].toLowerCase() : '';
      if (!query || title.includes(query)) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    }
  });
});

async function loadLogs() {
  try {
    const res = await fetch('/events');
    const logs = await res.json();
    logList.innerHTML = '';
    logs.forEach(log => {
      if (log.message.toLowerCase().includes('door open')) {
        const item = document.createElement('div');
        item.className = 'log-item';
        item.innerHTML = `<span class="log-time">[${log.time}]</span> <span class="log-msg">${log.message}</span>`;
        logList.appendChild(item);
      }
    });
  } catch (err) {
    console.error(err);
  }
}

let lastSavedState = { index: -1, time: -1 };

async function savePlaybackState() {
  const state = { volume: savedVolume };
  if (currentPlaylistId) {
    state.playlistId = currentPlaylistId;
    state.index = ytPlayer && typeof ytPlayer.getPlaylistIndex === 'function'
      ? ytPlayer.getPlaylistIndex()
      : 0;
    state.currentTime = ytPlayer && typeof ytPlayer.getCurrentTime === 'function'
      ? ytPlayer.getCurrentTime()
      : 0;
  }
  try {
    await fetch('/api/youtube/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
  } catch (e) {
    console.error("Failed to save playback state:", e);
  }
}

setInterval(async () => {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function' || typeof ytPlayer.getPlaylistIndex !== 'function' || typeof ytPlayer.getPlayerState !== 'function') return;
  
  const state = ytPlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED) {
    const idx = ytPlayer.getPlaylistIndex();
    const cur = ytPlayer.getCurrentTime();
    
    if (idx !== lastSavedState.index || Math.abs(cur - lastSavedState.time) > 2) {
      lastSavedState = { index: idx, time: cur };
      await savePlaybackState();
    }
  }
}, 2000);

// Load initialization parameters
loadWelcomeDelaySetting();
loadWelcomeSounds();
loadLogs();
refreshIcons();
