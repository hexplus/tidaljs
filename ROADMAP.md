# TidalJS Development Roadmap

All phases are implemented. Each section lists the functions and how they behave. Notes mark where TidalJS differs from TidalCycles, usually because it runs in a browser and synthesises its sounds instead of playing samples.

---

## Phase 1: Core Functions (complete)

### 1.1 Pattern Fundamentals (6/6)
```javascript
sound()     // [done] Basic patterns
n()         // [done] Sound variation numbers
note()      // [done] Musical notes (names or semitones from middle C)
up()        // [done] Transposition
freq()      // [done] Direct frequency
midinote()  // [done] MIDI notes
```

### 1.2 Essential Time Transformations (11/11)
```javascript
fast()      // [done] Repeat the pattern n times per cycle
slow()      // [done] Stretch the pattern over n cycles
rev()       // [done] Reverse each cycle
density()   // [done] Same as fast()
every()     // [done] Apply on cycles 0, n, 2n...
sometimes() // [done] Apply to 50% of events
often()     // [done] 75%
rarely()    // [done] 25%
almostNever() // [done] 10%
almostAlways() // [done] 90%
whenmod()   // [done] Apply when cycle mod n >= m
```

### 1.3 Basic Audio Effects (10/10)
```javascript
gain()      // [done] Volume control
pan()       // [done] Stereo panning
lpf()       // [done] Low-pass filter
hpf()       // [done] High-pass filter
bpf()       // [done] Band-pass filter
delay()     // [done] Delay/echo
reverb()    // [done] Reverb
distortion() // [done] Distortion
crush()     // [done] Bit crushing
vowel()     // [done] Vowel filters (a, e, i, o, u)
```

### 1.4 Advanced Composition (7/7)
```javascript
stack()     // [done] Layer patterns
struct()    // [done] Apply rhythmic structure
cat()       // [done] One pattern per cycle
append()    // [done] Add a pattern in the next cycle
superimpose() // [done] Layer with transformation
layer()     // [done] Multiple layers (alias of stack)
overlay()   // [done] Overlay patterns simultaneously
```

### Phase 1 audit (November 2026)

The Phase 1 functions existed, but several did not behave like Tidal. The engine was rebuilt around Tidal's model, in which a pattern is a function of cyclic time, and the following were fixed:

- `fast()` and `density()` squeezed the pattern into the start of the cycle instead of repeating it.
- `every()`, `sometimes()` and `whenmod()` transformed each event on its own, so `every(4, x => x.fast(2))` did not double the pattern. Chaining two of them also overwrote the first.
- `whenmod(n, m, f)` now applies when `cycle mod n >= m`, as in Tidal. Before, it only matched `== m`.
- `cat()` squeezed all patterns into one cycle. It now plays one pattern per cycle, as in Tidal; `fastcat()` keeps the squeezing behaviour.
- `rev()` broke patterns longer than one cycle.
- `superimpose()` applied transformations twice.
- `stack()`, `cat()` and `layer()` ignored patterns passed as separate arguments.
- Note names were an octave low (`c` was MIDI 48 instead of 60).
- The `saw` synth played a sine wave.
- `delay()` and `reverb()` were cut off by the note envelope, so they were almost inaudible.
- `gain(0)` played at full volume, and gains above 1 were clamped.
- The scheduler could play a cycle twice when a timer fired early, and tempo changes made the playhead jump.
- Variables did not persist between statements in the editor, and errors were never shown in the UI.
- `setCPS()` accepted `NaN`, which stopped all timing.

---

## Phase 2: Intermediate Functions (complete)

### 2.1 Advanced Mini-Notation
```javascript
[bd sn]     // [done] Subdivisions
<bd sn>     // [done] Pattern rotation (one per cycle)
{bd sn, cp} // [done] Polymetric patterns ({a b c}%4 sets the steps)
bd?         // [done] 50% probability (bd?0.3 for 30%)
bd:2        // [done] Specific sample variation
[bd!3 sn]   // [done] Repetition with ! (also "bd !")
(3,8)       // [done] Euclidean rhythms, with optional rotation (3,8,2)
```
Also: `bd/2`, `bd@3` and `bd _ _` (longer steps), `[bd, hh]` (stacks), `[bd | sn]` (random choice) and `bd . hh hh` (groups).

### 2.2 Complex Transformations
```javascript
chunk()     // [done] Apply a function to one part per cycle, in turn
chop()      // [done] Cut each sound into parts
striate()   // [done] Interleave slices of sounds
scramble()  // [done] Random parts, with repeats
shuffle()   // [done] Random order of parts
palindrome() // [done] Forwards, then backwards
swing()     // [done] Swing timing (and swingBy(x, n))
compress()  // [done] Squeeze into part of the cycle
stretch()   // [done] Zoom each cycle to fill it with its events
```
Note: TidalJS synthesises its sounds, so `chop()` and `striate()` slice the synthesised sound (its envelope and pitch sweep) rather than a sample file.

### 2.3 Advanced Effects
```javascript
cutoff()    // [done] Alias of lpf()
resonance() // [done] Low-pass filter Q
attack()    // [done] Fade-in time in seconds
release()   // [done] Fade-out time in seconds
room()      // [done] Alias of reverb()
size()      // [done] Reverb room size, 0 to 1
orbit()     // [done] Separate delay and reverb buses per orbit
```

### 2.4 Control Functions
```javascript
degradeBy() // [done] Remove events with a probability
degrade()   // [done] Remove half of the events
hurry()     // [done] fast() plus higher speed
sparsity()  // [done] Alias of slow(), as in Tidal
```
Also: `unDegradeBy()`.

---

## Phase 3: Creative Functions (complete)

### 3.1 Sample Manipulation
```javascript
speed()     // [done] Playback speed (and pitch)
begin()     // [done] Start point, 0 to 1
end()       // [done] End point, 0 to 1
loop()      // [done] Repeat the sound n times
legato()    // [done] Length relative to the event
sustain()   // [done] Length in seconds
```
Note: these act on the synthesised voices. Drums are cut short by `legato`/`sustain`; synths (`sine`, `saw`, `square`, `tri`, `noise`, `pink`) hold for that long.

### 3.2 Selection Functions
```javascript
choose()    // [done] Choose randomly
cycleChoose() // [done] Choose by cycle
wchoose()   // [done] Weighted choice: wchoose([["bd", 3], ["sn", 1]])
randcat()   // [done] A random pattern each cycle
```
Note: `choose`, `cycleChoose` and `wchoose` pick when the code runs. For values that change over time, use the `rand`, `irand` and `perlin` signals, `randcat()` or `"[a | b]"`.

