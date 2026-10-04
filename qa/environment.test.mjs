import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { BoxGeometry, Color, Fog, Mesh, MeshStandardMaterial, Scene, Texture } from 'three';

const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
// Mock only HDR loading; geometry, material changes and ownership use production code.
const loader = dataModule(`import {Texture} from ${JSON.stringify(import.meta.resolve('three'))}; export async function loadEnvironment(){return new Texture();}`);
const sandSource = ts.transpileModule(fs.readFileSync(new URL('../src/runtime/rendering/SandSurface.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`);
let source = ts.transpileModule(fs.readFileSync(new URL('../src/runtime/rendering/DesertEnvironment.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
for (const module of ['three', 'three/webgpu', 'three/tsl']) source = source.replace(`from '${module}'`, `from ${JSON.stringify(import.meta.resolve(module))}`);
source = source.replace("from './assets'", `from ${JSON.stringify(loader)}`);
source = source.replace("from './SandSurface'", `from ${JSON.stringify(dataModule(sandSource))}`);
const { createDesertGeometry, createDesertEnvironment, SOURCE_GROUND } = await import(dataModule(source));

test('distant terrain meets source ground, leaves a central opening and stays below 40k triangles', () => {
  const geometry = createDesertGeometry();
  try {
    assert.equal(geometry.index.count / 3, 37632);
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const centerX = (SOURCE_GROUND.minX + SOURCE_GROUND.maxX) / 2, centerZ = (SOURCE_GROUND.minZ + SOURCE_GROUND.maxZ) / 2;
    let maximum = -Infinity, groundPoints = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      assert.ok(Number.isFinite(x + y + z));
      const outside = x <= SOURCE_GROUND.minX + 0.0001 || x >= SOURCE_GROUND.maxX - 0.0001 || z <= SOURCE_GROUND.minZ + 0.0001 || z >= SOURCE_GROUND.maxZ - 0.0001;
      const buriedOverlap = Math.min(x - SOURCE_GROUND.minX, SOURCE_GROUND.maxX - x, z - SOURCE_GROUND.minZ, SOURCE_GROUND.maxZ - z) < 0.251 && y < SOURCE_GROUND.y - 0.001;
      assert.ok(outside || buriedOverlap, 'only a narrow buried seam strip may overlap the retained source ground');
      assert.ok(normals.getY(i) > 0, 'terrain surface must face upward');
      if (Math.hypot(x - centerX, z - centerZ) < 70) {
        assert.ok(y <= SOURCE_GROUND.y + 0.0001 && y >= SOURCE_GROUND.y - 0.019, 'near perimeter stays flat with a small buried seam strip');
        groundPoints++;
      }
      maximum = Math.max(maximum, y);
    }
    assert.ok(groundPoints > 197); assert.ok(maximum > 15 && maximum < 30);
  } finally { geometry.dispose(); }
});

test('context changes only background and identified ground material, then restores them', async () => {
  const scene = new Scene(), background = new Color('#405060'), environment = new Texture(), fog = new Fog('#223344', 1, 2);
  scene.background = background; scene.environment = environment; scene.fog = fog;
  const original = new MeshStandardMaterial(); original.name = 'shell__Neutral architectural ground';
  const ground = new Mesh(new BoxGeometry(2, 0.2, 2), original);
  const stone = new MeshStandardMaterial(); stone.name = 'Source architectural stone';
  const building = new Mesh(new BoxGeometry(1, 1, 1), stone); scene.add(ground, building);
  const context = await createDesertEnvironment(scene);
  try {
    assert.equal(context.sourceGroundMaterials, 1); assert.equal(context.triangles, 37632);
    assert.notEqual(scene.background, background); assert.equal(scene.environment, environment); assert.equal(scene.fog, fog);
    assert.notEqual(ground.material, original); assert.equal(building.material, stone);
    assert.equal(context.root.children.length, 1); assert.equal(context.root.children[0].castShadow, false);
    assert.equal(context.root.children[0].userData.noCollision, true);
    context.dispose(); context.dispose();
    assert.equal(scene.background, background); assert.equal(scene.environment, environment); assert.equal(ground.material, original);
    assert.equal(context.root.parent, null);
  } finally { context.dispose(); ground.geometry.dispose(); building.geometry.dispose(); original.dispose(); stone.dispose(); environment.dispose(); }
});
