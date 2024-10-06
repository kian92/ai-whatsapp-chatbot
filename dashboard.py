from flask import Flask, render_template, request, redirect, url_for
import json
import os
import logging

app = Flask(__name__)
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

@app.route('/')
def index():
    subjects = load_subjects()
    app.logger.info(f"Loaded subjects: {subjects}")
    return render_template('index.html', subjects=subjects)

@app.route('/add_subject', methods=['POST'])
def add_subject():
    subjects = load_subjects()
    category = request.form['category']
    key = request.form['key']
    subjects[category] = key
    save_subjects(subjects)
    app.logger.info(f"Added subject: {category}")
    return redirect(url_for('index'))

@app.route('/remove_subject/<category>')
def remove_subject(category):
    subjects = load_subjects()
    if category in subjects:
        del subjects[category]
        save_subjects(subjects)
        app.logger.info(f"Removed subject: {category}")
    return redirect(url_for('index'))

if __name__ == '__main__':
    app.logger.info("Starting the Flask application...")
    app.run(debug=True, host='127.0.0.1', port=8080)