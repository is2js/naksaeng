/**
 * Pre-tax sale/valuation scenario for the dedicated shared-appreciation loan.
 * The acquisition base includes the adjusted supply price and balcony extension,
 * but not option II/III. This is not a lender decision or an actual appraisal.
 */
export const BUNDANG_MORTGAGE_SETTLEMENT_SOURCE_V1 = Object.freeze({
  checkedAt: '2026-11-07',
  agreementRevisedAt: '2025-12-01',
  agreementUrl: 'https://img2.kbstar.com/obj/ocommon/251201_Contract_6.pdf',
  productUrl: 'https://obank.kbstar.com/quics?cc=b032425%3Ab033525&isNew=N&page=C020709&prcode=LN40001026',
  productExplanationUrl: 'documents/shinhui-mortgage-product-20261107.pdf',
  productExplanationVersion: '제공 스캔에 개정일 미표기 · 2026-11-07 대조',
});

export type BundangMortgageSettlementKind = 'sale' | 'repayment';
export type BundangMortgageSettlementBasisReason = 'sale-estimate' | 'sale-price'
  | 'below-appraisal-threshold' | 'unnotified-sale-or-appraisal' | 'repayment-appraisal';

export interface BundangMortgageSettlementInputV1 {
  /** Adjusted supply price + adjusted balcony extension; excludes option II/III. */
  loanBaseWon: number;
  principalWon: number;
  annualRateBps?: number;
  termYears: 20 | 30;
  /** Completed years after loan execution, not the total contractual term. */
  holdingYears: number;
  /** Eligible children under the agreement; any count >= 2 uses the final column. */
  childCount: number;
  /** Hypothetical sale price, before tax/costs. Ignored as cash in repayment mode. */
  salePriceWon: number;
  /** No sale: full early/maturity repayment is valued at the lender's appraisal. */
  settlementKind?: BundangMortgageSettlementKind;
  /** A planning assumption, not an actual lender appraisal. Required for repayment mode. */
  appraisedPriceWon?: number;
  /** Whether the sale plan was notified; the product requires notice one month before registration. */
  salePlanNotified?: boolean;
}

export interface BundangMortgageSettlementQuoteV1 {
  settlementKind: BundangMortgageSettlementKind;
  /** Price used for profit sharing; may differ from the actual sale cash. */
  settlementBasisWon: number;
  settlementBasisReason: BundangMortgageSettlementBasisReason;
  /** Missing appraisal means a simple estimate, not a verified settlement amount. */
  appraisalRequired: boolean;
  /** Original contractual LTV, or truncated actual LTV when the 4억원 cap applies. */
  effectiveLtvPercent: number;
  fundSharePercent: number;
  appreciationWon: number;
  fundSettlementWon: number;
  remainingPrincipalWon: number;
  /** Sale price - remaining loan principal - fund settlement. NOT net profit. Zero when there is no sale. */
  netSaleProceedsWon: number;
  /** Debt principal plus fund share at settlement; excludes final accrued interest, tax and fees. */
  totalLoanSettlementWon: number;
  repaidPrincipalWon: number;
  paidInterestWon: number;
}

// KB additional agreement, article 2, page 2. Columns are LTV 70/60/50/40/30,
// each followed by eligible child counts 0/1/2+. Every yearly row is retained:
// interpolating between the short LH summary's 9/14/19/24-year rows is wrong.
const FUND_SHARE_ROWS: Readonly<Record<number, readonly number[]>> = Object.freeze({
  9:  [50, 40, 30, 45, 35, 25, 40, 30, 20, 35, 25, 15, 30, 20, 10],
  10: [48, 38, 28, 43, 33, 23, 38, 28, 18, 33, 23, 13, 28, 18, 10],
  11: [46, 36, 26, 41, 31, 21, 36, 26, 16, 31, 21, 10, 26, 15, 10],
  12: [44, 34, 24, 39, 29, 19, 34, 24, 14, 29, 19, 10, 24, 15, 10],
  13: [42, 32, 22, 37, 27, 17, 32, 22, 12, 27, 17, 10, 22, 15, 10],
  14: [40, 30, 20, 35, 25, 15, 30, 20, 10, 25, 15, 10, 20, 15, 10],
  15: [38, 28, 18, 33, 23, 13, 28, 18, 10, 23, 15, 10, 20, 15, 10],
  16: [36, 26, 16, 31, 21, 10, 26, 15, 10, 20, 15, 10, 20, 15, 10],
  17: [34, 24, 14, 29, 19, 10, 24, 15, 10, 20, 15, 10, 20, 15, 10],
  18: [32, 22, 12, 27, 17, 10, 22, 15, 10, 20, 15, 10, 20, 15, 10],
  19: [30, 20, 10, 25, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10],
  20: [28, 18, 10, 23, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10],
  21: [26, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10],
  22: [24, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10],
  23: [22, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10],
  24: [20, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10, 20, 15, 10],
});

