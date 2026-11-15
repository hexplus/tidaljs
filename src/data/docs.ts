/**
 * Extended help for everything in TidalJS: what it does and how it relates
 * to TidalCycles, an example, a tip and related names. Shown by the hover
 * help and the insert palette.
 *
 * Time in Tidal is measured in cycles: a pattern describes one cycle (a bar,
 * usually) and repeats it. Every function here changes what happens inside
 * cycles, which cycles something happens in, or what each event sounds like.
 */

import { CONTROL_NAMES } from './signatures.ts';

export interface Doc {
    /** What it does, in a few sentences. */
    about: string;
    /** A short example. */
    example?: string;
    /** A tip, a gotcha or how it differs from TidalCycles. */
    tip?: string;
    /** Related names. */
    see?: string[];
}

const D = (about: string, example?: string, tip?: string, see?: string[]): Doc => ({ about, example, tip, see });

const FN_ARG = 'The function receives the pattern and returns a changed one, e.g. x => x.fast(2) or x => x.speed(2).gain(0.95).';

/** Functions, methods, controls and signals, by name. */
export const DOCS: Record<string, Doc> = {
    // ---------------- Creating patterns ----------------
    sound: D(
        'Creates a pattern of sounds from a mini-notation string. The words are the steps of one cycle, evenly spaced: "bd sn" plays a kick on the first half of the cycle and a snare on the second. As a method, .sound() sets or replaces the sound of an existing pattern.',
        'sound("bd*2 [~ bd] sn hh")',
        'Names can be synths (bd, sn, hh, sine, saw...) or banks loaded with samples(). bd:3 picks the fourth variation, like .n(3).',
        ['s', 'n', 'samples', 'stack'],
    ),
    s: D('Short name for sound(), as in TidalCycles: d1 $ s "bd sn".', 's("bd sn")', undefined, ['sound']),
    stack: D(
        'Plays several patterns at the same time, all sharing the same cycle. This is how you build a full groove: drums, bass and chords each in their own pattern, stacked into one.',
        'stack([\n  sound("bd*4"),\n  sound("~ cp"),\n  sound("hh*8").gain(0.84)\n])',
        'Effects after stack([...]) apply to every layer: stack([...]).room(0.3).',
        ['layer', 'overlay', 'superimpose'],
    ),
    layer: D('Tidal\'s layer: applies each function of a list to the pattern and plays the results together, as layer([f, g], p) = stack([f(p), g(p)]). Given patterns instead, it stacks them like stack().', 'layer([x => x, x => x.fast(2).speed(2)], sound("bd sn"))', undefined, ['stack', 'superimpose']),
    cat: D(
        'Concatenates patterns, one whole cycle each: the first pattern plays in cycle 0, the second in cycle 1, and so on, then it starts again. Tidal calls this cat (or slowcat).',
        'cat([sound("bd sn"), sound("hh*4"), sound("cp ~ cp")])',
        'To squeeze all of them into a single cycle instead, use fastcat(). The mini-notation <a b c> does the same as cat for single steps.',
        ['fastcat', 'randcat', 'append'],
    ),
    slowcat: D('The same as cat(): one pattern per cycle.', 'slowcat([sound("bd*2"), sound("sn*2")])', undefined, ['cat', 'fastcat']),
    fastcat: D(
        'Concatenates patterns into a single cycle: with three patterns, each gets a third of the cycle, so each plays faster.',
        'fastcat([sound("bd"), sound("sn sn"), sound("hh*3")])',
        'Like writing them inside one mini-notation string: "bd [sn sn] [hh hh hh]".',
        ['cat'],
    ),
    randcat: D(
        'Plays one of the patterns, chosen at random, each cycle. The choice is deterministic per cycle, so the same cycle always picks the same pattern.',
        'randcat([sound("bd*2 sn"), sound("bd sn*2"), sound("[bd sn]*2")])',
        undefined,
        ['cat', 'choose'],
    ),
    silence: D('An empty pattern: plays nothing. Useful as a placeholder or inside cat() to leave a cycle empty.', 'cat([sound("bd*4"), silence])'),
    struct: D(
        'Takes the rhythm from a boolean pattern and the values from another pattern. Wherever the structure has a true step (x, t or 1) an event plays, with the value the source has at that moment; ~, f and 0 are rests.',
        'struct("x ~ x x ~ x ~ x", sound("bd"))\nsound("saw").note("<c e g>").struct("t(3,8)")',
        'As a method, .struct(structure) restructures the pattern it is called on. Euclidean structures like "t(3,8)" work too.',
        ['euclid', 'segment', 'while'],
    ),
    euclidFull: D(
        'Plays one pattern on the hits of a Euclidean rhythm and another on the steps it leaves empty, so every step plays something. As a global it takes both patterns; as a method, the pattern it is called on plays the hits.',
        'euclidFull(3, 8, sound("bd"), sound("hh"))\nsound("bd").euclidFull(3, 8, sound("hh").gain(0.84))',
        undefined,
        ['euclid', 'euclidInv'],
    ),
    samples: D(
        'Loads sample banks: recorded sounds. "github:user/repo" reads the strudel.json manifest of a GitHub repository; a URL loads any strudel.json; an object maps bank names to files. A loaded bank replaces the synth of the same name, and .n() or name:n picks the file.',
        'samples("github:tidalcycles/dirt-samples")\nsound("bd*2 [~ bd:3] sn:2 hh*2")',
        'The first time, the files download in the background; the code runs again once they are loaded. Hover a sound name to see how many files its bank has.',
        ['sound', 'n', 'chop', 'speed', 'begin'],
    ),

    // ---------------- Tempo and transport ----------------
    setCPS: D(
        'Sets the tempo in cycles per second, Tidal\'s unit of tempo. One cycle is usually a bar of four beats, so beats per minute = cps x 60 x 4. 0.5 cps is 120 bpm.',
        'setCPS(0.5)',
        'The tempo field in the top bar shows and changes the same value.',
        ['setTempo', 'setcps'],
    ),
    setcps: D('The same as setCPS(), with TidalCycles\' lower-case name.', 'setcps(0.5)', undefined, ['setCPS']),
    setTempo: D('Sets the tempo in beats per minute, counting four beats per cycle: setTempo(120) is setCPS(0.5).', 'setTempo(128)', undefined, ['setCPS']),
    stopAll: D('Stops every pattern, like the Stop button or the Esc key.', 'stopAll()', undefined, ['hush']),
    hush: D('Silences everything, as in TidalCycles. The same as stopAll().', 'hush()', undefined, ['stopAll']),
    play: D('Starts playing the pattern. Usually not needed: every top-level pattern in the code plays when you press Play.', 'sound("bd sn").play()', undefined, ['stop']),
    stop: D('Stops this pattern only.', undefined, undefined, ['play', 'stopAll']),
    query: D('Returns the events of the pattern between two cycle times, as objects with begin, end and value. For inspecting a pattern; it plays nothing.', 'sound("bd sn").query(0, 1)', undefined, ['firstCycle']),
    firstCycle: D('Returns the events of cycle 0. Handy to check what a pattern does.', 'sound("bd*2 sn").firstCycle()', undefined, ['query']),

    // ---------------- Time ----------------
    fast: D(
        'Speeds the pattern up: fast(2) plays it twice per cycle, fast(0.5) once every two cycles. The factor can be a pattern, so fast("<1 2>") is normal speed one cycle and double speed the next.',
        'sound("bd sn hh cp").fast("<1 2 [1 4]>")',
        'In mini-notation, *n does the same to a single step: "bd*2".',
        ['slow', 'hurry', 'ply', 'density'],
    ),
    slow: D(
        'Slows the pattern down: slow(2) stretches one cycle of it over two cycles. The factor can be a pattern.',
        'sound("arpy*8").note("c e g b c5 b g e").slow(2)',
        'In mini-notation, /n stretches a single step: "bd/2" plays every other cycle.',
        ['fast', 'sparsity'],
    ),
    density: D('The same as fast(), with its older Tidal name.', 'sound("bd sn").density(1.5)', undefined, ['fast']),
    sparsity: D('The same as slow(), with its older Tidal name.', 'sound("bd sn").sparsity(2)', undefined, ['slow']),
    hurry: D(
        'Speeds the pattern up and raises the pitch by the same factor, like playing a record faster: hurry(2) is fast(2) plus speed(2).',
        'sound("bd sn hh cp").every(4, x => x.hurry(2))',
        undefined,
        ['fast', 'speed'],
    ),
    rev: D('Reverses each cycle: the last event of the cycle plays first. The cycles themselves keep their order.', 'sound("arpy*4").note("c e g b").rev()', undefined, ['palindrome', 'iterBack']),
    ply: D('Repeats each event n times within its own span, as Tidal\'s ply: n can be a fraction (2.5 makes two and a half) or a pattern.', 'sound("bd sn").ply("<1 2 2.5>")', undefined, ['plyWith', 'stutter']),
    iter: D(
        'Tidal\'s iter: plays the pattern n times, each time starting one nth further into it, one per cycle (a b c d, then b c d a...). A pattern that changes each cycle is heard n times per change.',
        'sound("bd hh sn cp").iter(4)',
        undefined,
        ['iterBack', 'rot'],
    ),
    iterBack: D('Tidal\'s iter\': like iter(), moving backwards (a b c d, then d a b c...).', 'sound("bd hh sn cp").iterBack(4)', undefined, ['iter']),
    linger: D(
        'Tidal\'s linger: zooms into the first part of each cycle (linger(0.25): the first quarter) and plays it faster to fill the cycle; a negative value takes the end, reversed. Patterns that change each cycle take that part from the following cycles.',
        'sound("bd sn hh cp arpy*2 ~ cp").linger("<0.25 0.5 1>")',
        undefined,
        ['zoom', 'trunc'],
    ),
    rot: D(
        'Keeps the rhythm but shifts the values along the events of each cycle: with rot(1), every event takes the value of the next one. The structure stays, the order of sounds or notes rotates.',
        'sound("bd ~ sn [hh cp]").rot("<0 1 2 3>")',
        undefined,
        ['iter'],
    ),
    late: D(
        'Shifts the pattern later in time by a number of cycles: late(0.25) moves everything a quarter of a cycle later. Events that move past the end of the cycle appear at the start of the next one.',
        'sound("bd sn").superimpose(x => x.late(0.125).gain(0.84))',
        'Tidal writes this as 0.25 ~> pattern.',
        ['early', 'off', 'nudge'],
    ),
    early: D('Shifts the pattern earlier by a number of cycles: early(0.25) is a quarter of a cycle sooner. Tidal writes it as 0.25 <~ pattern.', 'sound("bd sn hh cp").early("<0 0.25>")', undefined, ['late']),
    palindrome: D('Plays the pattern forwards one cycle and backwards the next, alternating.', 'sound("arpy*4").note("c e g b").palindrome()', undefined, ['rev']),
    compress: D(
        'Squeezes each cycle of the pattern into part of the cycle, leaving the rest silent: compress(0.25, 0.75) plays the whole cycle between a quarter and three quarters.',
        'sound("bd sn hh cp").compress(0.5, 1)',
        undefined,
        ['stretch', 'within', 'fast'],
    ),
    stretch: D('Zooms each cycle so its events fill the whole cycle, removing silence at the start and the end.', 'sound("~ ~ bd sn").stretch()', undefined, ['compress']),
    swingBy: D('Swing, as Tidal\'s swingBy x n = inside n (within (0.5, 1) (x ~>)): in each 1/n of a cycle, the second half plays x of a slice later.', 'sound("hh*8").swingBy(1/3, 4)', undefined, ['swing', 'inside']),
    swing: D('Swing with a fixed amount of one third: swing(4) is swingBy(1/3, 4). The number of slices can be a pattern.', 'sound("hh*8").swing(4).overlay("bd ~ sn ~")', undefined, ['swingBy']),
    off: D(
        'Plays a copy of the pattern, shifted later by a time and changed by a function, on top of the original. A classic Tidal way to make echoes and counter-melodies.',
        'sound("arpy*4").note("c e g b").off(0.125, x => x.add(note(12)).gain(0.84))',
        FN_ARG,
        ['superimpose', 'late', 'jux'],
    ),
    nudge: D(
        'Shifts each event in time by a number of seconds (not cycles), without changing the pattern. Small values push sounds ahead of or behind the beat for a human feel.',
        'sound("hh*8").nudge("0 0.01")',
        undefined,
        ['late', 'swingBy'],
    ),

    // ---------------- Conditions ----------------
    every: D(
        'Applies a function every n cycles: every(4, x => x.fast(2)) plays the pattern twice as fast on cycles 0, 4, 8... and unchanged otherwise. n can be a pattern.',
        'sound("bd sn bd sn").every(4, x => x.rev())',
        FN_ARG,
        ['whenmod', 'chunk', 'sometimes'],
    ),
    whenmod: D(
        'Applies a function when the cycle number modulo n is at least offset: whenmod(8, 6, f) applies f on cycles 6 and 7 of every 8. Good for a fill at the end of each phrase.',
        'sound("bd sn hh cp").whenmod(8, 6, x => x.rev())',
        FN_ARG,
        ['every', 'within'],
    ),
    within: D(
        'Applies a function to part of each cycle only, given as begin and end between 0 and 1: within(0, 0.5, f) changes the first half.',
        'sound("hh*8").within(0.5, 1, x => x.speed(2))',
        FN_ARG,
        ['whenmod', 'while', 'compress'],
    ),
    chunk: D(
        'Tidal\'s chunk: divides cycles into n parts and applies the function to one part per cycle, in turn. A negative n goes backwards, from the last part (Tidal deprecated its chunk\' for this).',
        'sound("bd sn hh cp").chunk("<4 -4>", x => x.hurry(2))',
        FN_ARG,
        ['within', 'iter'],
    ),
    while: D(
        'Applies a function wherever a boolean pattern is true: "1 0" changes the first half of each cycle and leaves the second.',
        'sound("hh*8").while("1 0 0 1", x => x.gain(0.74))',
        FN_ARG,
        ['within', 'struct'],
    ),
    until: D('Applies a function until a given cycle, then plays the pattern unchanged. Counts from cycle 0, when you first press Play.', 'sound("bd*4").until(4, x => x.lpf(300))', FN_ARG, ['playFor']),
    playFor: D('Only plays between two cycles: playFor(2, 6) is silent before cycle 2 and from cycle 6 on. Useful to write a short arrangement.', 'sound("cp ~ cp ~").playFor(2, 6)', undefined, ['stopFor', 'until']),
    stopFor: D('Is silent between two cycles and plays the rest of the time.', 'sound("hh*8").stopFor(4, 8)', undefined, ['playFor']),

    // ---------------- Randomness ----------------
    sometimesBy: D(
        'Applies a function to events at random, each with the given probability (a number or a pattern), as Tidal\'s sometimesBy: the events are picked first, then the function changes them, so it may change their rhythm. It uses the same random numbers as degradeBy.',
        'sound("hh*8").sometimesBy(0.3, x => x.speed(2))',
        FN_ARG,
        ['sometimes', 'sometimesByAfter', 'degradeBy'],
    ),
    sometimes: D('Applies a function to about half of the events, chosen at random.', 'sound("hh*8").sometimes(x => x.gain(0.74))', FN_ARG, ['sometimesBy', 'often', 'rarely']),
    often: D('Applies a function to about 75% of the events.', 'sound("hh*8").often(x => x.lpf(2000))', FN_ARG, ['sometimes', 'almostAlways']),
    rarely: D('Applies a function to about 25% of the events.', 'sound("bd*8").rarely(x => x.speed(2))', FN_ARG, ['sometimes', 'almostNever']),
    almostAlways: D('Applies a function to about 90% of the events.', 'sound("hh*8").almostAlways(x => x.lpf(900))', FN_ARG, ['often']),
    almostNever: D('Applies a function to about 10% of the events.', 'sound("sn*4").almostNever(x => x.crush(4))', FN_ARG, ['rarely']),
    degradeBy: D(
        'Removes events at random, each with the given probability: degradeBy(0.3) drops about 30%. Keeps fast hi-hat patterns from sounding mechanical.',
        'sound("hh*16").degradeBy(0.4)',
        'In mini-notation, ? does the same to one step: "hh?0.3".',
        ['degrade', 'unDegradeBy', 'sometimesBy'],
    ),
    degrade: D('Removes about half of the events at random. The same as degradeBy(0.5), or "?" after every step.', 'sound("hh*16").degrade()', undefined, ['degradeBy']),
    unDegradeBy: D(
        'The opposite of degradeBy(): keeps exactly the events degradeBy(amount) would remove. Stack both to split a pattern into two complementary parts.',
        'stack([sound("hh*16").degradeBy(0.5), sound("cp*16").unDegradeBy(0.5)])',
        undefined,
        ['degradeBy'],
    ),
    scramble: D('Divides each cycle into n parts and plays n parts chosen at random, so some parts can repeat and others be skipped.', 'sound("bd sn hh cp").scramble(4)', undefined, ['shuffle', 'bite']),
    shuffle: D('Divides each cycle into n parts and plays all of them in a random order, each once.', 'sound("bd sn hh cp").shuffle(4)', undefined, ['scramble', 'bite']),
    choose: D('A random value from the list at every event, as Tidal\'s choose (a signal: chooseBy(rand, list)).', 'sound("arpy*8").n(choose([0, 2, 4, 7]))', 'segment it to choose on its own rhythm: choose(["bd", "sn"]).segment(4).', ['chooseBy', 'wchoose', 'cycleChoose']),
    wchoose: D('A random value from the list at every event, with weights: [["bd", 3], ["sn", 1]] picks bd three times as often (Tidal\'s wchoose).', 'sound(wchoose([["bd", 3], ["sn", 1]]).segment(8))', undefined, ['choose', 'wchooseBy']),
    cycleChoose: D('One random value from the list per cycle (Tidal\'s cycleChoose = segment 1 . choose).', 'sound("saw").note("c3").vowel(cycleChoose(["a", "e", "i"]))', undefined, ['choose']),

    // ---------------- Rearranging ----------------
    bite: D(
        'Divides each cycle into n parts and plays them in the order of an index pattern: bite(4, "0 2 1 3") swaps the middle two quarters.',
        'sound("arpy*8").note("c d e f g a b c5").bite(4, "0 2 <1 3> 0")',
        undefined,
        ['fitment', 'scramble', 'shuffle'],
    ),
    fitment: D('The same as bite().', 'sound("bd sn hh cp").fitment(4, "0 0 2 1")', undefined, ['bite']),
    chop: D(
        'Cuts each event into n parts, each playing the next slice of the sound (Tidal\'s chop): an event with begin and end is sliced within them. Events longer than a cycle are cut too.',
        'sound("breaks125").loopAt(2).chop(16)',
        undefined,
        ['striate', 'slice', 'begin'],
    ),
    striate: D('Plays the pattern n times per cycle, each time the next slice of every sound (within its own begin and end), interlacing the slices: Tidal\'s striate.', 'sound("breaks125 arpy").striate(4)', undefined, ['chop', 'striateBy']),

    // ---------------- Composition ----------------
    superimpose: D(
        'Plays the pattern and a changed copy of it at the same time. Good for octave doubling, echoes or thickening a part.',
        'sound("arpy*4").note("c e g b").superimpose(x => x.add(note(12)).gain(0.84))',
        FN_ARG,
        ['off', 'jux', 'stack'],
    ),
    overlay: D('Plays another pattern at the same time as this one. A string is read as sounds.', 'sound("bd ~ bd ~").overlay("~ sn ~ sn")', undefined, ['stack']),
    append: D('Plays another pattern after this one: this pattern in one cycle, the other in the next. A string is read as sounds.', 'sound("bd*2").append("sn*3")', undefined, ['cat']),
    jux: D(
        'Plays the pattern panned left and a changed copy panned right. jux(x => x.rev()) is a classic Tidal trick for wide stereo movement.',
        'sound("arpy*8").note(scale("major", "0 .. 7")).jux(x => x.rev())',
        FN_ARG,
        ['juxBy', 'superimpose', 'pan'],
    ),
    juxBy: D('Like jux(), but panned only part of the way: 0 keeps both in the centre, 1 is fully left and right.', 'sound("hh*8").juxBy(0.5, x => x.fast(2))', FN_ARG, ['jux']),
    euclid: D(
        'A Euclidean rhythm: k hits spread as evenly as possible over n steps, rotated by the third number; each hit plays a whole cycle of the pattern squeezed into its step, as Tidal\'s euclid.',
        'sound("bd").euclid(3, 8)',
        'euclid(5, 8) and euclid(7, 16) are classic grooves. k and n can be patterns.',
        ['euclidInv', 'euclidFull', 'necklace'],
    ),
    euclidInv: D('Plays on the steps a Euclidean rhythm leaves empty, the negative of euclid().', 'sound("hh").euclidInv(3, 8)', undefined, ['euclid', 'euclidFull']),
    nTake: D(
        'Gives each played event the next value of a list as n, counting across cycles: the first event gets the first value, the next the second, and so on, wrapping around. The name keeps the count going when the code changes.',
        'sound("~ sn ~ sn*2").nTake("snares", [0, 1, 2, 3])',
        'Tidal\'s nT functions (nTake) work like this.',
        ['n', 'rot'],
    ),
    segment: D(
        'Samples the pattern n times per cycle, turning it into n discrete events. Needed to play a continuous signal such as sine or rand as notes.',
        'sound("sine").freq(saw.range(220, 880).segment(8))',
        undefined,
        ['range', 'struct', 'sine'],
    ),

    // ---------------- Signals ----------------
    sine: D(
        'A continuous sine wave that goes from 0 to 1 and back once per cycle. Signals have no events of their own; use them as values for controls, scaled with .range() and slowed with .slow().',
        'sound("saw*8").lpf(sine.range(300, 3000).slow(4))',
        'Inside a sound string, sine is a synth instead.',
        ['cosine', 'saw', 'tri', 'range', 'segment'],
    ),
    cosine: D('A sine wave shifted by a quarter cycle: it starts at its peak (1) and falls. Use it with sine for two values moving out of step.', 'sound("hh*8").pan(cosine.range(-1, 1))', undefined, ['sine']),
    saw: D('A ramp that rises from 0 to 1 over each cycle, then jumps back. Good for sweeps that start over every cycle.', 'sound("arpy*8").speed(saw.range(1, 2))', 'Inside a sound string, saw is a sawtooth synth instead.', ['isaw', 'sine']),
    isaw: D('A ramp that falls from 1 to 0 over each cycle: the inverse of saw.', 'sound("hh*16").gain(isaw.range(0.67, 1))', undefined, ['saw']),
    tri: D('A triangle wave: rises from 0 to 1 in the first half of the cycle and falls back in the second.', 'sound("saw*8").lpf(tri.range(400, 2400))', 'Inside a sound string, tri is a triangle synth instead.', ['sine', 'saw']),
    square: D('A square wave: 0 for the first half of the cycle and 1 for the second.', 'sound("hh*8").pan(square.range(-0.7, 0.7))', 'Inside a sound string, square is a square-wave synth instead.', ['tri']),
    rand: D(
        'A random value from 0 to 1, different at every moment but the same each time that moment is played. Use it to vary controls.',
        'sound("hh*16").gain(rand.range(0.74, 1))',
        undefined,
        ['irand', 'perlin', 'degradeBy'],
    ),
    irand: D('Random whole numbers from 0 to n-1. Handy for picking sample variations or scale degrees.', 'sound("arpy*8").note(irand(12))', undefined, ['rand']),
    perlin: D('Smooth random values from 0 to 1 that drift gradually, changing direction once per cycle. Sounds more organic than rand.', 'sound("hh*8").pan(perlin.range(-1, 1))', undefined, ['rand', 'sine']),
    range: D(
        'Scales values from 0..1 to lo..hi. Signals go from 0 to 1, so range() turns them into useful values: sine.range(200, 2000) for a filter cutoff in Hz.',
        'sound("saw*8").lpf(sine.range(200, 2000).slow(8))',
        undefined,
        ['segment', 'quantise'],
    ),
    quantise: D('Rounds numbers to steps of 1/n (whole numbers by default), as Tidal\'s quantise; halves go to the even neighbour, as Haskell\'s round.', 'sound("arpy*8").note(sine.range(0, 12).segment(8).quantise())', undefined, ['range', 'qfloor']),
    quantize: D('The same as quantise().', undefined, undefined, ['quantise']),
    smooth: D('Turns a stepped numeric pattern into a continuous one that glides between the values. Useful for slides of filters or volumes.', 'sound("saw*16").lpf(rand.range(300, 3000).segment(2).smooth())', undefined, ['range']),
    bus: D(
        'A signal that reads a value set by setBus(). Lets you change a control while the music plays, without re-running the pattern.',
        'sound("saw*8").lpf(bus("cut", 800))\nsetBus("cut", 2000)',
        undefined,
        ['setBus'],
    ),
    setBus: D('Sets the value that bus(name) reads. Run it on its own (select the line and press Ctrl+Enter) to change the sound live.', 'setBus("cut", 1200)', undefined, ['bus']),

    // ---------------- Notes and harmony ----------------
    note: D(
        'Sets the pitch: note names (c, e, g#, eb3, with octave 4 by default), numbers (semitones from middle C, so 0 is c4 and 12 is c5) or chords like "c\'maj". Works on synths and transposes samples.',
        'sound("tri").note("c e g <b a>")',
        'Chords: root\'name\'modifiers, e.g. "e\'min7\'i" for the first inversion of E minor seventh.',
        ['n', 'up', 'scale', 'chord', 'midinote'],
    ),
    n: D('For banks of samples and drums (bd, sn, hh...), picks one: n(3) is the fourth. For synths (sine, saw, the super... synths), n is the note in semitones from middle C, as in SuperDirt (where the note is note, else n).', 'sound("superpiano*4").n("0 4 7 12")', undefined, ['note', 'sound']),
    up: D('Tidal\'s up: the same as note(). To transpose notes, add to them: .add(note(12)) is an octave up.', 'sound("arpy").up("0 4 7")', 'In Tidal, up = note, so .note("c e").up(12) replaces the notes; use .add(note(12)) to transpose.', ['note', 'add']),
    freq: D('Sets the pitch directly as a frequency in Hz. 440 is the A above middle C.', 'sound("sine").freq("220 330 440 660")', undefined, ['note', 'midinote']),
    midinote: D('Sets the pitch as a MIDI note number: 60 is middle C, 69 is A440, one step per semitone.', 'sound("saw").midinote("48 55 60 63")', undefined, ['note', 'freq']),
    scale: D(
        'Turns scale degrees into notes. 0 is the root, 1 the second note of the scale and so on; negative degrees go down and degrees past the scale continue in the next octave. The name can include a root, like "e:minor", and can itself be a pattern.',
        'sound("arpy*8").note(scale("<c:major a:minor>", "0 2 4 <7 9>"))',
        'Hover a scale name to see its notes. scaleList() returns all the names.',
        ['note', 'chord', 'arp', 'scaleList'],
    ),
    scaleList: D('Returns the names of every scale scale() knows: major, minor, the church modes, pentatonics, blues and many more.', 'scaleList()', undefined, ['scale']),
    chord: D(
        'A pattern of chords written as root\'name, e.g. "c\'maj e\'min7". Each chord plays all its notes at once. Add \'i to invert, \'o to open the voicing, or a number for the note count.',
        'sound("saw").note(chord("<c\'maj a3\'min f3\'maj g3\'dom7>")).legato(1)',
        'The same chord words work directly in note("...").',
        ['arp', 'inversion', 'chordList', 'note'],
    ),
    chordList: D('Returns the names of every chord: major, minor, maj7, dom7, min7, dim, aug, sus2, sus4 and more.', 'chordList()', undefined, ['chord']),
    arp: D(
        'Plays the notes of each chord one after another, in the order of the chord (as Tidal: it does not sort them). Modes: up, down, updown, downup, up&down, down&up, converge, diverge, disconverge, pinkyup, pinkyupdown, thumbup, thumbupdown. The mode can be a pattern.',
        'sound("arpy").note("<c\'maj e\'min>").arp("<up updown converge>")',
        undefined,
        ['chord', 'rolled'],
    ),
    arpeggiate: D('The same as arp().', undefined, undefined, ['arp']),
    inversion: D('Inverts chords: raises the lowest note of each chord by an octave, n times. Smooths the movement between chords.', 'sound("tri").note("<c\'maj f\'maj g\'maj>").inversion(1).legato(1)', undefined, ['chord', 'arp']),
    fit: D(
        'Picks values from a list by an index pattern, shifting the list by step every cycle. fit(1, ["bd", "sn", "hh"], "0 1") plays bd sn, then sn hh, then hh bd...',
        'sound(fit(1, ["bd", "sn", "hh", "cp"], "0 1 2 1"))',
        undefined,
        ['bite', 'choose'],
    ),

    // ---------------- Effects ----------------
    gain: D('The volume, as in SuperDirt: the sound is multiplied by gain to the power of 4, so 1 is normal, 0.8 about 4 dB quieter, 0.5 a sixteenth (-24 dB) and up to 2 louder. Patterns of gain make accents.', 'sound("hh*8").gain("1 0.8 0.9 0.8")', 'The curve makes small changes count: 0.9 is already -2 dB. amp() is linear.', ['amp', 'pan', 'velocity']),
    pan: D('Sets the stereo position: -1 is fully left, 0 the centre and 1 fully right.', 'sound("hh*8").pan(sine.range(-1, 1))', 'TidalCycles uses 0 to 1 for pan; here it is -1 to 1.', ['jux', 'juxBy']),
    lpf: D(
        'A low-pass filter: lets frequencies below the cutoff (in Hz) through and removes the ones above, making the sound darker. Sweep it with a signal for the classic filter sweep.',
        'sound("saw*8").note("c2 c3").lpf(sine.range(300, 3000).slow(4))',
        'Raise resonance() to make the cutoff sing.',
        ['cutoff', 'hpf', 'bpf', 'resonance'],
    ),
    cutoff: D('The same as lpf(): low-pass filter cutoff in Hz.', 'sound("saw*4").cutoff(800)', undefined, ['lpf']),
    hpf: D('A high-pass filter: removes frequencies below the cutoff (in Hz), making the sound thinner. Useful to keep hats and claps out of the bass.', 'sound("cp*2").hpf(1500)', undefined, ['hcutoff', 'lpf', 'bpf']),
    hcutoff: D('The same as hpf(): high-pass filter cutoff in Hz.', 'sound("hh*4").hcutoff(3000)', undefined, ['hpf']),
    bpf: D('A band-pass filter: keeps only the frequencies around a centre (in Hz). Gives a telephone or radio sound.', 'sound("arpy*4").bpf("<500 1000 2000>")', undefined, ['bandf', 'lpf', 'hpf']),
    bandf: D('The same as bpf(): band-pass filter centre in Hz.', 'sound("saw*4").bandf(1200)', undefined, ['bpf']),
    resonance: D('The resonance of the low-pass filter, as in SuperDirt, from 0 (none) to 1 (a peak of 60 dB at the cutoff): the filter is RLPF with rq = resonance.linexp(0, 1, 1, 0.001). 0.2 to 0.5 gives a squelchy, acid sound.', 'sound("saw*16").lpf(sine.range(300, 2000)).resonance(0.3)', 'Below 0 (an extension) it damps the cutoff: resonance(Math.log10(1 / rq) / 3) gives SuperCollider\'s rq, e.g. -0.1 for rq 2.', ['lpf', 'hpq']),
    delay: D('The level of the orbit\'s delay, 0 to 1, as in SuperDirt: every sound of an orbit feeds one delay, and each event sets its level (an event without delay sets 0), so put patterns with different delays on different orbits.', 'sound("cp ~ ~ ~").delay(0.6).delaytime(0.25).delayfeedback(0.5)', undefined, ['delaytime', 'delayfeedback', 'orbit']),
    reverb: D('The amount of the orbit\'s reverb, 0 to 1, as SuperDirt\'s room: every sound of an orbit feeds one reverb, and each event that has room sets how much goes in. size() is how long it rings.', 'sound("sn ~ arpy ~").note("c e").room(0.6).size(0.9)', 'Put patterns with different reverbs on different orbits.', ['room', 'size', 'dry', 'orbit']),
    room: D('The same as reverb(): the amount of the orbit\'s reverb, 0 to 1, as in TidalCycles.', 'sound("cp*2").room(0.4)', undefined, ['reverb', 'size']),
    size: D('The size of the orbit\'s reverb, 0 to 1 (0.1 at first, as in SuperDirt): larger rings longer.', 'sound("arpy").room(0.5).size(0.95)', undefined, ['room', 'dry']),
    orbit: D(
        'Chooses the effect bus: sounds on the same orbit share one delay and one reverb. Put parts with different reverb sizes or delay times on different orbits so they do not affect each other.',
        'stack([sound("bd*4"), sound("cp").room(0.8).size(1).orbit(1)])',
        undefined,
        ['delay', 'reverb'],
    ),
    distortion: D('Waveshaping distortion, from 1 (subtle) to 100 (extreme). Adds grit to kicks and basses.', 'sound("bd sn bd sn").distortion("<1 10 50>")', undefined, ['crush']),
    crush: D('A bit crusher, as SuperDirt\'s: rounds the sound to steps of 0.5^(crush - 1), from 16 (clean) to 1 (very harsh); fractions work.', 'sound("arpy*4").note("c e g b").crush("<16 8 4.5 2>")', undefined, ['distortion', 'coarse']),
    vowel: D('A formant filter that makes the sound say a vowel: a, e, i, o or u. Works best on bright sounds like saw.', 'sound("saw").note("c3 e3 g3").vowel("<a e i o u>")', undefined, ['bpf']),

    // ---------------- Sound shaping ----------------
    speed: D(
        'Playback speed: 2 plays twice as fast and an octave higher, 0.5 slower and an octave lower. A negative speed plays a sample backwards.',
        'sound("bd*4").speed("1 2 0.5 -1")',
        undefined,
        ['up', 'hurry', 'note'],
    ),
    begin: D('Starts the sound part way into it, from 0 (the start) to 1 (the end). Use it with end() to play a slice of a sample.', 'sound("breaks125").begin("0 0.25 0.5 0.75").end("0.25 0.5 0.75 1")', undefined, ['end', 'chop']),
    end: D('Stops the sound part way through, from 0 to 1: end(0.5) plays only the first half.', 'sound("cy*4").end(0.3)', undefined, ['begin']),
    loop: D('As in SuperDirt: a sample plays its begin..end part over and over, loop times in all (fractions work, 1.5 is one and a half); legato or sustain cut it shorter. Synths repeat their note.', 'sound("cp").loop(3)', undefined, ['begin', 'end']),
    legato: D(
        'How long each sound lasts relative to its step: 1 holds it for the whole step, 0.5 half, 2 overlaps the next step. For synth notes this sets the note length; for samples it cuts them off.',
        'sound("tri*4").note("c e g b").legato("<0.2 1>")',
        undefined,
        ['sustain', 'release'],
    ),
    sustain: D('How long each sound lasts, in seconds, whatever the length of its step.', 'sound("saw*2").note("c2").sustain(0.5)', undefined, ['legato']),
    attack: D('Fade-in time in seconds: higher values make a soft, swelling start, like a pad.', 'sound("tri").note("c\'maj").attack(0.3).legato(1)', undefined, ['release', 'legato']),
    release: D('Fade-out time in seconds after the sound ends: higher values let notes ring and blend.', 'sound("tri*4").note("c e g b").release(0.4)', undefined, ['attack', 'legato']),

    // ---------------- Output ----------------
    midi: D(
        'Sends the events to a MIDI output instead of playing them, so the pattern can drive a synth, DAW or drum machine. The output is an index or a name; notes come from note(), velocity from vel().',
        'sound("arpy*3").note("c e g").midi(0).vel(0.8)',
        'The browser asks for permission the first time. midiOutputs() lists the outputs.',
        ['midiOutputs', 'vel', 'midichan', 'ccn'],
    ),
    vel: D('MIDI velocity: how hard the note is played, 0 to 1 or 0 to 127.', 'sound("arpy*3").note("c e g").midi(0).vel("0.9 0.5 0.7")', undefined, ['velocity', 'midi', 'gain']),
    velocity: D('The same as vel().', undefined, undefined, ['vel']),
    ccn: D('The MIDI control change number to send, 0 to 127 (74 is often filter cutoff). Use it with ccv().', 'sound("arpy*16").ccn(74).ccv(sine.range(0, 127).segment(16)).midi(0)', undefined, ['ccv', 'midi']),
    ccv: D('The MIDI control change value, 0 to 127, sent to the controller set by ccn().', undefined, undefined, ['ccn', 'midi']),
    pgm: D('Sends a MIDI program change, 0 to 127, to switch the instrument preset.', 'sound("arpy").note("c").pgm(5).midi(0)', undefined, ['midi']),
    midichan: D('The MIDI channel, 0 to 15 (channels 1 to 16 in most devices).', 'sound("arpy*2").note("c e").midi(0).midichan(9)', undefined, ['midi']),
    midiOutputs: D('Returns the names of the MIDI outputs the browser can see, for .midi(name).', 'midiOutputs()', undefined, ['midi']),
    osc: D(
        'Sends each event as an OSC message through a WebSocket bridge, for example to SuperDirt (the sound engine of TidalCycles) or other music software. The default address is /dirt/play.',
        'sound("bd sn").osc()',
        'Set the bridge with setOscUrl() first.',
        ['setOscUrl', 'midi'],
    ),
    setOscUrl: D('Sets the WebSocket URL of the OSC bridge that .osc() sends to.', 'setOscUrl("ws://localhost:8080")', undefined, ['osc']),
    record: D('Starts recording the audio output, like the Record button.', 'record()', undefined, ['stopRecording']),
    stopRecording: D('Stops recording and downloads the audio file.', 'stopRecording()', undefined, ['record']),
    exportPattern: D(
        'Downloads a number of cycles of a pattern as a file: "json" with every event, or "midi" as a standard MIDI file you can open in a DAW.',
        'exportPattern(sound("arpy*4").note("c e g b"), 8, "midi")',
        undefined,
        ['record'],
    ),

    // ---------------- JavaScript ----------------
    const: D('Declares a constant: a name for a value that does not change. Use it to reuse a melody or a part in several places.', 'const melody = "c e g b"\nsound("arpy").note(melody)'),
    let: D('Declares a variable: a name for a value that can change later in the code.', 'let speed = 2'),
};

