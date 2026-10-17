# MD Lounge — clean current website

This folder is a standalone copy of the current website, including the local v21 gallery opening/mirror changes and the v20 material fixes. It is newer than GitHub commit 8957f67949efd91766756fb11f851d28ad3b0c18; no push was performed while making this copy.

## Run

Use Node.js 24. From this directory:

```powershell
npm ci
npm run dev -- --port 3001
```

For production: `npm test`, `npm run build`, then `npm start -- --port 3001`. Stop any other server on the selected port first. Deploy with Next.js and this directory as the project root. Keep the included Git LFS rules if uploading to GitHub.

## What is included

Application code, package lock, deployment configuration, current regression tests, asset licenses, and every manifest/runtime/GLB dependency of the current scene. Versioned asset folder names are intentional: the scene still uses specific files from several releases. Do not remove an entire old-looking folder without tracing its references. COPY-INVENTORY.json records each copied file and its verified SHA-256. Two small older collision fixtures are retained because tests use them.

## What is excluded

Git history and LFS cache, node_modules, Next build caches, logs, temporary exports, unused scene assets, historical screenshots/reports, backup versions, and Blender working files. The original project is untouched. This is the website delivery copy, not a Blender-authoring archive.

## Interactive founder desk (v22)

Approach the executive chair and click it or press E to work at the desk; trigger it again to stand. The chair stays in its preset position. The original rig and animation clips use controlled positioning plus hand/foot IK. The full-width chair retains its upholstery proportions, with its pedestal adjusted to fit the 1.86 m visitor. The rug lighting has been rebaked to remove the old chair footprint, and the relocated upholstery has its own clean indirect-light bake. Lateral entry/exit use continuous controlled movement and planted-foot IK without moving the chair. See `qa/chair-sitting-ledger.md` for measurements, source backup, validation and bake reproduction details. The supplied local `MD_Presentation_Lounge_v21.blend` is unchanged.

## Gallery / founder-room mirror

Both accessible sides now have live mirror faces. The founder-room side previously exposed the dark bronze backing; the runtime now reuses the exported silver face and thin bronze surround on that side. The structural wall and collision remain solid. Both sides were visually checked in the local WebGPU scene at High quality; debug cameras `V21 mirror detail` and `V22 mirror founder side` reproduce those views. All 59 tests, type checking and the production build pass. See `qa/architecture-v21/README.md` for current and historical verification.

Existing v20 indirect-light bakes and local reflection probes are retained; a removal-specific indirect-light rebake has not been performed. The original Blender source is at C:/Users/karan_z7alww2/Documents/Codex/2026-10-04/i-have-a-detailed-blender-blend/outputs/architecture-v21/MD_Presentation_Lounge_v21.blend. Historical diagnostic artifacts remain in the original workspace.
