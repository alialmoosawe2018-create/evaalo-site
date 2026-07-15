# Script to copy LiveKit environment variables from Backend to Agent

Write-Host "🔍 Checking for LiveKit credentials..." -ForegroundColor Cyan

# Paths
$backendEnv = "..\backend\.env.local"
$agentEnv = ".env.local"

# Check if Backend .env.local exists
if (-not (Test-Path $backendEnv)) {
    Write-Host "❌ Backend .env.local not found at: $backendEnv" -ForegroundColor Red
    Write-Host "   Please make sure Backend .env.local exists first." -ForegroundColor Yellow
    exit 1
}

# Check if Agent .env.local exists
if (-not (Test-Path $agentEnv)) {
    Write-Host "⚠️ Agent .env.local not found. Creating new file..." -ForegroundColor Yellow
    New-Item -Path $agentEnv -ItemType File -Force | Out-Null
}

Write-Host "📋 Reading LiveKit variables from Backend..." -ForegroundColor Cyan

# Read LiveKit variables from Backend
$livekitVars = @{}
$backendContent = Get-Content $backendEnv

foreach ($line in $backendContent) {
    # Skip comments and empty lines
    if ($line -match '^\s*#' -or $line -match '^\s*$') {
        continue
    }
    
    # Match LIVEKIT variables
    if ($line -match '^\s*LIVEKIT_(URL|API_KEY|API_SECRET)\s*=\s*(.+)$') {
        $key = $matches[1]
        $value = $matches[2].Trim('"').Trim("'")
        $livekitVars["LIVEKIT_$key"] = $value
        Write-Host "   ✅ Found: LIVEKIT_$key" -ForegroundColor Green
    }
}

# Check if we found all required variables
$required = @("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
$missing = @()

foreach ($var in $required) {
    if (-not $livekitVars.ContainsKey($var)) {
        $missing += $var
    }
}

if ($missing.Count -gt 0) {
    Write-Host "❌ Missing required variables in Backend .env.local:" -ForegroundColor Red
    foreach ($var in $missing) {
        Write-Host "   - $var" -ForegroundColor Yellow
    }
    exit 1
}

Write-Host ""
Write-Host "📝 Updating Agent .env.local..." -ForegroundColor Cyan

# Read current Agent .env.local
$agentContent = @()
if (Test-Path $agentEnv) {
    $agentContent = Get-Content $agentEnv
}

# Remove existing LIVEKIT variables
$newContent = @()
$inLivekitSection = $false

foreach ($line in $agentContent) {
    if ($line -match '^\s*#.*LiveKit') {
        $inLivekitSection = $true
        $newContent += $line
    }
    elseif ($inLivekitSection -and ($line -match '^\s*LIVEKIT_' -or $line -match '^\s*$')) {
        # Skip existing LIVEKIT variables and empty lines in section
        if ($line -match '^\s*$' -and $newContent[-1] -match '^\s*$') {
            continue  # Skip consecutive empty lines
        }
        continue
    }
    elseif ($inLivekitSection -and $line -match '^\s*#') {
        $inLivekitSection = $false
        $newContent += $line
    }
    elseif (-not $inLivekitSection) {
        $newContent += $line
    }
}

# Add LiveKit section
if (-not ($newContent -match 'LiveKit')) {
    $newContent += ""
    $newContent += "# ============================================"
    $newContent += "# LiveKit Configuration"
    $newContent += "# ============================================"
}

$newContent += "LIVEKIT_URL=$($livekitVars['LIVEKIT_URL'])"
$newContent += "LIVEKIT_API_KEY=$($livekitVars['LIVEKIT_API_KEY'])"
$newContent += "LIVEKIT_API_SECRET=$($livekitVars['LIVEKIT_API_SECRET'])"
$newContent += ""

# Write to file
$newContent | Set-Content $agentEnv

Write-Host "✅ Successfully updated Agent .env.local with LiveKit credentials!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Added variables:" -ForegroundColor Cyan
Write-Host "   - LIVEKIT_URL=$($livekitVars['LIVEKIT_URL'])" -ForegroundColor Gray
Write-Host "   - LIVEKIT_API_KEY=$($livekitVars['LIVEKIT_API_KEY'])" -ForegroundColor Gray
Write-Host "   - LIVEKIT_API_SECRET=***" -ForegroundColor Gray
Write-Host ""
Write-Host "🚀 You can now run the Agent:" -ForegroundColor Green
Write-Host "   .\START_AGENT.ps1" -ForegroundColor Yellow
