import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector2, Vector3, WebGPUCoordinateSystem, WebGLCoordinateSystem } from 'three';
import { nativeScreenSampleOffset } from '../src/runtime/rendering/nativeScreenSampleOffset.ts';

test('native display coverage cancels every temporal jitter direction without moving the DOM or camera', () => {
  for (const backend of [WebGPUCoordinateSystem, WebGLCoordinateSystem]) {
    const camera = new PerspectiveCamera(63, 1705/929, .05, 100);
    camera.coordinateSystem=backend; camera.updateProjectionMatrix();
    const point=new Vector3(.45,.25,-2), stable=point.clone().project(camera);
    for (const [x,y] of [[-.5,-.5],[-.3,.4],[.375,-.125],[0,0],[.5,.5]]) {
      camera.setViewOffset(1705,929,x,y,1705,929);
      const jittered=point.clone().project(camera), matrix=camera.projectionMatrix.clone();
      const sample=nativeScreenSampleOffset(camera,new Vector2());
      assert.ok(Math.abs((stable.x+1)/2+sample.x-(jittered.x+1)/2)<1e-10);
      assert.ok(Math.abs((1-stable.y)/2+sample.y-(1-jittered.y)/2)<1e-10);
      assert.ok(matrix.equals(camera.projectionMatrix));
      camera.clearViewOffset();
      assert.deepEqual(nativeScreenSampleOffset(camera,new Vector2()).toArray(),[0,0]);
    }
  }
});
