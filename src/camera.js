import { spawn } from 'child_process';
import { EventEmitter } from 'events';

class Camera extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.process = null;
    this.clients = new Set();
    this.latestFrame = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      console.log('Camera already running');
      return;
    }

    const [width, height] = this.config.resolution.split('x');

    const args = [
      '-f', 'v4l2',
      '-input_format', 'mjpeg',
      '-framerate', String(this.config.framerate),
      '-video_size', this.config.resolution,
      '-i', this.config.device,
      '-f', 'mjpeg',
      '-q:v', '5',
      '-r', String(this.config.framerate),
      'pipe:1'
    ];

    console.log(`Starting camera: ffmpeg ${args.join(' ')}`);

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.isRunning = true;
    let buffer = Buffer.alloc(0);

    this.process.stdout.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      // JPEG images start with 0xFFD8 and end with 0xFFD9
      let start = 0;
      while (true) {
        const startMarker = buffer.indexOf(Buffer.from([0xFF, 0xD8]), start);
        if (startMarker === -1) break;

        const endMarker = buffer.indexOf(Buffer.from([0xFF, 0xD9]), startMarker + 2);
        if (endMarker === -1) break;

        // Extract complete JPEG frame
        const frame = buffer.slice(startMarker, endMarker + 2);
        this.latestFrame = frame;
        this.emit('frame', frame);
        this.broadcast(frame);

        start = endMarker + 2;
      }

      // Keep remaining data in buffer
      if (start > 0) {
        buffer = buffer.slice(start);
      }

      // Prevent buffer from growing too large
      if (buffer.length > 5 * 1024 * 1024) {
        buffer = Buffer.alloc(0);
      }
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('frame=') && !msg.includes('fps=')) {
        console.log('FFmpeg:', msg.trim());
      }
    });

    this.process.on('close', (code) => {
      console.log(`Camera process exited with code ${code}`);
      this.isRunning = false;
      this.emit('stopped', code);

      // Auto-restart on unexpected exit
      if (code !== 0 && code !== null) {
        console.log('Restarting camera in 5 seconds...');
        setTimeout(() => this.start(), 5000);
      }
    });

    this.process.on('error', (err) => {
      console.error('Camera process error:', err);
      this.isRunning = false;
    });

    this.emit('started');
  }

  stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this.isRunning = false;
    }
  }

  broadcast(frame) {
    const boundary = 'frame';
    const header = `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;

    for (const client of this.clients) {
      try {
        client.write(header);
        client.write(frame);
        client.write('\r\n');
      } catch (err) {
        this.clients.delete(client);
      }
    }
  }

  addClient(res) {
    this.clients.add(res);
    console.log(`Client connected. Total clients: ${this.clients.size}`);

    res.on('close', () => {
      this.clients.delete(res);
      console.log(`Client disconnected. Total clients: ${this.clients.size}`);
    });
  }

  getSnapshot() {
    return this.latestFrame;
  }

  getStatus() {
    return {
      running: this.isRunning,
      clients: this.clients.size,
      device: this.config.device,
      resolution: this.config.resolution,
      framerate: this.config.framerate
    };
  }
}

export default Camera;
