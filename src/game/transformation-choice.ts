/** Stable transformation IDs and public asset paths; the pigmy remains a candidate. */
export const TRANSFORMATION_CHOICES = [
  { id: 'pigmy', label: '피그미', url: 'assets/transformations/pigmy/animation.json' },
  { id: 'hooded-brute', label: '두건덩치', url: 'assets/transformations/M030-R3/animation.json' },
  { id: 'mummy-king', label: '머미킹', url: 'assets/transformations/M006-R3/animation.json' },
  { id: 'iron-golem', label: '아이언골렘', url: 'assets/transformations/M034-R3/animation.json' },
  { id: 'leopard', label: '표범', url: 'assets/transformations/M210-R3/animation.json' },
] as const;

export type TransformationChoice = typeof TRANSFORMATION_CHOICES[number];

/** Pick uniformly from successfully loaded candidates, never from missing assets. */
export function chooseTransformation(
  availableIds: Iterable<string>,
  random: number = Math.random(),
): TransformationChoice | null {
  if (!Number.isFinite(random) || random < 0 || random >= 1) return null;
  const available = new Set(availableIds);
  const candidates = TRANSFORMATION_CHOICES.filter(({ id }) => available.has(id));
  return candidates.length ? candidates[Math.floor(random * candidates.length)] : null;
}
