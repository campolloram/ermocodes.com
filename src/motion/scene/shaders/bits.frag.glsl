precision highp float;
uniform vec3 cA, cB, cP, cX;
varying vec4 vA; varying vec2 vB;
// Hard square bits, the same matte material as the hero intro: solid, axis-aligned, opaque. No
// glyph inside, no rotation (a turned sprite clips to an octagon), no translucency (a bit shrinks
// away instead of fading). Tones are the palette's: paper, moss, dark moss, and the group's own
// accent (lime only for the startups, and only on a few bits).
void main(){
  if (vA.y < .003) discard;
  float t = vB.x;
  vec3 accent = mix(cA, cB, vB.y);
  vec3 col = t < .38 ? cP : (t < .68 ? cA : (t < .88 ? cX : accent));
  col = mix(col, cP, vA.w);
  gl_FragColor = vec4(col, 1.);
}
