import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

class Recorder {
  constructor(config, cameraConfig, watermarkConfig = {}) {
    this.config = config;
    this.cameraConfig = cameraConfig;
    this.watermarkConfig = watermarkConfig;
    this.process = null;
    this.isRecording = false;
    this.currentFile = null;
    this.segmentTimer = null;
    this.frameHandler = null;
  }

  buildWatermarkFilter() {
    if (!this.watermarkConfig.enabled) {
      return null;
    }

    const {
      format = '%Y-%m-%d %H:%M:%S',
      position = 'bottom-right',
      fontSize = 24,
      fontColor = 'white',
      backgroundColor = 'black@0.5'
    } = this.watermarkConfig;

    // Escape colons in the format string for FFmpeg drawtext
    // Colons need double-escaping: \\\: in JS becomes \\: passed to FFmpeg
    const escapedFormat = format.replace(/:/g, '\\\\:');

    // Calculate position coordinates
    const padding = 10;
    let x, y;
    switch (position) {
      case 'top-left':
        x = padding;
        y = padding;
        break;
      case 'top-right':
        x = `w-tw-${padding}`;
        y = padding;
        break;
      case 'bottom-left':
        x = padding;
        y = `h-th-${padding}`;
        break;
      case 'bottom-right':
      default:
        x = `w-tw-${padding}`;
        y = `h-th-${padding}`;
        break;
    }

    // Build filter - use simple escaping for spawn (no shell)
    return `drawtext=text='%{localtime}':fontsize=${fontSize}:fontcolor=${fontColor}:box=1:boxcolor=black:boxborderw=5:x=${x}:y=${y}`;
  }

  ensureOutputDir() {
    const outputDir = path.resolve(this.config.outputDir);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    return outputDir;
  }

  generateFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');

    return `${year}-${month}-${day}_${hour}-00.mp4`;
  }

  start(camera) {
    if (!this.config.enabled) {
      console.log('Recording is disabled in config');
      return;
    }

    if (this.isRecording) {
      console.log('Already recording');
      return;
    }

    this.camera = camera;
    this.startSegment();
    this.scheduleNextSegment();
  }

  startSegment() {
    const outputDir = this.ensureOutputDir();
    const filename = this.generateFilename();
    this.currentFile = path.join(outputDir, filename);

    // FFmpeg receives MJPEG frames via stdin and outputs MP4
    const watermarkFilter = this.buildWatermarkFilter();
    const args = [
      '-f', 'mjpeg',
      '-framerate', String(this.cameraConfig.framerate),
      '-i', 'pipe:0',
      ...(watermarkFilter ? ['-vf', watermarkFilter] : []),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '23',
      '-movflags', '+faststart',
      '-t', String(this.config.segmentDuration),
      '-y',
      this.currentFile
    ];

    console.log(`Starting recording: ${this.currentFile}`);
    console.log(`FFmpeg args: ffmpeg ${args.join(' ')}`);

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.isRecording = true;

    // Handle frames from camera
    this.frameHandler = (frame) => {
      if (this.process && this.process.stdin.writable) {
        try {
          this.process.stdin.write(frame);
        } catch (err) {
          // Ignore write errors
        }
      }
    };

    this.camera.on('frame', this.frameHandler);

    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      // Log errors and filter-related issues
      if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid') || msg.includes('drawtext')) {
        console.error('Recording FFmpeg:', msg.trim());
      }
    });

    this.process.on('close', (code) => {
      console.log(`Recording segment completed: ${this.currentFile} (exit code: ${code})`);

      if (this.frameHandler && this.camera) {
        this.camera.removeListener('frame', this.frameHandler);
        this.frameHandler = null;
      }

      this.isRecording = false;

      // Start next segment if we're still supposed to be recording
      if (this.segmentTimer && this.config.enabled) {
        setTimeout(() => this.startSegment(), 1000);
      }
    });

    this.process.on('error', (err) => {
      console.error('Recording process error:', err);
      this.isRecording = false;
    });
  }

  scheduleNextSegment() {
    // Calculate time until next hour boundary
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const msUntilNextHour = nextHour.getTime() - now.getTime();

    // Schedule segment restart at hour boundary
    this.segmentTimer = setTimeout(() => {
      this.stopCurrentSegment();
      this.scheduleNextSegment();
    }, msUntilNextHour);

    console.log(`Next segment scheduled in ${Math.round(msUntilNextHour / 1000 / 60)} minutes`);
  }

  stopCurrentSegment() {
    if (this.frameHandler && this.camera) {
      this.camera.removeListener('frame', this.frameHandler);
      this.frameHandler = null;
    }

    if (this.process) {
      if (this.process.stdin.writable) {
        this.process.stdin.end();
      }
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  stop() {
    if (this.segmentTimer) {
      clearTimeout(this.segmentTimer);
      this.segmentTimer = null;
    }
    this.stopCurrentSegment();
    this.isRecording = false;
    console.log('Recording stopped');
  }

  getStatus() {
    return {
      recording: this.isRecording,
      enabled: this.config.enabled,
      currentFile: this.currentFile,
      segmentDuration: this.config.segmentDuration,
      retentionDays: this.config.retentionDays,
      outputDir: this.config.outputDir
    };
  }

  updateConfig(newConfig, watermarkConfig = null) {
    const wasEnabled = this.config.enabled;
    const wasRecording = this.isRecording;

    // Check if watermark config changed
    const watermarkChanged = watermarkConfig !== null &&
      JSON.stringify(this.watermarkConfig) !== JSON.stringify({ ...this.watermarkConfig, ...watermarkConfig });

    // Check if segment duration changed
    const segmentDurationChanged = newConfig.segmentDuration !== undefined &&
      newConfig.segmentDuration !== this.config.segmentDuration;

    this.config = { ...this.config, ...newConfig };

    if (watermarkConfig !== null) {
      this.watermarkConfig = { ...this.watermarkConfig, ...watermarkConfig };
    }

    if (wasEnabled && !this.config.enabled) {
      this.stop();
    } else if (!wasEnabled && this.config.enabled && this.camera) {
      this.start(this.camera);
    } else if (wasRecording && (watermarkChanged || segmentDurationChanged)) {
      // Restart current segment to apply watermark or duration changes
      console.log('Recording config changed, restarting segment...');
      this.stopCurrentSegment();
      setTimeout(() => this.startSegment(), 1000);
    }
  }

  updateCameraConfig(cameraConfig) {
    this.cameraConfig = { ...this.cameraConfig, ...cameraConfig };
  }
}

export default Recorder;
