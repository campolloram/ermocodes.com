// The morphing ASCII figure: six database discs drawn into the low-res target. Scroll scrubs
// split -> cluster -> emph -> active -> gather through poses.ts.
import {
  CylinderGeometry,
  MathUtils,
  Mesh,
  NoBlending,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { FIGURE } from '../config.ts';
import { clamp01, ss } from '../math.ts';
import { type Layout, type Pose, poseFor } from '../poses.ts';
import { scene as S } from '../state.ts';
import discFrag from './shaders/disc.frag.glsl?raw';
import discVert from './shaders/disc.vert.glsl?raw';
import { view } from './view.ts';

interface Disc {
  pivot: Object3D;
  mesh: Mesh;
  mat: ShaderMaterial;
}

export interface Figure {
  scene: Scene;
  camera: PerspectiveCamera;
  layout: Layout;
  /** Recomputes the camera and layout after a resize; `slot` is the hero slot rect in canvas px. */
  resize: (slot: { cx: number; cy: number; w: number; h: number }) => void;
  update: (time: number, pointer: { x: number; y: number }, still: boolean) => void;
  /** World position and pose of a disc, projected to canvas px (for the group labels). */
  project: (pose: Pose) => { x: number; y: number };
  posesFor: (i: number) => Pose;
  phases: () => { split: number; cluster: number; gather: number; emph: number };
}

export function createFigure(): Figure {
  const scene = new Scene();
  const camera = new PerspectiveCamera(FIGURE.fov, 1, 0.1, 60);
  camera.position.set(0, 0, FIGURE.cameraZ);
  const geo = new CylinderGeometry(1, 1, FIGURE.thickness, FIGURE.radialSegments, 1);
  const discs: Disc[] = [];
  for (let i = 0; i < FIGURE.discs; i += 1) {
    const mat = new ShaderMaterial({
      vertexShader: discVert,
      fragmentShader: discFrag,
      blending: NoBlending,
      uniforms: { uTint: { value: 0 }, uHi: { value: 0 }, uTime: { value: 0 } },
    });
    const pivot = new Object3D();
    const mesh = new Mesh(geo, mat);
    pivot.add(mesh);
    scene.add(pivot);
    discs.push({ pivot, mesh, mat });
  }
  const layout: Layout = {
    halfW: 1,
    halfH: 1,
    unit: 1,
    phone: true,
    slot: { cx: 0, cy: 0, w: 1, h: 1 },
    width: 1,
    height: 1,
  };
  const v = new Vector3();

  const phases = () => ({
    split: ss(clamp01(S.split)),
    cluster: ss(clamp01(S.cluster)),
    gather: ss(clamp01(S.gather)),
    emph: ss(clamp01(S.emph)),
  });

  return {
    scene,
    camera,
    layout,
    resize(slot) {
      camera.aspect = view.W / view.H;
      camera.updateProjectionMatrix();
      layout.halfH = Math.tan(MathUtils.degToRad(FIGURE.fov / 2)) * camera.position.z;
      layout.halfW = layout.halfH * camera.aspect;
      layout.unit = Math.min(layout.halfW, layout.halfH);
      layout.phone = view.phone;
      layout.width = view.W;
      layout.height = view.H;
      layout.slot = slot;
    },
    update(time, pointer, still) {
      const ph = phases();
      const p = FIGURE.parallax;
      for (let i = 0; i < discs.length; i += 1) {
        const d = discs[i]!;
        const pose = poseFor(layout, i, { ...ph, active: S.active });
        const bob = still ? 0 : Math.sin(time * 0.8 + i * 0.7) * FIGURE.bobAmp * pose.s;
        d.pivot.position.set(pose.px, pose.py + bob, pose.pz);
        d.pivot.rotation.set(
          pose.tx + pointer.y * p.tiltX,
          pointer.x * p.yaw + ph.split * 1.4 * (1 - ph.cluster),
          pose.tz - pointer.x * p.roll,
        );
        d.mesh.position.set(pose.lx, pose.ly, 0);
        d.mesh.rotation.set(
          pose.rx,
          (still ? 0 : time * (FIGURE.spinBase + i * FIGURE.spinStep)) +
            i * FIGURE.phase +
            ph.split * (i % 2 ? 2 : -2),
          pose.rz,
        );
        d.mesh.scale.setScalar(pose.s);
        d.mat.uniforms.uTint!.value =
          pose.tint * ph.cluster * (1 - ph.gather) + (i < 3 ? 0 : 1) * ph.gather;
        d.mat.uniforms.uHi!.value = pose.hi * ph.cluster * (1 - ph.gather);
        d.mat.uniforms.uTime!.value = time;
      }
    },
    project(pose) {
      v.set(pose.px, pose.py + pose.s * FIGURE.labelLift, pose.pz).project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * view.W,
        y: (-v.y * 0.5 + 0.5) * view.H - FIGURE.labelOffsetY,
      };
    },
    posesFor: (i) => poseFor(layout, i, { ...phases(), active: S.active }),
    phases,
  };
}
