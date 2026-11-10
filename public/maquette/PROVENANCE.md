# Living Maquette arrival

Assets supplied in Living_Maquette_Fable_Production_Kit.zip. Visual direction cross-checked against Living_Maquette_Build_Asset_Atlas.pdf. Only the lightweight model, environment, ready poster, three optional studies and two fonts are published. Font terms are in FONT_LICENSE.txt.

The arrival is scoped in src/components/maquette. It preserves explicit 3D opt-in, Android-phone direct Studio routing, actual loader phases, retry and guided-tour entry. The light route does not mount Three.js or the lounge runtime. The decorative model is loaded after 3D opt-in and never gates readiness.

The supplied model is a lightweight reconstruction, not a pixel-identical reproduction of the kit's beauty artwork. Compatible material/assembly groups are batched without reducing geometry. Rendering is demand-driven, capped at 30 updates/s and DPR 1.25, paused when hidden, and disposed on entry. Reduced motion remains available.

Validated: production build, entry/retry lifecycle tests, desktop and 390px responsive layouts, direct Studio navigation, and loading-to-ready-to-lounge handoff. Local preview uses identity model delivery to avoid browser-bridge encoding mismatches; production compression is unchanged.