### 3.3 Scales and Harmony
```javascript
scale()     // [done] scale("e:minor", "0 2 4")
scaleP()    // [removed in Phase 13: use scale()] Alias of scale(); the scale name can be a pattern: "<major minor>"
chord()     // [done] chord("c'maj e'min7"); chords also work inside note("...")
arpeggiate() // [done] .arp("up") / .arpeggiate("updown"), the mode can be a pattern
inversion() // [done] .inversion(1), or "c'maj'i" in chord names
```
Chord modifiers: a number sets the note count (`c'maj'5`), `i` inverts (`'ii'` twice), `o` opens the voicing, `d1` drops the top note an octave.

---

## Phase 4: Technical Functions (complete)

### 4.1 Synthesis and Generation
```javascript
sine()      // [done] sound("sine")
saw()       // [done] sound("saw")
square()    // [done] sound("square")
tri()       // [done] sound("tri")
noise()     // [done] sound("noise"), white noise
pink()      // [done] sound("pink"), pink noise
```

### 4.2 Mathematical Functions
```javascript
range()     // [done] .range(lo, hi)
smooth()    // [done] Glide between the values of a numeric pattern
quantise()  // [done] Round values (also quantize())
irand()     // [done] irand(8): random integers
rand()      // [done] rand: random floats
perlin()    // [done] perlin: smooth random values
sine()      // [done] sine signal, 0 to 1 per cycle
cosine()    // [done] cosine signal
```
Also `saw`, `isaw`, `tri` and `square` signals. Signals are values, not functions: `.lpf(sine.range(200, 2000).slow(4))`. Use `.segment(n)` to turn a signal into n events per cycle.

### 4.3 Tempo Functions
```javascript
setcps()    // [done] Set cycles per second
nudge()     // [done] Shift events in time, in seconds
swing()     // [done] Swing amount (see 2.2)
```

---

## Phase 5: Advanced Functions (complete)

### 5.1 Conditional Patterns
```javascript
while()     // [done] .while("1 0", f): apply f where the pattern is true
until()     // [done] .until(n, f): apply f until cycle n
within()    // [done] .within(0, 0.5, f) or .within([0, 0.5], f)
playFor()   // [done] .playFor(a, b): only play between cycles a and b
stopFor()   // [done] .stopFor(a, b): silent between cycles a and b
```
Note: `while` is a JavaScript keyword, so it is only available as a method. `until()` and `stopFor()` are TidalJS additions.

### 5.2 Analysis Functions
```javascript
fit()       // [done] fit(step, list, "0 1 2"): pick from a list, shifting each cycle
fitment()   // [done] .fitment(n, "0 2 1 3"): play slices of each cycle in a given order (also bite())
segment()   // [done] .segment(n): sample a pattern or signal n times per cycle
```

### 5.3 I/O Functions
```javascript
ccv()       // [done] Control change value
ccn()       // [done] Control change number
pgm()       // [done] Program change
vel()       // [done] MIDI velocity (0 to 1, or 0 to 127)
```
Also `midichan()`. These are sent when a pattern uses `.midi()`.

---

## Phase 6: System and Hardware (complete)

### 6.1 Routing and Mixing
```javascript
orbit()     // [done] Separate effect buses per orbit
setBus()    // [done] setBus("cut", 800) with .lpf(bus("cut"))
```

### 6.2 MIDI and OSC
```javascript
midi()      // [done] .midi(output) sends notes to Web MIDI (index or name)
osc()       // [done] .osc() sends OSC bundles over a WebSocket
```
Notes: Web MIDI needs a browser that supports it (Chrome, Edge, Firefox) and the user's permission. Browsers cannot send UDP, so OSC goes to a WebSocket-to-UDP bridge (for example osc-web or osc.js) at `setOscUrl(url)`, `ws://localhost:8080` by default. Messages use SuperDirt's `/dirt/play` format.

### 6.3 Recording and Export
```javascript
record()    // [done] record() / stopRecording(): saves the audio as WebM or Ogg
export()    // [done] exportPattern(pattern, cycles, "json" | "midi")
```
Note: `export` is a JavaScript keyword, so the function is called `exportPattern()`. The MIDI export writes a Standard MIDI File, with drums on channel 10.

---

## Phase Summary

| Phase | Functions | Status |
|-------|-----------|--------|
| Phase 1: Core | 34 | Complete |
| Phase 2: Intermediate | 27 | Complete |
| Phase 3: Creative | 15 | Complete |
| Phase 4: Technical | 17 | Complete |
| Phase 5: Advanced | 12 | Complete |
| Phase 6: System | 6 | Complete |
| Phase 7: Samples and more of Tidal | 15 | Complete |
| Phase 8: The rest of Tidal's library | 120+ | Complete (see the notes) |
| Phase 9: Streams, transitions, stepwise | 40+ | Complete |
| Phase 10: Library, export and import | - | Complete |
| Phase 11: SuperDirt's synths and effects | - | Complete |
| Phase 12: Parity with Tidal | ~60 fixes | Complete |
| Phase 13: Deprecated names out, complex examples in | 7 removed | Complete |
| Phase 14: SuperCollider import | - | Complete |

---

## Phase 7: Samples and more of Tidal (complete)

### 7.1 Real samples
```javascript
samples()   // [done] samples("github:tidalcycles/dirt-samples"), a strudel.json URL, or { name: [files] }
```
A loaded bank replaces the synthesised sound of the same name; `n` (or `"bd:3"`) picks the file. `speed` (negative plays backwards), `note`/`up`, `begin`/`end`, `chop`, `striate`, `loop`, `legato`/`sustain`, `attack`/`release` and every effect work on the recordings. Files are fetched and decoded the first time they are needed; the editor runs the code again once a `samples()` call has loaded.

### 7.2 Patterned arguments
```javascript
.fast("<1 2>")        // [done] also slow, density, sparsity, hurry, late, early, every,
.ply("1 2")           //        degradeBy, chop, striate, segment, swing, ply, iter, linger, rot, off
```
As in Tidal, each value applies over the part of the cycle where it holds; signals work too (sampled once per cycle).

### 7.3 Ranges in mini-notation
```javascript
"0 .. 7"    // [done] the steps 0 1 2 3 4 5 6 7; also "7 .. 0" and "0..7"
```

### 7.4 More of Tidal's library
```javascript
jux()       // [done] the pattern left, f(pattern) right (and juxBy)
off()       // [done] a shifted, changed copy on top
ply()       // [done] repeat each event n times
iter()      // [done] start each cycle one nth further on (and iterBack)
linger()    // [done] repeat the first (or last) part of each cycle
rot()       // [done] shift values along the events, keeping the rhythm
euclid()    // [done] Euclidean rhythm as a method (and euclidInv)
euclidFull() // [done] one pattern on the hits, another on the rests
nTake()     // [done] each played event takes the next value of a list as n
```
Note: "nT functions" is read as Tidal's `nTake`, which steps through a list across cycles.

