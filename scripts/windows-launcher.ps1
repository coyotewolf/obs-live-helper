$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { "v22.11.0" }
$NodeFolderName = "node-$NodeVersion-win-x64"
$ToolsDir = Join-Path $Root "tools"
$NodeDir = Join-Path $ToolsDir $NodeFolderName
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCmd = Join-Path $NodeDir "npm.cmd"
$EnvPath = Join-Path $Root ".env"
$EnvExamplePath = Join-Path $Root ".env.example"

function Write-Title($text) {
  Write-Host ""
  Write-Host "======================================" -ForegroundColor Cyan
  Write-Host " $text" -ForegroundColor Cyan
  Write-Host "======================================" -ForegroundColor Cyan
}

function Write-Step($text) {
  Write-Host ""
  Write-Host "> $text" -ForegroundColor Green
}

function Find-SystemCommand($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Download-File($url, $outFile) {
  Write-Host "Downloading:" $url
  try {
    Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing -TimeoutSec 180
  } catch {
    throw "Download failed: $url`n$($_.Exception.Message)"
  }
}

function Ensure-PortableNode {
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

  if ((Test-Path $NodeExe) -and (Test-Path $NpmCmd)) {
    Write-Host "Using bundled portable Node.js: $NodeExe" -ForegroundColor Green
    $env:Path = "$NodeDir;$env:Path"
    return
  }

  $systemNode = Find-SystemCommand "node"
  $systemNpm = Find-SystemCommand "npm"
  if ($systemNode -and $systemNpm) {
    Write-Host "Using system Node.js: $systemNode" -ForegroundColor Green
    return
  }

  Write-Host "Node.js was not found. Downloading portable Node.js $NodeVersion..." -ForegroundColor Yellow
  $zipUrl = "https://nodejs.org/dist/$NodeVersion/$NodeFolderName.zip"
  $zipPath = Join-Path $env:TEMP "$NodeFolderName.zip"
  Download-File $zipUrl $zipPath

  if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
  Expand-Archive -Path $zipPath -DestinationPath $ToolsDir -Force
  Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

  if (!(Test-Path $NodeExe) -or !(Test-Path $NpmCmd)) {
    throw "Portable Node.js extraction failed. Please install Node.js LTS manually from https://nodejs.org/"
  }

  $env:Path = "$NodeDir;$env:Path"
  Write-Host "Portable Node.js ready: $NodeExe" -ForegroundColor Green
}

function Resolve-NodeExe {
  if (Test-Path $NodeExe) { return $NodeExe }
  $cmd = Find-SystemCommand "node"
  if ($cmd) { return $cmd }
  throw "Node.js is still not available."
}

function Resolve-NpmCmd {
  if (Test-Path $NpmCmd) { return $NpmCmd }
  $cmd = Find-SystemCommand "npm"
  if ($cmd) { return $cmd }
  throw "npm is still not available."
}

function Ensure-EnvFile {
  if (!(Test-Path $EnvPath)) {
    if (Test-Path $EnvExamplePath) {
      Copy-Item $EnvExamplePath $EnvPath -Force
    } else {
      Set-Content -Path $EnvPath -Value "PORT=5172`nCLIENT_ID=your_spotify_client_id`nREDIRECT_URI=http://127.0.0.1:5172/api/spotify/callback`n" -Encoding UTF8
    }
    Write-Host "Created .env" -ForegroundColor Green
  }
}

function Get-EnvValue($key) {
  if (!(Test-Path $EnvPath)) { return "" }
  $line = Get-Content $EnvPath | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if (!$line) { return "" }
  return ($line -replace "^\s*$key\s*=\s*", "").Trim().Trim('"')
}

function Get-ServerPort {
  $port = Get-EnvValue "PORT"
  if ($port -match "^\d+$") { return [int]$port }
  return 5172
}

function Test-PortInUse($port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(300, $false)
    if ($connected) {
      $client.EndConnect($async)
      return $true
    }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Open-Dashboard($port) {
  Start-Process "http://127.0.0.1:$port/html/dashboard.html"
}

function Ensure-SpotifyClientId {
  Ensure-EnvFile
  $clientId = Get-EnvValue "CLIENT_ID"
  if ($clientId -and $clientId -ne "your_spotify_client_id") {
    Write-Host "Spotify CLIENT_ID is set." -ForegroundColor Green
    return
  }

  Write-Host ""
  Write-Host "Spotify CLIENT_ID is not set yet." -ForegroundColor Yellow
  Write-Host "You need your own Spotify Developer App for security and portability."
  Write-Host "Redirect URI to add in Spotify Developer Dashboard:"
  Write-Host "  http://127.0.0.1:5172/api/spotify/callback" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "The launcher will open Spotify Developer Dashboard and .env now."
  Write-Host "Paste your CLIENT_ID into .env, save, then come back here and press Enter."
  Start-Process "https://developer.spotify.com/dashboard"
  Start-Process notepad.exe $EnvPath
  Read-Host "Press Enter after saving .env"

  $clientId = Get-EnvValue "CLIENT_ID"
  if (!$clientId -or $clientId -eq "your_spotify_client_id") {
    Write-Host "CLIENT_ID is still empty. The helper can start, but Spotify login will not work yet." -ForegroundColor Yellow
    Write-Host "You can edit .env later and run this file again."
    Read-Host "Press Enter to continue anyway"
  } else {
    Write-Host "Spotify CLIENT_ID saved." -ForegroundColor Green
  }
}

function Install-Dependencies($npm) {
  Write-Step "Installing npm dependencies"
  & $npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install failed. Cleaning npm cache and trying again..." -ForegroundColor Yellow
    & $npm cache clean --force
    & $npm install --no-audit --no-fund
  }
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed. Check your internet connection or npm error messages."
  }
}

