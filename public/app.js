/* ── PWA: Service Worker ─────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}

/* ── PWA: Install Prompt ─────────────────────────────── */
let deferredInstall = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  document.getElementById('installBtn').classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  document.getElementById('installBtn').classList.add('hidden');
});

async function installApp() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  document.getElementById('installBtn').classList.add('hidden');
}

/* ── PWA: Network Status ─────────────────────────────── */
function updateOnlineStatus() {
  const banner = document.getElementById('offlineBanner');
  if (navigator.onLine) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
}

window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/* ── Wake Lock (keep screen on while streaming) ──────── */
let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) { /* not critical */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock && document.visibilityState === 'visible') {
    await acquireWakeLock();
  }
});

/* ── Tab Navigation ──────────────────────────────────── */
let activeTab = 'stream';
let recordingsFilter = 'all';
let currentPlaybackEvents = [];

function switchTab(name, btn) {
  // Panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');

  // Nav buttons
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-current', 'page');

  activeTab = name;

  // Wake lock only while streaming
  if (name === 'stream') {
    acquireWakeLock();
  } else {
    releaseWakeLock();
    // Load data for the newly shown tab
    if (name === 'recordings') loadRecordings();
  }

  // Update URL hash without triggering scroll
  history.replaceState(null, '', '/?tab=' + name);
}

/* ── Config Sub-tabs ─────────────────────────────────── */
function showConfigTab(name, btn) {
  document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.config-tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });

  document.getElementById(name + 'Config').classList.add('active');
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
}

/* ── Rotation Button Selection ───────────────────────── */
function selectRotation(degrees, btn) {
  document.querySelectorAll('.rotation-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('cameraRotation').value = degrees;
}

/* ── Fullscreen ──────────────────────────────────────── */
function toggleFullscreen() {
  const box = document.getElementById('videoBox');
  const icon = document.getElementById('fullscreenIcon');

  const enterPath = '<path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>';
  const exitPath  = '<path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>';

  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    (box.requestFullscreen || box.webkitRequestFullscreen).call(box);
    icon.innerHTML = exitPath;
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    icon.innerHTML = enterPath;
  }
}

document.addEventListener('fullscreenchange', () => {
  const icon = document.getElementById('fullscreenIcon');
  const enterPath = '<path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>';
  if (!document.fullscreenElement) icon.innerHTML = enterPath;
});

/* ── Status Polling ──────────────────────────────────── */
let statusInterval;

async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const s = await res.json();

    // Camera dot
    const camDot = document.getElementById('cameraStatus');
    camDot.className = 'status-dot ' + (s.camera.running ? 'status-online' : 'status-offline');
    camDot.title = s.camera.running ? 'Camera Online' : 'Camera Offline';

    // Recording dot
    const recDot = document.getElementById('recordingStatus');
    recDot.className = 'status-dot ' + (s.recorder.recording ? 'status-recording' : 'status-offline');
    recDot.title = s.recorder.recording ? 'Recording Active' : 'Not Recording';

    // Update record button state
    const recordBtn = document.getElementById('recordBtn');
    if (s.recorder.recording) {
      recordBtn.classList.add('active');
      document.getElementById('recordLabel').textContent = 'Stop';
    } else {
      recordBtn.classList.remove('active');
      document.getElementById('recordLabel').textContent = 'Record';
    }

    // Viewer count
    document.getElementById('viewerNum').textContent = s.camera.clients || 0;

    // Storage display
    updateStorageUI(s.storage);

  } catch (_) { /* offline or server down */ }
}

function updateStorageUI(storage) {
  const usedMB  = storage.totalSizeMB || 0;
  const usedGB  = usedMB > 1024 ? (usedMB / 1024).toFixed(1) + ' GB' : usedMB + ' MB';
  const files   = storage.totalFiles || 0;
  const pct     = Math.min(100, Math.round((usedMB / (storage.retentionDays * 1024)) * 100)) || 0;

  // Stream tab
  const stText = document.getElementById('storageText');
  const stBar  = document.getElementById('storageBarFill');
  if (stText) stText.textContent = `${files} files · ${usedGB}`;
  if (stBar)  stBar.style.width  = pct + '%';

  // Recordings tab
  const recText = document.getElementById('recordingStorageText');
  if (recText) recText.textContent = `${files} recordings · ${usedGB} used`;

  // Settings detail
  const detail = document.getElementById('storageStats');
  if (detail) {
    detail.innerHTML =
      `Files: ${files}<br>` +
      `Size: ${usedMB} MB<br>` +
      `Retention: ${storage.retentionDays} days<br>` +
      `Oldest: ${storage.oldestFile || 'None'}<br>` +
      `Newest: ${storage.newestFile || 'None'}`;
  }
}

