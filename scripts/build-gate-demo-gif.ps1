Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$resourcesOut = Join-Path $repoRoot "resources\ripple-gate-demo.gif"
$docsMediaDir = Join-Path $repoRoot "docs\media"
$docsOut = Join-Path $docsMediaDir "ripple-gate-demo.gif"

New-Item -ItemType Directory -Force -Path (Split-Path $resourcesOut) | Out-Null
New-Item -ItemType Directory -Force -Path $docsMediaDir | Out-Null

$width = 1120
$height = 650
$framesPerStep = 8
$frameDelayHundredths = 18

function Color-Rgb([int]$r, [int]$g, [int]$b) {
  return [System.Drawing.Color]::FromArgb($r, $g, $b)
}

function Color-Argb([int]$a, [int]$r, [int]$g, [int]$b) {
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

$bg = Color-Rgb 5 10 17
$panel = Color-Rgb 7 15 25
$panel2 = Color-Rgb 10 22 35
$text = Color-Rgb 232 240 248
$muted = Color-Rgb 124 145 166
$muted2 = Color-Rgb 72 92 112
$cyan = Color-Rgb 0 200 255
$green = Color-Rgb 65 216 135
$red = Color-Rgb 255 79 79
$amber = Color-Rgb 245 185 69
$line = Color-Rgb 24 44 62

$fontBrand = New-Object System.Drawing.Font "Consolas", 20, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontKicker = New-Object System.Drawing.Font "Consolas", 13, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontTitle = New-Object System.Drawing.Font "Consolas", 16, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontBody = New-Object System.Drawing.Font "Consolas", 11, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fontBodyBold = New-Object System.Drawing.Font "Consolas", 11, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontCode = New-Object System.Drawing.Font "Consolas", 12, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fontCodeBold = New-Object System.Drawing.Font "Consolas", 12, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontMicro = New-Object System.Drawing.Font "Consolas", 10, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)

function New-RoundPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-RoundRect($graphics, $brush, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-RoundPath $x $y $w $h $r
  $graphics.FillPath($brush, $path)
  $path.Dispose()
}

function Stroke-RoundRect($graphics, $pen, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-RoundPath $x $y $w $h $r
  $graphics.DrawPath($pen, $path)
  $path.Dispose()
}

function Draw-Text($graphics, [string]$value, $font, $color, [float]$x, [float]$y, [float]$w, [float]$h) {
  $brush = New-Object System.Drawing.SolidBrush $color
  $format = New-Object System.Drawing.StringFormat
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::LineLimit
  $rect = New-Object System.Drawing.RectangleF $x, $y, $w, $h
  $graphics.DrawString($value, $font, $brush, $rect, $format)
  $format.Dispose()
  $brush.Dispose()
}

function Draw-Line($graphics, [string]$value, $font, $color, [float]$x, [float]$y, [float]$w) {
  Draw-Text $graphics $value $font $color $x $y $w 17
}

function Draw-StatusBadge($graphics, [string]$textValue, $color, [float]$x, [float]$y, [float]$w) {
  $back = New-Object System.Drawing.SolidBrush (Color-Argb 24 $color.R $color.G $color.B)
  $pen = New-Object System.Drawing.Pen (Color-Argb 150 $color.R $color.G $color.B), 1.2
  Fill-RoundRect $graphics $back $x $y $w 28 6
  Stroke-RoundRect $graphics $pen $x $y $w 28 6
  Draw-Text $graphics $textValue $fontMicro $color ($x + 10) ($y + 8) ($w - 20) 13
  $back.Dispose()
  $pen.Dispose()
}

