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
- **Time transformations**: `fast`, `slow`, `rev`, `every`, `whenmod`, `chunk`, `ply`, `iter`, `linger`, `rot`, `off`, `scramble`, `shuffle`, `swing`, `compress`, `palindrome`..., with patterned arguments such as `fast("<1 2>")`
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
- **Signals**: `sine`, `saw`, `tri`, `square`, `rand`, `irand`, `perlin`, bipolar `sine2` and friends, envelopes `envL`/`envEq`, `brand`, with `range`, `rangex`, `segment`, `smooth`
- **Output**: synthesised sounds, Web MIDI, OSC over WebSocket, audio recording, JSON and MIDI file export
- **SuperCollider import**: open a `.scd` file and get TidalJS code: Pbinds, Ppar, Pdef, routines, tempo, and SynthDefs as TidalJS synths with effects (see [Importing SuperCollider code](#importing-supercollider-code))
- **Live editor** (built with [SibuJS](https://sibujs.dev/) and TypeScript): syntax highlighting, autocomplete, hover help that explains the code under the pointer (what each function, sound, scale, chord and mini-notation symbol does, with an example, a tip and related functions; the palette buttons show the same help), an insert palette for every function (Tab moves between parameters), live update while playing, a library of saved sketches (IndexedDB, or localStorage where it is not available) with export and import of `.js` and `.json` files, reached from the top bar (the open sketch's name, Save with Ctrl+S, and a Sketches menu with the recent sketches, export and import), errors and warnings marked in the code, a cycle view of what is playing, error messages that keep the music running, seamless tempo changes, recording
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

The editor converts a [SuperCollider](https://github.com/supercollider/supercollider) file (`.scd`) into TidalJS code. Use **Sketches → Import SuperCollider (.scd)…**, the **Import .scd** button in the Library tab, or drop the file on the Library tab. The converted code opens in the editor, ready to play and edit.

The importer parses the file and runs it far enough to know what it plays, then writes each part as a TidalJS pattern:

- **What plays**: `Pbind`, `Pmono`, `Ppar`, `Ptpar`, `Pdef`, `Pbindef`, `Pchain` (`<>`), `Pseq` of patterns (sections), `Routine`, `Task` and `fork` with `Synth(...)` and `wait`, events played with `.play`, and functions played with `{ ... }.play`. Each Pbind (or each instrument of a routine) becomes one part.
- **Value patterns**: `Pseq`, `Pser`, `Pn`, `Pdup`/`Pstutter`, `Pkey`, `Pfunc`, `Pfuncn`, `Pseries`, `Pgeom`, `Pslide`, `Place`, `Ppatlace`, `Pswitch`, `Pif`, `Pseg`, `Pfin`, `Pfindur`, `Psync`, `Pbjorklund`, `Prout`, and arithmetic on patterns. `Pwhite`, `Pexprand`, `Prand`, `Pxrand` and `Pwrand` become TidalJS random signals (`rand.range`, `rand.rangex`, `irand`, `choose`, `wchoose`).
- **Events**: rests (`\rest`, `Rest()`), `dur`, `legato`, `sustain`, `stretch`, `amp`/`db`, `pan`, `lag`, `timingOffset`, chords (arrays), and SuperCollider's pitch model (`degree`, `scale`, `root`, `octave`, the transpositions, `note`, `midinote`, `freq`). `Pbind(\type, \dirt, ...)` events keep their SuperDirt controls.
- **Tempo**: `TempoClock(...)`, `TempoClock.default.tempo = ...` and `.play(clock)`. One cycle is the loop most parts share (4 beats when it fits), and `setTempo` or `setCPS` keeps the tempo exact.
- **SynthDefs**: TidalJS's ports (`superhoover`, `supergabber`) are used when the name matches; other SynthDefs become the closest TidalJS synth (by name, such as kick or hat, or by their oscillators: detuned saws are a `supersaw`). The filters, peak equaliser, reverb, distortion and pan after the oscillators become effects (`lpf`, `resonance`, `hpf`, `bpf`, `peak`, `freeverb`, `shape`, `pan`), with their envelopes (`lpenv`, `peakenv`...); `Env.perc`, `Env.adsr`, `Env.asr` and `Env.linen` become `attack`, `hold`, `decay`, `sustainlevel` and `release`; pitch envelopes become `penv` or `pitchenv`. An argument that drives one of them becomes that control, so `\cutoff` in a Pbind becomes `.lpf()`.

Each part loops over its shortest period: its rhythm is a `struct` with weighted steps (`"x@4 x@3 x"`), and each control a mini-notation sequence over its own period. Notes on what could not be converted exactly are written at the top of the code. The test suite converts a gabber track (two SynthDefs and a Ppar of two Pbinds on a TempoClock) and checks that all 336 events of the first minute play at the same times with the same parameters as in SuperCollider.

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
  .resonance(0.174293).attack(0.01).hold(0).release(0.5)
  .fast(4)

// \kick (played at line 8): no SynthDef for it in the file, so the TidalJS synth superkick plays it.
const kick = sound("superkick")
  .legato(0.8)
  .fast(4)

stack([pluck, kick])
```

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

A manifest is a JSON object of bank names and file lists, with an optional `_base` URL (the format Strudel uses). `samples()` returns a promise; in the editor the code runs again once the samples have loaded. Files are loaded and decoded the first time they are needed.

### Streams and transitions

As in Tidal, patterns play in streams: `d1(...)` to `d16(...)`, or `p("name", ...)`. The editor shows every stream above the cycle view, with buttons to mute (M) and solo (S) it. A transition changes a stream from its previous pattern to a new one:

```javascript
d1(sound("bd*4"))                           // play this first...
xfadeIn(1, 8, sound("bd*2 [~ bd] sn ~"))    // ...then this crossfades d1 over 8 cycles
jumpMod(1, 4, sound("bd sn"))               // or switch at the next cycle divisible by 4
mute(2); solo("drums"); unmuteAll()
```

While you type, live updates keep the streams whose events did not change, so editing one line does not restart a transition in another.

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

### Output

| Function | Description |
|----------|-------------|
| `.midi(output)` | Send events to a Web MIDI output, by index or name, instead of the synths |
| `.vel()`, `.ccn()`, `.ccv()`, `.pgm()`, `.midichan()` | MIDI velocity, control change, program change and channel |
| `midiOutputs()` | Names of the available MIDI outputs |
| `.osc(address)` | Send OSC bundles (SuperDirt `/dirt/play` format) over a WebSocket |
| `setOscUrl(url)` | Address of the WebSocket-to-UDP bridge (default `ws://localhost:8080`) |
| `record()`, `stopRecording()` | Record the audio output and download it |
| `exportPattern(p, cycles, format)` | Download cycles of a pattern as `"json"` or `"midi"` |

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
| `superstatic` | Crackle | | |

`.voice()`, `.detune()`, `.semitone()`, `.rate()` and `.lfo()` change them, and `.penv()`/`.pdecay()` the pitch fall of the drums.

## Global Controls

```javascript
// Tempo
setCPS(0.8)        // Cycles per second (also Tidal's setcps)
setTempo(120)      // Beats per minute, 4 beats per cycle (also Tidal's setbpm)

// Stop everything
hush()             // or stopAll(); panic() also sends MIDI "all notes off"

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

### Importing SuperCollider code

The importer runs the language parts of a file, not the server, so:

- A SynthDef is not run: it is read as a graph and matched to a TidalJS synth with effects. Only `superhoover` and `supergabber` are the same SynthDefs; anything else (FM networks, granular synthesis, buffers, feedback, multichannel tricks) plays the closest TidalJS sound, and the comment above the part says which.
- JITLib (`Ndef`, `ProxySpace`), buffers and `PlayBuf`, MIDI, OSC, buses and groups, GUIs and `Pfx` effects are not converted (a note says so). Load sample banks with `samples()` for instruments that play recordings.
- Random values drawn in code (`rrand`, `.choose`, `.scramble`, `Array.rand`), random durations and `Pshuf` keep one fixed draw. Random values in a Pbind's other keys stay random.
- A part that never repeats (an endless `Pseries`, random durations) loops its first 16 beats; a finite pattern loops in TidalJS, as Tidal patterns do. `Pmono` plays a note per event. A synth started with `Synth(...)` that would never be released lasts until the next one.
- Values are written with six significant digits.

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
npm test           # engine tests (tidal.js), help checks (every help and editor example runs), library and SuperCollider importer tests
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
| `src/session.ts` | App state in signals, and audio control: play, stop, live update, recording. |
| `src/library.ts` | The sketch library: storage (IndexedDB or localStorage), export and import. |
| `src/supercollider/` | The SuperCollider importer: lexer and parser of sclang, an interpreter that runs patterns, routines and SynthDef graphs, the SynthDef analysis, and the writer of TidalJS code. |
| `src/engine.ts` | Loads `tidal.js` and types the parts of it the app uses. |
| `src/components/` | Top bar (with the sketch bar), insert palette, cycle view, status line, sidebar (examples, library and reference). |
| `src/editor/` | The code editor: highlighting, problem markers, autocomplete, tab stops, hover help. |
| `src/data/` | Examples, insert-palette snippets, function signatures, the extended help (`docs.ts`) and the Reference content. |
| `test/engine.test.mjs` | Engine tests, run in Node with a fake audio context. |
| `test/docs.test.mjs` | Checks the help in `src/data/docs.ts` (everything has a doc, every example runs) and plays every example of the Examples tab. |
| `test/supercollider.test.mjs` | Tests the SuperCollider importer: the language, and conversions played in the engine and compared with what SuperCollider plays. |
| `test/library.test.mjs` | Tests the sketch library: export and import files, merging, the localStorage store. |

### Areas for contribution

- A visual pattern editor: draw steps on a grid and get the mini-notation
- Recording a session (code and audio) to replay it
- A MIDI input mapped to buses (`bus()`), like Tidal's control buses
- Sharing a sketch as a link
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