/* ── Config Load / Save ──────────────────────────────── */
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const cfg = await res.json();

    // Camera
    document.getElementById('cameraDevice').value     = cfg.camera.device     || '';
    document.getElementById('cameraResolution').value = cfg.camera.resolution || '1280x720';
    document.getElementById('cameraFramerate').value  = cfg.camera.framerate  || 1;

    const rot = cfg.camera.rotation || 0;
    document.getElementById('cameraRotation').value = rot;
    document.querySelectorAll('.rotation-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.textContent) === rot);
    });

    // Recording
    document.getElementById('recordingEnabled').checked = cfg.recording.enabled !== false;
    document.getElementById('retentionDays').value      = cfg.recording.retentionDays || 7;
    document.getElementById('segmentDuration').value    = cfg.recording.segmentDuration || 1800;

    // Watermark
    document.getElementById('watermarkEnabled').checked = cfg.watermark.enabled !== false;
    document.getElementById('watermarkPosition').value  = cfg.watermark.position  || 'bottom-right';
    document.getElementById('watermarkFontSize').value  = cfg.watermark.fontSize  || 24;
    document.getElementById('watermarkFontColor').value = cfg.watermark.fontColor || 'white';

    // Audio
    const audio = cfg.audio || {};
    document.getElementById('audioEnabled').checked = audio.enabled === true;
    document.getElementById('audioDevice').value    = audio.device || 'hw:0,0';

  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

async function saveConfig() {
  const btn    = document.getElementById('saveBtn');
  const status = document.getElementById('saveStatus');

  btn.disabled    = true;
  btn.textContent = 'Saving...';
  status.textContent = '';

  const payload = {
    camera: {
      device:     document.getElementById('cameraDevice').value,
      resolution: document.getElementById('cameraResolution').value,
      framerate:  parseInt(document.getElementById('cameraFramerate').value, 10),
      rotation:   parseInt(document.getElementById('cameraRotation').value, 10)
    },
    recording: {
      enabled:         document.getElementById('recordingEnabled').checked,
      retentionDays:   parseInt(document.getElementById('retentionDays').value, 10),
      segmentDuration: parseInt(document.getElementById('segmentDuration').value, 10)
    },
    watermark: {
      enabled:   document.getElementById('watermarkEnabled').checked,
      position:  document.getElementById('watermarkPosition').value,
      fontSize:  parseInt(document.getElementById('watermarkFontSize').value, 10),
      fontColor: document.getElementById('watermarkFontColor').value
    },
    audio: {
      enabled: document.getElementById('audioEnabled').checked,
      device:  document.getElementById('audioDevice').value.trim() || 'hw:0,0'
    }
  };

  try {
    const res = await fetch('/api/config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });

    if (res.ok) {
      const result = await res.json();
      status.textContent = result.restarting ? 'Saved — restarting camera...' : 'Saved!';
      if (result.restarting) {
        setTimeout(() => { reconnectStream(); }, 2200);
      }
      setTimeout(() => { status.textContent = ''; }, 3000);
      refreshStatus();
    } else {
      status.textContent = 'Failed to save';
      status.style.color = 'var(--danger)';
      setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 3000);
    }
  } catch (_) {
    status.textContent = 'Error — check connection';
    status.style.color = 'var(--danger)';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 3000);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save Settings';
  }
}

/* ── Stream ──────────────────────────────────────────── */
function showStreamError() {
  document.getElementById('streamError').classList.remove('hidden');
}

function reconnectStream() {
  const img = document.getElementById('liveStream');
  document.getElementById('streamError').classList.add('hidden');
  img.src = '/stream?' + Date.now();
}

/* ── Snapshot ────────────────────────────────────────── */
function takeSnapshot() {
  window.open('/snapshot', '_blank');
}

/* ── Recording Toggle ────────────────────────────────── */
async function toggleRecording() {
  try {
    await fetch('/api/recording/toggle', { method: 'POST' });
    refreshStatus();
  } catch (_) {
    alert('Failed to toggle recording');
  }
}