function Draw-TerminalChrome($graphics, [float]$x, [float]$y, [float]$w, [float]$h) {
  $terminalBrush = New-Object System.Drawing.SolidBrush (Color-Rgb 4 11 18)
  $barBrush = New-Object System.Drawing.SolidBrush (Color-Rgb 10 20 31)
  $pen = New-Object System.Drawing.Pen (Color-Argb 120 $line.R $line.G $line.B), 1
  Fill-RoundRect $graphics $terminalBrush $x $y $w $h 8
  Stroke-RoundRect $graphics $pen $x $y $w $h 8
  Fill-RoundRect $graphics $barBrush $x $y $w 28 8
  foreach ($dot in @(@($red, 0), @($amber, 15), @($green, 30))) {
    $brush = New-Object System.Drawing.SolidBrush $dot[0]
    $graphics.FillEllipse($brush, ($x + 15 + $dot[1]), ($y + 11), 7, 7)
    $brush.Dispose()
  }
  $terminalBrush.Dispose()
  $barBrush.Dispose()
  $pen.Dispose()
}

function Draw-StepRail($graphics, [int]$activeIndex, [float]$x, [float]$y, [float]$w) {
  $labels = @("PLAN", "EDIT", "GATE", "REPAIR")
  $gap = $w / 4
  for ($i = 0; $i -lt 4; $i++) {
    $active = $i -eq $activeIndex
    $color = if ($active) { $cyan } else { $muted2 }
    $brush = New-Object System.Drawing.SolidBrush $color
    $graphics.FillEllipse($brush, ($x + ($gap * $i) + 26), $y, 7, 7)
    $brush.Dispose()
    Draw-Line $graphics $labels[$i] $fontMicro $color ($x + ($gap * $i) + 40) ($y - 3) 62
    if ($i -lt 3) {
      $pen = New-Object System.Drawing.Pen (Color-Argb 75 $muted2.R $muted2.G $muted2.B), 1
      $graphics.DrawLine($pen, ($x + ($gap * $i) + 96), ($y + 3), ($x + ($gap * ($i + 1)) + 18), ($y + 3))
      $pen.Dispose()
    }
  }
}

function Draw-PanelShell($graphics, [int]$index, [int]$activeIndex, [float]$x, [float]$y, [float]$w, [float]$h, [string]$number, [string]$title, [string]$status, $statusColor, [string]$subtitle) {
  $isActive = $index -eq $activeIndex
  $baseBrush = New-Object System.Drawing.SolidBrush $panel
  $borderColor = if ($isActive) { $statusColor } else { $line }
  $alpha = if ($isActive) { 190 } else { 95 }
  $strokeWidth = if ($isActive) { 1.8 } else { 1 }
  $pen = New-Object System.Drawing.Pen (Color-Argb $alpha $borderColor.R $borderColor.G $borderColor.B), $strokeWidth
  Fill-RoundRect $graphics $baseBrush $x $y $w $h 12
  Stroke-RoundRect $graphics $pen $x $y $w $h 12
  $baseBrush.Dispose()
  $pen.Dispose()

  $numberBrush = New-Object System.Drawing.SolidBrush (Color-Argb 18 $cyan.R $cyan.G $cyan.B)
  $numberPen = New-Object System.Drawing.Pen (Color-Argb 150 $cyan.R $cyan.G $cyan.B), 1
  Fill-RoundRect $graphics $numberBrush ($x + 16) ($y + 15) 26 26 5
  Stroke-RoundRect $graphics $numberPen ($x + 16) ($y + 15) 26 26 5
  Draw-Text $graphics $number $fontKicker $cyan ($x + 24) ($y + 21) 12 13
  $numberBrush.Dispose()
  $numberPen.Dispose()

  Draw-Line $graphics $title $fontTitle $cyan ($x + 52) ($y + 19) 255
  Draw-Text $graphics $subtitle $fontBody $muted ($x + 52) ($y + 47) 338 34
  Draw-StatusBadge $graphics $status $statusColor ($x + $w - 162) ($y + 18) 140
}

