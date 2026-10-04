/** Local CPU encoder; no source content is uploaded.
 * node tooling/encode-atlas-ktx2.cjs lounge [entrance shell gallery founder studio]
 * Requires the verified official KTX 4.4.2 WASM bundle at workspace/work/tools/ktx-wasm.
 * This produces sidecars only. convert-glb-textures.mjs performs a separate validated commit.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const app = path.resolve(__dirname, '..');
const workspace = path.resolve(app, '../..');
const args = process.argv.slice(2);
const option = name => args.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const textureDir = path.resolve(option('textures') || path.join(app, 'public/assets/textures'));
const reportDir = path.resolve(option('reports') || path.join(workspace, 'work/ktx-validation'));
for (const target of [textureDir, reportDir]) if (path.relative(workspace, target).startsWith('..')) throw new Error('Encoder output must remain inside this workspace.');
const wasmDir = path.join(workspace, 'work/tools/ktx-wasm');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const decodeSRGB = new Float32Array(256);
for (let i = 0; i < 256; i++) { const x = i / 255; decodeSRGB[i] = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }
function encodeSRGB(x) { return Math.round(Math.min(1, Math.max(0, x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055)) * 255); }

function nextMip(source, width, height, kind) {
  const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = (Math.min(height - 1, y * 2) * width + Math.min(width - 1, x * 2)) * 4;
    const b = (Math.min(height - 1, y * 2) * width + Math.min(width - 1, x * 2 + 1)) * 4;
    const c = (Math.min(height - 1, y * 2 + 1) * width + Math.min(width - 1, x * 2)) * 4;
    const d = (Math.min(height - 1, y * 2 + 1) * width + Math.min(width - 1, x * 2 + 1)) * 4;
    const o = (y * w + x) * 4;
    if (kind === 'normal') {
      let nx = (source[a] + source[b] + source[c] + source[d]) / 510 - 1;
      let ny = (source[a + 1] + source[b + 1] + source[c + 1] + source[d + 1]) / 510 - 1;
      let nz = (source[a + 2] + source[b + 2] + source[c + 2] + source[d + 2]) / 510 - 1;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-5) { nx /= len; ny /= len; nz /= len; } else { nx = 0; ny = 0; nz = 1; }
      out[o] = Math.round((nx * .5 + .5) * 255); out[o + 1] = Math.round((ny * .5 + .5) * 255); out[o + 2] = Math.round((nz * .5 + .5) * 255);
    } else for (let channel = 0; channel < 3; channel++) {
      out[o + channel] = kind === 'base'
        ? encodeSRGB((decodeSRGB[source[a + channel]] + decodeSRGB[source[b + channel]] + decodeSRGB[source[c + channel]] + decodeSRGB[source[d + channel]]) * .25)
        : Math.round((source[a + channel] + source[b + channel] + source[c + channel] + source[d + channel]) * .25);
    }
    out[o + 3] = Math.round((source[a + 3] + source[b + 3] + source[c + 3] + source[d + 3]) * .25);
  }
  return { data: out, width: w, height: h };
}
function metrics(source, decoded, kind) {
  if (source.length !== decoded.length) throw new Error('Decoded image size mismatch.');
  let error = 0, peak = 0, opaqueError = 0, normalCount = 0, normalSum = 0;
  const angles = new Uint32Array(1801);
  for (let i = 0; i < source.length; i += 4) {
    for (let c = 0; c < 3; c++) { const e = source[i + c] - decoded[i + c]; error += e * e; peak = Math.max(peak, Math.abs(e)); }
    opaqueError = Math.max(opaqueError, Math.abs(source[i + 3] - decoded[i + 3]));
    if (kind === 'normal') {
      const ax = source[i] / 127.5 - 1, ay = source[i + 1] / 127.5 - 1, az = source[i + 2] / 127.5 - 1;
      const len = Math.hypot(ax, ay, az);
      // Exclude unoccupied black atlas texels; include all valid source normals.
      if (len > .8 && len < 1.2 && az > -.05) {
        const bx = decoded[i] / 127.5 - 1, by = decoded[i + 1] / 127.5 - 1, bz = decoded[i + 2] / 127.5 - 1;
        const dot = (ax * bx + ay * by + az * bz) / (len * Math.hypot(bx, by, bz));
        const angle = Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
        normalSum += angle; normalCount++; angles[Math.min(1800, Math.floor(angle * 10))]++;
      }
    }
  }
  let p99 = 0, cumulative = 0;
  for (let i = 0; i < angles.length; i++) { cumulative += angles[i]; if (cumulative >= normalCount * .99) { p99 = (i + 1) / 10; break; } }
  const psnr = error ? 10 * Math.log10(255 ** 2 / (error / (source.length * .75))) : 999;
  return { rgbPSNR: psnr, maxChannelError: peak, alphaMaxError: opaqueError, ...(kind === 'normal' ? { validNormalPixels: normalCount, normalMeanDegrees: normalSum / normalCount, normal99PercentileDegrees: p99 } : {}) };
}

(async () => {
  fs.mkdirSync(reportDir, { recursive: true });
  const k = await require(path.join(wasmDir, 'libktx.js'))({ wasmBinary: fs.readFileSync(path.join(wasmDir, 'libktx.wasm')) });
  const zones = args.filter(x => !x.startsWith('--'));
  if (!zones.length || zones.some(x => !/^(lounge|entrance|shell|gallery|founder|studio)(-[a-z0-9]+)*$/.test(x))) throw new Error('Specify one or more scene atlas identifiers.');
  for (const zone of zones) for (const kind of ['base', 'orm', 'normal']) {
    const name = `${zone}-${kind}`;
    const inputPath = path.join(textureDir, `${name}.png`), outputPath = path.join(textureDir, `${name}.ktx2`);
    const sourcePNG = fs.readFileSync(inputPath), sourceSHA256 = hash(sourcePNG);
    const reportPath = path.join(reportDir, `${name}.json`);
    if (fs.existsSync(reportPath) && fs.existsSync(outputPath)) {
      const prior = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (prior.ok && prior.sourceSHA256 === sourceSHA256 && prior.outputSHA256 === hash(fs.readFileSync(outputPath))) { console.log(JSON.stringify({ name, cached: true, bytes: prior.bytes })); continue; }
    }
    const start = Date.now();
    const decoded = await sharp(sourcePNG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.channels !== 4) throw new Error(`${name}: expected RGBA image.`);
    const width = decoded.info.width, height = decoded.info.height;
    if ((width & (width - 1)) || (height & (height - 1))) throw new Error(`${name}: mip generator expects power-of-two dimensions.`);
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    const info = new k.textureCreateInfo();
    Object.assign(info, { vkFormat: kind === 'base' ? k.VkFormat.R8G8B8A8_SRGB : k.VkFormat.R8G8B8A8_UNORM, baseWidth: width, baseHeight: height, baseDepth: 1, numDimensions: 2, numLevels: levels, numLayers: 1, numFaces: 1, isArray: false, generateMipmaps: false });
    const texture = new k.texture(info, k.TextureCreateStorageEnum.ALLOC_STORAGE);
    let mip = { data: decoded.data, width, height };
    for (let level = 0; level < levels; level++) {
      if (texture.setImageFromMemory(level, 0, 0, mip.data).value !== 0) throw new Error(`${name}: mip upload ${level} failed.`);
      if (level + 1 < levels) mip = nextMip(mip.data, mip.width, mip.height, kind);
    }
    texture.addKVPairString('KTXorientation', 'rd');
    const params = new k.basisParams();
    Object.assign(params, { uastc: true, uastcFlags: k.pack_uastc_flag_bits.LEVEL_SLOWER, uastcRDO: false, threadCount: 1, normalMap: false, inputSwizzle: 'rgba', verbose: false });
    console.log(JSON.stringify({ name, phase: 'encoding', width, height, levels }));
    if (texture.compressBasis(params).value !== 0) throw new Error(`${name}: UASTC encoding failed.`);
    if (texture.deflateZstd(9).value !== 0) throw new Error(`${name}: lossless Zstd compression failed.`);
    const encoded = Buffer.from(texture.writeToMemory());
    const checked = new k.texture(encoded);
    if (checked.baseWidth !== width || checked.baseHeight !== height || checked.isSrgb !== (kind === 'base')) throw new Error(`${name}: encoded dimensions or color-space metadata mismatch.`);
    if (checked.transcodeBasis(k.transcode_fmt.RGBA32, 0).value !== 0) throw new Error(`${name}: reference transcode failed.`);
    const quality = metrics(decoded.data, checked.getImage(0, 0, 0), kind);
    const ok = quality.rgbPSNR >= (kind === 'orm' ? 43 : 39) && quality.alphaMaxError === 0 && (kind !== 'normal' || (quality.normalMeanDegrees < 1 && quality.normal99PercentileDegrees < 5));
    const report = { name, ok, sourceSHA256, outputSHA256: hash(encoded), bytes: encoded.length, sourcePNGBytes: sourcePNG.length, width, height, levels, encoder: 'Official Khronos KTX 4.4.2 portable WASM', mode: 'UASTC level 3 / slower, no RDO, Zstd 9', channelPacking: 'RGBA preserved; normal RGB is not swizzled or reduced', colorSpace: kind === 'base' ? 'sRGB' : 'linear data', mipFilter: kind === 'base' ? 'Linear-light box, then sRGB encode' : kind === 'normal' ? 'XYZ average then renormalize' : 'Linear box', orientation: 'rd', seconds: (Date.now() - start) / 1000, quality };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    checked.delete(); params.delete(); texture.delete(); info.delete();
    if (!ok) throw new Error(`${name}: quality gate failed; original GLB and PNG remain untouched. ${JSON.stringify(quality)}`);
    fs.writeFileSync(outputPath + '.tmp', encoded); fs.renameSync(outputPath + '.tmp', outputPath);
    console.log(JSON.stringify(report));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
