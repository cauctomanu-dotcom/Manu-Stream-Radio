$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Web = Join-Path $Root 'web'
$Log = Join-Path $Root 'msr-noexe.log'
$script:Running = $true
$script:State = [ordered]@{
    live = $false
    showName = 'Manu Stream — Radio'
    banner = 'STANDBY'
    title = 'Manu Stream Radio'
    artist = 'Votre studio. Votre fréquence.'
    next = '—'
    callerName = ''
    meter = 0
    clock = '--:--:--'
}

function Log([string]$Message) {
    try { Add-Content -LiteralPath $Log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Message) -Encoding UTF8 } catch {}
}

function Send-Bytes($Stream, [int]$Status, [string]$ContentType, [byte[]]$Body, [hashtable]$ExtraHeaders = @{}) {
    $reason = switch ($Status) {
        200 {'OK'} 204 {'No Content'} 400 {'Bad Request'} 404 {'Not Found'} 405 {'Method Not Allowed'} 500 {'Internal Server Error'} 503 {'Service Unavailable'} default {'OK'}
    }
    if ($null -eq $Body) { $Body = [byte[]]@() }
    $headers = "HTTP/1.1 $Status $reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store, no-cache, must-revalidate, max-age=0`r`nPragma: no-cache`r`nConnection: close`r`n"
    foreach ($k in $ExtraHeaders.Keys) { $headers += "$k`: $($ExtraHeaders[$k])`r`n" }
    $headers += "`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($headers)
    $Stream.Write($hb, 0, $hb.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

function Send-Text($Stream, [int]$Status, [string]$ContentType, [string]$Text) {
    Send-Bytes $Stream $Status $ContentType ([Text.Encoding]::UTF8.GetBytes($Text))
}

function Send-Json($Stream, [int]$Status, $Object) {
    $json = $Object | ConvertTo-Json -Depth 12 -Compress
    Send-Text $Stream $Status 'application/json; charset=utf-8' $json
}

function Read-Request($Stream) {
    $headerBytes = New-Object System.Collections.Generic.List[byte]
    $last = New-Object byte[] 4
    $count = 0
    while ($true) {
        $b = $Stream.ReadByte()
        if ($b -lt 0) { break }
        $headerBytes.Add([byte]$b)
        $last[$count % 4] = [byte]$b
        $count++
        if ($count -ge 4) {
            $i0 = ($count - 4) % 4; $i1 = ($count - 3) % 4; $i2 = ($count - 2) % 4; $i3 = ($count - 1) % 4
            if ($last[$i0] -eq 13 -and $last[$i1] -eq 10 -and $last[$i2] -eq 13 -and $last[$i3] -eq 10) { break }
        }
        if ($count -gt 65536) { throw 'En-têtes HTTP trop volumineux.' }
    }
    if ($headerBytes.Count -eq 0) { return $null }
    $headerText = [Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
    $lines = $headerText -split "`r`n"
    $first = $lines[0].Split(' ')
    if ($first.Count -lt 2) { throw 'Requête HTTP invalide.' }
    $method = $first[0].ToUpperInvariant()
    $target = $first[1]
    $headers = @{}
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $p = $line.IndexOf(':')
        if ($p -gt 0) { $headers[$line.Substring(0,$p).Trim().ToLowerInvariant()] = $line.Substring($p+1).Trim() }
    }
    $len = 0
    if ($headers.ContainsKey('content-length')) { [void][int]::TryParse($headers['content-length'], [ref]$len) }
    $body = New-Object byte[] $len
    $read = 0
    while ($read -lt $len) {
        $n = $Stream.Read($body, $read, $len - $read)
        if ($n -le 0) { break }
        $read += $n
    }
    if ($read -lt $len) { $body = $body[0..([Math]::Max(0,$read-1))] }
    [pscustomobject]@{
        Method = $method
        Target = $target
        Path = (($target -split '\?')[0])
        Headers = $headers
        BodyBytes = $body
        BodyText = [Text.Encoding]::UTF8.GetString($body)
    }
}

function Mime([string]$Path) {
    switch -Regex ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '\.html$' { 'text/html; charset=utf-8'; break }
        '\.css$'  { 'text/css; charset=utf-8'; break }
        '\.js$'   { 'application/javascript; charset=utf-8'; break }
        '\.json$' { 'application/json; charset=utf-8'; break }
        '\.png$'  { 'image/png'; break }
        '\.jpg$|\.jpeg$' { 'image/jpeg'; break }
        '\.svg$'  { 'image/svg+xml'; break }
        '\.webp$' { 'image/webp'; break }
        default    { 'application/octet-stream' }
    }
}

function Serve-File($Stream, [string]$Name) {
    $full = Join-Path $Web $Name
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Text $Stream 404 'text/plain; charset=utf-8' 'Not Found'
        return
    }
    $bytes = [IO.File]::ReadAllBytes($full)
    Send-Bytes $Stream 200 (Mime $full) $bytes
}

