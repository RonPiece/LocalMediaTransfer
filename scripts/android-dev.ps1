param(
    [switch]$RebuildNative
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$project = Join-Path $repo 'src\LocalMediaTransfer.Mobile'
$generated = Join-Path $project 'android'
$expectedPackage = 'com.ronthedev.localmediatransfer.test'
$idPattern = 'applicationId\s+[''"]' + [regex]::Escape($expectedPackage) + '[''"]'

if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules\.bin\expo.cmd'))) {
    throw "Install mobile dependencies first: cd src\LocalMediaTransfer.Mobile; npm ci"
}
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    $candidateSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (Test-Path -LiteralPath (Join-Path $candidateSdk 'platform-tools\adb.exe')) {
        $env:ANDROID_HOME = $candidateSdk
        $env:Path = (Join-Path $candidateSdk 'platform-tools') + ';' + $env:Path
    } else {
        throw 'adb is unavailable. Set ANDROID_HOME and add Android SDK platform-tools to PATH.'
    }
}
if (-not $env:ANDROID_HOME) {
    $candidateSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (Test-Path -LiteralPath (Join-Path $candidateSdk 'platforms')) {
        $env:ANDROID_HOME = $candidateSdk
    } else {
        throw 'ANDROID_HOME is unavailable. Set it to the Android Studio SDK location.'
    }
}

$env:EXPO_PUBLIC_LMT_ENVIRONMENT = 'test'
$env:EXPO_OFFLINE = '1'
$gradleFile = Join-Path $generated 'app\build.gradle'
$regenerate = $RebuildNative -or -not (Test-Path -LiteralPath $gradleFile)
if (-not $regenerate) {
    $gradleSource = Get-Content -LiteralPath $gradleFile -Raw
    $regenerate = $gradleSource -notmatch $idPattern
}

Push-Location -LiteralPath $project
try {
    if ($regenerate) {
        if (Test-Path -LiteralPath $generated) {
            $resolved = (Resolve-Path -LiteralPath $generated).Path
            if ($resolved -ne [System.IO.Path]::GetFullPath($generated) -or
                -not $resolved.StartsWith($repo + [System.IO.Path]::DirectorySeparatorChar,
                    [System.StringComparison]::OrdinalIgnoreCase)) {
                throw 'Generated Android path is outside the repository.'
            }
        }
        & .\node_modules\.bin\expo.cmd prebuild --platform android --no-install --clean
        if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }
    }
    if (-not (Test-Path -LiteralPath $gradleFile) -or
        (Get-Content -LiteralPath $gradleFile -Raw) -notmatch $idPattern) {
        throw "Generated Android applicationId is not $expectedPackage."
    }
    & (Join-Path $generated 'gradlew.bat') :app:assembleDebug --project-dir $generated
    if ($LASTEXITCODE -ne 0) { throw 'Android debug build failed.' }
    $apk = Join-Path $generated 'app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw 'Debug APK was not produced.' }
    & adb install -r $apk
    if ($LASTEXITCODE -ne 0) { throw 'adb install failed. Start an emulator or connect a phone.' }
    & npm run start:dev-client
    if ($LASTEXITCODE -ne 0) { throw 'Metro exited with an error.' }
} finally {
    Pop-Location
}
