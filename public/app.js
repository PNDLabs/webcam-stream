let statusInterval;

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadRecordings();
  refreshStatus();

  // Refresh status every 5 seconds
  statusInterval = setInterval(refreshStatus, 5000);

  // Handle stream errors
  const stream = document.getElementById('liveStream');
  stream.onerror = () => showStreamError();
});

async function refreshStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();

    // Update camera status
    const cameraStatus = document.getElementById('cameraStatus');
    if (status.camera.running) {
      cameraStatus.textContent = 'Camera: Online';
      cameraStatus.className = 'status-badge online';
    } else {
      cameraStatus.textContent = 'Camera: Offline';
      cameraStatus.className = 'status-badge offline';
    }

    // Update recording status
    const recordingStatus = document.getElementById('recordingStatus');
    if (status.recorder.recording) {
      recordingStatus.textContent = 'Recording: Active';
      recordingStatus.className = 'status-badge recording';
    } else {
      recordingStatus.textContent = 'Recording: Off';
      recordingStatus.className = 'status-badge offline';
    }

    // Update viewer count
    document.getElementById('clientCount').textContent = `Viewers: ${status.camera.clients}`;

    // Update storage stats
    const storage = status.storage;
    document.getElementById('storageStats').innerHTML = `
      Files: ${storage.totalFiles}<br>
      Size: ${storage.totalSizeMB} MB<br>
      Oldest: ${storage.oldestFile || 'None'}<br>
      Newest: ${storage.newestFile || 'None'}<br>
      Retention: ${storage.retentionDays} days
    `;
  } catch (err) {
    console.error('Failed to refresh status:', err);
  }
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();

    document.getElementById('retentionDays').value = config.recording.retentionDays;
    document.getElementById('recordingEnabled').checked = config.recording.enabled;
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

async function saveConfig() {
  const retentionDays = parseInt(document.getElementById('retentionDays').value, 10);
  const recordingEnabled = document.getElementById('recordingEnabled').checked;

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays, recordingEnabled })
    });

    if (response.ok) {
      alert('Configuration saved!');
      refreshStatus();
    } else {
      alert('Failed to save configuration');
    }
  } catch (err) {
    console.error('Failed to save config:', err);
    alert('Failed to save configuration');
  }
}

async function loadRecordings() {
  const list = document.getElementById('recordingsList');
  list.innerHTML = '<p>Loading...</p>';

  try {
    const response = await fetch('/api/recordings');
    const recordings = await response.json();

    if (recordings.length === 0) {
      list.innerHTML = '<p>No recordings available</p>';
      return;
    }

    list.innerHTML = recordings.map(rec => `
      <div class="recording-item">
        <div class="recording-info">
          <div class="recording-name">${rec.name}</div>
          <div class="recording-meta">${rec.sizeMB} MB - ${formatDate(rec.created)}</div>
        </div>
        <div class="recording-actions">
          <button onclick="playRecording('${rec.url}')">Play</button>
          <button onclick="downloadRecording('${rec.url}', '${rec.name}')">Download</button>
          <button class="delete-btn" onclick="deleteRecording('${rec.name}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load recordings:', err);
    list.innerHTML = '<p>Failed to load recordings</p>';
  }
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString();
}

function playRecording(url) {
  const section = document.getElementById('playbackSection');
  const video = document.getElementById('playbackVideo');

  video.src = url;
  section.classList.remove('hidden');
  video.play();

  section.scrollIntoView({ behavior: 'smooth' });
}

function closePlayback() {
  const section = document.getElementById('playbackSection');
  const video = document.getElementById('playbackVideo');

  video.pause();
  video.src = '';
  section.classList.add('hidden');
}

function downloadRecording(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

async function deleteRecording(filename) {
  if (!confirm(`Delete recording ${filename}?`)) return;

  try {
    const response = await fetch(`/api/recordings/${filename}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      loadRecordings();
      refreshStatus();
    } else {
      alert('Failed to delete recording');
    }
  } catch (err) {
    console.error('Failed to delete recording:', err);
    alert('Failed to delete recording');
  }
}

async function toggleRecording() {
  try {
    const response = await fetch('/api/recording/toggle', { method: 'POST' });
    const result = await response.json();
    refreshStatus();
  } catch (err) {
    console.error('Failed to toggle recording:', err);
    alert('Failed to toggle recording');
  }
}

async function runCleanup() {
  try {
    const response = await fetch('/api/cleanup', { method: 'POST' });
    const result = await response.json();
    alert(`Cleanup complete: ${result.deletedCount} files deleted`);
    loadRecordings();
    refreshStatus();
  } catch (err) {
    console.error('Failed to run cleanup:', err);
    alert('Failed to run cleanup');
  }
}

function takeSnapshot() {
  window.open('/snapshot', '_blank');
}

function showStreamError() {
  document.getElementById('streamError').classList.remove('hidden');
}

function reconnectStream() {
  const stream = document.getElementById('liveStream');
  const error = document.getElementById('streamError');

  stream.src = '/stream?' + Date.now();
  error.classList.add('hidden');
}
