#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_DIST_BYTES = 50 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".map", ".mjs", ".svg", ".txt", ".xml"]);
const EXPECTED_MAP_IDS = new Set([
  "bundang-first-village-51a-prototype",
  "bundang-first-village-55a-prototype",
  "bundang-first-village-55b-prototype",
  "bundang-first-village-59a-prototype",
]);
const ALLOWED_RIGHTS_CLASSES = new Set([
  "exporter-generated-metadata",
  "maintainer-reviewed-project-asset",
  "maintainer-reviewed-project-source",
]);
const REQUIRED_STABLE_PROVENANCE = new Map([
  ["generated/catalog.v1.json", "generated:stable-showcase-catalog"],
  ["generated/current.json", "generated:current-export-pointer"],
]);
const VERIFICATION_CONFIG_KEYS = new Set(["schemaVersion", "enabled", "provider", "endpoint", "timeoutMs"]);

function parseArgs(argv) {
  const result = { directory: "dist" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dir") result.directory = argv[++index] || "";
    else throw new Error(`알 수 없는 인자: ${argv[index]}`);
  }
  if (!result.directory) throw new Error("--dir 값이 비어 있습니다.");
  return result;
}

function slash(value) {
  return String(value).replaceAll("\\", "/");
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function walkFiles(root) {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function requireFile(filePath, label, failures) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) failures.push(`${label}: 파일이 아닙니다.`);
  } catch {
    failures.push(`${label}: 파일이 없습니다 (${slash(filePath)}).`);
  }
}

function safeCatalogAsset(distGeneratedRoot, relativeUrl, label, failures) {
  if (typeof relativeUrl !== "string" || !relativeUrl || relativeUrl.startsWith("/") || relativeUrl.startsWith("\\") || relativeUrl.includes("..") || /^[a-z][a-z\d+.-]*:/i.test(relativeUrl)) {
    failures.push(`${label}: 안전하지 않은 프로젝트 상대 URL (${String(relativeUrl)}).`);
    return null;
  }
  const resolved = path.resolve(distGeneratedRoot, ...relativeUrl.split("/"));
  if (!inside(distGeneratedRoot, resolved)) {
    failures.push(`${label}: generated 폴더 밖을 참조합니다.`);
    return null;
  }
  return resolved;
}

function safeManifestAsset(boundaryRoot, manifestPath, relativeUrl, label, failures) {
  if (typeof relativeUrl !== "string" || !relativeUrl) {
    failures.push(`${label}: 비어 있거나 문자열이 아닌 manifest 상대 URL입니다.`);
    return null;
  }
  if (relativeUrl.startsWith("/") || relativeUrl.startsWith("\\") || relativeUrl.includes("\\") || /^[a-z][a-z\d+.-]*:/i.test(relativeUrl)) {
    failures.push(`${label}: 안전하지 않은 manifest 상대 URL (${relativeUrl}).`);
    return null;
  }
  const pathPart = relativeUrl.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    failures.push(`${label}: 잘못된 URL 인코딩입니다 (${relativeUrl}).`);
    return null;
  }
  if (!decoded || decoded.startsWith("/") || decoded.includes("\\") || decoded.split("/").some((segment) => segment === "" || segment === "." && decoded !== ".")) {
    failures.push(`${label}: 정규화할 수 없는 manifest 상대 URL (${relativeUrl}).`);
    return null;
  }
  const resolved = path.resolve(path.dirname(manifestPath), ...decoded.split("/"));
  if (!inside(boundaryRoot, resolved)) {
    failures.push(`${label}: 현재 export 경계 밖을 참조합니다 (${relativeUrl}).`);
    return null;
  }
  return resolved;
}

async function readJson(filePath, label, failures) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    failures.push(`${label}: JSON 파싱 실패 (${error.message}).`);
    return null;
  }
}