function Is-PortFree([int]$Port) {
    $probe = $null
    try {
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
        $probe.Start(); $probe.Stop(); return $true
    } catch {
        try { if ($probe) { $probe.Stop() } } catch {}
        return $false
    }
}

function Try-Stop-OldMSR([int]$Port) {
    try {
        Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/api/quit" -ContentType 'application/json' -Body '{}' -TimeoutSec 1 | Out-Null
        Start-Sleep -Milliseconds 650
    } catch {}
}

function Open-Studio([string]$Url) {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    if ($candidates.Count -gt 0) {
        Start-Process -FilePath $candidates[0] -ArgumentList @("--app=$Url", '--start-maximized', '--disable-background-mode') | Out-Null
    } else {
        Start-Process $Url | Out-Null
    }
}

try {
    Log '=== démarrage recovery NO-EXE ==='
    foreach ($required in @('index.html','style.css','app.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Web $required) -PathType Leaf)) { throw "Fichier manquant : web\$required" }
    }

    $port = 17340
    if (-not (Is-PortFree $port)) { Try-Stop-OldMSR $port }
    if (-not (Is-PortFree $port)) {
        foreach ($p in 17341..17349) { if (Is-PortFree $p) { $port = $p; break } }
    }
    if (-not (Is-PortFree $port)) { throw 'Aucun port local disponible entre 17340 et 17349.' }

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    $listener.Start()
    Log "serveur actif sur 127.0.0.1:$port"
    $url = "http://127.0.0.1:$port/?build=noexe-recovery"
    Start-Sleep -Milliseconds 250
    Open-Studio $url

    while ($script:Running) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 5000
            $stream = $client.GetStream()
            $req = Read-Request $stream
            if ($null -eq $req) { continue }
            $path = [Uri]::UnescapeDataString($req.Path)

            if ($path -eq '/health') {
                Send-Text $stream 200 'text/plain; charset=utf-8' 'MSR-NOEXE-RECOVERY-2026-09-15'
            }
            elseif ($path -eq '/api/state') {
                if ($req.Method -eq 'GET') {
                    Send-Json $stream 200 $script:State
                } elseif ($req.Method -eq 'POST') {
                    if ($req.BodyText) {
                        try {
                            $obj = $req.BodyText | ConvertFrom-Json
                            foreach ($prop in $obj.PSObject.Properties) { $script:State[$prop.Name] = $prop.Value }
                        } catch {}
                    }
                    Send-Json $stream 200 ([ordered]@{ok=$true; state=$script:State})
                } else { Send-Json $stream 405 ([ordered]@{ok=$false; error='Méthode non autorisée'}) }
            }
            elseif ($path -eq '/api/image') {
                Send-Json $stream 200 ([ordered]@{ok=$true})
            }
            elseif ($path -like '/api/streamlabs/*') {
                Send-Json $stream 503 ([ordered]@{ok=$false; error="Streamlabs Remote Control n'est pas activé dans le lanceur de récupération. La régie locale continue de fonctionner."})
            }
            elseif ($path -eq '/api/quit') {
                Send-Json $stream 200 ([ordered]@{ok=$true})
                $script:Running = $false
            }
            elseif ($path -eq '/events') {
                Send-Text $stream 204 'text/event-stream; charset=utf-8' ''
            }
            elseif ($path -eq '/artwork' -or $path -eq '/logo' -or $path -eq '/favicon.ico') {
                Send-Text $stream 404 'text/plain; charset=utf-8' 'Not Found'
            }
            elseif ($path -eq '/' -or $path -eq '') { Serve-File $stream 'index.html' }
            elseif ($path -eq '/overlay' -or $path -eq '/overlay.html') { Serve-File $stream 'overlay.html' }
            elseif ($path -eq '/style.css') { Serve-File $stream 'style.css' }
            elseif ($path -eq '/app.js') { Serve-File $stream 'app.js' }
            elseif ($path -eq '/overlay.js') { Serve-File $stream 'overlay.js' }
            else { Send-Text $stream 404 'text/plain; charset=utf-8' 'Not Found' }
        }
        catch { Log ("requête en erreur : " + $_.Exception.Message) }
        finally {
            try { if ($stream) { $stream.Dispose() } } catch {}
            try { $client.Close() } catch {}
        }
    }

    try { $listener.Stop() } catch {}
    Log 'arrêt demandé'
}
catch {
    Log ("ERREUR FATALE : " + $_.Exception.ToString())
    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("Manu Stream Radio n'a pas pu démarrer.`n`n$($_.Exception.Message)`n`nRegarde le fichier msr-noexe.log dans le dossier.", 'Manu Stream Radio') | Out-Null
    } catch {}
    exit 1
}
