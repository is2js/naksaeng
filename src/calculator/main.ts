import './style.css';
import { loadCatalog } from '../game/catalog';
import { readHouseholdVerificationSession } from '../game/household-verification';
import { BUNDANG_MINUS_OPTION_ID } from '../game/minus-option';
import { BUNDANG_SALE_FINANCE_CATALOG_V1, BUNDANG_INTERIM_LOAN_ASSUMED_MOVE_IN_DATE, calculateBundangInterimLoanInterest, calculateBundangSaleFinance, type BundangInterimLoanInterestQuoteV1, type BundangMortgageChildCount, type BundangPaymentPlanKind, type BundangSaleFloorBand, type BundangSaleUnitType } from '../game/bundang-sale-finance';
import { BUNDANG_EXECUTED_CONTRACT_REVIEW_V1, BUNDANG_PAYMENT_ITEM_LABELS, contractSupplyBalanceBreakdown } from '../game/bundang-executed-contract';
import { calculateBundangMoveInSettlement } from '../game/bundang-move-in-finance';
import { buildBundangFinancingTimeline, type BundangFinancingTimelineRowV1 } from '../game/bundang-financing-timeline';
import { buildBundangPaymentStageGroups, type BundangPaymentStageGroupV1 } from '../game/bundang-payment-stage-groups';
import { calculateBundangMortgageSettlement, type BundangMortgageSettlementKind } from '../game/bundang-mortgage-settlement';
import { countdownForDeadline, paymentDeadlineForDue, recommendedPaymentDue, seoulDateKey } from '../game/bundang-payment-timeline';
import { clearSaleCalculatorContext, readSaleCalculatorLaunchContext, type SaleCalculatorContextV1 } from '../game/sale-calculator-context';
import { resolveSaleCalculatorOptionLines, type SaleCalculatorOptionLineV1 } from '../game/sale-calculator-options';
import { hasOperatorAccess } from '../shared/operator-access';
import { readSaleCalculatorPreferences, writeSaleCalculatorPreferences } from '../game/sale-calculator-preferences';

type FundedScheduleRow = BundangPaymentStageGroupV1;
type TaxReliefMode = 'none' | 'first-home' | 'birth-care';
type Quote = {
  baseSupply: number; adjustedSupply: number; baseBalcony: number; selectedOptions: number;
  minusSupply: number; minusBalcony: number; minusDiscount: number; contractTotal: number;
  schedule: FundedScheduleRow[]; optionLines: SaleCalculatorOptionLineV1[]; interimLoan: BundangInterimLoanInterestQuoteV1;
  moveIn: ReturnType<typeof calculateBundangMoveInSettlement>;
  tax?: { taxable: number; ratePercent: number; relief: number; acquisition: number; education: number; rural: number; total: number };
  mortgage?: { principal: number; eligibleMaximum: number; moveInCash: number; graceInterest: number;
    repayment: number; ltvPercent: number; annualRatePercent: number; repaymentMonths: number; loanBase: number;
    settlement: ReturnType<typeof calculateBundangMortgageSettlement> };
};
const COST_ITEMS = [
  ['stamp', '인지세 등 미납 계약비', '주택 계약 인지세와 대출 인지세는 별개입니다. 모기지 인지세 고객 50% 등 실제 분담액을 확인하고 기납부액은 제외하세요.'],
  ['bond', '국민주택채권 할인손실', '시가표준액·지분·지역·당일 할인율로 별도 확인합니다.'],
  ['registration', '등기·법무사 비용', '등기 수수료·법무사 보수 등 실제 견적을 입력합니다.'],
  ['guarantee', '대출 보증·담보 비용', '은행의 보증료·근저당 등 부담 항목을 확인합니다.'],
  ['management', '관리비 예치금', '입주 안내에서 정한 예치금이며 소모 비용과 구분합니다.'],
  ['moving', '이사·추가 공사 예산', '마이너스 옵션 후 개별 시공비는 여기에 따로 반영합니다.'],
] as const;
type CostId = typeof COST_ITEMS[number][0];
const FINANCE_REVIEWED_AT = BUNDANG_EXECUTED_CONTRACT_REVIEW_V1.reviewedAt.replaceAll('-', '.');
const SALE_NOTICE_URL = 'https://www.elife.co.kr/jsp/front/po/210114/static/pdf/210114_notice_260702.pdf';
const CONTRACT_NOTICE_URL = 'https://www.elife.co.kr/jsp/front/po/210114/static/pdf/210114_notice_01_261028.pdf';
const STAMP_NOTICE_URL = 'https://www.elife.co.kr/jsp/front/po/210114/static/pdf/210114_notice_02_261027.pdf';
const MORTGAGE_SOURCE = 'https://obank.kbstar.com/quics?cc=b032425%3Ab033525&isNew=N&page=C020709&prcode=LN40001026';
const MORTGAGE_CONTRACT = 'https://img2.kbstar.com/obj/ocommon/251201_Contract_6.pdf';

