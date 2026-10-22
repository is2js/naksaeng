[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 4173,
  [switch]$NoBrowser,
  [switch]$WithUnitTests
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$previewRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot ("bunfirvil-committed-preview-" + [Guid]::NewGuid().ToString('N'))))
$archivePath = Join-Path $previewRoot 'head.zip'
$checkoutPath = Join-Path $previewRoot 'checkout'

try {
  New-Item -ItemType Directory -Path $previewRoot, $checkoutPath | Out-Null
  Push-Location $repoRoot
  try {
    & git archive --format=zip --output=$archivePath HEAD
    if ($LASTEXITCODE -ne 0) { throw 'git archive HEAD 실행에 실패했습니다.' }
  } finally {
    Pop-Location
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $checkoutPath
  Push-Location $checkoutPath
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci 실행에 실패했습니다.' }
    if ($WithUnitTests) {
      & npm run test:unit
      if ($LASTEXITCODE -ne 0) { throw '단위 테스트에 실패했습니다.' }
    }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'production build에 실패했습니다.' }
    & npm run verify:dist
    if ($LASTEXITCODE -ne 0) { throw '배포 산출물 검증에 실패했습니다.' }

    $previewUrl = "http://127.0.0.1:$Port/naksaeng/"
    Write-Host "커밋 미리보기: $previewUrl" -ForegroundColor Cyan
    Write-Host "A1 놀이터: http://127.0.0.1:$Port/naksaeng/bunfirvil/" -ForegroundColor Cyan
    if (-not $NoBrowser) { Start-Process $previewUrl }
    & npm run preview -- --host 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'Vite preview 실행에 실패했습니다.' }
  } finally {
    Pop-Location
  }
} finally {
  $safePreviewRoot = $previewRoot.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) `
    -and (Split-Path -Leaf $previewRoot).StartsWith('bunfirvil-committed-preview-', [StringComparison]::Ordinal)
  if ($safePreviewRoot -and (Test-Path -LiteralPath $previewRoot)) {
    Remove-Item -LiteralPath $previewRoot -Recurse -Force
  }
}