### 7.5 Tests in CI
```text
.github/workflows/ci.yml   // [done] engine tests, type-check and build, SibuJS lint, on Node 22 and 24, for every push and pull request
```

## Phase 8: The rest of Tidal's library (complete)

Compared function by function with Tidal's source (`tidal-core`: Core, UI, Control, Chords, Scales, Params).

### 8.1 Operators and control patterns
```javascript
n("0 2") speed(2) ...   // [done] every control is also a function, as in Tidal
.set()                  // [done] Tidal's # (structure from the left)
.add() .sub() .mul()    // [done] |+ |- |* (and .div() .mod() .pow()); notes add as semitones, strings join
d1() ... d16()          // [done] return the pattern; every top-level pattern plays
once() qtrigger() trigger() // [done]
```

### 8.2 Structure, time and conditions
```javascript
brak mask inv sew stitch wedge euclidOff zoom fastGap trunc repeatCycles loopFirst
press pressBy plyWith rolled rolledBy when ifp foldEvery someCyclesBy always never
inside outside chunkBack (removed in Phase 13: chunk(-n)) fix unfix contrast spread fastspread spreadChoose pickF selectF
select squeeze soak fadeIn fadeOut stripe       // [done]
```

### 8.3 Echoes, samples, values and generators
```javascript
echo echoWith stut stutWith stutter ghost ghostWith                 // [done; stut and stutWith removed in Phase 13]
slice splice randslice loopAt smash spin striateBy                  // [done]
rangex qfloor qceiling qround toScale run scan                      // [done]
fromList fastFromList fromMaybes timeCat wrandcat binary binaryN ascii necklace
brand brandBy chooseBy wchooseBy markovPat lindenmayer              // [done]
sine2 cosine2 saw2 isaw2 tri2 square2 envL envLR envEq envEqR       // [done]
```

### 8.4 Mini-notation, harmony and parameters
- Patterned modifiers: `"bd*<2 3>"`, `"bd/[1 2]"`, `"bd(<3 5>,8,<0 2>)"`.
- Patterned arguments for `euclid`, `chunk`, `swingBy`, `scramble`, `shuffle`.
- Tidal's full scale table (70 scales, including microtonal maqamat) and chord table (every alias), and the `pinkyupdown` and `thumbupdown` arpeggios.
- `n` accepts note names (`n("c e g")`).
- Parameters: `delay` is now the echo level, as in Tidal, with `delaytime`, `delayfeedback` and `lock`; `shape`, `distort`, `coarse` (samples), `cut`, `accelerate`, `djf`, `hpq`, `bpq`, `lpq`, `amp`, `octave`, `unit`, tremolo, phaser, ring modulation, and the short aliases (`sz`, `ctf`, `dfb`, `sus`, `att`, `rel`...).

### Not included, and why
- `interlace` (deprecated in Tidal), `weaveWith`, `nrpn`, and the stepwise functions Tidal itself has commented out (`s_while`, `s_nth`, `s_taper`...).
- `histpan`, `waitT`, `jumpIn'` (the variants of transitions with Haskell-only names); `jumpMod` covers switching on a cycle boundary.
- SuperCollider-only effects (`squiz`, `krush`, `triode`, `leslie`, `waveloss`, spectral effects such as `binshift` and `freeze`) and the control buses (`in0`..`in127`, `*bus`, `*recv`): they need SuperDirt.
- Pattern internals (`Sound.Tidal.Pattern`: `withQueryTime`, `filterValues`...): JavaScript code can use `.query()` and `.withValue()` instead.

## Phase 9: Streams, transitions, stepwise (complete)

### 9.1 Streams, mute and solo
```javascript
d1(p) ... d16(p)   // [done] named streams, as Tidal's d1 $
p("name", p)       // [done] Tidal's p "name" $
mute(1) unmute(1) solo(1) unsolo(1) unmuteAll() unsoloAll()   // [done]
```
The editor lists the playing streams above the cycle view, with mute (M) and solo (S) buttons. Patterns without a stream are #1, #2... Live updates keep the streams whose events did not change.

### 9.2 Transitions
```javascript
xfade xfadeIn jump jumpIn jumpMod clutch clutchIn anticipate anticipateIn
interpolate interpolateIn wait mortal   // [done]
```
Each runs from the stream's previous pattern, from the cycle where the code is evaluated.

### 9.3 Stepwise (Sound.Tidal.Stepwise)
```javascript
stepcat s_cat steptake stepdrop expand contract extend pace stepalt stepzip .steps()   // [done]
```
Patterns count their steps as Tidal 1.10 does: a mini-notation sequence has as many steps as its weights add up to, `<a b>` has 2 and `{a b c}%4` has 3 (see Phase 12), `stack` takes the least common multiple and `fastcat` the sum.

### 9.4 More of Tidal
```javascript
ur inhabit weave swap snowball chew arpg   // [done]
```

### 9.5 Pitched sample banks
```javascript
samples("github:felixroos/dough-samples/piano.json")   // [done] { piano: { C4: "...", Ds4: "..." } }
sound("piano").note("c e g")                           //        nearest recording, tuned
```
`github:user/repo/file.json` loads a manifest other than strudel.json.

## Phase 10: Library, export and import (complete)

The Library tab keeps sketches in the browser: IndexedDB, or localStorage where IndexedDB is not available (sketches saved in localStorage move to IndexedDB once it works; if neither is allowed they last until the page closes, and the tab says so).

- Save the editor's code with a title (Ctrl+S); "Save changes" updates the open sketch, "Save as new" makes a copy. Each sketch keeps its tempo.
- Open, rename (click the title), export or delete each sketch.
- Export the editor's code as a `.js` file, or every sketch as one `.json` library.
- Import a `.js`/`.txt` file (opens it in the editor) or a library `.json` (adds its sketches without overwriting saved ones), with the Import button or by dropping the file on the tab.

## Phase 11: SuperDirt's synths and effects, and the last of Tidal (complete)

What a track written for SuperCollider and SuperDirt needed and TidalJS lacked. The test case was a SuperCollider gabber track (a pitch-swept, distorted kick and a hoover), which now converts almost line for line (see `track.js`).

### 11.1 Operators: where the rhythm comes from
```javascript
.keep()                                  // [done] Tidal's |<
.addRight() .addBoth() .addSqueeze()     // [done] Tidal's +|, |+| and ||+
// and the same for set, keep, sub, mul, div, mod and pow (Tidal's >|, |<|, ||- ...)
```
`Right` takes the rhythm from the other pattern, `Both` from both (an event starts wherever either does), `Squeeze` fits a whole cycle of the other pattern into each event.

