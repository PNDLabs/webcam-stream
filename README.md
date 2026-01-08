# Webcam Stream

A USB webcam streaming and security camera application with loop recording capabilities. Stream live video via MJPEG, record continuously with hourly segments, and manage storage with automatic cleanup.

## Features

- **Live MJPEG Streaming** - Stream camera feed to multiple clients simultaneously
- **Snapshot Capture** - Capture and download individual frames on demand
- **Continuous Recording** - Automatic hourly video segmentation (H.264/MP4)
- **Loop Recording** - Automatic cleanup of recordings older than configured retention period
- **Storage Management** - Real-time monitoring and manual cleanup options
- **Web Dashboard** - User-friendly interface for viewing, controlling, and managing recordings
- **Runtime Configuration** - Update settings without restarting the application
- **Docker Support** - Easy deployment with Docker and Docker Compose
- **Home Assistant Integration** - Works as a generic camera platform
- **Multi-Client Support** - Multiple simultaneous viewers with client tracking
- **Auto-Recovery** - Automatic restart on camera process failures

## Prerequisites

- **Node.js** 20.x or higher
- **FFmpeg** installed on system
- **USB Webcam** (default: `/dev/video2`)
- **Linux** system with Video4Linux2 support

## Installation

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/yourusername/webcam-stream.git
cd webcam-stream

# Build and start with the helper script
./docker-run.sh build
./docker-run.sh start

# Or use docker-compose
./docker-run.sh compose-up
```

### Option 2: Native Node.js

```bash
# Clone the repository
git clone https://github.com/yourusername/webcam-stream.git
cd webcam-stream

# Install dependencies
npm install

# Start the application
npm start

# Or run in development mode with auto-reload
npm run dev
```

## Configuration

Configuration is stored in `config.json` and can be modified at runtime via the web dashboard.

```json
{
  "camera": {
    "device": "/dev/video2",
    "resolution": "1280x720",
    "framerate": 15
  },
  "recording": {
    "enabled": true,
    "segmentDuration": 3600,
    "retentionDays": 7,
    "outputDir": "./recordings"
  },
  "server": {
    "port": 8081
  }
}
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `camera.device` | USB camera device path | `/dev/video2` |
| `camera.resolution` | Video resolution | `1280x720` |
| `camera.framerate` | Frames per second | `15` |
| `recording.enabled` | Enable/disable recording | `true` |
| `recording.segmentDuration` | Segment duration in seconds | `3600` (1 hour) |
| `recording.retentionDays` | Days to keep recordings | `7` |
| `recording.outputDir` | Recording storage path | `./recordings` |
| `server.port` | HTTP server port | `8081` |

## Usage

Once running, access the application at:

- **Web Dashboard**: `http://localhost:8081/`
- **Live Stream**: `http://localhost:8081/stream`
- **Snapshot**: `http://localhost:8081/snapshot`

### Web Dashboard Features

- View live camera stream
- Toggle recording on/off
- Capture snapshots
- Browse and playback recordings
- Download or delete recordings
- Configure retention settings
- View storage statistics

## API Reference

### Streaming Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stream` | GET | MJPEG video stream |
| `/snapshot` | GET | Single JPEG frame |

### Status & Information

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Camera, recorder, and storage status |
| `/api/config` | GET | Current configuration |
| `/api/recordings` | GET | List all recordings with metadata |

### Management Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | POST | Update configuration |
| `/api/recording/toggle` | POST | Toggle recording on/off |
| `/api/cleanup` | POST | Manually trigger cleanup |
| `/recordings/:filename` | GET | Download specific recording |
| `/api/recordings/:filename` | DELETE | Delete specific recording |

### Example API Usage

```bash
# Get current status
curl http://localhost:8081/api/status

# Toggle recording
curl -X POST http://localhost:8081/api/recording/toggle

# Update retention days
curl -X POST http://localhost:8081/api/config \
  -H "Content-Type: application/json" \
  -d '{"retentionDays": 14}'

# Trigger manual cleanup
curl -X POST http://localhost:8081/api/cleanup
```

## Docker Commands

The `docker-run.sh` script provides convenient commands:

```bash
./docker-run.sh build         # Build Docker image
./docker-run.sh start         # Start container
./docker-run.sh stop          # Stop container
./docker-run.sh restart       # Restart container
./docker-run.sh logs          # View container logs
./docker-run.sh status        # Check container status
./docker-run.sh compose-up    # Start with docker-compose
./docker-run.sh compose-down  # Stop with docker-compose
```

### Manual Docker Commands

```bash
# Build image
docker build -t webcam-stream .

# Run container
docker run -d \
  --name webcam-stream \
  -p 8081:8081 \
  --device /dev/video2:/dev/video2 \
  -v $(pwd)/recordings:/app/recordings \
  -v $(pwd)/config.json:/app/config.json:ro \
  webcam-stream
```

## Home Assistant Integration

Add the following to your Home Assistant `configuration.yaml`:

```yaml
camera:
  - platform: generic
    name: "Security Camera"
    still_image_url: "http://<IP>:8081/snapshot"
    stream_source: "http://<IP>:8081/stream"
```

Replace `<IP>` with the IP address of the machine running webcam-stream.

## Project Structure

```
webcam-stream/
├── src/
│   ├── index.js          # Application entry point
│   ├── server.js         # Express server and API routes
│   ├── camera.js         # Camera control & MJPEG streaming
│   ├── recorder.js       # Video recording with FFmpeg
│   └── cleanup.js        # Storage cleanup scheduler
├── public/
│   ├── index.html        # Web dashboard HTML
│   ├── app.js            # Client-side JavaScript
│   └── style.css         # Dashboard styling
├── config.json           # Configuration file
├── package.json          # Node.js dependencies
├── Dockerfile            # Container image definition
├── docker-compose.yml    # Docker Compose configuration
├── docker-run.sh         # Docker helper script
└── recordings/           # Video recording storage
```

## Technical Details

- **Backend**: Node.js with Express.js
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Video Capture**: FFmpeg with v4l2 input
- **Video Encoding**: H.264 with ultrafast preset
- **Streaming Protocol**: MJPEG (multipart/x-mixed-replace)
- **Container Format**: MP4 for recordings
- **Scheduling**: node-cron for cleanup tasks

## Troubleshooting

### Camera not detected

1. Check if the camera device exists: `ls -la /dev/video*`
2. Verify permissions: `sudo usermod -aG video $USER`
3. Update `config.json` with the correct device path

### Permission denied on recordings directory

```bash
mkdir -p recordings
chmod 755 recordings
```

### FFmpeg errors

Ensure FFmpeg is installed with required codecs:

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Check installation
ffmpeg -version
```

### Docker: Device not accessible

When running in Docker, ensure the device is mapped correctly:

```bash
docker run --device /dev/video2:/dev/video2 ...
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.