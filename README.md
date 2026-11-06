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
- **Tidal's operators**: every control is also a function (`n("0 2")`, `speed(2)`), combined with `.set()` (`#`), `.add()` (`|+`), `.sub()`, `.mul()`, `.div()`, `.mod()`; `once`, `qtrigger`
- **Streams and transitions**: `d1` to `d16` and `p("name", ...)` streams, with mute and solo buttons in the editor (and `mute`/`solo` in code); transitions between versions of a stream: `xfadeIn`, `jumpIn`, `jumpMod`, `clutchIn`, `anticipateIn`, `interpolateIn`, `wait`, `mortal`
- **Stepwise and structure**: patterns count their steps, as in Tidal: `stepcat`, `steptake`, `stepdrop`, `expand`, `contract`, `extend`, `pace`, `stepalt`, `stepzip`; `ur` song structures, `inhabit`, `weave`, `swap`, `chew`, `snowball`
- **Echoes and repeats**: `echo`, `echoWith`, `stut`, `stutter`, `plyWith`, `ghost`, `rolled`
- **Randomness and conditions**: `sometimes` and its relatives, `someCyclesBy`, `degradeBy`, `fadeIn`/`fadeOut`, `randcat`, `markovPat`, `within`, `while`, `when`, `ifp`, `foldEvery`, `inside`/`outside`, `until`, `playFor`
- **Audio effects**: filters with resonance, the DJ filter, delay (level, time and feedback, as in Tidal) and reverb per orbit, distortion and `shape`, bit crushing, `coarse`, vowel formants, tremolo, phaser, ring modulation, cut groups, `accelerate`, envelopes
- **Harmony**: notes, Tidal's 70+ scales (with the Arabic maqamat's quarter tones) and every chord of its table, arpeggios, inversions, strummed chords, `toScale`
- **Signals**: `sine`, `saw`, `tri`, `square`, `rand`, `irand`, `perlin`, bipolar `sine2` and friends, envelopes `envL`/`envEq`, `brand`, with `range`, `rangex`, `segment`, `smooth`
- **Output**: synthesised sounds, Web MIDI, OSC over WebSocket, audio recording, JSON and MIDI file export
- **Live editor** (built with [SibuJS](https://sibujs.dev/) and TypeScript): syntax highlighting, autocomplete, hover help that explains the code under the pointer (what each function, sound, scale, chord and mini-notation symbol does, with an example, a tip and related functions; the palette buttons show the same help), an insert palette for every function (Tab moves between parameters), live update while playing, a library of saved sketches (IndexedDB, or localStorage where it is not available) with export and import of `.js` and `.json` files, errors and warnings marked in the code, a cycle view of what is playing, error messages that keep the music running, seamless tempo changes, recording
- **Examples**: public-domain songs (Beethoven, Bach, Pachelbel, Grieg, Satie, traditional tunes), Christmas carols (Jingle Bells, Silent Night, Deck the Halls, We Wish You a Merry Christmas, Good King Wenceslas, Carol of the Bells), genre grooves (house, boom bap, bossa nova, jungle) and recorded samples from Dirt-Samples

```javascript
// Pattern fundamentals
sound("arpy*4").note("c e g b").up("0 12")

// Time transformations
sound("hh*8").every(4, x => x.fast(2)).sometimes(x => x.gain(0.3))

// Audio effects
sound("arpy").lpf(800).reverb(0.3).vowel("a")

// Composition
stack([
  sound("bd ~ bd ~"),
  sound("~ sn ~ sn"),
  sound("hh hh hh hh").gain(0.3)
])

// Layering
sound("bd sn").superimpose(x => x.fast(2).up(12)).overlay("hh*4")
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
const result = tidal.eval('sound("bd sn")\n\nsound("hh*4").gain(0.5)');
// { success: true, activePatterns: 2, warnings: [] }
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

Every control is also a function on its own, as in Tidal, and `.set()` is Tidal's `#`. `.add()`, `.sub()`, `.mul()`, `.div()` and `.mod()` are `|+`, `|-`, `|*`, `|/` and `|%`: the rhythm comes from the pattern on the left, and controls combine key by key (notes as semitones, strings joined).

```javascript
// d1 $ n "0 .. 7" # s "arpy" |+ n "<0 3 5>" # speed "1 2"
d1(n("0 .. 7").sound("arpy").add(n("<0 3 5>")).set(speed("1 2")))
sound("drum*4").add(s(":3"))            // drum:3
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
sound("hh hh hh hh").sometimes(x => x.gain(0.3)).rarely(x => x.rev())

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
sound("arpy").note("c e g").up("0 12 7")

// Frequency
sound("sine").freq("440 554 659")
```

Each event takes the control value that is active at its start, and events that fall on a rest in the control are dropped (like Tidal's `#`). In each cycle, whichever pattern has more steps sets the rhythm: `sound("arpy").note("c e g")` plays three notes, and a bar of rests in the note pattern is silent.

### Composition

```javascript
// Layer patterns
stack([
  sound("bd ~ bd ~"),
  sound("~ sn ~ sn"),
  sound("hh hh hh hh").gain(0.3)
])

// One pattern per cycle
cat([
  sound("bd sn"),
  sound("hh cp")
])

// Rhythm from a structure, sounds from a pattern
struct("x ~ x x", sound("bd sn"))

// Layer a transformed copy
sound("bd sn").superimpose(x => x.fast(2).up(12))
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

## API Reference

### Core functions

| Function | Description | Example |
|----------|-------------|---------|
| `sound()` | Create a sound pattern | `sound("bd sn bd sn")` |
| `stack()` | Play patterns together | `stack([sound("bd"), sound("hh")])` |
| `layer()` | Same as `stack()` | `layer([sound("bd"), sound("hh")])` |
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
| `off(t, f)` | Play f(pattern), t cycles later, on top | `.off(0.125, x => x.up(12))` |
| `every(n, f)` | Apply f on cycles 0, n, 2n... | `.every(4, x => x.fast(2))` |
| `whenmod(n, m, f)` | Apply f when cycle mod n >= m | `.whenmod(8, 6, x => x.rev())` |
| `sometimes(f)` | Apply f to 50% of events | `.sometimes(x => x.rev())` |
| `often(f)` | 75% of events | `.often(x => x.gain(0.5))` |
| `rarely(f)` | 25% of events | `.rarely(x => x.fast(2))` |
| `almostAlways(f)` | 90% of events | `.almostAlways(x => x.lpf(900))` |
| `almostNever(f)` | 10% of events | `.almostNever(x => x.crush(4))` |
| `sometimesBy(p, f)` | Apply f with probability p | `.sometimesBy(0.3, x => x.up(12))` |

### Audio effects

| Function | Description | Example |
|----------|-------------|---------|
| `gain(n)` | Volume, 0 to 2 (default 1) | `.gain(0.8)` |
| `pan(n)` | Stereo position, -1 (left) to 1 (right) | `.pan(-0.5)` |
| `lpf(freq)` | Low-pass filter | `.lpf(800)` |
| `hpf(freq)` | High-pass filter | `.hpf(200)` |
| `bpf(freq)` | Band-pass filter | `.bpf(1000)` |
| `delay(level)` | Echo level, 0 to 1 (as in Tidal); `delaytime` sets the time in seconds and `delayfeedback` the repeats | `.delay(0.5).delaytime(0.25)` |
| `reverb(amount)` | Reverb amount, 0 to 1 | `.reverb(0.3)` |
| `distortion(n)` | Distortion, 1 to 100 | `.distortion(5)` |
| `crush(bits)` | Bit crusher, 1 to 16 bits | `.crush(4)` |
| `vowel(v)` | Formant filter: a, e, i, o, u | `.vowel("a")` |

### Musical functions

| Function | Description | Example |
|----------|-------------|---------|
| `note(pattern)` | Note names or semitones from middle C | `.note("c e g")` |
| `up(pattern)` | Transpose in semitones | `.up("0 12 7")` |
| `freq(pattern)` | Frequency in Hz | `.freq("440 554")` |
| `midinote(pattern)` | MIDI note number | `.midinote("60 64 67")` |
| `n(pattern)` | Sound variation | `.n("0 1 2")` |

### Composition methods

| Function | Description | Example |
|----------|-------------|---------|
| `append(p)` | Play p in the next cycle | `sound("bd").append("sn")` |
| `overlay(p)` | Play p at the same time | `sound("bd ~").overlay("~ sn")` |
| `superimpose(f)` | Play the pattern and f(pattern) | `.superimpose(x => x.up(12))` |
| `jux(f)` / `juxBy(x, f)` | The pattern on the left, f(pattern) on the right | `.jux(x => x.rev())` |
| `euclid(k, n, r)` / `euclidInv(k, n, r)` | Play on (or off) k of n evenly spread steps | `.euclid(3, 8)` |
| `euclidFull(k, n, other, r)` | This pattern on the hits, `other` on the rests (also a global function) | `.euclidFull(3, 8, sound("hh"))` |
| `nTake(name, list)` | Each played event takes the next value of the list as `n` | `.nTake("a", [0, 2, 4])` |
| `struct(s)` | Take the rhythm from s | `sound("bd sn").struct("x x ~ x")` |

### Rearranging

| Function | Description | Example |
|----------|-------------|---------|
| `chunk(n, f)` | Apply f to one of n parts, a different one each cycle | `.chunk(4, x => x.hurry(2))` |
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
| `wchoose(pairs)` | Weighted choice when the code runs | `wchoose([["bd", 3], ["sn", 1]])` |

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
| `cutoff(hz)`, `resonance(q)` | Low-pass filter and its Q | `.cutoff(800).resonance(8)` |
| `room(x)`, `size(x)` | Reverb amount and room size | `.room(0.4).size(0.9)` |
| `orbit(n)` | Separate delay and reverb buses | `.orbit(1)` |
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

## Global Controls

```javascript
// Tempo
setCPS(0.8)        // Cycles per second
setTempo(120)      // Beats per minute (4 beats per cycle)

// Stop everything
stopAll()

// Value helpers, evaluated when the code runs
choose(["bd", "sn", "cp"])    // Random choice
cycleChoose(["a", "e", "i"])  // Choice by current cycle
```

## Mini-Notation

```javascript
sound("bd sn bd sn")      // Steps share one cycle
sound("bd ~ sn ~")        // Rests with ~
sound("bd*2 sn/2")        // Faster / slower steps
sound("bd [sn sn]")       // Subdivide a step
sound("bd <sn cp hh>")    // One choice per cycle
sound("[bd, hh hh hh]")   // Play at the same time
sound("{bd sn, hh hh hh}") // Polymeter; {a b c}%4 sets the steps per cycle
sound("bd(3,8,2)")        // Euclidean rhythm with optional rotation
sound("hh? hh?0.3")       // Random removal (50%, 30%)
sound("bd!3 sn")          // Repeat a step ("bd !" also works)
sound("bd@3 sn")          // Longer step ("bd _ _ sn" also works)
sound("[bd | sn | cp]")   // Random choice per cycle
sound("bd . hh hh")       // Group steps
sound("arpy*8").note("0 .. 7") // Range: the steps 0 1 2 3 4 5 6 7 (also "7 .. 0", "0..7")
sound("bd:3")             // Sound variation, same as .n(3)
sound("arpy").note("c'maj e'min7'i") // Chords: 'i inverts, 'o opens, '5 sets the note count
```

## Development Status

All six roadmap phases are implemented: core functions, advanced mini-notation and transformations, sample-style controls, harmony, signals, conditional patterns, MIDI, OSC, recording and export.

Some things work differently from TidalCycles because TidalJS runs in a browser:
- Sounds are synthesised, so `chop`, `striate`, `begin` and `end` slice the synthesised sound rather than an audio file.
- Browsers cannot send UDP, so OSC needs a WebSocket bridge.
- `while` and `export` are JavaScript keywords: `while` is only a method, and export is `exportPattern()`.

See the [roadmap](ROADMAP.md) for details and ideas for what comes next.

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
npm test           # engine tests (tidal.js), help checks (every example runs) and library tests
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
| `src/engine.ts` | Loads `tidal.js` and types the parts of it the app uses. |
| `src/components/` | Top bar, insert palette, cycle view, status line, sidebar (examples and reference). |
| `src/editor/` | The code editor: highlighting, problem markers, autocomplete, tab stops, hover help. |
| `src/data/` | Examples, insert-palette snippets, function signatures, the extended help (`docs.ts`) and the Reference content. |
| `test/engine.test.mjs` | Engine tests, run in Node with a fake audio context. |
| `test/docs.test.mjs` | Checks the help in `src/data/docs.ts`: everything has a doc, and every example runs. |
| `test/library.test.mjs` | Tests the sketch library: export and import files, merging, the localStorage store. |

### Areas for contribution

- Loading real samples (audio files)
- More of Tidal's library (`jux`, `off`, `ply`, `iter`...)
- Documentation and tutorials
- Performance optimisations
- Mobile compatibility
- Visual pattern editors

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
