attribute vec4 aC; attribute float aD;
uniform float uK; uniform vec2 uOff, uRes; uniform vec3 uCol;
varying vec4 vC;
void main(){
  vec2 p = position.xy + uOff * uK * aD;
  vec2 c = p / uRes * 2. - 1.;
  gl_Position = vec4(c.x, -c.y, 0., 1.);
  gl_PointSize = position.z;
  float a = aC.a;
  vec3 rgb = aC.rgb;
  if (uK > .5) { rgb = mix(rgb, uCol, clamp(aD, 0., 1.)); a *= step(.02, aD); }
  vC = vec4(rgb * a, a);
  // A bit the fragment shader would discard is moved outside clip space instead: software GL
  // then skips its fragments entirely (the faded extrusion layers during the dust).
  if (a < .004) gl_Position = vec4(2., 2., 2., 1.);
}
