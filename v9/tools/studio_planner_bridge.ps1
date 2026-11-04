# Manu Stream Radio V9 - temporary Windows Studio planner bridge.
# Run only with an active SSH tunnel to 127.0.0.1:17600.
# Reads Studio V5 config; never edits it. No service is installed.
param(
    [ValidateSet("Check", "Watch")][string]$Mode = "Check",
    [int]$IntervalSeconds = 5
)

$ErrorActionPreference = "Stop"
if ($IntervalSeconds -lt 2) { throw "IntervalSeconds must be at least 2." }
$studioFile = Join-Path $env:LOCALAPPDATA "MonStudioRadio\V5\config.json"
$api = "http://127.0.0.1:17600/api/admin/studio-planner"

function Read-StudioPlanner {
    if (-not (Test-Path -LiteralPath $studioFile -PathType Leaf)) {
        throw "Studio configuration not found: $studioFile"
    }
    $config = Get-Content -LiteralPath $studioFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $config.plannerRules -or $config.plannerOn -isnot [bool]) {
        throw "Studio planner structure missing or invalid."
    }
    $rules = @($config.plannerRules)
    if ($rules.Count -gt 256) { throw "Unexpectedly large Studio planner." }
    return [ordered]@{
        plannerOn = [bool]$config.plannerOn
        plannerRules = $rules
    }
}

function Planner-Json($planner) {
    return (ConvertTo-Json -InputObject $planner -Depth 50 -Compress)
}

Write-Host "Manu Stream Radio - Studio/Ubuntu planner bridge ($Mode)"
Write-Host "Studio source: $studioFile"
Write-Host "The bridge never edits the Studio config or production V8."
Write-Host "SSH tunnel must already be running to 127.0.0.1:17600."
$secureToken = Read-Host "Jeton administrateur V9 (non affiche et non enregistre)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
if ([string]::IsNullOrWhiteSpace($token)) { throw "Missing V9 token." }
$headers = @{ Authorization = "Bearer $token" }
$token = $null

function Get-ServerPlanner {
    return Invoke-RestMethod -Method Get -Uri $api -Headers $headers -TimeoutSec 10
}
function Put-ServerPlanner($planner, [int]$expectedRevision) {
    $body = [ordered]@{
        plannerOn = $planner.plannerOn
        plannerRules = $planner.plannerRules
        expected_revision = $expectedRevision
    } | ConvertTo-Json -Depth 50 -Compress
    return Invoke-RestMethod -Method Put -Uri $api -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType "application/json; charset=utf-8" -TimeoutSec 10
}

try {
    $local = Read-StudioPlanner
    $server = Get-ServerPlanner
    $remotePayload = [ordered]@{
        plannerOn = [bool]$server.plannerOn
        plannerRules = @($server.plannerRules)
    }
    $localJson = Planner-Json $local
    $remoteJson = Planner-Json $remotePayload
    Write-Host ("Studio: {0} regles | Ubuntu: {1} regles | revision {2}" -f @($local.plannerRules).Count, @($server.plannerRules).Count, $server.revision)

    if ($localJson -cne $remoteJson) {
        Write-Warning "Studio and Ubuntu planner differ. No overwrite performed."
        Write-Host "Check the correct Studio config and reconcile before enabling Watch."
        exit 2
    }
    Write-Host "OK: Studio and Ubuntu planner snapshots match."
    if ($Mode -eq "Check") {
        Write-Host "Read-only check complete. Nothing changed."
        exit 0
    }

    $revision = [int]$server.revision
    Write-Host "Watching Studio changes every $IntervalSeconds seconds. Ctrl+C to stop."
    while ($true) {
        Start-Sleep -Seconds $IntervalSeconds
        try {
            $latest = Read-StudioPlanner
            $nextJson = Planner-Json $latest
            if ($nextJson -ceq $localJson) { continue }

            # Never overwrite a newer server revision.
            $current = Get-ServerPlanner
            if ([int]$current.revision -ne $revision) {
                Write-Warning "Server revision changed externally. Synchronization stopped to prevent overwriting."
                break
            }
            $result = Put-ServerPlanner $latest $revision
            $revision = [int]$result.revision
            $localJson = $nextJson
            Write-Host ("Studio modification saved on Ubuntu: {0} rules, revision {1}" -f @($latest.plannerRules).Count, $revision)
        } catch {
            Write-Warning ("Synchronization paused: " + $_.Exception.Message)
            Write-Host "No Studio settings modified. Press Ctrl+C to stop."
            break
        }
    }
} finally {
    $headers.Clear()
}