### 11.2 The rest of Tidal's library
```javascript
.everyOffset(n, o, f)        // [done] Tidal's every'
.withinZoom(b, e, f)         // [done] Tidal's within'
toScaleBy(octave, steps, p)  // [done] Tidal's toScale'
.fitSlices(cyc, n, from, to) // [done] Tidal's fit'
.substruct() .whenT() .fastAppend() .slowAppend() .jux4() .juxcut() .spreadf()   // [done]
.fastSqueeze() .slowSqueeze() .mono() .timeLoop()                                // [done]
sig() perlinWith() perlin2() perlin2With() interlace() seqP() seqPLoop() resetCycles()   // [done]
.nrpn("param:value") .nrpnn() .nrpnv()   // [done] MIDI NRPN
```
JavaScript names cannot contain `'`, so the primed functions have names of their own. `numerals`, listed earlier as missing, is left out: it could not be confirmed as a Tidal pattern function.

### 11.3 Synths in the style of SuperDirt
```javascript
supersaw supersquare superpwm superhoover superreese superzow superchip superfm
superpiano supergong superstatic superkick super808 supergabber superhat supersnare superclap   // [done]
.voice() .detune() .semitone() .rate() .lfo()   // [done] their parameters
```
They are Web Audio versions, not ports of the SuperCollider code, except `superhoover` and `supergabber`, which follow Nathan Ho's SynthDefs (the hoover's pitch scoop and the gabber's fall, distortion and chorused high band) and keep SuperCollider's internal levels relative to each other.

### 11.4 Envelopes and pitch
```javascript
.hold() .decay() .sustainlevel()                 // [done] SuperDirt's hold; decay to a level
.penv() .pattack() .pdecay() .pcurve()           // [done] pitch envelope; drum synths use it for their sweep
.pitchenv([levels], [times], curves)             // [done] breakpoints, as SuperCollider's Env (same curve formula)
.lpenv() .lpattack() .lpdecay() .lpsustain() .lprelease()   // [done] and hp..., bp..., peak...
.vib() .vibmod() .portamento()                   // [done]
.accelerate()                                    // [done] now on every sound, drums included
```
Pitch changes act on the detune of a voice's oscillators, so they add up: accelerate, the pitch envelope, vibrato and portamento together.

### 11.5 Effects
```javascript
.peak() .peakq() .peakgain()                     // [done] peak equaliser (SuperCollider's BPeakEQ)
.squiz() .waveloss() .fshift() .fshiftnote() .fshiftphase() .octer() .octersub() .octersubsub()   // [done] AudioWorklet
.krush() .kcutoff() .triode() .leslie() .lrate() .lsize()   // [done]
.freeze() .comb() .smear() .scram() .binshift() .hbrick() .lbrick()   // [done] spectral, AudioWorklet
```
- Effects run in SuperDirt's order: vowel, shape, hpf, bpf, crush, lpf, peak, tremolo, phaser, waveloss, squiz, fshift, triode, krush, octer, ring, distortion, spectral, djf, leslie, pan. `shape` and `crush` used to come after the filters.
- The sample-by-sample effects run in an AudioWorklet loaded by `init()`; where AudioWorklet is missing they are skipped with a warning.
- The spectral effects work on a 512-sample window; voices that use them start 384 samples (about 9 ms) earlier, so they stay in time.
- Negative cut groups cut only the same sound, as in SuperDirt (`juxcut` uses them).

### 11.6 Matching the SuperCollider track exactly
```javascript
.freeverb() .freeroom() .freedamp()   // [done] SuperCollider's FreeVerb2 (Jezar's Freeverb, SuperCollider's constants) on each voice
.resonance(Math.log10(1 / 2) / 3)     // [done] below 0 damps: SuperCollider's rq 2 (resonance is SuperDirt's 0..1, Phase 12)
setOutput(1, false)                   // [done] no master volume or limiter, as SuperCollider
```
- `superhoover` has its SynthDef's reverb and both envelopes in order: `Env.asr(0.01, 1, 1)`, FreeVerb2, then `Env.asr(0, 1, 4, 6)`, so the reverb rings on for 4 seconds.
- `superhoover` and `supergabber` keep SuperCollider's levels: `amp` works as in SuperCollider, 0.1 by default.
- Their envelopes follow `Env.asr`'s curves (-4, and 6 for the hoover's release).
- Fixed: weighted steps (`"a@4 b@4 c@4 d@4 ..."`) lost or repeated steps from the second cycle on, by a rounding error in `compress`.
- What cannot be matched (oscillator and filter designs, delay interpolation, random values) is listed under Limitations in the README.

## Phase 12: Parity with Tidal (complete)

Every feature was compared with Tidal's Haskell source (tidal-core: Core, UI, Control, Pattern, ParseBP, Chords, Scales, Stepwise, Transition) and with SuperDirt for what controls do when they play. About 60 differences were found and fixed; the "Parity with Tidal" tests in `test/engine.test.mjs` check them.

### 12.1 Randomness
- Tidal's random numbers exactly (`timeToRand`, `timeToRands`: an xorshift over a 300-cycle loop; 0.5 at time 0), on one stream: `degradeBy` and `unDegradeBy` are complementary, `sometimesBy` picks events before changing them (`sometimesByAfter` is Tidal's `sometimesBy'`), mini-notation `?` and `|` seed from 0 in each string.
- `choose`, `wchoose` are signals and `cycleChoose` one value per cycle; `randcat` shifts by a random number of cycles; `shuffle` is Tidal's `randrun`; `select` is `floor(x * (n - 1))`; `chooseBy` wraps; `stripe` weighs segments 1, 2 or 3; numeric arguments given a signal are read at each event; `irand`, `brandBy` and `sometimesBy` take patterns.

### 12.2 Structure
- `euclid` squeezes the pattern into each hit; `swingBy` is `inside n (within (0.5, 1) (x ~>))`; `foldEvery` nests `every`; `iter`, `iterBack` and `chunk` are `cat`s of the variants; `echoWith` shifts then applies; `mono` lets the shorter of two simultaneous events win; `arp` and `rolled` keep the chord's order; `disconverge` ends on the first note; `ply` takes fractions; `plyWith` arpeggiates; `squeeze` focuses a cycle over long events; `ur` effects restart the pattern; `weave` shifts earlier (and `weaveWith`); `binary`/`ascii` squeeze per value; `quantise(n)` rounds halves to even; `linger` is Tidal's zoom; negative `fast`/`slow` reverse; `every(0)` does nothing; negative `chunk` goes backwards; `layer` applies functions; `range`, `whenmod`, `wedge`, `fit`, `echo` and `scan` take patterns.

### 12.3 Mini-notation
- Weights count inside `< >` and `{ }` (`{ }`'s base is the first part's weight sum; `%` can be a pattern); `a .. b` is one step (note names and fractions too); spaced `!n` and `@n`; chords keep Tidal's list order (`'i`, `'o`, `'d` are positional, `'oo` works, unknown names play the root); chord names and roots can be patterns (`c'<maj min>`, `<c e>'maj`); euclid arguments can be sequences; fractions (`1%3`) and ratio letters (`q`, `e`...); `-` is a rest; `^name` reads a bus; steps as Tidal 1.10 counts them (`<a b c>` 3, `{a b c}%4` 3, euclid n, silence 1).

