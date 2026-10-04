# Fallback visitor character

The active visitor is `RocketboxVisitor.glb`. Its Microsoft MIT license, exact source hashes, conversion record and pose checks are in `Rocketbox-MIT-LICENSE.txt`, `Rocketbox-PROVENANCE.json` and `Rocketbox-POSE-QA.json`. The older CC0 asset below is retained as an optional fallback.

`Suit.glb` is the Suit character from **Ultimate Modular Men** by **Quaternius**, repackaged from the original embedded glTF into binary glTF without changing geometry or material values.

- Official asset page: https://quaternius.com/packs/ultimatemodularcharacters.html
- Official public download folder: https://drive.google.com/drive/folders/1USAAquX2JJWuA2m6zol0KUkFe3UkZ8zX
- Individual glTF folder: https://drive.google.com/drive/folders/1qpSIycVWTwhKMgyA_bEFHPh1CfBBBa09
- Model source: https://drive.google.com/file/d/1NhXHnGU0zK9hBrT5FoZp8nTz_EmvTPg5/view
- License: CC0 1.0 Universal, public-domain dedication. The original pack license is included as LICENSE.txt.
- Retrieved: 2026-10-04.

The architecture comes from the client's Blender scene. The optional Quaternius fallback provides visible body presence because the source architecture has no character rig. This fallback is a stylized visitor and is **not a photorealistic final character**. The active Rocketbox asset is a more realistic textured human.

This fallback asset contains Idle_Neutral, Walk, and Run animations. The weapon node has been detached from the scene and combat animation clips removed. Its sitting behavior uses a smoothly blended, direction-based skeletal pose and source chair anchors. The active Rocketbox visitor instead uses its compatible authored Sit motion with foot placement corrections.
