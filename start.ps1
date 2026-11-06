# One-command launcher for NetGuardia (Backend + Frontend)
$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting NetGuardia FastAPI Backend & Unified Web Application on http://localhost:8000 ..." -ForegroundColor Cyan
Set-Location (Join-Path $RootDir "backend")
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
