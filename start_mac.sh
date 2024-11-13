#!/bin/bash

# Check if Homebrew is installed, install if not
if ! command -v brew &> /dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Update and install basic requirements
brew update
brew install git
brew install node
brew install python3

# Install system dependencies
brew install \
    atk \
    pango \
    gtk+3 \
    libdrm \
    alsa-lib \
    cups

# Install Python packages and Node modules
npm install
pip3 install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Start the Flask application with Gunicorn
gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid 