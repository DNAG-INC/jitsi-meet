# Build the AAuti jitsi-meet fork inside a Linux Docker container.
# Output: libs/, css/, static HTML files in this directory.
#
# First run: ~15-25 minutes (image build + npm install + make)
# Subsequent runs: ~5-10 minutes (image and node_modules volume cached)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "==> Building docker image jitsi-meet-builder" -ForegroundColor Cyan
docker build -f Dockerfile.build -t jitsi-meet-builder .
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

Write-Host "==> Running npm install + make inside container" -ForegroundColor Cyan
docker run --rm `
    -v "${here}:/app" `
    -v "jitsi-meet-node-modules:/app/node_modules" `
    -w /app `
    jitsi-meet-builder `
    bash -c "npm install --no-audit --no-fund && make"

if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host "==> Build complete. Artifacts:" -ForegroundColor Green
Get-ChildItem libs, css -ErrorAction SilentlyContinue | Select-Object FullName, Length