/* ── Recordings List ─────────────────────────────────── */
async function loadRecordings() {
  const list = document.getElementById('recordingsList');
  list.innerHTML = '<div class="list-placeholder">Loading...</div>';

  try {
    const query = recordingsFilter && recordingsFilter !== 'all'
      ? `?filter=${encodeURIComponent(recordingsFilter)}`
      : '';
    const res = await fetch('/api/recordings' + query);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const recordings = await res.json();

    if (!recordings.length) {
      list.innerHTML = '<div class="list-placeholder">No recordings yet</div>';
      return;
    }

    list.innerHTML = recordings.map(rec => `
      <div class="recording-card">
        <div class="recording-card-body">
          <div>
            <div class="recording-name">${escapeHtml(rec.name)}</div>
            <div class="recording-meta">${rec.sizeMB} MB &mdash; ${formatDate(rec.created)}</div>
            <div class="recording-activity">
              ${buildActivityBadges(rec)}
            </div>
          </div>
        </div>
        <div class="recording-actions">
          <button class="rec-btn rec-btn-play" onclick="playRecording('${escapeHtml(rec.url)}', '${escapeHtml(rec.name)}')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Play
          </button>
          <button class="rec-btn rec-btn-download" onclick="downloadRecording('${escapeHtml(rec.url)}', '${escapeHtml(rec.name)}')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Save
          </button>
          <button class="rec-btn rec-btn-delete" onclick="deleteRecording('${escapeHtml(rec.name)}')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            Delete
          </button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.error('Failed to load recordings:', err);
    list.innerHTML = '<div class="list-placeholder">Failed to load recordings</div>';
  }
}

function buildActivityBadges(recording) {
  const badges = [];
  if (recording.hasMotion) badges.push('<span class="activity-badge activity-badge-motion">Motion</span>');
  if (recording.hasSound) badges.push('<span class="activity-badge activity-badge-sound">Sound</span>');
  if (!badges.length) badges.push('<span class="activity-badge">No activity</span>');
  return badges.join('');
}

function setRecordingFilter(filter, btn) {
  recordingsFilter = filter;
  document.querySelectorAll('.recording-filters .btn').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadRecordings();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/* ── Playback ────────────────────────────────────────── */
async function playRecording(url, name) {
  const section = document.getElementById('playbackSection');
  const video   = document.getElementById('playbackVideo');
  const title   = document.getElementById('playbackTitle');

  title.textContent = name;
  currentPlaybackEvents = await loadRecordingEvents(name);
  renderTimelineMarkers();

  video.onloadedmetadata = () => renderTimelineMarkers();
  video.src = url;
  section.classList.remove('hidden');
  video.play().catch((err) => {
    console.debug('Playback start requires user interaction:', err?.message || err);
  });
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closePlayback() {
  const video = document.getElementById('playbackVideo');
  video.pause();
  video.onloadedmetadata = null;
  video.src = '';
  currentPlaybackEvents = [];
  renderTimelineMarkers();
  document.getElementById('playbackSection').classList.add('hidden');
}

async function loadRecordingEvents(recordingName) {
  try {
    const res = await fetch(`/api/recordings/${encodeURIComponent(recordingName)}/events`);
    if (!res.ok) return [];
    const payload = await res.json();
    return Array.isArray(payload.events) ? payload.events : [];
  } catch (_) {
    return [];
  }
}

function renderTimelineMarkers() {
  const video = document.getElementById('playbackVideo');
  const markerWrap = document.getElementById('timelineMarkersWrap');
  const markerContainer = document.getElementById('timelineMarkers');
  if (!markerWrap || !markerContainer) return;

  markerContainer.innerHTML = '';

  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0 || !currentPlaybackEvents.length) {
    markerWrap.classList.add('hidden');
    return;
  }

  const maxMarkers = 200;
  const events = currentPlaybackEvents.slice(0, maxMarkers);
  for (const event of events) {
    const startSec = Number(event.startSec);
    if (!Number.isFinite(startSec) || startSec < 0 || startSec > duration) continue;

    const marker = document.createElement('button');
    marker.className = `timeline-marker timeline-marker-${event.type === 'sound' ? 'sound' : 'motion'}`;
    marker.style.left = `${(startSec / duration) * 100}%`;
    marker.title = `${event.type || 'event'} at ${formatMarkerTime(startSec)}`;
    marker.setAttribute('aria-label', marker.title);
    marker.onclick = () => {
      video.currentTime = startSec;
      video.play().catch((err) => {
        console.debug('Playback resume requires user interaction:', err?.message || err);
      });
    };
    markerContainer.appendChild(marker);
  }

  markerWrap.classList.remove('hidden');
}

function formatMarkerTime(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(sec / 60);
  const seconds = String(sec % 60).padStart(2, '0');
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
  }
  return `${minutes}:${seconds}`;
}

function downloadRecording(url, name) {
  const a = document.createElement('a');
  a.href     = url;
  a.download = name;
  a.click();
}

async function deleteRecording(name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    const res = await fetch(`/api/recordings/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (res.ok) {
      loadRecordings();
      refreshStatus();
    } else {
      alert('Failed to delete recording');
    }
  } catch (_) {
    alert('Failed to delete recording');
  }
}

/* ── Cleanup ─────────────────────────────────────────── */
async function runCleanup() {
  try {
    const res    = await fetch('/api/cleanup', { method: 'POST' });
    const result = await res.json();
    alert(`Cleanup complete: ${result.deletedCount || 0} file(s) deleted`);
    loadRecordings();
    refreshStatus();
  } catch (_) {
    alert('Cleanup failed');
  }
}

/* ── Init ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Handle ?tab= URL param
  const params  = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab');
  if (tabParam && ['stream', 'recordings', 'settings'].includes(tabParam)) {
    const navBtn = document.getElementById('nav-' + tabParam);
    if (navBtn) switchTab(tabParam, navBtn);
  }

  // Set HA URL dynamically
  const haEl = document.getElementById('haUrl');
  if (haEl) haEl.textContent = `http://${location.hostname}:${location.port || 8081}/stream`;

  updateOnlineStatus();
  loadConfig();
  refreshStatus();
  acquireWakeLock();

  // Poll status every 5s
  statusInterval = setInterval(refreshStatus, 5000);

  // Stream error handler
  document.getElementById('liveStream').onerror = showStreamError;
});