// Aliases that only point elsewhere.
DOCS.withValue = D('Changes every value of the pattern with a function, e.g. .withValue(v => ({ ...v, gain: 0.5 })). For advanced use.');

const CONTROL_ARG = 'Every control is also a function on its own, as in Tidal: n("0 2"), speed(2). Combine those with .set() or a sound: n("0 2").sound("drum").';

// ---------------- More of Tidal's library ----------------
Object.assign(DOCS, {
    // Combining
    set: D(
        'Tidal\'s # operator: keeps the rhythm of this pattern and adds (or replaces) the controls of another. The other pattern can be a control pattern such as speed("1 2"), or an object like { gain: 0.8 }.',
        'sound("bd*4").set(speed("1 2"))\nsound("arpy*4").set(note("<c e g>"))',
        CONTROL_ARG,
        ['add', 'mul'],
    ),
    add: D(
        'Tidal\'s |+ operator: adds numbers, keeping the rhythm of this pattern. Controls add key by key: note("0 4").add(note("<0 12>")) adds an octave every other cycle. A plain whole number is n and a fraction is speed, as in Tidal; strings keep the left value.',
        'sound("arpy*4").note("c e g b").add(note("<0 5 7>"))',
        'Notes add as semitones, so .add(note("12")) is an octave up.',
        ['sub', 'mul', 'set'],
    ),
    sub: D('Tidal\'s |-: subtracts numbers, key by key, keeping the rhythm of this pattern.', 'sound("arpy*4").note("c5 e5 g5 b5").sub(note("<0 12>"))', undefined, ['add']),
    mul: D('Tidal\'s |*: multiplies numbers, key by key, keeping the rhythm of this pattern. Handy for speeds and gains.', 'sound("bd*4").speed(1).mul(speed("<1 2>"))', undefined, ['div', 'add']),
    div: D('Tidal\'s |/: divides numbers, key by key, keeping the rhythm of this pattern.', 'sound("hh*4").speed(2).div(speed("1 2"))', undefined, ['mul']),
    mod: D('Tidal\'s |%: the remainder of a division, key by key. Keeps values inside a range: n("0 .. 7").mod(4).', 'n("0 .. 7").mod(4).sound("arpy")', undefined, ['add']),
    pow: D('Raises numbers to a power, key by key.', 'sound("hh*4").speed(2).pow(speed("1 2"))', undefined, ['mul']),

    // Structure
    brak: D(
        'Makes a breakbeat feel: every other cycle is squashed into its first half and shifted a quarter cycle later.',
        'sound("bd sn hh cp").brak()',
        undefined,
        ['swing', 'press'],
    ),
    mask: D('Keeps only the events where a boolean pattern is true: "1 0 1 1" removes the second quarter. Unlike struct, the rhythm stays this pattern\'s.', 'sound("hh*16").mask("<1 [0 1]> 1 0 1")', undefined, ['struct', 'sew', 'inv']),
    inv: D('Inverts a boolean pattern: true becomes false and false becomes true.', 'sound("hh*8").mask(binary(37).inv())', undefined, ['mask', 'binary']),
    sew: D(
        'Switches between two patterns with a boolean pattern: this one where it is true, the other where it is false. Both keep their own rhythm.',
        'sound("bd*8").sew("t <f t> f t", sound("hh*16"))',
        'Also a global: sew(booleans, a, b).',
        ['stitch', 'mask', 'wedge'],
    ),
    stitch: D(
        'Builds a rhythm from a boolean pattern: true steps play a value from this pattern, false steps one from the other.',
        'sound("bd").stitch("t f t t f t f f", sound("sn"))',
        'Also a global: stitch(booleans, a, b).',
        ['sew', 'struct'],
    ),
    wedge: D('Squashes this pattern into the first part of each cycle and another into the rest: wedge(0.25, other) gives this pattern a quarter.', 'sound("bd*4").wedge(0.75, sound("hh*8"))', 'Also a global: wedge(time, a, b).', ['fastcat', 'compress']),
    euclidOff: D('A Euclidean rhythm rotated left by `rotation` steps (Tidal\'s euclidOff): the same as euclid(k, n, rotation).', 'sound("bd").euclidOff(3, 8, 2)', undefined, ['euclid', 'eoff']),
    eoff: D('Short for euclidOff.', 'sound("cp").eoff(3, 8, 2)', undefined, ['euclidOff']),
    euclidOffFull: D('euclidOff on the hits and another pattern on the rests.', 'sound("bd").euclidOffFull(3, 8, 2, sound("hh"))', undefined, ['euclidFull']),
    zoom: D('Zooms into part of each cycle: zoom(0.25, 0.75) plays the middle half of every cycle, stretched to fill it.', 'sound("bd*2 sn hh*4 cp").zoom(0.25, 0.75)', undefined, ['compress', 'linger']),
    zoomArc: D('The same as zoom().', undefined, undefined, ['zoom']),
    fastGap: D('Squashes each cycle into its first 1/n and leaves the rest silent: unlike fast, nothing repeats.', 'sound("bd sn hh cp").fastGap("<1 2>")', undefined, ['fast', 'compress']),
    densityGap: D('The same as fastGap().', undefined, undefined, ['fastGap']),
    trunc: D('Plays only the first part of each cycle: trunc(0.75) cuts the last quarter off.', 'sound("bd sn hh cp").trunc("<1 0.75 0.5>")', undefined, ['linger', 'fastGap']),
    repeatCycles: D('Repeats each cycle n times before moving on to the next.', 'sound("<bd sn cp hh>*4").repeatCycles(2)', undefined, ['loopFirst', 'linger']),
    loopFirst: D('Plays the first cycle of the pattern over and over.', 'sound("<bd sn cp>*4").loopFirst()', undefined, ['repeatCycles']),
    press: D('Moves every event to the second half of its step, so the pattern plays on the off-beats.', 'sound("hh*4").press().overlay("bd*4")', undefined, ['pressBy', 'late']),
    pressBy: D('Moves every event later by a fraction of its own step (and shortens it): pressBy(0.5) is press().', 'sound("hh*4").pressBy("<0 0.25 0.5>")', undefined, ['press']),
    plyWith: D('Repeats each event n times within its span; each repeat applies fn once more (Tidal\'s plyWith). Chord notes are spread out too, and a fraction makes one more repeat (2.4 makes three).', 'sound("arpy").note("c e").plyWith(3, x => x.gain(0.8))', undefined, ['ply', 'echoWith']),
    rolled: D('Strums chords: instead of all at once, their notes start one after another, in the chord\'s order, over the first quarter of the event.', 'sound("tri").note("<c\'maj e\'min7 f\'maj>").rolled().legato(1)', undefined, ['rolledBy', 'arp']),
    rolledBy: D('Strums chords by an amount of the event: rolledBy(0.5) spreads the notes over half of it; a negative amount strums them in reverse order.', 'sound("tri").note("<c\'maj\'5 a\'min\'5>").rolledBy("<0.25 -0.5>")', undefined, ['rolled', 'arp']),

    // Conditions
    when: D('Applies a function on the cycles for which a test of the cycle number is true: when(c => c % 4 === 3, f) changes every fourth cycle.', 'sound("bd sn hh cp").when(c => c % 4 === 3, x => x.fast(2))', 'Tidal writes the test as ((elem \'4\') . show) or similar; here it is a JavaScript function.', ['ifp', 'every', 'whenmod']),
    ifp: D('Applies one function on the cycles a test accepts and another on the rest.', 'sound("bd sn hh cp").ifp(c => c % 2 === 0, x => x.rev(), x => x.fast(2))', undefined, ['when']),
    foldEvery: D('Tidal\'s foldEvery: every() nested for each number, so foldEvery([3, 5], f) applies f on cycles divisible by 3 or 5, and twice on cycles divisible by both.', 'sound("bd sn").foldEvery([3, 5], x => x.fast(2))', undefined, ['every']),
    someCyclesBy: D('Applies a function to whole cycles at random, each with the given probability. sometimesBy decides per event; this decides per cycle.', 'sound("bd*8").someCyclesBy(0.3, x => x.speed(2))', undefined, ['someCycles', 'sometimesBy']),
    someCycles: D('Applies a function to about half of the cycles, chosen at random.', 'sound("hh*8").someCycles(x => x.hpf(4000))', undefined, ['someCyclesBy']),
    somecyclesBy: D('The same as someCyclesBy().', undefined, undefined, ['someCyclesBy']),
    somecycles: D('The same as someCycles().', undefined, undefined, ['someCycles']),
    always: D('Always applies the function: the same as calling it. Useful to switch a change on and off by renaming always to never.', 'sound("bd sn").always(x => x.fast(2))', undefined, ['never']),
    never: D('Never applies the function: the pattern plays unchanged. Rename it to always to switch the change on.', 'sound("bd sn").never(x => x.fast(2))', undefined, ['always']),
    inside: D('Applies a function inside each part of the cycle: inside(2, x => x.rev()) reverses each half cycle instead of the whole cycle.', 'sound("bd sn hh cp").inside(2, x => x.rev())', undefined, ['outside', 'within']),
    outside: D('Applies a function over several cycles at once: outside(2, x => x.rev()) reverses each pair of cycles.', 'sound("<[bd sn] [hh cp]>").outside(2, x => x.rev())', undefined, ['inside']),
    fix: D('Applies a function only to the events with the given controls: fix(x => x.fast(2), { s: "bd" }) doubles the kicks only. A list matches any of its values.', 'sound("bd sn hh cp").fix(x => x.speed(2), { s: ["sn", "cp"] })', undefined, ['unfix', 'contrast']),
    unfix: D('Applies a function to the events without the given controls.', 'sound("bd sn hh cp").unfix(x => x.gain(0.84), { s: "bd" })', undefined, ['fix']),
    contrast: D('Applies one function to the events with the given controls and another to the rest.', 'sound("bd sn hh cp").contrast(x => x.speed(2), x => x.gain(0.8), { s: "bd" })', undefined, ['fix']),
    spread: D(
        'Applies a function with each value of a list in turn, one per cycle: spread((p, x) => p.fast(x), [1, 2, 4]) is normal speed, then double, then four times.',
        'sound("bd sn").spread((p, x) => p.fast(x), [1, 2, 4])',
        'Tidal writes spread fast [1, 2, 4]; in JavaScript the function takes the pattern and the value.',
        ['fastspread', 'spreadChoose', 'pickF'],
    ),
    slowspread: D('The same as spread().', undefined, undefined, ['spread']),
    fastspread: D('Like spread(), with all the values squeezed into one cycle.', 'sound("bd sn").fastspread((p, x) => p.speed(x), [1, 2])', undefined, ['spread']),
    spreadChoose: D('Like spread(), picking a value at random each cycle.', 'sound("bd sn").spreadChoose((p, x) => p.fast(x), [1, 2, 4])', undefined, ['spread']),
    spreadr: D('The same as spreadChoose().', undefined, undefined, ['spreadChoose']),
    pickF: D('Applies one of a list of functions, chosen by an index pattern.', 'sound("bd sn hh cp").pickF("<0 1 2>", [x => x.rev(), x => x.fast(2), x => x.hurry(2)])', 'Also a global: pickF(indices, fns, pattern).', ['selectF', 'spread']),
    selectF: D('Applies one of a list of functions, chosen by a number from 0 to 1 (a signal works too).', 'sound("bd sn hh cp").selectF("<0 0.5>", [x => x.rev(), x => x.fast(2)])', undefined, ['pickF', 'select']),
    soak: D('Applies a function once more each cycle, for n cycles, then starts over: soak(3, f) plays p, f(p), f(f(p)).', 'sound("bd sn").soak(4, x => x.fast(1.5))', undefined, ['iter', 'every']),

    // Randomness
    fadeOut: D('Fades the pattern out over n cycles by dropping more and more events at random, counting from when you start playing.', 'sound("hh*16").fadeOut(8)', undefined, ['fadeIn', 'degradeBy']),
    fadeIn: D('Fades the pattern in over n cycles: it starts silent and adds events at random until all play.', 'sound("hh*16").fadeIn(8)', undefined, ['fadeOut']),
    fadeOutFrom: D('Like fadeOut(), starting at a given cycle.', 'sound("hh*16").fadeOutFrom(4, 8)', undefined, ['fadeOut']),
    fadeInFrom: D('Like fadeIn(), starting at a given cycle.', 'sound("hh*16").fadeInFrom(4, 8)', undefined, ['fadeIn']),
    stripe: D('Divides each cycle into n segments of random length and plays a whole cycle of the pattern in each, so the speed changes at random.', 'sound("bd sn hh cp").stripe(2)', undefined, ['slowstripe', 'shuffle']),
    slowstripe: D('Like stripe(1), spread over n cycles.', 'sound("bd sn hh cp").slowstripe(2)', undefined, ['stripe']),

    // Echoes
    echo: D(
        'Echoes: count sounds in all, `time` cycles apart, each with feedback times the gain of the one before.',
        'sound("cp ~ ~ ~").echo(4, 0.2, 0.5)',
        'Unlike delay(), the echoes are events, so they follow the tempo and can be changed like any pattern.',
        ['echoWith', 'stutter', 'delay'],
    ),
    echoWith: D('Echoes changed by a function, as Tidal\'s echoWith: each echo is the previous result shifted `time` cycles later, then changed by the function.', 'sound("arpy").note("c e").echoWith(4, 1/8, x => x.add(note(7)).gain(0.9))', undefined, ['echo', 'plyWith', 'off']),
    stutter: D('Repeats each sound n times, `time` cycles apart, at the same volume: a stutter or roll.', 'sound("sn").stutter(4, 1/16)', undefined, ['echo', 'ply']),
    ghost: D('Adds two ghost notes after each event: quieter, shorter and a little higher, like a drummer\'s ghost strokes.', 'sound("~ sn").ghost().overlay("bd*2")', undefined, ['ghostWith']),
    ghostWith: D('Adds ghost notes changed by a function, 1.5 and 2.5 times `time` after each event.', 'sound("~ sn").ghostWith(1/8, x => x.gain(0.84).speed(2))', undefined, ['ghost', 'off']),

    // Values
    rangex: D('Like range(), but exponential: better for frequencies, where each octave doubles.', 'sound("saw*8").lpf(sine.rangex(100, 5000).slow(4))', undefined, ['range']),
    qfloor: D('Rounds numbers down to steps of 1/n (whole numbers by default).', 'n(sine.range(0, 8).segment(8).qfloor()).sound("arpy")', undefined, ['qceiling', 'quantise']),
    qceiling: D('Rounds numbers up to steps of 1/n (whole numbers by default).', 'n(sine.range(0, 8).segment(8).qceiling()).sound("arpy")', undefined, ['qfloor', 'quantise']),
    qround: D('Rounds numbers to steps of 1/n: the same as quantise(n).', undefined, undefined, ['quantise']),
    toScale: D(
        'Turns numbers into notes of a scale given as semitones: with [0, 2, 4, 5, 7, 9, 11] (major), 0 1 2 is c d e and 7 is the c an octave up.',
        'note(toScale([0, 2, 4, 7, 9], "0 .. 7")).sound("arpy")',
        'As a method: note(run(8).toScale([0, 3, 7])). scale() does the same with scale names.',
        ['scale', 'run'],
    ),
    run: D('The numbers 0 to n-1 in one cycle: run(4) is "0 1 2 3". n can be a pattern.', 'n(run("<4 8>")).sound("arpy")', undefined, ['scan', 'irand']),
    scan: D('run(1), then run(2), and so on up to run(n), one per cycle: a pattern that grows.', 'note(scan(8)).sound("arpy")', undefined, ['run']),

    // Samples
    slice: D(
        'Cuts each sample into n slices and plays the ones an index pattern picks, in the rhythm of the index pattern: slice(4, "0 2") plays the first and third quarters.',
        'sound("breaks125").slice(8, "0 <2 5> 4 [6 7]")',
        undefined,
        ['splice', 'chop', 'randslice'],
    ),
    splice: D('Like slice(), with each slice sped up or slowed down to fill its step exactly: good for breakbeats at any tempo.', 'sound("breaks125").splice(8, "0 1 [2 3] 4")', undefined, ['slice', 'loopAt']),
    randslice: D('Plays a random slice (out of n) of each sample.', 'sound("breaks125*8").randslice(8)', undefined, ['slice']),
    loopAt: D(
        'Fits each sample to n cycles by changing its speed, and slows the pattern to match: loopAt(2) makes a loop last two cycles, whatever the tempo.',
        'sound("breaks125").loopAt(2).chop(16)',
        'Uses unit("c"): speed counted in cycles.',
        ['splice', 'chop', 'unit'],
    ),
    smash: D('Cuts each sample into n slices with striate and plays them at several speeds, one per cycle.', 'sound("breaks125").smash(4, [2, 3, 4])', undefined, ['striate', 'spin']),
    spin: D('Plays n copies, each shifted by 1/n of a cycle and placed further across the stereo field.', 'sound("arpy*4").note("c e g b").spin(2)', undefined, ['jux', 'off']),
    striateBy: D('Like striate(), with slices of a given length (0 to 1) that can overlap, taken within each event\'s own begin and end.', 'sound("breaks125").striateBy(8, 0.25)', undefined, ['striate', 'chop']),

    // Triggers
    qtrigger: D('Restarts the pattern from its first cycle at the next cycle after the code runs, so a sequence starts at its beginning instead of the middle.', 'sound("<bd sn cp hh>").qtrigger()', 'Each time the code runs (Play or a live update), it restarts.', ['trigger', 'once']),
    qt: D('Short for qtrigger().', undefined, undefined, ['qtrigger']),
    trigger: D('Restarts the pattern from its beginning at the very moment the code runs, mid-cycle if need be.', 'sound("bd sn hh cp").trigger()', undefined, ['qtrigger']),
    once: D('Plays one cycle of the pattern once, right away, without adding it to what is playing: a random cycle, as Tidal\'s once. first() plays the first cycle.', 'once(sound("cp*4").speed(2))', undefined, ['first', 'qtrigger']),

    // Lists and generators
    markovPat: D(
        'A Markov chain: n states per cycle, starting from a given state each cycle; each next state is picked with the probabilities in its row of the matrix.',
        'n(markovPat(8, 0, [[0.3, 0.7], [0.6, 0.4]])).sound("arpy")',
        undefined,
        ['irand', 'chooseBy'],
    ),
    lindenmayer: D('Grows a string with L-system rules: lindenmayer(3, "a:b,b:ab", "a") applies the rules three times. Use the result as a mini-notation pattern.', 'sound(lindenmayer(4, "x:x y,y:x ~", "x").replace(/x/g, "bd").replace(/y/g, "hh"))', undefined, ['markovPat']),
    fromList: D('One value per cycle from a list.', 'sound(fromList(["bd", "sn", "hh"]))', undefined, ['fastFromList', 'cat']),
    fastFromList: D('All the values of a list in one cycle.', 'sound(fastFromList(["bd", "sn", "hh"]))', undefined, ['fromList', 'fastcat']),
    listToPat: D('The same as fastFromList().', undefined, undefined, ['fastFromList']),
    fromMaybes: D('All the values of a list in one cycle, with null for a rest.', 'sound(fromMaybes(["bd", null, "sn", "sn"]))', undefined, ['fastFromList']),
    timeCat: D('Patterns in one cycle, each with a relative length: [[1, a], [2, b]] gives b two thirds of the cycle.', 'timeCat([[1, sound("bd*4")], [1, sound("hh*8")], [2, sound("arpy").note("c e")]])', 'In mini-notation, @ does the same for single steps.', ['fastcat', 'wedge']),
    timecat: D('The same as timeCat().', undefined, undefined, ['timeCat']),
    wrandcat: D('Plays a random pattern each cycle, with weights: [[a, 3], [b, 1]] plays a three times as often as b.', 'wrandcat([[sound("bd*2 sn"), 3], [sound("bd sn*2"), 1]])', undefined, ['randcat']),
    binary: D('The eight bits of a number as a boolean pattern: binary(5) is f f f f f t f t.', 'sound("hh*8").struct(binary("<5 120 77>"))', undefined, ['binaryN', 'ascii', 'struct']),
    binaryN: D('The bits of a number as a boolean pattern, with a given number of bits.', 'sound("cp*16").struct(binaryN(16, 4321))', undefined, ['binary']),
    ascii: D('The bits of the characters of a text as a boolean pattern: text as rhythm.', 'sound("hh*16").struct(ascii("hi"))', undefined, ['binary']),
    necklace: D('A rhythm from the gaps between hits: necklace(12, [4, 2]) plays a hit, waits 4 steps, a hit, waits 2, repeating, with 12 steps per cycle.', 'sound("bd").struct(necklace(12, [4, 2, 4, 2]))', undefined, ['euclid']),
    brand: D('A random boolean signal: true or false at every moment, half of the time each.', 'sound("hh*16").struct(brand.segment(16))', undefined, ['brandBy', 'rand']),
    brandBy: D('A random boolean signal, true with the given probability.', 'sound("hh*16").struct(brandBy(0.25).segment(16))', undefined, ['brand']),
    chooseBy: D('Picks from a list with a signal from 0 to 1: chooseBy(rand, list) picks at random for every event (Tidal\'s choose).', 'sound(chooseBy(rand, ["bd", "sn", "hh"]).segment(8))', undefined, ['wchooseBy', 'choose']),
    wchooseBy: D('Picks from a list with a signal, with weights: [["bd", 3], ["sn", 1]] picks bd three times as often.', 'sound(wchooseBy(rand, [["bd", 3], ["sn", 1]]).segment(8))', undefined, ['chooseBy']),
    select: D('Switches between patterns with a number from 0 to 1, as Tidal\'s select: floor(x * (number of patterns - 1)), so with two patterns 1 picks the second.', 'select("<0 1>", [sound("bd*2 sn"), sound("hh*8")])', undefined, ['squeeze', 'pickF']),
    squeeze: D('For each step of an index pattern, squeezes a whole cycle of the pattern it picks into that step.', 'squeeze("0 [1 0]", [sound("bd sn"), sound("hh*3")])', undefined, ['select']),

    // Signals
    sine2: D('A sine wave from -1 to 1 (instead of 0 to 1). Good for pan.', 'sound("hh*8").pan(sine2)', undefined, ['sine']),
    cosine2: D('A cosine wave from -1 to 1.', 'sound("hh*8").pan(cosine2)', undefined, ['cosine']),
    saw2: D('A rising ramp from -1 to 1.', 'sound("hh*8").pan(saw2)', undefined, ['saw']),
    isaw2: D('A falling ramp from 1 to -1.', 'sound("hh*8").pan(isaw2)', undefined, ['isaw']),
    tri2: D('A triangle wave from -1 to 1.', 'sound("hh*8").pan(tri2)', undefined, ['tri']),
    square2: D('A square wave, -1 then 1.', 'sound("hh*8").pan(square2)', undefined, ['square']),
    envL: D('An envelope that rises from 0 to 1 over the first cycle, then stays at 1.', 'sound("saw*8").lpf(envL.slow(8).range(200, 3000))', undefined, ['envLR', 'envEq']),
    envLR: D('An envelope that falls from 1 to 0 over the first cycle, then stays at 0.', 'sound("hh*8").gain(envLR.slow(8))', undefined, ['envL']),
    envEq: D('An equal-power envelope that falls over the first cycle, for crossfades.', 'sound("hh*8").gain(envEq.slow(4))', undefined, ['envEqR']),
    envEqR: D('An equal-power envelope that rises over the first cycle, for crossfades.', 'sound("hh*8").gain(envEqR.slow(4))', undefined, ['envEq']),

    // Controls
    delaytime: D('The time between echoes of the orbit\'s delay, in seconds (in cycles with lock(1)), 0 to 4; it stays as the last event set it (0 at first, as in SuperDirt).', 'sound("cp ~ ~ ~").delay(0.6).delaytime(0.125).delayfeedback(0.5)', undefined, ['delay', 'delayfeedback', 'lock']),
    delayt: D('Short for delaytime().', undefined, undefined, ['delaytime']),
    delayfeedback: D('How much each echo of the orbit\'s delay repeats, 0 to 1 (kept below 0.99); it stays as the last event set it (0 at first, as in SuperDirt).', 'sound("cp ~ ~ ~").delay(0.6).delaytime(0.25).delayfeedback(0.8)', undefined, ['delay', 'delaytime']),
    delayfb: D('Short for delayfeedback().', undefined, undefined, ['delayfeedback']),
    dfb: D('Short for delayfeedback().', undefined, undefined, ['delayfeedback']),
    lock: D('With lock(1), delaytime is in cycles instead of seconds, so the echoes follow the tempo.', 'sound("cp ~ ~ ~").delay(0.6).delaytime(0.1875).lock(1)', undefined, ['delaytime']),
    shape: D('Waveshaping distortion as in SuperDirt, from 0 (none) to 1 (a lot). Warmer than crush.', 'sound("bd*4").shape("<0 0.5 0.9>")', undefined, ['distort', 'distortion', 'crush']),
    distort: D('Tidal\'s distortion amount, 0 to 1 (the same effect as distortion(), which goes from 1 to 100).', 'sound("arpy*4").note("c e g b").distort(0.4)', undefined, ['distortion', 'shape']),
    coarse: D('Lowers the sample rate, as SuperDirt\'s coarse: each sample is held for coarse samples (1 is unchanged, 4 a quarter), on every sound, for a gritty, aliased sound.', 'sound("arpy*4").note("c e g b").coarse("<1 4 8 16>")', undefined, ['crush']),
    cut: D('Cut groups, as in SuperDirt: a new sound stops the sounds still playing in the same group (and orbit), like an open hi-hat cut by a closed one. A negative group only stops the same sample.', 'sound("oh*4 [~ ch]*4").cut(1)', undefined, ['legato']),
    accelerate: D('Changes the pitch while the sound plays: 1 rises an octave by the end, -0.5 falls by half. Works on samples and pitched synths.', 'sound("sine*4").note("c3").legato(1).accelerate("<1 -0.5>")', undefined, ['speed']),
    djf: D('SuperDirt\'s DJ filter on one knob: a low-pass from 20 Hz (0) to 10 kHz (0.5) and a high-pass from 20 Hz (0.5) to 10 kHz (1), so below 0.5 it closes the top and above 0.5 it thins the bottom; 0.5 does nothing.', 'sound("bd*4 hh*8").djf(sine.slow(8))', undefined, ['lpf', 'hpf']),
    lpq: D('The resonance of the low-pass filter: the same as resonance().', 'sound("saw*8").lpf(800).lpq(0.2)', undefined, ['resonance']),
    hpq: D('The resonance of the high-pass filter, as SuperDirt\'s hresonance, from 0 to 1 (rq = hresonance.linexp(0, 1, 1, 0.001)).', 'sound("saw*8").hpf(600).hpq(0.3)', undefined, ['hpf', 'resonance']),
    hresonance: D('The same as hpq().', undefined, undefined, ['hpq']),
    bpq: D('The Q of the band-pass filter, as SuperDirt\'s bandq: higher values make a narrower band, and it is boosted by bandq (10 by default) so it stays loud.', 'sound("saw*8").bpf(1200).bpq("<2 20>")', undefined, ['bpf']),
    bandq: D('The same as bpq().', undefined, undefined, ['bpq']),
    amp: D('Volume as in SuperDirt, where 0.4 is normal: amp(0.8) is twice as loud. Multiplies with gain().', 'sound("bd*4").amp("<0.4 0.8 0.2>")', undefined, ['gain']),
    octave: D('The octave of synth notes, as in SuperDirt: 5 is normal, 6 an octave up, 4 an octave down.', 'sound("tri*4").note("c e g b").octave("<5 6 4>")', undefined, ['note', 'up']),
    unit: D('The unit of speed(): "r" (rate, the default) or "c" (cycles), where speed(1) plays the whole sample in one cycle.', 'sound("breaks125").unit("c").speed(0.5)', undefined, ['loopAt', 'speed']),
    tremolorate: D('Tremolo speed in Hz: the volume swings this many times per second.', 'sound("tri").note("c\'maj").legato(1).tremolorate(6).tremolodepth(0.8)', undefined, ['tremolodepth']),
    tremr: D('Short for tremolorate().', undefined, undefined, ['tremolorate']),
    tremolodepth: D('Tremolo depth, 0 to 1: how far the volume swings.', 'sound("saw").note("c3").legato(1).tremolodepth(0.5).tremolorate(4)', undefined, ['tremolorate']),
    tremdp: D('Short for tremolodepth().', undefined, undefined, ['tremolodepth']),
    phaserrate: D('Phaser speed in Hz: a sweeping, swirling sound.', 'sound("saw*4").note("c2 c3").phaserrate(0.5).phaserdepth(0.8)', undefined, ['phaserdepth']),
    phasr: D('Short for phaserrate().', undefined, undefined, ['phaserrate']),
    phaserdepth: D('Phaser depth, 0 to 1. Has an effect together with phaserrate().', 'sound("saw*4").note("e2").phaserrate(2).phaserdepth(1)', undefined, ['phaserrate']),
    phasdp: D('Short for phaserdepth().', undefined, undefined, ['phaserdepth']),
    ring: D('Ring modulation amount, 0 to 1: multiplies the sound by a sine at ringf Hz, for metallic, bell-like tones.', 'sound("tri*4").note("c e g b").ring(1).ringf(300)', undefined, ['ringf']),
    ringf: D('The frequency of the ring modulation, in Hz.', 'sound("arpy*4").ring(0.8).ringf("<100 440 1000>")', undefined, ['ring']),
    ctf: D('Short for cutoff(): low-pass filter cutoff in Hz.', 'sound("saw*4").ctf(900)', undefined, ['lpf']),
    sz: D('Short for size(): reverb room size.', 'sound("cp").room(0.5).sz(0.9)', undefined, ['size']),
    sus: D('Short for sustain(): length in seconds.', 'sound("saw").note("c2").sus(0.3)', undefined, ['sustain']),
    att: D('Short for attack(): fade-in time in seconds.', 'sound("tri").note("c").att(0.2).legato(1)', undefined, ['attack']),
    rel: D('Short for release(): fade-out time in seconds.', 'sound("tri*2").note("c e").rel(0.5)', undefined, ['release']),
});
for (let i = 1; i <= 16; i++) {
    DOCS['d' + i] = D(
        'Plays a pattern in stream d' + i + ', as Tidal\'s d' + i + ' $ ... Streams appear above the cycle view with mute (M) and solo (S) buttons, and the transitions (xfadeIn, jumpIn...) change a stream from its previous pattern to a new one.',
        'd' + i + '(sound("bd*2 sn"))',
        'Patterns without a stream play too; they are listed as #1, #2...',
        ['p', 'xfadeIn', 'mute', 'solo'],
    );
}

