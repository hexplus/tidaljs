/** Example songs, grooves and function demos for the Examples tab. */

export interface Example {
    group: string;
    title: string;
    code: string;
}

// Songs are public-domain pieces (classical and traditional) transcribed
// by hand. Grooves are genre rhythms. Each one sets its own tempo.
export const EXAMPLES: Example[] = [
    { group: 'Songs', title: 'Ode to Joy (Beethoven, 1824)', code: `// Ode to Joy - Beethoven, Symphony No. 9 (1824). One cycle = one bar.
setCPS(0.5)

sound("tri")
  .note("<[e4 e4 f4 g4] [g4 f4 e4 d4] [c4 c4 d4 e4] [e4@3 d4 d4@4] [e4 e4 f4 g4] [g4 f4 e4 d4] [c4 c4 d4 e4] [d4@3 c4 c4@4]>")
  .legato(0.9).room(0.3)

sound("saw")
  .note("<[c3 c3] [g2 g2] [c3 c3] [g2 g2] [c3 c3] [g2 g2] [c3 e3] [g2 c3]>")
  .lpf(700).legato(0.8).gain(0.6)` },

    { group: 'Songs', title: 'Ode to Joy, club edit', code: `// Ode to Joy over a house beat: same melody, new arrangement.
setCPS(0.55)

const melody = "<[e4 e4 f4 g4] [g4 f4 e4 d4] [c4 c4 d4 e4] [e4@3 d4 d4@4] [e4 e4 f4 g4] [g4 f4 e4 d4] [c4 c4 d4 e4] [d4@3 c4 c4@4]>"

stack([
  sound("bd*4"),
  sound("~ cp ~ cp").room(0.2),
  sound("[~ hh]*4").gain(0.6),
  sound("saw*8").note("<c2 g1 c2 g1 c2 g1 c2 [g1 c2]>")
    .lpf(sine.range(300, 1500).slow(8)).legato(0.6).gain(0.6),
  sound("arpy").note(melody).up(12).delay(0.375).room(0.3)
])` },

    { group: 'Songs', title: 'Für Elise (Beethoven, 1810)', code: `// Für Elise - Beethoven (1810), opening theme. One cycle = one bar of 3/8.
setCPS(0.75)

sound("arpy")
  .note("<[e5 d#5 e5 b4 d5 c5] [a4@2 ~ c4 e4 a4] [b4@2 ~ e4 g#4 b4] [c5@2 ~ e4 e5 d#5] [e5 d#5 e5 b4 d5 c5] [a4@2 ~ c4 e4 a4] [b4@2 ~ e4 c5 b4] [a4@2 ~ ~ e5 d#5]>")
  .room(0.3)

sound("arpy")
  .note("<~ [a2 e3 a3 ~@3] [e2 e3 g#3 ~@3] [a2 e3 a3 ~@3] ~ [a2 e3 a3 ~@3] [e2 e3 g#3 ~@3] [a2 e3 a3 ~@3]>")
  .gain(0.7)` },

    { group: 'Songs', title: 'Prelude in C (Bach, 1722)', code: `// Prelude in C major, BWV 846 - J. S. Bach (1722), first eight bars. One cycle = one bar.
setCPS(0.3)

const bars = [
  "c4 e4 g4 c5 e5", "c4 d4 a4 d5 f5", "b3 d4 g4 d5 f5", "c4 e4 g4 c5 e5",
  "c4 e4 a4 e5 a5", "c4 d4 f#4 a4 d5", "b3 d4 g4 d5 g5", "b3 c4 e4 g4 c5"
]

// Bach's figure: five notes, the top three repeated, played twice per bar.
const figure = (chord) => {
  const [a, b, c, d, e] = chord.split(" ")
  return "[[" + [a, b, c, d, e, c, d, e].join(" ") + "]!2]"
}

sound("arpy")
  .note("<" + bars.map(figure).join(" ") + ">")
  .room(0.4).size(0.7)` },

    { group: 'Songs', title: 'Canon in D (Pachelbel, c. 1680)', code: `// Canon in D - Johann Pachelbel (c. 1680). One cycle = two bars of the ground bass.
// The violin line is played three times, each voice one cycle behind the last.
setCPS(0.14)

const bass = "d3 a2 b2 f#2 g2 d2 g2 a2"
const chords = "d4'maj a3'maj b3'min f#3'min g3'maj d4'maj g3'maj a3'maj"
const violin = "<[f#5 e5 d5 c#5 b4 a4 b4 c#5] [d5 c#5 b4 a4 g4 f#4 g4 e4] [d4 f#4 a4 g4 f#4 d4 f#4 e4 d4 b3 d4 a4 g4 b4 a4 g4]>"

sound("saw").note(bass).lpf(500).legato(1).gain(0.7)
sound("tri").note(chords).legato(1).gain(0.2)
sound("tri").note(violin).legato(1).gain(0.5).pan(-0.4)
sound("tri").note(violin).late(1).legato(1).gain(0.4).pan(0.4)
sound("arpy").note(violin).late(2).up(12).gain(0.3).room(0.4)` },

    { group: 'Songs', title: 'In the Hall of the Mountain King (Grieg, 1875)', code: `// In the Hall of the Mountain King - Edvard Grieg (1875). One cycle = one bar.
// Raise the tempo while it plays for Grieg's accelerando.
setCPS(0.45)

sound("arpy")
  .note("<[b3 c#4 d4 e4 f#4 d4 f#4@2] [e#4 c#4 e#4@2 e4 c4 e4@2] [b3 c#4 d4 e4 f#4 d4 f#4 b4] [a4 f#4 d4 f#4 a4@4]>")

sound("saw").note("<b1 [c#2 c2] b1 [d2 f#1]>").lpf(400).legato(1).gain(0.6)
sound("bd ~ bd ~").gain(0.8)` },

    { group: 'Songs', title: 'Greensleeves (traditional)', code: `// Greensleeves - traditional English (16th century). One cycle = one bar of 3/4.
setCPS(0.53)

sound("tri")
  .note("<[c5@4 d5@2] [e5@3 f5 e5@2] [d5@4 b4@2] [g4@3 a4 b4@2] [c5@4 a4@2] [a4@3 g#4 a4@2] [b4@4 g#4@2] [e4@4 a4@2] [c5@4 d5@2] [e5@3 f5 e5@2] [d5@4 b4@2] [g4@3 a4 b4@2] [c5@3 b4 a4@2] [g#4@3 f#4 g#4@2] a4 [~@4 a4@2]>")
  .legato(1).attack(0.03).gain(0.6).room(0.4)

sound("saw")
  .note("<a2 c3 g2 e2 a2 e2 e2 a2 a2 c3 g2 e2 a2 e2 a2 a2>")
  .legato(1).lpf(600).gain(0.5)` },

    { group: 'Songs', title: 'Gymnopédie No. 1 (Satie, 1888)', code: `// Gymnopédie No. 1 - Erik Satie (1888). One cycle = one bar of 3/4.
// Bass on the first beat, chord on the second and third.
setCPS(0.36)

sound("tri")
  .note("<[g2 [b3,d4,f#4]@2] [d2 [a3,c#4,f#4]@2]>")
  .legato(1).gain(0.45).room(0.5).size(0.8)

sound("sine")
  .note("<~ ~ ~ ~ [~ f#5 a5] [g5 f#5 c#5] [b4 c#5 d5] a4 f#4 ~ ~ ~>")
  .legato(1).attack(0.02).gain(0.6).room(0.5).size(0.8)` },

    { group: 'Songs', title: 'Frère Jacques (round)', code: `// Frère Jacques - traditional round. Each voice comes in two bars after the last.
setCPS(0.5)

const tune = "<[c4 d4 e4 c4] [c4 d4 e4 c4] [e4 f4 g4@2] [e4 f4 g4@2] [[g4 a4 g4 f4]@2 e4 c4] [[g4 a4 g4 f4]@2 e4 c4] [c4 g3 c4@2] [c4 g3 c4@2]>"

sound("arpy").note(tune)
sound("tri").note(tune).late(2).up(12).legato(0.8).gain(0.5).pan(-0.6)
sound("sine").note(tune).late(4).legato(0.8).gain(0.5).pan(0.6)
sound("saw").note(tune).late(6).up(-12).lpf(900).legato(0.8).gain(0.5)` },

    { group: 'Songs', title: 'Toccata in D minor (Bach)', code: `// Toccata and Fugue in D minor, BWV 565 - attributed to J. S. Bach. The opening flourish.
// Free time: one phrase every two cycles, doubled an octave below like an organ.
setCPS(0.35)

sound("square")
  .note("[a4 g4 a4@6 ~@3 g4 f4 e4 d4 c#4@6 d4@8]")
  .superimpose(x => x.up(-12))
  .slow(2)
  .lpf(1800).legato(1).gain(0.35)
  .room(0.8).size(1)` },

    { group: 'Christmas', title: 'Jingle Bells (Pierpont, 1857)', code: `// Jingle Bells - James Lord Pierpont (1857), the chorus. One cycle = one bar.
setCPS(0.6)

const chorus = "<[e4 e4 e4@2] [e4 e4 e4@2] [e4@2 g4@2 c4@3 d4] e4 [f4@2 f4@2 f4@3 f4] [f4@2 e4@2 e4@2 e4 e4] [e4@2 d4@2 d4@2 e4@2] [d4 g4] [e4 e4 e4@2] [e4 e4 e4@2] [e4@2 g4@2 c4@3 d4] e4 [f4@2 f4@2 f4@3 f4] [f4@2 e4@2 e4@2 e4 e4] [g4 g4 f4 d4] c4>"

stack([
  sound("arpy").note(chorus).up(12).room(0.3),
  sound("tri").note(chorus).legato(0.8).gain(0.4),
  // Oom-pah: the bass note, then the chord.
  sound("saw").note("<[c3 g2]!4 [f2 c3] [c3 g2] [d3 a2] [g2 d3] [c3 g2]!4 [f2 c3] [c3 g2] [g2 d3] [c3 c3]>")
    .lpf(600).legato(0.7).gain(0.6),
  // Sleigh bells
  sound("hh*8").gain("0.5 0.25").hpf(6000).pan(perlin.range(-0.5, 0.5)),
  sound("bd ~ bd ~").gain(0.7)
])` },

    { group: 'Christmas', title: 'Silent Night (Gruber, 1818)', code: `// Silent Night - Franz Xaver Gruber (1818). One cycle = one bar of 6/8.
setCPS(0.42)

sound("tri")
  .note("<[g4@3 a4 g4@2] e4 [g4@3 a4 g4@2] e4 [d5@4 d5@2] b4 [c5@4 c5@2] g4 [a4@4 a4@2] [c5@3 b4 a4@2] [g4@3 a4 g4@2] e4 [a4@4 a4@2] [c5@3 b4 a4@2] [g4@3 a4 g4@2] e4 [d5@4 d5@2] [f5@3 d5 b4@2] c5 e5 [c5@3 g4 e4@2] [g4@3 f4 d4@2] c4 ~>")
  .legato(1).attack(0.04).gain(0.6).room(0.5).size(0.8)

// The guitar: each chord broken into six eighth notes, rising over two octaves.
const chords = { C: "c3'maj'6", F: "f2'maj'6", G: "g2'dom7'6" }
const harmony = "C C C C G G C C F F C C F F C C G G C C C G C C"

sound("arpy")
  .note("<" + harmony.split(" ").map(c => chords[c]).join(" ") + ">")
  .arp("up").gain(0.45).room(0.4)` },

    { group: 'Christmas', title: 'Deck the Halls (traditional)', code: `// Deck the Halls - traditional Welsh carol (16th century). One cycle = one bar.
setCPS(0.55)

const line = "[g4@3 f4 e4@2 d4@2] [c4@2 d4@2 e4@2 c4@2] [d4 e4 f4 d4 e4@3 d4] [c4@2 b3@2 c4@4]"
const middle = "[d4@3 e4 f4@2 d4@2] [e4@3 f4 g4@2 d4@2] [e4 f#4 g4@2 a4 b4 c5@2] [b4@2 a4@2 g4@4]"
const last = "[g4@3 f4 e4@2 d4@2] [c4@2 d4@2 e4@2 c4@2] [a4 a4 a4 a4 g4@3 f4] [e4@2 d4@2 c4@4]"

stack([
  sound("square").note("<" + [line, line, middle, last].join(" ") + ">")
    .lpf(2400).legato(0.9).gain(0.35).room(0.3),
  sound("saw").note("<c3 c3 g2 [g2 c3] c3 c3 g2 [g2 c3] g2 c3 [a2 d3] [d3 g2] c3 c3 [f2 g2] [g2 c3]>")
    .lpf(500).legato(1).gain(0.55),
  sound("tri").note("<c4'maj!2 g3'dom7 c4'maj!3 g3'dom7 c4'maj g3'maj c4'maj d4'maj g3'maj c4'maj!2 f3'maj c4'maj>")
    .struct("~ x ~ x").legato(0.5).gain(0.2)
])` },

    { group: 'Christmas', title: 'We Wish You a Merry Christmas (traditional)', code: `// We Wish You a Merry Christmas - traditional English carol. One cycle = one bar of 3/4.
setCPS(0.45)

stack([
  sound("arpy")
    .note("<[g4@2 g4 a4 g4 f#4] [e4@2 e4@2 e4@2] [a4@2 a4 b4 a4 g4] [f#4@2 d4@2 d4@2] [b4@2 b4 c5 b4 a4] [g4@2 e4@2 d4 d4] [e4@2 a4@2 f#4@2] [g4@4 d4@2] [g4@2 g4@2 g4@2] [f#4@4 f#4@2] [g4@2 f#4@2 e4@2] [d4@4 a4@2] [b4@2 a4 a4 g4 g4] [d5@2 d4@2 d4 d4] [e4@2 a4@2 f#4@2] [g4@4 d4@2]>")
    .up(12).room(0.3),
  // Waltz: bass on beat one, chord on two and three.
  sound("saw").note("<g2 c3 a2 d3 b2 [c3 d3] [c3 d3] g2 g2 d3 e3 d3 g2 d3 [c3 d3] g2>")
    .struct("x ~ ~").lpf(500).legato(1).gain(0.6),
  sound("tri").note("<g3'maj c4'maj a3'min d4'dom7 b3'min [c4'maj d4'maj] [c4'maj d4'maj] g3'maj g3'maj d4'maj e4'min d4'maj g3'maj d4'maj [c4'maj d4'maj] g3'maj>")
    .struct("~ x x").legato(0.6).gain(0.2),
  sound("~ hh hh").gain(0.3).hpf(7000)
])` },

    { group: 'Christmas', title: 'Good King Wenceslas (traditional)', code: `// Good King Wenceslas - melody from Piae Cantiones (1582). One cycle = one bar.
setCPS(0.5)

const verse = "[g4 g4 g4 a4] [g4 g4 d4@2] [e4 d4 e4 f#4] [g4@2 g4@2]"
const tune = "<" + [verse, verse,
  "[d5 c5 b4 a4] [b4 a4 g4@2] [e4 d4 e4 f#4] [g4@2 g4@2]",
  "[d4 d4 e4 f#4] [g4 g4 a4@2] [d5 c5 b4 a4] [g4@2 c5@2] g4"].join(" ") + ">"

sound("tri").note(tune).legato(0.9).gain(0.55).room(0.4)
sound("tri").note(tune).up(-12).lpf(1200).legato(0.9).gain(0.3)
sound("saw")
  .note("<g2 [g2 d3] [c3 d3] g2 g2 [g2 d3] [c3 d3] g2 [b2 d3] [e3 d3] [c3 d3] g2 [b2 d3] [e3 d3] [g2 d3] [e3 c3] g2>")
  .lpf(450).legato(1).gain(0.55)
// Church bells
sound("<cy ~ ~ ~>").speed(0.5).gain(0.3).room(0.6)` },

    { group: 'Christmas', title: 'Carol of the Bells (Leontovych, 1916)', code: `// Shchedryk - Mykola Leontovych (1916), known in English as Carol of the Bells.
// Its four-note bell figure in G minor never stops; voices join it every four bars
// over a falling bass. One cycle = one bar of 3/4.
setCPS(0.6)

const bell = "[bb4@2 a4 bb4 g4@2]"

stack([
  sound("arpy").note(bell).gain(0.7),
  sound("tri").note("<~!4 [d5@2 c5 d5 bb4@2]!12>").legato(0.9).gain(0.4).pan(-0.4),
  sound("tri").note("<~!8 [g5@2 f5 g5 d5@2]!8>").legato(0.9).gain(0.3).pan(0.4),
  sound("sine").note("<~!12 [d6 c6 bb5 a5 g5 f#5]!4>").gain(0.25).delay(0.25).room(0.5),
  sound("saw").note("<g2 g2 f2 f2 eb2 eb2 d2 d2>").lpf(400).legato(1).gain(0.5)
])` },

    { group: 'Grooves', title: 'House', code: `// House: four-on-the-floor kick, offbeat open hats and a filtered bassline. 128 bpm.
setCPS(0.533)

stack([
  sound("bd*4"),
  sound("~ cp ~ cp").room(0.2),
  sound("[~ oh]*4").gain(0.5),
  sound("hh*16").gain(0.2).degradeBy(0.3),
  sound("saw*8").note("<[c2 c3]*4 [a1 a2]*4 [f1 f2]*4 [g1 g2]*4>")
    .lpf(sine.range(300, 2400).slow(16)).resonance(6)
    .legato(0.5).gain(0.5)
])` },

    { group: 'Grooves', title: 'Boom bap', code: `// Boom bap: a laid-back hip-hop beat with swung hats and jazzy chords. 90 bpm.
setCPS(0.375)

stack([
  sound("bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ ~"),
  sound("~ sn ~ sn").room(0.15),
  sound("hh*8").swing(4).gain(0.45),
  sound("tri").struct("x ~ ~ x ~ ~ x ~").note("<a3'min7 d3'min7 g3'dom7 c4'maj7>")
    .legato(0.6).lpf(1600).gain(0.35)
])` },

    { group: 'Grooves', title: 'Bossa nova', code: `// Bossa nova: the bossa clave over a ii-V-I in C.
setCPS(0.55)

stack([
  sound("bd ~ ~ bd bd ~ ~ bd"),
  sound("cp ~ ~ cp ~ ~ cp ~ ~ ~ cp ~ ~ cp ~ ~").gain(0.4).hpf(1500),
  sound("hh*8").gain(0.3),
  sound("tri").struct("x ~ ~ x ~ ~ x ~ ~ ~ x ~ ~ x ~ ~").note("<d3'm7 g3'dom7 c3'maj7 c3'maj7>")
    .legato(0.4).gain(0.3).room(0.3),
  sound("sine").note("<[d2 a1] [g1 d2] [c2 g1] [c2 g1]>").legato(0.9).gain(0.7)
])` },

    { group: 'Grooves', title: 'Jungle', code: `// Jungle: a chopped-up breakbeat over a rolling sub bass. 170 bpm.
setCPS(0.71)

stack([
  sound("<[bd ~ bd ~ sn ~ ~ sn ~ sn bd bd sn ~ ~ sn] [bd ~ bd ~ sn ~ ~ sn ~ sn bd ~ sn ~ [sn sn] sn]>")
    .chunk(4, x => x.hurry(2)),
  sound("hh*8").gain(0.35).pan(sine.range(-0.5, 0.5)),
  sound("sine").note("<e1 e1 g1 [d1 a0]>").legato(1).gain(0.9)
])` },

    { group: 'Samples', title: 'Dirt-Samples drum kit', code: `// Recorded samples from the Dirt-Samples library, loaded from GitHub the first time.
// A loaded bank replaces the synth of the same name; n picks the file.
samples("github:tidalcycles/dirt-samples")

stack([
  sound("bd*2 [~ bd] ~ bd"),
  sound("~ sn:3 ~ sn:3").room(0.2),
  sound("hh*8").n("0 .. 7").gain(0.6),
  sound("jvbass*4").n("<0 2>").note("c e g e").legato(1)
])` },

    { group: 'Samples', title: 'Breakbeat slices', code: `// amencutup is a breakbeat cut into 32 slices: n picks the slice.
samples("github:tidalcycles/dirt-samples")
setCPS(0.55)

sound("amencutup*16").n("0 .. 15")
  .every(4, x => x.iter(4))
  .sometimesBy(0.2, x => x.speed(-1))
  .lpf(6000)` },

    { group: 'Samples', title: 'chop() on a recording', code: `// chop() cuts each sample into slices that follow the pattern.
samples("github:tidalcycles/dirt-samples")
setCPS(0.5)

stack([
  sound("breaks125").chop(16).linger("<1 0.5 0.25 0.5>").legato(1),
  sound("drum*2 drum:1").speed("<1 2 -1>").gain(0.8)
])` },

    { group: 'Pattern fundamentals', title: 'sound() and n()', code: 'sound("bd*2 [sn cp] bd [sn sn:2]").n("<0 1 2>")' },
    { group: 'Pattern fundamentals', title: 'note()', code: '// The first bar of Ode to Joy\nsound("arpy").note("e4 e4 f4 g4")' },
    { group: 'Pattern fundamentals', title: 'up()', code: '// Twinkle Twinkle, an octave higher every other cycle\nsound("arpy").note("c4 c4 g4 g4 a4 a4 g4@2").up("<0 12>")' },
    { group: 'Pattern fundamentals', title: 'freq()', code: 'sound("sine").freq("440 554 659")' },
    { group: 'Pattern fundamentals', title: 'midinote()', code: 'sound("saw").midinote("48 55 60 63").lpf(1200)' },

    { group: 'Time', title: 'fast() and slow()', code: 'stack([\n  sound("bd sn").fast(2),\n  sound("arpy").note("c e g b").slow(2)\n])' },
    { group: 'Time', title: 'rev()', code: '// The Für Elise motif, backwards\nsound("arpy").note("e5 d#5 e5 d#5 e5 b4 d5 c5").rev()' },
    { group: 'Time', title: 'every()', code: 'sound("bd sn bd sn")\n  .every(4, x => x.fast(2))' },
    { group: 'Time', title: 'sometimes()', code: 'sound("hh*8")\n  .sometimes(x => x.gain(0.3))' },
    { group: 'Time', title: 'often() and rarely()', code: 'sound("hh*8")\n  .often(x => x.lpf(2000))\n  .rarely(x => x.fast(2))' },
    { group: 'Time', title: 'density()', code: 'sound("bd sn cp").density(1.5)' },
    { group: 'Time', title: 'whenmod()', code: 'sound("bd sn hh cp")\n  .whenmod(8, 6, x => x.rev())' },
    { group: 'Time', title: 'late()', code: '// A melody against a copy of itself an eighth later\nsound("arpy").note("c4 e4 g4 b4")\n  .superimpose(x => x.late(0.125).up(12).gain(0.5))' },
    { group: 'Time', title: 'Patterned arguments', code: '// Arguments can be patterns: a different speed each cycle\nsound("bd sn hh cp").fast("<1 2 [1 4]>")' },
    { group: 'Time', title: 'ply()', code: 'sound("bd sn hh cp").ply("<1 2 3>")' },
    { group: 'Time', title: 'iter()', code: 'sound("arpy*4").note("c e g b").iter(4)' },
    { group: 'Time', title: 'linger()', code: 'sound("bd [~ bd] sn hh*2").linger("<1 0.25 0.5>")' },
    { group: 'Time', title: 'rot()', code: '// Same rhythm, values shifted one step each cycle\nsound("bd ~ sn [hh cp]").rot("<0 1 2 3>")' },
    { group: 'Time', title: 'off()', code: 'sound("arpy*4").note("c e g b")\n  .off(0.125, x => x.up(12).gain(0.5))' },

    { group: 'Effects', title: 'gain() and pan()', code: 'stack([\n  sound("hh*4").pan(-0.8),\n  sound("~ cp").pan(0.8).gain(0.6)\n])' },
    { group: 'Effects', title: 'lpf()', code: 'sound("saw*8").note("c2 c3").lpf("300 600 1200 2400")' },
    { group: 'Effects', title: 'hpf()', code: 'sound("bd sn bd sn").hpf(400)' },
    { group: 'Effects', title: 'bpf()', code: 'sound("arpy*4").bpf(1000)' },
    { group: 'Effects', title: 'delay()', code: 'sound("cp ~ ~ ~").delay(0.25)' },
    { group: 'Effects', title: 'reverb()', code: 'sound("sn ~ arpy ~").note("c e").reverb(0.6)' },
    { group: 'Effects', title: 'distortion()', code: 'sound("bd sn bd sn").distortion(5)' },
    { group: 'Effects', title: 'crush()', code: 'sound("arpy*4").note("c e g b").crush(4)' },
    { group: 'Effects', title: 'vowel()', code: 'sound("saw").note("c3 e3 g3").vowel("<a e i o u>")' },

    { group: 'Composition', title: 'stack()', code: 'stack([\n  sound("bd ~ bd ~"),\n  sound("~ sn ~ sn"),\n  sound("hh*8").gain(0.5)\n])' },
    { group: 'Composition', title: 'cat(): one pattern per cycle', code: 'cat([\n  sound("bd sn"),\n  sound("hh cp hh cp")\n])' },
    { group: 'Composition', title: 'append()', code: 'sound("bd*2").append("sn*3").append("cp*4")' },
    { group: 'Composition', title: 'struct()', code: 'struct("x ~ x x ~ x ~ x", sound("bd sn"))' },
    { group: 'Composition', title: 'superimpose()', code: 'sound("arpy*4").note("c e g b")\n  .superimpose(x => x.fast(2).up(12).gain(0.5))' },
    { group: 'Composition', title: 'overlay()', code: 'sound("bd ~ bd ~")\n  .overlay("~ sn ~ sn")' },
    { group: 'Composition', title: 'layer()', code: 'layer([\n  sound("bd ~ bd ~"),\n  sound("~ sn ~ sn"),\n  sound("hh hh hh hh").gain(0.3)\n])' },
    { group: 'Composition', title: 'jux()', code: '// The scale on the left, backwards on the right\nsound("arpy*8").note(scale("major", "0 .. 7")).jux(x => x.rev())' },
    { group: 'Composition', title: 'euclid() and euclidFull()', code: 'stack([\n  sound("bd").euclidFull(3, 8, sound("hh").gain(0.5)),\n  sound("cp").euclid(2, 8, 2)\n])' },
    { group: 'Composition', title: 'nTake()', code: '// Each played snare takes the next variation from the list\nsound("~ sn ~ sn*2").nTake("snares", [0, 1, 2, 3, 2])' },

    { group: 'Mini-notation', title: 'Subdivision and alternation', code: 'sound("bd [~ bd] <sn cp> [hh hh hh]")' },
    { group: 'Mini-notation', title: 'Euclidean rhythms', code: '// (3,8) is the Cuban tresillo, (5,8) the cinquillo\nstack([\n  sound("bd(3,8)"),\n  sound("hh(5,8,2)").gain(0.5),\n  sound("cp(2,5)").delay(0.25)\n])' },
    { group: 'Mini-notation', title: 'Polymeter', code: 'sound("{bd sn hh, cp hh oh hh cp}")' },
    { group: 'Mini-notation', title: 'Probability and repeats', code: 'sound("bd!2 sn? [hh hh?0.3]!2 cp:1")' },
    { group: 'Mini-notation', title: 'Random choice', code: 'sound("bd [sn | cp | oh] bd [hh | ~]")' },
    { group: 'Mini-notation', title: 'Ranges', code: '// "0 .. 7" is the steps 0 1 2 3 4 5 6 7\nsound("arpy*8").note(scale("minor", "<[0 .. 7] [7 .. 0]>"))' },

    { group: 'Rearranging', title: 'chunk()', code: 'sound("bd sn hh cp")\n  .chunk(4, x => x.hurry(2))' },
    { group: 'Rearranging', title: 'scramble() and shuffle()', code: '// Ode to Joy, scrambled\nstack([\n  sound("bd sn hh cp").shuffle(4),\n  sound("arpy*8").note("e4 e4 f4 g4 g4 f4 e4 d4").scramble(8).gain(0.5)\n])' },
    { group: 'Rearranging', title: 'bite()', code: 'sound("arpy*8").note("c d e f g a b c5")\n  .bite(4, "0 2 <1 3> 0")' },
    { group: 'Rearranging', title: 'palindrome()', code: 'sound("arpy*4").note("c e g b").palindrome()' },
    { group: 'Rearranging', title: 'swing()', code: 'sound("hh*8").swing(4)\n  .overlay("bd ~ sn ~")' },
    { group: 'Rearranging', title: 'chop() and striate()', code: 'stack([\n  sound("cy").chop(4).gain(0.8),\n  sound("bd ~ sn ~").striate(2)\n])' },
    { group: 'Rearranging', title: 'degradeBy()', code: 'sound("hh*16").degradeBy(0.4)\n  .overlay("bd ~ ~ bd ~ ~ sn ~")' },

    { group: 'Harmony', title: 'scale()', code: 'sound("arpy*8")\n  .note(scale("e:minor", "0 2 4 <7 9> 4 2 0 -3"))\n  .lpf(2400)' },
    { group: 'Harmony', title: 'Chords', code: '// The I-V-vi-IV progression in C\nsound("saw").note("<c\'maj g3\'maj a3\'min f3\'maj>")\n  .lpf(1200).gain(0.6).legato(1)' },
    { group: 'Harmony', title: 'arp()', code: 'sound("arpy").note("<c\'maj\'5 a3\'min7\'5>")\n  .arp("<up updown>")\n  .delay(0.375)' },
    { group: 'Harmony', title: 'fit()', code: 'sound(fit(1, ["bd", "sn", "hh", "cp"], "0 1 2 1"))' },

    { group: 'Signals', title: 'Filter sweep', code: 'sound("saw*8").note("c2 c3")\n  .lpf(sine.range(200, 4000).slow(4))\n  .resonance(8)' },
    { group: 'Signals', title: 'Random values', code: 'sound("hh*16")\n  .gain(rand.range(0.2, 0.9))\n  .pan(perlin.range(-1, 1))' },
    { group: 'Signals', title: 'segment()', code: 'sound("sine").freq(saw.range(220, 880).segment(8))' },

    { group: 'Sound shaping', title: 'speed(), begin(), end()', code: 'sound("cy*4").speed("1 2 0.5 1").begin("0 0.5").end(1)' },
    { group: 'Sound shaping', title: 'legato and envelopes', code: 'sound("tri*4").note("c e g b")\n  .legato(0.9).attack(0.05).release(0.3)\n  .room(0.4).size(0.9)' },
    { group: 'Sound shaping', title: 'Noise synths', code: 'stack([\n  sound("pink ~ ~ pink").sustain(0.2).hpf(800),\n  sound("bd*4")\n])' },

    { group: 'Conditions', title: 'within() and while()', code: 'sound("hh*8")\n  .within(0.5, 1, x => x.speed(2))\n  .while("1 0 0 1", x => x.gain(0.3))' },
    { group: 'Conditions', title: 'until() and playFor()', code: 'stack([\n  sound("bd*4").until(4, x => x.lpf(300)),\n  sound("cp ~ cp ~").playFor(2, 6)\n])' },
];

const FIRST_SONG = EXAMPLES.find((e) => e.title === 'Ode to Joy, club edit') ?? EXAMPLES[0];

/** What the editor shows on a first visit. */
export const DEFAULT_CODE = '// Ctrl+Enter (Cmd+Enter on Mac) to play, Esc to stop.\n' + FIRST_SONG.code;