const moneyFormat = new Intl.NumberFormat('ko-KR');
const money = (value: number) => `${moneyFormat.format(value)}원`;
const escape = (value: string) => value.replace(/[&<>'"]/g, (key) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[key] ?? key));
const floorLabel = (floor: BundangSaleFloorBand) => floor === 5 ? '5층 이상' : `${floor}층`;
const toFloor = (band: SaleCalculatorContextV1['priceFloorBand']): BundangSaleFloorBand => band === '5+' ? 5 : Number(band) as BundangSaleFloorBand;

// Reconcile result text without replacing controls. In particular, a blur/change
// must not detach the button between pointerdown and click or reset Tab focus.
function reconcileChildren(current: Node, desired: Node): void {
  const key = (node: Node): string => {
    if (!(node instanceof Element)) return '';
    return node.id || (node instanceof HTMLInputElement && node.name ? `${node.name}:${node.value}` : '')
      || node.getAttribute('data-finance-due') || '';
  };
  const compatible = (left: Node, right: Node) => left.nodeType === right.nodeType
    && (!(left instanceof Element) || (right instanceof Element && left.tagName === right.tagName && key(left) === key(right)));
  const desiredChildren = [...desired.childNodes];
  desiredChildren.forEach((next, index) => {
    let node = current.childNodes[index];
    if (!node || !compatible(node, next)) {
      const matching = key(next) ? [...current.childNodes].slice(index + 1).find(candidate => compatible(candidate, next)) : undefined;
      if (matching) { current.insertBefore(matching, node ?? null); node = matching; }
      else { current.insertBefore(next.cloneNode(true), node ?? null); return; }
    }
    if (node instanceof Element && next instanceof Element) {
      const preservedValue = node instanceof HTMLInputElement
        && (document.activeElement === node || node.getAttribute('aria-invalid') === 'true') ? node.value : undefined;
      for (const attribute of [...node.attributes]) {
        if (attribute.name === 'open' && node instanceof HTMLDetailsElement) continue;
        if (!next.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
      }
      for (const attribute of [...next.attributes]) {
        if (attribute.name === 'open' && node instanceof HTMLDetailsElement) continue;
        if (node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name, attribute.value);
      }
      if (node instanceof HTMLInputElement && next instanceof HTMLInputElement) {
        node.checked = next.checked;
        if (preservedValue !== undefined) node.value = preservedValue;
        else if (node.value !== next.value) node.value = next.value;
      }
      reconcileChildren(node, next);
      if (node instanceof HTMLSelectElement && next instanceof HTMLSelectElement) node.value = next.value;
    } else if (node.nodeValue !== next.nodeValue) node.nodeValue = next.nodeValue;
  });
  while (current.childNodes.length > desiredChildren.length) current.lastChild!.remove();
}

const paymentStageId = (due: string) => `calculator-payment-stage-${paymentDeadlineForDue(due).id}`;

class CalculatorApp {
  private readonly context = readSaleCalculatorLaunchContext();
  private readonly verification = readHouseholdVerificationSession();
  private options: SaleCalculatorOptionLineV1[] = [];
  private plan: BundangPaymentPlanKind;
  private taxEnabled = false;
  private taxReliefMode: TaxReliefMode = 'none';
  private interimRatePercent = 4;
  private mortgageEnabled = true;
  private ltv: 30 | 40 | 50 | 60 | 70 = 70;
  private term: 20 | 30 = 30;
  private childCount: BundangMortgageChildCount = 0;
  private holdingYears = 24;
  private interimFunding: 'cash' | 'loan' = 'loan';
  private assumedMoveInDate = BUNDANG_INTERIM_LOAN_ASSUMED_MOVE_IN_DATE;
  private costsEnabled = false;
  private costs: Record<CostId, number> = { stamp: 0, bond: 0, registration: 0, guarantee: 0, management: 0, moving: 0 };
  private salePriceWon: number | null = null;
  private settlementKind: BundangMortgageSettlementKind = 'sale';
  private appraisedPriceWon: number | null = null;
  private salePlanNotified = true;
  private restorePrintState: (() => void) | null = null;
  private paymentGuideDue: string | null = null;
  private paymentGuideOpener: HTMLElement | null = null;
  private readonly paymentGuideOrigins: { node: HTMLElement; placeholder: Comment }[] = [];
  private scheduleRows: FundedScheduleRow[] = [];
  // undefined follows the calendar; null means the user deliberately folded all stages.
  private selectedPaymentDue: string | null | undefined;
  private countdownTimer: number | undefined;
  private bound = false;
  private readonly pendingInputs = new Set<string>();
  private readonly inputErrors = new Map<string, string>();

  constructor(private readonly mount: HTMLElement) {
    this.plan = this.context?.applicantRoute ?? 'main-subscription';
    if (this.context) Object.assign(this, readSaleCalculatorPreferences({ unitType: this.context.unitType, floorBand: this.context.priceFloorBand }) ?? {});
    // Older session preferences may contain the former optional-off state.
    this.mortgageEnabled = true;
    window.addEventListener('beforeprint', () => this.preparePrint());
    window.addEventListener('afterprint', () => { this.restorePrintState?.(); this.restorePrintState = null; this.refreshCountdowns(); });
    document.addEventListener('visibilitychange', this.scheduleCountdownRefresh);
    window.addEventListener('pageshow', this.scheduleCountdownRefresh);
    window.addEventListener('pagehide', () => window.clearTimeout(this.countdownTimer));
  }
  private get ready(): boolean { return Boolean(this.context && this.verification); }
  private get unitType(): BundangSaleUnitType { return this.context!.unitType as BundangSaleUnitType; }
  private get floor(): BundangSaleFloorBand { return toFloor(this.context!.priceFloorBand); }
  private get minus(): boolean { return (this.context!.optionIds ?? []).includes(BUNDANG_MINUS_OPTION_ID); }

  async start(): Promise<void> {
    if (!this.ready) { this.renderRecovery(); return; }
    const { catalog, fallback } = await loadCatalog();
    if (fallback) {
      this.renderRecovery('공식 옵션 가격 카탈로그를 불러오지 못해 계산을 중단했습니다. 잠시 후 쇼케이스에서 다시 시도해 주세요.');
      return;
    }
    this.options = resolveSaleCalculatorOptionLines(catalog.bOptions, this.context!.optionIds ?? [], this.unitType);
    const selectedIds = [...new Set(this.context!.optionIds ?? [])];
    if (!this.minus && (this.options.length !== selectedIds.length || this.options.some((line) => !selectedIds.includes(line.id)))) {
      clearSaleCalculatorContext();
      this.renderRecovery('선택 옵션 일부를 공식 가격 카탈로그에서 확인하지 못해 계산을 중단했습니다. 쇼케이스에서 옵션을 다시 선택해 주세요.');
      return;
    }
    this.render();
    this.scheduleCountdownRefresh();
  }

  private calculate(): Quote {
    const taxRelief = this.taxReliefMode === 'first-home' ? 2_000_000 : this.taxReliefMode === 'birth-care' ? 5_000_000 : 0;
    const result = calculateBundangSaleFinance({
      household: { unitType: this.unitType, floorBand: this.floor }, paymentPlanKind: this.plan,
      includeBalconyExtension: true, selectMinusOption: this.minus, optionLines: this.options,
      acquisitionTax: { manualReliefWon: this.taxEnabled ? taxRelief : 0 },
      mortgage: this.mortgageEnabled ? { termYears: this.term, ltvBps: this.ltv * 100 } : undefined,
    });
    const interimLoan = calculateBundangInterimLoanInterest({
      adjustedSupplyPriceWon: result.adjustedSupplyPriceWon, paymentPlanKind: this.plan,
      annualRateBps: Math.round(this.interimRatePercent * 100), assumedMoveInDate: this.assumedMoveInDate,
    });
    const moveIn = calculateBundangMoveInSettlement({
      paymentSchedules: result.paymentSchedules, interimFunding: this.interimFunding,
      interimInterestWon: this.interimFunding === 'loan' ? interimLoan.totalInterestWon : 0,
      mortgagePrincipalWon: result.mortgage?.principalWon ?? 0,
      acquisitionTaxWon: this.taxEnabled ? result.acquisitionTax.totalTaxWon : 0,
      additionalCosts: this.costsEnabled ? COST_ITEMS.map(([id]) => ({ id, amountWon: this.costs[id] })) : [],
    });
    const financing = buildBundangFinancingTimeline({
      paymentSchedules: result.paymentSchedules, interimFunding: this.interimFunding,
      deferredInterestWon: moveIn.deferredInterestWon, mortgageAppliedWon: moveIn.mortgageAppliedWon,
    });
    const schedule = buildBundangPaymentStageGroups({
      paymentSchedules: result.paymentSchedules, financingRows: financing.rows, paymentPlanKind: this.plan,
    });
    return {
      baseSupply: result.baseSupplyPriceWon, adjustedSupply: result.adjustedSupplyPriceWon, baseBalcony: result.baseBalconyExtensionWon,
      selectedOptions: result.optionIiSubtotalWon + result.optionIiiSubtotalWon,
      minusSupply: result.minusSupplyDiscountWon, minusBalcony: result.minusBalconyDiscountWon,
      minusDiscount: result.minusSupplyDiscountWon + result.minusBalconyDiscountWon,
      contractTotal: result.contractTotalWon, schedule, optionLines: this.options,
      interimLoan, moveIn,
      ...(this.taxEnabled ? { tax: {
        taxable: result.acquisitionTax.taxableAmountWon, ratePercent: result.acquisitionTax.acquisitionTaxRatePercent,
        relief: result.acquisitionTax.manualReliefWon, acquisition: result.acquisitionTax.acquisitionTaxWon,
        education: result.acquisitionTax.localEducationTaxWon, rural: result.acquisitionTax.ruralSpecialTaxWon,
        total: result.acquisitionTax.totalTaxWon,
      } } : {}),
      ...(this.mortgageEnabled && result.mortgage ? { mortgage: {
        principal: result.mortgage.principalWon, eligibleMaximum: result.mortgage.eligibleMaximumWon,
        moveInCash: moveIn.requiredCashAtMoveInWon, graceInterest: result.mortgage.graceMonthlyInterestWon,
        repayment: result.mortgage.repaymentMonthlyPrincipalInterestWon, ltvPercent: result.mortgage.ltvBps / 100,
        annualRatePercent: result.mortgage.annualRateBps / 100, repaymentMonths: result.mortgage.repaymentMonths,
        loanBase: result.mortgage.loanBaseWon,
        settlement: calculateBundangMortgageSettlement({
          loanBaseWon: result.mortgage.loanBaseWon, principalWon: result.mortgage.principalWon,
          annualRateBps: result.mortgage.annualRateBps, termYears: this.term, holdingYears: this.holdingYears,
          childCount: this.childCount, salePriceWon: this.salePriceWon ?? result.mortgage.loanBaseWon,
          // Keep the general mortgage estimate available while a repayment
          // scenario waits for its required appraisal. resaleDetails hides it.
          settlementKind: this.settlementKind === 'repayment' && this.appraisedPriceWon === null ? 'sale' : this.settlementKind,
          ...(this.appraisedPriceWon === null ? {} : { appraisedPriceWon: this.appraisedPriceWon }),
          salePlanNotified: this.salePlanNotified,
        }),
      } } : {}),
    };
  }

  private renderRecovery(message = '이 계산기는 인증된 쇼케이스 선택과 계산기 실행 컨텍스트가 있어야 열립니다. 개인정보나 동·호 정보는 이 화면에 표시하지 않습니다.'): void {
    this.mount.innerHTML = `<main class="recovery-shell"><section class="recovery-card"><p class="eyebrow">SALE CALCULATOR / ACCESS REQUIRED</p><h1>계산 정보를 복구할 수 없습니다.</h1><p>${escape(message)}</p><a id="calculator-reselect-household" class="primary-link" href="../">세대 다시 선택</a><a class="muted-link" href="../guides/">공개 가이드 보기</a></section></main>`;
  }

  private render(): void {
    const guideDue = this.paymentGuideDue;
    this.closePaymentGuide(false);
    this.mount.querySelectorAll('.input-error').forEach(node => node.remove());
    const disclosureState = new Map([...this.mount.querySelectorAll<HTMLDetailsElement>('details[id]')].map((node) => [node.id, node.open]));
    const quote = this.calculate();
    this.scheduleRows = quote.schedule;
    const planName = this.plan === 'main-subscription' ? '본청약 기준' : '사전청약 당첨자 기준';
    const returnUrl = escape(this.context!.returnUrl!);
    const markup = `<div class="calculator-shell">
      <a class="skip-link" href="#calculator-main">계산기 본문으로 건너뛰기</a>
      <section class="print-validation" role="alert"><h1>입력값을 먼저 확인해 주세요.</h1><p>금리·날짜·금액 입력에 오류가 있어 계산 결과를 출력하지 않았습니다. 화면의 오류를 수정한 뒤 다시 인쇄해 주세요.</p></section>
      <header class="topbar"><a class="brand" href="${returnUrl}" aria-label="놀이터로 돌아가기"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span><b>e편한세상 분당퍼스트빌리지</b><small>돌아온범생의 놀이터 개발 연구실</small></span></a><nav class="topnav" aria-label="주 메뉴"><a href="${returnUrl}">놀이터</a><a class="is-active" href="./">자금 계획</a><a href="../guides/">가이드</a>${hasOperatorAccess() ? '<a href="../households/">동·호 현황</a>' : ''}</nav><div id="calculator-context-header" class="build-chip" data-payment-plan="${this.plan}"><i class="status-dot"></i><span><small>${this.unitType} · ${floorLabel(this.floor)} · ${FINANCE_REVIEWED_AT} 검토</small><b>${planName}</b></span></div></header>
      <div class="serverless-banner"><span class="banner-pulse"></span><b>브라우저 계산 도구</b><i></i><span>계산 결과는 참고용이며 공식 공고·계약서가 우선합니다.</span></div>
      <main id="calculator-main" class="calculator-main">
        <nav class="calculator-mobile-jump" aria-label="자금 계획 바로가기"><button type="button" data-calculator-jump="calculator-payments">납부 일정</button><button type="button" data-calculator-jump="calculator-move-in-settlement">입주 정산</button><button type="button" data-calculator-jump="calculator-option-details">옵션</button><button type="button" data-calculator-jump="calculator-tax-details">취득세</button><button type="button" data-calculator-jump="calculator-interim-loan-details">중도금 대출</button><button type="button" data-calculator-jump="calculator-mortgage-details">전용 모기지</button></nav>
        <section class="calculator-hero"><div><p class="eyebrow">BUNFIRVIL / SALE FINANCE</p><h1>내 자금 계획</h1><p><b class="context-highlight">${this.unitType} · ${floorLabel(this.floor)} · ${planName}</b> 쇼케이스 선택을 기준으로 계산합니다. 동·호·닉네임은 계산 데이터에 저장하지 않습니다.</p><fieldset class="plan-switch hero-plan-switch" aria-label="청약 구분"><legend>청약 구분</legend><label><input id="calculator-plan-main" name="payment-plan" value="main-subscription" type="radio" ${this.plan === 'main-subscription' ? 'checked' : ''}><span>본청약(신규신청자)</span></label><label><input id="calculator-plan-pre" name="payment-plan" value="pre-subscription" type="radio" ${this.plan === 'pre-subscription' ? 'checked' : ''}><span>사전청약 당첨자</span></label></fieldset><p class="source-stamp">기준: 입주자모집공고 2026.05.29 · 자금 정보 검토 ${FINANCE_REVIEWED_AT} · 예정 일정은 변경될 수 있습니다.</p></div><aside class="restore-card"><span>선택 옵션 상태</span><strong>${(this.context!.optionIds ?? []).length}개 불러옴</strong><p>평형·층은 인증된 선택값으로 고정됩니다. 옵션·가구는 이 브라우저의 같은 평형에서 공유됩니다.</p><button id="calculator-return-options" data-action="return-to-showcase" type="button">옵션 다시 선택</button></aside></section>
        <section class="quote-layout"><article class="calculator-card result-card"><div class="section-head result-head"><div><p class="eyebrow">CONTRACT</p><h2>최종 계약 예상 총액</h2></div><button id="calculator-print" data-action="print" class="print-button" type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 8V3h10v5M7 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-3M7 13h10v8H7z" /></svg><span>인쇄 · PDF 저장</span></button></div><div class="hero-total"><span>공급가 + 발코니 + 선택 옵션 − 마이너스 감액</span><strong>${money(quote.contractTotal)}</strong><p>세금·대출 추정을 펼쳐 선택하면 입주 예산에 별도로 반영됩니다.</p></div><dl class="contract-breakdown"><div><dt>조정 전 공급가</dt><dd>${money(quote.baseSupply)}</dd></div><div><dt>발코니 확장</dt><dd>${money(quote.baseBalcony)}</dd></div><div><dt>선택 옵션 합계</dt><dd>${money(quote.selectedOptions)}</dd></div><div class="discount"><dt>마이너스 감액</dt><dd>−${money(quote.minusDiscount)}</dd></div></dl><p class="fund-note">${quote.optionLines.some((option) => option.tier === 'option-iii') ? '선택한 추가선택품목 Ⅲ은 아직 계약하지 않은 예정 금액이며 실제 계약 내용에 따라 달라집니다. ' : ''}공고표의 주택도시기금 55,000,000원은 실제 수령액으로 차감하지 않았습니다.</p><div class="payment-block" id="calculator-payments"><div class="subhead"><h3>납부 일정</h3><span>같은 회차에서 확인 · 항목별 별도 납부</span></div>${this.scheduleTable(quote.schedule)}<p class="schedule-note">Ⅰ·Ⅱ·Ⅲ 중도금은 <b>계좌별 현금 납부</b> · Ⅲ의 실제 납부일은 <b>별도 안내</b></p></div>${this.moveInMarkup(quote)}${this.paymentGuideMarkup()}</article><aside class="calculator-side"><details id="calculator-option-details" class="calculator-card disclosure option-card"><summary><span class="summary-title">선택 옵션 <b>${this.minus ? 1 : quote.optionLines.length}개</b></span><span>펼치기</span></summary><div class="disclosure-body">${this.optionMarkup(quote)}</div></details>${this.taxDetails(quote)}${this.interimLoanDetails(quote)}${this.mortgageDetails(quote)}${this.costDetails(quote)}${this.resaleDetails(quote)}<article class="calculator-card source-card"><p class="eyebrow">NOTICE</p><h2>계산 전 확인</h2><p>금액·일정·감면·대출 실행은 공고문, 계약서, 관계기관 심사 결과가 우선합니다.</p><a href="../guides/?guide=sale-finance" class="text-link">입주·자금 계산 가이드 보기 →</a></article></aside></section>
      ${this.paymentGuideDialogMarkup()}</main><footer class="calculator-footer"><span>BUNFIRVIL · STATIC FRONTEND</span><span>개인정보·인증값은 인쇄물과 계산 URL에 포함하지 않습니다.</span></footer></div>`;
    const template = document.createElement('template');
    template.innerHTML = markup;
    reconcileChildren(this.mount, template.content);
    for (const node of this.mount.querySelectorAll<HTMLDetailsElement>('details[id]')) {
      if (!node.classList.contains('payment-stage') && disclosureState.has(node.id)) node.open = disclosureState.get(node.id)!;
    }
    this.refreshCountdowns();
    this.bind();
    this.syncDisclosureLabels();
    this.syncInputErrors();
    if (!this.inputErrors.size) this.persistPreferences();
    if (guideDue && !this.restorePrintState) this.openPaymentGuide(guideDue);
  }

  private persistPreferences(): void {
    writeSaleCalculatorPreferences({ unitType: this.context!.unitType, floorBand: this.context!.priceFloorBand }, {
      plan: this.plan, taxEnabled: this.taxEnabled, taxReliefMode: this.taxReliefMode,
      interimRatePercent: this.interimRatePercent, mortgageEnabled: this.mortgageEnabled,
      ltv: this.ltv, term: this.term, childCount: this.childCount, holdingYears: this.holdingYears,
      interimFunding: this.interimFunding, assumedMoveInDate: this.assumedMoveInDate,
      costsEnabled: this.costsEnabled, costs: { ...this.costs }, salePriceWon: this.salePriceWon,
      settlementKind: this.settlementKind, appraisedPriceWon: this.appraisedPriceWon, salePlanNotified: this.salePlanNotified,
    });
  }

  private scheduleTable(rows: FundedScheduleRow[]): string {
    if (!rows.length) return '<div class="empty-state">납부 일정 데이터를 불러오지 못했습니다.</div>';
    const cell = (value: number) => value ? money(value) : '—';
    return `<p id="calculator-schedule-scroll-hint" class="schedule-scroll-hint">회차를 선택하면 계좌별 납부액과 필요한 현금을 확인할 수 있습니다.</p><div class="schedule-scroll" role="region" aria-label="회차별 납부 일정과 자금 흐름" aria-describedby="calculator-schedule-scroll-hint" tabindex="0"><table class="schedule-table"><thead><tr><th>회차</th><th>납부일 · D-day</th><th>주택</th><th>발코니<br><small>추가선택품목 Ⅰ</small></th><th>시스템<br>에어컨<br><small>추가선택품목 Ⅱ</small></th><th>추가선택품목 Ⅲ</th><th>회차 준비액<br>자금 흐름</th></tr></thead><tbody>${rows.map(row => {
      const total = row.supply + row.balcony + row.systemAc + row.other;
      const phase = row.dueKey === '계약 시' ? 'contract' : row.label === '잔금' ? 'balance' : 'interim';
      return `<tr data-phase="${phase}" data-finance-due="${escape(row.dueKey)}"><th scope="row"><button type="button" data-payment-stage-target="${escape(row.dueKey)}" aria-controls="${paymentStageId(row.dueKey)}"><strong>${escape(row.label)}</strong><small>상세 보기 ↓</small></button></th><td class="schedule-date"><span>${escape(row.due)}</span>${row.hasSeparateOptionDate ? '<small class="stage-date-scope">주택·Ⅰ·Ⅱ 기준 · Ⅲ은 별도 안내</small>' : ''}<span class="schedule-countdown" data-payment-due="${escape(row.dueKey)}"></span></td><td>${cell(row.supply)}</td><td>${cell(row.balcony)}</td><td>${cell(row.systemAc)}</td><td>${cell(row.other)}${this.optionIiiTiming(row)}</td><td class="total financing-cell"><span class="contract-due">해당 회차 준비액 <b>${money(total)}</b></span>${this.financingMarkup(row.financing)}</td></tr>`;
    }).join('')}</tbody></table></div>${this.scheduleCards(rows)}${this.paymentStageDetails(rows)}<p class="financing-note">집단대출 가정은 <b>중도금 납부일에 대출 실행</b>, <b>잔금·입주 시 원금과 후불이자 상환</b>으로 표시합니다. 대출 유입은 현금 부담에서 차감하며 계약 금액 자체를 줄이지 않습니다. 세금·부대비용은 아래 입주 정산에 별도로 포함됩니다.</p>`;
  }

  private contractAccountSummary(rows: FundedScheduleRow[]): string {
    if (!rows.length) return '<div class="empty-state">납부 일정 데이터를 불러오지 못했습니다.</div>';
    const mainContract = rows.find((row) => row.dueKey === '계약 시');
    const rateLabel = this.plan === 'main-subscription' ? '10%' : '5%';
    const accountLines = [
      ['calculator-account-supply', `${BUNDANG_PAYMENT_ITEM_LABELS.supply} 계좌`, mainContract?.supply ?? 0],
      ['calculator-account-balcony', `${BUNDANG_PAYMENT_ITEM_LABELS.balcony} 계좌`, mainContract?.balcony ?? 0],
      ['calculator-account-system-ac', `${BUNDANG_PAYMENT_ITEM_LABELS['option-ii']} 계좌`, mainContract?.systemAc ?? 0],
    ] as const;
    const contractTotal = accountLines.reduce((sum, [, , amount]) => sum + amount, 0);
    const futureOptionContract = mainContract?.other ?? 0;
    return `<section class="account-contract-summary" aria-labelledby="account-contract-heading"><div class="account-contract-head"><h4 id="account-contract-heading">이번 계약금 · 세 계좌</h4><span>${rateLabel} 기준 · 예상</span></div><div class="account-contract-grid">${accountLines.map(([id, label, amount]) => `<div id="${id}"><span>${label}</span><b>${money(amount)}</b>${id === 'calculator-account-system-ac' && !amount ? '<small>미선택</small>' : ''}</div>`).join('')}</div><p class="account-contract-total">세 계좌 합계 <b>${money(contractTotal)}</b></p><div id="calculator-future-option-contract" class="future-option-contract"><div><span>추후 추가선택품목 Ⅲ 계약금 <small>별도 계약 · 일정 미정${!futureOptionContract ? ' · 선택 없음' : ''}</small></span><b>${money(futureOptionContract)}</b></div><p class="payment-stage-reference">선택한 추가선택품목 Ⅲ에 대한 ${rateLabel} 계약금입니다. 실제 납부 일정과 계좌는 추후 안내를 확인하세요.</p></div><p class="account-contract-total account-contract-overall">현재·추후 계약금 예상 합계 <b>${money(contractTotal + futureOptionContract)}</b></p><p class="payment-stage-reference">주택·발코니·시스템에어컨은 각각 안내받은 KB 세대별 가상계좌를 확인하세요. 계좌번호는 이 화면에 표시하지 않으며 실제 납부 여부는 확인하지 않습니다. 추가선택품목 Ⅲ 계약은 별도로 진행됩니다.</p></section>`;
  }

  private paymentStageDetails(rows: FundedScheduleRow[]): string {
    return `<section id="calculator-payment-details" class="payment-stage-details" aria-labelledby="payment-stage-heading"><div class="subhead"><h4 id="payment-stage-heading">회차별 납부 상세</h4><span>한 회차씩 펼쳐보기</span></div>${rows.map(row => {
      const phase = row.dueKey === '계약 시' ? 'contract' : row.label === '잔금' ? 'balance' : 'interim';
      const body = row.dueKey === '계약 시' ? `${this.contractAccountSummary(rows)}<div class="stage-cash-notice" data-stage-stamp-summary><b>인지세 별도 준비 ${money(150_000)}</b><span>잔금 차감 ${money(75_000)} · 계산 합계 미반영</span></div><div class="payment-stage-reference"><section class="contract-booking-note" aria-label="계약 사전 예약 안내"><b>계약 방문 전 사전 예약 필수 · 당일 예약 불가</b><span>예약 10.30 10:00 ~ 11.12 23:59 · 계약 11.04~11.13 10:00~17:00</span><small>2026.10.28 공식 안내 기준이며 방문 전 운영시간을 확인하세요. <a href="${CONTRACT_NOTICE_URL}" target="_blank" rel="noreferrer">계약 안내문 ↗</a> · <a href="https://www.elife.co.kr/MPosr_list01.action?commonMap.CD_BIZ_LND=210114" target="_blank" rel="noreferrer">공식 방문 예약 ↗</a></small></section><div class="contract-stamp-note"><strong>주택 계약 인지세 · 시점별 확인</strong><p>계약 전에 종이문서용 전자수입인지 <b>15만원을 선납</b>하고, 사업주체 부담분 <b>7만 5천원은 잔금에서 차감</b>합니다. 납부 후 사본을 계약 시 제출하세요. <a href="${STAMP_NOTICE_URL}" target="_blank" rel="noreferrer">2026.10.27 인지세 안내 ↗</a></p><p><b>위 납부표와 아래 예상 현금·계약 총액에는 선납액과 잔금 차감액이 모두 미반영</b>입니다. 계약 전 15만원을 별도로 준비하고 잔금 시 7만 5천원 차감을 확인하세요. 이미 납부한 금액을 입주 부대비용에 중복 입력하지 마세요. 발코니·옵션 계약 인지세는 별도 확인이 필요합니다.</p></div><p class="deadline-note"><b>사전 방문 예약 필수 · 당일 예약 불가</b>: 2026년 10월 30일 10:00부터 11월 12일 23:59까지 홈페이지에서 예약합니다. 주택 계약은 11월 4~13일 10:00~17:00으로 <a href="${CONTRACT_NOTICE_URL}" target="_blank" rel="noreferrer">2026.10.28 계약 안내문</a>에 기재되어 있습니다. 기존 정정공고와 운영시간이 다르므로 방문 전 계약처에 다시 확인하세요. <b>분양대금·발코니·시스템에어컨은 세대별 별도 가상계좌</b>이며 입금 전 각 계좌를 확인하세요. 추가선택품목 Ⅲ 계약금은 별도 계약 시 납부하며 일정은 별도 안내입니다. 입주는 <b>2029년 2월 예정</b>이며 확정일이 아닙니다. 경과 표시는 납부 완료를 뜻하지 않습니다.</p><p id="calculator-contract-review" class="payment-stage-intro">${FINANCE_REVIEWED_AT} 아파트·추가선택품목Ⅰ·Ⅱ 계약서 대조: 신규 본청약 55B의 공급가·발코니·선택한 에어컨 가격과 중도금 날짜·비율이 기존 계산과 일치합니다. 사전청약·다른 평형·다른 에어컨 구성·추가선택품목 Ⅲ은 기존 공고 기준을 유지합니다. 개인 계약서와 계좌번호는 공개하지 않습니다.</p></div>`
        : row.label.includes('중도금') ? this.interimAccountSummary(row)
        : `<dl class="payment-stage-amounts">${([['주택', row.supply], ['추가선택품목 Ⅰ · 발코니', row.balcony], ['추가선택품목 Ⅱ · 시스템에어컨', row.systemAc], ['추가선택품목 Ⅲ', row.other]] as const).map(([label, amount]) => `<div><dt>${label}</dt><dd>${amount ? money(amount) : '—'}</dd></div>`).join('')}</dl><p class="stage-note payment-stage-reference">잔금·입주 시에는 기존 중도금 대출 원금과 예상 후불이자를 정산하고 승인된 전용 모기지를 충당합니다. 추가선택품목 Ⅱ·Ⅲ 잔금은 현금으로 별도 납부합니다. 세금·미납 부대비용은 아래 입주 정산에서 별도로 확인하세요. 2029년 2월은 예정월이며 확정 납부일이 아닙니다.</p><button type="button" class="text-link" data-calculator-jump="calculator-move-in-settlement">입주 정산·세부 자금 계획 보기 →</button>`;
      return `<details id="${paymentStageId(row.dueKey)}" class="payment-stage" name="calculator-payment-stage" data-phase="${phase}" data-payment-stage-due="${escape(row.dueKey)}"><summary><span class="payment-stage-title"><strong>${escape(row.label)}</strong><span data-payment-stage-recommendation hidden></span></span><span class="payment-stage-date">${escape(row.due)}${row.hasSeparateOptionDate ? ' · Ⅲ 실제 납부일 별도 안내' : ''}</span><span class="schedule-countdown" data-payment-due="${escape(row.dueKey)}"></span><span class="disclosure-action">펼치기</span></summary><div class="payment-stage-body"><div class="payment-stage-timing schedule-countdown payment-stage-reference" data-payment-due="${escape(row.dueKey)}"></div>${body}${row.dueKey === '입주 시' ? this.supplyContractBalanceMarkup(row.supply) : ''}${phase !== 'contract' ? this.contractPaymentTerms(row) : ''}<div class="payment-stage-funding"><h5>이 회차의 자금 계획</h5>${row.hasSeparateOptionDate ? '<p class="stage-note payment-stage-reference">추가선택품목 Ⅲ을 포함한 준비액입니다. 같은 날짜에 납부한다는 의미는 아니며, Ⅲ은 별도 계약·납부 고지에 따라 현금으로 납부하세요.</p>' : ''}${this.financingMarkup(row.financing).replaceAll('data-flow=', 'data-stage-flow=')}</div><div class="payment-stage-actions"><button type="button" class="stage-guide-button" data-payment-guide-target="${escape(row.dueKey)}" aria-haspopup="dialog" aria-controls="calculator-stage-guide-dialog">자세한 안내</button></div></div></details>`;
    }).join('')}</section>`;
  }

  private supplyContractBalanceMarkup(totalBalanceWon: number): string {
    const balance = contractSupplyBalanceBreakdown(totalBalanceWon, BUNDANG_SALE_FINANCE_CATALOG_V1.housingCityFundWon);
    return `<section id="calculator-contract-balance-breakdown" class="payment-stage-funding" aria-labelledby="contract-balance-heading"><h5 id="contract-balance-heading">아파트 계약서의 잔금·융자금 구분</h5><dl class="payment-stage-amounts"><div><dt>계약서 표의 잔금</dt><dd data-contract-balance="balance">${money(balance.contractBalanceWon)}</dd></div><div><dt>융자금 · 주택도시기금</dt><dd data-contract-balance="fund">${money(balance.housingCityFundWon)}</dd></div><div><dt>입주 시 주택 납부 합계</dt><dd data-contract-balance="total">${money(balance.totalBalanceWon)}</dd></div></dl><p class="stage-short-note">주택 잔금에 포함된 금액 · 별도 차감·추가 상환 없음</p><p class="stage-note payment-stage-reference">위 두 항목의 합계가 납부표의 <b>주택 잔금</b>입니다. 융자금 ${money(balance.housingCityFundWon)}은 이미 합계에 포함되어 있으며 별도 수령액으로 차감하거나 모기지에 다시 더하지 않습니다. <b>계약서 제1조 제6항은 이 기금을 시행사가 받은 이후 상환 예정이므로 계약자가 받을 수 없다고 명시합니다.</b> 계약자 본인의 추가 대출이나 별도 기금 상환금으로 계산하지 않습니다. 전용 모기지의 실제 승인·실행 절차는 은행에 확인하세요.</p></section>`;
  }

  private contractPaymentTerms(row: FundedScheduleRow): string {
    const hasOptions = row.balcony > 0 || row.systemAc > 0;
    return `<p class="stage-note contract-payment-terms payment-stage-reference">아파트·추가선택품목Ⅰ·Ⅱ 계약서상 중도금·잔금 납부일이 <b>금융기관 휴무일이면 다음 영업일</b>이 납부일입니다. 실제 납부 고지와 변경 안내를 확인하세요.${hasOptions ? ' 발코니·시스템에어컨 계약서의 선납할인율은 연 5%, 연체이율은 연 7.5%이며 변경될 수 있습니다. 이 할인·연체료는 현재 계산에 자동 반영하지 않습니다. 중도금 대출 이자 추정 금리와는 별개입니다.' : ''}</p>`;
  }

  private interimAccountSummary(row: FundedScheduleRow): string {
    const headingId = `interim-account-heading-${paymentDeadlineForDue(row.dueKey).id}`;
    const accounts = [
      ['supply', `${BUNDANG_PAYMENT_ITEM_LABELS.supply} 계좌`, row.supply, this.interimFunding === 'loan' ? '주택 집단대출 가정' : '자납 가정'],
      ['balcony', `${BUNDANG_PAYMENT_ITEM_LABELS.balcony} 계좌`, row.balcony, '현금 자납'],
      ['system-ac', `${BUNDANG_PAYMENT_ITEM_LABELS['option-ii']} 계좌`, row.systemAc, '현금 자납'],
      ['other', `${BUNDANG_PAYMENT_ITEM_LABELS['option-iii']} 계좌`, row.other, '현금 자납 · 실제 납부일 별도 안내'],
    ] as const;
    const iiiNote = row.other ? `<p class="option-iii-stage-note payment-stage-reference"><b>추가선택품목 Ⅲ 중도금 · 현금 자납</b>${this.optionIiiTiming(row)}중도금 기간에 준비할 금액으로 함께 표시합니다. ${this.plan === 'main-subscription' ? '본청약 30% 전액을 1차 준비액에 한 번만 포함했으며 1·2차로 임의 분할하지 않았습니다.' : '사전청약 20%를 이 회차 준비액에 포함했습니다.'} 실제 납부일·횟수는 별도 계약 및 고지를 확인하세요.</p>` : this.options.some(option => option.tier === 'option-iii') ? '<p class="stage-note payment-stage-reference">추가선택품목 Ⅲ 중도금 준비액은 앞선 중도금 회차에 한 번만 포함했습니다. 이 회차에 다시 합산하지 않으며 실제 납부일·횟수는 별도 고지로 확인하세요.</p>' : '';
    return `<section class="interim-account-summary" aria-labelledby="${headingId}"><div class="account-contract-head"><h4 id="${headingId}">${escape(row.label)} · 항목별 납부</h4><span>공고 기준 · 계약서 확인</span></div><p class="stage-short-note">Ⅰ·Ⅱ·Ⅲ 중도금은 각 계좌에 현금 자납</p><p class="payment-stage-reference"><b>주택 분양대금만 집단대출을 가정</b>하며, 추가선택품목 Ⅰ·Ⅱ·Ⅲ은 각각의 지정 계좌에 <b>현금으로 나누어 송금</b>합니다. 대출 실행 및 계좌별 실제 납부 방법은 은행과 계약 안내를 확인하세요.</p><div class="interim-account-round" data-interim-account-due="${escape(row.dueKey)}"><div class="account-contract-head"><h5>${escape(row.label)}</h5><span>${escape(row.due)} · 주택·Ⅰ·Ⅱ 기준</span></div><div class="account-contract-grid interim-account-grid">${accounts.map(([id, name, amount, funding]) => `<div data-interim-account="${id}"><span>${name}</span><b>${money(amount)}</b><small>${amount ? funding : (id === 'other' ? '이 회차 배정 없음' : '해당 회차 납부 없음')}</small></div>`).join('')}</div>${iiiNote}<p class="account-contract-total">해당 회차 준비액 <b>${money(row.supply + row.balcony + row.systemAc + row.other)}</b></p></div><p class="payment-stage-reference">같은 회차에서 확인하되 계약·계좌는 별개입니다. 실제 납부 고지에 따라 각각 송금하고, 금액을 합산하거나 다른 항목 계좌로 교차 입금하지 마세요.</p></section>`;
  }

  private optionIiiTiming(row: FundedScheduleRow): string {
    if (!row.other || !row.hasSeparateOptionDate) return '';
    const rate = row.optionIiiPayments.map(payment => `${payment.rateBps / 100}%`).join(' + ');
    return `<small class="option-iii-timing" data-option-iii-timing>${escape(rate)} · ${row.dueKey === '계약 시' ? '별도 계약' : '현금 자납'}<br>실제 납부일 미정 · 별도 안내</small>`;
  }

  private paymentGuideDialogMarkup(): string {
    return `<dialog id="calculator-stage-guide-dialog" class="payment-guide-dialog" aria-labelledby="calculator-stage-guide-title"><header class="payment-guide-header"><h2 id="calculator-stage-guide-title">자세한 안내</h2><button type="button" data-close-payment-guide autofocus>닫기 <span aria-hidden="true">×</span></button></header><div class="payment-guide-content"></div><footer class="payment-guide-footer">인쇄·PDF에는 열지 않은 회차의 안내도 모두 포함됩니다.</footer></dialog>`;
  }

  private openPaymentGuide(due: string): void {
    const row = this.scheduleRows.find(candidate => candidate.dueKey === due);
    const stage = this.mount.querySelector<HTMLElement>(`#${paymentStageId(due)}`);
    const dialog = this.mount.querySelector<HTMLDialogElement>('#calculator-stage-guide-dialog');
    const content = dialog?.querySelector<HTMLElement>('.payment-guide-content');
    if (!row || !stage || !dialog || !content || this.restorePrintState) return;
    this.closePaymentGuide(false);
    const references = [...stage.querySelectorAll<HTMLElement>('.payment-stage-reference')];
    if (!references.length) return;
    this.paymentGuideDue = due;
    this.paymentGuideOpener = stage.querySelector<HTMLElement>('[data-payment-guide-target]');
    for (const node of references) {
      const placeholder = document.createComment('payment-guide-origin');
      node.replaceWith(placeholder);
      this.paymentGuideOrigins.push({ node, placeholder });
      content.append(node);
    }
    dialog.querySelector<HTMLElement>('#calculator-stage-guide-title')!.textContent = `${row.label} · 자세한 안내`;
    dialog.showModal();
  }

  private closePaymentGuide(restoreFocus = true): void {
    const dialog = this.mount.querySelector<HTMLDialogElement>('#calculator-stage-guide-dialog');
    const opener = this.paymentGuideOpener;
    this.paymentGuideDue = null;
    this.paymentGuideOpener = null;
    // Move the original nodes back, not copies: IDs and current monetary text
    // remain unique for reconciliation and for the complete printed document.
    for (const { node, placeholder } of this.paymentGuideOrigins) placeholder.replaceWith(node);
    this.paymentGuideOrigins.length = 0;
    if (dialog?.open) dialog.close();
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }

  private scheduleCards(rows: FundedScheduleRow[]): string {
    return `<div class="schedule-cards" aria-label="회차별 납부 요약">${rows.map(row => {
      const phase = row.dueKey === '계약 시' ? 'contract' : row.label === '잔금' ? 'balance' : 'interim';
      return `<button type="button" class="installment-card" data-phase="${phase}" data-mobile-finance-due="${escape(row.dueKey)}" data-payment-stage-target="${escape(row.dueKey)}" aria-controls="${paymentStageId(row.dueKey)}"><span class="installment-heading"><b>${escape(row.label)}</b><span>내 현금 <strong>${money(row.financing.cashDueWon)}</strong></span></span><span class="installment-date">${escape(row.due)}</span>${this.optionIiiTiming(row)}<span class="schedule-countdown" data-payment-due="${escape(row.dueKey)}"></span><span class="disclosure-action">상세 보기</span></button>`;
    }).join('')}</div>`;
  }

  private financingMarkup(row: BundangFinancingTimelineRowV1): string {
    const line = (kind: string, label: string, value: number, sign: string) => value
      ? `<span class="financing-line" data-flow="${kind}"><span>${label}</span><b>${sign}${money(value)}</b></span>` : '';
    return `<div class="financing-lines">${line('loan-draw', '집단대출 실행 · 유입', row.groupLoanDrawWon, '−')}${line('interim-repayment', '중도금 원금 상환', row.interimRepaymentWon, '＋')}${line('deferred-interest', '예상 후불이자 상환', row.deferredInterestWon, '＋')}${line('mortgage', '잔금 모기지 · 유입', row.mortgageAppliedWon, '−')}<span class="financing-cash" data-flow="cash-due"><span>내 현금</span><b>${money(row.cashDueWon)}</b></span></div>`;
  }

  private syncPaymentStageSelection(now = new Date()): void {
    if (this.restorePrintState) return;
    const recommended = recommendedPaymentDue(this.scheduleRows, now);
    if (this.selectedPaymentDue && !this.scheduleRows.some(row => row.dueKey === this.selectedPaymentDue)) {
      this.selectedPaymentDue = undefined;
    }
    const selected = this.selectedPaymentDue === undefined ? recommended : this.selectedPaymentDue;
    for (const stage of this.mount.querySelectorAll<HTMLDetailsElement>('.payment-stage')) {
      stage.open = stage.dataset.paymentStageDue === selected;
      const badge = stage.querySelector<HTMLElement>('[data-payment-stage-recommendation]');
      if (badge) {
        const isRecommended = stage.dataset.paymentStageDue === recommended;
        badge.hidden = !isRecommended;
        const countdown = countdownForDeadline(paymentDeadlineForDue(stage.dataset.paymentStageDue!), now);
        badge.textContent = countdown.state === 'active' || countdown.state === 'today' ? '현재 회차'
          : countdown.state === 'elapsed' ? '최근 회차' : '다가오는 회차';
      }
    }
    for (const button of this.mount.querySelectorAll<HTMLButtonElement>('[data-payment-stage-target]')) {
      button.setAttribute('aria-expanded', String(button.dataset.paymentStageTarget === selected));
    }
    this.syncDisclosureLabels();
  }

  private refreshCountdowns(): void {
    const block = this.mount.querySelector('#calculator-payments');
    if (!block) return;
    const now = new Date();
    const today = seoulDateKey(now);
    for (const node of this.mount.querySelectorAll<HTMLElement>('[data-payment-due]')) {
      const deadline = paymentDeadlineForDue(node.dataset.paymentDue!);
      const countdown = countdownForDeadline(deadline, now);
      node.dataset.state = countdown.state;
      node.innerHTML = `<b>${escape(countdown.text)}</b><small>${escape(countdown.detail)}</small>`;
    }
    // Only official dated housing payments qualify as the next confirmed event.
    // An unknown option date or a planning assumption must never become a deadline.
    const upcoming = this.scheduleRows.find(row => {
      const deadline = paymentDeadlineForDue(row.dueKey);
      return (deadline.precision === 'date' || deadline.precision === 'range')
        && deadline.endDate !== undefined && deadline.endDate >= today;
    });
    let summary = block.querySelector<HTMLElement>('#calculator-deadline-summary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'calculator-deadline-summary';
      summary.className = 'deadline-summary';
      block.querySelector('.subhead')?.after(summary);
    }
    const next = upcoming ? countdownForDeadline(paymentDeadlineForDue(upcoming.dueKey), now) : null;
    summary.innerHTML = `<div><span>다가오는 주택 납부 일정</span><strong>${upcoming ? escape(upcoming.label) : '확정된 다음 납부일 없음'}</strong><small>${upcoming ? escape(upcoming.due) : '입주·추가선택품목 Ⅲ은 별도 확정 안내를 확인하세요.'}</small></div>${next ? `<b class="deadline-next" data-state="${next.state}">${escape(next.text)}</b>` : ''}<p id="calculator-deadline-today">D-day 기준 <time datetime="${today}">${today.replaceAll('-', '.')}</time> · 한국시간(KST)<small>입주 예정월은 2월 1일 기준 참고값 · 실제 잔금일 미정</small></p>`;
    this.syncPaymentStageSelection(now);
  }

  private readonly scheduleCountdownRefresh = (): void => {
    window.clearTimeout(this.countdownTimer);
    if (document.hidden || !this.scheduleRows.length) return;
    this.refreshCountdowns();
    // Refresh at Seoul midnight, regardless of the viewer's browser time zone.
    // Only date labels are replaced, preserving open folds and in-progress inputs.
    const dayMs = 86_400_000;
    const untilMidnight = dayMs - ((Date.now() + 9 * 3_600_000) % dayMs);
    this.countdownTimer = window.setTimeout(this.scheduleCountdownRefresh, untilMidnight + 50);
  };

  private optionMarkup(quote: Quote): string {
    if (this.minus) return `<section class="option-group option-minus" data-option-tier="discount-metadata-only"><h3>마이너스 옵션</h3><dl><div><dt>공급가 감액</dt><dd>−${money(quote.minusSupply)}</dd></div><div><dt>발코니 감액</dt><dd>−${money(quote.minusBalcony)}</dd></div><div class="subtotal"><dt>총 감액</dt><dd>−${money(quote.minusDiscount)}</dd></div></dl><p>마이너스 옵션은 할인 전용 항목이며 일반 유상옵션은 계약 합계에 넣지 않습니다.</p></section>`;
    if (!quote.optionLines.length) return '<div class="empty-state">선택한 유상옵션이 없습니다.</div>';
    const groups = new Map<string, SaleCalculatorOptionLineV1[]>();
    quote.optionLines.forEach((line) => groups.set(line.category, [...(groups.get(line.category) ?? []), line]));
    return [...groups].map(([category, lines]) => {
      const subtotal = lines.reduce((sum, line) => sum + line.priceWon, 0);
      return `<section class="option-group"><h3>${escape(category)}</h3><ul class="option-list">${lines.map((line) => `<li data-option-tier="${line.tier}"><span><b>${escape(line.priceVariantLabel ? `${line.label} · ${line.priceVariantLabel}` : line.label)}</b><small>${line.tier === 'option-ii' ? '시스템에어컨' : '추가선택품목 Ⅲ'}</small></span><strong>${money(line.priceWon)}</strong></li>`).join('')}</ul><div class="option-subtotal"><span>${escape(category)} 소계</span><b>${money(subtotal)}</b></div></section>`;
    }).join('');
  }

  private taxDetails(quote: Quote): string {
    const choices: readonly [TaxReliefMode, string, number][] = [['none', '감면 없음', 0], ['first-home', '생애최초', 2_000_000], ['birth-care', '출산·양육', 5_000_000]];
    const result = quote.tax ? `<p class="tax-relief-print">감면 시나리오: ${choices.find(([value]) => value === this.taxReliefMode)![1]} · 자격 충족 여부는 별도 확인</p><dl><dt>과세 추정 기준</dt><dd>${money(quote.tax.taxable)}</dd><dt>적용 취득세율</dt><dd>${quote.tax.ratePercent}%</dd><dt>선택 감면 반영</dt><dd>−${money(quote.tax.relief)}</dd><dt>취득세</dt><dd>${money(quote.tax.acquisition)}</dd><dt>지방교육세</dt><dd>${money(quote.tax.education)}</dd><dt>농어촌특별세</dt><dd>${money(quote.tax.rural)}</dd><dt class="calculation-total-label">합계</dt><dd class="calculation-total">${money(quote.tax.total)}</dd></dl>` : '<p class="muted-copy">활성화 시 계약 예상 총액 기준으로 계산합니다.</p>';
    return `<details id="calculator-tax-details" class="calculator-card disclosure" ${this.taxEnabled ? 'open' : ''}><summary>취득세 추정 <span>펼치기</span></summary><div class="disclosure-body"><label class="enable-row"><input id="calculator-tax-enabled" type="checkbox" ${this.taxEnabled ? 'checked' : ''}> 취득세 추정 활성화</label><fieldset class="relief-options" ${this.taxEnabled ? '' : 'disabled'}><legend>감면 시나리오</legend>${choices.map(([value, label, amount]) => `<label><input name="tax-relief-mode" type="radio" value="${value}" ${this.taxReliefMode === value ? 'checked' : ''}><span><b>${label}</b><small>${amount ? `최대 ${money(amount)}` : '기본 계산'}</small></span></label>`).join('')}</fieldset>${result}<p class="legal-copy">생애최초는 이 아파트 기준 최대 200만원 시나리오이며 현행 취득 기한은 2028-12-31입니다. 2029년 예정 취득에는 현행법상 자동 적용되지 않습니다. 출산·양육은 <b>2028-12-31까지 출산</b>하고 출산 후 5년 이내(취득 후 1년 이내 출산 포함), 12억원 이하·1가구1주택 등 요건을 충족하면 최대 500만원입니다. 출산 기준일과 취득 기한은 다릅니다. 두 감면은 합산하지 않으며 이 선택은 자격 판정이 아닌 가정입니다. 지방교육세는 감면 전 취득세 기준의 보수적 추정으로, 감면에 연동된 교육세 감면을 제외하여 실제보다 클 수 있습니다. 거주 개시·유지 등 추징 요건은 지자체 확인이 필요하며 등기·법무·대출 부대비용은 별도입니다. <a href="https://www.law.go.kr/법령/지방세특례제한법/제36조의3" target="_blank" rel="noreferrer">생애최초 조문 ↗</a> · <a href="https://www.law.go.kr/법령/지방세특례제한법/제36조의5" target="_blank" rel="noreferrer">출산·양육 조문 ↗</a></p></div></details>`;
  }

  private interimLoanDetails(quote: Quote): string {
    const details = quote.interimLoan;
    const interimRows = quote.schedule.filter((row) => row.label.includes('중도금'));
    const selfFunded = interimRows.reduce((total, row) => total + row.balcony + row.systemAc + row.other, 0);
    const balconyInterim = interimRows.reduce((total, row) => total + row.balcony, 0);
    const systemAcInterim = interimRows.reduce((total, row) => total + row.systemAc, 0);
    const otherInterim = interimRows.reduce((total, row) => total + row.other, 0);
    const result = this.interimFunding === 'loan' ? `<dl><dt>은행 집단대출 원금</dt><dd>${money(details.totalPrincipalWon)}</dd><dt class="calculation-total-label">입주 시 납부 예상 이자</dt><dd class="calculation-total">${money(details.totalInterestWon)}</dd><dt>발코니 중도금 · 자납</dt><dd>${money(balconyInterim)}</dd><dt>시스템에어컨 중도금 · 자납</dt><dd>${money(systemAcInterim)}</dd><dt>추가선택품목 Ⅲ 중도금 · 자납</dt><dd>${money(otherInterim)}</dd><dt>계산상 입주 기준일</dt><dd>${details.assumedMoveInDate}</dd></dl><ul class="tranche-list">${details.tranches.map((tranche, index) => `<li><span>${this.plan === 'main-subscription' ? `${index + 1}차 · ` : ''}${tranche.executionDate}<small>${tranche.days}일 후불</small></span><b>${money(tranche.principalWon)}<small>예상 이자 ${money(tranche.interestWon)}</small></b></li>`).join('')}</ul>` : '<p class="muted-copy">전액 자납 가정에서는 중도금 대출 원금과 후불이자를 입주 정산에 넣지 않습니다.</p>';
    return `<details id="calculator-interim-loan-details" class="calculator-card disclosure"><summary>중도금 대출 이자 추정 <span>펼치기</span></summary><div class="disclosure-body"><div class="loan-scope"><span><small>집단대출 추정 대상</small><b>주택 공급대금 중도금 20%</b></span><span><small>별도 현금납부 예상</small><b>${money(selfFunded)}</b></span></div><label class="enable-row"><input id="calculator-interim-loan-enabled" type="checkbox" ${this.interimFunding === 'loan' ? 'checked' : ''}> 집단대출 가정 · 후불이자 반영</label><label class="date-field">입주 정산 기준일 · 계획값<input id="calculator-move-in-date" type="date" min="2028-02-15" max="2099-12-31" value="${this.assumedMoveInDate}"></label>${this.interimRateControl('calculator-interim-rate')}${result}<p class="legal-copy">공고문은 중도금 융자알선을 <b>전체 공급대금의 20% 범위</b>로 명시합니다. 발코니·시스템에어컨·추가선택품목 Ⅲ에는 계약상 중도금 회차가 있지만 별도 계약·계좌이며, 은행 집단대출 포함 근거가 없어 자납으로 분리했습니다. 단지 금융기관·금리는 미정이며 4.0%는 현재 금리를 뜻하지 않는 계획값입니다. 기준일 기본값은 2029-02-01이며 입주지정기간 최초일·은행 실제 실행일이 확정되면 다시 확인하세요. <b>실행 예정분을 포함한 전체 예상 후불이자</b>로 현재 발생한 이자가 아닙니다. 실제 이자는 윤년·실행일·일수 산정에 따라 달라질 수 있습니다. 자납을 선택하면 원금 상환과 후불이자는 입주 정산에서 제외됩니다.</p></div></details>`;
  }

  private interimRateControl(prefix: string): string {
    const disabled = this.interimFunding === 'loan' ? '' : 'disabled';
    return `<div class="interim-rate-control"><label for="${prefix}-input">중도금 예상 연 금리<small>0.1%p 단위 · 계획값</small></label><div class="interim-rate-input"><button id="${prefix}-down" data-interim-rate-action="down" type="button" ${disabled} aria-label="금리 0.1%포인트 낮추기">−</button><span><input id="${prefix}-input" data-interim-rate-input type="number" inputmode="decimal" min="0" max="15" step="0.1" value="${this.interimRatePercent.toFixed(1)}" ${disabled} aria-label="중도금 예상 연 금리"><b aria-hidden="true">%</b></span><button id="${prefix}-up" data-interim-rate-action="up" type="button" ${disabled} aria-label="금리 0.1%포인트 높이기">＋</button></div></div>`;
  }

  private mortgageDetails(quote: Quote): string {
    const result = quote.mortgage;
    return `<details id="calculator-mortgage-details" class="calculator-card disclosure"><summary>신혼희망타운 전용 모기지 추정 <span>열기</span></summary><div class="disclosure-body">
      <label class="enable-row"><input id="calculator-mortgage-enabled" type="checkbox" checked disabled> 전용 모기지 필수 적용 · 추정</label>
      <div class="mini-controls mortgage-controls">
        <label>선택 LTV<select id="calculator-ltv" ${this.mortgageEnabled ? '' : 'disabled'}>${[30,40,50,60,70].map(value => `<option ${value === this.ltv ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>상환 만기<select id="calculator-term" ${this.mortgageEnabled ? '' : 'disabled'}><option value="20" ${this.term === 20 ? 'selected' : ''}>20년</option><option value="30" ${this.term === 30 ? 'selected' : ''}>30년</option></select></label>
        <label>자녀 수<select id="calculator-children" ${this.mortgageEnabled ? '' : 'disabled'}><option value="0" ${this.childCount === 0 ? 'selected' : ''}>0명</option><option value="1" ${this.childCount === 1 ? 'selected' : ''}>1명</option><option value="2" ${this.childCount === 2 ? 'selected' : ''}>2명 이상</option></select></label>
        <label>정산 시 대출 유지기간<select id="calculator-settlement-period" ${this.mortgageEnabled ? '' : 'disabled'}>${Array.from({ length: this.term - 2 }, (_, i) => i + 3).map(year => `<option value="${year}" ${year === this.holdingYears ? 'selected' : ''}>${year}년</option>`).join('')}</select></label>
      </div>
      ${result ? `<dl><dt>대출 기준액 · 공급가+발코니</dt><dd>${money(result.loanBase)}</dd><dt>선택 LTV / 정산용 실효 LTV</dt><dd>${result.ltvPercent}% / ${result.settlement.effectiveLtvPercent}%</dd><dt>공고문 기준 연 이율</dt><dd>${result.annualRatePercent}% 고정</dd><dt>대출 가능 상한</dt><dd>${money(result.eligibleMaximum)}</dd><dt>대출 원금</dt><dd>${money(result.principal)}</dd><dt>입주 시 필요 현금 · 정산표 기준</dt><dd>${money(result.moveInCash)}</dd><dt>1년 거치 월 이자</dt><dd>${money(result.graceInterest)}</dd><dt>거치 후 ${result.repaymentMonths / 12}년 월 원리금</dt><dd>${money(result.repayment)}</dd><dt>향후 매각차익 기금 정산비율</dt><dd>${result.settlement.fundSharePercent}%</dd></dl>` : '<p class="muted-copy">활성화 시 단지 공고 기준 연 1.3%, 1년 거치 후 원리금균등상환을 추정합니다.</p>'}
      <p class="legal-copy">기준액은 <b>감액 후 공급가 + 발코니 확장비</b>이며 시스템에어컨·추가선택품목 Ⅲ·세금은 제외합니다. 선택 LTV를 합산 기준액에 한 번 적용하며 4억원 한도 중 작은 금액을 추정합니다. 이는 계좌별 대출이 두 건이라는 뜻이 아니며, 실제 은행의 주택·발코니 계좌별 대출금 배분은 확인이 필요합니다. 4억원 상한 적용 시 실제 LTV를 절사한 뒤 공식 표를 보간합니다. 자녀 수는 분양계약일부터 상환·만기까지 해당 주택에서 동거하고 가족관계등록부에 등재되거나 등재됐던 만19세 이하 자녀로 출산·입양·사망 포함, 파양 제외입니다. 이 단지는 공고의 연 1.3%를 기준으로 하며 실행 시 기금 조건·심사가 우선합니다. <a href="${SALE_NOTICE_URL}" target="_blank" rel="noreferrer">이 단지 정정공고 ↗</a> · <a href="${MORTGAGE_SOURCE}" target="_blank" rel="noreferrer">KB 상품 참고 ↗</a></p>
    </div></details>`;
  }

  private moveInMarkup(quote: Quote): string {
    const value = quote.moveIn;
    const missing = [!this.taxEnabled ? '취득 관련 세금' : '', !this.costsEnabled ? '입주 부대비용' : ''].filter(Boolean);
    return `<section id="calculator-move-in-settlement" class="move-in-block" aria-labelledby="move-in-heading">
      <div class="subhead"><h3 id="move-in-heading">입주 시 자금 정산</h3><span class="assumption-chip">현재 선택한 가정 기준</span></div>
      <p>계약 총액과 입주 때 준비할 현금은 다릅니다. <b>중도금 대출은 본인자금으로 먼저 정리</b>하고 전용 모기지는 주택·발코니 잔금에만 반영합니다.</p>
      <div class="cash-plan-summary" aria-label="계약금과 계약 후 준비할 기본 자금">
        <div class="cash-plan-contract"><span>01 · 이번 계약금 · 세 계좌</span><strong id="calculator-contract-cash">${money(value.contractPaymentsWon)}</strong><small>주택·발코니·선택한 시스템에어컨 계약금입니다. 실제 납부 여부는 확인하지 않습니다.</small></div>
        <div class="cash-plan-remaining"><span>02 · 계약 후 입주까지 필요한 기본 현금</span><strong id="calculator-post-contract-base-cash">${money(value.postContractBaseCashWon)}</strong><small>계약 총액 − 계약금 − 잔금에 충당하는 전용 모기지</small></div>
      </div>
      <p class="stage-note">02에는 추후 별도 계약할 추가선택품목 Ⅲ 계약금 ${money(value.futureOptionContractPaymentsWon)}, 계약 후 자납할 중도금과 잔금, 집단대출을 이용한다면 추후 상환할 원금이 포함됩니다. 이미 납부한 중도금은 직접 빼서 계획하세요. <b>후불이자·취득세·부대비용은 이 기본 금액에 포함되지 않습니다.</b> 실제 입주 시점의 추정 현금은 아래 정산을 확인하세요.</p>
      <fieldset class="funding-switch"><legend>주택 중도금 20% 납부 방식</legend><label><input id="calculator-funding-loan" name="interim-funding" value="loan" type="radio" ${this.interimFunding === 'loan' ? 'checked' : ''}> 집단대출 가정</label><label><input id="calculator-funding-cash" name="interim-funding" value="cash" type="radio" ${this.interimFunding === 'cash' ? 'checked' : ''}> 전액 자납 가정</label></fieldset>
      <section class="settlement-stage" aria-labelledby="interim-repayment-heading"><h4 id="interim-repayment-heading"><i aria-hidden="true">01</i> 우선 확보할 중도금 상환자금</h4>
        ${this.interimFunding === 'loan' ? this.interimRateControl('calculator-settlement-rate') : '<p class="muted-copy">전액 자납 가정 · 입주 때 상환할 중도금 대출과 후불이자는 없습니다.</p>'}
        <dl class="settlement-table"><div><dt>중도금 대출 원금 상환</dt><dd id="calculator-interim-repayment">${money(value.interimLoanRepaymentWon)}</dd></div>
        <div><dt>＋ 예상 후불이자 ${this.interimFunding === 'loan' ? '· 자동 반영' : '· 자납 제외'}</dt><dd id="calculator-deferred-interest">${money(value.deferredInterestWon)}</dd></div>
        <div class="settlement-subtotal repayment-subtotal"><dt>모기지 실행 전 중도금 정리금</dt><dd id="calculator-pre-mortgage-cash">${money(value.preMortgageRepaymentWon)}</dd></div></dl>
        <p class="stage-note">${this.interimFunding === 'loan' ? `미상환 집단대출을 가정하며, 실행 예정 중도금도 연 ${this.interimRatePercent.toFixed(1)}% · ${this.assumedMoveInDate}까지의 전체 예상 이자에 포함합니다. 현재 발생 이자나 은행 청구액이 아닙니다.` : '자납 가정의 중도금은 입주 전 계약금·자납 중도금에 포함됩니다. 실제 납부 여부는 확인하지 않습니다.'} 공고문상 중도금은 본인자금 상환 대상입니다. 상환과 모기지 실행의 실제 날짜·순서는 취급은행에 확인하세요.</p>
      </section>
      <section class="settlement-stage non-balance-stage" aria-labelledby="non-balance-heading"><h4 id="non-balance-heading">잔금 제외 별도 준비자금</h4>
        <dl class="settlement-table"><div><dt>위 중도금 정리금 포함</dt><dd>${money(value.preMortgageRepaymentWon)}</dd></div>
        ${this.estimateChoiceMarkup('tax', '＋ 선택한 취득 관련 세금', this.taxEnabled, value.acquisitionTaxWon)}
        ${this.estimateChoiceMarkup('costs', '＋ 미납 입주 부대비용', this.costsEnabled, value.additionalCostsWon)}
        <div class="settlement-subtotal"><dt>잔금 제외 준비금 · 중도금 포함</dt><dd id="calculator-non-balance-cash">${money(value.nonBalanceCostsWon)}</dd></div></dl><p class="stage-note">위 01 금액을 포함한 소계이므로 두 번 더하지 않습니다. 세금·부대비용의 실제 납부일은 각각 다르며 모두 모기지 전에 납부한다는 뜻은 아닙니다.</p>
      </section>
      <section class="settlement-stage balance-stage" aria-labelledby="balance-funding-heading"><h4 id="balance-funding-heading"><i aria-hidden="true">02</i> 잔금과 전용 모기지</h4>
        <label class="enable-row mortgage-enable"><input id="calculator-balance-mortgage-enabled" type="checkbox" checked disabled> 전용 모기지 필수 적용 · 추정 <b>연 1.3% 고정</b></label>
        ${this.mortgageOverviewMarkup(quote)}
        <dl class="settlement-table"><div><dt>주택·발코니 잔금</dt><dd>${money(value.housingBalanceWon)}</dd></div><div><dt>＋ 시스템에어컨·추가선택품목 Ⅲ 잔금 · 자납</dt><dd>${money(value.optionBalanceWon)}</dd></div><div><dt>− 주택·발코니 잔금에 모기지 충당</dt><dd id="calculator-mortgage-applied">${this.mortgageEnabled ? money(value.mortgageAppliedWon) : '미적용'}</dd></div>
        <div class="settlement-subtotal"><dt>잔금 추가 자납액</dt><dd id="calculator-balance-cash">${money(value.balanceCashAfterMortgageWon)}</dd></div></dl>
      </section>
      <p class="stamp-settlement-reminder"><b>잔금 확인:</b> 계약 전 인지세 선납 15만원 중 사업주체 부담 7만 5천원이 잔금에서 차감됩니다. 아래 입주 필요 현금에는 이 차감액이 <b>반영되지 않았으니</b> 실제 고지서에서 확인해 주세요.</p>
      <dl class="settlement-table"><div class="settlement-total"><dt>입주 시 필요 현금<small>잔금 제외 준비금 + 잔금 추가 자납액</small></dt><dd id="calculator-required-cash">${money(value.requiredCashAtMoveInWon)}</dd></div></dl>
      ${missing.length ? `<p class="scenario-warning" role="note">${missing.join('·')} 미반영: 위 금액은 실제 입주 비용 전부를 확정한 값이 아닙니다. 해당 추정 항목을 펼쳐 반영하세요.</p>` : ''}
      ${this.costsEnabled && COST_ITEMS.every(([id]) => this.costs[id] === 0) ? '<p class="scenario-warning">부대비용 예상액이 아직 0원입니다. 무료로 확정된 것이 아니므로 실제 견적을 확인하세요.</p>' : ''}
      ${value.mortgageExcessWon ? `<p class="scenario-warning">계산상 모기지 초과액 ${money(value.mortgageExcessWon)}은 현금 수령·추가대출로 간주하지 않습니다.</p>` : ''}
      <div class="funding-metrics"><div><span>입주 전 계약금·자납 중도금 예상액 · 납부 여부 미확인</span><b id="calculator-upfront-cash">${money(value.selfFundedBeforeMoveInWon)}</b></div><div><span>계약·선택한 비용 포함 예산</span><b>${money(value.totalAcquisitionBudgetWon)}</b></div><div><span>계약부터 입주까지 자기자금</span><b>${money(value.totalOwnCashWon)}</b></div></div>
      <p class="legal-copy">추가선택품목 Ⅲ 중도금은 별도 안내일에 입주 전 자납하는 것으로 분리했습니다. 이미 납부한 부대비용과 모기지 만기까지의 이자·향후 세금은 이 입주 예산에 넣지 않습니다. 시뮬레이션 입력은 현재 탭에서만 유지되며 서버로 전송하지 않습니다. 세대 재선택 시 초기화됩니다.</p>
    </section>`;
  }

  private estimateChoiceMarkup(kind: 'tax' | 'costs', label: string, enabled: boolean, amount: number): string {
    const target = kind === 'tax' ? 'calculator-tax-details' : 'calculator-cost-details';
    return `<div class="settlement-choice-row ${enabled ? '' : 'is-inactive'}"><dt>${enabled ? escape(label) : `<button type="button" data-enable-estimate="${kind}" aria-controls="${target}">${escape(label)}<small>선택하기 →</small></button>`}</dt><dd>${enabled ? money(amount) : '미반영'}</dd></div>`;
  }

  private mortgageOverviewMarkup(quote: Quote): string {
    const mortgage = quote.mortgage;
    return `<div id="calculator-balance-mortgage-info" class="mortgage-overview"><span class="mortgage-required">공고상 의무가입 대상 · 주택가격의 30% 이상</span>
      <p>얼마나 빌릴 수 있나요? <b>(감액 후 공급가 + 발코니 확장비) × 선택 LTV(예: 60% 또는 70%)</b>와 <b>4억원</b> 중 작은 금액입니다. 시스템에어컨·추가선택품목 Ⅲ·세금은 기준액에 포함하지 않습니다.</p><p class="stage-note">주택과 발코니에 각각 별도 대출 두 건을 적용하는 계산이 아닙니다. 실제 은행의 계좌별 배분과 승인 금액은 취급은행에 확인하세요.</p>
      ${mortgage ? `<label class="balance-ltv-control" for="calculator-balance-ltv">담보인정비율(LTV)<select id="calculator-balance-ltv">${[30,40,50,60,70].map(value => `<option value="${value}" ${value === this.ltv ? 'selected' : ''}>${value}%</option>`).join('')}</select></label><div class="mortgage-keyfigures"><div><span>선택 LTV 기준 대출 예상액</span><b id="calculator-balance-mortgage-principal">${money(mortgage.principal)}</b></div><div><span>1년 거치 · 월 이자</span><b>${money(mortgage.graceInterest)}</b></div><div><span>이후 ${this.term - 1}년 · 월 원리금</span><b>${money(mortgage.repayment)}</b></div></div>` : '<p class="stage-note">미적용은 자금 비교용입니다. 의무가입이 면제되는 뜻이 아니며 실제 승인 금액은 은행 심사로 결정됩니다.</p>'}
      <p class="stage-note">공고상 잔금 납부 2~3개월 전 신청 → 은행 심사·중도금 상환 → 모기지 실행·납부 확인 → 입주. ${mortgage ? '대출기간·자녀 수와 수익공유 시나리오는 모기지 추정 항목에서 조정합니다.' : '대출을 적용해 한도와 월 상환액을 확인하세요.'} 이 단지의 연 1.3%를 사용하며 실제 실행 조건은 기금·취급은행 확인이 필요합니다.</p><p class="mortgage-reference"><a href="${SALE_NOTICE_URL}" target="_blank" rel="noreferrer">이 단지 정정공고 ↗</a> · <a href="${MORTGAGE_SOURCE}" target="_blank" rel="noreferrer">KB 상품 참고 ↗</a></p></div>`;
  }

  private paymentGuideMarkup(): string {
    return `<details id="calculator-payment-guide" class="payment-explainer"><summary>납부·대출·입주 순서와 확인할 정보</summary><ol><li><b>계약부터 입주 전</b>: 계약금과 발코니·Ⅱ·Ⅲ 중도금은 자금 준비가 필요합니다. 집단대출 가정에서는 주택 중도금 납부일에 대출이 실행되며, 후불이자를 그때 현금 납부하지 않습니다. Ⅲ 중도금 납부일은 별도 통지입니다.</li><li><b>잔금·입주 정산</b>: 기존 집단대출 원금과 전체 예상 후불이자를 상환합니다. 전용 모기지는 승인·실행된 금액만 주택·발코니 잔금에 한 번 충당합니다.</li><li><b>입주 이후</b>: 거치기간 이자와 이후 월 원리금이 발생합니다. 매각·전액 상환·만기에는 별도의 수익공유 정산이 있습니다.</li></ol><p><span class="assumption-chip">공고 기준</span> 공급가·납부 비율 <span class="assumption-chip">미정</span> 단지 은행·실제 금리·입주지정일 <span class="assumption-chip">가정</span> 4.0%·정산 기준일·부대비용</p><p><a href="../guides/?guide=sale-finance">분퍼빌 입주·자금 계산 가이드</a> · <a href="../documents/">공식 문서·PDF 자료실</a></p></details>`;
  }

  private costDetails(quote: Quote): string {
    return `<details id="calculator-cost-details" class="calculator-card disclosure" ${this.costsEnabled ? 'open' : ''}><summary>입주 부대비용 예산 <span>펼치기</span></summary><div class="disclosure-body">
      <label class="enable-row"><input id="calculator-costs-enabled" type="checkbox" ${this.costsEnabled ? 'checked' : ''}> 미납 부대비용 반영</label>
      <p>입주까지 추가 납부할 예상액만 입력합니다. 계약 시 이미 낸 금액을 다시 넣지 마세요.</p>
      <div class="cost-controls">${COST_ITEMS.map(([id, label, hint]) => `<label class="money-field" for="calculator-cost-${id}"><span>${label}</span><input id="calculator-cost-${id}" data-cost-id="${id}" type="number" min="0" max="10000000000" step="1" inputmode="numeric" value="${this.costs[id]}" ${this.costsEnabled ? '' : 'disabled'}><small>${hint}</small></label>`).join('')}</div>
      <dl><dt class="calculation-total-label">반영한 부대비용 합계</dt><dd id="calculator-extra-cost-total" class="calculation-total">${money(quote.moveIn.additionalCostsWon)}</dd></dl>
      ${this.costsEnabled ? `<dl class="cost-print-summary">${COST_ITEMS.map(([id,label]) => `<dt>${label}</dt><dd>${money(this.costs[id])}</dd>`).join('')}</dl>` : ''}
      <p class="legal-copy">채권은 분양가의 일정 비율로 단정하지 않습니다. 시가표준액·등기 유형·지분·지역·할인율에 따라 다르며 매입 원금과 할인손실을 구분하세요. 예치금은 일반 소비 지출과 다릅니다. <a href="https://nhuf.molit.go.kr/FP/FP07/FP0705/FP070509.jsp" target="_blank" rel="noreferrer">공식 채권 안내 ↗</a></p>
    </div></details>`;
  }

  private resaleDetails(quote: Quote): string {
    const repayment = this.settlementKind === 'repayment';
    const ready = repayment ? this.appraisedPriceWon !== null : this.salePriceWon !== null;
    const value = ready ? quote.mortgage?.settlement : undefined;
    const reasons = {
      'sale-estimate': '감정가격 미입력 · 매도가만 사용한 단순 추정입니다. 은행 정산 확정액이 아닙니다.',
      'sale-price': '가정 매도가를 기준으로 정산합니다. 실제 은행의 감정·신고가격 검증이 우선합니다.',
      'below-appraisal-threshold': '가정 매도가가 감정가격보다 10% 이상 낮아 감정가격을 정산 기준으로 사용합니다.',
      'unnotified-sale-or-appraisal': '매각계획 미통보 가정 · 매도가와 감정가격 중 큰 금액을 정산 기준으로 사용합니다.',
      'repayment-appraisal': '매각 없는 전액 상환 · 감정가격의 평가차익을 정산합니다. 매각 현금이 발생하는 것은 아닙니다.',
    };
    return `<details id="calculator-resale-details" class="calculator-card disclosure"><summary>향후 매각·상환·수익공유 정산 <span>펼치기</span></summary><div class="disclosure-body">
      <p>모기지 추정의 자녀 수·대출 유지기간을 사용합니다. 아래 가격은 모두 가정값이며 실제 시세감정·세금·은행 승인 결과가 아닙니다.</p>
      <div class="mini-controls"><label>정산 방식<select id="calculator-settlement-kind"><option value="sale" ${repayment ? '' : 'selected'}>주택 매각</option><option value="repayment" ${repayment ? 'selected' : ''}>매각 없이 전액 상환·만기</option></select></label></div>
      ${repayment ? '' : `<label class="money-field" for="calculator-sale-price">예상 매도가 · 원<input id="calculator-sale-price" type="number" min="1" max="100000000000" step="1" inputmode="numeric" placeholder="예: 900000000" value="${this.salePriceWon ?? ''}" ${this.mortgageEnabled ? '' : 'disabled'}></label>`}
      <label class="money-field" for="calculator-appraised-price">가정 시세감정가격 · 원${repayment ? ' (필수)' : ' (선택)'}<input id="calculator-appraised-price" type="number" min="1" max="100000000000" step="1" inputmode="numeric" placeholder="예: 1000000000" value="${this.appraisedPriceWon ?? ''}" ${this.mortgageEnabled ? '' : 'disabled'}></label>
      ${repayment ? '' : `<label class="enable-row"><input id="calculator-sale-plan-notified" type="checkbox" ${this.salePlanNotified ? 'checked' : ''}> 매각계획을 은행에 통보한 것으로 가정</label>`}
      <p class="legal-copy">실제 매각계획서는 <b>소유권 이전등기 1개월 전까지</b> 은행에 제출해야 합니다. 모기지 대출 인지세는 은행·고객 각 50%이며, 주택 공급계약 인지세와 별개입니다. <a href="../documents/shinhui-mortgage-product-20261107.pdf" target="_blank" rel="noreferrer">상품설명서 PDF ↗</a> · <a href="../guides/?guide=mortgage-product">핵심·계산 요약 →</a></p>
      ${value && quote.mortgage ? `<p id="calculator-settlement-basis-note" class="legal-copy"><b>${reasons[value.settlementBasisReason]}</b></p><dl>${repayment ? '' : `<dt>가정한 매도가 · 실제 매각 현금</dt><dd>${money(this.salePriceWon!)}</dd>`}<dt>수익공유 정산 기준가격</dt><dd id="calculator-settlement-basis">${money(value.settlementBasisWon)}</dd><dt>대출 유지기간 / 자녀 수</dt><dd>${this.holdingYears}년 / ${this.childCount === 2 ? '2명 이상' : this.childCount + '명'}</dd><dt>취득 기준액 · 공급가+발코니</dt><dd>${money(quote.mortgage.loanBase)}</dd><dt>양(+)의 평가차익</dt><dd>${money(value.appreciationWon)}</dd><dt>기금 정산비율</dt><dd>${value.fundSharePercent}%</dd><dt>${repayment ? '기금 수익공유 정산액' : '− 기금 수익공유 정산액'}</dt><dd id="calculator-fund-settlement">${money(value.fundSettlementWon)}</dd><dt>${repayment ? '남은 대출 원금' : '− 남은 대출 원금'}</dt><dd>${money(value.remainingPrincipalWon)}</dd><dt class="calculation-total-label">${repayment ? '원금 + 기금 정산 준비금' : '세금·매각비용 전 회수액'}</dt><dd id="${repayment ? 'calculator-full-repayment' : 'calculator-resale-proceeds'}" class="calculation-total">${money(repayment ? value.totalLoanSettlementWon : value.netSaleProceedsWon)}</dd></dl>` : `<p id="calculator-settlement-waiting" class="muted-copy">${repayment ? '가정 시세감정가격을 입력하면 전액 상환 준비금을 계산합니다. 일반 모기지·납부 일정 계산은 그대로 유지됩니다.' : '예상 매도가를 입력하세요. 감정가격을 비우면 매도가만 사용한 단순 추정이며 은행 정산 확정액이 아닙니다.'}</p>`}
      <p class="legal-copy"><b>${repayment ? '전액 상환 준비금에는 마지막 미납 이자·세금·감정·말소 비용 등이 포함되지 않습니다.' : '회수액은 순이익이 아닙니다.'}</b> 기존 자기자금·기납부 원리금·취득/양도세·중개/등기 비용 등을 빼지 않았습니다. 손실이면 기금 수익공유금은 0원이지만 손실을 기금이 보전하지 않습니다. 중도상환은 원칙적으로 실행 3년 경과 후 전액이며 부분상환은 불가합니다. 만기 이후로 정산을 미뤄 유리한 비율을 적용하지 않습니다. <b>감정가격이 매도가를 대체하더라도 실제 매각 현금을 늘려 계산하지 않습니다.</b> <a href="${MORTGAGE_CONTRACT}" target="_blank" rel="noreferrer">KB 추가약정·정산표 ↗</a></p>
    </div></details>`;
  }

  private bind(): void {
    if (this.bound) return;
    this.bound = true;
    this.mount.addEventListener('toggle', () => this.syncDisclosureLabels(), true);
    this.mount.addEventListener('input', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.matches('input[type="number"],input[type="date"]')) return;
      this.pendingInputs.delete(input.id);
      this.pendingInputs.add(input.id);
      if (this.inputErrors.has(input.id)) {
        const error = this.draftError(input);
        if (error) this.inputErrors.set(input.id, error);
        else this.inputErrors.delete(input.id);
        this.syncInputErrors();
      }
    });
    this.mount.addEventListener('keydown', event => {
      const input = event.target;
      if (event.key !== 'Enter' || !(input instanceof HTMLInputElement)
        || !input.matches('input[type="number"],input[type="date"]')) return;
      event.preventDefault();
      this.pendingInputs.add(input.id);
      if (this.commitPendingInputs()) this.render();
    });
    this.mount.addEventListener('change', event => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
      // Turning an estimate off discards only its invalid draft, not its last
      // accepted scenario. A user must never get trapped in an enabled section.
      if (control instanceof HTMLInputElement) {
        if (control.id === 'calculator-costs-enabled' && !control.checked) this.discardPendingInputs('input[data-cost-id]');
        if ((control.id === 'calculator-interim-loan-enabled' && !control.checked)
          || (control.name === 'interim-funding' && control.value === 'cash')) this.discardPendingInputs('[data-interim-rate-input],#calculator-move-in-date');
        if (['calculator-mortgage-enabled', 'calculator-balance-mortgage-enabled'].includes(control.id) && !control.checked) this.discardPendingInputs('#calculator-sale-price,#calculator-appraised-price');
      }
      if (control.id === 'calculator-settlement-kind' && control.value === 'repayment') this.discardPendingInputs('#calculator-sale-price');
      if (control instanceof HTMLInputElement && control.matches('input[type="number"],input[type="date"]')) this.pendingInputs.add(control.id);
      if (!this.commitPendingInputs()) { this.render(); return; }
      const checked = control instanceof HTMLInputElement && control.checked;
      if (control instanceof HTMLInputElement && control.name === 'payment-plan') this.plan = control.value as BundangPaymentPlanKind;
      else if (control.id === 'calculator-tax-enabled') this.taxEnabled = checked;
      else if (control instanceof HTMLInputElement && control.name === 'tax-relief-mode') this.taxReliefMode = control.value as TaxReliefMode;
      else if (control instanceof HTMLInputElement && control.name === 'interim-funding') this.interimFunding = control.value as 'cash' | 'loan';
      else if (control.id === 'calculator-costs-enabled') this.costsEnabled = checked;
      else if (control.id === 'calculator-interim-loan-enabled') this.interimFunding = checked ? 'loan' : 'cash';
      else if (['calculator-mortgage-enabled', 'calculator-balance-mortgage-enabled'].includes(control.id)) this.mortgageEnabled = true;
      else if (['calculator-ltv', 'calculator-balance-ltv'].includes(control.id)) this.ltv = Number(control.value) as typeof this.ltv;
      else if (control.id === 'calculator-term') { this.term = Number(control.value) as 20 | 30; this.holdingYears = Math.min(this.holdingYears, this.term); }
      else if (control.id === 'calculator-children') this.childCount = Number(control.value) as BundangMortgageChildCount;
      else if (control.id === 'calculator-settlement-period') this.holdingYears = Number(control.value);
      else if (control.id === 'calculator-settlement-kind') this.settlementKind = control.value as BundangMortgageSettlementKind;
      else if (control.id === 'calculator-sale-plan-notified') this.salePlanNotified = checked;
      this.render();
    });
    this.mount.addEventListener('click', event => {
      const summary = event.target instanceof Element ? event.target.closest('summary') : null;
      const stage = summary?.parentElement;
      if (stage instanceof HTMLDetailsElement && stage.classList.contains('payment-stage')) {
        event.preventDefault();
        this.selectedPaymentDue = stage.open ? null : stage.dataset.paymentStageDue;
        this.syncPaymentStageSelection();
        return;
      }
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (!target || target.disabled) return;
      if (target.hasAttribute('data-close-payment-guide')) { this.closePaymentGuide(); return; }
      if (target.dataset.paymentGuideTarget) { this.openPaymentGuide(target.dataset.paymentGuideTarget); return; }
      if (target.dataset.paymentStageTarget) {
        this.selectedPaymentDue = target.dataset.paymentStageTarget;
        this.syncPaymentStageSelection();
        const destination = this.mount.querySelector<HTMLDetailsElement>(`#${paymentStageId(target.dataset.paymentStageTarget)}`);
        destination?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        destination?.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
        return;
      }
      if (target.id === 'calculator-return-options') { window.location.assign(this.context!.returnUrl!); return; }
      if (target.dataset.calculatorJump) {
        const destination = this.mount.querySelector<HTMLElement>(`#${target.dataset.calculatorJump}`);
        if (!destination) return;
        if (destination instanceof HTMLDetailsElement) destination.open = true;
        this.syncDisclosureLabels();
        destination.scrollIntoView({ behavior: 'smooth', block: 'start' });
        destination.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
        return;
      }
      if (!target.matches('[data-enable-estimate],[data-interim-rate-action],#calculator-print')) return;
      if (!this.commitPendingInputs()) {
        this.mount.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus({ preventScroll: true });
        return;
      }
      if (target.dataset.interimRateAction) {
        const delta = target.dataset.interimRateAction === 'up' ? 1 : -1;
        this.interimRatePercent = Math.max(0, Math.min(150, Math.round(this.interimRatePercent * 10) + delta)) / 10;
      }
      if (target.dataset.enableEstimate === 'tax') this.taxEnabled = true;
      else if (target.dataset.enableEstimate === 'costs') this.costsEnabled = true;
      this.render();
      if (target.id === 'calculator-print') { this.preparePrint(); window.print(); }
      if (target.dataset.enableEstimate) {
        const tax = target.dataset.enableEstimate === 'tax';
        const details = this.mount.querySelector<HTMLDetailsElement>(tax ? '#calculator-tax-details' : '#calculator-cost-details');
        if (!details) return;
        details.open = true;
        this.syncDisclosureLabels();
        details.scrollIntoView({ behavior: 'smooth', block: 'start' });
        details.querySelector<HTMLElement>(tax ? '#calculator-tax-enabled' : '#calculator-cost-stamp')?.focus({ preventScroll: true });
      }
    });
    this.mount.addEventListener('cancel', event => {
      if (event.target instanceof HTMLDialogElement && event.target.id === 'calculator-stage-guide-dialog') {
        event.preventDefault();
        this.closePaymentGuide();
      }
    }, true);
    this.mount.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const dialog = this.mount.querySelector<HTMLDialogElement>('#calculator-stage-guide-dialog[open]');
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]')]
        .filter(node => node.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      const active = document.activeElement;
      if (first && last && (event.shiftKey && active === first || !event.shiftKey && active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    });
    this.mount.addEventListener('close', event => {
      if (event.target instanceof HTMLDialogElement && event.target.id === 'calculator-stage-guide-dialog'
        && !event.target.open && this.paymentGuideDue !== null) this.closePaymentGuide();
    }, true);
  }

  private draftError(input: HTMLInputElement): string | null {
    if (input.disabled) return null;
    if (input.type === 'date') return input.value && input.validity.valid ? null : '2028-02-15~2099-12-31 사이의 유효한 날짜를 입력하세요.';
    if (input.dataset.costId && input.value === '') return null;
    if (['calculator-sale-price', 'calculator-appraised-price'].includes(input.id) && input.value === '') return null;
    if (!input.value || !input.validity.valid || !Number.isFinite(input.valueAsNumber)) {
      if (input.hasAttribute('data-interim-rate-input')) return '금리는 0~15% 범위에서 0.1% 단위로 입력하세요.';
      return input.dataset.costId ? '비용은 0~100억원 범위의 정수로 입력하세요.'
        : input.id === 'calculator-appraised-price' ? '감정가격은 1원~1,000억원 범위의 정수로 입력하거나 비워 두세요.'
        : '매도가는 1원~1,000억원 범위의 정수로 입력하세요.';
    }
    return null;
  }

  private discardPendingInputs(selector: string): void {
    for (const input of this.mount.querySelectorAll<HTMLInputElement>(selector)) {
      this.pendingInputs.delete(input.id);
      this.inputErrors.delete(input.id);
      if (input.dataset.costId) input.value = String(this.costs[input.dataset.costId as CostId]);
      else if (input.hasAttribute('data-interim-rate-input')) input.value = this.interimRatePercent.toFixed(1);
      else if (input.id === 'calculator-move-in-date') input.value = this.assumedMoveInDate;
      else if (input.id === 'calculator-sale-price') input.value = String(this.salePriceWon ?? '');
      else if (input.id === 'calculator-appraised-price') input.value = String(this.appraisedPriceWon ?? '');
    }
  }

  private commitPendingInputs(): boolean {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && this.mount.contains(active)
      && active.matches('input[type="number"],input[type="date"]')) this.pendingInputs.add(active.id);
    const inputs = [...this.pendingInputs].map(id => this.mount.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`))
      .filter((input): input is HTMLInputElement => Boolean(input && !input.disabled));
    this.inputErrors.clear();
    for (const input of inputs) {
      const error = this.draftError(input);
      if (error) this.inputErrors.set(input.id, error);
    }
    this.syncInputErrors();
    if (this.inputErrors.size) return false;
    for (const input of inputs) {
      if (input.hasAttribute('data-interim-rate-input')) this.interimRatePercent = Math.round(input.valueAsNumber * 10) / 10;
      else if (input.id === 'calculator-move-in-date') this.assumedMoveInDate = input.value;
      else if (input.dataset.costId) this.costs[input.dataset.costId as CostId] = input.value ? input.valueAsNumber : 0;
      else if (input.id === 'calculator-sale-price') this.salePriceWon = input.value ? input.valueAsNumber : null;
      else if (input.id === 'calculator-appraised-price') this.appraisedPriceWon = input.value ? input.valueAsNumber : null;
    }
    this.pendingInputs.clear();
    return true;
  }

  private syncInputErrors(): void {
    this.mount.dataset.invalidInputs = String(this.inputErrors.size > 0);
    this.mount.querySelectorAll('.input-error').forEach(node => node.remove());
    this.mount.querySelectorAll('[aria-invalid="true"]').forEach(node => { node.removeAttribute('aria-invalid'); node.removeAttribute('aria-describedby'); });
    for (const [id, message] of this.inputErrors) {
      const input = this.mount.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
      if (!input) continue;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', `${id}-error`);
      const error = document.createElement('p');
      error.id = `${id}-error`;
      error.className = 'input-error';
      error.setAttribute('role', 'alert');
      error.textContent = message;
      (input.closest('.interim-rate-control,.money-field,.date-field') ?? input).after(error);
    }
  }

  private syncDisclosureLabels(): void {
    for (const details of this.mount.querySelectorAll<HTMLDetailsElement>('details')) {
      const summary = details.querySelector<HTMLElement>(':scope > summary');
      if (!summary) continue;
      let action = summary.querySelector<HTMLElement>(':scope > .disclosure-action');
      if (!action) {
        const last = summary.lastElementChild;
        if (last instanceof HTMLElement && /^(펼치기|접기|열기)$/.test(last.textContent?.trim() ?? '')) action = last;
        else { action = document.createElement('span'); summary.append(action); }
        action.classList.add('disclosure-action');
      }
      action.textContent = details.open ? '접기' : '펼치기';
      action.setAttribute('aria-hidden', 'true');
    }
  }

  private preparePrint(): void {
    if (this.restorePrintState) return;
    if (!this.commitPendingInputs()) return;
    const guideDue = this.paymentGuideDue;
    this.closePaymentGuide(false);
    this.render();
    this.refreshCountdowns();
    const ids = ['calculator-option-details', 'calculator-payment-guide'];
    ids.push(...[...this.mount.querySelectorAll<HTMLDetailsElement>('.payment-stage')].map(node => node.id));
    if (this.taxEnabled) ids.push('calculator-tax-details');
    if (this.interimFunding === 'loan') ids.push('calculator-interim-loan-details');
    if (this.mortgageEnabled) ids.push('calculator-mortgage-details');
    if (this.costsEnabled) ids.push('calculator-cost-details');
    if (this.mortgageEnabled && (this.salePriceWon !== null || this.appraisedPriceWon !== null || this.settlementKind === 'repayment')) ids.push('calculator-resale-details');
    const nodes = ids.map(id => this.mount.querySelector<HTMLDetailsElement>(`#${id}`)).filter((node): node is HTMLDetailsElement => Boolean(node));
    const states = nodes.map(node => node.open);
    // Native details[name] enforces one-open-at-a-time even during printing.
    // Temporarily detach that group so every payment plan is included in the PDF.
    const groups = nodes.filter(node => node.hasAttribute('name')).map(node => ({ node, name: node.getAttribute('name')! }));
    groups.forEach(({ node }) => node.removeAttribute('name'));
    nodes.forEach(node => { node.open = true; });
    this.restorePrintState = () => {
      nodes.forEach((node, index) => { node.open = states[index]; });
      groups.forEach(({ node, name }) => node.setAttribute('name', name));
      this.syncDisclosureLabels();
      // afterprint clears restorePrintState just after calling this closure.
      if (guideDue) queueMicrotask(() => this.openPaymentGuide(guideDue));
    };
  }
}

const mount = document.querySelector<HTMLElement>('#calculatorApp');
if (!mount) throw new Error('Missing #calculatorApp mount');
void new CalculatorApp(mount).start();
