$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { "v22.11.0" }
$NodeFolderName = "node-$NodeVersion-win-x64"
$ToolsDir = Join-Path $Root "tools"
$NodeDir = Join-Path $ToolsDir $NodeFolderName
$NpmCmd = Join-Path $NodeDir "npm.cmd"
function Write-Title($text) { Write-Host ""; Write-Host "======================================" -ForegroundColor Cyan; Write-Host " $text" -ForegroundColor Cyan; Write-Host "======================================" -ForegroundColor Cyan }
function Find-SystemCommand($name) { $cmd = Get-Command $name -ErrorAction SilentlyContinue; if ($cmd) { return $cmd.Source }; return $null }
function Download-File($url, $outFile) { Write-Host "Downloading: $url"; Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing -TimeoutSec 240 }
function Ensure-Node {
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
  if (Test-Path $NpmCmd) { $env:Path = "$NodeDir;$env:Path"; return }
  $systemNode = Find-SystemCommand "node"; $systemNpm = Find-SystemCommand "npm"
  if ($systemNode -and $systemNpm) { return }
  Write-Host "Node.js not found. Downloading portable Node.js $NodeVersion..." -ForegroundColor Yellow
  $zipUrl = "https://nodejs.org/dist/$NodeVersion/$NodeFolderName.zip"
  $zipPath = Join-Path $env:TEMP "$NodeFolderName.zip"
  Download-File $zipUrl $zipPath
  if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
  Expand-Archive -Path $zipPath -DestinationPath $ToolsDir -Force
  Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
  $env:Path = "$NodeDir;$env:Path"
}
function Resolve-Npm { if (Test-Path $NpmCmd) { return $NpmCmd }; $cmd = Find-SystemCommand "npm"; if ($cmd) { return $cmd }; throw "npm is not available." }
Write-Title "OBS Live Helper EXE Builder"
try {
  Ensure-Node
  $npm = Resolve-Npm
  Write-Host "npm: $(& $npm --version)" -ForegroundColor Green
  Write-Title "Installing build dependencies"
  & $npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed. Cleaning cache and trying again..." -ForegroundColor Yellow; & $npm cache clean --force; & $npm install --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  Write-Title "Building Windows installer"
  & $npm run dist
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed." }
  Write-Title "Done"
  Write-Host "Installer output folder:" -ForegroundColor Green
  Write-Host (Join-Path $Root "dist") -ForegroundColor Cyan
  Get-ChildItem (Join-Path $Root "dist") -Filter "*.exe" | ForEach-Object { Write-Host $_.FullName -ForegroundColor Cyan }
  Start-Process (Join-Path $Root "dist")
} catch {
  Write-Host ""; Write-Host "ERROR:" -ForegroundColor Red; Write-Host $_.Exception.Message -ForegroundColor Red; exit 1
}
