import { exp, float, Fn, ivec2, luminance, max, min, mix, outputStruct, passTexture, property, texture, uniform, uv, vec2, vec4, context, OnBeforeRenderPipeline, OnAfterRenderPipeline, convertToTexture } from 'three/tsl';
import { FloatType, HalfFloatType, RenderTarget, Vector2 } from 'three/webgpu';
import TAAUNode from 'three/addons/tsl/display/TAAUNode.js';
import { clipAABB, flickerReduction, sampleCurrentDepth, samplePreviousDepth } from 'three/addons/tsl/utils/TAAUtils.js';

const _size = /*@__PURE__*/ new Vector2();

/** Longest accumulation, in well-centred samples. About 1/27 of a pixel is new each frame. */
const MAX_ACCUMULATION = 16;

/** r186 TAAUNode (temporal upscaler: low-resolution jittered scene in, drawing-buffer
 * sized image out) with a different resolve. `setup` below is the pinned method with
 * these changes; revalidate against TAAUNode.js when three is upgraded.
 *
 * 1. Samples are accumulated by their reconstruction weight, not as one normalised
 *    blur per frame: the kernel is the r186 one measured in OUTPUT pixels, and a frame
 *    whose samples landed far from this pixel counts for less. The history therefore
 *    converges to a filter as tight as native TRAA instead of one 1/scale wider.
 * 2. The accumulated weight is kept per pixel (state attachment, green) and the blend
 *    is new/(old+new). A reset is a running mean of the frames since, sharp again in
 *    about 16 frames; r186's fixed 2.5% needs about 90.
 * 3. The variance box is weighted towards the output pixel instead of being one box
 *    per input texel, and the depth test allows 6% of the distance: without both the
 *    walking visitor was redrawn in low-resolution blocks.
 * 4. Behind a depth change the pixel keeps half a sample of clipped history instead
 *    of none, and the kernel widens while there is little history to refine.
 * 5. Reprojected history is read with the 5-tap Catmull-Rom of SharpTRAANode.
 * 6. The thin-feature lock reaches the next frame (r186's never does), applies only
 *    where nothing moves and reads its history bilinearly.
 * 7. A velocity of 3 or more is the gallery mirror's "no motion vector" marker. The
 *    reflection is kept in place and accumulated only while the camera is still;
 *    while it moves the pane shows the current frame alone, as it does under TRAA.
 * 8. The jitter is sized from the drawing buffer and the pass's resolution scale,
 *    not from the beauty target, which is still 1x1 when the first frame is set up. */
class UpscaleTAAUNode extends TAAUNode {

	static get type() { return 'UpscaleTAAUNode'; }

	constructor( beautyNode, depthNode, velocityNode, camera ) {

		super( beautyNode, depthNode, velocityNode, camera );
		this._cameraStill = uniform( 0 );

		// r186 resolves into a single attachment and copies only the colour back, so
		// its second output (the lock) never reaches the next frame. Keep both.
		this._resolveRenderTarget.dispose();
		this._resolveRenderTarget = new RenderTarget( 1, 1, { depthBuffer: false, type: HalfFloatType, count: 2 } );
		this._resolveRenderTarget.textures[ 0 ].name = 'UpscaleTAAUNode.resolve';
		this._resolveRenderTarget.textures[ 1 ].name = 'UpscaleTAAUNode.state';
		this._textureNode = passTexture( this, this._resolveRenderTarget.textures[ 0 ] );

	}

	_setJitter( renderer ) {

		const size = renderer.getDrawingBufferSize( _size ), scale = this.beautyNode.passNode.getResolutionScale();
		this.setViewOffset( Math.floor( size.width * scale ), Math.floor( size.height * scale ) );

	}

