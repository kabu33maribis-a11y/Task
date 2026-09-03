@echo off
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
python -X utf8 "%~dp0audit.py"