// ---------------- Streams, transitions, stepwise and the rest ----------------
const TRANSITION_TIP = 'A transition runs from the stream\'s previous pattern, so first play something in that stream (d1, or a transition with the same number), then change it.';
Object.assign(DOCS, {
    p: D('Plays a pattern in a named stream, as Tidal\'s p "name" $ ... A number is the same as d1, d2...', 'p("drums", sound("bd*2 [~ bd] sn ~"))\np("bass", sound("saw*4").note("c2"))', undefined, ['d1', 'mute']),
    xfadeIn: D(
        'Crossfades a stream from its previous pattern to a new one over a number of cycles, with equal power so the volume stays even.',
        'xfadeIn(1, 8, sound("hh*8").gain(0.91))',
        TRANSITION_TIP,
        ['xfade', 'clutchIn', 'jumpIn', 'interpolateIn'],
    ),
    xfade: D('Crossfades a stream to a new pattern over 4 cycles: xfadeIn(id, 4, pattern).', 'xfade(1, sound("arpy*4").note("c e g b"))', TRANSITION_TIP, ['xfadeIn']),
    jump: D('Switches a stream to a new pattern right away (the same as playing it).', 'jump(1, sound("bd*4"))', undefined, ['jumpIn', 'jumpMod']),
    jumpIn: D('Keeps the stream\'s previous pattern for a number of cycles, then switches to the new one exactly.', 'jumpIn(1, 2, sound("cp*4"))', TRANSITION_TIP, ['jumpMod', 'xfadeIn']),
    jumpMod: D('Switches the stream at the next cycle divisible by n, e.g. 4 to change at the start of a four-cycle phrase.', 'jumpMod(1, 4, sound("bd sn"))', TRANSITION_TIP, ['jumpIn']),
    clutchIn: D('Changes a stream gradually: over a number of cycles, events of the old pattern drop out at random while events of the new one come in.', 'clutchIn(1, 4, sound("hh*16"))', TRANSITION_TIP, ['clutch', 'xfadeIn']),
    clutch: D('clutchIn over 2 cycles.', 'clutch(1, sound("bd*2 sn"))', TRANSITION_TIP, ['clutchIn']),
    anticipateIn: D('Builds up to the change: the old pattern echoes faster and faster for a number of cycles, then the new pattern starts.', 'anticipateIn(1, 4, sound("bd sn"))', TRANSITION_TIP, ['anticipate', 'jumpIn']),
    anticipate: D('anticipateIn over 8 cycles.', 'anticipate(1, sound("bd*2 sn"))', TRANSITION_TIP, ['anticipateIn']),
    interpolateIn: D('Glides the numeric controls (gain, lpf, speed...) from the old pattern\'s values to the new one\'s over a number of cycles; the rhythm is the new pattern\'s.', 'interpolateIn(1, 8, sound("saw*8").note("c2").lpf(3000))', TRANSITION_TIP, ['interpolate', 'xfadeIn']),
    interpolate: D('interpolateIn over 4 cycles.', 'interpolate(1, sound("saw*8").note("c2").lpf(400))', TRANSITION_TIP, ['interpolateIn']),
    wait: D('Silences the stream for a number of cycles, from the next cycle, then plays the new pattern.', 'wait(1, 2, sound("bd*4"))', undefined, ['jumpIn']),
    mortal: D('Plays the new pattern for a number of cycles (its life), then fades it out by dropping events over the release cycles.', 'mortal(1, 4, 2, sound("cp*8"))', undefined, ['fadeOut']),
    mute: D('Mutes a stream: 1 is d1, or give a name. The M button above the cycle view does the same.', 'mute(2)\nd1(sound("bd*4"))\nd2(sound("hh*8"))', 'Muting does not stop the stream\'s clock: unmuting brings it back in time.', ['unmute', 'solo']),
    unmute: D('Unmutes a stream.', 'unmute(2)\nd1(sound("bd*4"))\nd2(sound("hh*8"))', undefined, ['mute', 'unmuteAll']),
    solo: D('Solos a stream: while any stream is soloed, only soloed streams are heard. The S button above the cycle view does the same.', 'solo(1)\nd1(sound("bd*4"))\nd2(sound("hh*8"))', undefined, ['unsolo', 'mute']),
    unsolo: D('Stops soloing a stream.', 'unsolo(1)\nd1(sound("bd*4"))', undefined, ['solo', 'unsoloAll']),
    unmuteAll: D('Unmutes every stream.', 'unmuteAll()', undefined, ['unmute']),
    unsoloAll: D('Stops soloing every stream.', 'unsoloAll()', undefined, ['unsolo']),

    stepcat: D(
        'Joins patterns into one cycle, giving each time in proportion to its steps: "bd sn" (2 steps) and "hh hh hh" (3 steps) make 5 even steps. fastcat would give each pattern half the cycle instead.',
        'stepcat(sound("bd sn"), sound("hh hh hh"))',
        'Patterns count their steps from the mini-notation: "bd sn hh" has 3, "bd@3 sn" 4, "<a b>" 2, as in Tidal 1.10. .steps() tells you.',
        ['fastcat', 'timeCat', 'expand'],
    ),
    s_cat: D('The same as stepcat().', undefined, undefined, ['stepcat']),
    stepalt: D('Alternates between lists of patterns, one step-group at a time: [[a], [b, c]] plays a b, then a c.', 'stepalt([[sound("bd sn")], [sound("hh*3"), sound("cp cp")]])', undefined, ['stepcat']),
    stepzip: D('Interleaves the steps of several patterns: the first step of each, then the second of each.', 'stepzip([sound("bd sn"), sound("hh cp")])', undefined, ['stepcat']),
    steptake: D('Keeps the first n steps of the pattern (the last n if negative), stretched to fill the cycle.', 'sound("bd sn hh cp").steptake("<4 3 2>")', undefined, ['stepdrop', 'linger']),
    stepdrop: D('Drops n steps from the end of the pattern (from the start if negative), as Tidal\'s stepdrop.', 'sound("bd sn hh cp").stepdrop("<0 1 2>")', undefined, ['steptake']),
    expand: D('Multiplies the steps without changing the sound, so stepcat gives the pattern more room.', 'stepcat(sound("bd sn").expand(2), sound("hh hh"))', undefined, ['contract', 'stepcat']),
    contract: D('Divides the steps without changing the sound, so stepcat gives the pattern less room.', 'stepcat(sound("bd sn hh cp").contract(2), sound("arpy"))', undefined, ['expand']),
    extend: D('Repeats the pattern n times within the cycle and multiplies its steps to match.', 'stepcat(sound("bd sn").extend(2), sound("cp"))', undefined, ['expand', 'fast']),
    pace: D('Changes the speed so the pattern plays a given number of steps per cycle, whatever its own count.', 'sound("bd sn hh").pace(4)', undefined, ['steps', 'fast']),
    steps: D('Returns the number of steps of the pattern (for the stepwise functions), or undefined.', undefined, undefined, ['stepcat']),

    ur: D(
        'Tidal\'s ur: a song structure. A pattern of names, spread over a number of cycles, chooses which named pattern plays when; "name:fx" applies an effect from the last argument. The patterns keep their own rhythm.',
        'ur(8, "intro verse [verse, hats] verse:fast", {\n  intro: sound("bd ~ ~ ~"),\n  verse: sound("bd*2 sn"),\n  hats: sound("hh*8").gain(0.84)\n}, { fast: x => x.fast(2) })',
        undefined,
        ['inhabit', 'cat', 'squeeze'],
    ),
    inhabit: D('Fits named patterns into the steps of a pattern of names: each step plays a whole cycle of its pattern, squeezed.', 'inhabit({ a: sound("bd sn"), b: sound("hh*3") }, "a [b a] b")', undefined, ['squeeze', 'ur']),
    swap: D('Replaces the values of a pattern from a table; values not in it become rests.', 'sound(swap({ a: "bd", b: "sn", c: "hh" }, "a [b c] a c"))', undefined, ['fit']),
    weave: D('Tidal\'s weave: spreads a control pattern over the given cycles across several patterns, each shifted earlier by an equal share of the cycles, so together they play the whole control at once.', 'weave(8, pan(saw2), [sound("bd sn"), sound("hh*4"), sound("arpy*3")])', undefined, ['weaveWith', 'set']),
    snowball: D('Like soak, accumulating: each cycle combines the previous result with the function applied once more.', 'n("0 2").snowball(4, (a, b) => a.add(b), x => x.fast(2)).sound("arpy")', 'Add the sound after: snowballing works on the numbers. Also a global: snowball(depth, combine, fn, pattern).', ['soak']),
    chew: D('Like bite(), but each part also plays faster or slower to match how much it was squeezed or stretched.', 'sound("breaks125").chop(8).chew(4, "0 [1 3] <2 0>")', undefined, ['bite', 'splice']),
    arpg: D('The same as arp().', undefined, undefined, ['arp']),
});

