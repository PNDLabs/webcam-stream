#!/bin/bash

# Build and run webcam-stream container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="webcam-stream"
CONTAINER_NAME="webcam-stream"

# Parse arguments
case "${1:-}" in
  build)
    echo "Building Docker image..."
    docker build -t "$IMAGE_NAME" .
    echo "Build complete!"
    ;;

  start)
    echo "Starting container..."
    docker run -d \
      --name "$CONTAINER_NAME" \
      --restart unless-stopped \
      -p 8081:8081 \
      --device /dev/video2:/dev/video2 \
      -v "$SCRIPT_DIR/recordings:/app/recordings" \
      -v "$SCRIPT_DIR/config.json:/app/config.json:ro" \
      "$IMAGE_NAME"
    echo "Container started! Access at http://localhost:8081"
    ;;

  stop)
    echo "Stopping container..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
    echo "Container stopped."
    ;;

  restart)
    $0 stop
    $0 start
    ;;

  logs)
    docker logs -f "$CONTAINER_NAME"
    ;;

  status)
    docker ps -a --filter "name=$CONTAINER_NAME"
    ;;

  compose-up)
    echo "Starting with docker-compose..."
    docker compose up -d --build
    echo "Container started! Access at http://localhost:8081"
    ;;

  compose-down)
    echo "Stopping with docker-compose..."
    docker compose down
    ;;

  *)
    echo "Usage: $0 {build|start|stop|restart|logs|status|compose-up|compose-down}"
    echo ""
    echo "Commands:"
    echo "  build        Build the Docker image"
    echo "  start        Start the container"
    echo "  stop         Stop and remove the container"
    echo "  restart      Restart the container"
    echo "  logs         View container logs"
    echo "  status       Show container status"
    echo "  compose-up   Start using docker-compose"
    echo "  compose-down Stop using docker-compose"
    exit 1
    ;;
esac
