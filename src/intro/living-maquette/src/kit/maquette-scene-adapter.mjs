/**
 * Applies authored decorative poses to the supplied ready-pose exports.
 * The manifest uses Blender Z-up. Add converted position deltas to the
 * captured imported local rest positions. Keep the supplied local node bases
 * and put overall placement/rotation on an outer model root.
 */

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const destinations = new Set(['lounge', 'motion-floor']);
const loungeGroups = ['chair', 'table', 'ribbon', 'tree_lower'];

function vector3(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${name} must be an array of three finite numbers`);
  }
  return value;
}

export function blenderDeltaToGltf(delta) {
  const [x, y, z] = vector3(delta, 'delta');
  return [x || 0, z || 0, -y || 0];
}

function stableId(node) {
  return node?.userData?.maquette_id ?? node?.extras?.maquette_id;
}

function rootIndex(root, getNode) {
  const byId = new Map();
  const byName = new Map();
  const duplicateIds = new Set();
  const duplicateNames = new Set();
  function add(index, duplicates, key, node) {
    if (typeof key !== 'string' || !key) return;
    if (index.has(key) && index.get(key) !== node) duplicates.add(key);
    else index.set(key, node);
  }
  root?.traverse?.((node) => {
    add(byId, duplicateIds, stableId(node), node);
    add(byName, duplicateNames, node?.name, node);
  });
  return {
    find(id) {
      if (duplicateIds.has(id)) return null;
      if (byId.has(id)) return byId.get(id);
      if (duplicateNames.has(id)) return null;
      const node = getNode?.(id) ?? byName.get(id) ?? root?.getObjectByName?.(id) ?? root?.getNodeByName?.(id);
      return stableId(node) && stableId(node) !== id ? null : node ?? null;
    },
    duplicateIds,
    duplicateNames,
  };
}

function restPosition(node) {
  const p = node?.position;
  if (typeof p?.set !== 'function' || ![p.x, p.y, p.z].every(Number.isFinite)) return null;
  return [p.x, p.y, p.z];
}

function setPosition(node, values) {
  node.position.set(...values);
  node.updateMatrix?.();
}

function captureVisibility(node) {
  return { had: own(node, 'visible'), value: node.visible };
}

function restoreVisibility(node, original) {
  if (original.had) node.visible = original.value;
  else delete node.visible;
}

function containsGeometry(node) {
  const metadata = node.userData ?? node.extras;
  if (metadata?.maquette_anchor || metadata?.maquette_batch_id) return false;
  if (node.isMesh || node.geometry) return true;
  if (!node.isObject3D && typeof node.isMesh !== 'boolean') return true;
  let found = false;
  node.traverse?.((child) => { if (child.isMesh || child.geometry) found = true; });
  return found;
}

function captureBranch(root, names, batches, manifest, getNode) {
  const index = rootIndex(root, getNode);
  const entries = [];
  const missingNames = [];
  const invalidNodeNames = [];
  const invalidManifestNames = [];

  function capture(id, memberIds, ready, exploded, optional = false) {
    const node = index.find(id);
    if (!node) {
      if (!optional) missingNames.push(id);
      return;
    }
    const rest = restPosition(node);
    if (!rest) { invalidNodeNames.push(id); return; }
    let delta;
    try {
      vector3(ready, `${id}.ready`);
      vector3(exploded, `${id}.exploded`);
      delta = blenderDeltaToGltf(exploded.map((value, i) => value - ready[i]));
    } catch {
      invalidManifestNames.push(id);
      return;
    }
    entries.push({ id, memberIds, node, rest, delta, visibility: captureVisibility(node), drawable: containsGeometry(node) });
  }

  for (const id of names) {
    const ready = manifest.ready_positions[id];
    const exploded = manifest.exploded_positions[id];
    if (ready === undefined && exploded === undefined) {
      // Legacy workspace manifests can list static nodes without pose data.
      capture(id, [id], [0, 0, 0], [0, 0, 0]);
    } else capture(id, [id], ready, exploded);
  }
  for (const [id, batch] of Object.entries(batches ?? {})) {
    if (!Array.isArray(batch.member_ids) || !batch.member_ids.length) {
      if (index.find(id)) invalidManifestNames.push(id);
      continue;
    }
    capture(id, batch.member_ids, batch.ready_position, batch.exploded_position, true);
  }
  return { entries, missingNames, invalidNodeNames, invalidManifestNames, index };
}

function matchesHidden(entry, ids) {
  return ids.has(entry.id) || entry.memberIds.every((id) => ids.has(id));
}

export function createMaquetteSceneAdapter({ root, manifest, workspaceRoot = null, getNode } = {}) {
  if (!manifest || typeof manifest !== 'object' || !manifest.ready_positions || !manifest.exploded_positions) {
    throw new TypeError('manifest must contain ready_positions and exploded_positions');
  }
  if (getNode !== undefined && typeof getNode !== 'function') throw new TypeError('getNode must be a function');
  if (!root?.traverse && !getNode && !root?.getObjectByName && !root?.getNodeByName) {
    throw new TypeError('Provide root.traverse, a compatible root name lookup, or getNode(name)');
  }

  const workspaceNames = Array.from(new Set(manifest.workspace_objects ?? []));
  const workspaceIdSet = new Set(workspaceNames);
  const mainNames = Object.keys(manifest.ready_positions).filter((id) => !workspaceIdSet.has(id));
  const main = captureBranch(root, mainNames, manifest.runtime_batches?.main, manifest, getNode);
  const destinationHiddenIds = Object.fromEntries([...destinations].map((destination) => {
    const groups = manifest.destination_hide_groups?.[destination] ?? (destination === 'motion-floor' ? loungeGroups : []);
    return [destination, new Set(groups.flatMap((key) => manifest.detail_groups?.[key] ?? []))];
  }));
  const phases = manifest.phase_visibility ?? { ready: { hidden_ids: [] } };
  let phase = null;
  let phaseHidden = new Set();
  let explodedAmount = 0;
  let requestedDestinationVisual = null;
  let destinationVisual = null;

  function captureWorkspace(nextRoot) {
    if (!nextRoot) return null;
    const branch = captureBranch(nextRoot, workspaceNames, manifest.runtime_batches?.workspace, manifest);
    const represented = new Set(branch.entries.filter((entry) => entry.drawable).flatMap((entry) => entry.memberIds));
    const missingGeometryNames = workspaceNames.filter((id) => !represented.has(id));
    return { root: nextRoot, branch, missingGeometryNames, visibility: captureVisibility(nextRoot) };
  }

  let workspace = captureWorkspace(workspaceRoot);

  function workspaceReason() {
    if (!workspace) return 'workspace-not-attached';
    if (!workspaceNames.length) return 'workspace-manifest-missing';
    if (workspace.branch.missingNames.length) return 'workspace-incomplete';
    if (workspace.missingGeometryNames.length) return 'workspace-geometry-incomplete';
    return null;
  }

  function state() {
    const reason = workspaceReason();
    return Object.freeze({
      explodedAmount,
      phase,
      requestedDestinationVisual,
      destinationVisual,
      workspaceAvailable: reason === null,
      workspaceReason: reason,
      matchedAssemblyNodes: main.entries.length,
      expectedWorkspaceNodes: workspaceNames.length,
      matchedWorkspaceNodes: workspace ? workspaceNames.length - workspace.branch.missingNames.length : 0,
    });
  }

  function applyPose(entries) {
    for (const { node, rest, delta } of entries) {
      if (delta.every((value) => value === 0)) continue;
      setPosition(node, rest.map((value, i) => value + delta[i] * explodedAmount));
    }
  }

  function applyVisibility() {
    for (const entry of main.entries) {
      const hidden = matchesHidden(entry, phaseHidden) ||
        (destinationVisual !== null && matchesHidden(entry, destinationHiddenIds[destinationVisual]));
      if (hidden) entry.node.visible = false;
      else restoreVisibility(entry.node, entry.visibility);
    }
    if (workspace) {
      workspace.root.visible = destinationVisual === 'motion-floor';
      for (const entry of workspace.branch.entries) {
        if (matchesHidden(entry, phaseHidden)) entry.node.visible = false;
        else restoreVisibility(entry.node, entry.visibility);
      }
    }
  }

  function reconcileDestination() {
    if (requestedDestinationVisual === 'motion-floor' && workspaceReason() !== null) {
      if (destinationVisual === 'motion-floor') destinationVisual = 'lounge';
    } else destinationVisual = requestedDestinationVisual;
    applyVisibility();
  }

  function restoreEntries(entries) {
    for (const entry of entries) {
      setPosition(entry.node, entry.rest);
      restoreVisibility(entry.node, entry.visibility);
    }
  }

  return Object.freeze({
    setExplodedAmount(amount) {
      if (!Number.isFinite(amount)) throw new TypeError('Exploded amount must be a finite number');
      explodedAmount = Math.min(1, Math.max(0, amount));
      applyPose(main.entries);
      if (workspace) applyPose(workspace.branch.entries);
      return state();
    },
    setPhaseVisibility(nextPhase) {
      if (nextPhase !== null && !own(phases, nextPhase)) throw new RangeError(`Unsupported visual phase: ${nextPhase}`);
      const hidden = nextPhase === null ? [] : phases[nextPhase]?.hidden_ids;
      if (!Array.isArray(hidden) || hidden.some((id) => typeof id !== 'string')) {
        throw new TypeError(`Visual phase ${nextPhase} must have a hidden_ids array`);
      }
      phase = nextPhase;
      phaseHidden = new Set(hidden);
      applyVisibility();
      return state();
    },
    setDestinationVisual(destination) {
      if (!destinations.has(destination)) throw new RangeError(`Unsupported destination visual: ${destination}`);
      requestedDestinationVisual = destination;
      reconcileDestination();
      const reason = destination === 'motion-floor' ? workspaceReason() : null;
      return Object.freeze({ ...state(), requestedDestination: destination, applied: reason === null, reason });
    },
    attachWorkspaceRoot(nextRoot) {
      if (nextRoot === workspace?.root) return state();
      const next = captureWorkspace(nextRoot);
      if (workspace) {
        restoreEntries(workspace.branch.entries);
        restoreVisibility(workspace.root, workspace.visibility);
      }
      workspace = next;
      if (workspace) applyPose(workspace.branch.entries);
      reconcileDestination();
      return state();
    },
    getState: state,
    getDiagnostics() {
      return Object.freeze({
        missingSceneNames: Object.freeze([...main.missingNames]),
        invalidNodeNames: Object.freeze([...main.invalidNodeNames, ...(workspace?.branch.invalidNodeNames ?? [])]),
        invalidManifestNames: Object.freeze([...main.invalidManifestNames, ...(workspace?.branch.invalidManifestNames ?? [])]),
        duplicateNodeNames: Object.freeze([...main.index.duplicateNames]),
        duplicateStableIds: Object.freeze([...main.index.duplicateIds, ...(workspace?.branch.index.duplicateIds ?? [])]),
        missingWorkspaceNames: Object.freeze([...(workspace?.branch.missingNames ?? workspaceNames)]),
        missingWorkspaceGeometry: Object.freeze([...(workspace?.missingGeometryNames ?? workspaceNames)]),
        coordinateRule: 'Captured imported rest + amount * glTF(exploded Blender position - ready Blender position)',
        readinessRule: 'Visual availability and decorative pose are separate from host entry readiness.',
      });
    },
    restore() {
      restoreEntries(main.entries);
      if (workspace) {
        restoreEntries(workspace.branch.entries);
        restoreVisibility(workspace.root, workspace.visibility);
      }
      explodedAmount = 0;
      phase = null;
      phaseHidden = new Set();
      requestedDestinationVisual = null;
      destinationVisual = null;
      return state();
    },
  });
}
