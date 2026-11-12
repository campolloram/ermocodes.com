varying vec3 vN; varying vec3 vO; varying vec3 vP; varying vec3 vV;
void main(){
  vO = normal; vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
