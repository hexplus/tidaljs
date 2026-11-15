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

`test/supercollider.test.mjs` checks the language, the detection of `.scd` files, and conversions played in the engine: the gabber track's 336 events in 64 seconds (times, notes, peak frequencies, pitch falls, lengths, levels), degrees and scales, rests and random values, sections, routines, Ppar on a TempoClock, Ptpar, chains, chords, SuperDirt events, filter envelopes, and the README's example.

## What could come next

- A visual pattern editor: draw steps on a grid and get the mini-notation
- Recording a session (code and audio) to replay it
- A MIDI input mapped to buses (`bus()`), like Tidal's control buses
- Sharing a sketch as a link (the code in the URL)