function Draw-PlanPanel($graphics, [int]$activeIndex) {
  $x = 24; $y = 58; $w = 526; $h = 250
  Draw-PanelShell $graphics 0 $activeIndex $x $y $w $h "1" "PLAN BOUNDARY" "INTENT SAVED" $cyan "A human approves exactly one function before the agent edits."
  Draw-TerminalChrome $graphics ($x + 22) ($y + 88) ($w - 44) 148
  $tx = $x + 38; $ty = $y + 125
  Draw-Line $graphics '$ ripple plan --file src/auth.ts \' $fontCode $text $tx $ty 430
  Draw-Line $graphics '  --symbol refreshToken --mode function --save' $fontCode $text $tx ($ty + 17) 430
  Draw-Line $graphics 'control_mode:        function' $fontCode $cyan $tx ($ty + 38) 210
  Draw-Line $graphics 'allowed_symbol:      src/auth.ts::refreshToken' $fontCode $green $tx ($ty + 55) 370
  Draw-Line $graphics 'human_gate:          required-before-edit' $fontCode $muted $tx ($ty + 72) 330
  Draw-Line $graphics 'risk:                high' $fontCode $amber $tx ($ty + 89) 230
  Draw-Line $graphics 'intent:              latest' $fontCode $muted $tx ($ty + 106) 250
}

function Draw-EditPanel($graphics, [int]$activeIndex) {
  $x = 570; $y = 58; $w = 506; $h = 250
  Draw-PanelShell $graphics 1 $activeIndex $x $y $w $h "2" "AGENT EDITS CODE" "CHANGES STAGED" $muted "The agent fixes the approved function, then drifts into another one."
  Draw-TerminalChrome $graphics ($x + 18) ($y + 88) 318 148
  $tx = $x + 34; $ty = $y + 126
  Draw-Line $graphics '# Agent edited src/auth.ts' $fontCode $muted $tx $ty 250
  Draw-Line $graphics '+ function refreshToken(...) {' $fontCode $green $tx ($ty + 19) 270
  Draw-Line $graphics '+   // retry behavior fixed' $fontCode $green $tx ($ty + 36) 270
  Draw-Line $graphics '+ }' $fontCode $green $tx ($ty + 53) 80
  Draw-Line $graphics '# ...but also changed login' $fontCode $muted $tx ($ty + 75) 270
  Draw-Line $graphics '+ function login(user) {' $fontCode $red $tx ($ty + 94) 270
  Draw-Line $graphics '+   return session(user.trim())' $fontCode $red $tx ($ty + 111) 270

  $sideX = $x + 350
  $sideBrush = New-Object System.Drawing.SolidBrush (Color-Rgb 8 17 28)
  $sidePen = New-Object System.Drawing.Pen (Color-Argb 110 $line.R $line.G $line.B), 1
  Fill-RoundRect $graphics $sideBrush $sideX ($y + 88) 134 148 8
  Stroke-RoundRect $graphics $sidePen $sideX ($y + 88) 134 148 8
  Draw-Line $graphics "STAGED" $fontMicro $muted ($sideX + 34) ($y + 105) 70
  Draw-Line $graphics "OK  token" $fontCodeBold $green ($sideX + 15) ($y + 138) 110
  Draw-Line $graphics "X   login" $fontCodeBold $red ($sideX + 15) ($y + 180) 110
  Draw-Line $graphics "(outside)" $fontMicro $red ($sideX + 34) ($y + 197) 76
  $sideBrush.Dispose()
  $sidePen.Dispose()
}

