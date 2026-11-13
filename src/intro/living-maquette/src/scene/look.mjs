/**
 * Look development values for the Living Maquette runtime renderer.
 *
 * The kit's scene_manifest.json `runtime_look` supplies art-direction starting
 * values. Everything here was calibrated in the target renderer (three.js r186)
 * against 01_ui_package/reference/approved_theme.png, P02_lighting.png,
 * L01_stair_material_target.png and L02_glazing_material_target.png.
 *
 * Coordinates are glTF Y-up. Azimuths are degrees in the XZ plane: 0 is +X and
 * 90 is +Z (the camera side). Directions named "towards" point at the model.
 */

export const LOOK = Object.freeze({
  camera: {
    // A two-point perspective from about 35 degrees left of the front
    // elevation. The eye sits between the upper floor and the roof and looks
    // level, so verticals stay parallel, the lower room reads from above and
    // the roof soffit, with its light line, reads from below. The distance
    // keeps the oval plinth as shallow as it is drawn in the approved theme
    // (about 13 degrees) without a wide-angle bulge.
    azimuthDeg: 37,
    pitchDeg: 0,
    fovDeg: 30,
    distance: 20,
    // Eye level and aim point.
    target: [0.3, 5.4, 0.0],
    // World-space rectangle on the plane through the target that is fitted
    // inside the stage rect: the exploded silhouette plus a small margin. Its
    // centre sits below eye level (lens shift, not tilt).
    frame: { width: 11.85, height: 10.15, offsetX: -0.56, offsetY: -2.27 },
    near: 4,
    far: 160,
  },
  // Bounded turntable. Copy and model stay apart across the whole range.
  yaw: { limitDeg: 22, stepDeg: 9, passiveDeg: 5 },
  renderer: {
    toneMapping: 'aces',
    exposure: 1.0,
    maxPixelRatio: 1.5,
    maxPixels: 2_400_000,
    fpsCap: 30,
  },
  // Runtime refinements of the imported proportions, applied to the rest pose
  // before the scene adapter captures it. Pivots keep every joint in place.
  proportions: {
    plinth: { scaleX: 1.14, scaleZ: 1.2, scaleY: 1.18 },
    // The approved roof is a thin slab (about 0.2 units at this scale); the
    // floor it floats over is visibly thicker.
    roofThickness: 1.1,
    upperFloorThickness: 1.5,
    // Section of the bronze glazing bars, relative to the imported section.
    // Bars thinner than `maxSection` are widened about their own centre line,
    // which also keeps them from aliasing at mobile size.
    glazingBars: { inPlane: 2.7, maxSection: 0.115 },
  },
  shadow: {
    // PCF: r186's variance shadows darken any face that is steep to the light
    // (the slab fascias lost the whole key), so the softer filter is not used.
    type: 'pcf',
    mapSize: 2048,
    distance: 46,
    coneDeg: 21,
    penumbra: 0.25,
    near: 22,
    far: 74,
    radius: 3,
    blurSamples: 10,
    bias: -0.0004,
    normalBias: 0.03,
  },
  // Key-light cookie: soft branch shadows. Positions are fractions of the
  // light's cone (0.5, 0.5 is the model); see dev/lookdev.html?cookie=grid.
  cookie: {
    branches: [
      // On the studio floor behind and to the right of the plinth.
      { x: 0.74, y: 0.3, spread: 0.16, heading: 2.5, twigs: 8, alpha: 0.5 },
      { x: 0.8, y: 0.6, spread: 0.14, heading: 2.9, twigs: 6, alpha: 0.42 },
    ],
  },
  ground: { size: 120, color: '#6f431f' },
  // Soft occlusion where the plinth meets the studio floor.
  contact: { color: '#5b3415', opacity: 0.5, spread: 1.22 },
  environment: {
    zenith: [0.62, 0.52, 0.4],
    horizon: [1.15, 0.95, 0.72],
    nadir: [0.3, 0.2, 0.12],
    horizonSharpness: 2.2,
    drift: { azimuthDeg: 142, gain: 1.22 },
    panels: [
      // Key softbox: the same direction as the key light.
      { azimuthDeg: 142, elevationDeg: 38, widthDeg: 30, heightDeg: 24, radiance: [12, 9.8, 7.0], softDeg: 10 },
      // Overhead fill.
      { azimuthDeg: -20, elevationDeg: 64, widthDeg: 54, heightDeg: 22, radiance: [1.5, 1.4, 1.2], softDeg: 16 },
      // Wash on the far studio wall, opposite the camera: the satin top of the
      // plinth and the sheen on the stone floors mirror it at a grazing angle.
      { azimuthDeg: -53, elevationDeg: 15, widthDeg: 80, heightDeg: 20, radiance: [1.3, 1.08, 0.85], softDeg: 12 },
      // Floor-level strips that streak the plinth and the stair cladding.
      { azimuthDeg: 76, elevationDeg: -15, widthDeg: 8, heightDeg: 44, radiance: [5.0, 4.1, 2.9], softDeg: 4 },
      { azimuthDeg: 103, elevationDeg: -15, widthDeg: 4, heightDeg: 44, radiance: [3.0, 2.4, 1.7], softDeg: 3 },
      { azimuthDeg: 28, elevationDeg: -15, widthDeg: 5, heightDeg: 44, radiance: [3.4, 2.7, 1.9], softDeg: 3 },
      { azimuthDeg: 170, elevationDeg: -15, widthDeg: 6, heightDeg: 44, radiance: [2.8, 2.2, 1.5], softDeg: 3 },
      { azimuthDeg: -148, elevationDeg: -13, widthDeg: 11, heightDeg: 40, radiance: [2.0, 1.55, 1.1], softDeg: 5 },
    ],
  },
  light: {
    warm: {
      // A low afternoon sun from the front left: long shadows towards the
      // right and light that reaches in under the lifted roof.
      keyColor: '#ffe0c4',
      // three.js r186 lights are physical: lit stone is albedo x E / pi, so a
      // sunlit face needs a key several times the fill to read as sunlit.
      keyIntensity: 8.0,
      keyTowards: [0.74, -0.5, -0.45],
      shadowIntensity: 0.92,
      // The hemisphere is bounce light: the stone floor and plinth throw warm
      // light up on to soffits; the studio ceiling gives less.
      fillSky: '#b89684',
      fillGround: '#ffb088',
      fillIntensity: 1.2,
      rimColor: '#ffb06a',
      rimIntensity: 0.6,
      envIntensity: 0.42,
      groundShadowOpacity: 0.42,
      emissive: 1.0,
      cookie: 1.0,
      exposure: 1.0,
    },
    // Soft: the same room on a quieter day. A higher, paler sun, more bounce,
    // shorter and fainter shadows, no branch dapples; stone and bronze keep
    // their colour so the two lights read as one place.
    soft: {
      keyColor: '#ffdcb8',
      keyIntensity: 4.6,
      keyTowards: [0.5, -0.76, -0.42],
      shadowIntensity: 0.5,
      fillSky: '#bfa088',
      fillGround: '#ffb685',
      fillIntensity: 1.9,
      rimColor: '#ffe0c0',
      rimIntensity: 0.3,
      envIntensity: 0.5,
      groundShadowOpacity: 0.2,
      emissive: 0.75,
      cookie: 0.0,
      exposure: 1.0,
    },
  },
  materials: {
    // Environment amount for anything not listed below.
    defaultEnv: 0.4,
    // `linear` multiplies the supplied base-colour image. The travertine image
    // is a pale beige: it is taken down and towards rose so that sunlit stone
    // keeps its colour instead of clipping to white (approved lit stone is
    // about #f0cdb0, shaded soffits about #ae7c59).
    travertine: { roughness: 0.34, metalness: 0.0, envMapIntensity: 0.4, linear: [0.82, 0.7, 0.65] },
    // The supplied brushed-metal image is an ochre gold; the approved plinth,
    // frames and stair are a redder champagne bronze (#b37843 lit, #774925 in
    // shade), so green is pulled down hardest.
    plinthBronze: { roughness: 0.3, metalness: 0.96, envMapIntensity: 1.0, linear: [1.05, 0.82, 0.9] },
    bronzeSeam: { roughness: 0.4, metalness: 0.85, envMapIntensity: 0.8 },
    bronzeEdge: { roughness: 0.22, metalness: 1.0, envMapIntensity: 0.9, linear: [0.36, 0.17, 0.065] },
    furnishingBronze: { roughness: 0.22, metalness: 1.0, envMapIntensity: 1.0, linear: [0.55, 0.28, 0.11] },
    darkBronze: { roughness: 0.3, metalness: 0.95, envMapIntensity: 1.0, linear: [0.3, 0.16, 0.07] },
    // The shelving reads as a deep bronze-brown niche, not red timber.
    walnut: { roughness: 0.5, metalness: 0.0, envMapIntensity: 0.35, linear: [0.62, 0.55, 0.48] },
    ivory: { roughness: 0.62, metalness: 0.0, envMapIntensity: 0.35 },
    leafLight: { linear: [0.38, 0.4, 0.12] },
    leafOlive: { linear: [0.27, 0.3, 0.08] },
    leafDark: { linear: [0.14, 0.17, 0.045] },
    // A faint warm veil that dims what is behind it, plus the room's
    // reflection; amounts are in linear light.
    glass: { tint: '#ffd2a2', veil: 0.012, coverage: 0.12, reflect: 0.42, roughness: 0.04 },
    emissiveStrip: { color: '#ffb25c', intensity: 4.0 },
    // Soft spill around the ceiling light lines (additive, on the soffit).
    stripHalo: { color: '#ffa550', width: 0.62, strength: 0.5 },
    shelfGlow: { color: '#ff9a45', intensity: 2.2 },
  },
});
