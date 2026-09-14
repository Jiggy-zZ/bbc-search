$ErrorActionPreference = "SilentlyContinue"

function Show-Check($name, $ok, $detail) {
    $mark = if ($ok) { "OK" } else { "MISSING" }
    Write-Host ("[{0}] {1} - {2}" -f $mark, $name, $detail)
}

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node).Source
$npm = (Get-Command npm).Source
$ffmpeg = (Get-Command ffmpeg).Source
$ffprobe = (Get-Command ffprobe).Source
$envFile = Join-Path $repo ".env"
$envExample = Join-Path $repo ".env.example"
$nodeModules = Join-Path $repo "node_modules"

Show-Check "Node" ([bool]$node) ($(if ($node) { (& node --version) } else { "node not found on PATH" }))
Show-Check "npm" ([bool]$npm) ($(if ($npm) { (& npm --version) } else { "npm not found on PATH" }))
Show-Check "ffmpeg" ([bool]$ffmpeg) ($(if ($ffmpeg) { $ffmpeg } else { "required for clip generation" }))
Show-Check "ffprobe" ([bool]$ffprobe) ($(if ($ffprobe) { $ffprobe } else { "required for media inspection" }))
Show-Check ".env.example" (Test-Path $envExample) "tracked environment template"
Show-Check ".env" (Test-Path $envFile) ($(if (Test-Path $envFile) { "present" } else { "copy .env.example to .env and fill local secrets" }))
Show-Check "node_modules" (Test-Path $nodeModules) ($(if (Test-Path $nodeModules) { "dependencies installed" } else { "run npm install" }))

Write-Host ""
Write-Host "Bootstrap check complete. No packages, media tools, or secrets were installed or modified."
