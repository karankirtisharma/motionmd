import { float, Fn, ivec2, max, mix, texture, uv, vec2, context, OnBeforeRenderPipeline, OnAfterRenderPipeline, velocity, convertToTexture } from 'three/tsl';
import { FloatType, Vector2 } from 'three/webgpu';
import TRAANode from 'three/addons/tsl/display/TRAANode.js';
import { clipAABB, flickerReduction, sampleCurrentDepth, samplePreviousDepth } from 'three/addons/tsl/utils/TAAUtils.js';

const _size = /*@__PURE__*/ new Vector2();

/** r186 TRAANode with one change: reprojected history is read with a 5-tap
 * Catmull-Rom filter instead of bilinear. Bilinear resampling low-passes the
 * history on every moving frame (95% of each pixel is history), which is what
 * softens textures while walking or turning. At rest the reprojection lands on
 * texel centres, where both filters return the same texel, so still images are
 * unchanged. Weights, variance clipping and flicker reduction are the pinned
 * r186 ones; `setup` below is that method with only the history read replaced.
 * Revalidate against TRAANode.js when three is upgraded. */
class SharpTRAANode extends TRAANode {

	static get type() { return 'SharpTRAANode'; }

	setup( builder ) {

		if ( builder.renderPipeline && ! builder.context.renderPipelineState.viewOffsetOwner ) {

			builder.context.renderPipelineState.viewOffsetOwner = this;
			this._needsPostProcessingSync = true;

			OnBeforeRenderPipeline( () => {

				const size = builder.renderer.getDrawingBufferSize( _size );
				this.setViewOffset( size.width, size.height );

			} );

			OnAfterRenderPipeline( () => { this.clearViewOffset(); } );

		}

		if ( builder.renderer.reversedDepthBuffer === true ) this._historyRenderTarget.depthTexture.type = FloatType;

		this._velocityNode = builder.context.velocity !== undefined ? builder.context.velocity : velocity;

		const varianceClipping = Fn( ( [ positionTexel, currentColor, historyColor, gamma ] ) => {

			const offsets = [ [ - 1, - 1 ], [ - 1, 1 ], [ 1, - 1 ], [ 1, 1 ], [ 1, 0 ], [ 0, - 1 ], [ 0, 1 ], [ - 1, 0 ] ];
			const moment1 = currentColor.toVar();
			const moment2 = currentColor.pow2().toVar();

			for ( const [ x, y ] of offsets ) {

				const neighbor = this.beautyNode.offset( ivec2( x, y ) ).load( positionTexel ).max( 0 );
				moment1.addAssign( neighbor );
				moment2.addAssign( neighbor.pow2() );

			}

			const N = float( offsets.length + 1 );
			const mean = moment1.div( N );
			const variance = moment2.div( N ).sub( mean.pow2() ).max( 0 ).sqrt().mul( gamma );
			const minColor = mean.sub( variance );
			const maxColor = mean.add( variance );

			return clipAABB( mean.clamp( minColor, maxColor ), historyColor, minColor, maxColor );

		} );

		const subpixelCorrection = Fn( ( [ velocityUV, textureSize ] ) => {

			const velocityTexel = velocityUV.mul( textureSize );
			const phase = velocityTexel.fract().abs();
			const weight = max( phase, phase.oneMinus() );
			return weight.x.mul( weight.y ).oneMinus().div( 0.75 );

		} ).setLayout( { name: 'subpixelCorrection', type: 'float', inputs: [ { name: 'velocityUV', type: 'vec2' }, { name: 'textureSize', type: 'ivec2' } ] } );

		const historyNode = texture( this._historyRenderTarget.texture );

		// Five bilinear taps reproduce the 4x4 Catmull-Rom footprint without its corners.
		const sampleHistory = Fn( ( [ historyUV, textureSize ] ) => {

			const size = vec2( textureSize );
			const position = historyUV.mul( size );
			const centre = position.sub( 0.5 ).floor().add( 0.5 );
			const f = position.sub( centre );
			const w0 = f.mul( f.mul( f.mul( - 0.5 ).add( 1 ) ).sub( 0.5 ) );
			const w1 = f.mul( f ).mul( f.mul( 1.5 ).sub( 2.5 ) ).add( 1 );
			const w2 = f.mul( f.mul( f.mul( - 1.5 ).add( 2 ) ).add( 0.5 ) );
			const w3 = f.mul( f ).mul( f.mul( 0.5 ).sub( 0.5 ) );
			const w12 = w1.add( w2 );
			const uv0 = centre.sub( 1 ).div( size );
			const uv3 = centre.add( 2 ).div( size );
			const uv12 = centre.add( w2.div( w12 ) ).div( size );
			const top = w12.x.mul( w0.y ), left = w0.x.mul( w12.y ), middle = w12.x.mul( w12.y ), right = w3.x.mul( w12.y ), bottom = w12.x.mul( w3.y );
			const sum = historyNode.sample( vec2( uv12.x, uv0.y ) ).mul( top )
				.add( historyNode.sample( vec2( uv0.x, uv12.y ) ).mul( left ) )
				.add( historyNode.sample( uv12 ).mul( middle ) )
				.add( historyNode.sample( vec2( uv3.x, uv12.y ) ).mul( right ) )
				.add( historyNode.sample( vec2( uv12.x, uv3.y ) ).mul( bottom ) );
			// The negative lobes can undershoot around HDR highlights; history is never negative.
			return sum.div( top.add( left ).add( middle ).add( right ).add( bottom ) ).max( 0 );

		} );

		const resolve = Fn( () => {

			const uvNode = uv();
			const textureSize = this.beautyNode.size();
			const positionTexel = uvNode.mul( textureSize );

			const currentDepth = sampleCurrentDepth( this.depthNode, positionTexel, this._cameraNearFar );
			const closestDepth = currentDepth.get( 'closestDepth' );
			const closestPositionTexel = currentDepth.get( 'closestPositionTexel' );
			const farthestDepth = currentDepth.get( 'farthestDepth' );

			const offsetUV = this.velocityNode.load( closestPositionTexel ).xy.mul( vec2( 0.5, - 0.5 ) );

			const historyUV = uvNode.sub( offsetUV );
			const previousDepth = samplePreviousDepth( this._previousDepthNode, historyUV, this._previousCameraProjectionMatrixInverse, this._previousCameraWorldMatrix, this._cameraWorldMatrixInverse, this._cameraNearFar, this.camera );

			const isValidUV = historyUV.greaterThanEqual( 0 ).all().and( historyUV.lessThanEqual( 1 ).all() );
			const isEdge = farthestDepth.sub( closestDepth ).greaterThan( this.edgeDepthDiff );
			const isDisocclusion = closestDepth.sub( previousDepth ).greaterThan( this.depthThreshold );
			const hasValidHistory = isValidUV.and( isEdge.or( isDisocclusion.not() ) );

			const currentColor = this.beautyNode.sample( uvNode );
			const historyColor = sampleHistory( historyUV, textureSize );

			const motionFactor = uvNode.sub( historyUV ).mul( textureSize ).length().div( this.maxVelocityLength ).saturate();
			const currentWeight = float( 0.05 ).toVar();

			if ( this.useSubpixelCorrection ) currentWeight.addAssign( subpixelCorrection( offsetUV, textureSize ).mul( 0.25 ) );

			currentWeight.assign( hasValidHistory.select( currentWeight.add( motionFactor ).saturate(), 1 ) );

			const varianceGamma = mix( 0.5, 1, motionFactor.oneMinus().pow2() );
			const clippedHistoryColor = varianceClipping( positionTexel, currentColor, historyColor, varianceGamma );

			return flickerReduction( currentColor, clippedHistoryColor, currentWeight );

		} );

		this._resolveMaterial.contextNode = context( builder.getSharedContext() );
		this._resolveMaterial.colorNode = resolve();

		return this._textureNode;

	}

}

export const sharpTraa = ( beautyNode, depthNode, velocityNode, camera ) => new SharpTRAANode( convertToTexture( beautyNode ), depthNode, velocityNode, camera );