function Draw-GatePanel($graphics, [int]$activeIndex) {
  $x = 24; $y = 326; $w = 526; $h = 252
  Draw-PanelShell $graphics 2 $activeIndex $x $y $w $h "3" "RIPPLE GATE" "HUMAN REVIEW" $red "Ripple compares the staged diff to the saved authorization boundary."
  Draw-TerminalChrome $graphics ($x + 22) ($y + 88) ($w - 44) 142
  $tx = $x + 38; $ty = $y + 122
  Draw-Line $graphics '$ ripple gate --intent latest' $fontCode $text $tx $ty 260
  Draw-Line $graphics 'HUMAN REVIEW REQUIRED' $fontTitle $red $tx ($ty + 27) 260
  Draw-Line $graphics 'Agent crossed the approved function boundary.' $fontCode $muted $tx ($ty + 48) 340

  $boxBrush = New-Object System.Drawing.SolidBrush (Color-Rgb 7 16 26)
  $boxPen = New-Object System.Drawing.Pen (Color-Argb 105 $red.R $red.G $red.B), 1
  Fill-RoundRect $graphics $boxBrush $tx ($ty + 68) 205 46 6
  Fill-RoundRect $graphics $boxBrush ($tx + 220) ($ty + 68) 220 46 6
  Stroke-RoundRect $graphics $boxPen $tx ($ty + 68) 205 46 6
  Stroke-RoundRect $graphics $boxPen ($tx + 220) ($ty + 68) 220 46 6
  Draw-Line $graphics "ALLOWED" $fontMicro $green ($tx + 12) ($ty + 79) 80
  Draw-Line $graphics "auth::refreshToken" $fontCode $green ($tx + 12) ($ty + 96) 170
  Draw-Line $graphics "CHANGED OUTSIDE" $fontMicro $red ($tx + 232) ($ty + 79) 110
  Draw-Line $graphics "auth::login" $fontCode $red ($tx + 232) ($ty + 96) 110
  Draw-Line $graphics 'Fix: undo login or ask human' $fontCodeBold $red $tx ($ty + 116) 330
  $boxBrush.Dispose()
  $boxPen.Dispose()
}

function Draw-RepairPanel($graphics, [int]$activeIndex) {
  $x = 570; $y = 326; $w = 506; $h = 252
  Draw-PanelShell $graphics 3 $activeIndex $x $y $w $h "4" "REPAIR HANDOFF" "STOP UNTIL FIXED" $amber "Ripple tells the agent exactly what to undo or when to ask a human."
  Draw-TerminalChrome $graphics ($x + 18) ($y + 88) ($w - 36) 142
  $tx = $x + 34; $ty = $y + 122
  Draw-Line $graphics '$ ripple repair --intent latest' $fontCode $text $tx $ty 290
  Draw-Line $graphics 'Repair instruction' $fontCodeBold $amber $tx ($ty + 24) 170
  Draw-Line $graphics '  - undo src/auth.ts::login' $fontCode $amber $tx ($ty + 42) 260
  Draw-Line $graphics '  - or ask for wider approval' $fontCode $amber $tx ($ty + 59) 270
  Draw-Line $graphics 'Agent may not continue autonomously.' $fontCode $muted $tx ($ty + 78) 315
  $continueBrush = New-Object System.Drawing.SolidBrush (Color-Argb 30 $red.R $red.G $red.B)
  $continuePen = New-Object System.Drawing.Pen (Color-Argb 140 $red.R $red.G $red.B), 1
  Fill-RoundRect $graphics $continueBrush $tx ($ty + 98) 412 34 6
  Stroke-RoundRect $graphics $continuePen $tx ($ty + 98) 412 34 6
  Draw-Line $graphics 'MUST STOP' $fontCodeBold $red ($tx + 14) ($ty + 108) 100
  Draw-Line $graphics 'human review before continuing' $fontCode $red ($tx + 120) ($ty + 108) 270
  $continueBrush.Dispose()
  $continuePen.Dispose()
}

function Draw-Footer($graphics) {
  $items = @(
    @("LOCAL-FIRST", "No cloud. No uploads."),
    @("ONE CONTRACT", "CLI, MCP, hooks, CI."),
    @("AUTHORIZATION GATE", "Allowed vs actual diff."),
    @("REPAIR HANDOFF", "Tell the agent what to fix.")
  )
  $x = 64
  for ($i = 0; $i -lt $items.Count; $i++) {
    Draw-Line $graphics $items[$i][0] $fontMicro $cyan ($x + ($i * 255)) 604 170
    Draw-Line $graphics $items[$i][1] $fontBody $muted ($x + ($i * 255)) 621 210
  }
}