	updateBefore( frame ) {

		const previous = this._cameraWorldMatrix.value.elements, current = this.camera.matrixWorld.elements;
		let still = 1;
		for ( let i = 0; i < 16; i ++ ) if ( Math.abs( previous[ i ] - current[ i ] ) > 1e-6 ) { still = 0; break; }
		this._cameraStill.value = still;
		super.updateBefore( frame );
		frame.renderer.copyTextureToTexture( this._resolveRenderTarget.textures[ 1 ], this._historyRenderTarget.textures[ 1 ] );

	}

	setup( builder ) {

		if ( builder.renderPipeline && ! builder.context.renderPipelineState.viewOffsetOwner ) {

			builder.context.renderPipelineState.viewOffsetOwner = this;

			OnBeforeRenderPipeline( () => { this._setJitter( builder.renderer ); } );
			OnAfterRenderPipeline( () => { this.clearViewOffset(); } );

		}

		if ( builder.renderer.reversedDepthBuffer === true ) this._previousDepthRenderTarget.depthTexture.type = FloatType;

		const historyNode = texture( this._historyRenderTarget.textures[ 0 ] );
		const stateNode = texture( this._historyRenderTarget.textures[ 1 ] );

		const colorOutput = property( 'vec4' );
		const stateOutput = property( 'vec4' );
		const outputNode = outputStruct( colorOutput, stateOutput );

		// Five bilinear taps reproduce the 4x4 Catmull-Rom footprint without its corners.
		const sampleHistory = Fn( ( [ historyUV, size ] ) => {

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
			return sum.div( top.add( left ).add( middle ).add( right ).add( bottom ) ).max( 0 );

		} );

		const resolve = Fn( () => {

			const uvNode = uv();
			const inputSizeF = vec2( this.beautyNode.size() );
			const outputSizeF = vec2( historyNode.size() );

			// output pixel centre in input-pixel coordinates; input texel (m, n) was
			// rendered at (m + 0.5 + jitter)

			const pIn = uvNode.mul( inputSizeF );
			const closestTapF = pIn.sub( vec2( 0.5 ).add( this._jitterOffset ) ).round();
			const closestTap = ivec2( closestTapF );

			const currentDepth = sampleCurrentDepth( this.depthNode, closestTapF, this._cameraNearFar );
			const closestDepth = currentDepth.get( 'closestDepth' );
			const closestPositionTexel = currentDepth.get( 'closestPositionTexel' );
			const farthestDepth = currentDepth.get( 'farthestDepth' );

			const velocityTexel = this.velocityNode.load( closestPositionTexel ).toConst();
			const unreprojected = velocityTexel.x.greaterThan( 3 );
			const offsetUV = unreprojected.select( vec2( 0 ), velocityTexel.xy.mul( vec2( 0.5, - 0.5 ) ) );
			const historyUV = uvNode.sub( offsetUV ).toConst();
			const previousDepth = samplePreviousDepth( this._previousDepthNode, historyUV, this._previousCameraProjectionMatrixInverse, this._previousCameraWorldMatrix, this._cameraWorldMatrixInverse, this._cameraNearFar, this.camera );

			const isValidUV = historyUV.greaterThanEqual( 0 ).all().and( historyUV.lessThanEqual( 1 ).all() );
			const isEdge = farthestDepth.sub( closestDepth ).greaterThan( this.edgeDepthDiff );
			// r186 compares against a fixed step of perspective depth: 4 cm at 3 m, 4 m at
			// 30 m. The previous depth is reprojected for the camera only, so the walking
			// visitor (2-5 cm a frame) kept failing it in patches and those patches were
			// redrawn from the low-resolution frame. Allow 6% of the distance instead,
			// never less than r186 does.
			const depthThreshold = max( float( this.depthThreshold ), closestDepth.oneMinus().mul( 0.06 ) ).toConst();
			const isDisocclusion = closestDepth.sub( previousDepth ).greaterThan( depthThreshold );
			const hasHistory = isValidUV.and( unreprojected.not().or( this._cameraStill.greaterThan( 0.5 ) ) );
			const isTrusted = isEdge.or( isDisocclusion.not() );

			// the 3x3 input neighbourhood

			const offsets = [
				[ - 1, - 1 ], [ 0, - 1 ], [ 1, - 1 ],
				[ - 1, 0 ], [ 0, 0 ], [ 1, 0 ],
				[ - 1, 1 ], [ 0, 1 ], [ 1, 1 ]
			];

			const taps = offsets.map( ( [ x, y ] ) => this.beautyNode.load( closestTap.add( ivec2( x, y ) ) ).max( 0 ).toConst() );

			// squared distance from this output pixel to each sample, in input pixels

			const distances = offsets.map( ( [ x, y ] ) => {

				const delta = pIn.sub( vec2( closestTap.add( ivec2( x, y ) ) ).add( vec2( 0.5 ).add( this._jitterOffset ) ) );
				return delta.dot( delta ).toConst();

			} );

			// The variance box is weighted towards this output pixel. Unweighted (r186) it
			// is one box per input texel, and every hard clip prints the low-resolution
			// grid into the image: a blocky visitor whenever he walks. It is also a little
			// wider than r186's (0.5-1 sigma): input samples under-report the range of the
			// full-resolution detail the history holds.

			const moment1 = vec4( 0 ).toVar();
			const moment2 = vec4( 0 ).toVar();
			const momentWeight = float( 0 ).toVar();

			taps.forEach( ( c, i ) => {

				const w = exp( distances[ i ].mul( - 0.7 ) );
				moment1.addAssign( c.mul( w ) );
				moment2.addAssign( c.pow2().mul( w ) );
				momentWeight.addAssign( w );

			} );

			const mean = moment1.div( momentWeight ).toConst();
			const motionFactor = uvNode.sub( historyUV ).mul( inputSizeF ).length().div( this.maxVelocityLength ).saturate();
			const varianceGamma = mix( 0.75, 1.25, motionFactor.oneMinus().pow2() );
			const variance = moment2.div( momentWeight ).sub( mean.pow2() ).max( 0 ).sqrt().mul( varianceGamma ).toConst();
			const minColor = mean.sub( variance );
			const maxColor = mean.add( variance );

			const historyColor = sampleHistory( historyUV, outputSizeF ).toConst();
			const state = stateNode.sample( historyUV ).toConst();
			const clippedHistoryColor = clipAABB( mean.clamp( minColor, maxColor ), historyColor, minColor, maxColor );

			// r186 thin-feature lock: a sample that stands out from its neighbourhood keeps
			// its unclipped history for a few frames, so a wire survives the frames whose
			// samples miss it. Only where nothing moves (unclipped history on a moving
			// edge is a trail of specks behind the visitor), and read bilinearly:
			// Catmull-Rom history that is never clipped rings on fine repeating detail.

			const meanLuma = luminance( mean.rgb ).toConst();
			const thinFeature = luminance( taps[ 4 ].rgb ).sub( meanLuma ).abs().div( meanLuma.max( 1e-4 ) ).smoothstep( 0, 0.2 );
			const isDepthChanged = closestDepth.sub( previousDepth ).abs().greaterThan( depthThreshold );
			const canLock = isValidUV.and( isDepthChanged.not() ).and( unreprojected.not() ).and( offsetUV.mul( outputSizeF ).length().lessThan( 0.25 ) );
			const decay = isDisocclusion.select( 0, 0.5 );
			const lock = max( canLock.select( thinFeature, float( 0 ) ), state.r.mul( decay ) ).saturate().toConst();
			const lockedHistoryColor = mix( clippedHistoryColor, historyNode.sample( historyUV ).max( 0 ), lock ).toConst();

			// How much history this pixel may keep. Behind a depth change (r186 drops the
			// history there) it keeps half a sample: what variance clipping lets through
			// still carries full-resolution detail, and the pixel is rebuilt in a few frames.

			const accumulated = hasHistory.select( isTrusted.select( state.g, state.g.min( 0.5 ) ), 0 ).toConst();

			// Reconstruction kernel: r186's Blackman-Harris approximation. With history
			// to refine it is measured in output pixels (tight: this frame adds only the
			// samples that fell near this pixel); with little or none it widens to input
			// pixels, a smooth upscale of the frame instead of blocks.

			const tight = outputSizeF.x.div( inputSizeF.x ).pow2().toConst();
			const falloff = mix( 1, tight, accumulated.mul( 0.5 ).saturate() ).mul( 2.29 ).toConst();

			const sumColor = vec4( 0 ).toVar();
			const sumWeight = float( 0 ).toVar();

			taps.forEach( ( c, i ) => {

				const w = exp( distances[ i ].mul( falloff ).negate() );
				sumColor.addAssign( c.mul( w ) );
				sumWeight.addAssign( w );

			} );

			const currentColor = sumColor.div( sumWeight.max( 1e-5 ) ).toConst();
			const confidence = sumWeight.min( 1 ).toConst();
			const currentWeight = confidence.div( accumulated.add( confidence ) ).add( motionFactor ).saturate();

			colorOutput.assign( flickerReduction( currentColor, lockedHistoryColor, currentWeight ) );
			stateOutput.assign( vec4( lock, accumulated.add( confidence ).min( MAX_ACCUMULATION ), 0, 1 ) );

			return vec4( 0 ); // as r186: the struct above is the output

		} );

		const sharedContext = context( builder.getSharedContext() );

		this._resolveMaterial.contextNode = sharedContext;
		this._resolveMaterial.colorNode = resolve();
		this._resolveMaterial.outputNode = outputNode;

		this._seedMaterial.colorNode = Fn( () => {

			colorOutput.assign( this.beautyNode.sample( uv() ) );
			stateOutput.assign( 0 );

			return vec4( 0 );

		} )();

		this._seedMaterial.contextNode = sharedContext;
		this._seedMaterial.outputNode = outputNode;

		return this._textureNode;

	}

}

