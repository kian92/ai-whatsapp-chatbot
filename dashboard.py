from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file
from functools import wraps
import json
import os
import logging
import subprocess
import signal
import shutil
import time

app = Flask(__name__)
app.secret_key = 'your_secret_key_here'  # Replace with a strong secret key
logging.basicConfig(level=logging.DEBUG)

# Update the SUBJECTS_FILE path
SUBJECTS_FILE = os.path.join(os.path.dirname(__file__), 'subjects.json')

def load_subjects():
    if os.path.exists(SUBJECTS_FILE):
        with open(SUBJECTS_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_subjects(subjects):
    with open(SUBJECTS_FILE, 'w') as f:
        json.dump(subjects, f)

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if username == 'Study' and password == 'study-kb':
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='Invalid credentials')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    subjects = load_subjects()
    app.logger.info(f"Loaded subjects: {subjects}")
    return render_template('index.html', subjects=subjects)

@app.route('/add_subject', methods=['POST'])
@login_required
def add_subject():
    subjects = load_subjects()
    category = request.form['category']
    key = request.form['key']
    subjects[category] = key
    save_subjects(subjects)
    app.logger.info(f"Added subject: {category}")
    return redirect(url_for('index'))

@app.route('/remove_subject/<category>')
@login_required
def remove_subject(category):
    subjects = load_subjects()
    if category in subjects:
        del subjects[category]
        save_subjects(subjects)
        app.logger.info(f"Removed subject: {category}")
    return redirect(url_for('index'))

# Global variable to store the bot process
bot_process = None

# Add a new global variable to track the bot's connection status
bot_connected = False

@app.route('/start_bot')
@login_required
def start_bot():
    global bot_process, bot_connected
    if bot_process is None or bot_process.poll() is not None:
        bot_process = subprocess.Popen(['node', 'index.js'])
        bot_connected = False
        return jsonify({"message": "Bot started successfully", "connected": False})
    else:
        return jsonify({"message": "Bot is already running", "connected": bot_connected})

@app.route('/stop_bot')
@login_required
def stop_bot():
    global bot_process, bot_connected
    if bot_process is not None and bot_process.poll() is None:
        os.kill(bot_process.pid, signal.SIGTERM)
        bot_process.wait()
        bot_process = None
        bot_connected = False
        return jsonify({"message": "Bot stopped successfully", "connected": False})
    else:
        return jsonify({"message": "Bot is not running", "connected": False})

@app.route('/remove_cache')
@login_required
def remove_cache():
    global bot_process, bot_connected
    cache_dir = '.wwebjs_auth'
    if os.path.exists(cache_dir):
        shutil.rmtree(cache_dir)
        if bot_process is not None and bot_process.poll() is None:
            os.kill(bot_process.pid, signal.SIGTERM)
            bot_process.wait()
        bot_process = subprocess.Popen(['node', 'index.js'])
        bot_connected = False
        return jsonify({"message": "Cache removed and bot restarted successfully", "connected": False})
    return jsonify({"message": "Cache directory not found", "connected": bot_connected})

@app.route('/get_qr_code')
@login_required
def get_qr_code():
    qr_code_file = 'qr_code.png'
    if os.path.exists(qr_code_file):
        return send_file(qr_code_file, mimetype='image/png')
    return jsonify({"message": "QR code not available"})

@app.route('/bot_status')
@login_required
def bot_status():
    global bot_connected
    return jsonify({"connected": bot_connected})

# Add this new route
@app.route('/is_bot_ready')
@login_required
def is_bot_ready():
    global bot_connected
    return jsonify({"ready": bot_connected})

# Add this new route to check if the QR code file exists
@app.route('/qr_code_exists')
@login_required
def qr_code_exists():
    return jsonify({"exists": os.path.exists('qr_code.png')})

# Modify the set_bot_connected route
@app.route('/set_bot_connected', methods=['POST'])
def set_bot_connected():
    global bot_connected
    bot_connected = True
    # Remove the QR code file if it exists
    if os.path.exists('qr_code.png'):
        os.remove('qr_code.png')
    return jsonify({"message": "Bot connection status updated", "ready": True})

@app.route('/reset_bot')
@login_required
def reset_bot():
    global bot_process, bot_connected
    
    # Stop the bot if it's running
    if bot_process is not None and bot_process.poll() is None:
        os.kill(bot_process.pid, signal.SIGTERM)
        bot_process.wait()
        bot_process = None
    
    # Clear the cache
    cache_dir = '.wwebjs_auth'
    if os.path.exists(cache_dir):
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                shutil.rmtree(cache_dir)
                break
            except PermissionError:
                if attempt < max_attempts - 1:
                    time.sleep(1)  # Wait for 1 second before retrying
                else:
                    return jsonify({"message": "Failed to remove cache. Please try again.", "connected": False})
    
    # Remove the QR code file if it exists
    if os.path.exists('qr_code.png'):
        try:
            os.remove('qr_code.png')
        except PermissionError:
            pass  # Ignore if we can't delete the QR code file
    
    # Restart the bot
    bot_process = subprocess.Popen(['node', 'index.js'])
    bot_connected = False
    
    return jsonify({"message": "Bot reset successfully. Please scan the new QR code.", "connected": False})

if __name__ == '__main__':
    app.logger.info("Starting the Flask application...")
    app.run(debug=True, host='0.0.0.0', port=8080)
