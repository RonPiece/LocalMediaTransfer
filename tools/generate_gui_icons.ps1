param(
    [string]$AssetsDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AssetsDir)) {
    $AssetsDir = Join-Path $PSScriptRoot "..\src\LocalMediaTransfer.GUI\Assets\Icons"
}

Add-Type -AssemblyName System.Drawing

function Dispose-IfNotNull {
    param([object]$Value)
    if ($null -ne $Value) {
        $Value.Dispose()
    }
}

function New-RoundedRectanglePath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-ConfiguredGraphics {
    param([System.Drawing.Graphics]$Graphics)

    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

function New-AppIconBitmap {
    param([int]$Size)

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    New-ConfiguredGraphics -Graphics $graphics
    $graphics.Clear([System.Drawing.Color]::Transparent)

    # 1) Background gradient
    $pad = [float]($Size * 0.06)
    $bgRadius = [float]($Size * 0.18)
    $bgPath = New-RoundedRectanglePath -X $pad -Y $pad -Width ($Size - (2 * $pad)) -Height ($Size - (2 * $pad)) -Radius $bgRadius
    $bgBrush = $null
    try {
        $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
            [System.Drawing.PointF]::new($pad, $pad),
            [System.Drawing.PointF]::new($Size - $pad, $Size - $pad),
            [System.Drawing.Color]::FromArgb(255, 33, 220, 207),
            [System.Drawing.Color]::FromArgb(255, 28, 126, 255)
        )
        $graphics.FillPath($bgBrush, $bgPath)
    }
    finally {
        Dispose-IfNotNull $bgBrush
        Dispose-IfNotNull $bgPath
    }

    # 2) Soft highlight
    $highlight = New-Object System.Drawing.Drawing2D.GraphicsPath
    $highlightBrush = $null
    try {
        $highlight.AddEllipse($Size * 0.10, $Size * 0.06, $Size * 0.62, $Size * 0.38)
        $highlightBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(42, 255, 255, 255))
        $graphics.FillPath($highlightBrush, $highlight)
    }
    finally {
        Dispose-IfNotNull $highlightBrush
        Dispose-IfNotNull $highlight
    }

    # Layout metrics
    $monitorX = [float]($Size * 0.38)
    $monitorY = [float]($Size * 0.25)
    $monitorW = [float]($Size * 0.48)
    $monitorH = [float]($Size * 0.38)
    $monitorRadius = [float]($Size * 0.03)

    $phoneX = [float]($Size * 0.16)
    $phoneY = [float]($Size * 0.18)
    $phoneW = [float]($Size * 0.30)
    $phoneH = [float]($Size * 0.60)
    $phoneRadius = [float]($Size * 0.05)

    # 3) Monitor stand (behind monitor)
    $standBrush = $null
    try {
        $standBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 34, 112, 206))
        $standW = [float]($monitorW * 0.15)
        $standH = [float]($Size * 0.08)
        $standX = [float]($monitorX + ($monitorW / 2) - ($standW / 2))
        $standY = [float]($monitorY + $monitorH - $Size * 0.01)
        $graphics.FillRectangle($standBrush, $standX, $standY, $standW, $standH)

        $baseW = [float]($monitorW * 0.50)
        $baseH = [float]($Size * 0.03)
        $baseX = [float]($monitorX + ($monitorW / 2) - ($baseW / 2))
        $baseY = [float]($standY + $standH)
        $graphics.FillRectangle($standBrush, $baseX, $baseY, $baseW, $baseH)
    }
    finally {
        Dispose-IfNotNull $standBrush
    }

    # 4) Monitor body
    $monitorPath = New-RoundedRectanglePath -X $monitorX -Y $monitorY -Width $monitorW -Height $monitorH -Radius $monitorRadius
    $monitorBrush = $null
    $monitorPen = $null
    try {
        $monitorBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
            [System.Drawing.PointF]::new($monitorX, $monitorY),
            [System.Drawing.PointF]::new($monitorX + $monitorW, $monitorY + $monitorH),
            [System.Drawing.Color]::FromArgb(255, 238, 250, 255),
            [System.Drawing.Color]::FromArgb(255, 205, 235, 252)
        )
        $monitorPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 34, 112, 206), [float]($Size * 0.02))
        $graphics.FillPath($monitorBrush, $monitorPath)
        $graphics.DrawPath($monitorPen, $monitorPath)
    }
    finally {
        Dispose-IfNotNull $monitorBrush
        Dispose-IfNotNull $monitorPen
        Dispose-IfNotNull $monitorPath
    }

    # 5) Phone body
    $phonePath = New-RoundedRectanglePath -X $phoneX -Y $phoneY -Width $phoneW -Height $phoneH -Radius $phoneRadius
    $phoneBrush = $null
    $phoneBorder = $null
    $phoneScreen = $null
    $screenBrush = $null
    $homeBrush = $null
    try {
        $phoneBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
            [System.Drawing.PointF]::new($phoneX, $phoneY),
            [System.Drawing.PointF]::new($phoneX + $phoneW, $phoneY + $phoneH),
            [System.Drawing.Color]::FromArgb(255, 28, 179, 201),
            [System.Drawing.Color]::FromArgb(255, 18, 111, 207)
        )
        $phoneBorder = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 13, 85, 170), [float]($Size * 0.015))
        $graphics.FillPath($phoneBrush, $phonePath)
        $graphics.DrawPath($phoneBorder, $phonePath)

        $screenPad = [float]($Size * 0.02)
        $phoneScreen = New-RoundedRectanglePath `
            -X ($phoneX + $screenPad) `
            -Y ($phoneY + $screenPad * 2) `
            -Width ($phoneW - $screenPad * 2) `
            -Height ($phoneH - ($screenPad * 4.5)) `
            -Radius ($phoneRadius * 0.62)
        $screenBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
            [System.Drawing.PointF]::new($phoneX, $phoneY),
            [System.Drawing.PointF]::new($phoneX, $phoneY + $phoneH),
            [System.Drawing.Color]::FromArgb(255, 225, 248, 252),
            [System.Drawing.Color]::FromArgb(255, 196, 235, 248)
        )
        $graphics.FillPath($screenBrush, $phoneScreen)

        $homeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(180, 107, 203, 231))
        $homeSize = [float]($Size * 0.04)
        $graphics.FillEllipse($homeBrush, $phoneX + ($phoneW - $homeSize) / 2, $phoneY + $phoneH * 0.86, $homeSize, $homeSize)
    }
    finally {
        Dispose-IfNotNull $phoneBrush
        Dispose-IfNotNull $phoneBorder
        Dispose-IfNotNull $screenBrush
        Dispose-IfNotNull $phoneScreen
        Dispose-IfNotNull $homeBrush
        Dispose-IfNotNull $phonePath
    }

    # 6) Data transfer arrow (stable polygon, not cap-generated)
    $graphics.TranslateTransform([float]($Size * 0.48), [float]($Size * 0.45))
    $graphics.RotateTransform(-15)

    $arrowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $arrowOutline = $null
    $arrowFill = $null
    try {
        $arrowPoints = @(
            [System.Drawing.PointF]::new([float]($Size * -0.22), [float]($Size * -0.05)),
            [System.Drawing.PointF]::new([float]($Size * 0.05), [float]($Size * -0.05)),
            [System.Drawing.PointF]::new([float]($Size * 0.05), [float]($Size * -0.13)),
            [System.Drawing.PointF]::new([float]($Size * 0.25), [float]($Size * 0.00)),
            [System.Drawing.PointF]::new([float]($Size * 0.05), [float]($Size * 0.13)),
            [System.Drawing.PointF]::new([float]($Size * 0.05), [float]($Size * 0.05)),
            [System.Drawing.PointF]::new([float]($Size * -0.22), [float]($Size * 0.05))
        )
        $arrowPath.AddPolygon($arrowPoints)

        $arrowOutline = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, [float]($Size * 0.025))
        $arrowOutline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $graphics.DrawPath($arrowOutline, $arrowPath)

        $arrowFill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 33, 103, 212))
        $graphics.FillPath($arrowFill, $arrowPath)
    }
    finally {
        Dispose-IfNotNull $arrowOutline
        Dispose-IfNotNull $arrowFill
        Dispose-IfNotNull $arrowPath
    }

    $graphics.ResetTransform()
    $graphics.Dispose()
    return $bmp
}

function New-TrayIconBitmap {
    param([int]$Size)

    # Simplified glyph for 16-32 tray readability:
    # white phone + right arrow on transparent background
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    New-ConfiguredGraphics -Graphics $graphics
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $glyph = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $phonePath = $null
    $phonePen = $null
    try {
        $phonePath = New-RoundedRectanglePath `
            -X ([float]($Size * 0.08)) `
            -Y ([float]($Size * 0.08)) `
            -Width ([float]($Size * 0.30)) `
            -Height ([float]($Size * 0.68)) `
            -Radius ([float]([Math]::Max(1, $Size * 0.06)))
        $phonePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, [float]([Math]::Max(1, $Size * 0.07)))
        $graphics.DrawPath($phonePen, $phonePath)
    }
    finally {
        Dispose-IfNotNull $phonePen
        Dispose-IfNotNull $phonePath
    }

    $arrowBody = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, [float]([Math]::Max(1, $Size * 0.14)))
    $arrowBody.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $arrowBody.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    try {
        $y = [float]($Size * 0.54)
        $startX = [float]($Size * 0.32)
        $endX = [float]($Size * 0.74)
        $graphics.DrawLine($arrowBody, $startX, $y, $endX, $y)

        $head = @(
            [System.Drawing.PointF]::new([float]($Size * 0.88), [float]($Size * 0.54)),
            [System.Drawing.PointF]::new([float]($Size * 0.66), [float]($Size * 0.39)),
            [System.Drawing.PointF]::new([float]($Size * 0.66), [float]($Size * 0.69))
        )
        $graphics.FillPolygon($glyph, $head)
    }
    finally {
        Dispose-IfNotNull $arrowBody
    }

    Dispose-IfNotNull $glyph
    $graphics.Dispose()
    return $bmp
}

function Resize-Bitmap {
    param(
        [System.Drawing.Bitmap]$Source,
        [int]$Size
    )

    $scaled = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($scaled)
    try {
        New-ConfiguredGraphics -Graphics $graphics
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.DrawImage($Source, 0, 0, $Size, $Size)
    }
    finally {
        $graphics.Dispose()
    }

    return $scaled
}

function Write-IcoFromPngs {
    param(
        [string[]]$PngPaths,
        [string]$IcoPath
    )

    $images = @()
    foreach ($pngPath in $PngPaths) {
        $image = [System.Drawing.Image]::FromFile($pngPath)
        try {
            $images += [pscustomobject]@{
                Width = $image.Width
                Height = $image.Height
                Bytes = [System.IO.File]::ReadAllBytes($pngPath)
            }
        }
        finally {
            $image.Dispose()
        }
    }

    $fileStream = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    try {
        $writer = New-Object System.IO.BinaryWriter $fileStream
        try {
            $writer.Write([uint16]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]$images.Count)

            $offset = 6 + (16 * $images.Count)
            foreach ($image in $images) {
                $widthByte = if ($image.Width -ge 256) { 0 } else { $image.Width }
                $heightByte = if ($image.Height -ge 256) { 0 } else { $image.Height }
                $writer.Write([byte]$widthByte)
                $writer.Write([byte]$heightByte)
                $writer.Write([byte]0)
                $writer.Write([byte]0)
                $writer.Write([uint16]1)
                $writer.Write([uint16]32)
                $writer.Write([uint32]$image.Bytes.Length)
                $writer.Write([uint32]$offset)
                $offset += $image.Bytes.Length
            }

            foreach ($image in $images) {
                $writer.Write($image.Bytes)
            }
        }
        finally {
            $writer.Dispose()
        }
    }
    finally {
        $fileStream.Dispose()
    }
}