// ---------------- Operators: where the rhythm comes from ----------------
const OPERATOR_SYMBOLS: Record<string, [symbol: string, what: string]> = {
    set: ['#', 'replaces the controls with those of the other pattern'],
    keep: ['|<', 'keeps the controls of this pattern, adding only the ones it lacks'],
    add: ['+', 'adds numbers key by key'],
    sub: ['-', 'subtracts the other pattern\'s numbers'],
    mul: ['*', 'multiplies by the other pattern\'s numbers'],
    div: ['/', 'divides by the other pattern\'s numbers'],
    mod: ['%', 'takes the remainder of dividing by the other pattern\'s numbers'],
    pow: ['**', 'raises to the power of the other pattern\'s numbers'],
};
const OPERATOR_EXAMPLE: Record<string, string> = {
    set: 'n("0 1").RIGHT_OR_BOTH(speed("1 2 3")).sound("arpy")',
    keep: 'n("0 1").speed(2).OP(n("5 6 7").speed(1)).sound("arpy")',
    add: 'n("0 7").OP(n("0 3 5")).sound("arpy")',
    sub: 'n("12 7").OP(n("0 3 5")).sound("arpy")',
    mul: 'sound("arpy*2").speed(1).OP(speed("1 2 1.5"))',
    div: 'sound("arpy*2").speed(2).OP(speed("1 2 4"))',
    mod: 'n("7 9").OP(n("3 4 5")).sound("arpy")',
    pow: 'sound("arpy*2").speed(2).OP(speed("0.5 1 1.5"))',
};
for (const [base, [symbol, what]] of Object.entries(OPERATOR_SYMBOLS)) {
    const tidal = base === 'set' ? { right: '>|', both: '|>|', squeeze: '||>' } : base === 'keep'
        ? { right: '<|', both: '|<|', squeeze: '||<' }
        : { right: symbol + '|', both: '|' + symbol + '|', squeeze: '||' + symbol };
    const example = (name: string) => OPERATOR_EXAMPLE[base].replace(/RIGHT_OR_BOTH|OP/, name);
    const see = [base, base + 'Right', base + 'Both', base + 'Squeeze'];
    DOCS[base + 'Right'] = D(
        `Tidal's ${tidal.right}: ${what}, taking the rhythm from the other pattern (the right side). Each of its events takes the value of this pattern sounding at its start.`,
        example(base + 'Right'), `.${base}() is the same with the rhythm from this pattern (the left side).`, see.filter((n) => n !== base + 'Right'),
    );
    DOCS[base + 'Both'] = D(
        `Tidal's ${tidal.both}: ${what}, with the rhythm from both patterns: an event starts wherever either one does, and lasts until the next start on either side.`,
        example(base + 'Both'), undefined, see.filter((n) => n !== base + 'Both'),
    );
    DOCS[base + 'Squeeze'] = D(
        `Tidal's ${tidal.squeeze}: ${what}, squeezing a whole cycle of the other pattern into each event of this one, so the other pattern's rhythm repeats inside every step.`,
        example(base + 'Squeeze'), undefined, see.filter((n) => n !== base + 'Squeeze'),
    );
}
DOCS.keep = D(
    'Tidal\'s |<: keeps the rhythm and the controls of this pattern, and adds only the controls the other pattern has and this one lacks. The opposite of set (#), where the other pattern wins.',
    'n("0 1").speed(2).keep(n("5 6 7").speed(1).vowel("a")).sound("arpy")',
    undefined, ['set', 'keepRight', 'keepBoth', 'keepSqueeze'],
);

