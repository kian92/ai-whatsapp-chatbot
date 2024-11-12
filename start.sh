#!/bin/bash

# Update system and install basic requirements
sudo yum update -y
sudo yum install git -y
sudo yum install -y nodejs
sudo yum install -y python3
sudo yum install -y python3-pip

# Install system dependencies
sudo yum install -y \
    atk \
    atk-devel \
    at-spi2-atk \
    cups-libs \
    dbus-glib \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango \
    pango-devel \
    alsa-lib \
    xorg-x11-fonts-Type1 \
    xorg-x11-utils \
    libxkbcommon \
    libdrm \
    gtk3 \
    libgbm

# Install dependencies
npm install
pip install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Start the Flask application with Gunicorn
gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid