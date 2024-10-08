#!/bin/bash

# Install dependencies
npm install
pip install -r requirements.txt

# Set environment variables (you may want to use a .env file or AWS parameter store for sensitive data)
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Start the Flask application with Gunicorn
gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid &

# Start the Node.js bot
node index.js & echo $! > node.pid

# Note: We're not starting the tunnel in production

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?