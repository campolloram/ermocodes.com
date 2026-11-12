// Liquid melt of one hero letter. The letter sits in its own atlas cell (white glyph, alpha only);
// p is the position inside the cell in css px, y down. At zero heat the output is the DOM letter
// (face plus six extrusion layers); heat bulges, sags and stretches it near the pointer, merges
// the pixels into one gooey body, and shades that body like liquid metal in the site's moss tones.
precision highp float;
uniform sampler2D tAtlas;
uniform vec4 uRect;       // cell size in .zw
uniform vec4 uAtlas;      // atlas rect of the cell: u0, v0, du, dv
uniform vec2 uInk;        // cell-local y of the cap line and of the baseline
uniform vec2 uC;          // melt centre, cell-local
uniform vec2 uExt;        // extrusion step per layer, css px
uniform float uE;         // font size, px
uniform float uHeat;
uniform float uR;
uniform float uTime;
uniform float uSeed;
uniform float uM;         // 1 for an M: three shallow extrusion layers
uniform vec4 uDrop[3];    // x, y, radius, alpha (alpha 0 = none)
uniform vec3 uFace, uX1, uX2, uX3, uAcc, uHi, uSig;
varying vec2 vP;

float h1(float n){ return fract(sin(n * 127.1 + uSeed) * 43758.5453); }
float vn(float x){
  float i = floor(x);
  float f = fract(x);
  return mix(h1(i), h1(i + 1.), f * f * (3. - 2. * f));
}
float tap(vec2 q){
  return texture2D(tAtlas, uAtlas.xy + (q / uRect.zw) * uAtlas.zw).a;
}
vec3 chrome(float e){
  vec3 c = mix(uX3, uX1, smoothstep(0., .34, e));
  c = mix(c, uAcc, smoothstep(.3, .56, e));
  c = mix(c, uHi, smoothstep(.56, .82, e));
  float dark = smoothstep(.40, .46, e) * (1. - smoothstep(.46, .52, e));
  return mix(c, uX3 * .8, dark * .75);
}

void main(){
  vec2 p = vP;
  float u = uE / 11.;
  float w = pow(1. - clamp(length(p - uC) / uR, 0., 1.), 1.6);
  float s = uHeat * w;

  // inverse map: where does the ink that lands on p come from
  float col = p.x / u;
  float dn = vn(col * .55);
  vec2 q = uC + (p - uC) / (1. + .28 * s);
  float tIn = clamp((p.y - uInk.x) / (uInk.y - uInk.x), 0., 1.);
  q.y -= s * uE * (.06 + .5 * dn) * (.35 + .65 * tIn);
  q.x += s * uE * .02 * sin(p.y * .05 + uTime * 2.6 + uSeed);

  float a0 = tap(q);
  float r = u * (.12 + .8 * s);
  float a1 = (2. * a0 + tap(q + vec2(r, 0.)) + tap(q - vec2(r, 0.)) + tap(q + vec2(0., r)) + tap(q - vec2(0., r))) / 6.;

  // drips: ink above, within a column-dependent length, runs down and tapers
  float len = s * uE * (.12 + .7 * dn);
  float dr = 0.;
  for (int k = 1; k <= 4; k++) {
    float f = float(k) * .25;
    dr = max(dr, tap(q - vec2(0., f * len)) * (1. - f * f * .85));
  }

  // droplets (metaballs): field and an analytic slope for their shading
  float F = max(a1, dr);
  vec2 slope = vec2(0.);
  for (int i = 0; i < 3; i++) {
    vec4 d = uDrop[i];
    vec2 v = p - d.xy;
    float g = d.w * exp(-dot(v, v) / (d.z * d.z));
    F += g * 1.05;
    slope += -2. * v / (d.z * d.z) * g;
  }

  float goo = smoothstep(.02, .4, s);
  float fa = mix(a0, smoothstep(.4, .56, F), goo);

  // shading: a wide bevel off the glyph, a cylinder across each drip column, spheres on droplets
  float rb = uE * .1;
  vec2 gr = vec2(tap(q + vec2(rb, 0.)) - tap(q - vec2(rb, 0.)), tap(q + vec2(0., rb)) - tap(q - vec2(0., rb)));
  float dripMask = clamp((dr - a0) * 2., 0., 1.);
  vec3 n = normalize(vec3(-gr.x * 1.6 + (fract(col) - .5) * 1.1 * dripMask - slope.x * uE * .25,
                          -gr.y * 1.6 - slope.y * uE * .25, .55));
  float e = .5 - n.y * .5 + n.x * .22 + .06 * sin(uTime * 1.3 + p.x * .012 + p.y * .02);
  vec3 face = mix(uFace, chrome(e), smoothstep(.04, .5, s));
  face += uSig * pow(max(e - .8, 0.), 2.) * 5. * smoothstep(.1, .6, s);

  // extrusion: the DOM's six hard layers, flattened away as the letter turns liquid
  float ef = 1. - .85 * smoothstep(0., .6, s);
  vec3 P = vec3(0.);
  float A = 0.;
  for (int i = 6; i >= 1; i--) {
    if (uM > .5 && i > 3) continue; // an M: layers 1-3 at half steps, like the DOM's .mm
    float t = tap(q - uExt * (uM > .5 ? float(i) * .5 : float(i))) * ef;
    vec3 lc = uM > .5 ? (i == 1 ? uX1 : (i == 2 ? uX2 : uX3)) : (i <= 2 ? uX1 : (i <= 4 ? uX2 : uX3));
    P = lc * t + P * (1. - t);
    A = t + A * (1. - t);
  }
  P = face * fa + P * (1. - fa);
  A = fa + A * (1. - fa);
  if (A < .004) discard;
  gl_FragColor = vec4(P, A);
}
