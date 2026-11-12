uniform float uTint, uHi, uTime;
varying vec3 vN; varying vec3 vO; varying vec3 vP; varying vec3 vV;
void main(){
  vec3 n = normalize(vN);
  float d = max(dot(n, normalize(vec3(-.35,.85,.55))),0.)*.9 + max(dot(n, normalize(vec3(.8,-.25,.5))),0.)*.28;
  float rim = pow(1.-abs(dot(n, normalize(vV))), 2.5)*.45;
  float r = length(vP.xz), a = atan(vP.z, vP.x);
  float lum;
  if (abs(vO.y) > .5) {
    lum = .5 + .5*d + rim*.2;
    lum *= .78 + .22*step(.5, fract(r*4.2));
    lum *= mix(.55, 1., step(.16, fract(a/6.28318*5.)));
    lum *= smoothstep(.12,.2,r)*.8+.2;
  } else {
    lum = .03 + .3*max(dot(n, normalize(vec3(.8,-.1,.6))),0.) + rim*.25;
    lum *= mix(.35, 1., smoothstep(.012,.04,abs(vP.y)));
    float led = step(.985, cos(a - uTime*2.)) * step(abs(vP.y), .07);
    lum += led*.6*uHi;
  }
  lum = mix(lum, lum*1.15+.12, uHi);
  gl_FragColor = vec4(clamp(lum,0.,1.), uTint, uHi, abs(vO.y) > .5 ? .75 : 1.);
}
