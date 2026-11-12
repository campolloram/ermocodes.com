attribute vec4 aA; attribute vec2 aB; uniform vec2 uRes;
varying vec4 vA; varying vec2 vB;
void main(){ vA = aA; vB = aB; vec2 c = position.xy/uRes*2. - 1.;
  gl_Position = vec4(c.x, -c.y, 0., 1.); gl_PointSize = position.z;
  // Same cut as the fragment shader's discard, before any fragment is made.
  if (aA.y < .003) gl_Position = vec4(2., 2., 2., 1.); }