function New-DemoFrame([int]$activeIndex, [int]$frameInStep) {
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear($bg)

  $topGlow = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 0, 0, $width, 240),
    (Color-Argb 38 0 200 255),
    (Color-Argb 0 0 200 255),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
  )
  $graphics.FillRectangle($topGlow, 0, 0, $width, 240)
  $topGlow.Dispose()

  $logoBrush = New-Object System.Drawing.SolidBrush (Color-Argb 90 $cyan.R $cyan.G $cyan.B)
  $graphics.FillRectangle($logoBrush, 24, 16, 22, 22)
  $logoBrush.Dispose()
  Draw-Line $graphics "RIPPLE" $fontBrand $text 58 16 170
  Draw-Line $graphics "LOCAL AUTHORIZATION GATE FOR AI CODING AGENTS" $fontBody $muted 764 20 330

  Draw-PlanPanel $graphics $activeIndex
  Draw-EditPanel $graphics $activeIndex
  Draw-GatePanel $graphics $activeIndex
  Draw-RepairPanel $graphics $activeIndex
  Draw-Footer $graphics

  $pulse = [math]::Sin(($frameInStep / [double]$framesPerStep) * [math]::PI)
  if ($pulse -gt 0) {
    $statusColors = @($cyan, $muted, $red, $green)
    $activeColor = $statusColors[$activeIndex]
    $pulsePen = New-Object System.Drawing.Pen (Color-Argb ([int](40 + 60 * $pulse)) $activeColor.R $activeColor.G $activeColor.B), 2
    $coords = @(@(24,58,526,250), @(570,58,506,250), @(24,326,526,252), @(570,326,506,252))
    $c = $coords[$activeIndex]
    Stroke-RoundRect $graphics $pulsePen $c[0] $c[1] $c[2] $c[3] 12
    $pulsePen.Dispose()
  }

  $graphics.Dispose()
  return $bmp
}

$frames = New-Object System.Collections.Generic.List[System.Drawing.Bitmap]
for ($activeIndex = 0; $activeIndex -lt 4; $activeIndex++) {
  for ($frameInStep = 0; $frameInStep -lt $framesPerStep; $frameInStep++) {
    $frames.Add((New-DemoFrame $activeIndex $frameInStep))
  }
}

$delayBytes = [byte[]]::new(4 * $frames.Count)
for ($i = 0; $i -lt $frames.Count; $i++) {
  [BitConverter]::GetBytes([int]$frameDelayHundredths).CopyTo($delayBytes, $i * 4)
}

$delayProperty = [System.Runtime.Serialization.FormatterServices]::GetUninitializedObject([System.Drawing.Imaging.PropertyItem])
$delayProperty.Id = 0x5100
$delayProperty.Type = 4
$delayProperty.Len = $delayBytes.Length
$delayProperty.Value = $delayBytes
$frames[0].SetPropertyItem($delayProperty)

$loopProperty = [System.Runtime.Serialization.FormatterServices]::GetUninitializedObject([System.Drawing.Imaging.PropertyItem])
$loopProperty.Id = 0x5101
$loopProperty.Type = 3
$loopProperty.Len = 2
$loopProperty.Value = [byte[]](0, 0)
$frames[0].SetPropertyItem($loopProperty)

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/gif" }
$encoder = [System.Drawing.Imaging.Encoder]::SaveFlag
$encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters 1

$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter $encoder, ([long][System.Drawing.Imaging.EncoderValue]::MultiFrame)
$frames[0].Save($resourcesOut, $codec, $encoderParameters)

$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter $encoder, ([long][System.Drawing.Imaging.EncoderValue]::FrameDimensionTime)
for ($i = 1; $i -lt $frames.Count; $i++) {
  $frames[0].SaveAdd($frames[$i], $encoderParameters)
}

$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter $encoder, ([long][System.Drawing.Imaging.EncoderValue]::Flush)
$frames[0].SaveAdd($encoderParameters)

$frames | ForEach-Object { $_.Dispose() }
$encoderParameters.Dispose()
$fontBrand.Dispose()
$fontKicker.Dispose()
$fontTitle.Dispose()
$fontBody.Dispose()
$fontBodyBold.Dispose()
$fontCode.Dispose()
$fontCodeBold.Dispose()
$fontMicro.Dispose()

Copy-Item -LiteralPath $resourcesOut -Destination $docsOut -Force

Get-Item $resourcesOut, $docsOut | Select-Object FullName, Length
