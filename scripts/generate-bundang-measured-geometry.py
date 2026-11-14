"""Offline bounded metric calibration. Requires numpy/scipy, never used at runtime.

Read immutable exported maps and the reviewed TypeScript dimension contract; solve
the three bounded shared-wall problems, then write only their correction table.
55B v2 is authored separately; its historical v1 row is retained, never re-solved.
Exterior meshes and floor polygons are not optimization variables. --check checks
the committed table without running an optimizer or changing any file.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, NonlinearConstraint, minimize

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/game/bundang-measured-geometry.v1.json"
LIMIT = 49.9999  # mm; retain a rounding margin below the actual 50 mm contract


def source_data():
    catalog = json.loads((ROOT / "public/generated/catalog.v1.json").read_text(encoding="utf-8"))
    result = {}
    for entry in catalog["maps"]:
        unit = entry.get("unitType")
        if (unit not in ("51A", "55A", "59A") or unit in result
                or not entry["id"].startswith("bundang-first-village-")):
            continue
        manifest = ROOT / "public" / entry["manifestUrl"]
        for path in sorted((manifest.parent / "chunks").glob("*.json")):
            for obj in json.loads(path.read_text(encoding="utf-8")).get("objects", []):
                if obj.get("type") == "enterable-apartment-unit-v1":
                    result[unit] = obj["geometry"]
    code = """import {build} from 'esbuild';
