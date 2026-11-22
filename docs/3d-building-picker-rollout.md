# A1 동 선택 3D 교체와 복구

기존 위저드의 첫 동 선택 영역에서만 3D 모형을 제안한다. 지도나 오른쪽의 작은 동 목록에서 선택한 다음, 모형 위의 `NNN동 세대 선택`을 눌러 기존 세대 화면으로 간다. 모바일에서 3D가 준비되면 별도 번호 목록을 숨긴다. 공유 열람 인증의 동 선택과 세대·닉네임 단계는 기존과 같다.

- 즉시 카드로 들어가는 주소: [기존 카드로 동 선택](https://is2js.github.io/naksaeng/bunfirvil/?buildingPicker=cards). 쿼리가 있는 동안 3D 모듈을 요청하지 않으며 저장·인증 규칙은 그대로다. WebGL/WASM 또는 모델 로드가 실패하면 자동으로 같은 카드로 돌아간다.
- 서버/저장 키, 세대 카탈로그, 정적 경로는 변경하지 않는다. `#building=105`처럼 유효한 세대 단계 딥링크는 3D를 로드하지 않는다.
- 교체 전 운영 소스: [GitHub 백업 태그](https://github.com/is2js/naksaeng/tree/bunfirvil-before-3d-picker-2026-11-23), 커밋 `178946d73c6850f45f2fc77c3960ab6618b24941`. 이 버전을 올린 [Pages 실행 기록](https://github.com/is2js/naksaeng/actions/runs/44443101467)도 보존되어 있다.
- 제품 기본값 전체를 복구하려면 GitHub에서 이번 3D 동 선택 커밋을 찾아 `git revert <3D 도입 커밋>`의 새 커밋으로 되돌리고 `main`을 푸시한다. 이후 커밋을 삭제하는 reset/강제 푸시는 필요 없다. Pages 성공 후 일반 루트의 카드, 직접 링크, 모바일 세대 선택을 확인한다.

## 공개 자산

공개 파일은 로컬에서 자체 제작한 `src/site-preview/assets/bunfirvil-site-v9.glb` 한 벌(731,620바이트, 49,227 삼각형)과 Three.js의 로컬 WASM 디코더다. 첨부 단지배치도와 모형 사진은 배치의 참고이며 PDF·사진 원본·Blender 편집 원본·로컬 시안 페이지는 배포하지 않는다. 장면은 시공 치수나 정확한 고도를 보장하지 않는다. `scripts/verify-dist.mjs`가 승인된 GLB 해시, 단지 모형/디코더 1.2 MiB, 나머지 앱 50 MiB, 전체 100 MiB 한도를 확인한다.