### 12.4 Controls and SuperDirt playback
- `gain` is amp * gain^4; `up` is `note`; a bare number in an operator is `n` (whole) or `speed` (fraction) and strings are not joined; `n` is a synth's note; `resonance`/`hpq` 0 to 1 as SuperDirt (`rq = 1000^-r`); `bandq` 10 by default with make-up gain; `djf` 20 Hz to 10 kHz on both filters; `crush` takes fractions; `coarse` on every sound; samples: `octave`, reversed `[begin, end]`, `loop` loops (fractions too), cut groups by `|cut|` with negative ones cutting the same sample, `unit "rate"`.
- Delay and reverb are global per orbit, fed by every sound of the orbit and set by each event (`delay` 0 when absent, `delaytime`/`delayfeedback`/`room`/`size`/`dry` when present; defaults 0, 0, 0, 0.1, 0); the reverb's `dry` is new.
- `chop` and `striate` slice within the event's own begin and end (`chop` only when it has both, and through events longer than a cycle); scales `bartok` and `hindu`; an unknown scale plays its degrees as octaves.

### 12.5 Streams, transitions and stepwise
- Transitions are Tidal's (`_wash`): a new or stopped stream transitions from silence; `wait` starts at `nextSam (now + t - 1)`; `anticipateIn` stutters with a step time falling from 1 to 0; `jumpMod` waits for the next multiple after this cycle; `interpolateIn` keeps controls only the old pattern has; `xfadeIn` keeps the old pattern at gain 0.
- New: `jumpInNext` (`jumpIn'`), `jumpModOffset` (`jumpMod'`), `wash` and `washIn` (removed in Phase 13), `waitT`, `histpan`; `first`, `once` (a random cycle), `asap`, `only`, `panic`, `setbpm`, `getcps`, `getnow`, `setCycle`; `triggerWith`, `ctrigger`, `rtrigger`, `ftrigger`, `mtrigger`/`mt`; the `cps` control; a `*Take` for every numeric control.
- Mute and solo follow Tidal (with any solo, soloed streams play, muted or not).
- Stepwise functions given a pattern use Tidal's `stepJoin`; `steptake` past the end zooms on, and 0 steps take no time in `stepcat`; `chop`, `zoom` and `segment` set steps.
- Found and fixed along the way: `compress` lost or repeated steps of `@`-weighted sequences from the second cycle on (a rounding error).

## Phase 13: Deprecated names out, complex examples in (complete)

Checked against Tidal's source (its `DEPRECATED` notes, and what `Sound.Tidal.Boot` exports) and the official documentation at tidalcycles.org.

