// GLSL for the stage canvas. Everything is display-referred: textures are sampled as authored and written
// straight to the buffer, so the canvas matches the CSS rendering of the same artwork.
// Colour math uses plain uniforms; each uniform's safe range is noted beside it.

const NOISE = /* glsl */`
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), f.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), f.x), f.y);
}`;

const SDF = /* glsl */`
float sdRound(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}
// Outward unit gradient of sdRound, exact, so bevel normals stay crisp at any size.
vec2 sdGrad(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  vec2 s = vec2(p.x < 0. ? -1. : 1., p.y < 0. ? -1. : 1.);
  if(q.x > 0. && q.y > 0.) return s * normalize(q);
  return q.x > q.y ? vec2(s.x, 0.) : vec2(0., s.y);
}`;

export const QUAD_VS = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;

// Copies the previous pass so the next glass level can draw over it.
export const COPY_FS = /* glsl */`
uniform sampler2D uTex;   // previous pass
uniform vec2 uRes;        // buffer size, px
void main(){
  gl_FragColor = vec4(texture2D(uTex, gl_FragCoord.xy / uRes).rgb, 1.);
}`;

// The cabinet ground: the same walnut, paper and ink the stylesheet paints, plus a light that rakes the grain.
export const GROUND_FS = /* glsl */`
uniform sampler2D uGrain;   // walnut strip, repeats across the stage
uniform sampler2D uPaper;   // ivory calcite, cover-fitted
uniform vec2 uRes;          // buffer size, px
uniform vec2 uPaperSize;    // paper image size, px
uniform vec3 uTheme;        // weights for walnut / paper / ink, each 0..1, summing to 1
uniform vec3 uLight;        // xy: light position in buffer px, z: strength 0..1
uniform float uWarm;        // 0..1, lamp warm-up on first load (1 = settled)
uniform float uBar;         // header height in buffer px, 0 = no header strip
uniform float uTime;        // seconds
${NOISE}
vec3 rgb(float r, float g, float b){ return vec3(r, g, b) / 255.; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = vec3(0.);
  if(uTheme.x > .001){
    vec3 grain = texture2D(uGrain, vec2(uv.x / .22, uv.y)).rgb;
    vec4 a = vec4(rgb(20., 14., 10.), .79), b = vec4(rgb(36., 26., 16.), .54), c = vec4(rgb(16., 12., 8.), .65);
    vec4 g = uv.x < .67 ? mix(a, b, uv.x / .67) : mix(b, c, (uv.x - .67) / .33);
    vec3 w = mix(grain, g.rgb, g.a);
    vec2 lp = (gl_FragCoord.xy - uLight.xy) / uRes.y;
    float l = exp(-dot(lp, lp) * 4.2) * uLight.z;
    float gl = dot(grain, vec3(.3333));
    w += vec3(1., .76, .5) * l * (.018 + gl * .42);
    // Two soft pools of lamplight, so glass laid on the wood has light and shade to bend.
    vec2 pa = (uv - vec2(.8, .72)) * vec2(uRes.x / uRes.y, 1.), pb = (uv - vec2(.16, .2)) * vec2(uRes.x / uRes.y, 1.);
    w += vec3(1., .74, .46) * (exp(-dot(pa, pa) * 1.1) * .085 + exp(-dot(pb, pb) * 1.6) * .05) * (.35 + gl * 2.2);
    col += w * uTheme.x;
  }
  if(uTheme.y > .001){
    float ar = uRes.x / uRes.y, ai = uPaperSize.x / uPaperSize.y;
    vec2 s = ar > ai ? vec2(1., ai / ar) : vec2(ar / ai, 1.);
    vec3 paper = texture2D(uPaper, .5 + (uv - .5) * s).rgb;
    float t = clamp(.5 + ((uv.x - .5) * .94 * uRes.x - (uv.y - .5) * .342 * uRes.y) / (.94 * uRes.x + .342 * uRes.y), 0., 1.);
    vec4 g = mix(vec4(rgb(241., 229., 208.), .90), vec4(rgb(243., 234., 215.), .81), t);
    col += mix(paper, g.rgb, g.a) * uTheme.y;
  }
  col += rgb(17., 15., 12.) * uTheme.z;
  // The header strip, so glass in the header has something to refract. Its hairline and shadow stay in CSS.
  float top = uRes.y - gl_FragCoord.y;
  if(top < uBar){
    vec4 g = mix(vec4(rgb(18., 13., 9.), .74), vec4(rgb(33., 22., 10.), .79), uv.x);
    col = mix(textureLod(uGrain, vec2(uv.x / .25, 1. - top / uBar), 0.).rgb, g.rgb, g.a);
  }
  vec2 cc = (uv - vec2(.6, .5)) * vec2(uRes.x / uRes.y, 1.);
  col = col * (.25 + .75 * uWarm) + vec3(1., .8, .56) * exp(-dot(cc, cc) * 2.6) * sin(3.14159 * uWarm) * .1;
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.) - .5) / 255.;
  gl_FragColor = vec4(col, 1.);
}`;