function Save-Png {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [string]$Path
    )

    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Build-IconSet {
    param(
        [string]$Name,
        [scriptblock]$Factory,
        [int]$MasterSize,
        [int[]]$Sizes,
        [string]$IcoPath
    )

    $masterPath = Join-Path $AssetsDir ("{0}_master_{1}.png" -f $Name, $MasterSize)
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) (
        "LocalMediaTransfer.Icons\" + [guid]::NewGuid().ToString("N"))
    $master = & $Factory $MasterSize
    try {
        [System.IO.Directory]::CreateDirectory($tempDir) | Out-Null
        Save-Png -Bitmap $master -Path $masterPath
        $pngPaths = @()
        foreach ($size in $Sizes) {
            $scaledPath = Join-Path $tempDir ("{0}_{1}.png" -f $Name, $size)
            $scaled = Resize-Bitmap -Source $master -Size $size
            try {
                Save-Png -Bitmap $scaled -Path $scaledPath
            }
            finally {
                $scaled.Dispose()
            }
            $pngPaths += $scaledPath
        }

        Write-IcoFromPngs -PngPaths $pngPaths -IcoPath $IcoPath
    }
    finally {
        $master.Dispose()
        if (Test-Path -LiteralPath $tempDir) {
            Remove-Item -LiteralPath $tempDir -Recurse -Force
        }
    }
}

[System.IO.Directory]::CreateDirectory($AssetsDir) | Out-Null

$appSizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$traySizes = @(16, 20, 24, 32)

Build-IconSet -Name "AppIcon" -Factory ${function:New-AppIconBitmap} -MasterSize 1024 -Sizes $appSizes -IcoPath (Join-Path $AssetsDir "AppIcon.ico")
Build-IconSet -Name "TrayIcon" -Factory ${function:New-TrayIconBitmap} -MasterSize 256 -Sizes $traySizes -IcoPath (Join-Path $AssetsDir "TrayIcon.ico")

Write-Output "Generated icon assets in $AssetsDir"
