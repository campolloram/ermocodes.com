precision highp float;
uniform vec4 uRect;
uniform vec2 uView;
varying vec2 vP;
void main(){
  vec2 local = position.xy * uRect.zw;
  vP = local;
  vec2 css = uRect.xy + local;
  vec2 c = css / uView * 2. - 1.;
  gl_Position = vec4(c.x, -c.y, 0., 1.);
}
