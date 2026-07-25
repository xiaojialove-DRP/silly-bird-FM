# Decisions

Why things are the way they are — for future-me, not a changelog of what shipped.
See `git log` for that. This is the reasoning that doesn't survive in the code itself.

## Visual: Andersen's papercutting, and nothing else

The only visual reference, ever — full stop, no other product's look informed this
one. Public-facing copy should never namecheck other products as inspiration, and
neither should this file — the goal is a thing that looks unmistakably itself, not a
tribute act. White paper silhouettes on a colored mount, scalloped edges, punched
holes, dashed stitching, Song-typeface Chinese. Every new feature's visuals get
built inside this system, not next to it (see: the stamp going from a plain
rectangular button to an actual postmark, because a rectangle didn't honor the
reference — that's the standard).

## Form factor: web first, link-shaped sharing

Sharing has to feel like sending a voice message: open a link, hit play, done — no
install, no signup. That ruled out a native-app-first approach early on. The Tauri
desktop shell is a thin wrapper that loads the *deployed* site remotely
(`tauri.conf.json`'s `windows[].url` points at the live GitHub Pages URL) rather
than bundling local web assets. A web update ships to the desktop app automatically
with no separate desktop release — desktop is a lens onto the same product, not a
second product.

## Content: sound and voice first, music is optional

The bar for participating is "can you send a voice message," not "can you make
music." This sidesteps the copyright questions a music-sharing app would run into
immediately, and it's a better fit for what the product actually wants: hearing a
friend's real, unpolished voice, not a curated audio experience. The three built-in
demo channels are all synthesized from code for the same reason — zero borrowed
audio, anywhere, ever.

## No accounts

Every visitor to the deployed site shares the same Supabase project config,
embedded in the shipped JS. Creating a station, sharing it, and listening to one
all require zero signup. This is a deliberate, load-bearing constraint, not an
oversight — see the Security section below for how the "everyone shares one key"
model got fixed without introducing a login screen.

## Station size: 7 tracks

Started at 11, cut to 7. A handful of carefully-chosen tracks fits the product
better than an unlimited archive — "picking three tracks with care is already a
lot to ask of someone" was the reasoning. Curation over accumulation, on purpose,
even though nothing technical forces this number.

## Revoke, not self-destruct

Considered and rejected a "listen once, then it's gone" auto-destruct model.
Instead: links persist until the owner explicitly revokes them. Control stays with
whoever shared it, on their own timeline — not a countdown neither side controls,
and not something that vanishes without anyone choosing that.

## Listen stamps: a postcard, not a like button

- Only appears after hearing *every* track on a friend's station this session —
  not one track. Rarity is the point.
- Never auto-reported. The button only exists to be clicked; nothing about
  listening itself is ever sent anywhere.
- No counts, anywhere, ever. The owner sees a growing collection, not a number.
- Each stamp is tinted in whatever theme color *the listener* had selected, not
  the owner's — the identifying detail is "someone with taste for green stamped
  this," never a name.
- Icon-only design — a real postmark doesn't carry marketing copy. The affordance
  is the object appearing at all, not a label explaining itself.

## i18n: translate the app, never a person's words

The one-click EN/中 toggle translates app-authored copy only — static labels, the
three demo channels, status messages. It never touches a real station's name,
intro, or track titles, and never touches a guest's shared content, because that's
someone's own words, not ours to translate. English became the *default* for
first-time visitors (flipped from Chinese-default) once sharing to non-Chinese-
speaking friends via Instagram became a real, stated use case — a friend's own
station content stays exactly as they typed it regardless of which side of the
toggle a visitor lands on.

## License: all rights reserved, not open source

Explicit choice after weighing it directly: the idea has real potential and the
owner doesn't want it casually copied. This is the most restrictive of the options
discussed, chosen on purpose. Default assumption going forward: this project does
not take outside contributions or forks unless that changes explicitly.

## Security: anonymous auth + owner-scoped RLS, not a backend proxy

The original model (one public anon key, RLS open to everyone for every write) let
any visitor overwrite or delete any other station. Fixed with Supabase's built-in
anonymous sign-in (each browser gets a real but anonymous identity, silently, no
UI) plus RLS scoped to `owner = auth.uid()` for update/delete — reads stay
unauthenticated and public, since listening must never require an identity. This
was chosen over standing up a backend proxy specifically to avoid taking on new
infrastructure to operate for a friend-circle project; it uses a primitive
Supabase already provides rather than building one. Verified end-to-end against
the real project, not simulated, before considering it done.

Known accepted cost: any station shared *before* this cutover has no owner on
record and can never be updated or revoked again by its creator (though it stays
listenable — reads were never restricted). At the point this shipped, real shared
stations were few enough that this was worth accepting rather than engineering a
migration path.

## Desktop packaging: built ahead of demand, then deliberately paused

Transparent background and the papercut window skin exist. Tray icon, global
shortcut, autostart, and a download button on the site do not, by explicit
decision: desktop is meant to serve the *creator's* day-to-day companion use case,
and investing further only makes sense once real friend feedback shows people
actually want it, rather than because it's a fun thing to build next.

Known, accepted platform constraint: `decorations:false` breaks native window
positioning entirely on this Tauri/tao/macOS combination — proven by a pure
Rust-side `window.set_position()` call returning success with zero visual effect.
The macOS traffic-light buttons stay visible as a result; not worth re-attempting
without a clear signal that Tauri itself has changed something upstream.

## Testing and observability: manual and human-verified, until it wasn't enough

Every feature in this project was verified by hand in a real browser, repeatedly,
for its entire life up to this point — no automated tests, no error reporting.
That was a reasonable tradeoff at hobby-project scale with an AI collaborator
doing the manual verification every session. It stopped being enough once real
friends were using it regularly: a silent failure in someone else's browser is
invisible to both the owner and to whoever's helping build it. A thin Playwright
smoke test (create → share → listen → revoke) and a minimal, privacy-respecting
error log (writes an anonymous, no-identity JSON blob to the same Supabase bucket
on unexpected failures) were added for exactly that gap — not full analytics,
which the project's privacy stance rules out.

Those tests then had to run without being asked. Twice in a single day a change
looked perfect in a browser and was in fact broken: a stray brace left the script
dead while the static markup still rendered, and the phone layout silently fell
back to the desktop cascade so the stacking never engaged. Both were caught only
because the suite happened to get run. CI splits this in two on purpose: a smoke
job that parses every module and boots the app with no network at all, so it
fails in seconds and can never be mistaken for a flaky backend, and a journey job
behind it that exercises the real sharing path against the real backend. Anonymous
sign-ins are rate limited per project, so those run one at a time.

A share reporting success is also not proof a friend can hear anything, so
sharing reads its own link back over the public URL afterwards and says so when
what comes back is not what was sent. That check exists because edits went
unpublished for days while the app reported success every time.