// ---------------- More of Tidal: primed and other functions ----------------
Object.assign(DOCS, {
    everyOffset: D('Tidal\'s every\': applies a function on the cycles where cycle mod n equals the offset, so everyOffset(4, 2, f) applies it on cycles 2, 6, 10...', 'sound("bd sn hh cp").everyOffset(4, 2, x => x.rev())', FN_ARG, ['every', 'whenmod']),
    withinZoom: D('Tidal\'s within\': zooms into part of each cycle (begin to end, 0 to 1), applies the function as if that part were a whole cycle, and fits the result back. within() applies the function to the whole pattern and keeps only that part.', 'sound("bd sn hh cp").withinZoom(0, 0.5, x => x.rev())', undefined, ['within', 'zoom']),
    toScaleBy: D('Tidal\'s toScale\': like toScale, with an octave of any size in semitones, for scales that repeat at other intervals.', 'note(toScaleBy(10, [0, 3, 7], "0 1 2 3 4 5")).sound("arpy")', 'As a method it works on a pattern of numbers: note(fastFromList([0, 1, 2]).toScaleBy(10, [0, 3, 7])).', ['toScale', 'scale']),
    fitSlices: D('Tidal\'s fit\': cuts the pattern (spread over a number of cycles) into n parts, named by the from pattern, then plays the parts in the order of the to pattern, each squeezed into its step.', 'sound("bd sn hh cp").fitSlices(1, 4, "0 1 2 3", "[3 2] 1 0 0")', 'Also a global: fitSlices(cycles, n, from, to, pattern).', ['fit', 'bite']),
    substruct: D('Tidal\'s substruct: like struct, but each true step plays a whole cycle of the pattern, squeezed into it.', 'sound("bd sn hh").substruct("t ~ t t")', undefined, ['struct', 'squeeze']),
    whenT: D('Tidal\'s whenT: applies the function to the events whose time, in cycles, passes the test.', 'sound("hh*8").whenT(t => t % 1 >= 0.5, x => x.speed(2))', 'The test receives the start of each event, e.g. 2.25 for the second quarter of cycle 2.', ['when', 'within']),
    fastAppend: D('Plays the pattern and another one squeezed into the same cycle, each taking half (Tidal\'s fastAppend).', 'sound("bd*2").fastAppend(sound("hh*3"))', undefined, ['slowAppend', 'fastcat']),
    slowAppend: D('Plays the pattern in one cycle and another in the next (Tidal\'s slowAppend; the same as append).', 'sound("bd*2").slowAppend(sound("hh*3"))', undefined, ['fastAppend', 'append', 'cat']),
    jux4: D('Tidal\'s jux4, made for four speakers: the pattern at 5/8 of the way round and the changed copy at 1/8. In stereo the pattern sits a little to the right and the copy mostly to the left.', 'sound("arpy*4").note("c e g b").jux4(x => x.rev())', undefined, ['jux', 'juxcut']),
    juxcut: D('Like jux, with each side in its own cut group (-1 and -2): a sound only stops sounds on its own side.', 'sound("arpy*4").note("c e g b").juxcut(x => x.fast(2))', undefined, ['jux', 'cut']),
    spreadf: D('Applies the functions of a list in turn, one per cycle (Tidal\'s spreadf).', 'sound("bd sn hh cp").spreadf([x => x.rev(), x => x.fast(2), x => x.speed(2)])', 'Also a global: spreadf(fns, pattern).', ['spread', 'pickF']),
    fastSqueeze: D('Each step of the speed pattern plays a whole cycle of the pattern at that speed, squeezed into the step (Tidal\'s fastSqueeze).', 'sound("bd sn").fastSqueeze("1 2 [4 1]")', undefined, ['fast', 'slowSqueeze']),
    slowSqueeze: D('Like fastSqueeze, slowing the pattern down in each step instead.', 'sound("bd sn hh cp").slowSqueeze("1 2")', undefined, ['slow', 'fastSqueeze']),
    mono: D('Makes the pattern monophonic, as Tidal\'s mono: when events overlap, the one that starts first plays (of two starting together, the shorter), and the others wait for it to end or are dropped.', 'note("[c, e] g [a, c5]").sound("tri").mono()', undefined, ['legato']),
    timeLoop: D('Loops the first n cycles of the pattern (Tidal\'s timeLoop).', 'sound("<bd sn hh cp>").timeLoop(2)', undefined, ['loopFirst', 'repeatCycles']),
    pitchenv: D(
        'A pitch envelope with breakpoints, as SuperCollider\'s Env: levels in semitones from the note, the times in seconds between them, and the curves of the segments (0 or "lin" for a straight line, negative values move fast at first, positive slow at first, "exp" exponential).',
        'sound("saw").note("d4").legato(1).pitchenv([-5, 6, 0], [0.1, 1.7], ["lin", -4])',
        'It replaces penv and a synth\'s own pitch sweep. It is set when the code runs, so it cannot be a pattern.',
        ['penv', 'accelerate', 'portamento'],
    ),
    sig: D('Tidal\'s sig: a signal from a function of time in cycles, sampled at the start of each event.', 'sound("arpy*8").pan(sig(t => Math.sin(t * Math.PI)))', undefined, ['sine', 'saw']),
    perlinWith: D('Tidal\'s perlinWith: Perlin noise (0 to 1) driven by another pattern instead of time, so the noise can move faster or slower.', 'sound("hh*8").gain(perlinWith(saw.mul(4)))', undefined, ['perlin', 'perlin2']),
    perlin2: D('Tidal\'s perlin2: two-dimensional Perlin noise (0 to 1), moving with time along one axis and with the given pattern along the other.', 'sound("arpy*8").pan(perlin2(sine.mul(4)))', undefined, ['perlin', 'perlin2With']),
    perlin2With: D('Tidal\'s perlin2With: two-dimensional Perlin noise (0 to 1) with both coordinates from patterns.', 'sound("arpy*8").lpf(perlin2With(saw.mul(4), cosine.mul(2)).range(300, 3000))', undefined, ['perlin2']),
    interlace: D('Tidal\'s interlace: moves between two patterns with waveshaping distortion, weaving the distortion across them over 16 cycles.', 'interlace(sound("bd*2 sn"), sound("hh*4"))', undefined, ['weave']),
    seqP: D('Tidal\'s seqP: plays patterns between given cycles, as a list of [start, stop, pattern]. Each pattern starts its own cycle 0 at its start.', 'seqP([\n  [0, 8, sound("bd*2")],\n  [2, 8, sound("hh*8")],\n  [4, 8, sound("~ cp")]\n])', 'Cycles count from when the music starts; resetCycles() starts the count again.', ['seqPLoop', 'playFor', 'ur']),
    seqPLoop: D('Like seqP, looping: when the last pattern stops, the whole sequence starts again.', 'seqPLoop([\n  [0, 4, sound("bd*2")],\n  [2, 6, sound("hh*8")]\n])', undefined, ['seqP']),
    setOutput: D(
        'Sets the output stage: the master volume (0.8 by default) and the limiter that keeps peaks below -8 dB (on by default). setOutput(1, false) sends the sound out as it is, as SuperCollider does.',
        'setOutput(1, false)\nsound("supergabber*4").amp(0.07)',
        'It stays as set until changed, like the tempo. Without the limiter loud patterns can clip: lower the volume or the gain.',
        ['gain', 'amp'],
    ),
    resetCycles: D('Starts counting cycles from 0 again, from the next cycle (Tidal\'s resetCycles): seqP, ur and the < > alternations start over.', 'resetCycles()', undefined, ['seqP']),

    // Envelopes and pitch
    hold: D('How long the sound holds after its attack, in seconds, before the release (SuperDirt\'s attack, hold, release). It replaces legato and sustain.', 'sound("saw*2").note("c3").attack(0.05).hold(0.2).release(0.3)', undefined, ['attack', 'release', 'sustain']),
    decay: D('How long a sound rings, in seconds: for drums and plucks the length of their decay; for held synths (with legato, sustain or hold) the time the volume takes after the attack to fall to sustainlevel.', 'sound("supersaw").note("c3 e3").legato(1).decay(0.2).sustainlevel(0.4)', undefined, ['sustainlevel', 'attack', 'release']),
    sustainlevel: D('The level a held synth falls to during decay(), 0 to 1 (0 by default, so decay() alone makes the note fade out).', 'sound("supersquare*2").note("c3").legato(1).decay(0.1).sustainlevel(0.5)', undefined, ['decay']),
    penv: D('The depth of the pitch envelope in semitones: the pitch jumps (or rises over pattack) by penv, then returns to the note over pdecay. Synths with a pitch sweep of their own (superkick, super808, supergabber, superzow) use it as the depth of that sweep.', 'sound("supergabber*4").penv("<48 24>")', undefined, ['pattack', 'pdecay', 'pcurve', 'pitchenv']),
    pattack: D('The time the pitch envelope takes to reach penv, in seconds (0 jumps there at once).', 'sound("sine*2").note("c4").legato(1).penv(12).pattack(0.2).pdecay(0.3)', undefined, ['penv']),
    pdecay: D('The time the pitch envelope takes to come back from penv to the note, in seconds (0.1 by default).', 'sound("superkick*4").pdecay("<0.02 0.2>")', undefined, ['penv']),
    pcurve: D('The curve of the pitch envelope, as in SuperCollider: 0 is a straight line, negative values move fast at first (like a drum), positive slow at first.', 'sound("sine*4").note("c3").legato(1).penv(24).pdecay(0.2).pcurve("<0 -6>")', undefined, ['penv']),
    vib: D('Vibrato: the pitch wobbles this many times a second, vibmod semitones each way (0.5 by default).', 'sound("tri").note("c4 e4").legato(1).vib(5).vibmod(0.3)', undefined, ['vibmod']),
    vibrato: D('The same as vib().', undefined, undefined, ['vib']),
    vibmod: D('The depth of the vibrato in semitones each way (up to 48, four octaves: a slow vib with a large vibmod is a siren-like sweep). Has an effect together with vib().', 'sound("saw").note("c3").legato(1).vib(6).vibmod("<0.2 1>")', undefined, ['vib']),
    portamento: D('Glides into each note from the previous note of the same sound (in the same orbit), over this many seconds.', 'sound("supersaw*4").note("c3 c4 g3 eb4").legato(1).portamento(0.08)', 'Notes keep their own voices, so long overlapping notes play together while the new one glides.', ['pitchenv']),
    glide: D('The same as portamento().', undefined, undefined, ['portamento']),

    // The peak equaliser
    peak: D('A peak (bell) equaliser around this frequency in Hz: peakgain boosts it (or cuts it, when negative) and peakq sets how narrow the band is.', 'sound("supersaw*4").note("c2").peak(sine.range(200, 3000).slow(4)).peakgain(15).peakq(2)', 'Like SuperCollider\'s BPeakEQ; its rq is 1 / peakq.', ['peakgain', 'peakq', 'peakenv']),
    peakq: D('How narrow the band of the peak equaliser is (Q): higher values touch a narrower band. Default 1.', 'sound("saw*4").note("c2").peak(800).peakgain(12).peakq("<0.5 8>")', undefined, ['peak']),
    peakgain: D('How much the peak equaliser boosts its band, in dB (negative values cut it). Default 6.', 'sound("saw*4").note("c2").peak(1500).peakgain("<12 -12>")', undefined, ['peak']),

    // Synth parameters
    voice: D('A timbre parameter of the SuperDirt-style synths, 0 to 1: the side voices of supersaw, the pulse width of superchip, the brightness of superfm, superpiano and supergong, the click of superkick, the density of superstatic.', 'sound("superfm*4").note("c3 e3").voice("<0.1 0.6>")', undefined, ['detune', 'supersaw']),
    detune: D('How far the voices of a SuperDirt-style synth are detuned, in semitones (supersaw, supersquare, superreese, superzow, superpwm, superhoover).', 'sound("supersaw").note("c3").legato(1).detune("<0.05 0.5>")', undefined, ['voice']),
    semitone: D('The interval of superfm\'s modulator above the note, in semitones (12 by default, an octave).', 'sound("superfm*4").note("c3").semitone("<12 7 19>")', undefined, ['voice']),
    rate: D('The speed of a SuperDirt-style synth\'s modulation in Hz: the pulse-width sweep of superpwm, the phasing of superzow, the vibrato of superchip.', 'sound("superpwm").note("c3").legato(1).rate("<0.5 4>")', undefined, ['lfo']),
    lfo: D('The depth of a SuperDirt-style synth\'s modulation, 0 to 1 (superpwm, superzow), or the vibrato of superchip in semitones.', 'sound("superpwm").note("c3").legato(1).lfo("<0.1 0.9>")', undefined, ['rate']),

    // SuperDirt effects
    squiz: D('SuperDirt\'s squiz: a lo-fi pitch raiser that plays each wave cycle this many times faster, repeated to fill the time. 1 does nothing; try 2, 4 or 8.', 'sound("supersaw*4").note("c3").squiz("<1 2 4 8>")', undefined, ['waveloss', 'crush']),
    waveloss: D('SuperDirt\'s waveloss: drops this many out of 100 wave cycles at random, for a broken, gritty sound.', 'sound("saw*8").note("c2").waveloss("<0 20 60>")', undefined, ['squiz']),
    krush: D('SuperDirt\'s krush: a fat distortion (from Sonic Pi), followed by a low-pass at kcutoff Hz.', 'sound("bd*4").krush("<1 4 8>")', undefined, ['kcutoff', 'triode', 'shape']),
    kcutoff: D('The low-pass after krush, in Hz (3140 by default).', 'sound("superreese").note("c2").legato(1).krush(4).kcutoff("<800 6000>")', undefined, ['krush']),
    triode: D('SuperDirt\'s triode: tube-like distortion that only squashes the negative half of the wave, 0 to 1 and beyond.', 'sound("saw*4").note("c2").triode("<0 0.5 1>")', undefined, ['krush', 'shape']),
    octer: D('SuperDirt\'s octer: blends in the sound an octave up (0 to 1), made by folding the wave.', 'sound("tri*4").note("c3").octer("<0 0.5 1>")', undefined, ['octersub', 'octersubsub']),
    octersub: D('Adds a sub-octave (one octave down) to the sound, 0 to 1 and beyond.', 'sound("saw*4").note("c3").octersub(1)', undefined, ['octer', 'octersubsub']),
    octersubsub: D('Adds a sub-sub-octave (two octaves down), 0 to 1 and beyond.', 'sound("saw*4").note("c3").octersubsub(1)', undefined, ['octersub']),
    fshift: D('SuperDirt\'s frequency shifter: moves every frequency of the sound by this many Hz (unlike pitch, which multiplies them), for metallic, inharmonic tones.', 'sound("arpy*4").note("c e g b").fshift("<0 50 -200>")', undefined, ['fshiftnote', 'fshiftphase', 'ring']),
    fshiftnote: D('Adds the note\'s frequency times this number to the shift of fshift, so the shift follows the melody.', 'sound("tri*4").note("c e g b").fshiftnote(0.5)', undefined, ['fshift']),
    fshiftphase: D('The phase of the frequency shifter\'s oscillator, in radians.', 'sound("saw").note("c3").legato(1).fshift(5).fshiftphase(1.5)', undefined, ['fshift']),
    leslie: D('A rotating Leslie speaker, as in SuperDirt: the mix of the effect, 0 to 1. lrate is how fast it turns, lsize the size of the cabinet.', 'sound("supersquare").note("<c3 e3>").legato(1).leslie(1).lrate("<1 7>")', undefined, ['lrate', 'lsize', 'phaserrate']),
    lrate: D('How fast the Leslie speaker turns, in turns a second (6.7 by default; about 0.7 for the slow "chorale" setting).', 'sound("superpwm").note("c3").legato(1).leslie(1).lrate(0.7)', undefined, ['leslie']),
    lsize: D('The size of the Leslie cabinet in metres (0.3 by default): larger gives more pitch wobble.', 'sound("supersaw").note("c3").legato(1).leslie(1).lsize("<0.1 1>")', undefined, ['leslie']),
    freeze: D('SuperDirt\'s spectral freeze: holds the spectrum of the start of each sound, turning it into a steady drone for as long as the sound lasts.', 'sound("supersaw").note("c3").legato(1).freeze(1)', undefined, ['smear', 'comb']),
    comb: D('A spectral comb, as SuperDirt\'s: removes bands of the spectrum in evenly spaced teeth, 0 to 1 (more teeth as it grows).', 'sound("supersaw*4").note("c3").comb("<0 0.2 0.8>")', undefined, ['freeze', 'binshift']),
    smear: D('Spectral smear: blurs the spectrum across neighbouring frequencies, 0 to 1.', 'sound("superpiano*2").note("c4 e4").smear("<0 0.5 1>")', undefined, ['freeze', 'scram']),
    scram: D('Spectral scramble: swaps frequencies at random, 0 to 1.', 'sound("supersaw*4").note("c3").scram("<0 0.3 0.9>")', undefined, ['smear']),
    binshift: D('Shifts the spectrum up (or down, when negative): 1 moves every frequency by about 1000 Hz.', 'sound("arpy*4").note("c e g b").binshift("<0 0.1 -0.1>")', undefined, ['fshift', 'comb']),
    hbrick: D('A spectral brick-wall high-pass: removes this fraction (0 to 1) of the spectrum from the bottom.', 'sound("supersaw*4").note("c2").hbrick("<0 0.1 0.3>")', undefined, ['lbrick', 'hpf']),
    lbrick: D('A spectral brick-wall low-pass: removes this fraction (0 to 1) of the spectrum from the top.', 'sound("supersaw*4").note("c3").lbrick("<0 0.8 0.95>")', undefined, ['hbrick', 'lpf']),

    // SuperCollider's FreeVerb2
    freeverb: D('SuperCollider\'s FreeVerb2 on this sound: the mix of the reverb, 0 (dry) to 1 (all reverb). Unlike room(), which sends to a shared reverb, it reverberates each sound on its own, as a SynthDef does, and the sound rings on after its release.', 'sound("supersquare*2").note("c3 g3").legato(0.5).freeverb(0.4).freeroom(0.8)', 'superhoover has it built in (mix 0.3, room 0.9), as in its SynthDef; freeverb(0) turns it off.', ['freeroom', 'freedamp', 'room']),
    freeroom: D('The room size of freeverb, 0 to 1 (0.5 by default): larger rings longer.', 'sound("arpy*2").note("c e").freeverb(0.5).freeroom("<0.3 0.95>")', undefined, ['freeverb']),
    freedamp: D('How much freeverb damps the high frequencies, 0 to 1 (0.5 by default).', 'sound("arpy*2").note("c e").freeverb(0.5).freedamp("<0 1>")', undefined, ['freeverb']),

    // MIDI
    nrpn: D('Sends a MIDI NRPN message, "parameter:value" (both 0 to 16383), with .midi().', 'nrpn("1000:64").midi()', undefined, ['nrpnn', 'nrpnv', 'ccn']),
    nrpnn: D('The NRPN parameter number (0 to 16383), with nrpnv.', 'nrpnn(1000).nrpnv("0 64 127").midi()', undefined, ['nrpn']),
    nrpnv: D('The NRPN value (0 to 16383), with nrpnn.', 'nrpnn(5).nrpnv(saw.range(0, 16383).segment(8)).midi()', undefined, ['nrpn']),
});

