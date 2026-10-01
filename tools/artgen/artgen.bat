@echo off
rem Run any artgen script inside the isolated venv, e.g.:  tools\artgen\artgen.bat generate.py --set mushrooms
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
