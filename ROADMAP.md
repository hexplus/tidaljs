# TidalJS Development Roadmap

All six phases are implemented. Each section lists the functions and how they behave. Notes mark where TidalJS differs from TidalCycles, usually because it runs in a browser and synthesises its sounds instead of playing samples.

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
scaleP()    // [done] Alias of scale(); the scale name can be a pattern: "<major minor>"
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
inside outside chunkBack fix unfix contrast spread fastspread spreadChoose pickF selectF
select squeeze soak fadeIn fadeOut stripe       // [done]
```

### 8.3 Echoes, samples, values and generators
```javascript
echo echoWith stut stutWith stutter ghost ghostWith                 // [done]
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
Patterns count their steps as Tidal does: a mini-notation sequence has as many steps as its weights add up to, `<a b>` has 1, `{...}%n` has n, `stack` takes the least common multiple and `fastcat` the sum.

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

## What could come next

- A visual pattern editor: draw steps on a grid and get the mini-notation
- Recording a session (code and audio) to replay it
- A MIDI input mapped to buses (`bus()`), like Tidal's control buses
- Export and import, save to localstorage or WebDB