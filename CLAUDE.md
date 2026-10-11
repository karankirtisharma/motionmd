@AGENTS.md

Read `README.md`, `qa/architecture-v15/README.md`, `qa/experience-v12/README.md`, and `qa/experience-v11/README.md` before editing. The approved D: architecture-v13 model plus the v15 full-width entrance slab and matching clear-glass correction supersedes the rejected C: client-revision-v13 remodel. In the D: handoff, also read `../../PROJECT-HANDOFF.md` and `../../CONTINUE-WORK-MASTER-PROMPT.md`.

Preserve the user's exact Blender architecture and source materials. Work on derivatives. The current renderer is direct Three.js in Next.js, with WebGPU and WebGL fallback; do not rebuild it in Unreal, streamed video or React Three Fiber without a new requirement. No commit, push, deployment, reset or deletion of historical work without explicit user authorization for that action. Run `npm test`, asset verification and the production build, then inspect real rendered motion for changes to the scene or controller. Test success is not complete visual acceptance.
