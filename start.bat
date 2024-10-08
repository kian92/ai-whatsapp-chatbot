@echo off
call npm install
call pip install -r requirements.txt
start cmd /k python dashboard.py
start cmd /k node index.js
start cmd /k npm run tunnel