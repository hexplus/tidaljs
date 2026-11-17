# TidalJS

**Live coding music in your browser**

A JavaScript implementation of [TidalCycles](https://tidalcycles.org/) for web browsers. It brings algorithmic pattern composition and live coding to the web platform, using the Web Audio API for sound.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Roadmap](https://img.shields.io/badge/Roadmap-complete-brightgreen.svg)](#development-status)
[![Live Demo](https://img.shields.io/badge/Live-Demo-blue.svg)](#demo)

## Demo

- **[Live TidalJS Editor](https://hexplus.github.io/tidaljs/)**. The layout works on phones and tablets, but the editor is designed for a keyboard, and mobile browsers are not fully tested yet.

## How it works

As in Tidal, a pattern is a function of cyclic time. Time is measured in **cycles**, and the tempo is set in cycles per second (`setCPS`). A pattern can be asked for the events that start inside any span of time. A look-ahead scheduler asks the playing patterns for the next few milliseconds of events and schedules them on the audio clock, so timing does not depend on the UI thread.

Patterns are immutable: every method returns a new pattern, so `superimpose(x => x.fast(2))` never changes the original.

## Features

- **Samples**: load recorded sample banks, such as the [Dirt-Samples](https://github.com/tidalcycles/Dirt-Samples) library, with `samples()`, including pitched banks (one recording every few notes, such as a piano) that `note()` plays in tune; `speed`, `begin`/`end`, `chop`, `striate`, `slice`, `splice`, `loopAt`, `randslice`, `loop` and `legato` work on the recordings
- **Mini-notation**: subdivisions, alternation, polymeter, euclidean rhythms, probability, repeats, random choice, ranges (`"0 .. 7"`), chords, and patterned modifiers (`"bd*<2 3>"`, `"bd(<3 5>,8)"`)
- **Time transformations**: `fast`, `slow`, `rev`, `every`, `whenmod`, `chunk`, `ply`, `iter`, `linger`, `rot`, `off`, `scramble`, `shuffle`, `swing`, `compress`, `palindrome`..., with patterned arguments such as `fast("<1 2>")`; `rhythm` plays the steps one after another with patterned (or random) lengths, never looping
- **Composition**: `stack`, `cat`, `timeCat`, `wrandcat`, `superimpose`, `jux`, `euclid`, `euclidFull`, `nTake`, `sew`, `stitch`, `wedge`, `mask`, `select`, `squeeze`, `spread`, `pickF`, `fix`...
- **Tidal's operators**: every control is also a function (`n("0 2")`, `speed(2)`), combined with `.set()` (`#`), `.keep()` (`|<`), `.add()` (`|+`), `.sub()`, `.mul()`, `.div()`, `.mod()`, `.pow()`, each also with the rhythm from the right (`.addRight()`, `+|`), from both sides (`.addBoth()`, `|+|`) or squeezed (`.addSqueeze()`, `||+`); `once`, `qtrigger`
- **Streams and transitions**: `d1` to `d16` and `p("name", ...)` streams, with mute and solo buttons in the editor (and `mute`/`solo` in code); transitions between versions of a stream: `xfadeIn`, `jumpIn`, `jumpInNext`, `jumpMod`, `clutchIn`, `anticipateIn`, `interpolateIn`, `wait`, `waitT`, `mortal`, `histpan`; `once`, `first`, `only`, `hush`, `panic`; restarts with `qtrigger`, `ctrigger`, `rtrigger`, `ftrigger` and `mtrigger`
- **Stepwise and structure**: patterns count their steps, as in Tidal: `stepcat`, `steptake`, `stepdrop`, `expand`, `contract`, `extend`, `pace`, `stepalt`, `stepzip`; `ur` song structures, `inhabit`, `weave`, `swap`, `chew`, `snowball`
- **Echoes and repeats**: `echo`, `echoWith`, `stutter`, `plyWith`, `ghost`, `rolled`
- **Randomness and conditions**: `sometimes` and its relatives, `someCyclesBy`, `degradeBy`, `fadeIn`/`fadeOut`, `randcat`, `markovPat`, `within`, `while`, `when`, `ifp`, `foldEvery`, `inside`/`outside`, `until`, `playFor`
- **SuperDirt's semantics**: `gain` is SuperDirt's curve (gain^4), `resonance` goes from 0 to 1, `bandq` boosts the band, `n` is the note of a synth, `up` is `note`, delay and reverb are global effects per orbit (each event sets them), cut groups and `loop` work as in SuperDirt
- **Audio effects**: filters with resonance and envelopes, a peak equaliser, the DJ filter, delay (level, time and feedback, as in Tidal) and reverb per orbit, distortion and `shape`, bit crushing, `coarse`, vowel formants, tremolo, phaser, ring modulation, cut groups, `accelerate`, envelopes (`attack`, `hold`, `decay`, `release`), pitch envelopes (`penv`, and `pitchenv` with SuperCollider-style breakpoints), vibrato, portamento, and SuperDirt's effects: `squiz`, `waveloss`, `krush`, `triode`, `octer`, `fshift`, `leslie` and the spectral `freeze`, `comb`, `smear`, `scram`, `binshift`, `hbrick`, `lbrick`, in SuperDirt's order
- **Synths in the style of SuperDirt's**: `supersaw`, `supersquare`, `superpwm`, `superhoover`, `superreese`, `superzow`, `superchip`, `superfm`, `superpiano`, `supergong`, `superstatic`, and the drums `superkick`, `super808`, `supergabber`, `superhat`, `supersnare`, `superclap`
- **Harmony**: notes, Tidal's 70+ scales (with the Arabic maqamat's quarter tones) and every chord of its table, arpeggios, inversions, strummed chords, `toScale`
- **Signals**: `sine`, `saw`, `tri`, `square`, `rand`, `irand`, `perlin`, bipolar `sine2` and friends, envelopes `envL`/`envEq` and SuperCollider-style breakpoint envelopes in seconds (`envelope`), `brand`, with `range`, `rangex`, `segment`, `smooth`
- **Output**: synthesised sounds, Web MIDI, OSC over WebSocket, audio recording, JSON and MIDI file export
- **SuperCollider import**: open a `.scd` file and get TidalJS code: Pbinds, Ppar, Pdef, routines, tempo, SynthDefs as TidalJS synths with effects, effect buses and `Pfx`, JITLib (`Ndef`, `ProxySpace`), buffers as samples, MIDI and OSC in and out, GUI windows as groups of sliders, envelopes and LFOs that move a sound while it plays, and random rhythms (see [Importing SuperCollider code](#importing-supercollider-code))
- **Live editor** (built with [SibuJS](https://sibujs.dev/) and TypeScript): syntax highlighting, autocomplete, hover help that explains the code under the pointer (what each function, sound, scale, chord and mini-notation symbol does, with an example, a tip and related functions; the palette buttons show the same help), an insert palette for every function (Tab moves between parameters), a Reference tab split into Patterns, Time, Sound, Harmony and Live sections, with a search over all of them (press `/` or Ctrl+K; it matches names, signatures and descriptions, highlights the matches, puts name matches first and suggests a name for typos) and entries that open their extended help with an example to insert, live update while playing, a library of saved sketches (IndexedDB, or localStorage where it is not available) with export and import of `.js` and `.json` files, reached from the top bar (the open sketch's name, Save with Ctrl+S, and a Sketches menu with the recent sketches, export and import), errors and warnings marked in the code, a cycle view of what is playing, error messages that keep the music running, seamless tempo changes, recording
- **Sharing**: Sketches → Share as a link… copies a link with the song's code, title and tempo inside it (nothing is uploaded); a link opens for review, never plays by itself, and code that does more than music is flagged before its first Play (see [Sharing a song](#sharing-a-song))
- **Examples**: public-domain songs (Beethoven, Bach, Pachelbel, Grieg, Satie, traditional tunes), Christmas carols (Jingle Bells, Silent Night, Deck the Halls, We Wish You a Merry Christmas, Good King Wenceslas, Carol of the Bells), genre grooves (house, boom bap, bossa nova, jungle), recorded samples from Dirt-Samples, a short demo of each area of the library, and complete pieces made with SuperDirt's synths (rave, polymetric techno, trance, generative ambient, drum and bass, chiptune, gabber, and an arrangement built with `ur`)

```javascript
// Pattern fundamentals
sound("arpy*4").note("c e g b").add(note("0 12"))

// Time transformations
sound("hh*8").every(4, x => x.fast(2)).sometimes(x => x.gain(0.74))

// Audio effects
sound("arpy").lpf(800).reverb(0.3).vowel("a")

// Composition
stack([
  sound("bd ~ bd ~"),
  sound("~ sn ~ sn"),
  sound("hh hh hh hh").gain(0.74)
])

// Layering
sound("bd sn").superimpose(x => x.fast(2).add(note(12))).overlay("hh*4")
```

## Quick Start

### Basic HTML setup

```html
<!DOCTYPE html>
<html>
<head>
    <title>TidalJS Live Coding</title>
</head>
<body>
    <script src="tidal.js"></script>
    <script>
        const tidal = new TidalJS();

        async function start() {
            await tidal.init();

            // Start live coding
            sound("bd sn bd sn").play();
        }

        // Browsers only allow audio after a user gesture
        document.addEventListener('click', start, { once: true });
    </script>
</body>
</html>
```

Outside the editor, call `.play()` on a pattern to start it, `.stop()` to stop it, and `stopAll()` to stop everything.

### Live coding interface

The editor is built with [SibuJS](https://sibujs.dev/) and TypeScript. Run it locally with Node.js 22.12 or later:

```bash
git clone https://github.com/hexplus/tidaljs.git
cd tidaljs
npm install
npm run dev
```

In the editor, every top-level expression that results in a pattern is played when you press **Ctrl+Enter** (Cmd+Enter on Mac). Separate patterns with a blank line or combine them with `stack([...])`. Press **Esc** to stop. If the code has an error, the error is shown and the previous patterns keep playing.

You can also evaluate code from JavaScript:

```javascript
const result = tidal.eval('sound("bd sn")\n\nsound("hh*4").gain(0.84)');
// { success: true, activePatterns: 2, warnings: [] }
```

### Importing SuperCollider code

The editor converts a [SuperCollider](https://github.com/supercollider/supercollider) file (`.scd`) into TidalJS code. This is an alpha: common code converts, but not everything does yet. Use **Sketches → Import SuperCollider (.scd) (alpha)…**, the **Import .scd (alpha)** button in the Library tab, or drop the file on the Library tab. The converted code opens in the editor, ready to play and edit. The conversion runs in a background worker, so the page stays responsive; one that takes longer than 30 seconds is stopped with a message, and so is a file larger than 5 MB.

The importer parses the file and runs it far enough to know what it plays, then writes each part as a TidalJS pattern:

- **What plays**: `Pbind`, `Pmono`, `Ppar`, `Ptpar`, `Pdef`, `Pbindef`, `Pchain` (`<>`), `Pseq` of patterns (sections), `Routine`, `Task` and `fork` with `Synth(...)` and `wait`, events played with `.play`, and functions played with `{ ... }.play`. Each Pbind (or each instrument of a routine) becomes one part.
- **Value patterns**: `Pseq`, `Pser`, `Pn`, `Pdup`/`Pstutter`, `Pkey`, `Pfunc`, `Pfuncn`, `Pseries`, `Pgeom`, `Pslide`, `Place`, `Ppatlace`, `Pswitch`, `Pif`, `Pseg`, `Pfin`, `Pfindur`, `Pconst`, `Psync`, `Pbjorklund`, `Prout`, and arithmetic on patterns. A series that never ends (`Pseries(0, 1, inf)`) keeps growing (`.add(note(sig((t) => Math.floor(t))))`), and a list shuffled again each time (`Pn(Pshuf(list))`) becomes `shuffle`. `Pwhite`, `Pexprand`, `Prand`, `Pxrand` and `Pwrand` become TidalJS random signals (`rand.range`, `rand.rangex`, `irand`, `choose`, `wchoose`).
- **Events**: rests (`\rest`, `Rest()`), `dur`, `legato`, `sustain`, `stretch`, `amp`/`db`, `pan`, `lag`, `timingOffset`, chords (arrays), and SuperCollider's pitch model (`degree`, `scale`, `root`, `octave`, the transpositions, `note`, `midinote`, `freq`). `Pbind(\type, \dirt, ...)` events keep their SuperDirt controls.
- **Routing and effects**: `Bus.audio` and `Bus.control`; an effect synth that reads a bus (`In.ar`) puts its effects on the parts that play into that bus, sends included (`Out.ar(\send, sig * 0.3)`), chains of effects too; `Pfx`, `Pfxb` and `Pproto` effects; a control bus set with `bus.set(v)` is that value, and one an LFO synth writes (`Out.kr(bus, SinOsc.kr(0.5).range(200, 2000))`), read with `bus.asMap`, becomes a TidalJS signal (`sine.range(200, 2000)`) at the LFO's rate. Groups only order synths, so they need nothing.
- **JITLib**: `Ndef`, `NodeProxy`, `ProxySpace` (`~x = ...`, `~x.play`), filter slots (`Ndef(\x)[1] = \filter -> { |in| ... }`), one proxy read inside another (`Ndef.kr(\lfo)`), effect proxies fed with `<<>`, `.set`, and `Tdef`. The last definition of each proxy plays.
- **Buffers**: files read with `Buffer.read` become TidalJS sample banks (a `samples({...})` call at the top of the code), and synths that play them (`PlayBuf`, `BufRd`, and `TGrains`, `GrainBuf`, `Warp1` played as samples) become `sound("kick snare")` with `speed` from their rate and `begin` from their start.
- **MIDI and OSC out**: `Pbind(\type, \midi, ...)` and `MIDIOut`'s `noteOn`/`noteOff`, `control` and `program` become `.midi(output)` with `midichan`, `note`, `vel`, `ccn`/`ccv` and `pgm`; `NetAddr.sendMsg("/dirt/play", ...)` is a SuperDirt event and other messages with name-value pairs are sent with `.osc()`; `s.sendMsg("/s_new", ...)` starts a synth.
- **Live input**: GUI sliders, knobs, buttons, number boxes and menus (`Slider`, `Knob`, `EZSlider`, `NumberBox`, `Button`, `CheckBox`, `PopUpMenu`, `Slider2D`, `RangeSlider`, with their `ControlSpec`) become `slider()` and `toggle()` in the Controls panel, named after the `StaticText` next to them or a button's first state; each `Window` becomes a group of the panel with its rows (`HLayout`, `VLayout`, `GridLayout`, or controls placed with `Rect`), written as `controlLayout()`. `MIDIdef.cc` becomes `midicc()`, `MIDIdef.bend` `midibend()`, `MIDIdef.touch` `miditouch()`, `MIDIdef.polytouch` `keytouch()` (each held key's own pressure) or `miditouch()`, `MIDIdef.noteOn` functions that start a synth become `midikeys()` (a pitch-bend function that bends the held synths sets its bend range), and the values an `OSCdef` reads become `oscIn()`; an `OSCdef` that starts a synth becomes `oscplay()`, which plays it for each message with that message's values. What their functions change (`synth.set`, a proxy's `set`, a bus's `set`, `Pdefn`...) follows the player, during the note too. The mouse (`MouseX`, `MouseY`, `MouseButton`) becomes a slider or switch.
- **Changes during a note**: an LFO (even one whose speed or range other LFOs move) or an envelope (`EnvGen`, `Line`, `XLine`) inside a SynthDef that moves a filter, the pan, the level or the pitch becomes `.followNote(control, signal)`, and a control bus or proxy an LFO or an envelope writes becomes `.follow(control, signal)`, so the value moves while the note sounds, as in SuperCollider. A random value drawn per note (`Rand`, `ExpRand`, `IRand`) becomes a random value per event.
- **Synths from code**: a synth started in a routine ends where the routine releases it (`x.release`, `x.free`, `x.set(\gate, 0)`); `x.set(\freq, 400)` on a running synth goes on with the new values (`.tie()`: the same voice, no new attack), and so does `Pmono`. Random values in code that runs again and again (`rrand`, `.choose`, `.rand` in a routine, a `Pfunc` or a `Prout`) become TidalJS random signals; in code that runs once they are one draw, as in SuperCollider.
- **Tempo**: `TempoClock(...)`, `TempoClock.default.tempo = ...`, `.play(clock)` and `quant` (with its phase, `[4, 1]`; a negative quant counts bars; `Pdef(\x).quant = 4`). A `.play` starts on the next multiple of its quant on its own clock, plus the phase, the same way at the top of the file and in a routine (one inside another, on another clock, too), and a player stopped while it waits for its quant does not play. Every clock's times (starts, stops, a routine's waits, a routine started on another clock) are put on one timeline; a pattern played without a clock plays on the default clock, also when a routine on another clock plays it, as in SuperCollider. One cycle is the loop most parts share (4 beats when it fits), and `setTempo` or `setCPS` keeps the tempo exact. `setTempo` is only used between 20 and 300 BPM, which it accepts (360 BPM, `TempoClock.default.tempo = 6`, is `setCPS(1.5)`); a tempo outside TidalJS's 0.05 to 10 cycles per second gets a cycle of more or fewer beats, so it stays exact.
- **When parts start and stop**: a part that ends (a finite `Pbind`, an intro in a `Ppar`, a section of a `Pseq`) plays once, with `.playFor(from, to)`, and one that starts later (a `Ptpar` offset, a later section, a routine that waits first) starts there, with `.stopFor(0, from)` (and `.late()` when its loop does not fall there). Every value plays at its own note's onset, however the part's first and last loops fall: a part that starts within its loop (a `quant` phase, a routine's wait), ends within one (a finite `Pseq`, a `.stop`) or begins with rests, a control whose period is not the rhythm's, and a series that grows each loop (counted from the part's first note). Each playback (each `.play`, a routine's and a `Pdef`'s again included) is a part of its own, with its own start and end: a pattern a routine starts plays on after the routine ends, as in SuperCollider, until it runs out or is stopped (`x.stop` stops the playback `x = p.play` started, also from a routine on another clock; `Pdef(\x).stop` stops the Pdef, whichever routine started it); a pattern played, stopped and played again keeps the gap between, two playbacks of one pattern overlap, and `x.resume` goes on from where it stopped. The playbacks of one pattern that a routine starts again and again (forever, or until they all end) are one part, whose loop holds the gaps. When everything ends, the whole piece loops as a preview with `.timeLoop()`, and the code says so.
- **Several things at once**: synths a routine starts at the same instant (or events of no length) are voices of their own, in a `stack`, each with its own controls and length. Events that take turns between SynthDefs become one part per SynthDef, so each keeps its own SynthDef's sound, envelope, filters and effects.
- **SynthDefs**: TidalJS's ports (`superhoover`, `supergabber`) are used when the name matches; other SynthDefs become the closest TidalJS synth (by name, such as kick or hat, or by their oscillators: detuned saws are a `supersaw`, a sine whose frequency another sine moves (FM, or `PMOsc`) is a `superfm` with its ratio as `semitone` and its index as `voice`). The filters, peak equaliser, reverb, distortion and pan after the oscillators become effects (`lpf`, `resonance`, `hpf`, `bpf`, `peak`, `freeverb`, `shape`, `pan`), with their envelopes (`lpenv`, `peakenv`...); `Env.perc`, `Env.adsr`, `Env.asr` and `Env.linen` become `attack`, `hold`, `decay`, `sustainlevel` and `release`; pitch envelopes become `penv` or `pitchenv`, and an LFO sweeping the pitch (`SinOsc.kr(1).exprange(100, 2e3)`) becomes a vibrato (`vib`, `vibmod`). An argument that drives one of them becomes that control, so `\cutoff` in a Pbind becomes `.lpf()`. Array arguments expand into channels as in SuperCollider: two channels that differ play as two layers, panned left and right. Levels follow SuperCollider's (`amp` and the gains in the SynthDef), and a synth that nothing stops (`{ ... }.play`) is a note as long as each cycle.

Each part loops over its shortest period: its rhythm is a `struct` with weighted steps (`"x@4 x@3 x"`), and each control a mini-notation sequence over its own period (over several loops of the rhythm: `"[c4 e4 g4 a4]/4"` when its changes fall on binary fractions of a loop, else `cat(...)` with one sequence per loop, so that rounding never moves a value off its onset). Notes on what could not be converted exactly are written at the top of the code. Parts are named after their instrument, with `Part` added when that name is a JavaScript reserved word or a TidalJS function (an instrument called `yield` is `yieldPart`), and the code is checked to parse before it opens. The test suite converts a gabber track (two SynthDefs and a Ppar of two Pbinds on a TempoClock) and checks that all 336 events of the first minute play at the same times with the same parameters as in SuperCollider.

```supercollider
SynthDef(\pluck, { |out = 0, freq = 440, amp = 0.2, cutoff = 2000, rq = 0.3|
  var sig = Saw.ar(freq) * Env.perc(0.01, 0.5).ar(2);
  sig = RLPF.ar(sig, cutoff, rq);
  Out.ar(out, Pan2.ar(sig * amp, 0));
}).add;
Ppar([
  Pbind(\instrument, \pluck, \degree, Pseq([0, 2, 4, 7], inf), \dur, 0.25, \cutoff, Pseq([800, 2400], inf)),
  Pbind(\instrument, \kick, \dur, 1)
]).play(TempoClock(120 / 60));
```

becomes:

```javascript
// my-song.scd: converted from SuperCollider by TidalJS.
setTempo(120) // tempo 2 beats per second, 4 beats per cycle
setOutput(1, false) // as SuperCollider: no master volume and no limiter

// \pluck (played at line 7): saw, the closest TidalJS synth; its RLPF and Pan2 become effects.
const pluck = sound("saw")
  .struct("x*4").note("c4 e4 g4 c5").lpf("800 2400 800 2400").pan(0)
  .resonance(0.174293).attack(0.01).hold(0).release(0.5).amp(0.266667)
  .fast(4)

// \kick (played at line 8): no SynthDef for it in the file, so the TidalJS synth superkick plays it.
const kick = sound("superkick")
  .legato(0.8)
  .fast(4)

stack([pluck, kick])
```

### Sharing a song

**Sketches → Share as a link…** copies a link to the song in the editor: its code, title and tempo. The song is packed into the link's fragment (`#song=1.d.…`, compressed with deflate and written in base64url), which browsers never send to a server, so nothing is uploaded and anyone with the link can read the song. Songs up to 30,000 characters of code can be shared; a link longer than 8,000 characters gets a warning, because some chat apps cut long links. When the clipboard is not available, the dialog shows the link selected, ready for Ctrl+C.

Code in the editor is JavaScript that runs in your browser when you press Play, so code someone else wrote (a link, an imported `.js` file, a converted `.scd` file, the sketches of an imported library) is treated as untrusted:

- **Nothing runs by itself.** Opening a link shows the song for review: title, tempo, the whole code as text, the sites it may load files from, and anything risky the scan found. Only **Open in editor** puts it in the editor, and only Play runs it. Imported files open in the editor for review the same way. Opening external code never runs it, not even while music plays (what was playing keeps playing, and live update leaves the new code alone). If the editor holds unsaved changes (code, title or tempo), you are asked before they are replaced; saved sketches are never touched.
- **Allowed once, for that text.** The first Play of external code always asks you to allow it: running it is what gives it the same access to this page as TidalJS. The answer holds only for the exact code you saw: if it changes before it runs (an edit, another document, while the audio starts), you are asked again. Once it has run, it is your code. Saved before it ran, a sketch keeps its origin, so reopening it (or reloading the page) asks again. The code and its origin are kept in this browser as one record, so a reload never pairs code with another document's origin. A song's tempo becomes the document's tempo when it opens (the tempo field shows it, and saving, exporting and sharing use it) but the music takes it only when the document starts (its first successful run, or Play while nothing plays) or when you change the tempo field; if that run fails, the music keeps its tempo. Later live updates leave the tempo as it is, so a tempo an event set (a `cps` control) survives editing another line, unless the code calls `setCPS` itself. A title typed while a save is on its way is kept and counts as unsaved. If the browser refuses to store the new record (storage full), the older ones are kept, and a reload reads them as before.
- **The link leaves the address bar** as soon as the page reads it, so a reload does not open it again.
- **Strict decoding.** The link must have the right version, only base64url characters and at most 60,000 of them, and it may decompress to at most 128 KB: decompression stops as soon as it passes that, so a small link cannot expand into a huge one. The data must be exactly a title (text, at most 200 characters, cleaned of control, invisible and bidirectional characters and cut to 80), the code (text, at most 30,000 characters) and a tempo (a number from 0.05 to 10). Anything else is refused with a plain message.
- **Text only.** The title and the code are shown as text, never as HTML. The review shows invisible and bidirectional characters in the code as `⟦U+202E⟧`, so they cannot make the code look different from what runs.
- **A check before the first Play.** The scan looks for what a music pattern never needs: network access (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`...), running other code (`eval`, `Function`, `import()`, `setTimeout`), reaching into JavaScript's objects (`constructor`, `prototype`, `globalThis`), the page (`document`, `window`), saved data (`localStorage`, `indexedDB`, `cookie`), leaving the page (`location`, `open()`), other browser features (`navigator`, `postMessage`, `Worker`), pop-ups, and ways to hide those names: `\u` and `\x` escapes, names glued or decoded at run time (`"fe" + "tch"`, `.join("")`, `fromCharCode`, `atob`), lookups by a name in text (`obj["name"]`), invisible characters, very long lines and code pushed far below empty lines. What it finds is listed in the question the first Play asks. The check runs on the code as it is when you press Play, also after a reload; it is advice, and the question is asked whatever it finds.
- **It is a check, not a guarantee.** JavaScript has too many ways to reach a feature for any scan to catch them all. Play shared code only from people you trust, and read it first.

The page also sets a Content Security Policy (in `index.html`): no plugins (`object-src 'none'`), no `<base>` or form hijacking (`base-uri 'none'`, `form-action 'none'`), no frames, scripts only from the page itself. It cannot sandbox code you choose to play: the engine runs pattern code with `new Function` (`'unsafe-eval'`) and loads its audio worklet from a `blob:` URL, `samples()` may fetch from any https site (or a local http sample server) and OSC output uses a WebSocket bridge, so network access stays open. That is why the review and the check above exist.

## Usage Examples

### Samples

TidalJS synthesises its default sounds. Load recorded samples to use real ones: a loaded bank replaces the synth of the same name, and `n` (or `"bd:3"`) picks the file.

```javascript
// The Dirt-Samples library (the samples TidalCycles ships with), from GitHub
samples("github:tidalcycles/dirt-samples")

sound("bd*2 [~ bd] sn:3 hh*4").n("<0 1>")

// A breakbeat in 32 slices: n picks the slice, speed -1 plays backwards
sound("amencutup*16").n("0 .. 15").sometimesBy(0.2, x => x.speed(-1))

// Your own files: a strudel.json manifest URL, or banks and a base URL
samples({ kick: ["kick1.wav", "kick2.wav"] }, "https://example.com/samples/")
```

A manifest is a JSON object of bank names and file lists, with an optional `_base` URL (the format Strudel uses). `samples()` returns a promise. Nothing runs again when they arrive: each event plays its bank's file once it has loaded, and the status line then reports unknown sounds. Files are loaded and decoded the first time they are needed. Paths work like links: relative to the manifest's `_base`, which is itself relative to the manifest's final URL (after redirects), or to the manifest when there is no `_base`; banks given in code are relative to `base` or their `_base`, or to the page. A manifest or file that fails to load is reported once and not asked for again until you press **Retry** in the status line (or call `samples()` after `tidal.retrySamples()`). An argument that is not a source (a number, an empty text, a list, a malformed `github:` source, a base that is not text) is an error in the code, on the line of the `samples()` call: nothing of that code runs and nothing is asked for.

### Streams and transitions

As in Tidal, patterns play in streams: `d1(...)` to `d16(...)`, or `p("name", ...)`. The editor shows every stream above the cycle view, with buttons to mute (M) and solo (S) it. A transition changes a stream from its previous pattern to a new one:

```javascript
d1(sound("bd*4"))                           // play this first...
xfadeIn(1, 8, sound("bd*2 [~ bd] sn ~"))    // ...then this crossfades d1 over 8 cycles
jumpMod(1, 4, sound("bd sn"))               // or switch at the next cycle divisible by 4
mute(2); solo("drums"); unmuteAll()
```

While you type, live updates keep a stream as it was when its own code, the declarations it uses (and those they use) and every other statement are unchanged, so editing one line does not restart a transition in another. Anything else counts as a change, even one that only shows many cycles later (an `every(8, ...)`). A declaration counts as a possible write for every stream unless its initialiser only builds a value (literals, functions, TidalJS's pattern functions and pattern methods on them): an unused `const x = update(config)` changes the streams that read `config`.

### Tidal's operators

Every control is also a function on its own, as in Tidal, and `.set()` is Tidal's `#`. `.add()`, `.sub()`, `.mul()`, `.div()` and `.mod()` are `|+`, `|-`, `|*`, `|/` and `|%`: the rhythm comes from the pattern on the left, and controls combine key by key (notes as semitones; strings keep the left value, as in Tidal). A bare whole number is `n` and a fraction `speed`, as Tidal's `fromInteger` and `fromRational`.

```javascript
// d1 $ n "0 .. 7" # s "arpy" |+ n "<0 3 5>" # speed "1 2"
d1(n("0 .. 7").sound("arpy").add(n("<0 3 5>")).set(speed("1 2")))
sound("drum*4").add(3)                  // drum, n 3 (a whole number is n)
sound("bd*4").set({ gain: 0.8 })
```

Differences from Tidal: note names use scientific octaves (`a4` is 440 Hz; Tidal calls it `a5`), `pan` goes from -1 to 1, and functions are JavaScript arrow functions (`x => x.fast(2)`).

### Patterned arguments

The numeric arguments of `fast`, `slow`, `density`, `hurry`, `ply`, `iter`, `linger`, `rot`, `late`, `early`, `off`, `every`, `degradeBy`, `chop`, `striate`, `segment`, `swing`, `swingBy`, `chunk`, `euclid`, `scramble`, `shuffle`, `run`, `binary` and most of the newer functions can be patterns, and so can the mini-notation's modifiers (`"bd*<2 3>"`, `"bd(<3 5>,8,<0 2>)"`):

```javascript
sound("bd sn hh cp").fast("<1 2 [1 4]>")   // a different speed each cycle
sound("bd*4").ply("1 2")                   // first half single, second half doubled
sound("bd sn").every("<2 3>", x => x.rev())
```

### Basic patterns

```javascript
// Simple drum pattern
sound("bd sn bd sn")

// With effects
sound("bd sn bd sn").lpf(600).reverb(0.3)

// Rests and repeats
sound("bd*2 ~ sn hh*3")
```

### Time transformations

```javascript
// Every 4 cycles, play twice as fast
sound("bd sn bd sn").every(4, x => x.fast(2))

// Random variations
sound("hh hh hh hh").sometimes(x => x.gain(0.74)).rarely(x => x.rev())

// 1.5 repetitions per cycle
sound("arpy arpy arpy").density(1.5)

// Reverse on cycles 6 and 7 of every 8
sound("bd sn hh cp").whenmod(8, 6, x => x.rev())
```

### Musical patterns

```javascript
// Notes: c, c#4, eb3, f5 ... or numbers (semitones from middle C)
sound("arpy").note("c e g c5")

// Transposition
sound("arpy").note("c e g").add(note("0 12 7"))

// Frequency
sound("sine").freq("440 554 659")
```

Each event takes the control value that is active at its start, and events that fall on a rest in the control are dropped (like Tidal's `#`). In each cycle, whichever pattern has more steps sets the rhythm: `sound("arpy").note("c e g")` plays three notes, and a bar of rests in the note pattern is silent. The pattern that sets the rhythm also gives the step count that `stepcat`, `pace` and the other stepwise functions use.

### Composition

```javascript
// Layer patterns
stack([
  sound("bd ~ bd ~"),
  sound("~ sn ~ sn"),
  sound("hh hh hh hh").gain(0.74)
])

// One pattern per cycle
cat([
  sound("bd sn"),
  sound("hh cp")
])

// Rhythm from a structure, sounds from a pattern
struct("x ~ x x", sound("bd sn"))

// Layer a transformed copy
sound("bd sn").superimpose(x => x.fast(2).add(note(12)))
```

### Effects

```javascript
// Vowel filter
sound("saw").note("c3 e3 g3").vowel("a")

// Bit crushing and distortion
sound("arpy*4").crush(4).distortion(5)

// Effect chains
sound("bd sn bd sn")
  .every(8, x => x.rev())
  .sometimes(x => x.lpf(600))
  .delay(0.5).delaytime(0.25)
  .reverb(0.4)

// Effects take patterns too
sound("saw*8").note("c2").lpf("300 600 1200 2400")
```

## Complex examples

Longer examples that combine many features. The editor's Examples tab has these and more in its **Advanced** group.

### Trance: a gated supersaw and a delayed pluck

Trance at 138 BPM: a gated supersaw, an off-beat sub bass and a pluck whose delay and reverb live on their own orbit, as in SuperDirt, so they do not wash over the kick.

```javascript
setCPS(138 / 60 / 4)

const chords = "<a2'min f2'maj c3'maj g2'maj>"

stack([
  sound("superkick*4"),
  sound("[~ oh]*4").gain(0.74),
  // The off-beat sub bass follows the chord roots.
  sound("sine").note("<a1 f1 c2 g1>").struct("[~ x]*4").legato(0.8).gain(0.95),

  // The gated pad: sixteen hits per bar and a filter that opens over eight bars.
  sound("supersaw").note(chords).struct("x*16").legato(0.5)
    .gain("1.1 0.8 1 0.8").lpf(saw.range(500, 5000).slow(8)).resonance(0.15),

  // The pluck: '8 makes each chord eight notes deep and arp plays them in turn.
  sound("supersquare").note("<a3'min'8 f3'maj'8 c4'maj'8 g3'maj'8>")
    .arp("<up updown>").ply(2).legato(0.3).lpf(2500).gain(0.95)
    .orbit(1).delay(0.4).delaytime(0.75 * 60 / 138).delayfeedback(0.5)
    .room(0.35).size(0.8)
])
```

### Drum and bass: rearranging the break

Rearranging a break live: `bite` reorders its eighths, `chunk` speeds up one quarter per bar (backwards on odd bars, with a negative number) and `linger` repeats its start.

```javascript
setCPS(174 / 60 / 4)

sound("[bd ~ ~ ~ sn ~ ~ bd] [~ bd ~ ~ sn ~ ~ ~], hh*16")
  .bite(8, "0 1 <2 6> 3 [4 5] 6 <7 2> [6 7]")
  .chunk("<4 -4>", x => x.hurry(2))
  .linger("<1 1 0.5 [0.25 0.5]>")

sound("superreese").note("<[e1 ~ ~ e1] [~ g1 ~ ~] [c1 ~ ~ c2] [~ b0 ~ ~]>")
  .legato(1.2).lpf(200).lpenv(4).lpattack(0.02).lpdecay(0.3).resonance(0.25)
```

### Polymetric techno, step by step

Tidal 1.10's stepwise functions: every part counts its steps, so polymeters and `stepcat` share the cycle by steps.

```javascript
setCPS(130 / 60 / 4)

stack([
  sound("superkick*4"),
  // At 16 steps per cycle, the 3-, 5- and 7-step loops line up only every 105 steps.
  sound("{superhat superhat ~, ~ ~ superclap ~ ~, oh ~ ~ ~ ~ hh ~}%16"),
  // 3 + 5 = 8 even steps; steptake keeps 8, 6, 4 or 7 of them.
  stepcat(note("c3 eb3 g3"), note("bb3 g3 f3 eb3 c3"))
    .steptake("<8 6 4 7>").sound("supersquare").legato(0.4).lpf(1800),
  // pace: the 7-step bass line at 16 steps per cycle.
  sound("superfm").note("c2 [~ c2] eb2 ~ g1 ~ [bb1 c2]").pace(16).voice(sine.range(0.2, 1.6).slow(8))
])
```

### Generative ambient

Tidal's random numbers depend on the cycle, so this never repeats over a short time, yet the same cycle always plays the same notes. The scale changes every bar, about half the notes are dropped, and the chords are strummed forwards or backwards.

```javascript
setCPS(0.2)

stack([
  sound("superpiano*8").note(scale("<c4:major a3:minor f3:lydian g3:mixolydian>", irand(10)))
    .degradeBy(0.45).sometimesBy(0.25, x => x.add(note(12)))
    .voice(perlin.range(0.3, 0.8)).pan(perlin.range(0.2, 0.8).slow(3))
    .orbit(1).room(0.6).size(0.9),
  sound("superpiano").note("<c3'maj7'5 a2'min9'5 f2'maj7'o g2'sus4'5>")
    .rolledBy("<0.25 0.5 -0.25 0.4>").legato(2).voice(0.4).gain(0.95)
    .freeverb(0.5).freeroom(0.9),
  sound("supergong ~").note("c2").someCyclesBy(0.4, x => x.add(note(7))).slow(2).gain(0.9)
])
```

### An arrangement with ur

`ur` picks which named pattern plays when, over 16 cycles, and `"name:fx"` adds an effect. `layer` applies several functions to one pattern, and `fix` changes only the events of one sound.

```javascript
setCPS(124 / 60 / 4)

const drums = sound("superkick [~ superkick] superkick ~, ~ superclap, superhat*8")
  .fix(x => x.decay("0.05 0.2"), { s: "superhat" })

const bass = sound("superreese").note("<c2 [c2 eb2] f1 [g1 bb1]>").struct("x(3,8,<0 2>)")
  .legato(0.7).lpf(800)

// The lead and, on orbit 1 (the only one with a delay), its octave.
const lead = layer([
  x => x,
  x => x.add(note(12)).gain(0.8).orbit(1).delay(0.3).delaytime(0.375 * 60 / 124).delayfeedback(0.4)
], sound("supersaw").note(scale("c4:minor", "0 [2 4] <3 5> [~ 7]")).legato(0.5).lpf(2400))

ur(16, "intro intro [drums, bass] [drums, bass] [drums, bass, lead] [drums, bass, lead] [drums:break, lead] [drums, bass, lead:up]", {
  intro: sound("superpwm").note("c3'min7'5").legato(1).rate(0.4).gain(0.66),
  drums, bass, lead
}, {
  break: x => x.chunk(4, y => y.fast(2)).degradeBy(0.3),
  up: x => x.add(note(5))
})
```

### A live set with streams

Streams can be changed while they play. Start with this:

```javascript
setCPS(0.55)
d1(sound("superkick*4"))
d2(sound("~ superclap").orbit(1).room(0.3))
d3(sound("superhat*8").gain("1 0.8"))
d4(sound("superreese").note("<c2 eb2 f1 g1>").struct("x(3,8)").lpf(600))
```

Then replace the d1 and d4 lines with transitions and run the code again: the kick crossfades into a broken beat over 8 cycles, and the bass changes at the next cycle divisible by 4. `once` plays one cycle of a snare roll on top.

```javascript
setCPS(0.55)
xfadeIn(1, 8, sound("superkick [~ superkick] ~ superkick"))
d2(sound("~ superclap").orbit(1).room(0.3))
d3(sound("superhat*8").gain("1 0.8"))
jumpMod(4, 4, sound("superreese").note("<c2 c3>*4").lpf(sine.range(300, 1200)))
once(sound("supersnare*8").gain(saw.range(0.8, 1.1)))
```

The M and S buttons above the cycle view mute and solo each stream; in code, `mute(3)`, `solo(1)` and `unmuteAll()` do the same.

## API Reference

### Core functions

| Function | Description | Example |
|----------|-------------|---------|
| `sound()` | Create a sound pattern | `sound("bd sn bd sn")` |
| `stack()` | Play patterns together | `stack([sound("bd"), sound("hh")])` |
| `layer()` | Apply each function and stack the results (Tidal's `layer`) | `layer([x => x, x => x.fast(2)], sound("bd sn"))` |
| `cat()` | One pattern per cycle | `cat([sound("bd"), sound("sn")])` |
| `fastcat()` | All patterns squeezed into one cycle | `fastcat([sound("bd"), sound("sn")])` |
| `struct()` | Rhythm from a structure, values from a pattern | `struct("x ~ x x", sound("bd sn"))` |

### Time transformations

| Function | Description | Example |
|----------|-------------|---------|
| `fast(n)` | Play n times per cycle | `.fast(2)` |
| `slow(n)` | Stretch over n cycles | `.slow(2)` |
| `density(n)` | Same as `fast()` | `.density(1.5)` |
| `rev()` | Reverse each cycle | `.rev()` |
| `late(n)` / `early(n)` | Shift in time by n cycles (Tidal's `~>` and `<~`) | `.late(0.25)` |
| `ply(n)` | Repeat each event n times within its span | `.ply(2)` |
| `iter(n)` / `iterBack(n)` | Start each cycle one nth further into the pattern | `.iter(4)` |
| `linger(x)` | Repeat the first part of each cycle (negative: the end) | `.linger(0.25)` |
| `rot(n)` | Shift values n steps along the events, keeping the rhythm | `.rot(1)` |
| `off(t, f)` | Play f(pattern), t cycles later, on top | `.off(0.125, x => x.add(note(12)))` |
| `every(n, f)` | Apply f on cycles 0, n, 2n... | `.every(4, x => x.fast(2))` |
| `whenmod(n, m, f)` | Apply f when cycle mod n >= m | `.whenmod(8, 6, x => x.rev())` |
| `sometimes(f)` | Apply f to 50% of events | `.sometimes(x => x.rev())` |
| `often(f)` | 75% of events | `.often(x => x.gain(0.84))` |
| `rarely(f)` | 25% of events | `.rarely(x => x.fast(2))` |
| `almostAlways(f)` | 90% of events | `.almostAlways(x => x.lpf(900))` |
| `almostNever(f)` | 10% of events | `.almostNever(x => x.crush(4))` |
| `sometimesBy(p, f)` | Apply f with probability p | `.sometimesBy(0.3, x => x.add(note(12)))` |
| `rhythm(durations)` | Play one step after another from cycle 0, never looping: step k lasts `durations` cycles (a number or a pattern read at cycle k, at least 1/256) and plays what the pattern plays at cycle k (a chord stays a chord, a rest is a silent step) | `note("c4 e4 g4").slow(3).rhythm(choose([0.25, 0.5]))` |

### Audio effects

| Function | Description | Example |
|----------|-------------|---------|
| `gain(n)` | Volume, 0 to 2 (default 1), on SuperDirt's curve: the level is gain^4, so 0.5 is -24 dB | `.gain(0.95)` |
| `pan(n)` | Stereo position, -1 (left) to 1 (right) | `.pan(-0.5)` |
| `lpf(freq)` | Low-pass filter | `.lpf(800)` |
| `hpf(freq)` | High-pass filter | `.hpf(200)` |
| `bpf(freq)` | Band-pass filter | `.bpf(1000)` |
| `delay(level)` | Level of the orbit's delay, 0 to 1 (as in SuperDirt); `delaytime` sets the time in seconds and `delayfeedback` the repeats | `.delay(0.5).delaytime(0.25)` |
| `reverb(amount)` | Amount of the orbit's reverb, 0 to 1 (`room` in SuperDirt) | `.reverb(0.3)` |
| `distortion(n)` | Distortion, 1 to 100 | `.distortion(5)` |
| `crush(bits)` | Bit crusher, 1 to 16 bits | `.crush(4)` |
| `vowel(v)` | Formant filter: a, e, i, o, u | `.vowel("a")` |

### Musical functions

| Function | Description | Example |
|----------|-------------|---------|
| `note(pattern)` | Note names or semitones from middle C | `.note("c e g")` |
| `up(pattern)` | Same as `note()`, as in Tidal | `.up("0 12 7")` |
| `add(note(p))` | Transpose in semitones (Tidal's `\|+ note`) | `.add(note("0 12 7"))` |
| `freq(pattern)` | Frequency in Hz | `.freq("440 554")` |
| `midinote(pattern)` | MIDI note number | `.midinote("60 64 67")` |
| `n(pattern)` | Sound variation of a bank; the note of a synth (as in SuperDirt) | `.n("0 1 2")` |

### Composition methods

| Function | Description | Example |
|----------|-------------|---------|
| `append(p)` | Play p in the next cycle | `sound("bd").append("sn")` |
| `overlay(p)` | Play p at the same time | `sound("bd ~").overlay("~ sn")` |
| `superimpose(f)` | Play the pattern and f(pattern) | `.superimpose(x => x.add(note(12)))` |
| `jux(f)` / `juxBy(x, f)` | The pattern on the left, f(pattern) on the right | `.jux(x => x.rev())` |
| `euclid(k, n, r)` / `euclidInv(k, n, r)` | Play on (or off) k of n evenly spread steps | `.euclid(3, 8)` |
| `euclidFull(k, n, other, r)` | This pattern on the hits, `other` on the rests (also a global function) | `.euclidFull(3, 8, sound("hh"))` |
| `nTake(name, list)` | Each played event takes the next value of the list as `n` | `.nTake("a", [0, 2, 4])` |
| `struct(s)` | Take the rhythm from s | `sound("bd sn").struct("x x ~ x")` |

### Rearranging

| Function | Description | Example |
|----------|-------------|---------|
| `chunk(n, f)` | Apply f to one of n parts, a different one each cycle; a negative n goes backwards | `.chunk("<4 -4>", x => x.hurry(2))` |
| `scramble(n)` | n random parts per cycle, with repeats | `.scramble(8)` |
| `shuffle(n)` | n parts per cycle in random order | `.shuffle(4)` |
| `bite(n, p)` / `fitment(n, p)` | Parts in the order of an index pattern | `.bite(4, "0 2 1 3")` |
| `palindrome()` | Forwards, then backwards | `.palindrome()` |
| `swing(n)` / `swingBy(x, n)` | Delay every other 1/2n step | `.swing(4)` |
| `compress(b, e)` | Squeeze each cycle into part of the cycle | `.compress(0.25, 0.75)` |
| `stretch()` | Zoom each cycle so its events fill it | `.stretch()` |
| `chop(n)` | Cut each sound into n parts | `.chop(4)` |
| `striate(n)` | Interleave n slices of every sound | `.striate(2)` |
| `hurry(n)` | Faster and higher | `.hurry(2)` |
| `sparsity(n)` | Same as `slow()` | `.sparsity(2)` |

### Randomness and conditions

| Function | Description | Example |
|----------|-------------|---------|
| `degradeBy(x)` | Remove events with probability x | `.degradeBy(0.3)` |
| `degrade()` | Remove half of the events | `.degrade()` |
| `randcat([..])` | A random pattern each cycle | `randcat([sound("bd"), sound("sn")])` |
| `within(b, e, f)` | Apply f to part of each cycle | `.within(0, 0.5, x => x.fast(2))` |
| `while(p, f)` | Apply f where a boolean pattern is true | `.while("1 0", x => x.rev())` |
| `until(n, f)` | Apply f until cycle n | `.until(8, x => x.lpf(400))` |
| `playFor(a, b)` | Only play between cycles a and b | `.playFor(4, 8)` |
| `stopFor(a, b)` | Silent between cycles a and b | `.stopFor(4, 8)` |
| `wchoose(pairs)` | A weighted random value at every event | `wchoose([["bd", 3], ["sn", 1]])` |

### Harmony

| Function | Description | Example |
|----------|-------------|---------|
| `scale(name, p)` | Scale degrees to notes; the name can be a pattern | `.note(scale("e:minor", "0 2 4"))` |
| `chord(p)` | Chord names to notes | `.note(chord("c'maj e'min"))` |
| `arp(mode)` / `arpeggiate(mode)` | Play chord notes one after another | `.arp("<up updown>")` |
| `inversion(n)` | Raise the lowest notes of each chord | `.inversion(1)` |
| `fit(step, list, p)` | Pick from a list, shifting each cycle | `sound(fit(1, ["bd", "sn"], "0 1"))` |

`scaleList()` and `chordList()` return the available names.

### Signals

Signals are continuous patterns. They have no events of their own; events that use them take the value at their start time.

| Signal / method | Description | Example |
|-----------------|-------------|---------|
| `sine`, `cosine`, `saw`, `isaw`, `tri`, `square` | Waves from 0 to 1 over a cycle | `.pan(sine)` |
| `rand`, `irand(n)`, `perlin` | Random values | `.n(irand(8))` |
| `range(lo, hi)` | Scale 0..1 to lo..hi | `.lpf(sine.range(200, 2000).slow(4))` |
| `quantise()` | Round values | `saw.range(0, 7).quantise()` |
| `segment(n)` | Sample n times per cycle | `saw.segment(8)` |
| `smooth()` | Glide between the values of a numeric pattern | `.gain(fit(0, [0, 1], "0 1").smooth())` |
| `setBus(k, v)` / `bus(k)` | A value you can change while playing | `.lpf(bus("cut"))` |
| `envelope(levels, times, curves)` | SuperCollider's `Env`: levels, the times in seconds between them, and a curve per segment (a number, `"lin"`, `"exp"`, `"step"`, `"hold"`, `"sin"`, `"wel"`, `"sqr"`, `"cub"`; one or a list). Read at cycle / cps seconds: the first level before 0, the last after the end. With `followNote` it restarts at each note | `.followNote("lpf", envelope([200, 4000, 300], [0.01, 0.4]))` |

### Sound shaping

| Function | Description | Example |
|----------|-------------|---------|
| `speed(x)` | Playback speed and pitch | `.speed("1 2")` |
| `begin(x)`, `end(x)` | Play part of a sound, 0 to 1 | `.begin(0.25)` |
| `legato(x)` | Length relative to the event | `.legato(0.5)` |
| `sustain(s)` | Length in seconds | `.sustain(0.2)` |
| `attack(s)`, `release(s)` | Fade in and fade out | `.attack(0.05).release(0.3)` |
| `loop(n)` | Repeat the sound n times | `.loop(3)` |
| `cutoff(hz)`, `resonance(r)` | Low-pass filter and its resonance, 0 to 1 (as SuperDirt) | `.cutoff(800).resonance(0.2)` |
| `room(x)`, `size(x)` | Reverb amount and room size | `.room(0.4).size(0.9)` |
| `orbit(n)` | Each orbit has one delay and one reverb, set by its events: put parts with different effects on different orbits | `.orbit(1)` |
| `nudge(s)` | Shift timing in seconds | `.nudge(0.01)` |
| `follow(ctrl, sig)` | Change a control during each note (onset through release), reading the signal at absolute cycles: `lpf`, `hpf`, `bpf`, `resonance`, `hpq`, `bpq`, `pan`, `gain`, `amp`, `freq`, `note`, `speed`, `peak`, `peakq`, `peakgain`, `djf`, `tremolorate`, `tremolodepth`, `phaserrate`, `phaserdepth`, `ring`, `ringf`, `leslie`, `lrate`, `lsize`, `vib` (the speed of a vibrato). A signal of a live input (`slider`, `toggle`, `midicc`, `midibend`, `miditouch`, `oscIn`, `bus`) also moves the notes already sounding when the input changes | `.follow("lpf", sine.range(300, 3000).slow(4))` |
| `followNote(ctrl, sig)` | The same, with the signal's time starting at 0 at each note's onset (an LFO that restarts with every note) | `.followNote("pan", sine.range(-1, 1).fast(4))` |
| `tie(id)` | Monophonic slur (SuperCollider's `Pmono`): a note with the same tie as a synth voice still sounding (same sound and orbit) takes over that voice, with no new attack: see below for what it changes | `.legato(1).tie(1).portamento(0.05)` |

A tied note changes, from its start: the pitch (gliding over `portamento`), the length and `release`; `lpf`, `hpf`, `bpf` and their `resonance`/`hpq`/`bpq`; `gain`, `amp` and `pan`; `shape`, `crush`, `distort`/`distortion`, `triode`, `krush` and `kcutoff`; `vowel`; `tremolorate`, `tremolodepth`, `phaserrate`, `phaserdepth`, `ring`, `ringf`, `leslie`, `lrate`, `lsize`, `vib`, `vibmod`; `peak`, `peakq`, `peakgain` and `djf`; the AudioWorklet effects the voice started with (`coarse`, `waveloss`, `squiz`, `fshift`/`fshiftnote`, `octer`, the spectral effects, `freeverb`/`freeroom`/`freedamp`); the synth's own `detune`, `voice`, `rate`, `lfo` and `semitone` where they drive running nodes (`supersaw`, `supersquare`, `superreese`, `superpwm`, `superzow`, `superchip`, `superfm`, `superfb`); its orbit's `delay`, `delaytime`, `delayfeedback`, `lock`, `room`, `size` and `dry` (as every event of the orbit does); and its own `follow()`s. A tied voice is built with those effects even when its first note has none of them (set so they change nothing), so a later note can turn them on; a control a note leaves out keeps its value. Still fixed for the voice's life: `attack`, `decay` and `sustainlevel`, the filter and pitch envelopes (`lpenv`..., `penv`, `pitchenv`), `accelerate`, `begin`/`end`/`loop`, `n` and the sound, the AudioWorklet effects it started without, and the other synths' own parameters. Samples ignore `tie`.

### Live input

Each of these is a signal: use it wherever a pattern of numbers goes, like `sine`.

| Function | Description | Example |
|----------|-------------|---------|
| `slider(name, value, min = 0, max = 1, step = 0)` | A slider in the Controls panel (under the cycle view). Running the code again keeps its value; one the code no longer uses disappears. Values are remembered in the browser | `.lpf(slider("cutoff", 800, 200, 4000))` |
| `toggle(name, on = false)` | A switch in the Controls panel: 0 or 1 | `.gain(toggle("hats", true))` |
| `midicc(cc, channel)` | The last value of a MIDI control change, 0 to 1, on a channel (0 to 15) or any channel | `.lpf(midicc(74).range(200, 4000))` |
| `midibend(channel)` | The last pitch bend, -1 to 1 (0 in the middle), on a channel or any channel | `.follow("lpf", midibend().range(300, 3000))` |
| `miditouch(channel)` | The last aftertouch, 0 to 1: channel pressure, or the pressure of a key (the last one of any key) | `.follow("gain", miditouch().range(0.7, 1.1))` |
| `keytouch()` | In a `midikeys` template, the pressure of that voice's own key (polyphonic aftertouch), 0 to 1, so each held note follows its key; until its key is pressed harder the note keeps its own value. 0 outside `midikeys`. (`miditouch()` in a template likewise leaves a note its own value until channel pressure comes after its key went down) | `midikeys(sound("supersaw").follow("amp", keytouch().range(0.1, 0.4)))` |
| `midikeys(template, channel, bendRange = 0)` | Play a MIDI keyboard: each key plays the template's first event of the current cycle with `note` = the key and `amp` = (its amp or the default) × velocity / 127, held until the key is let go. With `bendRange` (semitones; `channel` may be `null` for any channel), the pitch-bend wheel bends the held keys, and a key pressed with the wheel off centre starts bent (synths only). Returns `silence`, so it fits in a `stack` | `midikeys(sound("superpiano").amp(0.3), null, 2)` |
| `oscIn(address, index = 0)` | The last number received on an OSC address (argument `index`), through the OSC bridge | `.lpf(oscIn("/fader1").range(200, 4000))` |
| `oscplay(address, template)` | Each OSC message on the address plays the template's first event of the current cycle once, at its own length. The message's numbers are kept first, so `oscIn` of the same address in the template reads that message. Returns `silence` | `oscplay("/hit", sound("superpiano").freq(oscIn("/hit", 1)))` |
| `controlLayout(title, rows)` | Arrange the Controls panel: a titled group whose rows are lists of slider and toggle names, side by side; one group per call, in order; controls no layout names come after the groups. A statement on its own (it plays nothing); a new run replaces the layouts only if it plays | `controlLayout("Synth", [["cutoff", "res"], ["on"]])` |

`follow()` and `followNote()` on one of these inputs keep listening while the note sounds: moving a slider, a MIDI knob or the wheel, an OSC fader or calling `setBus` re-lays the automation of the sounding notes (held MIDI keys and tied voices too) from that moment, at most every 20 ms.

MIDI input listens to every input the browser sees (the browser asks for permission the first time). OSC input uses the same WebSocket bridge as `.osc()` (`setOscUrl`). TidalJS does not ship a bridge; for `oscIn` the bridge must **send every OSC packet it receives over UDP back to the browser as one binary WebSocket message**, unchanged: an OSC message (address, type tags, arguments) or a bundle (`#bundle`, time tag, sized elements, nested bundles allowed). Arguments of type `i`, `f`, `d`, `h`, `T`/`F` give numbers (`s`, `b` and the others are read and skipped). Text frames are ignored. For example, with Node and the `ws` package:

```javascript
// bridge.mjs: WebSocket on 8080 <-> UDP (send to 57120, listen on 57121)
import dgram from "node:dgram";
import { WebSocketServer } from "ws";
const udp = dgram.createSocket("udp4");
udp.bind(57121);
const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws) => ws.on("message", (data) => udp.send(data, 57120, "127.0.0.1")));
udp.on("message", (packet) => {
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(packet, { binary: true });
});
```

### Output

| Function | Description |
|----------|-------------|
| `.midi(output)` | Send events to a Web MIDI output, by index or name, instead of the synths |
| `.vel()`, `.ccn()`, `.ccv()`, `.pgm()`, `.midichan()` | MIDI velocity, control change, program change and channel |
| `midiOutputs()` | Names of the available MIDI outputs |
| `.osc(address)` | Send OSC bundles (SuperDirt `/dirt/play` format) over a WebSocket |
| `setOscUrl(url)` | Address of the WebSocket-to-UDP bridge (default `ws://localhost:8080`), also used by `oscIn()` |
| `record()`, `stopRecording()` | Record the audio output and download it |
| `exportPattern(p, cycles, format)` | Download cycles of a pattern as `"json"` or `"midi"` |

`.midi()` reads each event the same way live and in `exportPattern(p, cycles, "midi")`: the channel is `midichan` (0 by default), `pgm`, `ccn`/`ccv` and `nrpn` are sent at the onset, before the note, and an event with only those controls (no `s`, `note`, `midinote` or `freq`) sends no note. The note is `midinote`, `note` or `freq` (plus `up`); drums by name (`bd`, `sn`, `hh`, `oh`, `cp`, `cy` and the `super...` drums) play their General MIDI note: live on `midichan` (add `.midichan(9)` for a General MIDI drum channel), and in an exported file on channel 9 (General MIDI percussion) when no channel or note is given, as exports always had them. Velocity is `vel` (0 to 1, or 0 to 127), else `gain` × 100; the note lasts `sustain` seconds, else the event's length × `legato`.

Stop (and `hush()`, `panic()`) cancels the MIDI scheduled ahead, notes and control, program and NRPN messages alike: pending messages are cleared where the browser supports `MIDIOutput.clear()`, notes already sounding get their note-off at once, and notes still to come that cannot be cancelled end as they start, so no note is left hanging (without `clear()`, controls already sent cannot be recalled, and the note-off of a note that was sounding still arrives: a note restarted on that key just after Stop is struck again 1 ms later, so it goes on). The MIDI of `once()`/`first()` is its own: when the loops stop it keeps playing (what `clear()` took from it is sent again), and Stop ends it. OSC packets waiting for the bridge belong to the loops or to a one-shot in the same way. Unplugged outputs are skipped. OSC packets waiting for the WebSocket to connect are dropped by Stop and by `setOscUrl()`, and a packet whose time has passed by the time the socket opens is not sent.

`stopRecording()` resolves with the recorded Blob (and downloads it), with `null` when nothing was recorded (no file), and rejects if the recorder fails; a failure always releases the recording, so you can record again.

### Sounds

| Name | Sound | Name | Sound |
|------|-------|------|-------|
| `bd` | Kick | `arpy` | Plucked synth |
| `sn` | Snare | `sine` | Sine synth |
| `hh` | Hi-hat | `saw` | Sawtooth synth |
| `oh` | Open hi-hat | `square` | Square synth |
| `ch` | Closed hi-hat | `tri` | Triangle synth |
| `cp` | Clap | `noise` | White noise |
| `cy` | Cymbal | `pink` | Pink noise |

SuperDirt-style synths:

| Name | Sound | Name | Sound |
|------|-------|------|-------|
| `supersaw` | Seven detuned saws | `superkick` | Synth kick |
| `supersquare` | Seven detuned squares | `super808` | TR-808 kick |
| `superpwm` | Pulse-width modulation pad | `supergabber` | Gabber kick |
| `superhoover` | Rave hoover | `superhat` | TR-808 hi-hat |
| `superreese` | Reese bass | `supersnare` | Synth snare |
| `superzow` | Phasing saws | `superclap` | Synth clap |
| `superchip` | Chiptune pulse | `superpiano` | Additive piano |
| `superfm` | Two-operator FM | `supergong` | Gong |
| `superstatic` | Crackle | `superfb` | Feedback sine (SinOscFB) |

`.voice()`, `.detune()`, `.semitone()`, `.rate()` and `.lfo()` change them, and `.penv()`/`.pdecay()` the pitch fall of the drums.

## Global Controls

Commands such as `setCPS`, `hush`, `setOutput`, `mute`/`solo`, `once`/`first`, `resetCycles`, `setBus`, `samples`, `record`/`stopRecording`, `exportPattern` and `setOscUrl` take effect only when the code they are in evaluates successfully: they run, in order, as the new code starts playing (`samples()` may download meanwhile, but its banks replace those of the same name only then, in the order the calls ran: a manifest that arrives late never replaces a bank set by a later call, and banks given in code are in use at once, so a `first()` after them in the same code plays them. A manifest that fails rejects the promise for whoever awaits it and shows in the status line; one nobody awaits is not an unhandled rejection). A live update that uses a sound only a manifest it asks for (not arrived yet) may hold waits, and the music that plays stays; when that manifest arrives or fails the code is checked again, once, and it plays if the sound came, or stays held back with an "Unknown sound" warning if it did not. That check happens only if nothing changed meanwhile: the same document and code, no Play, Stop or other update since, live update still on (or the run was a **Retry**, which checks again with live update off too, even if it is turned off while the samples load), and the music still playing; otherwise the manifest still loads, but runs no code and leaves the status of what happened since. An edit dropped by turning live update off is checked again when it is turned back on, if it is still the code in the editor. The check after the samples is the only automatic one for that edit: if the code asks for samples again then (a `samples()` source that changes on every run), it is not checked again by itself, the music that plays stays, and the status line says so (edit the code, press Play or Retry to run it again). A manifest that failed, or one other code is still waiting for, hides no unknown sound. Code that fails, or a live update held back by its warnings (a stream used twice is one), changes nothing of what plays (streams, sample banks, transport, tempo, output, mute and solo, live controls, sounding voices).

Events are sent in the order they sound, across streams and ticks: one moved later by `nudge` (or after a sharp slowdown) waits for its turn, and goes out when its time comes even if no new cycles are asked for then; one whose stream is muted, replaced or removed meanwhile does not play (a negative `nudge` works down to -0.2 seconds; see Limitations). A replaced stream takes over where the sound already sent ends: an onset the stream already sent is not sent again by the new version, whatever its `nudge` now (nor does its tempo change apply again; hits are matched by their onset, their length and what they played when sent (a value object changed in place later does not count), curves of `.follow()`/`.followNote()` included, compared at the points its voice read them while laying the hit out, or over its own span when no voice did; MIDI and OSC hits are matched on what the output sends, with take values (`gainTake`...: a replacement is read at the index each sent hit used, layers sharing a counter included) and followed controls as they go out at the onset they are scheduled for, on the clock it would go out on if it played, wherever its nudge puts it and with signals that read the tempo (`envelope()`) read there too: its own tempo change included, other replacements' at the same cycle or later left out (in the same stack or another stream), so one decision never undoes another (read once) and the rest of a curve left out, so a filter change MIDI does not send is no change (no extra work while nothing is replaced; a signal that fails there leaves it undecided, so the hit plays), and a value too large or too deeply nested to read in full is never taken for one already sent, so layers may be reordered, added or removed; of identical simultaneous hits, one already sent never stands for one still held back; a hit that now plays something else is a new one), and an onset moved later and not yet sent is the new version's to play. Notes held back keep the timing of their onset however many tempo changes come before they sound. A tempo change from an event (a `cps` control) belongs to its stream until the event carrying it is sent (earlier than its onset with a negative `nudge`, later with a positive one): removing, replacing or muting that stream, or soloing another, before then undoes it (heard again before then, it counts again), and once sent it stays, whatever happens to the stream, Stop included. Undone after its onset was passed (held by a positive `nudge`), it ends where the sound already sent ends: notes already sent keep their times. A live update that recovers such an unsent event plays it with the new version's control, whose tempo takes over from there; an event skipped as too late after a stall (a suspended tab) was never sent, so its tempo change is undone the same way. The changes apply in cycle order, whichever tick asked for them and whichever was sent first, so one equal to the tempo before it still matters if an earlier one is undone. Stop and `resetCycles()` drop the changes not yet sent and keep the tempo already in effect. A note's length is fixed when it starts, at the tempo then: a later tempo change does not stretch or shorten notes already sounding. Other things the code does itself in JavaScript (to the page, the network or globals) are not undone.


```javascript
// Tempo
setCPS(0.8)        // Cycles per second (also Tidal's setcps)
setTempo(120)      // Beats per minute, 4 beats per cycle (also Tidal's setbpm)

// Stop everything (one-shots too)
hush()             // or stopAll(); panic() also sends MIDI "all notes off"

// Play something once, on its own: it rings out even if the loops stop, until Stop
once(sound("cp"))  // a random cycle; first() plays cycle 0, asap() is once()

// The output stage: master volume and limiter (0.8 and on by default)
setOutput(1, false)

// Random choices, as in Tidal: patterns, not values fixed when the code runs
sound(choose(["bd", "sn", "cp"]).segment(8))                  // a random value at every event
sound("saw*4").note("c3").vowel(cycleChoose(["a", "e", "i"]))  // one random value per cycle
```

## Mini-Notation

```javascript
sound("bd sn bd sn")      // Steps share one cycle
sound("bd ~ sn ~")        // Rests with ~
sound("bd*2 sn/2")        // Faster / slower steps
sound("bd [sn sn]")       // Subdivide a step
sound("bd <sn cp hh>")    // One choice per cycle ("<a@3 b>" holds a for three cycles)
sound("[bd, hh hh hh]")   // Play at the same time
sound("{bd sn, hh hh hh}") // Polymeter; {a b c}%4 sets the steps per cycle (%<4 8> too)
sound("bd(3,8,2)")        // Euclidean rhythm with optional rotation
sound("hh? hh?0.3")       // Random removal (50%, 30%)
sound("bd!3 sn")          // Repeat a step ("bd !" and "bd ! 3" also work)
sound("bd@3 sn")          // Longer step ("bd _ _ sn" also works)
sound("[bd | sn | cp]")   // Random choice per cycle
sound("bd . hh hh")       // Group steps
sound("arpy*8").note("0 .. 7") // Range: one step holding 0 1 2 3 4 5 6 7 (also "7 .. 0", "c .. g")
sound("bd:3")             // Sound variation, same as .n(3)
sound("arpy").note("c'maj e'min7'i") // Chords: 'i inverts, 'o opens, 'd1 drops, '5 sets the note count
sound("arpy").note("c'<maj min>")     // Chord names (or roots) can be patterns
sound("bd - sn ~")        // "-" is a rest too
sound("bd*<4 3q>")        // Fractions: 1%3, and Tidal's ratio letters (q = 1/4, e = 1/8...)
sound("^kick sn")         // A value set with setBus("kick", ...)
```

## Development Status

All roadmap phases are implemented: core functions, advanced mini-notation and transformations, sample-style controls, harmony, signals, conditional patterns, MIDI, OSC, recording and export, samples, streams and transitions, and SuperDirt's synths and effects.

See the [roadmap](ROADMAP.md) for details and ideas for what comes next, and [Limitations](#limitations) for what works differently.

## Limitations

### Compared with TidalCycles

TidalJS runs in a browser and is written in JavaScript, so some things differ:

- The built-in sounds are synthesised: on them, `chop`, `striate`, `begin` and `end` slice the synthesised sound. On samples loaded with `samples()` they slice the recording, as in Tidal.
- Browsers cannot send UDP, so OSC needs a WebSocket bridge.
- `while` and `export` are JavaScript keywords: `while` is only a method, and export is `exportPattern()`.
- JavaScript names cannot contain `'`, so Tidal's `every'`, `within'`, `toScale'`, `fit'`, `iter'`, `sometimesBy'`, `jumpIn'` and `jumpMod'` are `everyOffset`, `withinZoom`, `toScaleBy`, `fitSlices`, `iterBack`, `sometimesByAfter`, `jumpInNext` and `jumpModOffset`. Operators are methods: `#` is `.set()`, `+|` is `.addRight()`.
- `pitchenv()` takes its breakpoints when the code runs, so it cannot be a pattern (`penv` can).
- Events have no "fragments": a pattern is queried for the events that start in a span, so functions that cut events at a boundary in Tidal (`trunc`, `while`, `playFor`, `within`) decide by where each event starts. `whenT` tests each event's start; Tidal tests the start of each query, which depends on how its scheduler splits time.
- Random numbers are Tidal's own (`timeToRand`, the same xorshift over a 300-cycle loop), so `rand`, `?`, `sometimes`, `shuffle` and the rest make the same choices as Tidal. `once()` picks its random cycle with the browser's random numbers, as Tidal does with the system's.
- Tidal quirks are kept: `interpolateIn` plays only where the old pattern has events (so from silence it plays nothing), a stream with no history transitions from silence, and an event without `delay` turns its orbit's delay down.
- Names that Tidal has deprecated are left out: use `echo` for `stut`, `echoWith` for `stutWith` and `stut'`, `segment` for `discretise`, `chunk` with a negative number for `chunk'`, and `xfadeIn`, `anticipateIn` or the other transitions for `wash` and `washIn` (Tidal no longer exports them). `scaleP` (Tidal 0.9) is `scale`, which takes a pattern of names.
- A few extensions are not in Tidal: `layer()` also stacks patterns given directly, `resonance` and `hpq` below 0 damp the filter (for SuperCollider's rq above 1), and `loop()` repeats the note of a synth.

### In the browser and the editor

- **Rollback covers what TidalJS plays, not JavaScript.** A failed evaluation leaves streams, tempo, output, mute and solo, sample banks and live controls as they were, but what the code itself did to the page, the network or global variables before it failed is not undone.
- **The check of shared and imported code is advice.** The scan cannot catch every way JavaScript can reach a feature; the question before the first run is asked whatever it finds, and running the code gives it the same access to the page as TidalJS.
- **Live updates keep a stream only when they can tell it is unchanged.** Editing anything the analysis cannot see through restarts it (and a running transition): a comment inside its statement, any other statement that is not a declaration, a declaration (or another stream's statement) that may write something (an assignment, `new`, `delete`, an immediately called function, a class whose `extends` runs code, or a call to a function that is neither TidalJS's nor one of the code's own functions that only compute), what any of those use, or code using `eval`, `globalThis`, `window` or escaped names. Calling your own helper that only builds patterns (it may declare locals, but writes nothing outside itself, and its parameters are plain names or destructuring, with no default values or computed keys, which run code when it is called) does not count.
- **`nudge`.** A positive `nudge` of any size works while a stream plays; when a live update replaces the stream, the new version's onsets that its `nudge` moves past what was already sent are played if the nudge is at most 1 second (or no longer than what the old version still held back), and onsets moved later than that are dropped at the switch. Onsets before Play or before a `resetCycles()`/`setCycle()` are never part of that handoff. A negative one works down to -0.2 seconds: events are asked for 0.2 s before they are sent, so one moved up to that much earlier is still known in time and plays on time. A `nudge` below -0.2 plays 0.2 s early (not as early as asked), and a warning says so. Asking 0.2 s ahead also means a tempo change from the field takes effect after what was already sent (about 0.1 s), and `resetCycles()`/`setCycle()` asks again for what was asked ahead.
- **Note lengths are fixed when a note starts**, at the tempo then: a tempo change that comes later does not stretch or shorten notes already sounding.
- **MIDI on Stop.** Browsers without `MIDIOutput.clear()` (Chrome, at the time of writing) cannot recall what was already sent ahead: control, program and NRPN messages still arrive, a note inside the look-ahead starts and is ended at once (a short blip on some synths), and the note-off of a note that was sounding still arrives, so a note restarted on that key just after Stop is struck again just after it (1 ms, or halfway to the new note's own end when that is sooner); when the new note ends at that very moment, it is not struck again and ends a little early. A note struck again that way is still ended by a further Stop. None of this has been tried on hardware MIDI devices, only with simulated ports.
- **OSC on Stop.** Packets already handed to an open WebSocket cannot be recalled; only those still waiting for the bridge are dropped.
- **One-shots** (`once`, `first`, `asap`) keep their output and effects for 8 seconds after their last event, for delay and reverb tails; Stop ends them at once.
- **Storage.** The editor's document is kept in this browser as one record. When the browser refuses to store it (storage full, private mode), the previous records stay and a reload reads those.
- **SuperCollider import** runs in a background worker with a 30-second limit and no Cancel button; a file over 5 MB is refused.

### Importing SuperCollider code

The importer runs the language parts of a file, not the server, so:

- A SynthDef is not run: it is read as a graph and matched to a TidalJS synth with effects. Only `superhoover` and `supergabber` are the same SynthDefs; two-operator FM becomes `superfm` with the same ratio and index, but larger FM networks, feedback (`LocalIn`/`LocalOut`, whose feedback is left out), granular synthesis (played as samples) and more than two channels play the closest TidalJS sound, and the comment above the part says which.
- Effects run on each sound, as TidalJS has no buses: an effect synth on a bus becomes the effects of each part that plays into it (`lpf`, `freeverb`...), a send puts the whole sound through the effect (a reverb's mix is scaled by the send level), and when a part and its effect both have, say, a low-pass filter, the part's own is kept. A part that plays into a bus nothing reads is silent in SuperCollider and plays dry here.
- Changes during a note follow the LFO's shape (sine, saw, triangle, square, noise) and range, or the envelope's levels, times and curves (`envelope()`). An envelope with a release node holds its sustain level, as TidalJS does not know when a note is let go. An LFO whose speed or range another LFO moves becomes a `sig()` function of time: its speed is integrated exactly for a sine, saw, triangle or square that moves it (a noise LFO, or an LFO moving the LFO that moves it, gives its average speed), and a vibrato whose speed an LFO moves becomes `.followNote("vib", ...)`.
- Sound files must be reachable from the browser: the `samples()` call keeps the paths of the SuperCollider code, which you may need to change to URLs. Buffer lengths are not known before the files load, so a start given in frames plays from the beginning (a start given as a fraction of `BufFrames` works).
- Live input is read where its functions change something TidalJS plays. A slider moves linearly over its range (an exponential `ControlSpec` is noted); a window's position, size, colours and fonts are left out, only its title and the order of its controls are kept. Polyphonic aftertouch that changes the held notes becomes each key's own pressure (`keytouch()` in the `midikeys` template); used for anything else, it is the pressure of the last key (`miditouch`).
- Random durations play with `rhythm()`: the events one after another, each with a new random duration (TidalJS's random draws, not SuperCollider's; they repeat after 300 steps, as Tidal's random values repeat after 300 cycles). A rest is a silent step with its own random duration. Random and fixed durations in a loop (`Pseq([0.25, Pwhite(0.1, 0.5, 1)], inf)`, a routine's random and fixed waits, a changing `stretch`) become `rhythm(cat(...))`, one length per step. Eight random 4-beat stretches drawn from the SuperCollider pattern, with `randcat` picking one each cycle, remain for what one step length cannot express: a random `stretch`, a `timingOffset`, several waits in a row after one synth, or lengths that do not repeat within 64 steps. Values drawn in code that runs once keep that draw, as in SuperCollider. A part that ends plays once; when everything ends, the piece loops as a preview.
- Code that would hang SuperCollider is stopped where it would hang, with a note: an empty pattern repeated forever (`Pn(Pseq([], inf))`), a routine whose `loop` never waits (what it played before is kept), events of no length forever, a statement that never ends. An array of more than a million items is not made (its statement is noted). Every step of the conversion counts against one budget, so the import ends with a message instead of freezing.
- A part's loop is looked for as far as it was played: 512 beats, or 6000 events for dense material (an event every 0.05 beats reaches 300 beats). A rhythm that does not repeat within that loops its first 16 beats, with a note. That limit is how far the importer looks, not an end: a part still playing there plays on, and so does a routine that loops forever (the patterns it starts again play on; new patterns it would start after the 512 beats are not written, with a note). A `Pdef` played again while it plays goes on, as in SuperCollider, whichever routine plays it: a Pdef's plays and stops are taken in the order of their times, so a later routine that starts it before an earlier routine plays it again leaves one voice, and one stopped by one routine and played again by another starts again there.
- A `timingOffset` moves when an event plays, not how long it lasts: each note keeps its sustain (`dur` × `legato`) even where its step is cut short. A negative one plays each event that much earlier; an event it moves before the start is left out (SuperCollider plays it late, at once), with a note.
- Clocks and stops: each `TempoClock` keeps one tempo for the whole piece (its last value; tempo changes over time are not followed), every clock starts at beat 0 at time 0 (which decides where `quant` falls), and a `Pdef` waits for the next whole beat (quant 1, unless `Pdef(\x).quant` says otherwise; `beatsPerBar` is taken as 4 for a negative quant). An event exactly at the time its pattern is stopped does not play. `Routine.stop`, `sched` delays and `quant` on routines are not converted. Apart from a `Pdef`'s plays and stops, the routines are run one after another, in the order of the file: a player (`x = p.play`) that a routine starts can be stopped or resumed by code after it in the file (another routine included, at any time after its `.play`), not by a routine earlier in the file. Where a part inside a `Pseq` of patterns ends is inferred from the gap after its last event (a `Ppar`'s parts end exactly). More than 16 relaunches of one pattern by an endless routine that do not repeat in a pattern stay one part.
- The conversions are checked by playing the converted code in TidalJS and comparing its events with what SuperCollider would play, worked out from SuperCollider's documented behaviour; they have not been compared with real `sclang` output.
- Values are written with six significant digits; loop lengths are written as exact fractions (`.fast(8 / 3)`). TidalJS compares event times exactly, so where a part starts or stops on an onset at a time that is not a binary fraction of a cycle (thirds, a cycle of 2.75 beats), the bound is written 1e-9 cycle early (`.playFor(5 / 3 - 1e-9, 8 / 3 - 1e-9)`), with a note, so that rounding neither drops the note there nor lets in the next one.

### Compared with SuperCollider and SuperDirt

TidalJS cannot run SuperCollider code. A SynthDef has to be rebuilt from TidalJS's synths and effects, and some details of SuperCollider's engine cannot be reproduced in Web Audio:

- **Synths.** `superhoover` and `supergabber` follow their SynthDefs line by line. The other SuperDirt-style synths are Web Audio designs with the same character, not ports of SuperDirt's code.
- **Oscillators.** Web Audio's band-limited oscillators are built from wavetables and SuperCollider's (`Saw`, `Pulse`) by other means. They sound the same, but the samples are not identical.
- **Filters.** Web Audio has one biquad design (the "Audio EQ Cookbook" one). `BPeakEQ` and SuperCollider's `HPF` and `LPF` give the same responses. `RLPF` and `RHPF` use another discretisation, which differs slightly near the cutoff when it is high in the spectrum (a fraction of a dB at 7 kHz). `resonance` follows SuperDirt (0 to 1, rq = 1000^-resonance), so SuperCollider's rq is `resonance(Math.log10(1 / rq) / 3)`.
- **Reverb.** `room`, `size` and `dry` work as SuperDirt's (one reverb per orbit, fed by every sound of the orbit; room is the input, size the length, dry turns it down), but the reverb itself is a convolution with a decaying noise burst, not SuperDirt's feedback network, so it sounds different. `freeverb()` is SuperCollider's FreeVerb2 exactly.
- **Delay feedback** is kept below 0.99: SuperDirt lets it run away above 1.
- **Delay lines.** Web Audio's `DelayNode` interpolates linearly. `DelayC` (cubic) and `DelayL` match it closely; a swept delay, as in a chorus, has slightly more high-frequency loss.
- **Control rate.** SuperCollider updates `.kr` signals once every 64 samples. TidalJS's envelopes are smooth (points 2 ms apart, or per sample), so `.kr` envelopes are reproduced without their steps.
- **Randomness in synths.** `Rand`, `ExpRand` and friends draw new values for every note in both, but SuperCollider's random sequences are not reproduced, so no two renders of a detuned synth are identical, just as in SuperCollider. (Pattern randomness is Tidal's exactly.)
- **Output level.** By default the editor sends the sound through a master volume of 0.8 and a limiter. `setOutput(1, false)` removes both, so the level is SuperCollider's (and loud patterns can clip, as there).
- **Spectral effects.** `freeze`, `comb`, `smear`, `scram`, `binshift`, `hbrick` and `lbrick` use a 512-sample FFT. The voices that use them start 384 samples early to stay in time, which needs the scheduler's look-ahead. Their exact algorithms are approximations of SuperCollider's PV_ UGens.
- **AudioWorklet.** `squiz`, `waveloss`, `fshift`, `octer`, `freeverb` and the spectral effects need AudioWorklet (every current browser has it). Without it they are skipped with a warning.

## Contributing

Contributions are welcome. TidalJS is an open-source project built for the live coding community.

### How to contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-function`
3. Make your changes, with tests and documentation
4. Submit a pull request

### Development setup

```bash
git clone https://github.com/hexplus/tidaljs.git
cd tidaljs
npm install
npm run dev        # editor with hot reload
npm test           # engine tests (tidal.js), help checks (every help and editor example runs), library, editor rules, SuperCollider importer, Reference and share link tests
npm run test:browser  # the editor in a real browser (Playwright; npx playwright install chromium first, or PW_CHANNEL=chrome)
npm run build      # type-check and build into dist/
npm run lint       # SibuJS lint rules
```

Every push and pull request runs the engine tests, the help checks, the type-check and build, and the SibuJS lint on Node.js 22 and 24 (`.github/workflows/ci.yml`). Pushing to `main` also builds the editor and publishes `dist/` to GitHub Pages (`.github/workflows/pages.yml`).

### Project layout

| Path | What it is |
|------|------------|
| `tidal.js` | The library: pattern engine, scheduler, synths, MIDI/OSC output. No dependencies; use it from a `<script>` tag on any page. |
| `index.html` | Entry of the editor app. |
| `src/main.ts`, `src/App.ts` | Mounts the app and lays out the page. |
| `src/session.ts` | App state in signals, and audio control: play, stop, live update, recording, review before external code runs. |
| `src/provenance.ts` | Where the editor's code came from, and the approval external code needs before it first runs. No DOM. |
| `src/drafts.ts` | The draft (code, title, tempo) against what it was opened or saved as. No DOM. |
| `src/document.ts` | The editor's document as kept between visits: code, provenance, identity and pending tempo in one record, and how older records are read. No DOM. |
| `src/runs.ts` | Guards for asynchronous actions: one shared engine start, and tickets that make a waiting Play stale. |
| `src/library.ts` | The sketch library: storage (IndexedDB or localStorage), export and import. |
| `src/share.ts` | Share links: encoding and strict decoding of `#song=...`, and the scan of shared code for risky features. No DOM; the dialogs are in `src/components/Share.ts`. |
| `src/supercollider/` | The SuperCollider importer: lexer and parser of sclang, an interpreter that runs patterns, routines and SynthDef graphs, the SynthDef analysis, and the writer of TidalJS code. |
| `src/engine.ts` | Loads `tidal.js` and types the parts of it the app uses. |
| `src/components/` | Top bar (with the sketch bar), insert palette, cycle view, status line, sidebar (examples, library and reference). |
| `src/editor/` | The code editor: highlighting, problem markers, autocomplete, tab stops, hover help. |
| `src/data/` | Examples, insert-palette snippets, function signatures, the extended help (`docs.ts`), the Reference content and its sections (`reference.ts`), and the Reference search (`referenceSearch.ts`, `referenceDocs.ts`). |
| `test/engine.test.mjs` | Engine tests, run in Node with a fake audio context. |
| `test/core.test.mjs` | Staged commands and rollback, one-shots and runtime errors, scheduler order and tempo changes, live-update stream identity, sample URLs and retries. |
| `test/statements.test.mjs` | How code is split into statements: regular expressions, templates, comments, control flow, line breaks, error locations. |
| `test/output.test.mjs` | MIDI and OSC output on Stop (fake ports and sockets), MIDI file export decoded byte by byte, recording failures. |
| `test/editor.test.mjs` | The editor's rules with no DOM: provenance and approval, drafts, engine start and Play tickets. |
| `test/browser/` | Browser integration tests (Playwright): external code review, Stop while the audio starts or samples load, one-shots, drafts, recording. |
| `test/docs.test.mjs` | Checks the help in `src/data/docs.ts` (everything has a doc, every example runs) and plays every example of the Examples tab. |
| `test/supercollider.test.mjs` | Tests the SuperCollider importer: the language, and conversions played in the engine and compared with what SuperCollider plays. |
| `test/library.test.mjs` | Tests the sketch library: export and import files, merging, the localStorage store. |
| `test/reference.test.mjs` | Tests the Reference tab's sections and search: ranking, highlight ranges, excerpts and suggestions. |
| `test/share.test.mjs` | Tests share links: round trips, forged, damaged and oversized links (a decompression bomb too), title cleaning and the scan of risky code. |

### Areas for contribution

- A visual pattern editor: draw steps on a grid and get the mini-notation
- Recording a session (code and audio) to replay it
- A MIDI input mapped to buses (`bus()`), like Tidal's control buses
- Documentation and tutorials
- Performance optimisations
- Mobile browsers

## Resources

- **[Live TidalJS Editor](https://hexplus.github.io/tidaljs/)**: built with [SibuJS](https://sibujs.dev/)
- **[SibuJS](https://sibujs.dev/)**: the frontend framework the editor is built with
- **[TidalCycles documentation](https://tidalcycles.org/docs/)**: the original Haskell version
- **[Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)**: the browser audio technology
- **[TOPLAP](https://toplap.org/)**: the live coding community

## Community

- **Discussions**: use GitHub Discussions for questions and ideas
- **Issues**: report bugs and request features in GitHub Issues
- **Live coding**: share your TidalJS performances and patterns

## License

This project is licensed under the MIT License. See [LICENSE.md](LICENSE.md) for details.

## Acknowledgments

- **Alex McLean** and the TidalCycles community for the original vision
- **The live coding community** for inspiration and feedback
- **Web Audio API developers** for making browser audio possible
- **Contributors** who help make TidalJS better

### Projects TidalJS builds on

TidalJS follows the design and behaviour of these projects. Each one keeps its own license, which applies to that project's code and files.

| Project | Links | What TidalJS takes from it | License |
| --- | --- | --- | --- |
| **TidalCycles** (Tidal), by Alex McLean and contributors | [tidalcycles.org](https://tidalcycles.org/) · [GitHub](https://github.com/tidalcycles/Tidal) | The pattern model, mini-notation, function names and their semantics | [GPL-3.0](https://github.com/tidalcycles/Tidal/blob/main/LICENSE) |
| **SuperCollider** | [supercollider.github.io](https://supercollider.github.io/) · [GitHub](https://github.com/supercollider/supercollider) | The language the `.scd` importer reads; the behaviour of its UGens, filters and FreeVerb2 | [GPL-3.0](https://github.com/supercollider/supercollider/blob/develop/COPYING) |
| **SuperDirt**, by Julian Rohrhuber and contributors | [GitHub](https://github.com/musikinformatik/SuperDirt) | The synths, effects, orbits and the meaning of each control | [GPL-2.0](https://github.com/musikinformatik/SuperDirt/blob/develop/LICENSE) |
| **Dirt-Samples** | [GitHub](https://github.com/tidalcycles/Dirt-Samples) | The sample library `samples("github:tidalcycles/dirt-samples")` loads. The samples are not bundled with TidalJS: they are downloaded from GitHub when loaded | The repository has no license file; the samples come from many sources |
| **Strudel** | [strudel.cc](https://strudel.cc/) · [Codeberg](https://codeberg.org/uzu/strudel) | The `strudel.json` sample manifest format | [AGPL-3.0](https://codeberg.org/uzu/strudel/src/branch/main/LICENSE) |
| **Freeverb**, by Jezar at Dreampoint | — | The reverb algorithm behind SuperCollider's FreeVerb2 and `freeverb()` | Public domain |
| **Audio EQ Cookbook**, by Robert Bristow-Johnson | [W3C](https://www.w3.org/TR/audio-eq-cookbook/) | The biquad filter formulas Web Audio uses | [W3C Document License](https://www.w3.org/copyright/document-license/) |

### Libraries and tools

| Project | Use | License |
| --- | --- | --- |
| [SibuJS](https://sibujs.dev/) | The framework the editor is built with | MIT |
| [Vite](https://vite.dev/) | Development server and build (development only) | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Type checking and compilation (development only) | Apache-2.0 |

## Get Started Now

```javascript
const tidal = new TidalJS();
await tidal.init();

sound("bd sn bd sn")
  .every(4, x => x.fast(2))
  .sometimes(x => x.lpf(600))
  .play();
```

---

Made for the live coding community.