// ---------------- Filter envelopes ----------------
const FILTER_NAMES: Record<string, [filter: string, base: string, example: string]> = {
    lp: ['low-pass filter', 'lpf', 'sound("supersaw*4").note("c2").lpf(300).lpenv(4).lpdecay(0.2)'],
    hp: ['high-pass filter', 'hpf', 'sound("supersaw*4").note("c3").hpf(100).hpenv(5).hpattack(0.2)'],
    bp: ['band-pass filter', 'bpf', 'sound("saw*4").note("c2").bpf(400).bpenv(3).bpdecay(0.3)'],
    peak: ['peak equaliser', 'peak', 'sound("supergabber*4").peak(3000).peakgain(15).peakenv(-0.32).peakattack(0.3)'],
};
for (const [prefix, [filter, base, example]] of Object.entries(FILTER_NAMES)) {
    const see = ['env', 'attack', 'decay', 'sustain', 'release'].map((part) => prefix + part).concat(base);
    DOCS[prefix + 'env'] = D(
        `An envelope on the ${filter} (${base}), in octaves: the frequency moves up by this many octaves (down, when negative) over ${prefix}attack, falls to ${prefix}sustain of the way over ${prefix}decay, and returns over ${prefix}release when the sound ends.`,
        example, `Without ${prefix}decay the frequency stays at the top; with it, ${prefix}sustain is 0 unless set. Needs ${base}() for the base frequency.`, see.filter((n) => n !== prefix + 'env'),
    );
    DOCS[prefix + 'attack'] = D(`The time the ${filter}'s envelope takes to reach ${prefix}env, in seconds (0 jumps there at once).`, example.replace(/\)$/, `).${prefix}attack(0.1)`), undefined, [prefix + 'env']);
    DOCS[prefix + 'decay'] = D(`The time the ${filter}'s envelope takes to fall from its top to ${prefix}sustain, in seconds.`, example, undefined, [prefix + 'env']);
    DOCS[prefix + 'sustain'] = D(`Where the ${filter}'s envelope rests after ${prefix}decay, 0 to 1 of ${prefix}env.`, example.replace(/\)$/, `).${prefix}sustain(0.5)`), undefined, [prefix + 'env']);
    DOCS[prefix + 'release'] = D(`The time the ${filter} takes to go back to its base frequency when the sound ends, in seconds.`, example.replace(/\)$/, `).${prefix}release(0.5)`), undefined, [prefix + 'env']);
}

