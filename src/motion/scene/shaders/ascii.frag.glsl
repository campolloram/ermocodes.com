precision highp float;
uniform sampler2D tScene, tAtlas, tData;
uniform vec2 uCells, uRes;
uniform float uN, uRamp, uEdge0, uGrid0, uTime, uGrid, uSoft, uFade, uObj;
uniform vec4 uMask[MASKS];
uniform float uMaskS[MASKS];
uniform vec3 cA, cB, cH;
uniform vec2 uNoiseScale, uNoiseDrift;
uniform vec2 uGridBright;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float A(vec2 c){ return step(.5, texture2D(tScene, (c+.5)/uCells).a); }
float F(vec2 c){ return texture2D(tScene, (c+.5)/uCells).a; }
float mask(vec2 p){
  float m = 0.;
  for (int i = 0; i < MASKS; i++) {
    vec4 r = uMask[i];
    vec2 e = min(p - r.xy, r.zw - p);
    m = max(m, smoothstep(-uSoft, uSoft, min(e.x, e.y)) * uMaskS[i]);
  }
  return m;
}
void main(){
  vec2 cs = uRes / uCells;
  vec2 cp = gl_FragCoord.xy / cs;
  vec2 cell = floor(cp), loc = fract(cp);
  vec4 s = texture2D(tScene, (cell+.5)/uCells);
  float m;
  float gi, b; vec3 col;
  if (s.a > .5) {
    m = mask((cell + .5) * cs);
    float lum = s.r;
    gi = lum < .1 ? 0. : 1. + floor(pow(clamp(lum,0.,.999),1.2)*(uRamp-1.));
    float gx = A(cell+vec2(1.,0.)) - A(cell-vec2(1.,0.));
    float gy = A(cell+vec2(0.,1.)) - A(cell-vec2(0.,1.));
    float rimE = 0.;
    float aD = F(cell-vec2(0.,1.));
    if (s.a < .9 && aD > .9) { gi = uEdge0 + 1.; rimE = 1.; }
    if (abs(gx)+abs(gy) > .5) {
      float ax = abs(gx), ay = abs(gy);
      gi = uEdge0 + (ax > ay*2. ? 0. : (ay > ax*2. ? 1. : (gx*gy > 0. ? 3. : 2.)));
      rimE = 1.;
    }
    b = (.5 + .5*lum + s.b*.25 + rimE*.25) * (1. - .74*m) * uObj;
    col = mix(mix(cA, cB, s.g), cH, s.b*.45);
  } else {
    vec4 d = texture2D(tData, (cell+.5)/uCells);
    float g = floor(d.r*255. + .5);
    // An empty grid cell draws nothing: leave before the noise and the masks (software GL pays
    // for every pixel of the full-screen pass).
    if (g < .5) { gl_FragColor = vec4(0.); return; }
    m = mask((cell + .5) * cs);
    float heat = d.b;
    float nz = vn(cell*uNoiseScale + uNoiseDrift*uTime);
    nz = smoothstep(.2,.9,nz)*.9 + .1;
    b = (uGrid*d.g*nz*uGridBright.x + heat*uGridBright.y) * (1. - .55*m);
    if (b < .004) { gl_FragColor = vec4(0.); return; }
    gi = uGrid0 + g - 1.;
    col = mix(cA*.82, cH, clamp(heat*1.25, 0., 1.));
  }
  float ink = texture2D(tAtlas, vec2((gi + loc.x)/uN, loc.y)).r;
  float a = ink*b*uFade;
  gl_FragColor = vec4(col*a, a);
}
