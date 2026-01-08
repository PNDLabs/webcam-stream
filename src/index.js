import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import Camera from './camera.js';
import Recorder from './recorder.js';
import Cleanup from './cleanup.js';
import createServer from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load configuration
const configPath = path.join(__dirname, '../config.json');
let config;

try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (err) {
  console.error('Failed to load config.json:', err.message);
  process.exit(1);
}

console.log('Starting Webcam Security Camera...');
console.log(`Camera device: ${config.camera.device}`);
console.log(`Resolution: ${config.camera.resolution} @ ${config.camera.framerate} fps`);
console.log(`Recording: ${config.recording.enabled ? 'Enabled' : 'Disabled'}`);
console.log(`Retention: ${config.recording.retentionDays} days`);

// Initialize components
const camera = new Camera(config.camera);
const recorder = new Recorder(config.recording, config.camera);
const cleanup = new Cleanup(config.recording);

// Create and start server
const app = createServer(camera, recorder, cleanup, config);

const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`\nServer running at http://localhost:${PORT}`);
  console.log(`MJPEG Stream: http://localhost:${PORT}/stream`);
  console.log(`Snapshot: http://localhost:${PORT}/snapshot`);
  console.log('\nHome Assistant configuration:');
  console.log('camera:');
  console.log('  - platform: generic');
  console.log('    name: "Security Camera"');
  console.log(`    still_image_url: "http://<IP>:${PORT}/snapshot"`);
  console.log(`    stream_source: "http://<IP>:${PORT}/stream"`);
});

// Start camera streaming
camera.start();

// Start recording once camera is running (pass camera for frame access)
camera.once('started', () => {
  if (config.recording.enabled) {
    // Give camera a moment to start emitting frames
    setTimeout(() => recorder.start(camera), 2000);
  }
});

// Start cleanup scheduler
cleanup.start();

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\nReceived ${signal}, shutting down...`);

  camera.stop();
  recorder.stop();
  cleanup.stop();

  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
