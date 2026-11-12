// The one inline script in <head>. When the motion layer may run (no reduced motion, and a WebGL2
// context that really opens on a GPU: a probe canvas, released at once, because
// 'WebGL2RenderingContext' in window is true on a phone or VM with no working GPU) it
// marks html.motion before the first paint, so the pinned layout's final geometry (the hero hold,
// the Experience chapters' scroll distance, both reserved in styles/sections/motion-scenes.css) is in place from the first
// paint: the page never grows under the reader, a #link or a reload lands where it should, and
// nothing shifts when the engine arrives seconds later on a slow phone. Without html.motion boot.ts
// never loads the engine, so the page never switches layout after the first paint. A software
// rasteriser (SwiftShader, llvmpipe: no GPU behind WebGL) counts as no WebGL: it would draw every
// frame on the CPU and block the main thread, which is why Chrome no longer falls back to it
// either. Test builds (PUBLIC_TEST_HOOKS=1) accept it, so CI's GPU-less browsers run the motion layer.
// boot.ts marks html[data-mboot] when it runs; if it never ran by the load event (the module failed
// to load), or the engine still cannot start (boot.ts plainDom), html.motion comes off and the
// page is plain DOM.
// html.js (always) lets CSS keep room for controls the script shows (the queue demo's button).
// It also marks html.pwait: the hero name is then not drawn as text (it stays in the DOM, laid out
// and readable by assistive tech) until the particles have gathered into it. If the engine has not
// started drawing within FALLBACK_MS the plain text shows and the intro is skipped, so the name is
// never missing for long. A visitor who paused
// the motion (sessionStorage, this visit) gets html.mpaused before the first paint too.
// astro.config.mjs hashes this exact string into the CSP, so edit it here only.
export const FALLBACK_MS = 1200;
export const MOTION_PAUSE_KEY = 'ec-motion-paused';
/** WebGL renderer names that mean a software rasteriser (no GPU). */
export const SOFTWARE_GL = 'swiftshader|llvmpipe|softpipe|software|basic render';

/**
 * The script text. Chromium masks RENDERER ("WebKit WebGL") behind the debug extension; Firefox
 * gives the real (sanitised) name and warns that the extension is deprecated, so it is asked for
 * only when masked (as scene/renderer.ts does). By default a test build (PUBLIC_TEST_HOOKS=1 at
 * build time) accepts software WebGL.
 * @param {{ allowSoftwareGL?: boolean }} [options]
 */
export function headScript({
  allowSoftwareGL = typeof process !== 'undefined' && process.env.PUBLIC_TEST_HOOKS === '1',
} = {}) {
  const ok = allowSoftwareGL ? 'true' : `!/${SOFTWARE_GL}/i.test(n)`;
  return `(function(){var d=document.documentElement;d.classList.add('js');function gl(){try{var g=document.createElement('canvas').getContext('webgl2');if(!g)return false;var n=String(g.getParameter(g.RENDERER));if(/^webkit/i.test(n)){var i=g.getExtension('WEBGL_debug_renderer_info');if(i)n=String(g.getParameter(i.UNMASKED_RENDERER_WEBGL))}var x=g.getExtension('WEBGL_lose_context');if(x)x.loseContext();return ${ok}}catch(e){return false}}if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&gl()){d.classList.add('motion','pwait');try{if(sessionStorage.getItem('${MOTION_PAUSE_KEY}')==='1')d.classList.add('mpaused')}catch(e){}setTimeout(function(){d.classList.remove('pwait')},${FALLBACK_MS});addEventListener('load',function(){if(!d.hasAttribute('data-mboot'))d.classList.remove('motion')})}})()`;
}

/** The build's script: Base.astro inlines it and astro.config.mjs hashes it (build time only). */
export const HEAD_SCRIPT = /* @__PURE__ */ headScript();