const b=await build({stdin:{contents:'export { BUNDANG_MEASURED_DIMENSIONS } from "./src/game/bundang-measured-dimensions.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
process.stdout.write(JSON.stringify(m.BUNDANG_MEASURED_DIMENSIONS));"""
    refs = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", code], cwd=ROOT, text=True, encoding="utf-8"))
    return result, refs


def normal_axis(wall):
    return 0 if abs(wall["a"][0] - wall["b"][0]) < 1e-8 else 1


class Problem:
    def __init__(self, geometry, refs):
        self.g, self.refs = geometry, refs
        self.unit = refs[0]["unitType"]
        self.walls = {w["id"]: w for w in geometry["wallSegments"]}
        self.fixture = {w["id"]: w for w in geometry["kitchenFixtures"]}
        centers = [set(), set()]
        for wall in self.walls.values():
            if wall["kind"] != "exterior":
                for axis in (0, 1):
                    centers[axis].update((wall["a"][axis], wall["b"][axis]))
        for opening in geometry["openings"]:
            if not str(opening["id"]).startswith("outer-"):
                for axis in (0, 1):
                    centers[axis].update((opening["a"][axis], opening["b"][axis]))
        for ref in refs:
            for side in (ref["negativeSide"], ref["positiveSide"]):
                if side["kind"] == "fixture-bound":
                    axis = side["index"] % 2
                    centers[axis].add(self.fixture[side["fixtureId"]]["boundsMeters"][side["index"]])
        floor = np.array(geometry["floorPolygon"])
        self.pinned = []
        for axis in (0, 1):
            self.pinned.append({float(floor[:, axis].min()), float(floor[:, axis].max())})
            centers[axis].update(self.pinned[axis])
        self.knots = [sorted(c) for c in centers]
        self.indices = {}
        self.names = []
        for axis in (0, 1):
            for coordinate in self.knots[axis]:
                self.indices[(axis, coordinate)] = len(self.names)
                self.names.append(("coordinate", axis, coordinate))
        self.thickness_indices = {}
        self.wall_thickness_index = {}
        for wall in self.walls.values():
            if wall["kind"] == "exterior":
                continue
            key = (normal_axis(wall), wall["a"][normal_axis(wall)], wall["thicknessMeters"])
            if key not in self.thickness_indices:
                self.thickness_indices[key] = len(self.names)
                self.names.append(("thickness", *key))
            self.wall_thickness_index[wall["id"]] = self.thickness_indices[key]
        self.n = len(self.names)
        self.rows = []
        self.base = []
        for ref in refs:
            negative, negative_row = self.side(ref["negativeSide"], ref)
            positive, positive_row = self.side(ref["positiveSide"], ref)
            self.base.append((positive - negative) * 1000 - ref["targetMm"])
            self.rows.append(positive_row - negative_row)
        self.A = np.array(self.rows)
        self.base = np.array(self.base)
        self.corners = []
        for wall in self.walls.values():
            if wall["kind"] == "exterior":
                continue
            axis = normal_axis(wall)
            for endpoint in ("a", "b"):
                matrix = np.array([self.wall_endpoint_row(wall, endpoint, 0), self.wall_endpoint_row(wall, endpoint, 1)])
                self.corners.append(matrix)
                # The final faces, including the ends, must also remain within 50 mm.
                for sign in (-1, 1):
                    face = matrix.copy()
                    face[axis, self.wall_thickness_index[wall["id"]]] += sign / 2
                    self.corners.append(face)
        for opening in geometry["openings"]:
            if str(opening["id"]).startswith("outer-"):
                continue
            for endpoint in ("a", "b"):
                self.corners.append(np.array([self.coordinate_row(opening[endpoint][axis], axis) for axis in (0, 1)]))
        def attached_points(node):
            if isinstance(node, list):
                for item in node:
                    attached_points(item)
            elif isinstance(node, dict):
                for key, value in node.items():
                    if key == "cells":
                        continue
                    if (key.endswith("BoundsMeters") or key == "boundsMeters") and isinstance(value, list) and len(value) == 4:
                        center = [(value[0] + value[2]) / 2, (value[1] + value[3]) / 2]
                        for x in (value[0], value[2]):
                            for y in (value[1], value[3]):
                                self.corners.append(np.array([self.attached_row([x, center[1]], 0), self.attached_row([center[0], y], 1)]))
                    elif key in ("positionMeters", "labelPointMeters", "textPoint", "startMeters", "endMeters", "a", "b") and isinstance(value, list) and len(value) >= 2:
                        self.corners.append(np.array([self.attached_row(value, axis) for axis in (0, 1)]))
                    elif key in ("footprintPolygonMeters", "polygon", "wallAttachmentSegmentMeters") and isinstance(value, list):
                        for item in value:
                            if isinstance(item, list) and len(item) >= 2:
                                self.corners.append(np.array([self.attached_row(item, axis) for axis in (0, 1)]))
                    else:
                        attached_points(value)
        for key in ("roomZones", "solidBlocks", "ceilingPanels", "kitchenFixtures", "interiorProps", "optionAnchors"):
            attached_points(geometry.get(key))
        self.corners = np.array(self.corners)

    def empty(self):
        return np.zeros(self.n)

    def coordinate_row(self, value, axis):
        row = self.empty()
        knots = self.knots[axis]
        if value <= knots[0]:
            row[self.indices[(axis, knots[0])]] = 1
        elif value >= knots[-1]:
            row[self.indices[(axis, knots[-1])]] = 1
        else:
            for before, after in zip(knots, knots[1:]):
                if before <= value <= after:
                    weight = (value - before) / (after - before)
                    row[self.indices[(axis, before)]] = 1 - weight
                    row[self.indices[(axis, after)]] = weight
                    break
        return row

    def wall_endpoint_row(self, wall, endpoint, axis):
        point = wall[endpoint]
        if wall["kind"] == "exterior":
            return self.empty()
        # Endpoints on perpendicular exterior walls remain on that exact boundary.
        if axis != normal_axis(wall):
            other = 1 - axis
            for exterior in self.walls.values():
                if exterior["kind"] != "exterior" or normal_axis(exterior) != axis:
                    continue
                if (abs(point[axis] - exterior["a"][axis]) < 1e-7
                        and min(exterior["a"][other], exterior["b"][other]) - 1e-7 <= point[other]
                        <= max(exterior["a"][other], exterior["b"][other]) + 1e-7):
                    return self.empty()
        return self.coordinate_row(point[axis], axis)

    def attached_row(self, point, axis):
        best_distance = float("inf")
        result = self.coordinate_row(point[axis], axis)
        tangent = 1 - axis
        for wall in self.walls.values():
            if normal_axis(wall) != axis:
                continue
            a, b = wall["a"], wall["b"]
            if not min(a[tangent], b[tangent]) - .05 <= point[tangent] <= max(a[tangent], b[tangent]) + .05:
                continue
            signed = point[axis] - a[axis]
            distance = abs(abs(signed) - wall["thicknessMeters"] / 2)
            if distance > .3 or distance >= best_distance:
                continue
            best_distance = distance
            if wall["kind"] == "exterior":
                result = self.empty()
            else:
                result = self.coordinate_row(a[axis], axis)
                result[self.wall_thickness_index[wall["id"]]] += np.sign(signed) / 2
        return result

    def side(self, side, ref):
        axis = 0 if ref["axis"] == "x" else 1
        if side["kind"] == "wall-face":
            wall = self.walls[side["wallId"]]
            value = wall["a"][axis] + side["sign"] * wall["thicknessMeters"] / 2
            row = self.wall_endpoint_row(wall, "a", axis)
            if wall["kind"] != "exterior":
                row[self.wall_thickness_index[wall["id"]]] += side["sign"] / 2
            return value, row
        if side["kind"] == "wall-coordinate":
            wall = self.walls[side["wallId"]]
            source_axis = 0 if side["axis"] == "x" else 1
            if side["endpoint"] == "center":
                return (wall["a"][source_axis] + wall["b"][source_axis]) / 2, (
                    self.wall_endpoint_row(wall, "a", source_axis) + self.wall_endpoint_row(wall, "b", source_axis)) / 2
            return wall[side["endpoint"]][source_axis], self.wall_endpoint_row(wall, side["endpoint"], source_axis)
        if side["kind"] == "fixture-bound":
            bounds = self.fixture[side["fixtureId"]]["boundsMeters"]
            point = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
            point[axis] = bounds[side["index"]]
            return point[axis], self.attached_row(point, axis)
        raise ValueError(side)

    def locked_control(self, name):
        if name[0] == "coordinate" and name[2] in self.pinned[name[1]]:
            return True
        # Grid-safe alpha-door aperture/jamb, retained from the accepted model.
        return self.unit == "55B" and name in (
            ("coordinate", 1, 5.5), ("coordinate", 0, 6.9),
            ("thickness", 0, 6.9, .12), ("thickness", 1, 5.5, .12))

    def solve(self):
        count = len(self.refs)
        size = self.n + count
        rows = np.vstack((np.column_stack((self.A, -np.eye(count))), np.column_stack((-self.A, -np.eye(count)))))
        upper = np.concatenate((-self.base, self.base))
        lower_bound = np.full(size, -LIMIT)
        upper_bound = np.full(size, LIMIT)
        for index, name in enumerate(self.names):
            # Preserve the proven 55B alpha/bedroom north-door foot-grid alignment.
            # Even a 25 mm shift loses bidirectional approaches at this junction.
            # Keep the actual wall/opening centerline and adjacent jamb wall;
            # never widen a collision
            # exception, remove a wall or weaken the traversal regression test.
            if self.locked_control(name):
                lower_bound[index] = upper_bound[index] = 0
            if name[0] == "thickness":
                lower_bound[index] = max(-LIMIT, .001 * 1000 - name[3] * 1000)
        lower_bound[self.n:] = 0
        upper_bound[self.n:] = np.abs(self.base) + 1e-7
        linear = LinearConstraint(rows, -np.inf, upper)
        monotone_rows, monotone_upper = [], []
        for axis in (0, 1):
            for before, after in zip(self.knots[axis], self.knots[axis][1:]):
                row = np.zeros(size)
                row[self.indices[(axis, before)]] = 1
                row[self.indices[(axis, after)]] = -1
                monotone_rows.append(row)
                monotone_upper.append((after - before) * 1000 - .001)
        monotone = LinearConstraint(np.array(monotone_rows), -np.inf, monotone_upper)
        def norms(values):
            points = self.corners @ values[:self.n]
            return np.sum(points * points, axis=1)
        def norm_jac(values):
            points = self.corners @ values[:self.n]
            return np.column_stack((2 * np.einsum("ijk,ij->ik", self.corners, points), np.zeros((len(self.corners), count))))
        nonlinear = NonlinearConstraint(norms, -np.inf, LIMIT * LIMIT, jac=norm_jac)
        initial = np.concatenate((np.zeros(self.n), np.abs(self.base)))
        objective = np.concatenate((np.zeros(self.n), np.ones(count)))
        options = {"ftol": 1e-9, "maxiter": 1600}
        first = minimize(lambda x: objective @ x, initial, jac=lambda x: objective,
                         method="SLSQP", bounds=Bounds(lower_bound, upper_bound),
                         constraints=[linear, monotone, nonlinear], options=options)
        if not first.success:
            raise RuntimeError(first.message)
        optimum = float(objective @ first.x)
        total_error = LinearConstraint(objective[None, :], -np.inf, optimum + 1e-6)
        second = minimize(lambda x: np.dot(x[:self.n], x[:self.n]) / 2500, first.x,
                          jac=lambda x: np.concatenate((2 * x[:self.n] / 2500, np.zeros(count))),
                          method="SLSQP", bounds=Bounds(lower_bound, upper_bound),
                          constraints=[linear, monotone, nonlinear, total_error], options=options)
        if not second.success:
            raise RuntimeError("Secondary minimum-change solve: " + second.message)
        result = np.round(second.x[:self.n], 6)  # 0.000001 mm = 1 nm
        self.validate(result, 0.0001)
        return result

    def validate(self, result, tolerance=0.0001):
        actual = self.base + self.A @ result
        if np.any(np.abs(actual) > np.abs(self.base) + tolerance):
            raise RuntimeError("A source-drawing dimension became worse")
        corners = self.corners @ result
        if np.max(np.linalg.norm(corners, axis=1)) > 50 + tolerance:
            raise RuntimeError("A wall endpoint or final face moved over 50 mm")
        if np.max(np.abs(result)) > 50 + tolerance:
            raise RuntimeError("A coordinate/thickness changed over 50 mm")
        if any(abs(result[index]) > 1e-7 for index, name in enumerate(self.names) if self.locked_control(name)):
            raise RuntimeError("A fixed boundary or traversal-safe aperture changed")
        for wall_id, index in self.wall_thickness_index.items():
            if self.walls[wall_id]["thicknessMeters"] * 1000 + result[index] <= 0:
                raise RuntimeError("A wall thickness is not positive")
        for axis in (0, 1):
            for before, after in zip(self.knots[axis], self.knots[axis][1:]):
                if before * 1000 + result[self.indices[(axis, before)]] >= after * 1000 + result[self.indices[(axis, after)]]:
                    raise RuntimeError("Coordinate deformation is not strictly monotone")
        return actual

    def output(self, values):
        offsets = {"x": [], "y": []}
        for axis in (0, 1):
            for value in self.knots[axis]:
                offsets["xy"[axis]].append([value, float(values[self.indices[(axis, value)]] / 1000)])
        thickness = {wall_id: float(values[index] / 1000) for wall_id, index in self.wall_thickness_index.items()}
        errors = self.validate(values)
        def js_numbers(value):
            if isinstance(value, list):
                return [js_numbers(item) for item in value]
            if isinstance(value, dict):
                return {key: js_numbers(item) for key, item in value.items()}
            return int(value) if isinstance(value, float) and value.is_integer() else value
        return {
            "sourceSignature": json.dumps(js_numbers({"floor": self.g["floorPolygon"],
                "walls": [[w["id"], w["a"], w["b"], w["thicknessMeters"]] for w in self.g["wallSegments"]],
                "fixtures": [[w["id"], w["boundsMeters"]] for w in self.g["kitchenFixtures"]]}),
                ensure_ascii=False, separators=(",", ":")),
            "coordinateOffsets": offsets, "thicknessOffsets": thickness,
            "summary": {"beforeTotalErrorMm": round(float(np.abs(self.base).sum()), 6),
                        "afterTotalErrorMm": round(float(np.abs(errors).sum()), 6)},
            "dimensions": [{"id": ref["id"], "targetMm": ref["targetMm"],
                            "beforeMm": round(float(ref["targetMm"] + before), 6),
                            "afterMm": round(float(ref["targetMm"] + after), 6)}
                           for ref, before, after in zip(self.refs, self.base, errors)],
        }

    def restore(self, unit):
        result = np.zeros(self.n)
        for axis in (0, 1):
            for coordinate, value in unit["coordinateOffsets"]["xy"[axis]]:
                result[self.indices[(axis, coordinate)]] = value * 1000
        for wall_id, value in unit["thicknessOffsets"].items():
            result[self.wall_thickness_index[wall_id]] = value * 1000
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source, refs = source_data()
    result = {"schemaVersion": 1, "revision": "bundang-measured-geometry-v1", "units": {}}
    recorded = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else None
    existing = recorded if args.check else None
    if not args.check and recorded and "55B" in recorded["units"]:
        result["units"]["55B"] = recorded["units"]["55B"]
    for unit, geometry in source.items():
        problem = Problem(geometry, [ref for ref in refs if ref["unitType"] == unit])
        values = problem.restore(existing["units"][unit]) if existing else problem.solve()
        data = problem.output(values)
        result["units"][unit] = data
        print(unit, data["summary"], flush=True)
    if args.check:
        for unit in result["units"]:
            if result["units"][unit]["sourceSignature"] != existing["units"][unit]["sourceSignature"]:
                raise RuntimeError("Immutable source geometry changed; calibration needs review")
            if result["units"][unit]["dimensions"] != existing["units"][unit]["dimensions"]:
                raise RuntimeError("Dimension contract or source geometry changed; regenerate the table")
        print("Static geometry calibration constraints passed")
    else:
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