// A projected artwork plate. Blends two images with a refracting ring that travels from uOrigin,
// and carries the gradients the stylesheet lays over the same artwork.
export const PLATE_FS = /* glsl */`
varying vec2 vUv;
uniform sampler2D uTexA;   // outgoing image
uniform sampler2D uTexB;   // incoming image
uniform vec4 uCropA;       // xy: visible fraction for object-fit cover, zw: object-position (0..1, y up)
uniform vec4 uCropB;
uniform float uHasA;       // 0 or 1; 0 reveals the incoming image out of nothing
uniform float uMix;        // 0..1 transition progress
uniform vec2 uOrigin;      // ring origin in plate uv, may lie outside 0..1
uniform vec2 uSize;        // plate size, css px
uniform float uRadius;     // corner radius, css px
uniform float uDpr;        // buffer px per css px
uniform float uAlpha;      // 0..1
uniform float uSat;        // 0..1.2 saturation
uniform float uFadeL;      // 0..0.5 width of the left fade into the ground, 0 = off
uniform vec3 uShadeB;      // bottom shade: strength 0..1, height 0..1, curve 1..2
uniform float uShadeD;     // 0..1 top-left diagonal shade
uniform vec2 uPar;         // -0.02..0.02 parallax, uv
uniform float uZoom;       // 1..1.2
uniform float uBlur;       // 0..5 mip level, rack focus
uniform float uSweep;      // -1 (off) or 0..1.2 position of the light sweep
uniform float uGrain;      // 0..1 film grain
uniform float uGain;       // 0.6..1.1 exposure
uniform float uTime;       // seconds
uniform float uLiquid;     // 1 = refracting ring, 0 = plain cross-fade (reduced motion)
uniform float uRaw;        // 1 = write the blend only, used to freeze a transition
${NOISE}
${SDF}
vec2 fit(vec4 crop, vec2 uv){ return crop.zw + (uv - crop.zw) * crop.xy; }
vec3 texA(vec2 uv){ return textureLod(uTexA, fit(uCropA, uv), uBlur).rgb; }
vec3 texB(vec2 uv){ return textureLod(uTexB, fit(uCropB, uv), uBlur).rgb; }
void main(){
  vec2 uv = vUv;
  if(uRaw < .5) uv = (uv - .5) / uZoom + .5 + uPar;
  vec3 col; float a; float m = uMix;
  if(uLiquid > .5 && uMix > 0. && uMix < 1.){
    vec2 asp = vec2(uSize.x / uSize.y, 1.);
    vec2 d = (vUv - uOrigin) * asp;
    float r = length(d);
    float maxR = length(max(abs(uOrigin), abs(1. - uOrigin)) * asp);
    float band = .1 * maxR + .025;
    vec2 nd = d / max(r, 1e-4);
    float wob = (vnoise(nd * 2.2 + uTime * .35) - .5) * band * .35;
    float front = uMix * (maxR + band * 1.6) - band * .6;
    float e = (r + wob - front) / band;
    float b = exp(-e * e * 5.);
    m = smoothstep(.12, -.12, e);
    if(b > .004){
      vec2 k = nd / asp * b * band * .5 * sin(3.14159 * min(1., uMix * 1.2)) * clamp(e * 2.5, -1., 1.);
      vec3 ca = vec3(texA(uv - k * 1.12).r, texA(uv - k).g, texA(uv - k * .88).b);
      vec3 cb = vec3(texB(uv - k * 1.12).r, texB(uv - k).g, texB(uv - k * .88).b);
      float aa = uHasA * (1. - m);
      a = aa + m;
      col = (ca * aa + cb * m) / max(a, 1e-4);
      col += vec3(1., .86, .62) * pow(b, 5.) * .1 * sin(3.14159 * uMix);
    } else if(m > .5){ col = texB(uv); a = 1.; }
    else { col = texA(uv); a = uHasA; }
  } else {
    float aa = uHasA * (1. - m);
    a = aa + m;
    col = (texA(uv) * aa + texB(uv) * m) / max(a, 1e-4);
  }
  if(uRaw > .5){ gl_FragColor = vec4(col, a); return; }
  col = mix(vec3(dot(col, vec3(.2126, .7152, .0722))), col, uSat);
  float sq = (vUv.x - uSweep + (vUv.y - .5) * .22) / .07;
  col += vec3(1., .9, .74) * exp(-sq * sq) * .14 * step(-.5, uSweep);
  col *= uGain;
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - .5) * .045 * uGrain;
  col = mix(col, vec3(.067, .047, .035), uShadeB.x * pow(1. - clamp(vUv.y / max(uShadeB.y, 1e-3), 0., 1.), uShadeB.z));
  float td = .5 + ((vUv.x - .5) * .766 * uSize.x + (.5 - vUv.y) * .643 * uSize.y) / (.766 * uSize.x + .643 * uSize.y);
  col = mix(col, vec3(.114, .082, .067), uShadeD * (1. - clamp(td / .42, 0., 1.)));
  if(uFadeL > 0.) a *= smoothstep(0., uFadeL, vUv.x);
  vec2 p = (vUv - .5) * uSize;
  a *= clamp(.5 - sdRound(p, uSize * .5, min(uRadius, min(uSize.x, uSize.y) * .5)) * uDpr, 0., 1.);
  gl_FragColor = vec4(col, a * uAlpha);
}`;

