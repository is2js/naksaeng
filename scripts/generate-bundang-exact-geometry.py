"""Offline exact metric table; immutable exports remain untouched. No runtime optimizer."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np
from scipy.linalg import null_space, qr
from scipy.optimize import Bounds, LinearConstraint, linprog, minimize

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/game/bundang-exact-geometry.v1.json"
spec = importlib.util.spec_from_file_location("bounded", ROOT / "scripts/generate-bundang-measured-geometry.py")
bounded = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bounded)


def data():
    raw, refs = bounded.source_data()
    code = '''import {build} from 'esbuild';
const b=await build({stdin:{contents:'export {normalizeBundangExactSource,BUNDANG_EXACT_LOGICAL_DOORWAYS} from "./src/game/bundang-exact-source.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
let text='';for await(const chunk of process.stdin)text+=chunk;
const raw=JSON.parse(text);process.stdout.write(JSON.stringify({units:Object.fromEntries(Object.entries(raw).map(([unit,g])=>[unit,m.normalizeBundangExactSource(unit,g)])),gaps:m.BUNDANG_EXACT_LOGICAL_DOORWAYS}));'''
    result = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", code], input=json.dumps(raw), cwd=ROOT, text=True, encoding="utf-8"))
    return raw, result["units"], refs, result["gaps"]


def signature(g):
    def numbers(value):
        if isinstance(value, list): return [numbers(item) for item in value]
        if isinstance(value, dict): return {key: numbers(item) for key, item in value.items()}
        return int(value) if isinstance(value, float) and value.is_integer() else value
    return json.dumps(numbers({"floor": g["floorPolygon"], "walls": [[w["id"], w["a"], w["b"], w["thicknessMeters"]] for w in g["wallSegments"]], "fixtures": [[f["id"], f["boundsMeters"]] for f in g["kitchenFixtures"]]}), ensure_ascii=False, separators=(",", ":"))


class ExactProblem:
    def __init__(self, unit, raw, g, refs, gaps):
        self.unit, self.raw, self.g, self.refs = unit, raw, g, refs
        self.walls = {wall["id"]: wall for wall in g["wallSegments"]}
        self.fixtures = {fixture["id"]: fixture for fixture in g["kitchenFixtures"]}
        coords = [set(), set()]
        for wall in g["wallSegments"]:
            for p in (wall["a"], wall["b"]):
                for axis in (0, 1): coords[axis].add(p[axis])
        for opening in g["openings"] + gaps:
            for p in (opening["a"], opening["b"]):
                for axis in (0, 1): coords[axis].add(p[axis])
        for p in g["floorPolygon"]:
            for axis in (0, 1): coords[axis].add(p[axis])
        for fixture in g["kitchenFixtures"]:
            for index, value in enumerate(fixture["boundsMeters"]): coords[index % 2].add(value)
        self.knots = [sorted(values) for values in coords]
        self.index = {(axis, value): index for index, (axis, value) in enumerate((axis, value) for axis in (0, 1) for value in self.knots[axis])}
        self.n = len(self.index)
        rows, target = [], []
        self.before = []
        for ref in refs:
            a, ra = self.side(ref["negativeSide"], ref)
            b, rb = self.side(ref["positiveSide"], ref)
            self.before.append((b - a) * 1000)
            rows.append(rb - ra); target.append(ref["targetMm"] - (b - a) * 1000)
        for axis in (0, 1):
            zero = 0 if 0 in coords[axis] else min(p[axis] for p in g["floorPolygon"])
            rows.append(self.row(zero, axis)); target.append(0)
        # The offset exterior corner must remain connected, not split open by a least-squares warp.
        if unit == '51A':
            a = self.walls['outer-south-step']['a'][0]
            b = self.walls['bedroom-1-west-after']['a'][0]
            rows.append(self.row(a, 0) - self.row(b, 0)); target.append(0)
        self.A, self.b = np.array(rows), np.array(target)
        rank = np.linalg.matrix_rank(self.A, tol=1e-9)
        if np.linalg.matrix_rank(np.column_stack((self.A, self.b)), tol=1e-9) != rank:
            raise RuntimeError(f'{unit}: inconsistent physical landmark constraints')
        _, _, pivots = qr(self.A.T, pivoting=True)
        self.independent = np.array(pivots[:rank])
        inequalities, lower = [], []
        for axis in (0, 1):
            for a, b in zip(self.knots[axis], self.knots[axis][1:]):
                inequalities.append(self.row(b, axis) - self.row(a, axis))
                lower.append((min(b - a, .05) - (b - a)) * 1000)
        raw_openings = {opening['id']: opening for opening in raw['openings']}
        for opening in g['openings'] + gaps:
            a, b = opening['a'], opening['b']
            axis = 1 if abs(a[0] - b[0]) < 1e-7 else 0
            sign = 1 if b[axis] >= a[axis] else -1
            old = raw_openings.get(opening.get('id'), opening)
            length = abs(old['b'][axis] - old['a'][axis])
            inequalities.append(sign * (self.row(b[axis], axis) - self.row(a[axis], axis)))
            lower.append((length - abs(b[axis] - a[axis])) * 1000)
            if opening.get('type') == 'window': continue
            # A nominal 900mm opening is not 900mm clear when a perpendicular
            # wet/service wall protrudes into its jamb. Preserve real faces.
            other = 1 - axis
            for endpoint in (a, b):
                for wall in g['wallSegments']:
                    if bounded.normal_axis(wall) != axis: continue
                    if float(wall.get('baseMeters', 0)) > .35: continue
                    wa, wb, half = wall['a'], wall['b'], wall['thicknessMeters'] / 2
                    if not min(wa[other], wb[other]) - .03 <= endpoint[other] <= max(wa[other], wb[other]) + .03: continue
                    distance = endpoint[axis] - wa[axis]
                    # Preserve a valid authored jamb clearance. A coincident
                    # centreline is not enough to infer which side a door uses.
                    if abs(distance) < half - 1e-7 or abs(distance) > half + .2: continue
                    side = 1 if distance >= 0 else -1
                    inequalities.append(side * (self.row(endpoint[axis], axis) - self.row(wa[axis], axis)))
                    lower.append((half - abs(distance)) * 1000)
        self.M, self.lower = np.array(inequalities), np.array(lower)

    def row(self, value, axis):
        result = np.zeros(self.n); knots = self.knots[axis]
        if value <= knots[0]: result[self.index[(axis, knots[0])]] = 1
        elif value >= knots[-1]: result[self.index[(axis, knots[-1])]] = 1
        else:
            for a, b in zip(knots, knots[1:]):
                if a <= value <= b:
                    t = (value - a) / (b - a)
                    result[self.index[(axis, a)]] = 1 - t; result[self.index[(axis, b)]] = t
                    break
        return result

    def attached(self, p, axis):
        result, nearest = self.row(p[axis], axis), float('inf')
        tangent = 1 - axis
        for wall in self.g['wallSegments']:
            if bounded.normal_axis(wall) != axis: continue
            a, b, half = wall['a'], wall['b'], wall['thicknessMeters'] / 2
            if not min(a[tangent], b[tangent]) - .05 <= p[tangent] <= max(a[tangent], b[tangent]) + .05: continue
            distance = abs(abs(p[axis] - a[axis]) - half)
            if distance > .3 or distance >= nearest: continue
            nearest, result = distance, self.row(a[axis], axis)
        return result

    def side(self, side, ref):
        axis = 0 if ref['axis'] == 'x' else 1
        if side['kind'] == 'fixture-bound':
            bounds = self.fixtures[side['fixtureId']]['boundsMeters']
            p = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]; p[axis] = bounds[side['index']]
            return p[axis], self.attached(p, axis)
        wall = self.walls[side['wallId']]
        if side['kind'] == 'wall-face':
            return wall['a'][axis] + side['sign'] * wall['thicknessMeters'] / 2, self.row(wall['a'][axis], axis)
        source_axis = 0 if side['axis'] == 'x' else 1
        if side['endpoint'] == 'center':
            return (wall['a'][source_axis] + wall['b'][source_axis]) / 2, (self.row(wall['a'][source_axis], source_axis) + self.row(wall['b'][source_axis], source_axis)) / 2
        return wall[side['endpoint']][source_axis], self.row(wall[side['endpoint']][source_axis], source_axis)

    def validate(self, x):
        if np.max(np.abs(self.A @ x - self.b)) > .001: raise RuntimeError(f'{self.unit}: metric residual')
        if np.min(self.M @ x - self.lower) < -.001: raise RuntimeError(f'{self.unit}: opening/monotonicity violation')
        if np.max(np.abs(x)) > 1000: raise RuntimeError(f'{self.unit}: unexpected displacement over 1m')

    def solve(self):
        # Start from a global minimum-L1 feasible displacement, not an arbitrary
        # LP corner at +/-1m (degenerate active sets can fool SLSQP's stop test).
        feasible = linprog(np.concatenate((np.zeros(self.n), np.ones(self.n))),
                           A_ub=np.vstack((np.column_stack((-self.M, np.zeros_like(self.M))),
                               np.column_stack((np.eye(self.n), -np.eye(self.n))),
                               np.column_stack((-np.eye(self.n), -np.eye(self.n))))),
                           b_ub=np.concatenate((-self.lower, np.zeros(2 * self.n))),
                           A_eq=np.column_stack((self.A[self.independent], np.zeros((len(self.independent), self.n)))),
                           b_eq=self.b[self.independent],
                           bounds=[(-1000, 1000)] * self.n + [(0, 1000)] * self.n, method='highs')
        if not feasible.success: raise RuntimeError(f'{self.unit}: physical constraints infeasible: {feasible.message}')
        origin = np.linalg.lstsq(self.A, self.b / 1000, rcond=None)[0]
        basis = null_space(self.A)
        projected = self.M @ basis
        rhs = self.lower / 1000 - self.M @ origin
        meaningful = np.linalg.norm(projected, axis=1) > 1e-9
        if np.any(rhs[~meaningful] > 1e-8): raise RuntimeError(f'{self.unit}: inconsistent implied inequality')
        # Remove equality-implied active rows: leaving a zero row in SLSQP
        # incorrectly stopped 51A at an arbitrary feasible LP corner.
        constraint = LinearConstraint(projected[meaningful], rhs[meaningful], np.inf)
        initial = basis.T @ (feasible.x[:self.n] / 1000 - origin)
        result = minimize(lambda z: np.dot(z, z), initial, jac=lambda z: 2 * z,
                          method='SLSQP', constraints=[constraint],
                          options={'ftol': 1e-12, 'maxiter': 2000})
        if not result.success: raise RuntimeError(f'{self.unit}: {result.message}')
        x = np.round((origin + basis @ result.x) * 1000, 6); self.validate(x); return x

    def output(self, x):
        return {'sourceSignature': signature(self.raw), 'normalizedSourceSignature': signature(self.g),
                'coordinateOffsets': {name: [[value, float(x[self.index[(axis, value)]] / 1000)] for value in self.knots[axis]] for axis, name in enumerate(('x', 'y'))},
                'maxDisplacementMm': round(float(np.max(np.abs(x))), 6),
                'dimensions': [{'id': ref['id'], 'targetMm': ref['targetMm'], 'normalizedBeforeMm': round(before, 6), 'afterMm': round(float(before + row @ x), 6)} for ref, before, row in zip(self.refs, self.before, self.A[:len(self.refs)])]}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    raw, normalized, refs, gaps = data()
    recorded = json.loads(OUTPUT.read_text(encoding='utf-8')) if args.check else None
    result = {'schemaVersion': 1, 'revision': 'bundang-measured-geometry-v2-exact', 'units': {}}
    for unit, g in normalized.items():
        p = ExactProblem(unit, raw[unit], g, [ref for ref in refs if ref['unitType'] == unit], gaps.get(unit, []))
        if args.check:
            x = np.zeros(p.n)
            for axis, name in enumerate(('x', 'y')):
                for value, delta in recorded['units'][unit]['coordinateOffsets'][name]: x[p.index[(axis, value)]] = delta * 1000
            p.validate(x)
        else: x = p.solve()
        result['units'][unit] = p.output(x)
        print(unit, 'exact dimensions', len(p.refs), 'max movement mm', result['units'][unit]['maxDisplacementMm'], flush=True)
    if args.check:
        if result != recorded: raise RuntimeError('Committed exact geometry table is stale')
        print('Exact metric table: passed')
    else: OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__': main()
