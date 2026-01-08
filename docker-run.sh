#!/bin/bash

# Wrapper script for docker-compose commands

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "${1:-}" in
  build)
    echo "Building Docker image..."
    docker-compose build
    echo "Build complete!"
    ;;

  start)
    echo "Starting container..."
    docker-compose up -d
    echo "Container started! Access at http://localhost:8081"
    ;;

  stop)
    echo "Stopping container..."
    docker-compose down
    echo "Container stopped."
    ;;

  restart)
    echo "Restarting container..."
    docker-compose down
    docker-compose up -d
    echo "Container restarted!"
    ;;

  logs)
    docker-compose logs -f
    ;;

  status)
    docker-compose ps
    ;;

  rebuild)
    echo "Rebuilding and starting container..."
    docker-compose up -d --build
    echo "Container rebuilt and started!"
    ;;

  *)
    echo "Usage: $0 {build|start|stop|restart|logs|status|rebuild}"
    echo ""
    echo "Commands:"
    echo "  build    Build the Docker image"
    echo "  start    Start the container"
    echo "  stop     Stop the container"
    echo "  restart  Restart the container"
    echo "  logs     View container logs"
    echo "  status   Show container status"
    echo "  rebuild  Rebuild and start container"
    exit 1
    ;;
esac