### 13.1 Removed, as Tidal deprecated them
| Removed | Use instead | Tidal's note |
|---------|-------------|--------------|
| `.stut(n, fb, t)` | `.echo(n, t, fb)` | "DEPRECATED, use 'echo' instead" |
| `.stutWith(n, t, f)` | `.echoWith(n, t, f)` | "DEPRECATED, use 'echoWith' instead" (`stut'` too) |
| `.discretise(n)` | `.segment(n)` | "the old (deprecated) name for 'segment'" |
| `.chunkBack(n, f)` (Tidal's `chunk'`) | `.chunk(-n, f)` | "DEPRECATED, use 'chunk' with negative numbers instead" |
| `wash()`, `washIn()` | `xfadeIn`, `anticipateIn` and the other transitions | "Deprecated aliases", hidden by `Sound.Tidal.Boot` |
| `scaleP()` | `scale()`, whose name can be a pattern | Tidal 0.9's name, gone since Tidal 1.0 |

`anticipateIn` still uses Tidal's stut inside, as Tidal does.

### 13.2 Fixed
- `superhat` was about 25 dB too quiet: only the faint upper harmonics of its square waves pass its filters, and the sum is now boosted to the level of `hh`.
- When a control pattern sets the rhythm (`sound("superfm").note("c2 [~ c2] eb2")`), the steps now come from it too, so `pace`, `stepcat` and the other stepwise functions count the notes.
- The help no longer holds two versions of 48 entries (the Tidal-parity rewrites had been added as overrides).

### 13.3 Complex examples
- The Examples tab has an **Advanced** group: rave (SuperDirt's synths, chord patterns, a delay on its own orbit), polymetric techno (`{ }%16`, `stepcat`, `steptake`, `pace`), trance (a gated supersaw, `arp` over eight-note chords), generative ambient (Tidal's random numbers, `rolledBy`, `freeverb`), drum and bass (`bite`, negative `chunk`, `linger`, filter envelopes), chiptune (`c'<maj min>`, `addSqueeze`, `echoWith`, `rot`), gabber (patterned `penv`, peak envelopes, euclid with a patterned rotation) and an arrangement made with `ur`, `layer` and `fix`.
- The README has a "Complex examples" section: trance, drum and bass, polymetric techno, generative ambient, an arrangement with `ur`, and a live set with streams and transitions.

### 13.4 Documentation review
- README: removed contribution ideas that are done (samples, `jux`/`off`/`ply`/`iter`); the API tables, features and global controls now describe SuperDirt's semantics (`gain` curve, per-orbit delay and reverb, `n` on synths, negative `chunk`), the newer stream functions, `hush`/`setOutput`, and the mini-notation's `<a@3 b>`, `%<4 8>` and `^name`; the choose example plays sounds.
- In the editor: the hover signatures, palette buttons and Reference panel said `up` transposes, `delayfeedback` defaults to 0.5 and `lpq` is a Q; they now match the engine (`up` is `note`, feedback starts at 0, `lpq` is 0 to 1), and describe the orbit's delay and reverb.
- `npm test` now plays every editor example, as it already did with the help examples.

## Phase 14: SuperCollider import (complete)

Open a SuperCollider file (`.scd`) in the editor and get TidalJS code (Sketches → Import SuperCollider, the Library's Import .scd button, or a dropped file). The importer lives in `src/supercollider/`:

- `lexer.ts`, `parser.ts`: sclang's syntax (no operator precedence, `Class(args)`, keyword arguments, `*[...]`, trailing function blocks, events, ranges, `#[...]`, symbols, radix and `pi` numbers).
- `interpreter.ts`: runs the program's language parts: numbers and arrays (sclang's methods and broadcasting), scales, envelopes, functions, `Pdef`/`Pbindef` (the last definition wins), routines on a virtual clock (`wait`), `Synth(...)`, events and the clocks.
- `patterns.ts`: SuperCollider's patterns as generators, with SuperCollider's `embedInStream` semantics (Pkey, Pchain, Ppar's merged times). Random value patterns stay symbolic and become TidalJS random signals.
- `synthdef.ts`: a SynthDef's function runs with symbolic signals; the analysis walks from `Out` through the effects to the oscillators and finds the TidalJS synth, its effects and envelopes, and which control each argument drives.
- `emit.ts`: plays everything for 512 beats, groups the events by Pbind (or routine instrument), finds each part's period and writes it: a weighted `struct`, each control over its own period, the SynthDef's effects; one cycle is the period most parts share.
- `budget.ts`, `worker.ts`, `client.ts`: every phase (lexing, parsing, running the program, pattern steps, playing, finding loops) counts its work against one budget with a time limit, and code that would hang sclang (an empty pattern repeated forever, a routine loop that never waits, events of no length) stops there with a note; the editor converts in a worker that is ended when the import is cancelled or takes longer than 30 seconds.
- Each part keeps when it starts and stops (`playFor`, `stopFor`, `late`; a whole piece that ends loops as an explicit `timeLoop` preview), each playback (each `.play`: a pattern played, stopped and played again, a routine's and a `Pdef`'s again, `x.resume`) is a source of its own with its own start and end, except the playbacks of one pattern a routine starts again and again, which are one part whose loop holds the gaps; starts and stops on every clock (`TempoClock`, `quant`, a routine on another clock, a pattern a routine plays on the default clock) are put on one timeline, a `Ppar`'s pattern has its own lifetime, only a stream that really ended (ran out, or `.stop`) has an end and one cut at the 512 beats or 6000 events followed plays on, each note keeps its sustain whatever its step's width (`timingOffset`), synths started at the same instant are voices of their own (`stack`), events that take turns between SynthDefs are one part per SynthDef, the tempo is kept within what `setTempo`/`setCPS` accept, bindings never take a reserved word or a TidalJS global, comments cannot break out of `//`, and the code is checked to parse.

`test/supercollider.test.mjs` checks the language, the detection of `.scd` files, and conversions played in the engine: the gabber track's 336 events in 64 seconds (times, notes, peak frequencies, pitch falls, lengths, levels), degrees and scales, rests and random values, sections, routines, Ppar on a TempoClock, Ptpar, chains, chords, SuperDirt events, filter envelopes, and the README's example; the fixtures in `test/fixtures/supercollider/` check playbacks (stopped and played again, stopped and played again forever, overlapping, on a second clock stopped from the main one) in windows hundreds of beats past the 512 the importer follows.

## Phase 15: Sharing a song as a link (complete)

Sketches → Share as a link… copies a link with the song's code, title and tempo in its fragment (`#song=1.d.<base64url deflate>`), so nothing is uploaded. A link is untrusted input, and its code is JavaScript that would run in the page:

- `src/share.ts` (no DOM): versioned encoding, strict decoding (size caps on the link and on the decompressed data, which stops a decompression bomb early; exact fields and types; titles cleaned of control, invisible and bidirectional characters), and a scan of the code for what music never needs (network, storage, the page, running other code, and ways to hide names), with a small lexer so mini-notation strings do not count.
- `src/components/Share.ts`: the share dialog (copy, or a selected field when the clipboard is unavailable; a warning for long links) and the review of an opened link (the code as text with hidden characters shown, sites, findings). The fragment leaves the address bar at once.
- `src/session.ts`: shared code never plays by itself: the music stops when it opens, live update waits, and the first Play scans the code as it is then and asks again if anything is flagged (kept across reloads).
- `index.html`: a Content Security Policy against injected markup, plugins, `<base>` and form hijacking. It keeps `'unsafe-eval'` and an open `connect-src`, which the engine and `samples()` need, so it is not a sandbox; the README's "Sharing a song" says so.

`test/share.test.mjs` checks round trips (Unicode, every example), forged and damaged links, size caps, a 16 MB decompression bomb, title cleaning, the scan (every example is clean; each risky feature and hiding trick is found) and that hostile code cannot add markup through the editor's highlighting.

## Phase 16: The rest of the SuperCollider import (complete)

What Phase 14 left out with a note now converts:

- **Buses and effects** (`interpreter.ts`, `synthdef.ts`, `emit.ts`): `Bus.audio`/`Bus.control`; every `Out` of a SynthDef is kept with its bus, so an effect synth (its signal comes from `In.ar`, a filter's input or `\in.ar`) is found and its effects go onto the parts that play into its bus, through chains of effects and sends (dry plus wet mixes and `XFade2` are followed to the wet side). `Pfx`, `Pfxb` and `Pproto` work the same way. A control bus is its `set` value, or a TidalJS signal when an LFO synth writes it (`lfoSignalOf`: `range`, `exprange`, `linlin`, centre plus depth).
- **JITLib**: `Ndef`, `NodeProxy`, `ProxySpace`, source and filter slots, `\pset`, `.set`/`.map`, `<<>`/`<>>`, proxies read inside synths (their graph is inlined), `Tdef`; the proxies that play are written when the program ends, so the last definition wins.
- **Buffers**: `Buffer.read` makes a sample bank; buffer players become samples, with `speed` and `begin` roles.
- **MIDI and OSC out**: `\type, \midi` events and `MIDIOut` calls become `.midi()` parts; `NetAddr`/server `sendMsg`/`sendBundle` become SuperDirt events, synths (`/s_new`) or `.osc()` parts.
- **Synths from code**: `release`, `free` and `set(\gate, 0)` end a routine's synth; `set` on a running synth starts a new note.
- **Random values** in code that repeats (routines, `Pfunc`, `Prout`) are random signals instead of draws; random binary comparisons draw first and then compare (they used to return the draw).
- **Patterns**: `Pconst`; endless arithmetic and geometric series become `.add`/`.mul` of a `sig` that counts the loops; `Pn(Pshuf(...))` becomes `shuffle`.
- **SynthDefs**: two-operator FM and `PMOsc` become `superfm` with `semitone` and `voice`; `SinOscFB`, `GrainSin`, `GrainFM`; feedback is noted.
- **Fixed on the way**: loop lengths are written as exact fractions (`.fast(8 / 3)` instead of `2.66667`, which drifted); a control that some events leave out takes its default there instead of the last value (a legato of 1 next to 1/3 became 1/3 everywhere); a one-off event is no longer reported as "never repeats".

What TidalJS could not do yet (live input, changes during a note, one synth whose values change, a feedback sine) came in Phase 17, and the importer uses it: GUI sliders and buttons become `slider()`/`toggle()`, `MIDIdef.cc` becomes `midicc()`, MIDI note functions that start a synth become `midikeys()`, values an `OSCdef` reads become `oscIn()` (the input functions run once with these live values, so whatever they change follows the player); an LFO inside a SynthDef becomes `.followNote()` and a control bus or proxy an LFO writes `.follow()`; `Pmono` and `synth.set` become `.tie()`; `SinOscFB` becomes `superfb`; random durations become eight random stretches picked by `randcat` each cycle; channels past the second are left out as on a stereo system.

The last gaps closed with the engine features of Phase 18:

- **OSC that starts synths**: an `OSCdef` whose function starts a synth becomes `oscplay(address, template)`, the synth's controls reading that message with `oscIn()`.
- **Pitch bend and aftertouch**: `MIDIdef.bend`/`MIDIIn.bend` become `midibend()` (SuperCollider's 0 to 16383 as -1 to 1), `touch` and `polytouch` become `miditouch()`. A pitch-bend function that `set`s the synths a note function started gives `midikeys()` its bend range (semitones from a `bend.midiratio`-style argument, or from a ratio). Arrays indexed by a live note (`~notes[num] = Synth(...)`) and `!?`/`??` with functions now run as in sclang.
- **GUI windows**: `Window`, `View`, `HLayout`/`VLayout`/`GridLayout`, `StaticText`, `Rect` bounds and flow layouts are read; each window becomes a `controlLayout(title, rows)` of the controls the code uses. Unlabelled controls take the `StaticText` beside or above them, or a button's first state; `PopUpMenu`, `ListView`, `NumberBox`, `CheckBox`, `Slider2D`, `RangeSlider`, `EZRanger` and `EZPopUpMenu` are converted, names are made unique, and a widget read in a `Pfunc` or routine is a live slider.
- **Modulation that is not an LFO**: envelopes (`EnvGen` of any `Env`, up to its release node; `Line`, `XLine`; scaled, offset or put in a range) become `envelope(levels, times, curves)` in `.followNote()`; an envelope synth writing a control bus becomes `.follow()` from the time it starts; `freq * Env(...)` of ratios is a pitch envelope; `MouseX`/`MouseY`/`MouseButton` are sliders and a switch; `Rand`/`ExpRand`/`IRand` are a random value per note, and `freq * Rand(...)` a random detune per note.
- **An LFO moved by another LFO** (`SinOsc.kr(SinOsc.kr(0.25).range(1, 8))`, a range whose bound an LFO moves): `lfoSignalOf` keeps the moving speed and bounds (`rateMod`, `loMod`, `hiMod`), and the part gets a `sig((t) => ...)` in seconds whose phase is the integral of the speed (closed forms for a sine, saw, triangle or square modulator), so the LFO speeds up and slows down smoothly as in SuperCollider. A vibrato whose speed an LFO moves becomes `.followNote("vib", ...)`; `vib` joined the controls `follow()` can change (the vibrato oscillator's frequency).
- **Per-key aftertouch**: `keytouch()` (engine) reads, inside a `midikeys()` voice, the pressure of that voice's own key; the engine sets the key while it lays out (and re-lays) a voice's follows, and a note keeps its own value until its key is pressed harder (likewise `miditouch()` in a voice, until channel pressure comes after its key went down). A `polytouch` function that `set`s the held notes becomes `.follow(control, keytouch()...)` in the `midikeys()` template, and a `touch` function on them `.follow(control, miditouch()...)`; used on anything else, polyphonic aftertouch stays the last key's pressure.
- **Live values during a note**: a GUI, MIDI or OSC value (or a bus it `set`s) that changes a running synth is written with `.follow()`, so it moves the sounding note, not only the next one.
- **Random durations**: when one random duration sets every event (a `Pbind` `dur` or a routine's random `wait`) and the events follow one another, the values are written in order one per cycle and `rhythm(durations)` plays them, each with a new random duration. Rests are silent steps with their own draw, and a loop of random and fixed lengths (a `Pseq` of durations, a routine's mixed waits, a changing `stretch`, all scaled to the tempo) becomes `rhythm(cat(...))`, a random length being `segment(1)` of its signal. The eight `randcat` stretches remain for a random `stretch`, a `timingOffset`, several waits in a row after one synth, and lengths that do not repeat within 64 steps.
- **Fixed on the way**: a synth with a gated sustaining envelope (`asr`, `adsr`, a release node) that nothing releases now plays until stopped, like any endless synth.

`test/supercollider.test.mjs` plays each of these conversions in the engine and compares the events with what SuperCollider would play.

## Phase 17: Changes during a note, ties, live input and superfb (complete)

What the SuperCollider import (and live playing) needed from the engine:

```javascript
.follow(ctrl, sig)      // [done] A control changes while each note sounds (onset through release), the signal read at absolute cycles
.followNote(ctrl, sig)  // [done] The same, the signal's time starting at 0 at each note's onset
.tie(id)                // [done] Monophonic slur (Pmono, synth.set): the running voice takes the new pitch, controls and length
slider(name, v, lo, hi, step) // [done] A slider in the Controls panel, as a signal
toggle(name, on)        // [done] A switch in the Controls panel: 0 or 1
midicc(cc, channel)     // [done] The last value of a MIDI control change, 0 to 1
midikeys(template, ch)  // [done] A MIDI keyboard playing a template, each key held until let go
oscIn(address, index)   // [done] The last number received on an OSC address, through the bridge
superfb                 // [done] SuperCollider's SinOscFB: voice 0 is a sine, 1 a feedback of 1.5 (saw-like)
```

- **follow / followNote** (`tidal.js`): the signals travel in the event value as a `Follows` object, left out of JSON (`exportPattern`) and never sent by OSC or MIDI, which get the value at the onset. Every query sets the followed controls to their signals' values at the event's onset, so after `.fast()` or `.late()` the value is the one at the time that plays. `playEvent` binds the signals to the note's onset (cycle, audio time, tempo) and the voice automates the matching AudioParams every 15 ms (at most 400 points per note, flat stretches left out) until it stops: the filter cutoffs and Qs (a followed cutoff replaces its envelope), the panner, a level node for `gain` and `amp` (a gain that starts at 0 still builds the voice), and the pitch (`freq`, `note`, `speed`) as cents on the oscillators' detune, so it adds to portamento, vibrato and pitch envelopes. Other controls are ignored with a warning. Live updates compare the signals' values, so an unchanged follow keeps its stream.
- **tie**: a control. A synth voice started with a tie registers under orbit, sound and tie; a later event with the same key while it still sounds starts no voice: the gate is held at its level and closes at the new end (sources, modulators and the bend source get the later stop time), the pitch moves on a dedicated bend source (gliding over the new event's portamento, plus its followed pitch), and the filters, pan and level take the new values (or follows) from that moment; controls left out keep their value. Samples ignore it, with a warning.
- **slider / toggle**: registered while the code runs and committed only when it plays (a failing or pending evaluation keeps the old ones); an existing control keeps its value and takes the new range and step; those not used any more go. `tidal.controls()`, `setControl()`, `onControls()` and `restoreControls()` serve the editor. The Controls panel (`src/components/Controls.ts`, under the cycle view, hidden when there are none) shows a labelled range input with a readout per slider and a switch (`role="switch"`) per toggle; the values are kept in `localStorage`.
- **MIDI input**: on first use every input is listened to (and inputs plugged in later). The parser keeps running status per input, skips real-time bytes anywhere, system exclusive and system common messages, and treats a note-on with velocity 0 as a note-off. A key plays each `midikeys` template of its channel through `playEvent` with a hold, and its note-off releases those voices over their release.
- **OSC input**: the bridge's WebSocket (opened by `oscIn` and kept across `setOscUrl`) passes binary messages to a parser of messages and nested bundles (`i f d h s S b c r m t T F N I`, arrays skipped); each address keeps its last numeric arguments. The repository has no bridge: the README says what it must send back, with a small Node example.
- **superfb**: a second AudioWorklet processor, `tidal-fb`, with a-rate `frequency`, `detune` and `feedback`; the feedback is averaged over two samples. A constant source is its gate, so the oscillator starts and stops to the sample and the node ends when the voice does. Without AudioWorklet it plays a sine, with a warning.

`test/engine.test.mjs` checks each of them through a fake audio graph that records every AudioParam call: the automation points of followed cutoffs, Qs, pan, gain and pitch (absolute and per note), JSON and live updates with follows, a tie gliding into the running voice and extending it, controls kept, clamped, stepped, restored and removed, MIDI bytes (running status, split messages, real-time bytes, channels) driving `midicc` and `midikeys` voices held and released, OSC messages and nested bundles of every type through a fake WebSocket, and the `tidal-fb` processor rendered sample by sample (a pure sine at 0, strong harmonics at 1.5).

## Phase 18: More live input, envelopes, rhythm, control layouts and fuller ties (complete)

More of what the SuperCollider import needed from the engine:

```javascript
midibend(channel)            // [done] The last MIDI pitch bend, -1 to 1 (0 in the middle)
miditouch(channel)           // [done] The last aftertouch, 0 to 1: channel pressure or key pressure
midikeys(template, ch, range) // [done] The wheel bends the held keys by up to `range` semitones
oscplay(address, template)   // [done] Each OSC message plays the template once, with that message's values
envelope(levels, times, curves) // [done] SuperCollider's Env as a signal, times in seconds
.rhythm(durations)           // [done] One step after another from cycle 0, each with its own length, never looping
controlLayout(title, rows)   // [done] Titled groups of rows of controls in the Controls panel
.tie(id)                     // [done] A tied note changes effects, synth parameters and the orbit's effects too
.follow() of live input      // [done] Moving a slider, knob, wheel, fader or bus moves the sounding notes
```

- **midibend / miditouch** (`tidal.js`): pitch bend (`0xE0`, 14 bits, 8192 the centre, 16383 exactly 1), channel pressure (`0xD0`) and polyphonic key pressure (`0xA0`, the last key's) are kept per channel and for any channel, read by signals as `midicc` is.
- **midikeys' bend range**: a third argument (the channel may be `null`). A voice of such a keyboard carries its wheel; a bend on the keyboard's channel ramps the bend source of every held voice (5 ms) to the voice's pitch plus bend × range, on top of a followed pitch if it has one, and a key pressed with the wheel off centre starts bent. Voices without a bend source (samples) do not bend.
- **oscplay**: registered like `midikeys` (pending while the code runs, committed only when it plays). Each message on its address (normalised to a leading `/`) is first kept for `oscIn`, then each template plays its first event of the current cycle at that event's length, so the template reads the message's own values.
- **envelope**: SuperCollider's curves (numbers, `lin`, `exp`, `step`, `hold`, `sin`, `wel`, `sqr`, `cub`) in a module-level `envelopeValue`, which the pitch envelopes now use too; times and curves are cycled as in `Env`; inputs are checked with clear errors. Cycle t is read at t / cps seconds.
- **rhythm**: the onsets are summed incrementally into a growing `Float64Array` (step k's length is the duration pattern at cycle k, at least 1/256 cycle; a non-number is 0.25 with a warning), and a query finds its first step by binary search, so a span far ahead costs one pass the first time and a search afterwards. The cache stops at two million steps, with a warning. Each step plays every event of the pattern active at cycle k, with the step's start and end, so legato, the cycle view and `exportPattern` see ordinary events.
- **controlLayout**: layouts are registered like controls (replaced only by code that plays) and reach the editor through `controlLayouts()` and the second argument of `onControls`. The Controls panel shows a `fieldset` with a `legend` per layout, its rows wrapping side by side, then the controls no layout names; names that are not controls are skipped.
- **tie**: a tied voice is built with every effect it can change in place, set so it changes nothing when its first note leaves it out (waveshapers without a curve, vowel, band-pass and phaser beside the dry sound, tremolo, ring and leslie at depth 0, the peak equaliser at 0 dB, lpf at 20 kHz, hpf at 20 Hz, a vibrato at depth 0). A tied note then sets them from its start: waveshaper curves, AudioParams, the synth's own `detune`, `voice`, `rate`, `lfo` and `semitone` on running nodes, and AudioWorklet effects through a timed message (`port.postMessage({ at, options })`, applied to each effect's state without resetting it). It also sets its orbit's delay and reverb, connecting the voice to a bus it lacks only once. `follow()` gained the AudioParam-driven effects (peak, djf, tremolo, phaser, ring, leslie).
- **Live follow**: live inputs count their reads, so `_applyFollows` knows when a voice's signals depend on one; such voices (and their followed pitch) are kept until they end. `setControl`, MIDI control changes, bends and aftertouch, OSC values and `setBus` re-lay their automation from that moment (cancel and hold, a 10 ms glide, then the signal sampled to the voice's stop), at most every 20 ms. A followed pitch also works when the event's only `note` or `freq` is the one `follow()` gives at the onset (or none): it moves from the pitch the voice was built at.

`test/engine.test.mjs` checks each of them: MIDI bytes for bends (centre, extremes, channels), channel and key pressure; a held key bent by the wheel and starting bent; `oscplay` playing the values of the message that triggered it (message and bundle), replaced and kept like `midikeys`; envelope values at several times, tempos and curves, and its errors; `rhythm` onsets, lengths and values with random lengths, far-future spans equal to summing from the start, chords, rests, patterned lengths, the shortest step, the cap, legato, export and the cycle view; `controlLayout` lists, listener and replacement rules; a tied note changing shapers, vowel, tremolo, ring, phaser, leslie, peak, djf, filters, vibrato, synth parameters, worklet settings and the orbit's effects; and sliders, knobs, buses, OSC faders, tied voices and held keys moving the notes that sound.

## What could come next

- A visual pattern editor: draw steps on a grid and get the mini-notation
- Recording a session (code and audio) to replay it