// Liquid glass. Each slab is a real solid of glass: a rounded extrusion with rounded edges and a domed crown,
// ray-traced from a camera straight in front of it. Light refracts into the slab, travels through it (bouncing
// once inside where it cannot get out), refracts out and lands on the stage behind. That is what makes the
// backdrop magnify in the body and flip and smear at the rim.
// The solid, the march and its constants follow zerowing's liquid-glass (MIT, see vendor/liquid-glass-LICENSE.txt).
// Here each slab draws in its own quad and refracts the live stage, so glass can sit on glass and bend moving artwork.
// Lengths are css px with y up.
export const GLASS_FS = /* glsl */`
uniform sampler2D uBack;   // the stage behind this slab, mip-mapped
uniform vec2 uRes;         // buffer size, px
uniform vec2 uStage;       // stage size
uniform float uDpr;        // buffer px per css px
uniform vec4 uRect;        // centre xy, half size
uniform vec4 uLook;        // corner radius, frost 0..1, chroma 0..0.1, pointer pull 0..40
uniform vec4 uTint;        // rgb as displayed, strength 0..1
uniform vec4 uProfile;     // half depth 0..132, edge rounding, dome, index of refraction 1.05..2.4
uniform vec4 uExtra;       // shadow 0..1, press highlight 0..1, opacity 0..1, inner light 0..0.4
uniform vec2 uLight;       // lamp position
uniform vec2 uPointer;     // pointer position, eased
uniform vec3 uClip;        // framed glass: visible half size and corner radius (the solid runs on under the frame); x = 0 for free glass
uniform float uEnv;        // 0..1 how strongly the room's softbox shows in reflections; low for large framed panes

const float CAMERA = 780.;
const float BACKGROUND = -190.;
vec2 pointerLocal;

vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 sharp(vec2 pixel){ return lin(textureLod(uBack, clamp(pixel * uDpr / uRes, .001, .999), 0.).rgb); }
// A wide soft copy of the stage: a coarse mip, spread over five taps.
vec3 soft(vec2 pixel){
  vec2 uv = clamp(pixel * uDpr / uRes, .001, .999), s = 10. * uDpr / uRes;
  return lin((textureLod(uBack, uv, 3.).rgb * 2. + textureLod(uBack, uv + s * vec2(.8, .6), 3.).rgb + textureLod(uBack, uv + s * vec2(-.6, .8), 3.).rgb
            + textureLod(uBack, uv + s * vec2(-.8, -.6), 3.).rgb + textureLod(uBack, uv + s * vec2(.6, -.8), 3.).rgb) / 6.);
}
float box(vec2 p, vec2 hs, float r){
  vec2 q = abs(p) - hs + r;
  return min(max(q.x, q.y), 0.) + length(max(q, 0.)) - r;
}
vec2 boxNormal(vec2 p, vec2 hs, float r){
  vec2 q = abs(p) - hs + r;
  vec2 s = vec2(p.x < 0. ? -1. : 1., p.y < 0. ? -1. : 1.);
  if(q.x > 0. && q.y > 0.) return s * normalize(q);
  return q.x > q.y ? vec2(s.x, 0.) : vec2(0., s.y);
}
// The slab's outline, bulging a little toward a nearby pointer. x: distance, yz: outward normal.
vec3 field(vec2 p){
  float radius = min(uLook.x, min(uRect.z, uRect.w));
  vec2 t = p - pointerLocal;
  float pull = uLook.w * exp(-dot(t, t) / 1800.);
  return vec3(box(p, uRect.zw, radius) - pull, normalize(boxNormal(p, uRect.zw, radius) + pull * t / 900. + 1e-6));
}
// Rounded extrusion with a smooth convex crown. x: distance, yzw: gradient of the same solid.
vec4 solid(vec3 p){
  vec3 b = field(p.xy);
  vec2 radius = max(uRect.zw, vec2(20.));
  float dome = uProfile.z * exp(-1.5 * dot(p.xy / radius, p.xy / radius));
  vec2 domeGrad = -3. * dome * p.xy / (radius * radius);
  float rounding = uProfile.y;
  vec2 q = vec2(b.x + rounding, abs(p.z) - uProfile.x - dome + rounding);
  vec2 o = max(q, 0.);
  float len = length(o);
  vec2 w = len > .0001 ? o / len : (q.x > q.y ? vec2(1., 0.) : vec2(0., 1.));
  return vec4(min(max(q.x, q.y), 0.) + len - rounding, w.x * vec3(b.yz, 0.) + w.y * vec3(-domeGrad, p.z < 0. ? -1. : 1.));
}
bool enter(vec3 ro, vec3 rd, out vec3 hit){
  vec3 bounds = vec3(uRect.zw + uLook.w + 6., uProfile.x + uProfile.z + 10.);
  vec3 inv = 1. / (rd + vec3(.000001));
  vec3 a = (-bounds - ro) * inv, b = (bounds - ro) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  float farT = min(min(hi.x, hi.y), hi.z);
  float travel = max(0., max(max(lo.x, lo.y), lo.z));
  hit = ro;
  if(farT < travel) return false;
  for(int i = 0; i < 56; i++){
    hit = ro + rd * travel;
    float d = solid(hit).x;
    if(d < .12) return true;
    travel += max(.06, d * .74);
    if(travel > farT) break;
  }
  return false;
}
vec3 leave(vec3 ro, vec3 rd, out float traveled){
  float travel = .6;
  vec3 point = ro + rd * travel;
  float limit = 2. * (uRect.z + uRect.w) + 2. * uProfile.x;
  for(int i = 0; i < 48; i++){
    point = ro + rd * travel;
    float d = -solid(point).x;
    if(i > 1 && d < .12) break;
    travel += max(.1, d * .74);
    if(travel > limit) break;
  }
  traveled = travel;
  return point;
}
// What the glass mirrors: a soft, displaced view of the stage, a warm softbox up and to the left, a fill at the right.
// lights: how much of the softbox and fill shows. Light leaving the glass sideways at a thick corner sees
// the room dimly; at full strength it lit single pixels white over a dark ground.
vec3 environment(vec3 dir, vec2 pixel, float lights){
  vec3 mirrored = soft(uStage * .5 + dir.xy * uStage * .42);
  float a = (dir.x + .42) / .16, b = (dir.y - .58) / .28, c = (dir.x - .7) / .1, e = dir.y / .55;
  return mix(mirrored, mix(sharp(pixel), soft(pixel), .65), .2) + vec3(.96, .98, 1.) * (exp(-a * a - b * b * b * b) * 1.65 + exp(-c * c - e * e * e * e) * .07) * uEnv * lights;
}
void main(){
  vec2 pixel = gl_FragCoord.xy / uDpr;
  vec2 local = pixel - uRect.xy;
  pointerLocal = uPointer - uRect.xy;
  float radius = min(uLook.x, min(uRect.z, uRect.w));
  float lift = min(uRect.w, 40.);
  float shade = (1. - smoothstep(-lift * .3, lift * .8, box(local - vec2(2., -lift * .22), uRect.zw, radius))) * uExtra.x * .3;
  float ds = field(local).x;
  float d = uClip.x > 0. ? box(local, uClip.xy, uClip.z) : ds;
  if(d > 2.){ gl_FragColor = vec4(0., 0., 0., shade * uExtra.z); return; }

  vec3 view = normalize(vec3(local, -CAMERA));
  float ior = uProfile.w;
  vec3 front, normal, rear, outgoing;
  float path;
  if(ds < -uProfile.y - 2.){
    // Inside the rounded edge both faces are the smooth crown, so the slab works as a thick lens and the
    // ray can be followed in closed form: in through the crown, across the slab, out through the mirrored
    // crown below. This covers every framed pane and the body of every free slab, and costs no march.
    vec2 rr = max(uRect.zw, vec2(20.));
    float dome = uProfile.z * exp(-1.5 * dot(local / rr, local / rr));
    vec2 dg = -3. * dome * local / (rr * rr);
    float zf = uProfile.x + dome;
    front = vec3(local * (CAMERA - zf) / CAMERA, zf);
    normal = normalize(vec3(-dg, 1.));
    vec3 inside = refract(view, normal, 1. / ior);
    path = 2. * zf / max(-inside.z, .2);
    rear = front + inside * path;
    outgoing = refract(inside, -normalize(vec3(-dg, -1.)), ior);
  } else {
    // The rounded edge: march the solid, as zerowing's liquid-glass does.
    if(!enter(vec3(0., 0., CAMERA), view, front)){
      float contact = (1. - smoothstep(-2., 13., field(local - vec2(2., -7.)).x)) * .045;
      gl_FragColor = vec4(0., 0., 0., (shade + contact * uExtra.x) * uExtra.z);
      return;
    }
    normal = normalize(solid(front).yzw);
    vec3 inside = refract(view, normal, 1. / ior);
    rear = leave(front, inside, path);
    vec3 rearNormal = normalize(solid(rear).yzw);
    outgoing = refract(inside, -rearNormal, ior);
    // Where the first exit reflects totally, follow one bounce inside instead of leaving a dark band.
    if(dot(outgoing, outgoing) < .01){
      inside = reflect(inside, rearNormal);
      float more;
      rear = leave(rear, inside, more);
      path += more;
      rearNormal = normalize(solid(rear).yzw);
      outgoing = refract(inside, -rearNormal, ior);
      if(dot(outgoing, outgoing) < .01) outgoing = reflect(inside, rearNormal);
    }
  }
  vec3 transmitted;
  if(outgoing.z < -.045){
    vec2 landed = (rear.xy + outgoing.xy * ((BACKGROUND - rear.z) / outgoing.z)) * CAMERA / (CAMERA - BACKGROUND);
    vec2 disp = clamp(uRect.xy + landed - pixel, vec2(-180.), vec2(180.));
    float grazing = 1. - max(dot(normal, -view), 0.);
    float blur = clamp(grazing * grazing * 1.6 + length(disp) / 300. + uLook.y, .02, .92);
    vec3 split = vec3(sharp(pixel + disp * (1. - uLook.z)).r, sharp(pixel + disp).g, sharp(pixel + disp * (1. + uLook.z)).b);
    transmitted = mix(split, soft(pixel + disp), blur);
  } else transmitted = environment(outgoing, pixel, 0.);
  // A long path through the glass warms the light a little; the tint is the colour of the glass itself.
  transmitted *= exp(-vec3(.00007, .00015, .00032) * min(path, 250.));
  vec3 tint = lin(uTint.rgb);
  transmitted = mix(transmitted, tint, uTint.a) + tint * uExtra.w;

  float f0 = (ior - 1.) / (ior + 1.);
  float fresnel = f0 * f0 + (1. - f0 * f0) * pow(1. - max(dot(normal, -view), 0.), 5.);
  vec3 color = mix(transmitted, environment(reflect(view, normal), pixel, 1.), fresnel);
  vec3 toLight = normalize(vec3(uLight - uRect.xy - front.xy, 500.));
  // The lamp's glint. On a large flat pane it would spread into a broad haze, so framed glass has none.
  color += vec3(1., .97, .9) * pow(max(dot(normal, normalize(toLight - view)), 0.), 160.) * (.04 + uExtra.y * .1) * step(uClip.x, 0.);
  // Over a dark ground there is little bright scene for the rim to mirror, so the lit room is added back as a
  // fine line where the surface turns away at the silhouette: brightest on the side facing the lamp, a faint
  // return opposite. Only the outermost pixels of the curve, so the body stays clear.
  float edge = pow(1. - clamp(normal.z, 0., 1.), 5.);
  float facing = dot(normalize(normal.xy + 1e-5), normalize(uLight - uRect.xy + 1e-3));
  color += vec3(1., .95, .86) * edge * (.04 + .96 * smoothstep(0., 1., facing)) * .85 * uEnv;
  color *= 1. + uExtra.y * .06;

  float cov = max(clamp(.5 - d * uDpr, 0., 1.), step(d, -1.));
  float a = cov + shade * (1. - cov);
  gl_FragColor = vec4(pow(max(color, vec3(0.)), vec3(1. / 2.2)) * cov / max(a, 1e-4), a * uExtra.z);
}`;

// Dust in the projector beam.
export const DUST_VS = /* glsl */`
attribute vec4 aSeed;      // xy: position 0..1, z: depth 0..1, w: phase 0..1
uniform vec2 uStage;       // stage size, css px
uniform vec2 uPar;         // -0.02..0.02 parallax
uniform float uTime;       // seconds
uniform float uDpr;
varying float vA;
void main(){
  float z = aSeed.z;
  vec2 p = aSeed.xy;
  p.y = fract(p.y + uTime * (.004 + .008 * z));
  p.x = fract(p.x + sin(uTime * .11 + aSeed.w * 6.283) * .012 + uTime * .0015 * (z - .5));
  p += uPar * (.3 + z * 1.4);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p * uStage, 0., 1.);
  gl_PointSize = (1.5 + z * z * 7.) * uDpr;
  vA = (.05 + .15 * z) * (.6 + .4 * sin(uTime * .7 + aSeed.w * 40.));
}`;

export const DUST_FS = /* glsl */`
uniform float uAlpha;      // 0..1
varying float vA;
void main(){
  float s = smoothstep(.5, 0., length(gl_PointCoord - .5));
  gl_FragColor = vec4(1., .86, .66, s * s * vA * uAlpha);
}`;
