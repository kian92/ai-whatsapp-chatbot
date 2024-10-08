from flask import Flask, render_template, request, redirect, url_for, session
from functools import wraps
import json
import os
import logging

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

if __name__ == '__main__':
    app.logger.info("Starting the Flask application...")
    app.run(debug=True, host='0.0.0.0', port=8080)