import { createServer } from 'vite';

// Read-only reporting: print to stdout, never rewrite a source snapshot or guide.
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, logLevel: 'silent' });
try {
  const { readBundangPrototypeApartments } = await server.ssrLoadModule('/src/game/test-support/bundang-prototypes.ts');
  const { BUNDANG_MEASURED_DIMENSIONS, resolveBundangMeasuredDimension } = await server.ssrLoadModule('/src/game/bundang-measured-dimensions.ts');
  const { applyBundangMeasuredGeometry } = await server.ssrLoadModule('/src/game/bundang-measured-geometry.ts');
  const apartments = await readBundangPrototypeApartments();
  const afterApartments = new Map([...apartments].map(([unit, source]) => {
    const calibrated = structuredClone(source);
    if (!applyBundangMeasuredGeometry(calibrated)) throw new Error(`Calibration not applied: ${unit}`);
    return [unit, calibrated];
  }));
  const rows = BUNDANG_MEASURED_DIMENSIONS.map(reference => {
    const before = resolveBundangMeasuredDimension(apartments.get(reference.unitType).geometry, reference);
    const after = resolveBundangMeasuredDimension(afterApartments.get(reference.unitType).geometry, reference);
    if (!before.valid || !after.valid) throw new Error(`${reference.unitType}:${reference.id}: ${before.reason || after.reason}`);
    const beforeError = before.distanceMeters * 1000 - reference.targetMm;
    const afterError = after.distanceMeters * 1000 - reference.targetMm;
    if (Math.abs(afterError) > Math.abs(beforeError) + .001) throw new Error(`Error worsened: ${reference.unitType}:${reference.id}`);
    let reason = Math.abs(afterError) < .00001
      ? Math.abs(beforeError) < .00001 ? '기존 일치 유지' : '목표 일치'
      : Math.abs(afterError) < .5 ? '1mm 표시 기준 일치'
        : Math.abs(afterError) < Math.abs(beforeError) - .001 ? '50mm 제한 보정·잔여 차이'
          : '외곽·공유벽·50mm 제한으로 유지';
    if (reference.unitType === '55B') reason = '55B v2 도면 비례 정본·목표 일치';
    if (reference.kind === 'reference-span') reason = `열린/부분 기준선; ${reason}`;
    if (reference.provenance.targetConfidence === 'inferred-decimal') reason = `1.8m 잠정; ${reason}`;
    return { unitType: reference.unitType, id: reference.id, roomId: reference.roomId, kind: reference.kind,
      targetMm: reference.targetMm, beforeMm: Number((before.distanceMeters * 1000).toFixed(6)),
      afterMm: Number((after.distanceMeters * 1000).toFixed(6)),
      beforeErrorMm: Number(beforeError.toFixed(6)), afterErrorMm: Number(afterError.toFixed(6)),
      startMeters: after.startMeters, endMeters: after.endMeters, reason };
  });
  const units = ['51A', '55A', '55B', '59A'];
  const summary = units.map(unitType => ({ unitType, count: rows.filter(row => row.unitType === unitType).length,
    beforeTotalAbsErrorMm: Number(rows.filter(row => row.unitType === unitType).reduce((total, row) => total + Math.abs(row.beforeErrorMm), 0).toFixed(3)),
    afterTotalAbsErrorMm: Number(rows.filter(row => row.unitType === unitType).reduce((total, row) => total + Math.abs(row.afterErrorMm), 0).toFixed(3)) }));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ schemaVersion: 1, summary, rows }, null, 2));
  else {
    const format = value => (Math.round(value) || 0).toLocaleString('en-US');
    const signed = value => `${Math.round(value) > 0 ? '+' : ''}${format(value)}`;
    const roomLabels = { 'kitchen-dining': '주방', 'dress-room': '드레스룸', 'bedroom-1': '침실1', living: '거실', 'bedroom-2': '침실2', 'bedroom-3': '침실3', 'alpha-room': '알파룸' };
    for (const unit of units) {
      console.log(`## ${unit}\n`);
      console.log('| 항목 | 구분 | 도면 목표 | 모델 전 | 모델 후 | 잔여(후−목표) | 사유 |');
      console.log('| --- | --- | ---: | ---: | ---: | ---: | --- |');
      for (const row of rows.filter(row => row.unitType === unit)) {
        const dimension = row.id === 'living-north-width' ? '상부 폭' : row.id === 'living-south-width' ? '하부 폭' : row.id.endsWith('width') ? '폭' : '깊이';
        console.log(`| ${roomLabels[row.roomId]} ${dimension} | ${row.kind === 'reference-span' ? '기준선' : '실제 면'} | ${format(row.targetMm)} | ${format(row.beforeMm)} | ${format(row.afterMm)} | ${signed(row.afterErrorMm)} | ${row.reason} |`);
      }
      console.log('');
    }
    console.log('합계(반올림 전 절대오차, mm): ' + summary.map(row => `${row.unitType} ${row.beforeTotalAbsErrorMm.toFixed(3)} → ${row.afterTotalAbsErrorMm.toFixed(3)}`).join(' / '));
  }
} finally {
  await server.close();
}
