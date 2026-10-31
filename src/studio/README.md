# Screen1 studio port

Copied from `D:\Claude\Ideation and Prototype\MotionMD Screen1\web` on 2026-10-31. The source project was not edited.

- Route: `/studio`; embedded route: `/studio?embed=lounge`.
- Source component, store, data and animation structure retained. Imports and media paths are namespaced under `studio`.
- Source custom CSS and its existing Tailwind 4.3.3 preflight/utilities are scoped to `#md-studio-root`; dialog/drawer portals stay inside that boundary. This avoids adding Tailwind to the lounge build. Keyframe names are namespaced.
- Instrument Serif and Manrope are the exact cached WOFF2 assets from the source build, with original fallback metrics. They load only through the studio layout. Upstream OFL notices are beside the font files.
- Only referenced media is copied. Raw PNG backups are excluded; the optional `?ref=50`/`?ref=diff` screenshot is retained at `/studio/media/reference/K01.jpg`.
- The All 50 focus ring clips overflow to its existing rounded corners.

The embedded bridge validates same-origin parent messages. `md-studio:suspend` stops the simulated player clock, pauses media and CSS animation; `md-studio:resume` restores browsing without autoplay. Top-level Escape and the back button send `md-studio:exit`. Inner dialogs and film views consume Escape first.

Source prototype limitations are deliberately unchanged: film playback uses posters and a simulated clock, briefs use `mailto:`, AURELLE is the only project with dedicated case frames, and the language control changes its label rather than translating content. These need real content/services before describing the studio as a full video portfolio.
