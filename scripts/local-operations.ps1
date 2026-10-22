[CmdletBinding()]
param(
  [ValidateSet('Dev', 'Validate', 'PreviewCommit')]
  [string]$Mode = 'Dev',
  [ValidateRange(1024, 65534)]
  [int]$Port = 5174,
  [switch]$NoBrowser,
  [switch]$WithUnitTests
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory)]
    [string]$FailureMessage,
    [Parameter(Mandatory)]
    [scriptblock]$Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

Push-Location $repoRoot
try {
  switch ($Mode) {
    'Dev' {
      $devUrl = "http://127.0.0.1:$Port/naksaeng/"
      Write-Host "작업 트리 개발 서버: $devUrl" -ForegroundColor Cyan
      Write-Host "A1 놀이터: http://127.0.0.1:$Port/naksaeng/bunfirvil/" -ForegroundColor Cyan
      if (-not $NoBrowser) {
        Start-Process $devUrl
      }
      Invoke-CheckedCommand 'Vite 개발 서버 실행에 실패했습니다.' {
        & npm run dev -- --port $Port
      }
    }
    'Validate' {
      Write-Host '단위 테스트, production build와 배포 산출물을 확인합니다.' -ForegroundColor Cyan
      Invoke-CheckedCommand '단위 테스트에 실패했습니다.' { & npm run test:unit }
      Invoke-CheckedCommand 'production build에 실패했습니다.' { & npm run build }
      Invoke-CheckedCommand '배포 산출물 검증에 실패했습니다.' { & npm run verify:dist }
      Write-Host '로컬 배포 전 검사가 완료되었습니다.' -ForegroundColor Green
    }
    'PreviewCommit' {
      $previewPort = if ($PSBoundParameters.ContainsKey('Port')) { $Port } else { 4173 }
      $arguments = @(
        '-NoProfile',
        '-File',
        (Join-Path $PSScriptRoot 'preview-committed-pages.ps1'),
        '-Port',
        $previewPort
      )
      if ($NoBrowser) { $arguments += '-NoBrowser' }
      if ($WithUnitTests) { $arguments += '-WithUnitTests' }

      & pwsh @arguments
      if ($LASTEXITCODE -ne 0) {
        throw '커밋 기준 Pages 미리보기에 실패했습니다.'
      }
    }
  }
} finally {
  Pop-Location
}
