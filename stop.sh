#!/bin/bash

# Send termination signal to the main process
if [ -f gunicorn.pid ]; then
    kill -SIGTERM $(cat gunicorn.pid)
    echo "Sent termination signal to the main process"
else
    echo "PID file not found. The application may not be running."
fi

# Wait for a moment to allow graceful shutdown
sleep 5

# Check if processes are still running and force kill if necessary
if [ -f gunicorn.pid ]; then
    echo "Forcing shutdown of Gunicorn..."
    kill -9 $(cat gunicorn.pid)
    rm gunicorn.pid
fi

if [ -f node.pid ]; then
    echo "Forcing shutdown of Node.js process..."
    kill -9 $(cat node.pid)
    rm node.pid
fi

echo "Application stopped"