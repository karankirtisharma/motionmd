# Desert sky context

`qwantani-sunset-2k.hdr` is the 2048×1024 HDR version of **Qwantani Sunset (Pure Sky)** by **Greg Zaal** (photography) and **Jarod Guest** (processing), from Poly Haven.

- Original asset: https://polyhaven.com/a/qwantani_sunset_puresky
- Asset license: CC0 1.0 Universal, public-domain dedication.
- Publisher license statement: https://polyhaven.com/license
- License text: https://creativecommons.org/publicdomain/zero/1.0/legalcode
- Local file: 4,171,959 bytes.
- MD5: `b918af5fefb341535961ffdad5fab7bc`.
- Retrieved and verified: 2026-10-04.

The HDR is used as a static background, with azimuth aligned to the architectural sun. The original scene's light and reflection captures remain separate. The source HDR's sun is approximately 6.15° above its horizon; matching background azimuth does not change the authored architectural sun elevation.

The distant dune geometry is generated locally as optional environment context, outside the original presentation-ground boundary. The client's architectural geometry is retained. Only the identified `Neutral architectural ground` material is given a sand appearance; floors, slabs and other building materials are excluded. Dunes have no collision and no shadow casting. The source presentation ground and physical exploration perimeter keep the player on the supported near environment.

Sand surface detail is a deterministic, locally generated 512×512 packed data texture (color variation, roughness and ripple height). The original ground and distant terrain share this texture through world-space projections at two scales. It uses mipmaps, modest anisotropy and a distance fade for bump detail; no animated noise, external texture dependency or architectural image generation is used. A 25 cm strip of the terrain ring overlaps beneath the existing ground surface by up to 18 mm to close the bevel/raster seam without coplanar surfaces.
