import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createServer(camera, recorder, cleanup, config) {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  // MJPEG Stream endpoint
  app.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache'
    });

    camera.addClient(res);
  });

  // Snapshot endpoint
  app.get('/snapshot', (req, res) => {
    const frame = camera.getSnapshot();

    if (frame) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': frame.length,
        'Cache-Control': 'no-cache'
      });
      res.end(frame);
    } else {
      res.status(503).json({ error: 'No frame available' });
    }
  });

  // API: Get status
  app.get('/api/status', (req, res) => {
    res.json({
      camera: camera.getStatus(),
      recorder: recorder.getStatus(),
      storage: cleanup.getStorageStats()
    });
  });

  // API: List recordings
  app.get('/api/recordings', (req, res) => {
    const outputDir = path.resolve(config.recording.outputDir);
    const recordings = [];

    try {
      const files = readdirSync(outputDir);

      for (const file of files) {
        if (!file.endsWith('.mp4')) continue;

        const filePath = path.join(outputDir, file);
        try {
          const stats = statSync(filePath);
          recordings.push({
            name: file,
            size: stats.size,
            sizeMB: (stats.size / 1024 / 1024).toFixed(2),
            created: stats.mtime.toISOString(),
            url: `/recordings/${file}`
          });
        } catch (err) {
          // Skip inaccessible files
        }
      }

      // Sort by date, newest first
      recordings.sort((a, b) => new Date(b.created) - new Date(a.created));

      res.json(recordings);
    } catch (err) {
      res.status(500).json({ error: 'Failed to list recordings' });
    }
  });

  // Serve recording files
  app.get('/recordings/:filename', (req, res) => {
    const filename = req.params.filename;

    // Sanitize filename to prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const outputDir = path.resolve(config.recording.outputDir);
    const filePath = path.join(outputDir, filename);

    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Recording not found' });
      }
    });
  });

  // API: Get config
  app.get('/api/config', (req, res) => {
    res.json(config);
  });

  // API: Update config
  app.post('/api/config', (req, res) => {
    try {
      const updates = req.body;
      const recordingUpdates = {};
      const watermarkUpdates = {};
      const cameraUpdates = {};
      let cameraChanged = false;

      // Camera settings
      if (updates.camera) {
        if (updates.camera.device !== undefined) {
          config.camera.device = updates.camera.device;
          cameraUpdates.device = updates.camera.device;
          cameraChanged = true;
        }
        if (updates.camera.resolution !== undefined) {
          config.camera.resolution = updates.camera.resolution;
          cameraUpdates.resolution = updates.camera.resolution;
          cameraChanged = true;
        }
        if (updates.camera.framerate !== undefined) {
          const fps = parseInt(updates.camera.framerate, 10);
          if (fps >= 1 && fps <= 60) {
            config.camera.framerate = fps;
            cameraUpdates.framerate = fps;
            cameraChanged = true;
          }
        }
      }

      // Recording settings
      if (updates.recording) {
        if (updates.recording.retentionDays !== undefined) {
          const days = parseInt(updates.recording.retentionDays, 10);
          if (days >= 1 && days <= 365) {
            config.recording.retentionDays = days;
            recordingUpdates.retentionDays = days;
            cleanup.updateConfig({ retentionDays: days });
          }
        }
        if (updates.recording.enabled !== undefined) {
          config.recording.enabled = Boolean(updates.recording.enabled);
          recordingUpdates.enabled = config.recording.enabled;
        }
        if (updates.recording.segmentDuration !== undefined) {
          const duration = parseInt(updates.recording.segmentDuration, 10);
          if (duration >= 60 && duration <= 86400) {
            config.recording.segmentDuration = duration;
            recordingUpdates.segmentDuration = duration;
          }
        }
      }

      // Watermark settings
      if (updates.watermark) {
        if (updates.watermark.enabled !== undefined) {
          config.watermark.enabled = Boolean(updates.watermark.enabled);
          watermarkUpdates.enabled = config.watermark.enabled;
        }
        if (updates.watermark.format !== undefined) {
          config.watermark.format = updates.watermark.format;
          watermarkUpdates.format = updates.watermark.format;
        }
        if (updates.watermark.position !== undefined) {
          const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
          if (validPositions.includes(updates.watermark.position)) {
            config.watermark.position = updates.watermark.position;
            watermarkUpdates.position = updates.watermark.position;
          }
        }
        if (updates.watermark.fontSize !== undefined) {
          const size = parseInt(updates.watermark.fontSize, 10);
          if (size >= 8 && size <= 72) {
            config.watermark.fontSize = size;
            watermarkUpdates.fontSize = size;
          }
        }
        if (updates.watermark.fontColor !== undefined) {
          config.watermark.fontColor = updates.watermark.fontColor;
          watermarkUpdates.fontColor = updates.watermark.fontColor;
        }
        if (updates.watermark.backgroundColor !== undefined) {
          config.watermark.backgroundColor = updates.watermark.backgroundColor;
          watermarkUpdates.backgroundColor = updates.watermark.backgroundColor;
        }
      }

      // Legacy support for flat structure
      if (updates.retentionDays !== undefined) {
        const days = parseInt(updates.retentionDays, 10);
        if (days >= 1 && days <= 365) {
          config.recording.retentionDays = days;
          recordingUpdates.retentionDays = days;
          cleanup.updateConfig({ retentionDays: days });
        }
      }
      if (updates.recordingEnabled !== undefined) {
        config.recording.enabled = Boolean(updates.recordingEnabled);
        recordingUpdates.enabled = config.recording.enabled;
      }

      // Apply updates to components
      if (Object.keys(cameraUpdates).length > 0) {
        camera.updateConfig(cameraUpdates);
        recorder.updateCameraConfig(cameraUpdates);
      }

      const hasWatermarkUpdates = Object.keys(watermarkUpdates).length > 0;
      recorder.updateConfig(recordingUpdates, hasWatermarkUpdates ? watermarkUpdates : null);

      // Save config to file
      const configPath = path.join(__dirname, '../config.json');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      res.json({ success: true, config, restarting: cameraChanged });
    } catch (err) {
      console.error('Config update error:', err);
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  // API: Toggle recording
  app.post('/api/recording/toggle', (req, res) => {
    if (recorder.isRecording) {
      recorder.stop();
    } else {
      recorder.start(camera);
    }
    res.json({ recording: recorder.isRecording });
  });

  // API: Manual cleanup
  app.post('/api/cleanup', (req, res) => {
    const result = cleanup.cleanOldRecordings();
    res.json(result);
  });

  // API: Delete specific recording
  app.delete('/api/recordings/:filename', (req, res) => {
    const filename = req.params.filename;

    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const outputDir = path.resolve(config.recording.outputDir);
    const filePath = path.join(outputDir, filename);

    try {
      unlinkSync(filePath);
      res.json({ success: true });
    } catch (err) {
      res.status(404).json({ error: 'Recording not found' });
    }
  });

  return app;
}

export default createServer;