// ---------------- Tidal 1.10's stream functions, triggers and SuperDirt's dry ----------------
Object.assign(DOCS, {
    dry: D('SuperDirt\'s dry: turns the orbit\'s reverb down, from 0 (all of it, the default) to 1 (none).', 'sound("arpy*2").room(0.5).size(0.8).dry("<0 0.5>")', undefined, ['room', 'size']),
    first: D('Plays the first cycle of the pattern once, right away (Tidal\'s first).', 'first(sound("<bd sn cp>*4"))', undefined, ['once']),
    asap: D('The same as once() (Tidal\'s asap).', 'asap(sound("cp*2"))', undefined, ['once']),
    only: D('Plays only this pattern: the other streams stop (Tidal\'s only = hush >> ...).', 'only(d1(sound("bd*2")))\nd2(sound("hh*8"))', undefined, ['hush', 'solo']),
    panic: D('Stops everything at once, and sends "all notes off" to the MIDI outputs (Tidal\'s panic).', 'panic()', undefined, ['hush']),
    setbpm: D('Sets the tempo in beats per minute, 4 beats per cycle (the same as setTempo).', 'setbpm(120)', undefined, ['setcps', 'setTempo']),
    getcps: D('Returns the tempo in cycles per second (Tidal\'s getcps).', 'getcps()', undefined, ['setcps']),
    getnow: D('Returns the cycle the clock is at now (Tidal\'s getnow).', 'getnow()', undefined, ['setCycle']),
    setCycle: D('Sets the cycle the clock is at, from the next cycle scheduled (Tidal\'s setCycle).', 'setCycle(16)', undefined, ['resetCycles', 'getnow']),
    cps: D('The tempo as a control, as Tidal\'s cps: when an event with cps plays, the tempo changes to it (setcps is once of it).', 'sound("bd*4").cps("<0.5 0.6>")', undefined, ['setcps']),
    sometimesByAfter: D('Tidal\'s sometimesBy\': applies the function first, then keeps each changed event with the given probability (and the unchanged ones the rest of the time).', 'sound("hh*8").sometimesByAfter(0.5, x => x.fast(2))', undefined, ['sometimesBy']),
    triggerWith: D('Tidal\'s triggerWith: restarts the pattern at fn(the cycle position when the code runs), e.g. Math.ceil for the next cycle.', 'sound("<bd sn cp hh>").triggerWith(Math.ceil)', undefined, ['qtrigger', 'trigger']),
    ctrigger: D('Restarts the pattern at the next cycle when the code runs (Tidal\'s ctrigger; the same as qtrigger).', 'sound("<bd sn cp hh>").ctrigger()', undefined, ['qtrigger', 'triggerWith']),
    rtrigger: D('Restarts the pattern at the nearest cycle when the code runs (Tidal\'s rtrigger).', 'sound("<bd sn cp hh>").rtrigger()', undefined, ['ctrigger', 'ftrigger']),
    ftrigger: D('Restarts the pattern at the start of the current cycle when the code runs (Tidal\'s ftrigger).', 'sound("<bd sn cp hh>").ftrigger()', undefined, ['ctrigger', 'rtrigger']),
    mtrigger: D('Restarts the pattern at the next cycle divisible by n when the code runs (Tidal\'s mtrigger).', 'sound("<bd sn cp hh>").mtrigger(4)', undefined, ['qtrigger', 'mt']),
    mt: D('The same as mtrigger().', 'sound("<bd sn cp hh>").mt(4)', undefined, ['mtrigger']),
    jumpInNext: D('Tidal\'s jumpIn\': switches the stream n cycles after the next cycle starts.', 'jumpInNext(1, 1, sound("cp*4"))', TRANSITION_TIP, ['jumpIn', 'jumpMod']),
    jumpModOffset: D('Tidal\'s jumpMod\': like jumpMod, switching `offset` cycles later.', 'jumpModOffset(1, 4, 1, sound("bd sn"))', TRANSITION_TIP, ['jumpMod']),
    histpan: D('Tidal\'s histpan: the stream\'s last n patterns played together, spread from left to right.', 'histpan(1, 3, sound("arpy*4").note("c e g b"))', 'Each new version of the stream adds to its history.', ['xfadeIn']),
    waitT: D('Tidal\'s waitT: waits some cycles, then runs a transition. Give the transition and its arguments: waitT(1, 4, xfadeIn, 8, pattern).', 'waitT(1, 2, xfadeIn, 4, sound("hh*8"))', TRANSITION_TIP, ['wait', 'xfadeIn']),
    weaveWith: D('Tidal\'s weaveWith (weave\'): like weave, with functions instead of patterns, each given the control pattern slowed over the cycles.', 'weaveWith(3, pan(saw2), [x => sound("bd sn").set(x), x => sound("hh*4").set(x)])', undefined, ['weave']),
});

// Tidal's *Take controls: one for every numeric control (nTake has its own entry).
for (const name of CONTROL_NAMES) {
    if (['s', 'sound', 'vowel', 'unit', 'nrpn', 'n'].includes(name)) continue;
    DOCS[name + 'Take'] = D(
        `Tidal's ${name}Take: each played event takes the next value of the list as its ${name}, counted under the name across cycles and code changes.`,
        undefined,
        undefined,
        ['nTake', name],
    );
}

/** Globals whose help differs from the method of the same name. */
export const GLOBAL_DOCS: Record<string, Doc> = {
    toScaleBy: D('toScaleBy(octave, steps, numbers): like toScale, with an octave of `octave` semitones (Tidal\'s toScale\').', 'note(toScaleBy(10, [0, 3, 7], "0 1 2 3 4 5")).sound("arpy")', undefined, ['toScale']),
    fitSlices: D('fitSlices(cycles, n, from, to, pattern): cuts the pattern into n parts named by `from`, played in the order of `to` (Tidal\'s fit\').', 'fitSlices(1, 2, "0 1", "1 0", sound("bd sn"))', undefined, ['fit']),
    fastAppend: D('fastAppend(a, b): both patterns squeezed into one cycle.', 'fastAppend(sound("bd*2"), sound("hh*3"))', undefined, ['slowAppend']),
    slowAppend: D('slowAppend(a, b): one pattern per cycle, a then b.', 'slowAppend(sound("bd*2"), sound("hh*3"))', undefined, ['fastAppend']),
    spreadf: D('spreadf(fns, pattern): applies the functions in turn, one per cycle.', 'spreadf([x => x.rev(), x => x.fast(2)], sound("bd sn hh"))', undefined, ['spread']),
    toScale: D('toScale(steps, numbers) turns a pattern of numbers into notes of a scale given as semitones.', 'note(toScale([0, 2, 3, 5, 7, 8, 10], "0 2 4 <6 7>")).sound("arpy")', undefined, ['scale']),
    pickF: D('pickF(indices, fns, pattern) applies to the pattern the function the index pattern picks.', 'pickF("<0 1>", [x => x.rev(), x => x.fast(2)], sound("bd sn hh"))', undefined, ['selectF']),
    selectF: D('selectF(amount, fns, pattern) applies to the pattern the function a number from 0 to 1 picks.', 'selectF("<0 0.5>", [x => x.rev(), x => x.fast(2)], sound("bd sn hh"))', undefined, ['pickF']),
    sew: D('sew(booleans, a, b) plays a where the booleans are true and b where they are false.', 'sew("t f", sound("bd*8"), sound("hh*16"))', undefined, ['stitch']),
    stitch: D('stitch(booleans, a, b): the rhythm of the booleans, true steps from a and false steps from b.', 'stitch("t f t t f t f f", sound("bd"), sound("sn"))', undefined, ['sew']),
    wedge: D('wedge(time, a, b) squashes a into the first part of each cycle and b into the rest.', 'wedge(0.25, sound("bd*4"), sound("hh*8"))', undefined, ['timeCat']),
    spread: D('spread(fn, values, pattern) applies fn(pattern, value) with each value in turn, one per cycle.', 'spread((p, x) => p.fast(x), [1, 2], sound("bd sn"))', undefined, ['fastspread']),
    fastspread: D('fastspread(fn, values, pattern): like spread, all values in one cycle.', 'fastspread((p, x) => p.speed(x), [1, 2], sound("bd sn"))', undefined, ['spread']),
    arp: D(
        'arp(mode, chords) arpeggiates a pattern of chords. The same as note(chords).arp(mode).',
        'sound("arpy").note(arp("<up down>", "<c\'maj e\'min>"))',
        undefined,
        ['chord', 'scale'],
    ),
};

