import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

class Recorder {
  constructor(config, cameraConfig, watermarkConfig = {}, audioConfig = {}) {
    this.config = config;
    this.cameraConfig = cameraConfig;
    this.watermarkConfig = watermarkConfig;
    this.audioConfig = audioConfig;
    this.process = null;
    this.isRecording = false;
    this.currentFile = null;
    this.segmentTimer = null;
    this.frameHandler = null;
    this.segmentStartedAt = null;
    this.segmentEvents = [];
    this.motionState = null;
    this.soundState = null;
    this.detectionConfig = this.normalizeDetectionConfig(config.eventDetection);
  }

  normalizeDetectionConfig(eventDetection = {}) {
    const defaults = {
      enabled: false,
      motionEnabled: true,
      soundEnabled: true,
      motionThreshold: 0.12,
      motionSampleIntervalMs: 500,
      motionMinDurationMs: 800,
      motionEndAfterMs: 1200,
      soundSilenceDb: -40,
      soundSilenceDurationSec: 0.6
    };

    const candidate = {
      ...defaults,
      ...(eventDetection || {})
    };

    const clampNumber = (value, fallback, min, max) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, parsed));
    };

    return {
      enabled: Boolean(candidate.enabled),
      motionEnabled: Boolean(candidate.motionEnabled),
      soundEnabled: Boolean(candidate.soundEnabled),
      motionThreshold: clampNumber(candidate.motionThreshold, defaults.motionThreshold, 0, 1),
      motionSampleIntervalMs: Math.round(clampNumber(candidate.motionSampleIntervalMs, defaults.motionSampleIntervalMs, 100, 10000)),
      motionMinDurationMs: Math.round(clampNumber(candidate.motionMinDurationMs, defaults.motionMinDurationMs, 0, 20000)),
      motionEndAfterMs: Math.round(clampNumber(candidate.motionEndAfterMs, defaults.motionEndAfterMs, 100, 20000)),
      soundSilenceDb: clampNumber(candidate.soundSilenceDb, defaults.soundSilenceDb, -100, 0),
      soundSilenceDurationSec: clampNumber(candidate.soundSilenceDurationSec, defaults.soundSilenceDurationSec, 0.1, 10)
    };
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
    const segmentFile = this.currentFile;
    this.segmentStartedAt = Date.now();
    this.initializeSegmentDetection();

    // FFmpeg receives MJPEG frames via stdin and outputs MP4
    const watermarkFilter = this.buildWatermarkFilter();
    const audioEnabled = this.audioConfig && this.audioConfig.enabled;
    const audioDevice = (this.audioConfig && this.audioConfig.device) || 'hw:0,0';
    const detectSound = this.shouldDetectSound(audioEnabled);
    const silenceDb = this.detectionConfig.soundSilenceDb;
    const silenceDurationSec = this.detectionConfig.soundSilenceDurationSec;
    const soundFilter = detectSound
      ? `silencedetect=n=${silenceDb}dB:d=${silenceDurationSec}`
      : null;

    const args = [
      // Audio input (captured directly from ALSA before video so it starts first)
      ...(audioEnabled ? ['-f', 'alsa', '-thread_queue_size', '512', '-i', audioDevice] : []),
      // Video input from stdin (MJPEG frames)
      '-f', 'mjpeg',
      '-framerate', String(this.cameraConfig.framerate),
      '-i', 'pipe:0',
      ...(watermarkFilter ? ['-vf', watermarkFilter] : []),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '23',
      ...(soundFilter ? ['-af', soundFilter] : []),
      ...(audioEnabled ? ['-c:a', 'aac', '-b:a', '128k'] : []),
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
      this.processFrameDetections(frame);
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
      this.processSoundDetections(msg);
      // Log errors and filter-related issues
      if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid') || msg.includes('drawtext')) {
        console.error('Recording FFmpeg:', msg.trim());
      }
    });

    this.process.on('close', (code) => {
      console.log(`Recording segment completed: ${segmentFile} (exit code: ${code})`);
      this.persistSegmentMetadata(segmentFile);

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

  initializeSegmentDetection() {
    this.segmentEvents = [];
    this.motionState = {
      previousSample: null,
      active: false,
      activeStartSec: null,
      lastMotionTs: 0,
      lastSampleTs: 0
    };
    this.soundState = {
      active: this.shouldDetectSound(this.audioConfig?.enabled),
      activeStartSec: this.shouldDetectSound(this.audioConfig?.enabled) ? 0 : null
    };
  }

  shouldDetectMotion() {
    return Boolean(this.detectionConfig.enabled && this.detectionConfig.motionEnabled);
  }

  shouldDetectSound(audioEnabled) {
    return Boolean(this.detectionConfig.enabled && this.detectionConfig.soundEnabled && audioEnabled);
  }

  processFrameDetections(frame) {
    if (!this.shouldDetectMotion() || !this.motionState) {
      return;
    }

    const now = Date.now();
    const sampleIntervalMs = this.detectionConfig.motionSampleIntervalMs;
    if (now - this.motionState.lastSampleTs < sampleIntervalMs) {
      return;
    }
    this.motionState.lastSampleTs = now;

    const sample = this.createFrameSample(frame);
    if (!sample) {
      return;
    }

    if (this.motionState.previousSample) {
      const diff = this.calculateSampleDifference(this.motionState.previousSample, sample);
      const threshold = this.detectionConfig.motionThreshold;

      if (diff >= threshold) {
        if (!this.motionState.active) {
          this.motionState.active = true;
          this.motionState.activeStartSec = this.getElapsedSeconds();
        }
        this.motionState.lastMotionTs = now;
      } else if (this.motionState.active) {
        const endAfterMs = this.detectionConfig.motionEndAfterMs;
        if (now - this.motionState.lastMotionTs >= endAfterMs) {
          this.closeMotionEvent(this.getElapsedSeconds());
        }
      }
    }

    this.motionState.previousSample = sample;
  }

  processSoundDetections(ffmpegMessage) {
    if (!this.soundState || !this.shouldDetectSound(this.audioConfig?.enabled)) {
      return;
    }

    const lines = ffmpegMessage.split('\n');

    for (const line of lines) {
      const silenceStartMatch = line.match(/silence_start:\s*([0-9.]+)/);
      if (silenceStartMatch) {
        const silenceStart = Number(silenceStartMatch[1]);
        if (Number.isFinite(silenceStart) && this.soundState.active) {
          this.recordEvent('sound', this.soundState.activeStartSec ?? 0, silenceStart);
          this.soundState.active = false;
          this.soundState.activeStartSec = null;
        }
      }

      const silenceEndMatch = line.match(/silence_end:\s*([0-9.]+)/);
      if (silenceEndMatch) {
        const silenceEnd = Number(silenceEndMatch[1]);
        if (Number.isFinite(silenceEnd) && !this.soundState.active) {
          this.soundState.active = true;
          this.soundState.activeStartSec = silenceEnd;
        }
      }
    }
  }

  createFrameSample(frame) {
    if (!frame || frame.length < 128) {
      return null;
    }

    const targetPoints = 256;
    const step = Math.max(1, Math.floor(frame.length / targetPoints));
    const sampleLength = Math.min(targetPoints, Math.floor(frame.length / step));
    const sample = new Uint8Array(sampleLength);

    for (let i = 0; i < sampleLength; i++) {
      sample[i] = frame[i * step];
    }

    return sample;
  }

  calculateSampleDifference(previousSample, currentSample) {
    const length = Math.min(previousSample.length, currentSample.length);
    if (!length) {
      return 0;
    }

    let total = 0;
    for (let i = 0; i < length; i++) {
      total += Math.abs(previousSample[i] - currentSample[i]);
    }

    return total / (length * 255);
  }

  closeMotionEvent(endSec) {
    if (!this.motionState?.active) {
      return;
    }

    this.recordEvent('motion', this.motionState.activeStartSec ?? 0, endSec);
    this.motionState.active = false;
    this.motionState.activeStartSec = null;
  }

  recordEvent(type, startSec, endSec) {
    const start = Math.max(0, Number(startSec) || 0);
    const end = Math.max(start, Number(endSec) || start);

    if (end - start < 0.001) {
      return;
    }

    if (type === 'motion') {
      const minDurationSec = Math.max(0, (Number(this.detectionConfig.motionMinDurationMs) || 0) / 1000);
      if (end - start < minDurationSec) {
        return;
      }
    }

    this.segmentEvents.push({
      type,
      startSec: Number(start.toFixed(3)),
      endSec: Number(end.toFixed(3))
    });
  }

  getElapsedSeconds() {
    if (!this.segmentStartedAt) {
      return 0;
    }
    const elapsed = (Date.now() - this.segmentStartedAt) / 1000;
    const maxDuration = Number(this.config.segmentDuration) || elapsed;
    return Math.min(maxDuration, Math.max(0, elapsed));
  }

  finalizeOpenEvents() {
    const segmentEndSec = this.getElapsedSeconds();

    if (this.motionState?.active) {
      this.closeMotionEvent(segmentEndSec);
    }

    if (this.soundState?.active) {
      this.recordEvent('sound', this.soundState.activeStartSec ?? 0, segmentEndSec);
      this.soundState.active = false;
      this.soundState.activeStartSec = null;
    }

    return segmentEndSec;
  }

  persistSegmentMetadata(segmentFile) {
    const segmentEndSec = this.finalizeOpenEvents();
    const recordingName = path.basename(segmentFile);
    const metadataPath = `${segmentFile}.events.json`;
    const hasMotion = this.segmentEvents.some((event) => event.type === 'motion');
    const hasSound = this.segmentEvents.some((event) => event.type === 'sound');
    const eventTypes = [];
    if (hasMotion) eventTypes.push('motion');
    if (hasSound) eventTypes.push('sound');

    const metadata = {
      recording: recordingName,
      hasMotion,
      hasSound,
      eventTypes,
      durationSec: Number(segmentEndSec.toFixed(3)),
      events: this.segmentEvents,
      createdAt: new Date(this.segmentStartedAt || Date.now()).toISOString()
    };

    try {
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (err) {
      console.error(`Failed to write event metadata for ${recordingName}:`, err.message);
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
      outputDir: this.config.outputDir,
      eventDetection: {
        enabled: this.detectionConfig.enabled,
        motionEnabled: this.detectionConfig.motionEnabled,
        soundEnabled: this.detectionConfig.soundEnabled
      }
    };
  }

  updateConfig(newConfig, watermarkConfig = null, audioConfig = null) {
    const wasEnabled = this.config.enabled;
    const wasRecording = this.isRecording;

    // Check if watermark config changed
    const watermarkChanged = watermarkConfig !== null &&
      JSON.stringify(this.watermarkConfig) !== JSON.stringify({ ...this.watermarkConfig, ...watermarkConfig });

    // Check if audio config changed
    const audioChanged = audioConfig !== null &&
      JSON.stringify(this.audioConfig) !== JSON.stringify({ ...this.audioConfig, ...audioConfig });

    // Check if segment duration changed
    const segmentDurationChanged = newConfig.segmentDuration !== undefined &&
      newConfig.segmentDuration !== this.config.segmentDuration;
    const detectionChanged = newConfig.eventDetection !== undefined &&
      JSON.stringify(this.detectionConfig) !== JSON.stringify(this.normalizeDetectionConfig(newConfig.eventDetection));

    this.config = { ...this.config, ...newConfig };
    this.detectionConfig = this.normalizeDetectionConfig(this.config.eventDetection);

    if (watermarkConfig !== null) {
      this.watermarkConfig = { ...this.watermarkConfig, ...watermarkConfig };
    }

    if (audioConfig !== null) {
      this.audioConfig = { ...this.audioConfig, ...audioConfig };
    }

    if (wasEnabled && !this.config.enabled) {
      this.stop();
    } else if (!wasEnabled && this.config.enabled && this.camera) {
      this.start(this.camera);
    } else if (wasRecording && (watermarkChanged || segmentDurationChanged || audioChanged || detectionChanged)) {
      // Restart current segment to apply config changes
      console.log('Recording config changed, restarting segment...');
      this.stopCurrentSegment();
      setTimeout(() => this.startSegment(), 1000);
    }
  }

  updateAudioConfig(audioConfig) {
    this.audioConfig = { ...this.audioConfig, ...audioConfig };
  }

  updateCameraConfig(cameraConfig) {
    this.cameraConfig = { ...this.cameraConfig, ...cameraConfig };
  }
}

export default Recorder;
