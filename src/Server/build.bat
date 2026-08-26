@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Debug"

if /I not "%CONFIG%"=="Debug" if /I not "%CONFIG%"=="Release" (
	echo Invalid configuration "%CONFIG%". Use Debug or Release.
	exit /b 1
)

if /I "%CONFIG%"=="Debug" (
	set "BUILD_SUBDIR=x64-debug"
) else (
	set "BUILD_SUBDIR=x64-release"
)

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%I in ("%SCRIPT_DIR%\..\..") do set "REPO_ROOT=%%~fI"

if not defined VCPKG_ROOT set "VCPKG_ROOT=%REPO_ROOT%\vcpkg"
set "VCPKG_TOOLCHAIN=%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake"
if not exist "%VCPKG_TOOLCHAIN%" (
    echo vcpkg toolchain not found at "%VCPKG_TOOLCHAIN%".
    echo Run scripts\bootstrap-dependencies.ps1 or set VCPKG_ROOT.
    exit /b 1
)

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
    echo Visual Studio Installer not found. Please install Visual Studio 2022 or later.
    exit /b 1
)

for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    set "VS_PATH=%%i"
)

if "%VS_PATH%"=="" (
    echo Could not find a Visual Studio installation with C++ build tools.
    exit /b 1
)

set "VCVARSALL=%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARSALL%" (
    echo Could not find vcvars64.bat at %VCVARSALL%
    exit /b 1
)

call "%VCVARSALL%" >nul 2>&1
echo === ENVIRONMENT SET ===

set "CMAKE_EXE=%VS_PATH%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
if not exist "%CMAKE_EXE%" (
    set "CMAKE_EXE=cmake"
)

set "NINJA_EXE=%VS_PATH%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
if not exist "%NINJA_EXE%" (
    echo Visual Studio Ninja not found at "%NINJA_EXE%".
    exit /b 1
)
for %%I in ("%NINJA_EXE%") do set "PATH=%%~dpI;%PATH%"
set "VCPKG_FORCE_SYSTEM_BINARIES=1"

pushd "%SCRIPT_DIR%"

echo Step 1: CMake reconfigure ^(%CONFIG%^)...
"%CMAKE_EXE%" -S . -B out\build\%BUILD_SUBDIR% -G Ninja -DCMAKE_MAKE_PROGRAM="%NINJA_EXE%" -DCMAKE_BUILD_TYPE=%CONFIG% -DCMAKE_TOOLCHAIN_FILE="%VCPKG_TOOLCHAIN%" -DVCPKG_MANIFEST_DIR="%REPO_ROOT%" -DVCPKG_TARGET_TRIPLET=x64-windows-static-md 2>&1
echo === CONFIGURE EXIT CODE: %ERRORLEVEL% ===
if not %ERRORLEVEL%==0 (
	popd
	exit /b %ERRORLEVEL%
)

echo Step 2: Full rebuild (clean first)...
"%CMAKE_EXE%" --build out\build\%BUILD_SUBDIR% --clean-first 2>&1
echo === BUILD EXIT CODE: %ERRORLEVEL% ===

popd

exit /b %ERRORLEVEL%