function Run-Setup($node) {
  Write-Step "Preparing local security files and cloudflared"
  & $node (Join-Path $Root "scripts\setup.js")
  if ($LASTEXITCODE -ne 0) {
    throw "setup.js failed."
  }
}

function Open-Dashboard-Later($port) {
  Start-Process powershell -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-Command",
    "Start-Sleep -Seconds 4; Start-Process 'http://127.0.0.1:$port/html/dashboard.html'"
  ) | Out-Null
}

Write-Title "OBS Live Helper setup"

try {
  Write-Step "Checking / preparing Node.js"
  Ensure-PortableNode
  $node = Resolve-NodeExe
  $npm = Resolve-NpmCmd
  Write-Host "Node:" (& $node --version)
  Write-Host "npm :" (& $npm --version)

  Ensure-SpotifyClientId
  Install-Dependencies $npm
  Run-Setup $node

  $port = Get-ServerPort
  $dashboardUrl = "http://127.0.0.1:$port/html/dashboard.html"

  Write-Title "Starting OBS Live Helper"

  if (Test-PortInUse $port) {
    Write-Host "Port $port is already in use." -ForegroundColor Yellow
    Write-Host "OBS Live Helper may already be running in another window." -ForegroundColor Yellow
    Write-Host "Opening existing Dashboard: $dashboardUrl" -ForegroundColor Cyan
    Open-Dashboard $port
    Write-Host ""
    Write-Host "If this is not OBS Live Helper, close the program using port $port or change PORT in .env." -ForegroundColor Yellow
    return
  }

  Write-Host "Dashboard will open automatically: $dashboardUrl" -ForegroundColor Cyan
  Write-Host "Keep this window open while using OBS Live Helper." -ForegroundColor Yellow
  Open-Dashboard-Later $port
  & $node (Join-Path $Root "server.js")
} catch {
  Write-Host ""
  Write-Host "ERROR:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Write-Host "Common fixes:" -ForegroundColor Yellow
  Write-Host "1. Make sure the internet is connected."
  Write-Host "2. If antivirus blocks tools\node or tools\cloudflared.exe, allow this folder."
  Write-Host "3. You can install Node.js LTS manually from https://nodejs.org/ and run again."
  Write-Host "4. If port 5172 is occupied, close the old OBS Live Helper window or run: netstat -ano | findstr :5172"
  exit 1
}
