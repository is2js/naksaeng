---
id: local-committed-preview-admin
title: 로컬 운영·배포 전 확인
shortTitle: 로컬 운영
category: 운영자
summary: 개발 서버, 배포 전 검사와 현재 HEAD 기준 Pages 미리보기를 PowerShell로 실행하는 방법입니다.
updatedAt: 2026-10-22
order: 95
operatorOnly: true
---

# 로컬 운영·배포 전 확인

> 이 문서는 운영자 인증 세션에서만 가이드 목록에 표시됩니다. 작업 중 빠른 확인과 **마지막 로컬 커밋(HEAD)** 기준 Pages 배포 전 확인을 구분합니다.

## 1. 작업 중 개발 서버

PowerShell에서 저장소 루트로 이동한 뒤 실행합니다.

```powershell
npm run local:dev
```

현재 작업 트리의 낙생지구 포털을 `http://127.0.0.1:5174/naksaeng/`에 띄웁니다. A1 놀이터는 같은 서버의 `/naksaeng/bunfirvil/`에서 확인합니다. 저장할 때 즉시 반영되므로 구현 중 확인에 사용합니다. 종료하려면 터미널에서 `Ctrl+C`를 누르세요.

포털 서버는 지정한 포트, A1 내부 서버는 그다음 포트를 사용합니다. 기본 5174·5175를 함께 비워 두고, `-Port 5180`이면 5180·5181을 사용합니다. 외부에 공개하지 않는 로컬 서버입니다.

```powershell
pwsh -NoProfile -File scripts/local-operations.ps1 -Mode Dev -Port 5180 -NoBrowser
```

## 2. 배포 전 정적 검사

```powershell
npm run local:check
```

단위 테스트, production build와 `verify:dist`를 순서대로 실행합니다. 실패가 하나라도 있으면 배포하지 말고 먼저 수정합니다.

## 3. 마지막 커밋을 Pages처럼 확인

변경사항을 커밋한 뒤 실행합니다.

```powershell
npm run local:pages
```

스크립트는 `git archive HEAD`로 임시 복사본을 만들고, 그 안에서 `npm ci`, production build, `verify:dist`, Vite preview를 순서대로 실행합니다. 브라우저는 `http://127.0.0.1:4173/naksaeng/`로 열립니다. A1 놀이터 `/naksaeng/bunfirvil/`와 하위 가이드·계산기도 같은 서버에서 확인합니다. 커밋되지 않은 변경은 포함하지 않습니다. 종료하면 임시 디렉터리를 정리합니다.

## 선택 인자

```powershell
pwsh -NoProfile -File scripts/local-operations.ps1 -Mode PreviewCommit -Port 5180 -NoBrowser
pwsh -NoProfile -File scripts/local-operations.ps1 -Mode PreviewCommit -WithUnitTests
```

- `-Port`: 미리보기 포트를 변경합니다.
- `-NoBrowser`: 브라우저를 자동으로 열지 않습니다.
- `-WithUnitTests`: 빌드 전에 단위 테스트 전체를 실행합니다.

기존 `npm run preview:commit`과 `scripts/preview-committed-pages.ps1` 직접 실행도 계속 지원합니다.

## 확인 범위

- 커밋되지 않은 파일은 임시 복사본에 들어가지 않습니다.
- 포털 `/naksaeng/`와 A1 `/naksaeng/bunfirvil/` 하위 경로를 실제 Pages와 같은 기준으로 확인합니다.
- 포털을 먼저, 앱을 다음에 빌드하여 하나의 `dist`를 만듭니다. 전체 크기 50MiB와 A1의 기존 정적 산출물 계약을 함께 검사합니다.
- Google Apps Script는 별도 서비스입니다. `backend/apps-script/Code.gs` 변경은 Apps Script 편집기에 반영하고 새 웹앱 버전으로 재배포해야 합니다.
- 이 절차는 로컬 확인만 수행하며 GitHub에 push하거나 Pages를 배포하지 않습니다.

## 권장 배포 순서

1. `npm run local:dev`로 작업 중 기능을 확인합니다.
2. `npm run local:check`가 성공한 뒤 변경사항을 커밋합니다.
3. `npm run local:pages`로 커밋된 산출물을 실제 Pages 경로에서 확인합니다.
4. Apps Script 변경이 있다면 Google 웹앱을 먼저 새 버전으로 배포합니다.
5. 정본 저장소 `is2js/naksaeng`의 `main`을 push하고 GitHub Actions의 Pages workflow가 성공했는지 확인합니다.
6. 공개 루트, 가이드, 기존 딥링크를 한 번씩 확인합니다.

기존 `is2js/bunfirvil`은 호환 주소 전용입니다. 새 사이트가 정상 배포되기 전에 기존 진입 페이지를 바꾸지 마세요. 기존 자산은 이미 열려 있는 탭의 로딩을 위해 유지합니다. 롤백은 문제가 된 배포 커밋을 revert하는 방식으로 처리합니다.