/** Built-in synthesised sounds (also used as names of Dirt-Samples banks). */
export const SOUND_DOCS: Record<string, Doc> = {
    bd: D('Bass drum (kick): a synthesised kick with a pitch drop. With Dirt-Samples loaded, the bd bank of recorded kicks plays instead.', 'sound("bd*4")', '.n() picks a variation.', ['sn', 'hh']),
    sn: D('Snare drum: noise and a tone. The backbeat, usually on the second and fourth beat.', 'sound("~ sn ~ sn")', undefined, ['cp', 'bd']),
    hh: D('Hi-hat: short, bright noise. Usually plays fast patterns like hh*8 or hh*16.', 'sound("hh*8").gain(0.88)', undefined, ['oh', 'ch']),
    oh: D('Open hi-hat: a longer hi-hat. Placed on the off-beats it gives the house groove.', 'sound("[~ oh]*4")', undefined, ['hh', 'ch']),
    ch: D('Closed hi-hat: a very short, tight hi-hat.', 'sound("ch*16")', undefined, ['hh', 'oh']),
    cp: D('Hand clap: bursts of noise. Often doubles or replaces the snare.', 'sound("~ cp ~ cp")', undefined, ['sn']),
    cy: D('Cymbal: a long, bright crash. Mark the start of a phrase with it.', 'sound("cy ~ ~ ~").slow(4)', undefined, ['hh']),
    arpy: D('A plucked, harp-like synth. Plays notes, so use it with note(); in Dirt-Samples, arpy is a bank of plucked tones.', 'sound("arpy*4").note("c e g b")', undefined, ['note']),
    sine: D('A pure sine-wave synth: soft and round. Good for sub basses and gentle melodies. Set the pitch with note() or freq().', 'sound("sine").note("c2 ~ g1 ~").legato(1)', 'Outside a sound string, sine is a signal instead.', ['tri', 'note']),
    saw: D('A sawtooth synth: bright and buzzy, full of harmonics. The classic sound for basses, leads and pads; shape it with lpf().', 'sound("saw*8").note("c2 c3").lpf(800)', 'Outside a sound string, saw is a signal instead.', ['square', 'lpf']),
    square: D('A square-wave synth: hollow, like old video games and chiptune.', 'sound("square*4").note("c e g c5").lpf(2000)', 'Outside a sound string, square is a signal instead.', ['saw', 'tri']),
    tri: D('A triangle-wave synth: mellow, between sine and square. Nice for melodies and soft chords.', 'sound("tri").note("<c\'maj a\'min>").legato(1)', 'Outside a sound string, tri is a signal instead.', ['sine', 'square']),
    noise: D('White noise: all frequencies equally. Filter it into hats, risers and wind.', 'sound("noise*8").hpf(6000).sustain(0.05)', undefined, ['pink']),
    pink: D('Pink noise: softer and darker than white noise, with less treble.', 'sound("pink ~ ~ pink").sustain(0.2).hpf(800)', undefined, ['noise']),

    // SuperDirt-style synths
    supersaw: D('Seven detuned saws, as SuperDirt\'s supersaw: the trance lead and pad. detune spreads them (in semitones), voice sets the level of the side voices.', 'sound("supersaw").note("<c3\'min7 f3\'maj7>").legato(1).lpf(2000)', undefined, ['supersquare', 'detune', 'voice']),
    supersquare: D('Seven detuned square waves: hollow and wide. detune and voice work as in supersaw.', 'sound("supersquare*4").note("c3 eb3 g3 bb3").legato(0.8)', undefined, ['supersaw']),
    superpwm: D('Pulse-width modulation: two detuned pulse waves whose width sweeps, rate times a second, by lfo. A warm, moving analogue pad.', 'sound("superpwm").note("<c3 g2>").legato(1).rate(0.5)', undefined, ['rate', 'lfo']),
    superhoover: D('The hoover of rave music (after Nathan Ho\'s SynthDef): 20 detuned saws, each with one an octave down, spread across the stereo field and saturated, scooping up from 5 semitones below to 6 above and settling over 1.8 seconds, through FreeVerb2 (mix 0.3, room 0.9) that rings on for 4 seconds after the note.', 'sound("superhoover").note("d4").legato(1)', 'As in SuperCollider, amp is 0.1 by default. pitchenv() replaces the scoop; detune sets the spread (0.6 semitones); freeverb, freeroom and freedamp change the reverb.', ['supergabber', 'pitchenv', 'freeverb']),
    superreese: D('Reese bass: three saws detuned against each other and a sine an octave down, the drum and bass growl. Shape it with lpf().', 'sound("superreese").note("<c2 eb2>").legato(1).lpf(600)', undefined, ['detune', 'voice']),
    superzow: D('Phasing saws that sweep (rate, lfo), with a small rise in pitch at the start.', 'sound("superzow*2").note("c3 g3").legato(1)', undefined, ['rate', 'lfo']),
    superchip: D('A chiptune pulse wave: voice sets the pulse width, rate and lfo a vibrato.', 'sound("superchip*8").note("c4 e4 g4 c5").voice("<0.125 0.5>")', undefined, ['voice']),
    superfm: D('Two-operator FM: bright bells, basses and electric pianos. voice is the modulation index, semitone the modulator\'s interval above the note.', 'sound("superfm*4").note("c3 e3 g3 b3").voice(0.4).semitone(12)', undefined, ['voice', 'semitone']),
    superstatic: D('Crackle: random clicks through a band-pass at the note\'s frequency; voice sets how many.', 'sound("superstatic").legato(1).voice(0.3)', undefined, ['noise']),
    superpiano: D('An additive piano: stretched partials that fade, the higher ones faster, with a hammer thump. voice sets the brightness.', 'sound("superpiano").note("<c4\'maj e4\'min>").voice(0.6)', undefined, ['arpy']),
    supergong: D('A gong: inharmonic partials beating slowly, with a long decay. voice sets the brightness.', 'sound("supergong").note("c3").slow(2)', undefined, ['superfm']),
    superkick: D('A kick drum: a sine falling 30 semitones in 60 ms, with a click (voice). penv, pdecay and decay change it.', 'sound("superkick*4")', undefined, ['super808', 'penv', 'pdecay']),
    super808: D('The TR-808 kick: a long sine with a slow pitch fall, the hip-hop and trap boom. decay sets its length.', 'sound("super808 ~ ~ super808").decay(1.5)', undefined, ['superkick', 'decay']),
    superhat: D('The TR-808 hi-hat: six square waves at metallic ratios, band-passed. decay opens it.', 'sound("superhat*8").decay("<0.05 0.3>")', undefined, ['hh', 'decay']),
    supersnare: D('A snare: two triangle tones and band-passed noise; voice sets the tone\'s share.', 'sound("~ supersnare ~ supersnare")', undefined, ['sn', 'voice']),
    superclap: D('A hand clap: four quick noise bursts and a tail.', 'sound("~ superclap ~ superclap")', undefined, ['cp']),
    supergabber: D('The gabber kick (after Nathan Ho\'s SynthDef): a saw falling 4 octaves in 80 ms to 60 Hz, distorted hard, with a chorused high band. penv sets the fall (48 semitones).', 'sound("supergabber*4").legato(0.8).peak(3000).peakgain(15).peakq(2)', 'As in SuperCollider, amp is 0.1 by default and its envelope has a curve of -4. A peak boost (peak, peakgain, peakq) sweeping over the bars gives the classic sound.', ['superkick', 'superhoover', 'penv']),
};

/** Mini-notation symbols, by the title shown in the help. */
export const MINI_DOCS: Record<string, Doc> = {
    '~': D('A rest: one step of silence. In "bd ~ sn ~" the kick and snare alternate with silence.', 'sound("bd ~ ~ bd ~ ~ sn ~")'),
    '[ ]': D('Groups steps into a single step: everything inside shares the time of one step, so it plays faster. "bd [sn sn]" plays the two snares in the second half.', 'sound("bd [~ bd] sn [hh hh hh]")', 'Brackets can be nested: "bd [sn [hh hh]]".'),
    '< >': D('Alternation: plays one of the steps inside per cycle, in turn. "<bd sn cp>" is bd in cycle 0, sn in cycle 1, cp in cycle 2, then again. Weights count, as in Tidal: "<a@3 b>" plays a for three cycles.', 'sound("bd <sn cp> bd <sn [sn sn]>")', 'Great for chord progressions: note("<c\'maj a\'min f\'maj g\'maj>").'),
    '{ }': D('Polymeter: each comma-separated part keeps its own step length, so parts with different lengths drift against each other. The first part sets how many steps fit in a cycle (its weights count: "{a@3 b, c d}" plays 4), or %n sets it (a pattern too: %<2 4>).', 'sound("{bd sn, hh hh hh}")\nsound("{bd sn hh}%4")'),
    ',': D('Plays the parts on each side at the same time. "[bd, hh hh]" plays a kick and two hats together.', 'sound("[bd*2, hh*4, ~ sn]")'),
    '|': D('Random choice: picks one of the parts each cycle.', 'sound("bd [sn | cp | oh] bd [hh | ~]")'),
    '*n': D('Plays the step n times in its slot: "hh*4" is four hats in the time of one step. n can be a fraction ("bd*1.5") or a pattern in < > or [ ]: "bd*<2 3>" is 2 one cycle and 3 the next.', 'sound("bd*2 sn [hh hh]*2 cp*<3 4>")', undefined, ['fast', 'ply']),
    '/n': D('Stretches the step over n cycles: "bd/2" plays once every two cycles, "[a b c]/3" one item per cycle.', 'sound("bd sn/2")', undefined, ['slow']),
    '!n': D('Repeats the step: "bd!3 sn" is "bd bd bd sn". A lone ! (or "! 3" after a space) repeats the previous step, as in Tidal.', 'sound("bd!3 sn")'),
    '@n': D('Makes the step n times longer than the others (elongation): in "c@3 e" the c lasts three quarters of the cycle. After a space it lengthens the step before ("c @3 e"), and "_@2" adds two.', 'sound("tri").note("c@3 e g@2 b")'),
    '?': D('Removes the step at random: half of the time, or with the probability that follows, e.g. ?0.3.', 'sound("hh*8?")', undefined, ['degradeBy']),
    '(k,n,r)': D('A Euclidean rhythm: k hits spread as evenly as possible over n steps, rotated by r steps. (3,8) is the tresillo. Each number can be a pattern or a sequence: "bd(<3 5>,8)", "bd(3 5,8)".', 'sound("bd(3,8) sn(2,8,4) hh(5,8)")', undefined, ['euclid']),
    ':n': D('Picks a sound variation: "sn:2" is the third variation (or the third file of a sample bank). The same as .n(2).', 'sound("bd:0 sn:1 hh:2 cp:3")', undefined, ['n']),
    '_': D('Extends the previous step by one more step: "c _ _ e" holds c for three steps.', 'sound("tri").note("c _ _ e g _ b _")'),
    '.': D('Groups steps with dots: "bd sn . hh hh hh" is the same as "[bd sn] [hh hh hh]".', 'sound("bd bd . sn . hh hh hh")'),
    '%n': D('Sets how many steps per cycle a polymeter plays: "{bd sn hh}%4" plays four steps of the three-step pattern each cycle.', 'sound("{bd sn hh}%4")'),
    '..': D('A range, as in Tidal: "0 .. 7" is one step holding 0 1 2 3 4 5 6 7 (so "0 .. 3 4" is [0 1 2 3] 4), "7 .. 0" counts down, and note names count in semitones ("c .. e").', 'sound("hh*8").n("0 .. 7")'),
    '-': D('A rest, the same as ~ (Tidal\'s parser takes both).', 'sound("bd - sn -")'),
    '^name': D('Reads a value set from outside with setBus(name): "^kick" plays what setBus("kick", ...) holds, and nothing until it is set (Tidal\'s ^ reads control values).', 'sound("^kick sn")'),
    '1%3': D('Numbers can be fractions (1%3) or Tidal\'s ratio letters: w 1, h 1/2, q 1/4, e 1/8, s 1/16, t 1/3, f 1/5, x 1/6 (3q is three quarters).', 'sound("bd*<4 3q>")'),
};

/** Families of scales, for the hover help of scale names. */
export const SCALE_DOCS: Record<string, string> = {
    major: 'The major scale (ionian): bright and happy, the do re mi of Western music.',
    ionian: 'Ionian mode: the same as the major scale.',
    minor: 'The natural minor scale (aeolian): darker and sadder than major.',
    aeolian: 'Aeolian mode: the same as the natural minor scale.',
    dorian: 'Dorian mode: minor with a raised sixth. Jazzy and funky (So What, Oye Como Va).',
    phrygian: 'Phrygian mode: minor with a lowered second. Spanish and metal flavour.',
    lydian: 'Lydian mode: major with a raised fourth. Dreamy, film-score sound.',
    mixolydian: 'Mixolydian mode: major with a lowered seventh. Rock, blues and folk.',
    locrian: 'Locrian mode: with a lowered second and fifth. Very unstable and tense.',
    majpent: 'Major pentatonic: five notes, no half steps. Folk, country and pop melodies.',
    minpent: 'Minor pentatonic: five notes. The rock and blues guitar scale.',
    harmonicminor: 'Harmonic minor: minor with a raised seventh. Classical and Middle Eastern flavour.',
    melodicminor: 'Melodic minor: minor with raised sixth and seventh. Jazz.',
    whole: 'Whole-tone scale: six notes all a whole step apart. Floating, dreamlike.',
    wholetone: 'Whole-tone scale: six notes all a whole step apart.',
    chromatic: 'Chromatic scale: all twelve semitones.',
    blues: 'Blues scale: minor pentatonic plus the flat fifth "blue note".',
    ritusen: 'Ritusen: a Japanese pentatonic scale.',
    egyptian: 'Egyptian: a suspended pentatonic scale.',
    hexmajor7: 'A six-note major scale without the fourth.',
    hexdorian: 'A six-note dorian scale.',
    hexphrygian: 'A six-note phrygian scale.',
    bhairav: 'Bhairav: an Indian raga scale with lowered second and sixth.',
    diminished: 'Diminished (octatonic): alternating half and whole steps. Tense, used in jazz and film.',
    augmented: 'Augmented scale: alternating minor thirds and half steps.',
    hungarianminor: 'Hungarian minor: harmonic minor with a raised fourth. Exotic and dramatic.',
    pelog: 'Pelog: a scale of Indonesian gamelan music.',
    hirajoshi: 'Hirajoshi: a Japanese pentatonic scale used for koto.',
    iwato: 'Iwato: a dark Japanese pentatonic scale.',
    kumai: 'Kumai: a Japanese pentatonic scale.',
    chinese: 'Chinese: a pentatonic scale with a raised fourth.',
    indian: 'Indian: a five-note scale with a minor seventh.',
    prometheus: 'Prometheus: Scriabin\'s mystic, whole-tone-like six-note scale.',
    scriabin: 'Scriabin: a five-note scale with a minor second.',
    gong: 'Gong: the Chinese pentatonic mode on the first degree (the same notes as major pentatonic).',
    shang: 'Shang: the Chinese pentatonic mode on the second degree.',
    jiao: 'Jiao: the Chinese pentatonic mode on the third degree.',
    zhi: 'Zhi: the Chinese pentatonic mode on the fifth degree.',
    yu: 'Yu: the Chinese pentatonic mode on the sixth degree (the same notes as minor pentatonic).',
    augmented2: 'Augmented, second form: alternating half steps and minor thirds.',
    hexsus: 'A six-note suspended scale, without the third.',
    hexmajor6: 'A six-note major scale without the seventh.',
    hexaeolian: 'A six-note minor scale without the second.',
    harmonicmajor: 'Harmonic major: major with a lowered sixth.',
    melodicminordesc: 'Melodic minor descending: the same notes as natural minor.',
    melodicmajor: 'Melodic major: major with lowered sixth and seventh (the Hindu scale).',
    bartok: 'Bartók: the melodic major, as in Tidal (major with lowered sixth and seventh).',
    hindu: 'Hindu: the melodic major, as in Tidal (major with lowered sixth and seventh).',
    todi: 'Todi: an Indian raga scale.',
    purvi: 'Purvi: an Indian raga scale with a lowered second and a raised fourth.',
    marva: 'Marva: an Indian raga scale with a lowered second and a raised fourth.',
    ahirbhairav: 'Ahir Bhairav: an Indian raga scale.',
    superlocrian: 'Super Locrian (altered scale): every note but the root lowered. Tense, jazzy.',
    romanianminor: 'Romanian minor: dorian with a raised fourth.',
    neapolitanminor: 'Neapolitan minor: harmonic minor with a lowered second.',
    enigmatic: 'Enigmatic: Verdi\'s unusual scale with a lowered second and raised fourth, fifth and sixth.',
    spanish: 'Spanish (Phrygian dominant): phrygian with a major third. Flamenco.',
    leadingwhole: 'Leading whole-tone: a whole-tone scale with a leading note.',
    lydianminor: 'Lydian minor: lydian with lowered sixth and seventh.',
    neapolitanmajor: 'Neapolitan major: melodic minor with a lowered second.',
    locrianmajor: 'Locrian major: major third, lowered fifth, sixth and seventh.',
    octatonic: 'Octatonic: the same as diminished (half step first).',
    diminished2: 'Diminished, second form: whole step first.',
    octatonic2: 'Octatonic, second form: the same as diminished2.',
    messiaen1: 'Messiaen\'s first mode of limited transposition: the whole-tone scale.',
    messiaen2: 'Messiaen\'s second mode: the octatonic (diminished) scale.',
    messiaen3: 'Messiaen\'s third mode of limited transposition (nine notes).',
    messiaen4: 'Messiaen\'s fourth mode of limited transposition.',
    messiaen5: 'Messiaen\'s fifth mode of limited transposition.',
    messiaen6: 'Messiaen\'s sixth mode of limited transposition.',
    messiaen7: 'Messiaen\'s seventh mode of limited transposition (ten notes).',
    bayati: 'Bayati: an Arabic maqam with quarter tones.',
    hijaz: 'Hijaz: an Arabic maqam with an augmented second, close to phrygian dominant.',
    sikah: 'Sikah: an Arabic maqam with quarter tones.',
    rast: 'Rast: an Arabic maqam with quarter tones.',
    saba: 'Saba: an Arabic maqam with quarter tones.',
    iraq: 'Iraq: an Arabic maqam with quarter tones.',
};

/** Help for a snippet of the insert palette, by its label and code. */
export function docForLabel(label: string, category?: string): Doc | undefined {
    if (category === 'Sounds' && SOUND_DOCS[label]) return SOUND_DOCS[label];
    const alias = LABEL_ALIASES[label];
    if (alias) return alias;
    const name = label.replace(/^\./, '').replace(/\(.*\)$/, '').split(' ')[0];
    return MINI_DOCS[label] ?? DOCS[name] ?? SOUND_DOCS[label];
}

const LABEL_ALIASES: Record<string, Doc> = {
    '*<n m>': MINI_DOCS['*n'],
    '[a, b]': MINI_DOCS[','],
    '[a | b]': MINI_DOCS['|'],
    '{ }%n': MINI_DOCS['%n'],
    '(k,n)': MINI_DOCS['(k,n,r)'],
    '?x': MINI_DOCS['?'],
    '0 .. 7': MINI_DOCS['..'],
    'bd:3': MINI_DOCS[':n'],
    "c'maj": DOCS.chord,
    'Dirt-Samples': DOCS.samples,
};

/** A doc as plain text, for title attributes. */
export function docText(doc: Doc): string {
    let text = doc.about;
    if (doc.example) text += '\n\nExample:\n' + doc.example;
    if (doc.tip) text += '\n\n' + doc.tip;
    return text;
}
