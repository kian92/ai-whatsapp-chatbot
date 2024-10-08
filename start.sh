#!/bin/bash

# Install dependencies
npm install
pip install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Start the Flask application with Gunicorn
gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid