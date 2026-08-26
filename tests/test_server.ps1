#Requires -Version 5.1
<#
.SYNOPSIS
    Comprehensive test suite for LocalMediaTransfer C++ Server.
    Tests all HTTP endpoints against the behavior of the legacy Python server.

.DESCRIPTION
    Runs automated tests against an already-running isolated server instance.
    
    Prefer the canonical .NET harness, which starts the server safely:
        dotnet run --project tests\LocalMediaTransfer.TestHarness -c Release

.NOTES
    Based on Legacy Python server (server.py) endpoint behavior.
    Compatible with Windows PowerShell 5.1 and PowerShell Core 7+.
#>

param(
    [int]$Port = 8080,
    [string]$Token = "",
    [string]$BaseUrl = "",
    [Parameter(Mandatory = $true)]
    [string]$UploadDir,
    [ValidateSet("", "production", "test", "benchmark")]
    [string]$ExpectedEnvironment = "",
    [switch]$SkipLargeBoundaryTests,
    [switch]$DetailedOutput
)

# ===================================================================
#                    CONFIGURATION & SETUP
# ===================================================================

$ErrorActionPreference = "Continue"
if (-not $BaseUrl) { $BaseUrl = "http://localhost:$Port" }
Add-Type -AssemblyName System.Net.Http

# PS5.1 connection pool fix: prevent keep-alive from blocking subsequent requests
[System.Net.ServicePointManager]::DefaultConnectionLimit = 50
[System.Net.ServicePointManager]::Expect100Continue = $false
[System.Net.ServicePointManager]::MaxServicePointIdleTime = 2000

# Results tracking
$script:TestResults = @()
$script:PassCount = 0
$script:FailCount = 0
$script:SkipCount = 0
$script:TotalTime = [System.Diagnostics.Stopwatch]::StartNew()

# Log file
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $logDir "test_results_$timestamp.log"
Set-Content -Path $logFile -Value "" -Encoding UTF8

$testRoot = [System.IO.Path]::GetFullPath(
    (Join-Path ([System.IO.Path]::GetTempPath()) "LocalMediaTransfer.Tests")
).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$uploadRootDir = [System.IO.Path]::GetFullPath($UploadDir)
$uploadPathWithSeparator = $uploadRootDir.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar

if (-not $uploadPathWithSeparator.StartsWith($testRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "UploadDir must be inside the isolated test root '$testRoot'. Refusing: $uploadRootDir"
}
if (-not (Test-Path -LiteralPath $uploadRootDir -PathType Container)) {
    throw "Isolated upload directory does not exist: $uploadRootDir"
}

# ===================================================================
#                      HELPER FUNCTIONS
# ===================================================================

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
    $line = "[$ts] [$Level] $Message"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    
    if ($Level -eq "PASS") {
        Write-Host "  [PASS] $Message" -ForegroundColor Green
    }
    elseif ($Level -eq "FAIL") {
        Write-Host "  [FAIL] $Message" -ForegroundColor Red
    }
    elseif ($Level -eq "SKIP") {
        Write-Host "  [SKIP] $Message" -ForegroundColor Yellow
    }
    elseif ($Level -eq "WARN") {
        Write-Host "  [WARN] $Message" -ForegroundColor Yellow
    }
    elseif ($Level -eq "ERROR") {
        Write-Host "  [ERR!] $Message" -ForegroundColor Magenta
    }
    elseif ($Level -eq "INFO") {
        if ($DetailedOutput) { Write-Host "  [INFO] $Message" -ForegroundColor Cyan }
    }
    else {
        Write-Host "         $Message"
    }
}

function Get-ResponseStatusCode {
    # Robust status code extraction that works in both PS5.1 and PS7
    param($ErrorRecord)
    try {
        if ($ErrorRecord.Exception.Response) {
            $statusCode = $ErrorRecord.Exception.Response.StatusCode
            # In PS5.1, StatusCode is an enum; .value__ gives the int
            if ($statusCode -is [System.Net.HttpStatusCode]) {
                return [int]$statusCode.value__
            }
            return [int]$statusCode
        }
    } catch {}
    return 0
}

function Test-Feature {
    param(
        [string]$Category,
        [string]$Name,
        [string]$Description,
        [scriptblock]$TestBlock
    )

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $result = @{
        Category    = $Category
        Name        = $Name
        Description = $Description
        Status      = "UNKNOWN"
        Duration    = 0
        Error       = ""
        Details     = ""
    }

    try {
        $output = & $TestBlock
        $sw.Stop()
        $result.Status = "PASS"
        $result.Duration = $sw.ElapsedMilliseconds
        $result.Details = if ($output) { $output | Out-String } else { "" }
        $script:PassCount++
        Write-Log "$Category :: $Name ($($sw.ElapsedMilliseconds)ms)" "PASS"
    }
    catch {
        $sw.Stop()
        $result.Status = "FAIL"
        $result.Duration = $sw.ElapsedMilliseconds
        $result.Error = $_.Exception.Message
        $script:FailCount++
        Write-Log "$Category :: $Name -> $($_.Exception.Message)" "FAIL"
        Write-Log "  Stack: $($_.ScriptStackTrace)" "INFO"
    }

    $script:TestResults += $result
}

function Skip-Feature {
    param([string]$Category, [string]$Name, [string]$Reason)
    $script:TestResults += @{
        Category = $Category; Name = $Name; Status = "SKIP"
        Error = $Reason; Duration = 0; Details = ""
        Description = $Reason
    }
    $script:SkipCount++
    Write-Log "$Category :: $Name -> $Reason" "SKIP"
}

function Build-MultipartBody {
    param(
        [string]$FieldName = "file",
        [string]$FileName,
        [byte[]]$FileContent,
        [string]$ContentType = "application/octet-stream"
    )

    $boundary = "----TestBoundary" + [System.Guid]::NewGuid().ToString("N")
    $encoding = [System.Text.Encoding]::UTF8

    $bodyBuilder = New-Object System.IO.MemoryStream

    # Opening boundary + Content-Disposition header
    $header = "--$boundary`r`nContent-Disposition: form-data; name=`"$FieldName`"; filename=`"$FileName`"`r`nContent-Type: $ContentType`r`n`r`n"
    $headerBytes = $encoding.GetBytes($header)
    $bodyBuilder.Write($headerBytes, 0, $headerBytes.Length)

    # File content
    $bodyBuilder.Write($FileContent, 0, $FileContent.Length)

    # Closing boundary
    $footer = "`r`n--$boundary--`r`n"
    $footerBytes = $encoding.GetBytes($footer)
    $bodyBuilder.Write($footerBytes, 0, $footerBytes.Length)

    return @{
        Body        = $bodyBuilder.ToArray()
        ContentType = "multipart/form-data; boundary=$boundary"
        Boundary    = $boundary
    }
}

function Get-TestFileContent {
    param([string]$Name = "test", [int]$SizeBytes = 1024)
    $random = New-Object byte[] $SizeBytes
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($random)
    $rng.Dispose()
    return $random
}

function Get-FileHash256 {
    param([byte[]]$Content)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha.ComputeHash($Content)
    return ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ''
}

function Invoke-ChunkRequest {
    param(
        [Parameter(Mandatory = $true)][string]$FileId,
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string]$ChunkIndex,
        [Parameter(Mandatory = $true)][string]$TotalChunks,
        [Parameter(Mandatory = $true)][string]$FileSize,
        [Parameter(Mandatory = $true)][byte[]]$Body,
        [string]$SkipDuplicates = ""
    )

    $headers = @{
        "X-Upload-Token" = $Token
        "X-File-Id" = $FileId
        "X-Filename" = [System.Uri]::EscapeDataString($FileName)
        "X-Chunk-Index" = $ChunkIndex
        "X-Total-Chunks" = $TotalChunks
        "X-File-Size" = $FileSize
    }
    if ($SkipDuplicates -ne "") {
        $headers["X-Skip-Duplicates"] = $SkipDuplicates
    }

    return Invoke-RestMethod -Uri "$BaseUrl/upload_chunk" -Method POST `
        -ContentType "application/octet-stream" -Body $Body -Headers $headers -TimeoutSec 120
}

function Get-ChunkResponseStatus {
    param(
        [Parameter(Mandatory = $true)][string]$FileId,
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string]$ChunkIndex,
        [Parameter(Mandatory = $true)][string]$TotalChunks,
        [Parameter(Mandatory = $true)][string]$FileSize,
        [Parameter(Mandatory = $true)][byte[]]$Body
    )

    Add-Type -AssemblyName System.Net.Http
    $http = [System.Net.Http.HttpClient]::new()
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Post,
        "$BaseUrl/upload_chunk")
    try {
        $request.Headers.Add("X-Upload-Token", $Token)
        $request.Headers.Add("X-File-Id", $FileId)
        $request.Headers.Add("X-Filename", [System.Uri]::EscapeDataString($FileName))
        $request.Headers.Add("X-Chunk-Index", $ChunkIndex)
        $request.Headers.Add("X-Total-Chunks", $TotalChunks)
        $request.Headers.Add("X-File-Size", $FileSize)
        $request.Content = [System.Net.Http.ByteArrayContent]::new($Body)
        $request.Content.Headers.ContentType =
            [System.Net.Http.Headers.MediaTypeHeaderValue]::new("application/octet-stream")

        $response = $http.SendAsync($request).GetAwaiter().GetResult()
        try {
            return [int]$response.StatusCode
        }
        finally {
            $response.Dispose()
        }
    }
    finally {
        $request.Dispose()
        $http.Dispose()
    }
}

function Invoke-SequentialChunkUpload {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][long]$FileSize,
        [int]$ChunkSize = (8 * 1024 * 1024),
        [switch]$RetryFinalChunkConcurrently
    )

    $fileId = "test-" + [guid]::NewGuid().ToString("N")
    $totalChunks = [int][Math]::Ceiling($FileSize / [double]$ChunkSize)
    $lastResult = $null
    Add-Type -AssemblyName System.Net.Http
    $http = [System.Net.Http.HttpClient]::new()
    $http.Timeout = [TimeSpan]::FromMinutes(5)

    try {
        for ($chunkIndex = 0; $chunkIndex -lt $totalChunks; $chunkIndex++) {
            $remaining = $FileSize - ([long]$chunkIndex * $ChunkSize)
            $currentSize = [int][Math]::Min($ChunkSize, $remaining)
            $body = New-Object byte[] $currentSize
            if ($currentSize -gt 0) {
                $body[0] = [byte]($chunkIndex % 251)
                $body[$currentSize - 1] = [byte](($chunkIndex + 17) % 251)
            }

            if ($RetryFinalChunkConcurrently -and $chunkIndex -eq ($totalChunks - 1)) {
                $pendingRequests = @()
                try {
                    for ($retryIndex = 0; $retryIndex -lt 2; $retryIndex++) {
                        $retryRequest = [System.Net.Http.HttpRequestMessage]::new(
                            [System.Net.Http.HttpMethod]::Post,
                            "$BaseUrl/upload_chunk")
                        $retryRequest.Headers.Add("X-Upload-Token", $Token)
                        $retryRequest.Headers.Add("X-File-Id", $fileId)
                        $retryRequest.Headers.Add("X-Filename", [System.Uri]::EscapeDataString($FileName))
                        $retryRequest.Headers.Add("X-Chunk-Index", $chunkIndex.ToString())
                        $retryRequest.Headers.Add("X-Total-Chunks", $totalChunks.ToString())
                        $retryRequest.Headers.Add("X-File-Size", $FileSize.ToString())
                        $retryRequest.Content = [System.Net.Http.ByteArrayContent]::new($body)
                        $retryRequest.Content.Headers.ContentType =
                            [System.Net.Http.Headers.MediaTypeHeaderValue]::new("application/octet-stream")
                        $pendingRequests += [pscustomobject]@{
                            Request = $retryRequest
                            Task = $http.SendAsync($retryRequest)
                        }
                    }

                    $retryResults = foreach ($pending in $pendingRequests) {
                        $retryResponse = $pending.Task.GetAwaiter().GetResult()
                        try {
                            $retryBody = $retryResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                            if (-not $retryResponse.IsSuccessStatusCode) {
                                throw "Final chunk retry failed with HTTP $([int]$retryResponse.StatusCode): $retryBody"
                            }
                            $retryBody | ConvertFrom-Json
                        }
                        finally {
                            $retryResponse.Dispose()
                        }
                    }
                    $retryNames = @($retryResults | Select-Object -ExpandProperty filename -Unique)
                    if ($retryNames.Count -ne 1) {
                        throw "Concurrent final retries returned different filenames."
                    }
                    $lastResult = $retryResults[0]
                }
                finally {
                    foreach ($pending in $pendingRequests) {
                        $pending.Request.Dispose()
                    }
                }
                continue
            }

            $request = [System.Net.Http.HttpRequestMessage]::new(
                [System.Net.Http.HttpMethod]::Post,
                "$BaseUrl/upload_chunk")
            try {
                $request.Headers.Add("X-Upload-Token", $Token)
                $request.Headers.Add("X-File-Id", $fileId)
                $request.Headers.Add("X-Filename", [System.Uri]::EscapeDataString($FileName))
                $request.Headers.Add("X-Chunk-Index", $chunkIndex.ToString())
                $request.Headers.Add("X-Total-Chunks", $totalChunks.ToString())
                $request.Headers.Add("X-File-Size", $FileSize.ToString())
                $request.Content = [System.Net.Http.ByteArrayContent]::new($body)
                $request.Content.Headers.ContentType =
                    [System.Net.Http.Headers.MediaTypeHeaderValue]::new("application/octet-stream")

                $response = $http.SendAsync($request).GetAwaiter().GetResult()
                try {
                    $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                    if (-not $response.IsSuccessStatusCode) {
                        throw "Chunk $chunkIndex failed with HTTP $([int]$response.StatusCode): $responseBody"
                    }
                    $lastResult = $responseBody | ConvertFrom-Json
                }
                finally {
                    $response.Dispose()
                }
            }
            finally {
                $request.Dispose()
            }
        }
    }
    finally {
        $http.Dispose()
    }

    if ($lastResult.complete -ne $true -or [string]::IsNullOrWhiteSpace($lastResult.filename)) {
        throw "Chunk upload did not return a completed filename."
    }

    $savedPath = Join-Path $uploadRootDir $lastResult.filename
    if (-not (Test-Path -LiteralPath $savedPath -PathType Leaf)) {
        throw "Completed chunk upload was not found on disk: $savedPath"
    }
    if ((Get-Item -LiteralPath $savedPath).Length -ne $FileSize) {
        throw "Chunk upload size mismatch for $FileName."
    }

    return $savedPath
}

# ===================================================================
#                    AUTO-DETECT TOKEN
# ===================================================================

if (-not $Token) {
    Write-Host ""
    Write-Host "[*] No token provided. Attempting to auto-detect..." -ForegroundColor Cyan
    try {
        $healthCheck = Invoke-RestMethod -Uri "$BaseUrl/_health" -Method GET -TimeoutSec 5 -ErrorAction Stop
        Write-Host "    Server responded to /_health. Token may not be required." -ForegroundColor Gray
        
        try {
            $verifyRes = Invoke-WebRequest -Uri "$BaseUrl/verify_token" -Method POST `
                -ContentType "application/json" -Body '{"token":""}' -TimeoutSec 5 -UseBasicParsing
            if ($verifyRes.StatusCode -eq 200) {
                Write-Host "    Server accepts any token (no token set via GUI pipe yet)." -ForegroundColor Yellow
                $Token = "test_token_12345"
            }
        } catch {
            Write-Host "    Token is required. Please provide via -Token parameter." -ForegroundColor Red
            Write-Host '    Usage: powershell -ExecutionPolicy Bypass -File tests\test_server.ps1 -Token "YOUR_TOKEN"' -ForegroundColor White
            exit 1
        }
    }
    catch {
        Write-Host "    [X] Cannot reach server at $BaseUrl. Is it running?" -ForegroundColor Red
        Write-Host "    Start the GUI (F5 in Visual Studio) first, then run this script." -ForegroundColor White
        exit 1
    }
}

# ===================================================================
#                     START TEST RUN
# ===================================================================

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   LocalMediaTransfer Server -- Comprehensive Test Suite        " -ForegroundColor Cyan
Write-Host "   Target: $BaseUrl                                " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Log "Test run started against $BaseUrl" "INFO"
Write-Log "Isolated upload directory: $uploadRootDir" "INFO"
Write-Log "Token: $($Token.Substring(0, [Math]::Min(4, $Token.Length)))****" "INFO"
Write-Log "Log file: $logFile" "INFO"

# -------------------------------------------------------------------
# CATEGORY 1: SERVER HEALTH & CONNECTIVITY
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 1. Server Health & Connectivity ---" -ForegroundColor White

Test-Feature "Health" "GET /_health returns 200" `
    "Legacy Python returned {ok:true}. C++ returns {status:'ok',version}" {
    $r = Invoke-RestMethod -Uri "$BaseUrl/_health" -Method GET -TimeoutSec 5
    if ($r.status -ne "ok") { throw "Expected status='ok', got '$($r.status)'" }
    if ($ExpectedEnvironment -and $r.environment -ne $ExpectedEnvironment) {
        throw "Expected environment='$ExpectedEnvironment', got '$($r.environment)'"
    }
    "Server version: $($r.version)"
}

Test-Feature "Health" "Server responds within 500ms" `
    "Server should respond quickly to health checks" {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-RestMethod -Uri "$BaseUrl/_health" -TimeoutSec 5 | Out-Null
    $sw.Stop()
    if ($sw.ElapsedMilliseconds -gt 500) { throw "Response took $($sw.ElapsedMilliseconds)ms (> 500ms)" }
    "Response time: $($sw.ElapsedMilliseconds)ms"
}

# -------------------------------------------------------------------
# CATEGORY 2: TOKEN / SECURITY SYSTEM
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 2. Token & Security ---" -ForegroundColor White

Test-Feature "Security" "POST /verify_token accepts valid token (JSON body)" `
    "Legacy: reads token from JSON body {token:'...'} and X-Upload-Token header" {
    $body = @{ token = $Token } | ConvertTo-Json
    $r = Invoke-RestMethod -Uri "$BaseUrl/verify_token" -Method POST `
        -ContentType "application/json" -Body $body -TimeoutSec 5
    if ($r.valid -ne $true) { throw "Expected valid=true, got $($r | ConvertTo-Json -Compress)" }
    if ($ExpectedEnvironment -and $r.environment -ne $ExpectedEnvironment) {
        throw "Token response expected environment='$ExpectedEnvironment', got '$($r.environment)'"
    }
}

Test-Feature "Security" "POST /verify_token rejects invalid token" `
    "Should return 403 with {valid:false}" {
    try {
        $body = @{ token = "WRONG_TOKEN_99999" } | ConvertTo-Json
        $r = Invoke-WebRequest -Uri "$BaseUrl/verify_token" -Method POST `
            -ContentType "application/json" -Body $body -TimeoutSec 5 -UseBasicParsing
        if ($r.StatusCode -eq 200) {
            $json = $r.Content | ConvertFrom-Json
            if ($json.valid -eq $true) { throw "Server accepted an invalid token!" }
        }
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -eq 403) {
            "Correctly returned 403"
        } else {
            throw "Expected 403, got $code"
        }
    }
}

Test-Feature "Security" "POST /verify_token accepts X-Upload-Token header" `
    "Legacy: reads X-Upload-Token header (client-side sends this)" {
    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-RestMethod -Uri "$BaseUrl/verify_token" -Method POST `
        -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 5
    if ($r.valid -ne $true) { throw "X-Upload-Token header not accepted" }
}

Test-Feature "Security" "POST /upload_single without token returns 401" `
    "Legacy: returns 401 'Unauthorized' when token is missing" {
    $content = Get-TestFileContent -SizeBytes 100
    $mp = Build-MultipartBody -FileName "unauthorized.txt" -FileContent $content
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/upload_single" -Method POST `
            -ContentType $mp.ContentType -Body $mp.Body -TimeoutSec 10 -UseBasicParsing
        throw "Expected 401 but got $($r.StatusCode)"
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 401) { throw "Expected 401, got $code" }
        "Correctly returned 401"
    }
}

Test-Feature "Security" "POST /upload_chunk without token returns 401" `
    "Native iOS upload authentication loss is rejected before a partial file is created" {
    $fileId = "ios-unauthorized-probe-1"
    $headers = @{
        "X-File-Id" = $fileId
        "X-Filename" = [System.Uri]::EscapeDataString("unauthorized_probe.bin")
        "X-Chunk-Index" = "0"
        "X-Total-Chunks" = "1"
        "X-File-Size" = "1"
        "X-Skip-Duplicates" = "true"
    }
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/upload_chunk" -Method POST `
            -Headers $headers -ContentType "application/octet-stream" `
            -Body ([byte[]](1)) -TimeoutSec 10 -UseBasicParsing
        throw "Expected 401 but got $($response.StatusCode)"
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 401) { throw "Expected 401, got $code" }
    }
    $temporaryPath = Join-Path $uploadRootDir ".$fileId.tmp"
    if (Test-Path -LiteralPath $temporaryPath) {
        throw "Unauthenticated native upload created a partial file"
    }
    "Native chunk authentication failed closed without creating a partial file"
}

Test-Feature "Security" "POST /client_log without token returns 401" `
    "Unauthenticated network clients must not inject entries into desktop logs" {
    try {
        $body = @{
            session = "forged"
            level = "ERROR"
            event = "forged_event"
            message = "forged log entry"
        } | ConvertTo-Json
        $r = Invoke-WebRequest -Uri "$BaseUrl/client_log" -Method POST `
            -ContentType "application/json" -Body $body -TimeoutSec 5 -UseBasicParsing
        throw "Expected 401 but got $($r.StatusCode)"
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 401) { throw "Expected 401, got $code" }
        "Correctly returned 401"
    }
}

Test-Feature "Security" "Authenticated client logs redact secrets and neutralize control characters" `
    "Authenticated diagnostics remain useful without accepting secret or CRLF log injection" {
    $secretMarker = "LMT_CLIENT_LOG_SECRET_MARKER"
    $body = @{
        session = "line-one`r`nline-two"
        level = "WARN"
        event = "security_log_sanitization_probe"
        message = "probe`tmessage"
        data = @{
            token = $secretMarker
            selectedFiles = 3
        }
    } | ConvertTo-Json
    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-RestMethod -Uri "$BaseUrl/client_log" -Method POST `
        -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 5
    if ($r.ok -ne $true) { throw "Authenticated client log was rejected" }

    "Authenticated sanitization probe accepted; the owning harness verifies the flushed log"
}

# -------------------------------------------------------------------
# CATEGORY 3: SINGLE FILE UPLOAD
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 3. Single File Upload (/upload_single) ---" -ForegroundColor White

Test-Feature "Upload" "Upload small text file (1KB)" `
    "Basic upload: multipart FormData with 'file' field" {
    $content = [System.Text.Encoding]::UTF8.GetBytes("Hello World from test suite! " * 40)
    $mp = Build-MultipartBody -FileName "test_small.txt" -FileContent $content -ContentType "text/plain"
    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $mp.ContentType -Body $mp.Body -Headers $headers -TimeoutSec 10
    if ($r.success -ne $true) { throw "Upload failed: $($r | ConvertTo-Json -Compress)" }
    "Saved as: $($r.filename), size: $($r.size) bytes"
}

Test-Feature "Upload" "Upload medium binary file (100KB)" `
    "Tests binary data handling through multipart" {
    $content = Get-TestFileContent -SizeBytes (100 * 1024)
    $mp = Build-MultipartBody -FileName "test_medium.bin" -FileContent $content
    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $mp.ContentType -Body $mp.Body -Headers $headers -TimeoutSec 15
    if ($r.success -ne $true) { throw "Upload failed" }
    if ($r.size -ne (100 * 1024)) { throw "Size mismatch: expected 102400, got $($r.size)" }
    "Uploaded 100KB successfully"
}

Test-Feature "Upload" "Upload 1MB file" `
    "Tests larger multipart payload handling" {
    $content = Get-TestFileContent -SizeBytes (1024 * 1024)
    $mp = Build-MultipartBody -FileName "test_1mb.dat" -FileContent $content
    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $mp.ContentType -Body $mp.Body -Headers $headers -TimeoutSec 30
    if ($r.success -ne $true) { throw "Upload failed" }
    "Uploaded 1MB successfully, size: $($r.size) bytes"
}

Test-Feature "Upload" "Upload file with special characters in name" `
    "Legal Windows characters such as spaces, parentheses, dashes, and brackets are preserved" {
    $content = [System.Text.Encoding]::UTF8.GetBytes("Special chars test")
    $mp = Build-MultipartBody -FileName "IMG_2024 (1) - Copy [Final].txt" -FileContent $content
    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $mp.ContentType -Body $mp.Body -Headers $headers -TimeoutSec 10
    if ($r.success -ne $true) { throw "Upload failed for special chars filename" }
    "Saved as: $($r.filename)"
}

Test-Feature "Upload" "Upload mixed Hebrew, Russian, English, and emoji filename" `
    "UTF-8 filename handling should preserve the required scripts and surrogate pairs" {
    $hebrew = "$([char]0x05E9)$([char]0x05DC)$([char]0x05D5)$([char]0x05DD)"
    $russian = "$([char]0x0444)$([char]0x043E)$([char]0x0442)$([char]0x043E)"
    $emoji = "$([char]::ConvertFromUtf32(0x1F600))$([char]::ConvertFromUtf32(0x1F4F7))"
    $unicodeBase = "${hebrew}_${russian}_Photo_${emoji}"
    $unicodeName = "$unicodeBase.txt"
    $content = [System.Text.Encoding]::UTF8.GetBytes("Unicode filename test")
    $mp = Build-MultipartBody -FileName $unicodeName -FileContent $content -ContentType "text/plain"
    $headers = @{ "X-Upload-Token" = $Token; "X-Filename" = [System.Uri]::EscapeDataString($unicodeName) }
    $r = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $mp.ContentType -Body $mp.Body -Headers $headers -TimeoutSec 15

    if ($r.success -ne $true) { throw "Upload failed for mixed Unicode filename" }
    if ([string]::IsNullOrWhiteSpace($r.filename)) { throw "Server returned empty filename" }
    if ($r.filename -match '[<>:"/\\|?*]') { throw "Saved filename still has Windows-invalid symbols: $($r.filename)" }

    $diskMatch = Get-ChildItem -Path $uploadRootDir -File -Filter "*.txt" |
        Where-Object { $_.Name.StartsWith($unicodeBase, [System.StringComparison]::Ordinal) } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $diskMatch) { throw "No on-disk filename matched expected Unicode prefix '$unicodeBase'" }

    "Saved (API): $($r.filename); Saved (disk): $($diskMatch.Name)"
}

Test-Feature "Upload" "Same filename with different content keeps both files" `
    "The default policy uses deterministic Windows-style numbering without overwriting" {
    $original = [System.Text.Encoding]::UTF8.GetBytes("original collision content")
    $different = [System.Text.Encoding]::UTF8.GetBytes("different collision content")
    $thirdContent = [System.Text.Encoding]::UTF8.GetBytes("third collision content")
    $originalHash = Get-FileHash256 -Content $original

    $first = Build-MultipartBody -FileName "name_conflict.txt" -FileContent $original
    $headers = @{ "X-Upload-Token" = $Token }
    $saved = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $first.ContentType -Body $first.Body -Headers $headers -TimeoutSec 10
    if ($saved.filename -ne "name_conflict.txt" -or $saved.skipped -eq $true) {
        throw "Initial file was not saved under its original name."
    }

    $second = Build-MultipartBody -FileName "name_conflict.txt" -FileContent $different
    $secondSaved = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $second.ContentType -Body $second.Body -Headers $headers -TimeoutSec 10
    if ($secondSaved.filename -ne "name_conflict (2).txt" -or $secondSaved.skipped -eq $true) {
        throw "Second file did not receive the expected numbered filename."
    }

    $third = Build-MultipartBody -FileName "name_conflict.txt" -FileContent $thirdContent
    $thirdSaved = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $third.ContentType -Body $third.Body -Headers $headers -TimeoutSec 10
    if ($thirdSaved.filename -ne "name_conflict (3).txt" -or $thirdSaved.skipped -eq $true) {
        throw "Third file did not receive the expected numbered filename."
    }

    $savedPath = Join-Path $uploadRootDir "name_conflict.txt"
    $diskHash = Get-FileHash256 -Content ([System.IO.File]::ReadAllBytes($savedPath))
    if ($diskHash -ne $originalHash) {
        throw "The original destination file was modified."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $uploadRootDir "name_conflict (2).txt")) -or
        -not (Test-Path -LiteralPath (Join-Path $uploadRootDir "name_conflict (3).txt"))) {
        throw "Expected numbered copies were not created."
    }
    "Original file remained unchanged; numbered copies were created"
}

Test-Feature "Duplicates" "Exact duplicate is skipped without creating another file" `
    "Server-computed full SHA-256 verifies content before reporting skipped" {
    $content = [System.Text.Encoding]::UTF8.GetBytes("exact duplicate content")
    $headers = @{ "X-Upload-Token" = $Token; "X-File-Hash" = ("0" * 64) }

    $first = Build-MultipartBody -FileName "exact_duplicate.txt" -FileContent $content
    $saved = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $first.ContentType -Body $first.Body -Headers $headers -TimeoutSec 10
    if ($saved.skipped -eq $true) { throw "Initial upload was incorrectly skipped." }

    $second = Build-MultipartBody -FileName "exact_duplicate.txt" -FileContent $content
    $skipped = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $second.ContentType -Body $second.Body -Headers $headers -TimeoutSec 10
    if ($skipped.skipped -ne $true -or $skipped.filename -ne "exact_duplicate.txt") {
        throw "Exact duplicate was not reported as skipped."
    }

    $copies = @(Get-ChildItem $uploadRootDir -File -Filter "exact_duplicate*.txt")
    if ($copies.Count -ne 1) {
        throw "Expected one exact duplicate file, found $($copies.Count)."
    }
    "Exact duplicate was verified and skipped"
}

Test-Feature "Duplicates" "Disabled duplicate skipping stores a numbered copy" `
    "X-Skip-Duplicates false preserves identical content with deterministic numbering" {
    $content = [System.Text.Encoding]::UTF8.GetBytes(
        "keep exact duplicate content - " + [guid]::NewGuid().ToString("N"))
    $headers = @{
        "X-Upload-Token" = $Token
        "X-Skip-Duplicates" = "false"
    }

    $first = Build-MultipartBody -FileName "keep_exact_duplicate.txt" -FileContent $content
    $saved = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $first.ContentType -Body $first.Body -Headers $headers -TimeoutSec 10
    if ($saved.skipped -eq $true -or $saved.filename -ne "keep_exact_duplicate.txt") {
        throw "Initial upload was not saved with its requested name."
    }

    $second = Build-MultipartBody -FileName "keep_exact_duplicate.txt" -FileContent $content
    $copy = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $second.ContentType -Body $second.Body -Headers $headers -TimeoutSec 10
    if ($copy.skipped -eq $true -or $copy.filename -ne "keep_exact_duplicate (2).txt") {
        throw "Identical content was not retained as the expected numbered copy."
    }

    if (-not (Test-Path -LiteralPath (Join-Path $uploadRootDir "keep_exact_duplicate.txt")) -or
        -not (Test-Path -LiteralPath (Join-Path $uploadRootDir "keep_exact_duplicate (2).txt"))) {
        throw "Both exact duplicate copies were not present on disk."
    }
    "Identical content was retained as a numbered copy"
}

Test-Feature "Upload" "Concurrent uploads (parallel)" `
    "Tests thread safety of FileWriter with concurrent requests" {
    $http = [System.Net.Http.HttpClient]::new()
    $http.Timeout = [TimeSpan]::FromSeconds(30)
    $requests = @()
    try {
        for ($i = 1; $i -le 4; $i++) {
            $content = New-Object byte[] 2048
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try {
                $rng.GetBytes($content)
            }
            finally {
                $rng.Dispose()
            }

            $request = [System.Net.Http.HttpRequestMessage]::new(
                [System.Net.Http.HttpMethod]::Post,
                "$BaseUrl/upload_single")
            $request.Headers.Add("X-Upload-Token", $Token)
            $multipart = [System.Net.Http.MultipartFormDataContent]::new()
            $fileContent = [System.Net.Http.ByteArrayContent]::new($content)
            $fileContent.Headers.ContentType =
                [System.Net.Http.Headers.MediaTypeHeaderValue]::new("application/octet-stream")
            $multipart.Add($fileContent, "file", "parallel_$i.bin")
            $request.Content = $multipart

            $requests += [pscustomobject]@{
                Index = $i
                Request = $request
                Task = $http.SendAsync($request)
            }
        }

        $results = foreach ($pending in $requests) {
            try {
                $response = $pending.Task.GetAwaiter().GetResult()
                try {
                    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                    if (-not $response.IsSuccessStatusCode) {
                        throw "HTTP $([int]$response.StatusCode): $body"
                    }
                    $result = $body | ConvertFrom-Json
                    [pscustomobject]@{
                        Success = $result.success
                        File = $result.filename
                        Index = $pending.Index
                    }
                }
                finally {
                    $response.Dispose()
                }
            }
            catch {
                [pscustomobject]@{
                    Success = $false
                    Error = $_.Exception.Message
                    Index = $pending.Index
                }
            }
        }
    }
    finally {
        foreach ($pending in $requests) {
            $pending.Request.Dispose()
        }
        $http.Dispose()
    }

    $failures = @($results | Where-Object { -not $_.Success })
    if ($failures.Count -gt 0) {
        throw "Parallel uploads failed: $($failures | ConvertTo-Json -Compress)"
    }
    "All 4 parallel uploads succeeded"
}

# -------------------------------------------------------------------
# CATEGORY 4: DUPLICATE DETECTION
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 4. Duplicate Detection (/check_file) ---" -ForegroundColor White

Test-Feature "Duplicates" "POST /check_file with unknown hash returns exists:false" `
    "Legacy: returns {exists:false} for unknown hashes" {
    $body = @{ hash = "0000000000000000000000000000000000000000000000000000000000000000" } | ConvertTo-Json
    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-RestMethod -Uri "$BaseUrl/check_file" -Method POST `
        -ContentType "application/json" -Body $body -Headers $headers -TimeoutSec 5
    if ($r.exists -ne $false) { throw "Expected exists=false, got $($r | ConvertTo-Json -Compress)" }
    "Correctly returned exists=false"
}

Test-Feature "Duplicates" "Uploaded file hash is detected as duplicate" `
    "The server-computed full hash is persisted and available through /check_file" {
    $uniqueId = [guid]::NewGuid().ToString()
    $content = [System.Text.Encoding]::UTF8.GetBytes("Unique content for duplicate test - $uniqueId")
    $hash = Get-FileHash256 -Content $content
    $mp = Build-MultipartBody -FileName "dup_test_original.txt" -FileContent $content
    $headers = @{ "X-Upload-Token" = $Token }
    $uploadResult = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $mp.ContentType -Body $mp.Body -Headers $headers -TimeoutSec 10
    if ($uploadResult.success -ne $true) { throw "Initial upload failed" }

    # Now check if the hash is recognized
    $checkBody = @{ hash = $hash } | ConvertTo-Json
    $checkHeaders = @{ "X-Upload-Token" = $Token }
    $checkResult = Invoke-RestMethod -Uri "$BaseUrl/check_file" -Method POST `
        -ContentType "application/json" -Body $checkBody -Headers $checkHeaders -TimeoutSec 5
    if ($checkResult.exists -ne $true) { throw "Hash not found after upload! Got: $($checkResult | ConvertTo-Json -Compress)" }
    "Hash detected as duplicate. Original file: $($checkResult.filename)"
}

Test-Feature "Duplicates" "Identical content under another name is skipped" `
    "Full-file SHA-256 deduplicates content globally without creating a renamed copy" {
    $content = [System.Text.Encoding]::UTF8.GetBytes("global duplicate content")
    $headers = @{ "X-Upload-Token" = $Token }

    $first = Build-MultipartBody -FileName "global_original.txt" -FileContent $content
    $saved = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $first.ContentType -Body $first.Body -Headers $headers -TimeoutSec 10
    if ($saved.filename -ne "global_original.txt") {
        throw "Original content was not saved with its original name."
    }

    $second = Build-MultipartBody -FileName "global_other_name.txt" -FileContent $content
    $skipped = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $second.ContentType -Body $second.Body -Headers $headers -TimeoutSec 10
    if ($skipped.skipped -ne $true -or $skipped.filename -ne "global_original.txt") {
        throw "Global duplicate was not linked to the verified existing file."
    }
    if (Test-Path (Join-Path $uploadRootDir "global_other_name.txt")) {
        throw "A second physical copy was created."
    }
    "Duplicate content reused global_original.txt"
}

Test-Feature "Duplicates" "Changed files invalidate stale SQLite entries" `
    "The database is an index, so the server re-hashes the disk file before skipping" {
    $content = [System.Text.Encoding]::UTF8.GetBytes("content before local modification")
    $hash = Get-FileHash256 -Content $content
    $headers = @{ "X-Upload-Token" = $Token }
    $mp = Build-MultipartBody -FileName "stale_hash.txt" -FileContent $content
    $uploaded = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $mp.ContentType -Body $mp.Body -Headers $headers -TimeoutSec 10
    if ($uploaded.success -ne $true) { throw "Initial upload failed." }

    [System.IO.File]::WriteAllText(
        (Join-Path $uploadRootDir "stale_hash.txt"),
        "locally changed content",
        [System.Text.UTF8Encoding]::new($false))

    $body = @{ hash = $hash } | ConvertTo-Json
    $check = Invoke-RestMethod -Uri "$BaseUrl/check_file" -Method POST `
        -ContentType "application/json" -Body $body -Headers $headers -TimeoutSec 10
    if ($check.exists -ne $false) {
        throw "A modified file was incorrectly accepted as an exact duplicate."
    }
    "Stale hash mapping was rejected"
}

Test-Feature "Duplicates" "POST /check_file without hash returns 400" `
    "Legacy: returns {error:'Hash required'}, 400" {
    try {
        $body = @{} | ConvertTo-Json
        $headers = @{ "X-Upload-Token" = $Token }
        $r = Invoke-WebRequest -Uri "$BaseUrl/check_file" -Method POST `
            -ContentType "application/json" -Body $body -Headers $headers -TimeoutSec 5 -UseBasicParsing
        throw "Expected 400 but got $($r.StatusCode)"
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 400) { throw "Expected 400, got $code" }
        "Correctly returned 400"
    }
}

# -------------------------------------------------------------------
# CATEGORY 5: CONFIGURATION ENDPOINT
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 5. Configuration (/config) ---" -ForegroundColor White

Test-Feature "Config" "GET /config returns valid configuration" `
    "C++ server provides chunk sizes, parallel settings" {
    $r = Invoke-RestMethod -Uri "$BaseUrl/config" -Method GET -TimeoutSec 5
    if (-not $r.mobile) { throw "Missing 'mobile' config section" }
    if (-not $r.desktop) { throw "Missing 'desktop' config section" }
    if (-not $r.shared) { throw "Missing 'shared' config section" }
    "Mobile chunk: $($r.mobile.chunkSizeBytes), Desktop chunk: $($r.desktop.chunkSizeBytes)"
}

Test-Feature "Config" "Config has required fields for upload workers" `
    "workers.js needs chunk sizes and documents sequential chunks per file" {
    $r = Invoke-RestMethod -Uri "$BaseUrl/config" -Method GET -TimeoutSec 5
    $required = @("chunkSizeBytes", "parallelFiles", "sequentialChunksPerFile")
    foreach ($field in $required) {
        if ($null -eq $r.mobile.$field) { throw "Missing mobile.$field" }
        if ($null -eq $r.desktop.$field) { throw "Missing desktop.$field" }
    }
    if ($null -eq $r.shared.singleFileMaxBytes) { throw "Missing shared.singleFileMaxBytes" }
    "All required config fields present"
}

Test-Feature "Config" "Default filename conflict policy is keep-both" `
    "The public configuration should match Windows-style numbered collision handling" {
    $r = Invoke-RestMethod -Uri "$BaseUrl/config" -Method GET -TimeoutSec 5
    if ($r.features.filenameCollisionPolicy -ne "keep-both") {
        throw "Expected keep-both, got $($r.features.filenameCollisionPolicy)"
    }
    "Filename conflict policy is keep-both"
}

Test-Feature "Metrics" "Browser speed samples require the upload token" `
    "The GUI receives the browser upload-progress speed through the server metrics path" {
    $body = @{ bytesPerSecond = 12582912 } | ConvertTo-Json
    try {
        Invoke-WebRequest -Uri "$BaseUrl/client_metrics" -Method POST `
            -ContentType "application/json" -Body $body -TimeoutSec 5 `
            -UseBasicParsing | Out-Null
        throw "Expected unauthenticated metrics request to fail."
    }
    catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 403) { throw "Expected 403, got $code" }
    }

    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-WebRequest -Uri "$BaseUrl/client_metrics" -Method POST `
        -ContentType "application/json" -Body $body -Headers $headers `
        -TimeoutSec 5 -UseBasicParsing
    if ($r.StatusCode -ne 202) { throw "Expected 202, got $($r.StatusCode)" }
    "Authenticated speed sample accepted"
}

# -------------------------------------------------------------------
# CATEGORY 6: STATIC FILE SERVING
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 6. Static File Serving ---" -ForegroundColor White

Test-Feature "Static" "GET / serves index.html" `
    "Legacy: renders jinja template at root. C++: serves static/index.html" {
    $r = Invoke-WebRequest -Uri "$BaseUrl/" -Method GET -TimeoutSec 5 -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
    if ($r.Content.Length -lt 100) { throw "HTML response too small ($($r.Content.Length) bytes)" }
    if ($r.Content -notmatch "<html|<!DOCTYPE") { throw "Response does not look like HTML" }
    "Received $($r.Content.Length) bytes of HTML"
}

Test-Feature "Static" "GET /static/style.css serves CSS" `
    "Legacy: Flask serves static/style.css automatically" {
    $r = Invoke-WebRequest -Uri "$BaseUrl/static/style.css" -Method GET -TimeoutSec 5 -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
    if ($r.Content.Length -lt 50) { throw "CSS too small ($($r.Content.Length) bytes)" }
    "CSS served: $($r.Content.Length) bytes"
}

Test-Feature "Static" "GET /static/js/*.js serves JavaScript" `
    "Legacy: Flask serves static/JS/app.js" {
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/static/js/app.js" -Method GET -TimeoutSec 5 -UseBasicParsing
        if ($r.StatusCode -ne 200) { throw "Expected 200" }
        "JS served: $($r.Content.Length) bytes"
    } catch {
        try {
            $r = Invoke-WebRequest -Uri "$BaseUrl/static/JS/app.js" -Method GET -TimeoutSec 5 -UseBasicParsing
            "JS served via /static/JS/ path: $($r.Content.Length) bytes"
        } catch {
            throw "Neither /static/js/app.js nor /static/JS/app.js returned 200"
        }
    }
}

# -------------------------------------------------------------------
# CATEGORY 7: CORS & HEADERS
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 7. CORS & Response Headers ---" -ForegroundColor White

Test-Feature "CORS" "Responses include Access-Control-Allow-Origin" `
    "Required for cross-origin uploads from mobile browsers" {
    $r = Invoke-WebRequest -Uri "$BaseUrl/_health" -Method GET -TimeoutSec 5 -UseBasicParsing
    $cors = $r.Headers["Access-Control-Allow-Origin"]
    if (-not $cors) { throw "Missing Access-Control-Allow-Origin header" }
    "CORS header: $cors"
}

Test-Feature "CORS" "OPTIONS preflight returns allowed methods" `
    "CORS preflight must work for upload requests" {
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/upload_single" -Method OPTIONS -TimeoutSec 5 -UseBasicParsing
        "Preflight response: $($r.StatusCode)"
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -eq 204 -or $code -eq 200) {
            "Preflight returned $code (acceptable)"
        } else {
            throw "OPTIONS preflight failed with $code"
        }
    }
}

# -------------------------------------------------------------------
# CATEGORY 8: METADATA & PERSISTENCE
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 8. Metadata & File Persistence ---" -ForegroundColor White

Test-Feature "Metadata" "Upload metadata is logged to _dont_delete/_index.txt" `
    "Legacy: appends timestamp, original name, saved name, IP to _index.txt" {
    $marker = "metadata_test_" + [guid]::NewGuid().ToString("N").Substring(0,8)
    $content = [System.Text.Encoding]::UTF8.GetBytes("Metadata tracking test: $marker")
    $mp = Build-MultipartBody -FileName "$marker.txt" -FileContent $content
    $headers = @{ "X-Upload-Token" = $Token }
    $r = Invoke-RestMethod -Uri "$BaseUrl/upload_single" -Method POST `
        -ContentType $mp.ContentType -Body $mp.Body -Headers $headers -TimeoutSec 10
    if ($r.success -ne $true) { throw "Upload failed" }

    $indexPath = Join-Path $uploadRootDir "_dont_delete\_index.txt"
    if (Test-Path $indexPath) {
        $indexContent = Get-Content $indexPath -Tail 5 -ErrorAction SilentlyContinue
        $found = $indexContent | Where-Object { $_ -match $marker }
        if ($found) {
            "Found metadata entry: $found"
        } else {
            throw "Metadata entry not found in _index.txt for '$marker'"
        }
    } else {
        throw "_index.txt not found at $indexPath"
    }
}

Test-Feature "Metadata" "File hash persisted in _dont_delete/hashes.db" `
    "Current engine stores duplicate hashes in SQLite (hashes.db)" {
    $dbPath = Join-Path $uploadRootDir "_dont_delete\hashes.db"
    if (-not (Test-Path $dbPath)) {
        throw "hashes.db not found at $dbPath"
    }

    $dbInfo = Get-Item $dbPath
    if ($dbInfo.Length -lt 1024) {
        throw "hashes.db exists but looks too small ($($dbInfo.Length) bytes)"
    }

    "hashes.db exists ($($dbInfo.Length) bytes)"
}

# -------------------------------------------------------------------
# CATEGORY 9: ERROR HANDLING & EDGE CASES
# -------------------------------------------------------------------
Write-Host ""
Write-Host "--- 9. Error Handling & Edge Cases ---" -ForegroundColor White

Test-Feature "Isolation" "Test directory is isolated from personal uploads" `
    "The suite must only inspect the harness-provided TEMP directory" {
    $pictures = [System.IO.Path]::GetFullPath(
        (Join-Path $env:USERPROFILE "Pictures\LocalMediaTransfer")
    )
    if ($uploadRootDir.Equals($pictures, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Test upload directory resolved to the normal Pictures folder."
    }
    if (-not $uploadPathWithSeparator.StartsWith($testRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Test directory escaped the dedicated TEMP root."
    }
    "Using isolated directory: $uploadRootDir"
}

Test-Feature "Errors" "Zero-byte upload is rejected cleanly" `
    "Memory-mapped uploads cannot map an empty file and should return 400" {
    $mp = Build-MultipartBody -FileName "empty.dat" -FileContent ([byte[]]@())
    try {
        Invoke-WebRequest -Uri "$BaseUrl/upload_single" -Method POST `
            -ContentType $mp.ContentType -Body $mp.Body `
            -Headers @{ "X-Upload-Token" = $Token } -TimeoutSec 10 -UseBasicParsing | Out-Null
        throw "Expected zero-byte upload to be rejected."
    }
    catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 400) { throw "Expected 400, got $code" }
        "Correctly returned 400"
    }
}

Test-Feature "Chunks" "Sequential chunk upload finalizes exact content" `
    "Three ordered chunks should produce one complete file" {
    $fileId = "ordered-" + [guid]::NewGuid().ToString("N")
    [byte[]]$chunk0 = 1, 2, 3
    [byte[]]$chunk1 = 4, 5
    [byte[]]$chunk2 = 6, 7, 8, 9
    $fileName = "ordered_chunks.bin"

    Invoke-ChunkRequest -FileId $fileId -FileName $fileName -ChunkIndex "0" -TotalChunks "3" -FileSize "9" -Body $chunk0 | Out-Null
    Invoke-ChunkRequest -FileId $fileId -FileName $fileName -ChunkIndex "1" -TotalChunks "3" -FileSize "9" -Body $chunk1 | Out-Null
    $last = Invoke-ChunkRequest -FileId $fileId -FileName $fileName -ChunkIndex "2" -TotalChunks "3" -FileSize "9" -Body $chunk2

    if ($last.complete -ne $true) { throw "Final chunk did not complete the upload." }
    $saved = Join-Path $uploadRootDir $last.filename
    [byte[]]$actual = [System.IO.File]::ReadAllBytes($saved)
    [byte[]]$expected = $chunk0 + $chunk1 + $chunk2
    if ([System.BitConverter]::ToString($actual) -ne [System.BitConverter]::ToString($expected)) {
        throw "Finalized chunk content did not match the ordered input."
    }
    "Finalized $($actual.Length) bytes in order"
}

Test-Feature "Chunks" "Missing chunk metadata returns 400" `
    "All chunk identity and sizing headers are required" {
    try {
        Invoke-WebRequest -Uri "$BaseUrl/upload_chunk" -Method POST `
            -ContentType "application/octet-stream" -Body ([byte[]](1, 2, 3)) `
            -Headers @{ "X-Upload-Token" = $Token } -TimeoutSec 10 -UseBasicParsing | Out-Null
        throw "Expected missing metadata to be rejected."
    }
    catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 400) { throw "Expected 400, got $code" }
    }
}

Test-Feature "Chunks" "Invalid chunk metadata returns 400" `
    "Non-numeric chunk indexes must not reach the file writer" {
    try {
        Invoke-ChunkRequest `
            -FileId ("invalid-" + [guid]::NewGuid().ToString("N")) `
            -FileName "invalid.bin" `
            -ChunkIndex "not-a-number" `
            -TotalChunks "2" `
            -FileSize "4" `
            -Body ([byte[]](1, 2)) | Out-Null
        throw "Expected invalid metadata to be rejected."
    }
    catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 400) { throw "Expected 400, got $code" }
    }
}

Test-Feature "Chunks" "Duplicate chunk retry is idempotent" `
    "A repeated accepted chunk returns success without appending duplicate bytes" {
    $fileId = "duplicate-" + [guid]::NewGuid().ToString("N")
    Invoke-ChunkRequest -FileId $fileId -FileName "duplicate_chunk.bin" -ChunkIndex "0" -TotalChunks "3" -FileSize "6" -Body ([byte[]](1, 2)) | Out-Null
    $retry = Invoke-ChunkRequest -FileId $fileId -FileName "duplicate_chunk.bin" -ChunkIndex "0" -TotalChunks "3" -FileSize "6" -Body ([byte[]](1, 2))
    if ($retry.success -ne $true -or $retry.complete -ne $false) {
        throw "Accepted chunk retry did not return an idempotent success response."
    }
}

Test-Feature "Chunks" "Cancelling an iOS upload session removes partial files" `
    "Authenticated cancellation closes mappings and removes matching temporary files" {
    $sessionId = "ios-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $fileId = "$sessionId-1"
    Invoke-ChunkRequest `
        -FileId $fileId `
        -FileName "cancelled_partial.bin" `
        -ChunkIndex "0" `
        -TotalChunks "2" `
        -FileSize "4" `
        -Body ([byte[]](1, 2)) | Out-Null

    $temporaryPath = Join-Path $uploadRootDir ".$fileId.tmp"
    if (-not (Test-Path -LiteralPath $temporaryPath)) {
        throw "Expected the partial upload temporary file to exist before cancellation."
    }

    $body = @{ sessionId = $sessionId } | ConvertTo-Json -Compress
    $cancelled = Invoke-RestMethod `
        -Uri "$BaseUrl/upload_session/cancel" `
        -Method POST `
        -ContentType "application/json" `
        -Headers @{ "X-Upload-Token" = $Token } `
        -Body $body `
        -TimeoutSec 10
    if ($cancelled.ok -ne $true -or $cancelled.cancelledFiles -ne 1) {
        throw "The active iOS upload session was not cancelled."
    }
    if (Test-Path -LiteralPath $temporaryPath) {
        throw "The cancelled upload temporary file remained on disk."
    }

    $again = Invoke-RestMethod `
        -Uri "$BaseUrl/upload_session/cancel" `
        -Method POST `
        -ContentType "application/json" `
        -Headers @{ "X-Upload-Token" = $Token } `
        -Body $body `
        -TimeoutSec 10
    if ($again.cancelledFiles -ne 0) {
        throw "Repeated cancellation was not idempotent."
    }
    "Cancelled upload mapping and temporary file were removed"
}

Test-Feature "Security" "Upload-session cancellation requires authentication" `
    "Unauthenticated clients cannot remove another client's partial uploads" {
    try {
        $body = @{ sessionId = "ios-1785139292612" } | ConvertTo-Json -Compress
        $response = Invoke-WebRequest `
            -Uri "$BaseUrl/upload_session/cancel" `
            -Method POST `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 10 `
            -UseBasicParsing
        throw "Expected 401 but got $($response.StatusCode)"
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 401) { throw "Expected 401, got $code" }
        "Cancellation correctly required the upload token"
    }
}

Test-Feature "Security" "Chunk file IDs cannot escape the upload directory" `
    "Path-like file IDs are rejected before a temporary path is created" {
    try {
        Invoke-ChunkRequest `
            -FileId "../outside" `
            -FileName "outside.bin" `
            -ChunkIndex "0" `
            -TotalChunks "1" `
            -FileSize "2" `
            -Body ([byte[]](1, 2)) | Out-Null
        throw "Expected the unsafe file ID to be rejected."
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 409) { throw "Expected 409, got $code" }
        "Unsafe file ID was rejected"
    }
}

Test-Feature "Chunks" "File session metadata is immutable" `
    "Reusing a file ID with different name, size, or chunk count returns 409" {
    $fileId = "metadata-" + [guid]::NewGuid().ToString("N")
    Invoke-ChunkRequest -FileId $fileId -FileName "original.bin" -ChunkIndex "0" -TotalChunks "3" -FileSize "6" -Body ([byte[]](1, 2)) | Out-Null

    $variants = @(
        @{ FileName = "different.bin"; TotalChunks = "3"; FileSize = "6" },
        @{ FileName = "original.bin"; TotalChunks = "3"; FileSize = "7" },
        @{ FileName = "original.bin"; TotalChunks = "4"; FileSize = "6" }
    )
    foreach ($variant in $variants) {
        $code = Get-ChunkResponseStatus `
            -FileId $fileId `
            -FileName $variant.FileName `
            -ChunkIndex "0" `
            -TotalChunks $variant.TotalChunks `
            -FileSize $variant.FileSize `
            -Body ([byte[]](1, 2))
        if ($code -ne 409) {
            throw "Expected 409, got $code"
        }
    }
}

Test-Feature "Chunks" "Chunk count is bounded" `
    "The protocol rejects uploads beyond its documented 10,000-part limit" {
    $code = Get-ChunkResponseStatus `
        -FileId ("too-many-parts-" + [guid]::NewGuid().ToString("N")) `
        -FileName "too_many_parts.bin" `
        -ChunkIndex "0" `
        -TotalChunks "10001" `
        -FileSize "10001" `
        -Body ([byte[]](1))
    if ($code -ne 409) {
        throw "Expected 409, got $code"
    }
}

Test-Feature "Chunks" "Concurrent final chunk retry returns one result" `
    "A lost final response can be retried without duplicating the file" {
    $fileId = "final-retry-" + [guid]::NewGuid().ToString("N")
    $fileName = "final_retry.bin"
    Invoke-ChunkRequest -FileId $fileId -FileName $fileName -ChunkIndex "0" -TotalChunks "2" -FileSize "6" -Body ([byte[]](1, 2, 3)) | Out-Null

    $http = [System.Net.Http.HttpClient]::new()
    $requests = @()
    try {
        for ($i = 0; $i -lt 2; $i++) {
            $request = [System.Net.Http.HttpRequestMessage]::new(
                [System.Net.Http.HttpMethod]::Post,
                "$BaseUrl/upload_chunk")
            $request.Headers.Add("X-Upload-Token", $Token)
            $request.Headers.Add("X-File-Id", $fileId)
            $request.Headers.Add("X-Filename", [uri]::EscapeDataString($fileName))
            $request.Headers.Add("X-Chunk-Index", "1")
            $request.Headers.Add("X-Total-Chunks", "2")
            $request.Headers.Add("X-File-Size", "6")
            $request.Content = [System.Net.Http.ByteArrayContent]::new([byte[]](4, 5, 6))
            $requests += [pscustomobject]@{
                Request = $request
                Task = $http.SendAsync($request)
            }
        }

        $results = foreach ($pending in $requests) {
            $response = $pending.Task.GetAwaiter().GetResult()
            try {
                $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if (-not $response.IsSuccessStatusCode) {
                    throw "HTTP $([int]$response.StatusCode): $body"
                }
                $body | ConvertFrom-Json
            }
            finally {
                $response.Dispose()
            }
        }
    }
    finally {
        foreach ($pending in $requests) {
            $pending.Request.Dispose()
        }
        $http.Dispose()
    }

    $filenames = @($results | Select-Object -ExpandProperty filename -Unique)
    if ($filenames.Count -ne 1 -or [string]::IsNullOrWhiteSpace($filenames[0])) {
        throw "Concurrent final retries did not return one stable filename."
    }
    if (@($results | Where-Object { $_.complete -ne $true }).Count -ne 0) {
        throw "A concurrent final retry did not report completion."
    }

    $savedPath = Join-Path $UploadDir $filenames[0]
    [byte[]]$actual = [System.IO.File]::ReadAllBytes($savedPath)
    [byte[]]$expected = 1, 2, 3, 4, 5, 6
    if ([Convert]::ToBase64String($actual) -ne [Convert]::ToBase64String($expected)) {
        throw "Concurrent final retry changed the saved file content."
    }
}

Test-Feature "Chunks" "Out-of-order chunk is rejected with 409" `
    "Chunk two cannot arrive before chunk one" {
    $fileId = "out-of-order-" + [guid]::NewGuid().ToString("N")
    Invoke-ChunkRequest -FileId $fileId -FileName "out_of_order.bin" -ChunkIndex "0" -TotalChunks "3" -FileSize "6" -Body ([byte[]](1, 2)) | Out-Null
    try {
        Invoke-ChunkRequest -FileId $fileId -FileName "out_of_order.bin" -ChunkIndex "2" -TotalChunks "3" -FileSize "6" -Body ([byte[]](5, 6)) | Out-Null
        throw "Expected out-of-order chunk to be rejected."
    }
    catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ne 409) { throw "Expected 409, got $code" }
    }
}

if ($SkipLargeBoundaryTests) {
    Skip-Feature "Chunks" "99/100/101 MB boundary uploads" "Skipped by -SkipLargeBoundaryTests"
}
else {
    Test-Feature "Chunks" "99/100/101 MB boundary uploads" `
        "Large-file sizes around the frontend threshold must finalize correctly" {
        $project = Join-Path $PSScriptRoot `
            "LocalMediaTransfer.BoundaryTests\LocalMediaTransfer.BoundaryTests.csproj"
        & dotnet run --project $project -c Release -- `
            --server $BaseUrl `
            --token $Token `
            --upload-dir $uploadRootDir
        if ($LASTEXITCODE -ne 0) {
            throw "Boundary test executable failed with exit code $LASTEXITCODE."
        }
        "All threshold-adjacent chunk uploads completed"
    }

    Test-Feature "Chunks" "250 MB upload survives concurrent final retry" `
        "Matches the observed real-file size while simulating a lost final response" {
        $saved = Invoke-SequentialChunkUpload `
            -FileName "retry_250mb.bin" `
            -FileSize (250L * 1024 * 1024) `
            -ChunkSize (8 * 1024 * 1024) `
            -RetryFinalChunkConcurrently
        "250 MB retry upload completed: $(Split-Path -Leaf $saved)"
    }
}

Test-Feature "Errors" "Upload with no file part returns 400" `
    "Legacy: returns 'No files selected', 400" {
    try {
        $boundary = "----EmptyBoundary"
        $body = "--$boundary`r`nContent-Disposition: form-data; name=`"not_a_file`"`r`n`r`nsome text`r`n--$boundary--`r`n"
        $headers = @{ "X-Upload-Token" = $Token }
        $r = Invoke-WebRequest -Uri "$BaseUrl/upload_single" -Method POST `
            -ContentType "multipart/form-data; boundary=$boundary" `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
            -Headers $headers -TimeoutSec 10 -UseBasicParsing
        throw "Expected 400 but got $($r.StatusCode)"
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -eq 400) { "Correctly returned 400" }
        else { throw "Expected 400, got $code" }
    }
}

Test-Feature "Errors" "GET /nonexistent returns 404" `
    "Server should handle unknown routes gracefully" {
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/this_endpoint_does_not_exist" -Method GET -TimeoutSec 5 -UseBasicParsing
        if ($r.StatusCode -eq 404) { "Got 404" }
        else { throw "Expected 404, got $($r.StatusCode)" }
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -eq 404) { "Correctly returned 404" }
        else { throw "Expected 404, got $code" }
    }
}

Test-Feature "Errors" "Server survives malformed multipart body" `
    "Bug fix test: previously caused abort() crash" {
    try {
        $headers = @{ "X-Upload-Token" = $Token }
        $garbage = [System.Text.Encoding]::UTF8.GetBytes("This is not valid multipart data at all")
        $r = Invoke-WebRequest -Uri "$BaseUrl/upload_single" -Method POST `
            -ContentType "multipart/form-data; boundary=nonexistent" `
            -Body $garbage -Headers $headers -TimeoutSec 10 -UseBasicParsing
    } catch {
        $code = Get-ResponseStatusCode $_
        if ($code -ge 400 -and $code -lt 600) {
            # Good: server returned an error without crashing
        } else {
            throw "Unexpected response: $code"
        }
    }
    # Verify server is still alive after the bad request
    $health = Invoke-RestMethod -Uri "$BaseUrl/_health" -TimeoutSec 5
    if ($health.status -ne "ok") { throw "Server died after malformed request!" }
    "Server survived malformed multipart and is still responsive"
}

Test-Feature "Errors" "Server survives many rapid requests" `
    "Stress test: 20 health checks in quick succession" {
    $errors = 0
    for ($i = 0; $i -lt 20; $i++) {
        try {
            Invoke-RestMethod -Uri "$BaseUrl/_health" -TimeoutSec 3 | Out-Null
        } catch { $errors++ }
    }
    $succeeded = 20 - $errors
    if ($errors -gt 2) { throw "$errors/20 requests failed" }
    "20 rapid requests: $succeeded/20 succeeded"
}

# ===================================================================
#                      RESULTS SUMMARY
# ===================================================================

$script:TotalTime.Stop()

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "                     TEST RESULTS SUMMARY                       " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

$total = $script:PassCount + $script:FailCount + $script:SkipCount
Write-Host "  Total Tests: $total" -ForegroundColor White
Write-Host "  Passed:  $($script:PassCount)" -ForegroundColor Green
if ($script:FailCount -gt 0) {
    Write-Host "  Failed:  $($script:FailCount)" -ForegroundColor Red
} else {
    Write-Host "  Failed:  0" -ForegroundColor Green
}
Write-Host "  Skipped: $($script:SkipCount)" -ForegroundColor Yellow

$durationSec = [math]::Round($script:TotalTime.Elapsed.TotalSeconds, 1)
Write-Host "  Duration: ${durationSec}s" -ForegroundColor Gray
Write-Host ""

if ($script:FailCount -gt 0) {
    Write-Host "  -- FAILED TESTS --" -ForegroundColor Red
    foreach ($t in $script:TestResults) {
        if ($t.Status -eq "FAIL") {
            Write-Host "  * $($t.Category) :: $($t.Name)" -ForegroundColor Red
            Write-Host "    Error: $($t.Error)" -ForegroundColor DarkRed
        }
    }
    Write-Host ""
}

# Write detailed results to log file
Add-Content -Path $logFile -Value "`n`n=== DETAILED RESULTS ===" -Encoding UTF8
foreach ($t in $script:TestResults) {
    Add-Content -Path $logFile -Value "[$($t.Status)] $($t.Category) :: $($t.Name) ($($t.Duration)ms)" -Encoding UTF8
    if ($t.Description) { Add-Content -Path $logFile -Value "  Description: $($t.Description)" -Encoding UTF8 }
    if ($t.Error) { Add-Content -Path $logFile -Value "  Error: $($t.Error)" -Encoding UTF8 }
    if ($t.Details) { Add-Content -Path $logFile -Value "  Details: $($t.Details.ToString().Trim())" -Encoding UTF8 }
    Add-Content -Path $logFile -Value "" -Encoding UTF8
}

# Machine-readable summary
$failedTests = @()
foreach ($t in $script:TestResults) {
    if ($t.Status -eq "FAIL") {
        $failedTests += @{ Category = $t.Category; Name = $t.Name; Error = $t.Error }
    }
}
$summary = @{
    Timestamp   = Get-Date -Format "o"
    ServerUrl   = $BaseUrl
    UploadDir   = $uploadRootDir
    TotalTests  = $total
    Passed      = $script:PassCount
    Failed      = $script:FailCount
    Skipped     = $script:SkipCount
    DurationMs  = $script:TotalTime.ElapsedMilliseconds
    FailedTests = $failedTests
}
$summary | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $logDir "test_results_latest.json") -Encoding UTF8

Write-Host "  Log file: $logFile" -ForegroundColor Gray
Write-Host "  JSON:     $(Join-Path $logDir 'test_results_latest.json')" -ForegroundColor Gray
Write-Host ""

# Exit code for CI/CD
exit $script:FailCount
