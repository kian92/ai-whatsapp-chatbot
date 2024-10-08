#!/bin/bash

# Function to check if a command was successful
check_command() {
    if [ $? -ne 0 ]; then
        echo "Error: $1 failed"
        exit 1
    fi
}

# Install dependencies
npm install
check_command "npm install"

python3 -m pip install -r requirements.txt
check_command "pip install"

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Start the Flask application with Gunicorn
python3 -m gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid &
check_command "Starting Gunicorn"

# Start the Node.js bot
node index.js & echo $! > node.pid
check_command "Starting Node.js bot"

# Function to handle termination
terminate() {
    echo "Shutting down gracefully..."
    if [ -f gunicorn.pid ]; then
        kill $(cat gunicorn.pid)
        rm gunicorn.pid
    fi
    if [ -f node.pid ]; then
        kill $(cat node.pid)
        rm node.pid
    fi
    exit 0
}

# Set up trap to catch termination signal
trap terminate SIGTERM

# Wait for any process to exit
wait -n

# If we get here, one of the processes has exited unexpectedly
echo "A process has exited unexpectedly. Shutting down..."
terminate