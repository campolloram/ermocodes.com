precision mediump float;
varying vec4 vC;
void main(){ if (vC.a < .004) discard; gl_FragColor = vC; }
