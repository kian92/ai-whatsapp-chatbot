#!/bin/bash

# Install dependencies
npm install
pip install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Start the Flask application with Gunicorn
gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid &

# Start the Node.js bot
node index.js & echo $! > node.pid

# Function to handle termination
terminate() {
    echo "Shutting down gracefully..."
    kill $(cat gunicorn.pid)
    kill $(cat node.pid)
    rm -f gunicorn.pid node.pid
    exit 0
}

# Set up trap to catch termination signal
trap terminate SIGTERM

# Wait for any process to exit
wait -n

# If we get here, one of the processes has exited unexpectedly
echo "A process has exited unexpectedly. Shutting down..."
terminate