const CONTRACTUAL_LTV_CHOICES = [30, 40, 50, 60, 70] as const;
const PRINCIPAL_CAP_WON = 400_000_000;

function requireWon(value: number, label: string, positive = false): void {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new Error(`${label}은 ${positive ? '양의' : '0 이상의'} 원 단위 안전 정수여야 합니다.`);
  }
}

function effectiveLtv(loanBaseWon: number, principalWon: number): number {
  if (principalWon > PRINCIPAL_CAP_WON
    || principalWon < Math.round(loanBaseWon * 0.3)
    || principalWon > Math.round(loanBaseWon * 0.7)) {
    throw new Error('전용 모기지는 주택가격의 30~70%, 최대 4억원 범위여야 합니다.');
  }
  // Retain an exact selected bucket despite one-won principal rounding.
  const contractual = CONTRACTUAL_LTV_CHOICES.find((ltv) => Math.round(loanBaseWon * ltv / 100) === principalWon);
  if (contractual !== undefined) return contractual;
  // The agreement permits between-bucket interpolation for a capped loan,
  // not an invented arbitrary LTV loan product.
  if (principalWon !== PRINCIPAL_CAP_WON) {
    throw new Error('담보인정비율은 30·40·50·60·70% 또는 4억원 상한 적용액이어야 합니다.');
  }
  return Math.floor(principalWon * 100 / loanBaseWon);
}

function sharePercent(ltv: number, holdingYears: number, childCount: number): number {
  const row = FUND_SHARE_ROWS[Math.min(24, Math.max(9, holdingYears))]!;
  const children = Math.min(2, childCount);
  const lowerLtv = Math.floor(ltv / 10) * 10;
  const upperLtv = Math.ceil(ltv / 10) * 10;
  const lowerShare = row[(70 - lowerLtv) / 10 * 3 + children]!;
  if (lowerLtv === upperLtv) return lowerShare;
  const upperShare = row[(70 - upperLtv) / 10 * 3 + children]!;
  return lowerShare + (upperShare - lowerShare) * (ltv - lowerLtv) / 10;
}

function settlementBasis(input: BundangMortgageSettlementInputV1): Pick<BundangMortgageSettlementQuoteV1,
  'settlementKind' | 'settlementBasisWon' | 'settlementBasisReason' | 'appraisalRequired'> {
  const settlementKind = input.settlementKind ?? 'sale';
  if (settlementKind !== 'sale' && settlementKind !== 'repayment') throw new Error('정산 방식은 매각 또는 매각 없는 전액 상환이어야 합니다.');
  if (input.salePlanNotified !== undefined && typeof input.salePlanNotified !== 'boolean') {
    throw new Error('매각계획 통보 여부를 확인하세요.');
  }
  if (input.appraisedPriceWon !== undefined) requireWon(input.appraisedPriceWon, '가정 시세감정가격');
  if (settlementKind === 'repayment') {
    if (input.appraisedPriceWon === undefined) throw new Error('매각 없는 전액 상환은 가정 시세감정가격을 입력해야 합니다.');
    return { settlementKind, settlementBasisWon: input.appraisedPriceWon, settlementBasisReason: 'repayment-appraisal', appraisalRequired: false };
  }
  if (input.appraisedPriceWon === undefined) {
    return { settlementKind, settlementBasisWon: input.salePriceWon, settlementBasisReason: 'sale-estimate', appraisalRequired: true };
  }
  // Product sections 6–7: an unnotified sale uses the higher of reported sale
  // and appraisal. A notified sale priced >=10% below appraisal uses appraisal.
  // BigInt retains the exact 90% boundary even for safe-integer won inputs.
  const unnotified = input.salePlanNotified === false;
  const belowThreshold = BigInt(input.salePriceWon) * 10n <= BigInt(input.appraisedPriceWon) * 9n;
  return {
    settlementKind,
    settlementBasisWon: unnotified ? Math.max(input.salePriceWon, input.appraisedPriceWon)
      : belowThreshold ? input.appraisedPriceWon : input.salePriceWon,
    settlementBasisReason: unnotified ? 'unnotified-sale-or-appraisal'
      : belowThreshold ? 'below-appraisal-threshold' : 'sale-price',
    appraisalRequired: false,
  };
}

