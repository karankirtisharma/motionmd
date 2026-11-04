import { DataTexture, NearestFilter, RGFormat, UnsignedByteType, type Texture } from 'three';
import { texture,vec2 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

export type ChairTileLayout = {
  width:number; height:number; gridX:number; gridY:number; tile:number; pitch:number;
  atlasWidth:number; atlasHeight:number; indices:string;
};

export function createChairLookup(layout:ChairTileLayout) {
  const data=Uint8Array.from(atob(layout.indices),s=>s.charCodeAt(0));
  if(data.length!==2*layout.gridX*layout.gridY) throw Error('Invalid packed chair tile lookup');
  const map=new DataTexture(data,layout.gridX,layout.gridY,RGFormat,UnsignedByteType);
  map.name='Chair GI | source tile coordinates';
  map.minFilter=map.magFilter=NearestFilter;map.generateMipmaps=false;map.flipY=false;map.needsUpdate=true;
  return map;
}

/** The EXR uses clamp-to-edge, one linear-filtered mip level and no anisotropic
 * filter in either pinned backend. At each tile boundary its copied neighbors
 * therefore supply exactly the same original four bilinear texels. */
export function sampleChairLightmap(atlas:Texture,index:Texture,layout:ChairTileLayout,sourceUV:Node<'vec2'>) {
  const pixel=sourceUV.clamp(0,1).mul(vec2(layout.width,layout.height));
  const grid=vec2(layout.gridX,layout.gridY);
  const cell=pixel.div(layout.tile).floor().min(grid.sub(1));
  const page=texture(index,cell.add(.5).div(grid)).rg.mul(255).round();
  const packedPixel=page.mul(layout.pitch).add(1).add(pixel.sub(cell.mul(layout.tile)));
  return texture(atlas,packedPixel.div(vec2(layout.atlasWidth,layout.atlasHeight))).rgb;
}
