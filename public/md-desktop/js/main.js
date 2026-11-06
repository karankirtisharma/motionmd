import { createDesktop } from './desktop.js';
import { icons } from './ui.js';
import { afterEffects } from './apps/ae.js';
import { blender } from './apps/blender.js';
import { comfy } from './apps/comfy.js';

if (new URLSearchParams(location.search).has('motion')) document.documentElement.classList.add('motion');

const desktop = createDesktop([afterEffects, blender, comfy]);
icons();

// ?open=ae|bl|cf opens an app straight away (handy when embedding a screen in the 3D scene)
const open = new URLSearchParams(location.search).get('open');
if (open) setTimeout(() => desktop.launch(open), 300);
