/**
 * Check the exported source without rewriting geometry.
 *
 * node tooling/finalize-assets.mjs --write
 * node tooling/finalize-assets.mjs --partial --write  (first-chunk integration only)
 * node tooling/finalize-assets.mjs --source "C:/path/to/MD_Presentation_Lounge.blend"
 *
 * --write changes only the JSON manifest, after all applicable checks pass.
 * A partial run never claims that whole-scene provenance was verified.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(app, '../..');
const assets = path.join(app, 'public/assets');
const args = process.argv.slice(2);
const write = args.includes('--write');
const partial = args.includes('--partial');
const sourceArg = args.indexOf('--source');
const sourcePathArg = sourceArg >= 0 ? args[sourceArg + 1] : undefined;
const manifestPath = path.join(assets, 'scene-manifest.json');
const reportPath = path.join(assets, 'asset-validation.json');
const errors = [];
const warnings = [];
const repairs = [];
const report = { version: 1, checkedAt: new Date().toISOString(), scope: partial ? 'partial export; not final scene validation' : 'complete export', geometryModified: false, manifestWritten: false, errors, warnings, repairs, chunks: [], materials: [], interactions: {}, provenance: {}, source: {}, foliageAlpha: [] };

function error(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function localAsset(url) {
  if (typeof url !== 'string' || !url.startsWith('/assets/')) throw new Error(`Expected a local /assets/ URL: ${String(url)}`);
  const decoded = decodeURIComponent(url.split('?')[0].slice('/assets/'.length));
  const result = path.resolve(assets, decoded);
  if (result !== assets && !result.startsWith(assets + path.sep)) throw new Error(`Asset path escapes its directory: ${url}`);
  return result;
}
function readJSON(file) { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
function readGLB(file) {
  const data = readFileSync(file);
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) throw new Error(`Not a glTF 2 GLB: ${file}`);
  if (data.readUInt32LE(8) !== data.length) throw new Error(`GLB length header mismatch: ${file}`);
  let document;
  for (let offset = 12; offset + 8 <= data.length;) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > data.length) throw new Error(`GLB chunk exceeds file: ${file}`);
    if (type === 0x4e4f534a) document = JSON.parse(data.subarray(offset, offset + length).toString('utf8').trimEnd());
    offset += length;
  }
  if (!document) throw new Error(`Missing GLB JSON chunk: ${file}`);
  return { document, bytes: data.length };
}
function triangleCount(document, primitive) {
  const accessor = document.accessors?.[primitive.indices ?? primitive.attributes?.POSITION];
  if (!accessor || !Number.isInteger(accessor.count)) throw new Error('Missing triangle index/position accessor count.');
  const mode = primitive.mode ?? 4;
  if (mode === 4) {
    if (accessor.count % 3) throw new Error(`Triangle index count is not divisible by three (${accessor.count}).`);
    return accessor.count / 3;
  }
  if (mode === 5 || mode === 6) { warn('A strip or fan is counted including possible degenerate triangles.'); return Math.max(0, accessor.count - 2); }
  warn(`Non-triangle primitive mode ${mode} is excluded from the triangle count.`);
  return 0;
}
function activeNodes(document) {
  const roots = document.scenes?.[document.scene ?? 0]?.nodes;
  if (!roots) throw new Error('The GLB has no active scene roots.');
  const nodes = [];
  const seen = new Set();
  function walk(index, ancestry = new Set()) {
    if (ancestry.has(index)) throw new Error('Cycle in the GLB node hierarchy.');
    const node = document.nodes?.[index];
    if (!node) throw new Error(`Missing GLB node ${index}.`);
    if (seen.has(index)) throw new Error(`GLB node ${index} appears more than once in the active tree.`);
    seen.add(index); nodes.push({ index, node });
    const next = new Set(ancestry); next.add(index);
    for (const child of node.children ?? []) walk(child, next);
  }
  roots.forEach(index => walk(index));
  return nodes;
}
function sourceNames(node) {
  const extras = node.extras ?? {};
  const result = new Set(Array.isArray(extras.sourceNames) ? extras.sourceNames.filter(name => typeof name === 'string') : []);
  if (typeof extras.sourceName === 'string') result.add(extras.sourceName);
  return result;
}

async function main() {
  if (sourceArg >= 0 && !sourcePathArg) throw new Error('--source requires a .blend path.');
  if (!existsSync(manifestPath)) throw new Error('No scene-manifest.json exists yet. Wait for an exported geometry chunk.');
  const manifest = readJSON(manifestPath);
  if (manifest.units !== 'meters' || manifest.coordinateSystem !== 'three-y-up') error('Manifest coordinate system must be meters / three-y-up.');
  if (!manifest.chunks?.length) error('Manifest contains no source geometry chunks.');
  if (manifest.exposure !== 0.1) repairs.push({ property: 'exposure', before: manifest.exposure, after: 0.1, convention: 'Blender exposure in EV; runtime applies 2^EV.' });
  manifest.exposure = 0.1;
  manifest.bakedPracticals = true;
  manifest.baking = { ...(manifest.baking ?? {}), mode: 'indirect', bakedPracticals: true, description: 'Source Cycles diffuse indirect plus static practical direct lighting; direct sunlight remains live.' };
  const colorPath = path.join(assets, 'color/source-color.json');
  if (existsSync(colorPath)) {
    const color = readJSON(colorPath);
    if (color.format !== 'RGBA16F' || color.order !== 'red-fastest' || color.size !== 129 || color.compression !== 'gzip' || !(color.sampleCount >= 64000) || !(color.displayError99Percentile < 0.002)) {
      error('Source color LUT metadata is unexpected or has not passed its numerical validation.');
    } else if (!existsSync(localAsset(color.url))) {
      error('Validated source color LUT payload is missing.');
    } else {
      manifest.colorPipeline = { ...(manifest.colorPipeline ?? {}), url: color.url, rawURL: '/assets/color/blender-agx-medium-high.rgba16f', compression: 'gzip', size: color.size, format: 'rgba16f-le', minEV: color.minEV, maxEV: color.maxEV, output: 'display-linear-srgb', validated: true, sourceLook: color.look, validation: '/assets/color/source-color.json', sourceURL: '/assets/color/source-color.json' };
    }
  } else {
    (partial ? warn : error)('Source color LUT validation metadata is missing.');
  }
  // Measured against both exported source collider sets by the controller QA.
  manifest.spawn = { position: [8.5, 0, -5], yaw: -0.56408372105 };
  manifest.character = { ...(manifest.character ?? {}), url: manifest.character?.url ?? '/assets/character/Suit.glb' };
  manifest.collisions = { ...(manifest.collisions ?? {}), additionalUrls: [...new Set([...(manifest.collisions?.additionalUrls ?? []), '/assets/geometry/furniture-collision.glb', '/assets/geometry/circulation-collision.glb'])] };
  manifest.explorationHandoff = { camera: [7.206167, 1.84, -2.954909], target: [8.5, 1.35, -5], fov: 54,
    validation: 'Source architectural and furniture colliders: 60 fixed steps under 0.1 mm drift; five follow-camera clearance rays clear over 2.469 m.' };
  for (const url of [manifest.character.url, manifest.collisions.url, ...manifest.collisions.additionalUrls]) {
    if (!url || !existsSync(localAsset(url))) error(`Required exploration asset is missing: ${String(url)}`);
  }
  const tourPlanPath = path.join(workspace, 'work/extended-tour-plan.json');
  if (existsSync(tourPlanPath)) {
    const plan = readJSON(tourPlanPath);
    const frames = plan.cameraFrames;
    if (plan.completeCheck?.failures !== 0 || plan.completeCheck?.samples < 12001 || plan.cameraClearanceMeters < 0.16 || plan.minimumTargetDistance < 2 || !Array.isArray(frames) || frames.length < 90) {
      error('Extended camera route has not passed the required complete geometric clearance check.');
    } else if (frames.some(frame => ![...frame.position, ...frame.target, frame.fov, frame.frame].every(Number.isFinite))) {
      error('Extended camera route contains invalid numeric data.');
    } else {
      const end = frames.at(-1);
      if (end.position.some((v, i) => Math.abs(v - manifest.explorationHandoff.camera[i]) > 1e-6) || end.target.some((v, i) => Math.abs(v - manifest.explorationHandoff.target[i]) > 1e-6) || end.fov !== manifest.explorationHandoff.fov) {
        error('Extended tour endpoint does not match the verified exploration camera.');
      } else {
        manifest.sourceInspectionTour = frames;
        const validation = { samples: plan.completeCheck.samples, collisionFailures: 0, cameraClearanceMeters: plan.cameraClearanceMeters, minimumTargetDistance: plan.minimumTargetDistance, collisionSource: plan.collisionSource, timing: plan.timing, geometricClearanceVerified: true, visualReviewComplete: false, limitations: plan.limitations };
        manifest.sourceInspectionTourValidation = validation;
        if (!manifest.tour?.length) { manifest.tour = frames; manifest.tourValidation = validation; }
        report.tour = { sourceInspectionKeyframes: frames.length, existingPresentationPreserved: true, ...validation };
      }
    }
  }
  const allNodes = [];
  const allSourceNames = new Set();
  const materialUses = new Map();
  const chunkIds = new Set();
  let triangles = 0;

  for (const chunk of manifest.chunks ?? []) {
    if (chunkIds.has(chunk.id)) error(`Duplicate geometry chunk ID ${chunk.id}.`);
    chunkIds.add(chunk.id);
    try {
      const file = localAsset(chunk.url);
      const { document, bytes } = readGLB(file);
      for (const image of document.images ?? []) if (image.uri && !image.uri.startsWith('data:')) {
        if (/^[a-z]+:/i.test(image.uri)) throw new Error(`External image URI is not a verifiable local export: ${image.uri}`);
        const imagePath = image.uri.startsWith('/assets/') ? localAsset(image.uri) : path.resolve(path.dirname(file), decodeURIComponent(image.uri));
        if (!imagePath.startsWith(assets + path.sep) || !existsSync(imagePath)) throw new Error(`Missing or unsafe external GLB image ${image.uri}.`);
      }
      const nodes = activeNodes(document);
      let chunkTriangles = 0;
      let primitives = 0;
      for (const { index, node } of nodes) {
        allNodes.push({ chunk: chunk.id, index, node });
        sourceNames(node).forEach(name => allSourceNames.add(name));
        if (node.mesh === undefined) continue;
        const mesh = document.meshes?.[node.mesh];
        if (!mesh) throw new Error(`Node ${node.name ?? index} references missing mesh ${node.mesh}.`);
        for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
          primitives++;
          chunkTriangles += triangleCount(document, primitive);
          const material = document.materials?.[primitive.material];
          if (!material?.name) continue;
          if (!materialUses.has(material.name)) materialUses.set(material.name, []);
          materialUses.get(material.name).push({ chunk: chunk.id, node: node.name ?? index, primitive: primitiveIndex, material, attributes: primitive.attributes });
        }
      }
      triangles += chunkTriangles;
      report.chunks.push({ id: chunk.id, bytes, triangles: chunkTriangles, activeNodes: nodes.length, primitives });
      if (bytes !== chunk.bytes) error(`Chunk ${chunk.id} byte count differs: manifest ${chunk.bytes}, actual ${bytes}.`);
      if (chunk.sha256 && await sha256(file) !== chunk.sha256) error(`Chunk ${chunk.id} does not match its recorded SHA256.`);
    } catch (cause) { error(`Chunk ${chunk.id}: ${cause.message}`); }
  }

  const namesSeen = new Set();
  for (const entry of manifest.materials ?? []) {
    if (entry.sourcePBR) {
      const uses = materialUses.get(entry.name) ?? [];
      const channel = entry.sourcePBR.uvChannel;
      if (!uses.length || channel !== 0 || uses.some(use => use.attributes.TEXCOORD_0 === undefined)) error(`${entry.name}: restored source foliage has no verified original UV0.`);
      if (entry.lightMap) error(`${entry.name}: source foliage must not reuse its superseded tiny-chart lightmap.`);
      for (const slot of ['map', 'normalMap', 'roughnessMap']) {
        const url = entry.sourcePBR[slot];
        if (!url || !existsSync(localAsset(url))) error(`${entry.name}: missing original ${slot} texture.`);
      }
      report.sourceMaterials ??= [];
      report.sourceMaterials.push({ name: entry.name, sourceUVChannel: channel, uses: uses.length, lighting: entry.sourcePBR.lighting });
      continue;
    }
    if (!entry.lightMap) continue;
    if (namesSeen.has(entry.name)) error(`Duplicate baked material manifest entry: ${entry.name}.`);
    namesSeen.add(entry.name);
    const uses = materialUses.get(entry.name) ?? [];
    if (!uses.length) { error(`Baked material is not used by any exported active primitive: ${entry.name}.`); continue; }
    if (entry.mode === 'native-source-images-with-GI') {
      if (!entry.sourceTextureValidation || !existsSync(localAsset(entry.sourceTextureValidation))) {
        error(`${entry.name}: original image validation is missing.`);
      } else {
        const proof = readJSON(localAsset(entry.sourceTextureValidation));
        if (!proof.geometryBinaryUnchanged || !proof.precisionGeometryBinaryByteIdentical || proof.browserMaterial !== entry.name) error(`${entry.name}: native material preservation proof is invalid.`);
        for (const image of proof.sourceImages ?? []) {
          const file = localAsset(image.url);
          if (!existsSync(file) || await sha256(file) !== image.sha256) error(`${entry.name}: original image missing or changed: ${image.url}`);
        }
        for (const use of uses) {
          if (JSON.stringify(use.material) !== JSON.stringify(proof.after)) error(`${entry.name}: active source material differs from its preservation proof.`);
          if (use.attributes.TEXCOORD_0 === undefined) error(`${entry.name}: original source UV0 is missing.`);
          for (const texture of [use.material.pbrMetallicRoughness?.baseColorTexture, use.material.pbrMetallicRoughness?.metallicRoughnessTexture, use.material.normalTexture]) {
            if (!texture || (texture.extensions?.KHR_texture_transform?.texCoord ?? texture.texCoord ?? 0) !== 0) error(`${entry.name}: an original PBR map is not assigned to UV0.`);
          }
        }
        report.nativeSourcePreservation ??= [];
        report.nativeSourcePreservation.push({ name: entry.name, sourceImages: proof.sourceImages, PBRUV: 0, GIUV: entry.uvChannel, geometryBinaryUnchanged: true });
      }
    }
    const channels = new Set();
    for (const use of uses) {
      if (entry.atlasId) {
        // v2 illumination UVs are independent of optional source base textures.
        const channel = entry.uvChannel;
        const validationPath = path.join(assets, 'v2/reports', `${use.chunk}-uv-validation.json`);
        if (!existsSync(validationPath)) { error(`${entry.name}: missing authoritative v2 UV-density validation.`); continue; }
        const validation = readJSON(validationPath);
        const atlas = validation.atlases?.find(item => item.id === entry.atlasId);
        const material = atlas?.materials?.find(item => item.name === entry.name);
        if (!validation.ok || !material || !(material.uvArea > 0) || channel !== 1) {
          error(`${entry.name}: repaired atlas material or UV1 validation is missing or failed.`); continue;
        }
        channels.add(channel);
        if (use.attributes.TEXCOORD_1 === undefined) error(`${entry.name}: exported primitive has no verified TEXCOORD_1.`);
        for (const texture of [use.material.pbrMetallicRoughness?.baseColorTexture, use.material.pbrMetallicRoughness?.metallicRoughnessTexture, use.material.normalTexture]) {
          if (entry.mode === 'baked-procedural' && texture && (texture.extensions?.KHR_texture_transform?.texCoord ?? texture.texCoord ?? 0) !== 1) error(`${entry.name}: procedural PBR atlas does not use UV1.`);
        }
        continue;
      }
      const texture = use.material.pbrMetallicRoughness?.baseColorTexture;
      if (!texture) { error(`${entry.name} has no exported base-color texture; cannot infer BakeUV safely.`); continue; }
      const channel = texture.extensions?.KHR_texture_transform?.texCoord ?? texture.texCoord ?? 0;
      channels.add(channel);
      if (use.attributes[`TEXCOORD_${channel}`] === undefined) error(`${entry.name}: ${use.chunk}/${use.node} primitive ${use.primitive} has no TEXCOORD_${channel}.`);
    }
    if (channels.size !== 1) { error(`${entry.name} has ambiguous BakeUV channels: ${[...channels].join(', ')}.`); continue; }
    const uvChannel = [...channels][0];
    let lightMapFile;
    try { lightMapFile = localAsset(entry.lightMap); } catch (cause) { error(cause.message); }
    if (lightMapFile && !existsSync(lightMapFile)) error(`Missing lightmap for ${entry.name}: ${entry.lightMap}`);
    if (entry.lightMapMode !== 'indirect') { error(`Cannot apply the diffuse-radiance conversion to ${entry.name}: mode is ${entry.lightMapMode}.`); continue; }
    if (entry.uvChannel !== uvChannel) repairs.push({ material: entry.name, property: 'uvChannel', before: entry.uvChannel, after: uvChannel });
    if (entry.lightMapIntensity !== Math.PI) repairs.push({ material: entry.name, property: 'lightMapIntensity', before: entry.lightMapIntensity, after: Math.PI });
    entry.uvChannel = uvChannel;
    entry.lightMapIntensity = Math.PI;
    entry.bakeConvention = 'Cycles diffuse indirect plus practical direct, without COLOR: outgoing diffuse radiance / albedo. Multiply by pi to supply irradiance to Three.js physical lightMap.';
    report.materials.push({ name: entry.name, uses: uses.length, lightMap: entry.lightMap, uvChannel, lightMapIntensity: Math.PI });
  }

  const chairs = manifest.chairs ?? [];
  if (chairs.length !== 4) error(`Exactly four independent chairs are required; manifest contains ${chairs.length}.`);
  const measuredSeatCenters = {
    'chair-01': [13.07113838, 0.59154999, -7.67042398],
    'chair-02': [10.12957573, 0.59154999, -7.67113805],
    'chair-03': [10.12886143, 0.59154999, -4.72957587],
    'chair-04': [13.07042408, 0.59154999, -4.72886181],
  };
  const chairNodes = [];
  for (const chair of chairs) {
    if (measuredSeatCenters[chair.id]) {
      chair.seatPosition = measuredSeatCenters[chair.id];
      chair.seatHeight = measuredSeatCenters[chair.id][1];
      chair.seatCalibration = 'World-space center of the evaluated source cushion top; seatHeight is absolute world Y.';
    }
    const matching = allNodes.filter(({ node }) => node.extras?.chairId === chair.id || node.name === chair.objectName || sourceNames(node).has(chair.objectName));
    if (matching.length !== 1) (partial && !chunkIds.has('lounge') ? warn : error)(`${chair.id} requires one identifiable export node; found ${matching.length}.`);
    chairNodes.push({ id: chair.id, nodes: matching.map(n => `${n.chunk}/${n.node.name ?? n.index}`) });
  }
  const screenName = manifest.screen?.objectName;
  const screens = screenName ? allNodes.filter(({ node }) => node.name === screenName || sourceNames(node).has(screenName)) : [];
  if (screens.length !== 1) (partial && !chunkIds.has('lounge') ? warn : error)(`Original screen ${screenName ?? '(missing manifest name)'} requires one identifiable node; found ${screens.length}.`);
  report.interactions = { chairs: chairNodes, screen: screens.map(n => `${n.chunk}/${n.node.name ?? n.index}`) };

  const provenance = manifest.geometryProvenance;
  if (!provenance) {
    (partial ? warn : error)('Final source geometry provenance is missing; complete-export validation cannot pass.');
  } else {
    if (provenance.geometryRebuilt !== false) error('Manifest does not confirm original evaluated geometry was preserved.');
    const expectedTriangles = provenance.evaluatedTriangles;
    if (!Number.isSafeInteger(expectedTriangles) || expectedTriangles <= 0) error('Missing evaluated source triangle total.');
    else if (expectedTriangles !== triangles) (partial ? warn : error)(`Triangle count mismatch: evaluated source ${expectedTriangles}, exported active geometry ${triangles}, difference ${triangles - expectedTriangles}.`);
    if (!provenance.sourceNamesFile) error('Missing original source-name manifest.');
    else {
      try {
        const expected = readJSON(localAsset(provenance.sourceNamesFile));
        if (!Array.isArray(expected) || expected.some(name => typeof name !== 'string')) throw new Error('Source name file must be an array of names.');
        const expectedSet = new Set(expected);
        const missing = [...expectedSet].filter(name => !allSourceNames.has(name));
        const unexpected = [...allSourceNames].filter(name => !expectedSet.has(name));
        if (missing.length) (partial ? warn : error)(`${missing.length} source objects have no exported provenance entry.`);
        if (unexpected.length) error(`${unexpected.length} exported names are absent from the source-name manifest.`);
        if (expected.length !== expectedSet.size) error('Original source-name manifest contains duplicate names.');
        if (provenance.sourceObjects !== expectedSet.size) error('Original source object total differs from the source-name list.');
        report.provenance = { expectedTriangles, exportedTriangles: triangles, expectedObjects: expectedSet.size, exportedSourceNames: allSourceNames.size, missing, unexpected };
      } catch (cause) { error(`Provenance: ${cause.message}`); }
    }
  }
  if (!Object.keys(report.provenance).length) report.provenance = { exportedTriangles: triangles, exportedSourceNames: allSourceNames.size, complete: false };

  const claimedHash = manifest.source?.sha256?.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(claimedHash ?? '')) error('The manifest has no valid original source SHA-256.');
  const auditPath = path.join(workspace, 'outputs/scene-audit/scene-audit.json');
  const audit = existsSync(auditPath) ? readJSON(auditPath) : null;
  const sourcePath = sourcePathArg ?? audit?.probe?.file;
  if (!sourcePath || !existsSync(sourcePath)) error('Original .blend is unavailable for hash validation. Supply --source with its unchanged path.');
  else {
    const actualHash = await sha256(sourcePath);
    if (actualHash !== claimedHash) error('Original .blend SHA-256 does not match the export manifest.');
    report.source = { filename: path.basename(sourcePath), manifestSHA256: claimedHash, actualSHA256: actualHash, matches: actualHash === claimedHash };
  }

  // These audit images are JPEGs, so the source's linked image-alpha chain is
  // uniformly opaque. Do not fabricate a cutout map from their green channel.
  const extractedPath = path.join(workspace, 'outputs/extracted-textures/manifest.json');
  const extracted = existsSync(extractedPath) ? readJSON(extractedPath) : [];
  for (const [material, image] of [['potted_plant_01_leaves', 'potted_plant_01_leaves_diff.png'], ['shrub_01', 'shrub_01_diff']]) {
    const original = extracted.find(item => item.image === image);
    if (!original) { warn(`Could not verify original foliage alpha payload for ${material}.`); continue; }
    const payloadPath = path.join(workspace, 'outputs/extracted-textures', original.file);
    const magic = existsSync(payloadPath) ? readFileSync(payloadPath).subarray(0, 3) : null;
    const jpeg = !!magic && magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
    report.foliageAlpha.push({ material, sourceImage: image, extractedFile: original.file, actualJPEG: jpeg, action: jpeg ? 'No cutout texture added: original image alpha is uniformly opaque.' : 'Unexpected image format; inspect original alpha before approval.' });
    if (!jpeg) warn(`Unexpected non-JPEG source alpha payload for ${material}; inspect manually.`);
  }

  if (!errors.length && write) {
    manifest.assetValidation = { report: '/assets/asset-validation.json', scope: report.scope, sourceHashMatches: report.source.matches === true, exportedTriangles: triangles, checkedAt: report.checkedAt };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    report.manifestWritten = true;
  }
  report.ok = errors.length === 0;
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, scope: report.scope, manifestWritten: report.manifestWritten, chunks: report.chunks.length, triangles, materials: report.materials.length, repairs: repairs.length, errors, warnings, report: path.relative(app, reportPath) }, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch(cause => { console.error(`Asset validation failed: ${cause.message}`); process.exitCode = 1; });
