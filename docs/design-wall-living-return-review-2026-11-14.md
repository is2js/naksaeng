# 거실·식당 노출면 디자인 월 보정

## 판단 근거와 한계

- 분당퍼스트빌리지 공식 공고 8쪽의 범위는 `거실/복도면(기본 제공 및 냉장고면 제외)`다. 주방과 가까운 모든 벽을 제외한다는 뜻으로 확대하지 않는다.
  - 원본: https://www.elife.co.kr/jsp/front/po/210114/static/pdf/210114_notice_260702.pdf
  - 기존 공개 보관본: `public/documents/sale-notice-20260702.pdf`
- 비교 사례인 e편한세상 대장 퍼스티움 A-6블록 공식 공고 8쪽은 `거실 창호면+아트월 맞은편+침실면 복도`를 디자인 월 범위로 명시한다. TV벽 외의 공용면에도 연속 적용하는 사례다.
  - LH 원본: https://apply.lh.or.kr/lhapply/lhFile.do?fileid=61611882
  - LH 공고: https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?aisTpCd=39&ccrCnntSysDsCd=02&mi=1027&panId=0000060867&uppAisTpCd=39
- 분퍼빌 55A 공식 마감재리스트 6쪽은 디자인월 A042 LILT GRAY의 실명을 `복도/거실/주방`으로 명시한다. 8쪽은 상판 뒤 주방 벽을 별도 마감 항목으로 구분한다. 주방에 속한다는 이유만으로 모든 노출면을 제외하지 않는다.
  - 원본: https://www.elife.co.kr/jsp/front/po/210114/static/pdf/210114_finishlist_55A.pdf
- 두 공고의 해당 페이지 전체를 렌더링해 표와 각주를 확인했다. 타 단지 자료는 보조 사례이며 분퍼빌의 상세 시공 범위 확정 자료는 아니다.
- 이번 반영은 공고문 문구와 기존 평면 geometry를 결합한 **가상 공간의 마감 범위 추론**이다. 실제 계약·시공 범위는 시공사 상세도와 전시관을 확인해야 한다.

## 보정한 실제 벽면

55A 남서향 화면에서 표시된 긴 벽은 욕실1의 반대편으로, 냉장고 설치면이 아닌 거실·식당 공용 공간에 노출된 면이다. 동일 구조의 51A·59A도 함께 보정했다.

| 평형 | 원본 wall segment | 공용면 방향 (원본 로컬) | 변경 |
|---|---|---|---|
| 51A | `bathroom-1-west` + `utility-kitchen-west-before/lintel/after` | -X | 유상 마감 추가 |
| 55A | `bathroom-1-east` + `utility-kitchen-east-before/lintel/after` | +X | 유상 마감 추가 |
| 55B | `bathroom-1-south` (기존) / `utility-kitchen-east-lintel` (추가) | +Y / +X | 긴 면은 유지, 연속 문 상인방만 추가 |
| 59A | `bathroom-1-east` + `utility-kitchen-east-before/lintel/after` | +X | 유상 마감 추가 |

- 51A·55A·59A의 새 긴 벽면은 각 길이 2.6m, 높이 2.3m이며 출입구가 없는 실제 벽 조각이다. 이어지는 다용도실 문 주변은 별도의 분할 조각이다.
- 표시 범위 끝의 다용도실 문 주변도 같은 선상의 노출면이고 냉장고·상판 설치면이 아니므로 연속 마감한다. 문 개구부를 메우지 않고 기존 `before/lintel/after` 조각만 사용하며, 상인방은 실제 높이부터 배치한다. 상세 시공 종료선은 미확정이므로 이 연장도 시각화 추론에 포함된다.
- 냉장고 설치면, 상판 뒤 백스플래시, 욕실·침실 내부면과 개구부는 추가하지 않았다. 원본 벽 전체를 양면 마감하지 않고 공용면 방향으로만 20mm 마감을 배치한다.
- 기본 제공 TV벽, 가격, 옵션 ID, 마이너스 옵션 규칙은 유지한다. 새 면은 디자인 월 선택 시에만 나타나고 해제하면 제거된다.
- 기존 단일 variant transform을 재사용한다. 생성 snapshot·원본 geometry·충돌·보행·레이저 실측·가구 배치 데이터는 변경하지 않는다. 마감은 고정된 visual-only이며 기존 벽 가림 그룹에 속한다.

## 최소 검증

- 관련 옵션 배치 단위 테스트에서 전체 12개 평면의 선택/해제/마이너스, 정확한 로컬 위치와 변환된 전면 방향, 제외면 및 원본 geometry 보존을 검사한다.
- production build와 배포 자산 검사를 실행한다.
- 55A-A 동일 카메라 전/후, 51A·59A 대응 면, 390px 모바일 화면을 실제 Chromium 렌더링으로 확인한다. 임시 스크린샷과 외부 연구 PDF는 공개 자산에 추가하지 않는다.

실행 결과: 관련 파일 29개 테스트, production build, `verify:dist`가 통과했다. 실제 렌더링에서 새 면의 선택·해제·재선택 복원, 문 개구부 유지와 원본 geometry 불변을 확인했다. 스크린샷은 로컬 `tmp/design-wall-return-review/`에 보관한다.