/**
 * Amounts are estimates rounded to the nearest won after an unrounded monthly
 * amortization schedule (12 interest-only months, then level installments).
 * A lender's appraisal, daily interest and final-payment rounding may differ.
 * No acquisition/selling tax, brokerage, appraisal costs or future tax refund
 * are deducted. A negative sale proceeds value means additional cash is needed.
 */
export function calculateBundangMortgageSettlement(
  input: BundangMortgageSettlementInputV1,
): BundangMortgageSettlementQuoteV1 {
  requireWon(input.loanBaseWon, '주택가격', true);
  requireWon(input.principalWon, '대출 원금', true);
  requireWon(input.salePriceWon, '가정 매각가격');
  const basis = settlementBasis(input);
  const annualRateBps = input.annualRateBps ?? 130;
  if (!Number.isInteger(annualRateBps) || annualRateBps < 0 || annualRateBps > 10_000) {
    throw new Error('연 이율은 0~100% 범위의 유효한 basis point 정수여야 합니다.');
  }
  if (input.termYears !== 20 && input.termYears !== 30) throw new Error('대출기간은 20년 또는 30년이어야 합니다.');
  if (!Number.isInteger(input.holdingYears) || input.holdingYears < 3 || input.holdingYears > input.termYears) {
    throw new Error('정산 시점은 실행 후 3년부터 약정 만기까지의 정수 연도여야 합니다.');
  }
  if (!Number.isSafeInteger(input.childCount) || input.childCount < 0) {
    throw new Error('자녀 수는 0 이상의 정수여야 합니다.');
  }
  const effectiveLtvPercent = effectiveLtv(input.loanBaseWon, input.principalWon);
  const fundSharePercent = sharePercent(effectiveLtvPercent, input.holdingYears, input.childCount);
  const monthlyRate = annualRateBps / 10_000 / 12;
  const repaymentMonths = input.termYears * 12 - 12;
  const payment = monthlyRate === 0
    ? input.principalWon / repaymentMonths
    : input.principalWon * monthlyRate / -Math.expm1(-repaymentMonths * Math.log1p(monthlyRate));
  const elapsedMonths = input.holdingYears * 12;
  let balance = input.principalWon;
  let accruedInterest = 0;
  for (let month = 1; month <= elapsedMonths; month += 1) {
    const interest = balance * monthlyRate;
    accruedInterest += interest;
    if (month > 12) {
      balance = Math.max(0, balance - Math.min(balance, payment - interest));
    }
  }
  const remainingPrincipalWon = input.holdingYears === input.termYears ? 0 : Math.round(balance);
  const appreciationWon = Math.max(0, basis.settlementBasisWon - input.loanBaseWon);
  const fundSettlementWon = Math.round(appreciationWon * fundSharePercent / 100);
  return {
    ...basis,
    effectiveLtvPercent,
    fundSharePercent,
    appreciationWon,
    fundSettlementWon,
    remainingPrincipalWon,
    netSaleProceedsWon: basis.settlementKind === 'sale'
      ? input.salePriceWon - remainingPrincipalWon - fundSettlementWon : 0,
    totalLoanSettlementWon: remainingPrincipalWon + fundSettlementWon,
    repaidPrincipalWon: input.principalWon - remainingPrincipalWon,
    paidInterestWon: Math.round(accruedInterest),
  };
}