async function requireManifestAsset(boundaryRoot, manifestPath, relativeUrl, label, failures) {
  const resolved = safeManifestAsset(boundaryRoot, manifestPath, relativeUrl, label, failures);
  if (resolved) await requireFile(resolved, label, failures);
  return resolved;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function isSafeSourcePath(value) {
  if (typeof value !== "string" || !value) return false;
  if (/^generated:[a-z0-9][a-z0-9-]*$/i.test(value)) return true;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[a-z][a-z\d+.-]*:/i.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function collectRasterReferences(value, trail = "", result = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectRasterReferences(entry, `${trail}[${index}]`, result));
    return result;
  }
  if (!value || typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value)) {
    const nextTrail = trail ? `${trail}.${key}` : key;
    if (typeof entry === "string" && (key.toLowerCase() === "webp" || key.toLowerCase() === "png" || /\.(?:webp|png)(?:[?#].*)?$/i.test(entry))) {
      result.push([entry, nextTrail]);
    } else {
      collectRasterReferences(entry, nextTrail, result);
    }
  }
  return result;
}

function findTextViolation(text, relativePath) {
  const checks = [
    { pattern: /\/api(?:\/|["'`])/i, label: "server API endpoint" },
    { pattern: /socket\.io/i, label: "Socket.IO client" },
    { pattern: /(?:new\s+WebSocket\s*\(|\bWebSocket\s*\(|wss?:\/\/)/i, label: "WebSocket client" },
    { pattern: /\{\{|\{%|\{#/u, label: "Jinja token" },
    { pattern: /(?:^|[^a-z\d+.-])[A-Za-z]:[\\/](?!\/)/m, label: "absolute Windows path" },
    { pattern: /WebstormProjects/i, label: "local source path" },
    { pattern: /sourceAudit|sourceExportRoot/i, label: "private source/audit field" },
    { pattern: /(?:["'`(=:\s])\/(?:assets|src)\//i, label: "root-absolute internal path" },
  ];
  for (const check of checks) {
    if (check.pattern.test(text)) return `${relativePath}: ${check.label}가 포함되어 있습니다.`;
  }
  return null;
}

function forbiddenArtifactPath(relativePath) {
  const normalized = `/${slash(relativePath).toLowerCase()}`;
  const fileName = path.posix.basename(normalized);
  if (/^\.env(?:\.|$)/.test(fileName)) return ".env";
  if (/\.(?:db|sqlite|sqlite3)$/.test(fileName)) return "database";
  if (/(?:^|[-_.])(?:audit|draft|reference)(?:[-_.]|$)/.test(fileName)) return "audit/draft/reference";
  if (/\/(?:audit|audits|draft|drafts|reference|references)\//.test(normalized)) return "audit/draft/reference";
  if (fileName === "plan-contract.json" || fileName.startsWith("source-prompts.")) return "source/reference";
  return "";
}

async function verifyMapManifest(map, mapIndex, distRoot, exportRoot, failures) {
  const manifestLabel = `maps[${mapIndex}].manifestUrl`;
  const manifestPath = safeCatalogAsset(distRoot, map?.manifestUrl, manifestLabel, failures);
  if (!manifestPath) return;
  const manifest = await readJson(manifestPath, `${map?.id || mapIndex} map manifest`, failures);
  if (!manifest) return;

  const chunkTemplate = manifest.chunkUrlTemplate;
  if (chunkTemplate !== "chunks/{chunkX}-{chunkY}.json") {
    failures.push(`${map.id}: 정적 chunkUrlTemplate이 올바르지 않습니다.`);
  }
  const chunkWidth = Number(manifest?.chunk?.width) || 16;
  const chunkHeight = Number(manifest?.chunk?.height) || 16;
  const chunkCountX = Math.ceil((Number(manifest?.bounds?.width) || Number(map.width) || 64) / chunkWidth);
  const chunkCountY = Math.ceil((Number(manifest?.bounds?.height) || Number(map.height) || 64) / chunkHeight);
  if (chunkCountX * chunkCountY !== Number(map.chunkCount)) {
    failures.push(`${map.id}: catalog chunkCount와 manifest bounds/chunk 구성이 일치하지 않습니다.`);
  }
  for (let chunkX = 0; chunkX < chunkCountX; chunkX += 1) {
    for (let chunkY = 0; chunkY < chunkCountY; chunkY += 1) {
      const relativeUrl = String(chunkTemplate || "")
        .replaceAll("{chunkX}", String(chunkX))
        .replaceAll("{chunkY}", String(chunkY));
      await requireManifestAsset(exportRoot, manifestPath, relativeUrl, `${map.id} chunk ${chunkX}-${chunkY}`, failures);
    }
  }

  for (const [field, relativeUrl] of [
    ["contentFile", manifest.contentFile],
    ["contentManifestUrl", manifest.contentManifestUrl],
    ["minimapUrl", manifest.minimapUrl],
    ["minimap.overviewUrl", manifest?.minimap?.overviewUrl],
  ]) {
    if (typeof relativeUrl !== "string" || !relativeUrl) failures.push(`${map.id}: ${field}가 없습니다.`);
    else await requireManifestAsset(exportRoot, manifestPath, relativeUrl, `${map.id} ${field}`, failures);
  }

  const minimapTemplate = manifest?.minimap?.urlTemplate;
  if (typeof minimapTemplate !== "string" || !minimapTemplate) {
    failures.push(`${map.id}: minimap.urlTemplate이 없습니다.`);
  } else {
    const regionCountX = Number(manifest?.minimap?.regionCountX ?? manifest?.region?.countX);
    const regionCountY = Number(manifest?.minimap?.regionCountY ?? manifest?.region?.countY);
    if (!Number.isInteger(regionCountX) || !Number.isInteger(regionCountY) || regionCountX < 1 || regionCountY < 1 || regionCountX > 64 || regionCountY > 64) {
      failures.push(`${map.id}: minimap region count가 올바르지 않습니다.`);
    } else {
      for (let regionX = 0; regionX < regionCountX; regionX += 1) {
        for (let regionY = 0; regionY < regionCountY; regionY += 1) {
          const relativeUrl = minimapTemplate
            .replaceAll("{regionX}", String(regionX))
            .replaceAll("{regionY}", String(regionY));
          await requireManifestAsset(exportRoot, manifestPath, relativeUrl, `${map.id} minimap ${regionX}-${regionY}`, failures);
        }
      }
    }
  }

  const materialManifestUrl = manifest?.rendering?.materialManifestUrl;
  if (typeof materialManifestUrl !== "string" || !materialManifestUrl) {
    failures.push(`${map.id}: rendering.materialManifestUrl이 없습니다.`);
    return;
  }
  const materialPath = await requireManifestAsset(exportRoot, manifestPath, materialManifestUrl, `${map.id} material manifest`, failures);
  if (!materialPath) return;
  const materialManifest = await readJson(materialPath, `${map.id} material manifest`, failures);
  if (!materialManifest) return;
  const rasterReferences = collectRasterReferences(materialManifest);
  if (rasterReferences.length === 0 && Array.isArray(materialManifest.materials) && materialManifest.materials.length > 0) {
    failures.push(`${map.id}: material manifest에 WebP/PNG 참조가 없습니다.`);
  }
  for (const [relativeUrl, trail] of rasterReferences) {
    await requireManifestAsset(exportRoot, materialPath, relativeUrl, `${map.id} material ${trail}`, failures);
  }
}

async function verifyCharacterManifest(character, index, distRoot, exportRoot, failures) {
  const label = `characters[${index}].manifestUrl`;
  const manifestPath = safeCatalogAsset(distRoot, character?.manifestUrl, label, failures);
  if (!manifestPath) return;
  const manifest = await readJson(manifestPath, `${character?.key || index} character manifest`, failures);
  if (!manifest) return;
  for (const motion of ["idle", "walk", "attack", "cast"]) {
    for (const [actionId, action] of Object.entries(manifest?.motions?.[motion]?.actions || {})) {
      if (!action?.sheet) continue;
      await requireManifestAsset(exportRoot, manifestPath, action.sheet, `${character.key} ${motion}/${actionId} sheet`, failures);
    }
  }
}

async function verifyEffectManifest(effectUrl, skill, effectIndex, distRoot, exportRoot, failures) {
  const label = `${skill.id}.effectUrls[${effectIndex}]`;
  const manifestPath = safeCatalogAsset(distRoot, effectUrl, label, failures);
  if (!manifestPath) return;
  const manifest = await readJson(manifestPath, `${label} manifest`, failures);
  if (!manifest) return;
  let referenceCount = 0;
  for (const [variantIndex, variant] of (manifest.variants || []).entries()) {
    for (const field of ["sheetUrl", "transparentSheetUrl", "frontSheetUrl", "backSheetUrl"]) {
      if (variant?.[field] === undefined) continue;
      referenceCount += 1;
      await requireManifestAsset(exportRoot, manifestPath, variant[field], `${label}.variants[${variantIndex}].${field}`, failures);
    }
    if (variant?.transparentFrameUrls !== undefined && !Array.isArray(variant.transparentFrameUrls)) {
      failures.push(`${label}.variants[${variantIndex}].transparentFrameUrls는 배열이어야 합니다.`);
    }
    for (const [frameIndex, frameUrl] of (variant?.transparentFrameUrls || []).entries()) {
      referenceCount += 1;
      await requireManifestAsset(exportRoot, manifestPath, frameUrl, `${label}.variants[${variantIndex}].transparentFrameUrls[${frameIndex}]`, failures);
    }
  }
  if (manifest.transparentFrames !== undefined && !Array.isArray(manifest.transparentFrames)) {
    failures.push(`${label}.transparentFrames는 배열이어야 합니다.`);
  }
  for (const [frameIndex, frame] of (manifest.transparentFrames || []).entries()) {
    referenceCount += 1;
    await requireManifestAsset(exportRoot, manifestPath, frame?.pngUrl, `${label}.transparentFrames[${frameIndex}].pngUrl`, failures);
  }
  if (referenceCount === 0) failures.push(`${label}: 재생할 sheet/frame PNG 참조가 없습니다.`);
}

async function verifySourceExport(sourceExportPath, current, distRoot, exportRoot, failures) {
  const sourceExport = await readJson(sourceExportPath, "current source-export", failures);
  if (!sourceExport) return;
  if (sourceExport.schemaVersion !== 1) failures.push("source-export.schemaVersion은 숫자 1이어야 합니다.");
  if (!sourceExport.exportId || sourceExport.exportId !== current.exportId) failures.push("source-export/current exportId가 일치하지 않습니다.");
  if (typeof sourceExport.sourceHead !== "string" || !/^[a-f\d]{40}$/i.test(sourceExport.sourceHead)) {
    failures.push("source-export.sourceHead는 40자리 Git SHA여야 합니다.");
  }
  if (typeof sourceExport.sourceDirty !== "boolean") {
    failures.push("source-export.sourceDirty는 boolean이어야 합니다.");
  }
  if (sourceExport.source?.head !== sourceExport.sourceHead || sourceExport.source?.dirty !== sourceExport.sourceDirty) {
    failures.push("source-export의 중첩 source head/dirty가 최상위 provenance와 일치하지 않습니다.");
  }

  const publicationApproval = sourceExport.publicationApproval;
  if (!publicationApproval || typeof publicationApproval !== "object" || Array.isArray(publicationApproval)) {
    failures.push("source-export.publicationApproval 객체가 없습니다.");
  } else {
    if (publicationApproval.policyType !== "maintainer-reviewed-publication-allowlist") {
      failures.push("source-export.publicationApproval.policyType이 올바르지 않습니다.");
    }
    if (typeof publicationApproval.policyVersion !== "string" || !/^[a-z\d][a-z\d._-]*$/i.test(publicationApproval.policyVersion)) {
      failures.push("source-export.publicationApproval.policyVersion이 올바르지 않습니다.");
    }
    if (typeof publicationApproval.policySha256 !== "string" || !/^[a-f\d]{64}$/i.test(publicationApproval.policySha256)) {
      failures.push("source-export.publicationApproval.policySha256 형식이 올바르지 않습니다.");
    }
    if (publicationApproval.defaultDecision !== "deny") {
      failures.push("source-export.publicationApproval.defaultDecision은 deny여야 합니다.");
    }
    if (publicationApproval.legalRightsProof !== false) {
      failures.push("source-export.publicationApproval.legalRightsProof는 false여야 합니다.");
    }
  }
  if (!Array.isArray(sourceExport.files)) {
    failures.push("source-export.files는 배열이어야 합니다.");
    return;
  }

  const declaredPaths = new Set();
  const sourceExportPublicPath = slash(path.relative(distRoot, sourceExportPath));
  for (const [index, row] of sourceExport.files.entries()) {
    const label = `source-export.files[${index}]`;
    const sourcePath = row?.sourcePath;
    if (!isSafeSourcePath(sourcePath)) {
      failures.push(`${label}.sourcePath는 generated: 식별자 또는 안전한 상대경로여야 합니다 (${String(sourcePath)}).`);
    }
    if (row?.outputPath !== row?.publicPath) {
      failures.push(`${label}.outputPath와 publicPath가 일치하지 않습니다.`);
    }
    const approvalCategory = row?.publicationApprovalCategory;
    if (typeof approvalCategory !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(approvalCategory)) {
      failures.push(`${label}.publicationApprovalCategory가 올바르지 않습니다.`);
    }
    if (!ALLOWED_RIGHTS_CLASSES.has(row?.rightsClass)) {
      failures.push(`${label}.rightsClass가 허용 목록에 없습니다 (${String(row?.rightsClass)}).`);
    }
    if (typeof sourcePath === "string" && sourcePath.startsWith("generated:")) {
      if (approvalCategory !== "exporter-generated" || row?.rightsClass !== "exporter-generated-metadata") {
        failures.push(`${label}: generated source의 승인 범주/rightsClass가 올바르지 않습니다.`);
      }
    } else if (approvalCategory === "exporter-generated" || row?.rightsClass === "exporter-generated-metadata") {
      failures.push(`${label}: 원본 source 상대경로가 exporter-generated로 분류되었습니다.`);
    }
    const publicPath = row?.publicPath;
    const resolved = safeCatalogAsset(distRoot, publicPath, `${label}.publicPath`, failures);
    if (!resolved) continue;
    if (declaredPaths.has(publicPath)) failures.push(`${label}.publicPath가 중복되었습니다 (${publicPath}).`);
    declaredPaths.add(publicPath);
    await requireFile(resolved, label, failures);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) continue;
    if (!Number.isInteger(row.bytes) || row.bytes < 0) failures.push(`${label}.bytes가 올바른 정수가 아닙니다.`);
    else if (row.bytes !== info.size) failures.push(`${label}: bytes 불일치 (manifest=${row.bytes}, actual=${info.size}).`);
    if (typeof row.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(row.sha256)) {
      failures.push(`${label}.sha256 형식이 올바르지 않습니다.`);
    } else {
      const actualSha256 = await sha256File(resolved);
      if (row.sha256.toLowerCase() !== actualSha256) failures.push(`${label}: sha256 불일치 (${publicPath}).`);
    }
  }

  for (const [publicPath, expectedSourcePath] of REQUIRED_STABLE_PROVENANCE) {
    const rows = sourceExport.files.filter((row) => row?.publicPath === publicPath);
    if (rows.length !== 1) {
      failures.push(`source-export.files에는 ${publicPath} provenance row가 정확히 하나 있어야 합니다 (actual=${rows.length}).`);
      continue;
    }
    if (rows[0].sourcePath !== expectedSourcePath) {
      failures.push(`${publicPath} provenance sourcePath가 올바르지 않습니다.`);
    }
  }

  const currentExportFiles = await walkFiles(exportRoot);
  for (const filePath of currentExportFiles) {
    const publicPath = slash(path.relative(distRoot, filePath));
    // source-export.json cannot include its own byte/hash row without a self-referential digest.
    if (publicPath === sourceExportPublicPath) continue;
    if (!declaredPaths.has(publicPath)) failures.push(`current export 파일이 source-export.files에 누락되었습니다 (${publicPath}).`);
  }
}

async function verifyCatalog(distRoot, failures) {
  const generatedRoot = path.join(distRoot, "generated");
  const catalogPath = path.join(generatedRoot, "catalog.v1.json");
  const currentPath = path.join(generatedRoot, "current.json");
  await requireFile(catalogPath, "generated/catalog.v1.json", failures);
  await requireFile(currentPath, "generated/current.json", failures);
  const catalog = await readJson(catalogPath, "generated/catalog.v1.json", failures);
  const current = await readJson(currentPath, "generated/current.json", failures);
  if (!catalog || !current) return;

  if (catalog.schemaVersion !== 1) failures.push("catalog.schemaVersion은 숫자 1이어야 합니다.");
  if (!catalog.exportId || catalog.exportId !== current.exportId) failures.push("catalog/current exportId가 일치하지 않습니다.");
  if (!Array.isArray(catalog.maps) || catalog.maps.length !== 4) failures.push("catalog에는 정확히 4개 검수맵이 필요합니다.");
  if (!Array.isArray(catalog.characters) || catalog.characters.length !== 2) failures.push("catalog에는 정확히 2개 캐릭터가 필요합니다.");
  if (!Array.isArray(catalog.skills) || catalog.skills.length !== 3) failures.push("catalog에는 정확히 3개 스킬이 필요합니다.");
  if (!Array.isArray(catalog.defaultHotbar) || catalog.defaultHotbar.length !== 4) failures.push("catalog.defaultHotbar는 4칸이어야 합니다.");
  if (catalog.defaultHotbar?.[0] !== "common-teleport") failures.push("catalog.defaultHotbar 1번은 텔레포트여야 합니다.");
  if (!Array.isArray(catalog.bOptions) || catalog.bOptions.length !== 41) failures.push("catalog.bOptions에는 41개 옵션이 필요합니다.");
  const optionPreviewUrls = (catalog.bOptions || []).map((option) => option?.previewUrl).filter(Boolean);
  if (optionPreviewUrls.length !== 41) failures.push("41개 B옵션 모두 versioned previewUrl이 필요합니다.");
  if (new Set(optionPreviewUrls).size !== optionPreviewUrls.length) failures.push("B옵션 previewUrl은 옵션별로 고유해야 합니다.");

  const renderAssets = catalog.renderAssets;
  const requiredRenderAssets = ["interiorCatalogUrl", "recipeCatalogUrl", "optionModuleUrl", "materialManifestUrl"];
  if (!renderAssets || typeof renderAssets !== "object") {
    failures.push("catalog.renderAssets 원본 구조물 렌더 계약이 없습니다.");
  } else {
    for (const field of requiredRenderAssets) {
      if (typeof renderAssets[field] !== "string" || !renderAssets[field]) {
        failures.push(`catalog.renderAssets.${field}가 없습니다.`);
      }
    }
  }

  const mapIds = new Set((catalog.maps || []).map((entry) => entry?.id));
  if (mapIds.size !== EXPECTED_MAP_IDS.size || [...EXPECTED_MAP_IDS].some((id) => !mapIds.has(id))) {
    failures.push("catalog의 51A/55A/55B/59A 검수맵 구성이 올바르지 않습니다.");
  }

  const currentCatalogPath = safeCatalogAsset(generatedRoot, current.catalogUrl, "current.catalogUrl", failures);
  if (currentCatalogPath) {
    await requireFile(currentCatalogPath, "current.catalogUrl", failures);
    if (path.resolve(currentCatalogPath) !== path.resolve(catalogPath)) failures.push("current.catalogUrl은 stable catalog를 가리켜야 합니다.");
  }
  const basePath = String(current.basePath || "").replace(/\/+$/, "");
  const exportRoot = safeCatalogAsset(generatedRoot, basePath, "current.basePath", failures);
  if (!exportRoot) return;
  const exportInfo = await stat(exportRoot).catch(() => null);
  if (!exportInfo?.isDirectory()) {
    failures.push(`current.basePath export 폴더가 없습니다 (${slash(exportRoot)}).`);
    return;
  }
  if (path.basename(exportRoot) !== current.exportId) failures.push("current.basePath와 current.exportId가 일치하지 않습니다.");

  const references = [];
  for (const [index, map] of (catalog.maps || []).entries()) {
    references.push([map?.manifestUrl, `maps[${index}].manifestUrl`, distRoot], [map?.minimapUrl, `maps[${index}].minimapUrl`, distRoot]);
  }
  for (const [index, character] of (catalog.characters || []).entries()) {
    references.push([character?.manifestUrl, `characters[${index}].manifestUrl`, distRoot]);
  }
  for (const [index, skill] of (catalog.skills || []).entries()) {
    if (skill?.iconUrl) references.push([skill.iconUrl, `skills[${index}].iconUrl`, distRoot]);
    for (const [effectIndex, effectUrl] of (skill?.effectUrls || []).entries()) {
      references.push([effectUrl, `skills[${index}].effectUrls[${effectIndex}]`, distRoot]);
    }
  }
  for (const [index, option] of (catalog.bOptions || []).entries()) {
    if (option?.previewUrl) references.push([option.previewUrl, `bOptions[${index}].previewUrl`, distRoot]);
  }
  for (const field of requiredRenderAssets) {
    if (renderAssets?.[field]) references.push([renderAssets[field], `renderAssets.${field}`, distRoot]);
  }
  references.push([current.sourceExportUrl, "current.sourceExportUrl", generatedRoot]);
  for (const [relativeUrl, label, referenceRoot] of references) {
    const resolved = safeCatalogAsset(referenceRoot, relativeUrl, label, failures);
    if (resolved) await requireFile(resolved, label, failures);
  }

  for (const [mapIndex, map] of (catalog.maps || []).entries()) {
    await verifyMapManifest(map, mapIndex, distRoot, exportRoot, failures);
  }
  for (const [index, character] of (catalog.characters || []).entries()) {
    await verifyCharacterManifest(character, index, distRoot, exportRoot, failures);
  }
  for (const skill of catalog.skills || []) {
    for (const [effectIndex, effectUrl] of (skill.effectUrls || []).entries()) {
      await verifyEffectManifest(effectUrl, skill, effectIndex, distRoot, exportRoot, failures);
    }
  }

  const interiorCatalogPath = renderAssets?.interiorCatalogUrl
    ? safeCatalogAsset(distRoot, renderAssets.interiorCatalogUrl, "renderAssets.interiorCatalogUrl", failures)
    : null;
  const recipeCatalogPath = renderAssets?.recipeCatalogUrl
    ? safeCatalogAsset(distRoot, renderAssets.recipeCatalogUrl, "renderAssets.recipeCatalogUrl", failures)
    : null;
  if (interiorCatalogPath) {
    const interiorCatalog = await readJson(interiorCatalogPath, "interior runtime catalog", failures);
    const assets = Array.isArray(interiorCatalog?.assets) ? interiorCatalog.assets : [];
    if (assets.length !== 83) failures.push(`interior runtime catalog에는 정확히 83개 자산이 필요합니다 (${assets.length}).`);
    let glbCount = 0;
    for (const [assetIndex, asset] of assets.entries()) {
      const lods = asset?.rendererRef?.lods;
      if (!lods || typeof lods !== "object") continue;
      for (const [lod, row] of Object.entries(lods)) {
        if (!row?.url) continue;
        glbCount += 1;
        await requireManifestAsset(exportRoot, interiorCatalogPath, row.url, `interior.assets[${assetIndex}].rendererRef.lods.${lod}.url`, failures);
      }
    }
    if (glbCount !== 5) failures.push(`interior runtime catalog에는 정확히 5개 Blender GLB가 필요합니다 (${glbCount}).`);
  }
  if (recipeCatalogPath) {
    const recipes = await readJson(recipeCatalogPath, "interior recipe catalog", failures);
    const assets = Array.isArray(recipes?.assets) ? recipes.assets : [];
    const partCount = assets.reduce((sum, asset) => sum + (Array.isArray(asset?.parts) ? asset.parts.length : 0), 0);
    if (assets.length !== 83) failures.push(`interior recipe catalog에는 정확히 83개 레시피가 필요합니다 (${assets.length}).`);
    if (partCount !== 399) failures.push(`interior recipe catalog에는 정확히 399개 part가 필요합니다 (${partCount}).`);
  }

  const sourceExportPath = safeCatalogAsset(generatedRoot, current.sourceExportUrl, "current.sourceExportUrl", failures);
  if (sourceExportPath) await verifySourceExport(sourceExportPath, current, distRoot, exportRoot, failures);
}

async function verifyHouseholdVerificationConfig(distRoot, failures) {
  const configPath = path.join(distRoot, "config", "household-verification.v1.json");
  const config = await readJson(configPath, "household verification config", failures);
  if (!config || typeof config !== "object" || Array.isArray(config)) return;

  const keys = Object.keys(config);
  const unexpectedKeys = keys.filter((key) => !VERIFICATION_CONFIG_KEYS.has(key));
  const missingKeys = [...VERIFICATION_CONFIG_KEYS].filter((key) => !keys.includes(key));
  if (unexpectedKeys.length || missingKeys.length) {
    failures.push(`household verification config 필드가 계약과 다릅니다 (누락: ${missingKeys.join(", ") || "없음"}, 추가: ${unexpectedKeys.join(", ") || "없음"}).`);
  }
  if (config.schemaVersion !== 1) failures.push("household verification config schemaVersion은 1이어야 합니다.");
  if (config.provider !== "google-apps-script") failures.push("household verification provider는 google-apps-script여야 합니다.");
  if (typeof config.enabled !== "boolean") failures.push("household verification enabled는 boolean이어야 합니다.");
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 30_000) {
    failures.push("household verification timeoutMs는 1,000~30,000 사이 정수여야 합니다.");
  }
  if (typeof config.endpoint !== "string") {
    failures.push("household verification endpoint는 문자열이어야 합니다.");
  } else if (config.enabled && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/u.test(config.endpoint)) {
    failures.push("활성 household verification endpoint는 Google Apps Script /exec URL이어야 합니다.");
  } else if (!config.enabled && config.endpoint !== "") {
    failures.push("비활성 household verification config에는 endpoint를 두지 않습니다.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distRoot = path.resolve(PROJECT_ROOT, args.directory);
  if (!inside(PROJECT_ROOT, distRoot)) throw new Error("검증 대상은 프로젝트 폴더 안이어야 합니다.");
  const info = await stat(distRoot).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`dist 폴더가 없습니다: ${slash(distRoot)}`);

  const files = await walkFiles(distRoot);
  const failures = [];
  let totalBytes = 0;
  for (const file of files) {
    const relative = slash(path.relative(distRoot, file));
    const fileInfo = await stat(file);
    totalBytes += fileInfo.size;
    const forbiddenPathClass = forbiddenArtifactPath(relative);
    if (forbiddenPathClass) failures.push(`${relative}: ${forbiddenPathClass} 파일은 배포할 수 없습니다.`);
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const violation = findTextViolation(await readFile(file, "utf8"), relative);
    if (violation) failures.push(violation);
  }

  if (totalBytes > MAX_DIST_BYTES) {
    failures.push(`dist 크기 ${(totalBytes / 1024 / 1024).toFixed(2)} MiB가 50 MiB 제한을 초과했습니다.`);
  }
  // The portal owns the root; the existing, single-copy app export stays nested.
  const appRoot = path.join(distRoot, "bunfirvil");
  await requireFile(path.join(distRoot, "index.html"), "district portal", failures);
  for (const page of ["", "calculator", "guides", "households", "manage", "building-admin", "interior-admin"]) {
    await requireFile(path.join(appRoot, page, "index.html"), `A1 ${page || "showcase"}`, failures);
  }
  await verifyCatalog(appRoot, failures);
  await verifyHouseholdVerificationConfig(appRoot, failures);
  const portalHtml = await readFile(path.join(distRoot, "index.html"), "utf8").catch(() => "");
  if (!portalHtml.includes("https://is2js.github.io/naksaeng/")) failures.push("district portal: canonical 낙생지구 URL이 없습니다.");
  const appHtml = await readFile(path.join(appRoot, "index.html"), "utf8").catch(() => "");
  if (!appHtml.includes("https://is2js.github.io/naksaeng/bunfirvil/")) failures.push("A1 showcase: canonical 중첩 URL이 없습니다.");
  if (files.some((file) => slash(path.relative(distRoot, file)).startsWith("generated/"))) {
    failures.push("district portal: generated 자산은 bunfirvil 하위에 한 벌만 배포해야 합니다.");
  }

  const summary = {
    files: files.length,
    bytes: totalBytes,
    mebibytes: Number((totalBytes / 1024 / 1024).toFixed(2)),
    limitMebibytes: 50,
    failures: failures.length,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (failures.length) {
    process.stderr.write(`${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`verify-dist 실패: ${error?.stack || error}\n`);
  process.exitCode = 1;
});
