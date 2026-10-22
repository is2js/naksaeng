import "./style.css";
import { DISTRICT_BLOCKS } from "./blocks";

const mount = document.querySelector<HTMLElement>("#district-app");
if (!mount) throw new Error("Missing district mount point");
const districtBase = import.meta.env.BASE_URL;
const districtUrl = (path: string) => `${districtBase}${path}`;

mount.innerHTML = `
  <header class="district-topbar">
    <a class="district-brand" href="${districtBase}" aria-label="낙생지구 홈">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span><b>낙생지구</b><small>돌아온범생의 놀이터 개발 연구실</small></span>
    </a>
    <a class="header-entry" href="${districtUrl("bunfirvil/")}">A1 놀이터 <span aria-hidden="true">↗</span></a>
  </header>
  <main id="district-main" class="district-main">
    <section class="district-intro" aria-labelledby="district-title">
      <p class="eyebrow">NAKSAENG · SEONGNAM</p>
      <h1 id="district-title">낙생지구</h1>
      <p class="district-subtitle">성남낙생 공공주택지구</p>
      <p class="district-description">우리 집을 미리 둘러보고,<br class="mobile-break" /> 입주와 자금 계획을 한곳에서.</p>
      <div class="district-location"><span aria-hidden="true">⌖</span> 성남시 분당구 동원동 일원</div>
    </section>
    <section class="district-blocks" aria-labelledby="block-title">
      <div class="section-heading"><div><p class="eyebrow">BLOCKS</p><h2 id="block-title">단지를 선택해 주세요</h2></div><span>단지별 서비스</span></div>
      <div class="block-grid">
        ${DISTRICT_BLOCKS.map((block) => block.status === "available" && block.path ? `
          <a class="block-card is-available" data-block-id="${block.id}" href="${districtUrl(block.path)}" aria-label="${block.id} · ${block.name} 놀이터 입장">
            <div class="block-art"><img src="${districtUrl("bunfirvil/og-playground-v3.jpg")}" alt="아파트 평면과 캐릭터를 형상화한 분당퍼스트빌리지 가상 놀이터" width="1200" height="630" fetchpriority="high" /><span class="status-tag">이용 가능</span></div>
            <div class="block-body"><span class="block-id">${block.id}</span><h3>${block.name}</h3><p>평면도 기반 가상 놀이터에서 옵션과 가구를 살펴보고, 분양가와 납부 일정을 계획해 보세요.</p><ul class="feature-tags"><li>가상 놀이터</li><li>옵션·가구 배치</li><li>자금 계획</li></ul><div class="block-action">놀이터 입장 <span aria-hidden="true">→</span></div></div>
          </a>` : `
          <article class="block-card is-planned" data-block-id="${block.id}" aria-label="${block.id} 서비스 준비 중">
            <div class="planned-art" aria-hidden="true"><span class="planned-grid"></span><span class="planned-block">${block.id}</span></div>
            <div class="block-body"><span class="block-id">${block.id}</span><h3>${block.name}</h3><p>새로운 단지 서비스가 준비되면<br />이곳에서 안내해 드립니다.</p><div class="block-action is-disabled">준비 중 <span aria-hidden="true">···</span></div></div>
          </article>`).join("")}
      </div>
    </section>
    <aside class="district-note" role="note"><span aria-hidden="true">ⓘ</span><div><b>입주 준비를 위한 비공식 참고 공간입니다.</b><p>평면도·사이버주택전시관을 바탕으로 추론한 가상 공간이며 실제 주택과 다를 수 있습니다. 계약·공급 조건은 공식 공고문을 우선 확인해 주세요.</p></div></aside>
  </main>
  <footer class="district-footer"><span>NAKSAENG · 돌아온범생의 놀이터</span><a href="https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?aisTpCd=01&ccrCnntSysDsCd=01&mi=1062&panId=BN-0008050&uppAisTpCd=01" target="_blank" rel="noreferrer">LH 성남낙생 지구 공고 <span aria-hidden="true">↗</span></a></footer>
`;
