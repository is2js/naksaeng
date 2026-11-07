import type { BundangPaymentTarget } from './bundang-sale-finance';

/** Public facts only. Never publish a signed contract, household or bank account. */
export const BUNDANG_EXECUTED_CONTRACT_REVIEW_V1 = Object.freeze({
  reviewedAt: '2026-11-07',
  title: '아파트·추가선택품목Ⅰ·Ⅱ 공급계약서 제1조 대조',
  scope: '신규 본청약 55B · 5층 이상 · 발코니 확장 · 천장형 시스템 에어컨(삼성) 계약서 일부',
  limitation: '사전청약·다른 평형·다른 에어컨 구성·추가선택품목Ⅲ은 기존 공고 기준을 유지합니다.',
});

export const BUNDANG_PAYMENT_ITEM_LABELS: Readonly<Record<BundangPaymentTarget, string>> = Object.freeze({
  supply: '아파트 공급대금',
  balcony: '추가선택품목Ⅰ · 발코니 확장',
  'option-ii': '추가선택품목Ⅱ · 천장형 시스템에어컨',
  'option-iii': '추가선택품목Ⅲ · 기타 옵션',
});

/**
 * Disclosure only: the executed supply contract splits the amount due at move-in
 * into its printed balance and housing-city-fund columns. The sum remains the
 * existing full balance. Neither column is a second loan or a cash receipt.
 */
export function contractSupplyBalanceBreakdown(totalBalanceWon: number, housingCityFundWon: number): {
  totalBalanceWon: number;
  contractBalanceWon: number;
  housingCityFundWon: number;
} {
  for (const value of [totalBalanceWon, housingCityFundWon]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('잔금과 융자금은 0 이상의 안전한 원 단위 정수여야 합니다.');
  }
  const fund = Math.min(totalBalanceWon, housingCityFundWon);
  return { totalBalanceWon, contractBalanceWon: totalBalanceWon - fund, housingCityFundWon: fund };
}
