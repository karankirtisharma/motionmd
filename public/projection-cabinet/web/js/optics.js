'use strict';

// A single, on-demand layer traces the nearest part of a rounded glass rim.
// The DOM remains responsible for all layout, text and interaction.
(() => {
  if (!runtimeConfig.opticalRim || !window.WebGLRenderingContext) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'cabinet-optics';
  canvas.hidden = true;
  canvas.setAttribute('aria-hidden','true');
  let gl, program, uniforms, pending = 0, pointer, failed = false;
  const vertex = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
  const fragment = [
    'precision mediump float;',
    'uniform vec2 size, cursor; uniform float corner;',
    'void main(){',
    ' vec2 p=gl_FragCoord.xy-size*.5;',
    ' vec2 q=abs(p)-(size*.5-vec2(corner));',
    ' float sdf=length(max(q,0.))+min(max(q.x,q.y),0.)-corner;',
    ' float rim=1.-smoothstep(.2,2.1,abs(sdf+1.4));',
    ' float glare=exp(-length(gl_FragCoord.xy-cursor)/max(18.,min(size.x,size.y)*.8));',
    // Premultiplied output: transparent pixels carry no colour, so nothing is added outside the rim
    // on display paths that composite the canvas as premultiplied.
    ' float a=rim*glare*.82;',
    ' gl_FragColor=vec4(vec3(1.,.87,.64)*a,a);',
    '}'
  ].join('\n');

  function initialize() {
    gl = canvas.getContext('webgl',{alpha:true,antialias:false,depth:false});
    if (!gl) return false;
    program = gl.createProgram();
    for (const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader,source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) return false;
      gl.attachShader(program,shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program,'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    uniforms = Object.fromEntries(['size','cursor','corner'].map(k=>[k,gl.getUniformLocation(program,k)]));
    document.body.append(canvas);
    return true;
  }
  function hide() { pointer=null; canvas.hidden=true; }
  function draw() {
    pending=0;
    if (!pointer || reduce() || !pointer.el.isConnected || failed) return hide();
    if (!gl && !initialize()) { failed=true; return hide(); }
    const {el,x,y}=pointer, r=el.getBoundingClientRect();
    const scale=Math.min(devicePixelRatio||1,1.5,1536/Math.max(r.width,1));
    const w=Math.round(r.width*scale), h=Math.round(r.height*scale);
    if (!w || !h) return hide();
    if (canvas.width!==w || canvas.height!==h) {canvas.width=w;canvas.height=h;}
    Object.assign(canvas.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});
    gl.viewport(0,0,w,h);
    gl.uniform2f(uniforms.size,w,h);
    gl.uniform2f(uniforms.cursor,(x-r.left)*scale,(r.bottom-y)*scale);
    gl.uniform1f(uniforms.corner,Math.min(w/2,h/2,(parseFloat(getComputedStyle(el).borderTopLeftRadius)||0)*scale));
    gl.drawArrays(gl.TRIANGLES,0,3);
    canvas.hidden=false;
  }
  app.addEventListener('pointermove',event=>{
    const el=event.target.closest('.glassrim,.glassbtn,.tile');
    // Glass drawn on the stage canvas (js/fx) carries its own highlights.
    if (!el || el.classList.contains('fx-glass') || event.pointerType!=='mouse' || failed || reduce()) return hide();
    pointer={el,x:event.clientX,y:event.clientY};
    if (!pending) pending=requestAnimationFrame(draw);
  });
  for (const [node,event] of [[app,'pointerleave'],[window,'cabinet:view'],[window,'blur'],[window,'resize'],[document,'scroll']]) {
    node.addEventListener(event,hide,true);
  }
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();failed=true;hide();});
})();