export const upscaleTaau = ( beautyNode, depthNode, velocityNode, camera ) => new UpscaleTAAUNode( convertToTexture( beautyNode ), depthNode, velocityNode, camera );

/** FSR1's RCAS (contrast-limited 5-tap sharpen) on a scene-linear texture, run in the
 * reversible c/(1+max(c)) range so highlights cannot ring. `amount` 0..1 scales the
 * lobe. It is read after the temporal history is written, so sharpening never feeds
 * back into the history. Returns the sharpened colour. */
export const rcas = ( textureNode, amount ) => Fn( () => {

	const texel = vec2( 1 ).div( vec2( textureNode.size() ) ).toConst();
	const tap = ( x, y ) => { const c = textureNode.sample( uv().add( vec2( x, y ).mul( texel ) ) ).rgb.max( 0 ); return c.div( max( c.r, c.g, c.b ).add( 1 ) ).toConst(); };

	const e = tap( 0, 0 ), b = tap( 0, - 1 ), d = tap( - 1, 0 ), f = tap( 1, 0 ), h = tap( 0, 1 );

	const mn4 = min( min( b, d ), min( f, h ) ).toConst();
	const mx4 = max( max( b, d ), max( f, h ) ).toConst();
	const hitMin = min( mn4, e ).div( mx4.mul( 4 ).max( 1e-5 ) );
	const hitMax = max( mx4, e ).oneMinus().div( mn4.mul( 4 ).sub( 4 ) );
	const lobeRGB = max( hitMin.negate(), hitMax ).toConst();
	const lobe = max( float( - 0.1875 ), min( max( lobeRGB.r, lobeRGB.g, lobeRGB.b ), float( 0 ) ) ).mul( amount ).toConst();
	const sharp = b.add( d ).add( f ).add( h ).mul( lobe ).add( e ).div( lobe.mul( 4 ).add( 1 ) ).max( 0 ).toConst();

	return sharp.div( max( sharp.r, sharp.g, sharp.b ).oneMinus().max( 1e-4 ) );

} )();
