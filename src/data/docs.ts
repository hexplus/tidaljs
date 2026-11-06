/**
 * Extended help for everything in TidalJS: what it does and how it relates
 * to TidalCycles, an example, a tip and related names. Shown by the hover
 * help and the insert palette.
 *
 * Time in Tidal is measured in cycles: a pattern describes one cycle (a bar,
 * usually) and repeats it. Every function here changes what happens inside
 * cycles, which cycles something happens in, or what each event sounds like.
 */

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

const FN_ARG = 'The function receives the pattern and returns a changed one, e.g. x => x.fast(2) or x => x.speed(2).gain(0.8).';

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
        'stack([\n  sound("bd*4"),\n  sound("~ cp"),\n  sound("hh*8").gain(0.5)\n])',
        'Effects after stack([...]) apply to every layer: stack([...]).room(0.3).',
        ['layer', 'overlay', 'superimpose'],
    ),
    layer: D('The same as stack(): plays every pattern at the same time.', 'layer([sound("bd*2"), sound("hh*4")])', undefined, ['stack']),
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
        'euclidFull(3, 8, sound("bd"), sound("hh"))\nsound("bd").euclidFull(3, 8, sound("hh").gain(0.5))',
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
    ply: D(
        'Repeats each event n times within its own span, so "bd sn" with ply(2) becomes "[bd bd] [sn sn]". The factor can be a pattern.',
        'sound("bd ~ sn hh").ply("<1 2 3>")',
        undefined,
        ['fast', 'chop'],
    ),
    iter: D(
        'Divides the cycle into n parts and starts each cycle one part further in: with iter(4), "a b c d" plays as "a b c d", then "b c d a", "c d a b", "d a b c".',
        'sound("arpy*4").note("c e g b").iter(4)',
        undefined,
        ['iterBack', 'rot', 'chunk'],
    ),
    iterBack: D('Like iter(), but moving backwards: "a b c d", then "d a b c", "c d a b"...', 'sound("bd hh sn cp").iterBack(4)', undefined, ['iter']),
    linger: D(
        'Repeats the first part of each cycle to fill the cycle: linger(0.25) plays the first quarter four times. A negative fraction repeats the end of the cycle instead. Great for stutters and build-ups.',
        'sound("bd [~ bd] sn hh*2").linger("<1 0.5 0.25>")',
        undefined,
        ['ply', 'chop', 'iter'],
    ),
    rot: D(
        'Keeps the rhythm but shifts the values along the events of each cycle: with rot(1), every event takes the value of the next one. The structure stays, the order of sounds or notes rotates.',
        'sound("bd ~ sn [hh cp]").rot("<0 1 2 3>")',
        undefined,
        ['iter'],
    ),
    late: D(
        'Shifts the pattern later in time by a number of cycles: late(0.25) moves everything a quarter of a cycle later. Events that move past the end of the cycle appear at the start of the next one.',
        'sound("bd sn").superimpose(x => x.late(0.125).gain(0.5))',
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
    swingBy: D(
        'Adds swing: the cycle is divided into n slices and the second half of each slice is delayed by x (a fraction of the slice). swingBy(1/3, 4) delays every other eighth note.',
        'sound("hh*8").swingBy(1/3, 4)',
        undefined,
        ['swing'],
    ),
    swing: D('Swing with a fixed amount of one third: swing(4) is swingBy(1/3, 4). The number of slices can be a pattern.', 'sound("hh*8").swing(4).overlay("bd ~ sn ~")', undefined, ['swingBy']),
    off: D(
        'Plays a copy of the pattern, shifted later by a time and changed by a function, on top of the original. A classic Tidal way to make echoes and counter-melodies.',
        'sound("arpy*4").note("c e g b").off(0.125, x => x.up(12).gain(0.5))',
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
        'Divides the cycle into n parts and applies the function to one part per cycle, in turn: part 0 in cycle 0, part 1 in cycle 1, and so on.',
        'sound("bd sn hh cp").chunk(4, x => x.hurry(2))',
        FN_ARG,
        ['within', 'iter', 'every'],
    ),
    while: D(
        'Applies a function wherever a boolean pattern is true: "1 0" changes the first half of each cycle and leaves the second.',
        'sound("hh*8").while("1 0 0 1", x => x.gain(0.3))',
        FN_ARG,
        ['within', 'struct'],
    ),
    until: D('Applies a function until a given cycle, then plays the pattern unchanged. Counts from cycle 0, when you first press Play.', 'sound("bd*4").until(4, x => x.lpf(300))', FN_ARG, ['playFor']),
    playFor: D('Only plays between two cycles: playFor(2, 6) is silent before cycle 2 and from cycle 6 on. Useful to write a short arrangement.', 'sound("cp ~ cp ~").playFor(2, 6)', undefined, ['stopFor', 'until']),
    stopFor: D('Is silent between two cycles and plays the rest of the time.', 'sound("hh*8").stopFor(4, 8)', undefined, ['playFor']),

    // ---------------- Randomness ----------------
    sometimesBy: D(
        'Applies a function to each event with a probability between 0 and 1. The randomness depends on the time of the event, so it repeats the same way every time you play.',
        'sound("hh*8").sometimesBy(0.3, x => x.speed(2))',
        FN_ARG,
        ['sometimes', 'often', 'rarely', 'degradeBy'],
    ),
    sometimes: D('Applies a function to about half of the events, chosen at random.', 'sound("hh*8").sometimes(x => x.gain(0.3))', FN_ARG, ['sometimesBy', 'often', 'rarely']),
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
    choose: D(
        'Picks one value at random from a list when the code runs. Every time you press Play (or the code updates) the pick can change; it does not change from cycle to cycle.',
        'sound(choose(["bd*2 sn", "bd sn*2"]))',
        'For random choices that change per cycle, use "[a | b]" in mini-notation or randcat().',
        ['wchoose', 'cycleChoose', 'randcat'],
    ),
    wchoose: D('Picks a value at random with weights, when the code runs: [["bd", 3], ["sn", 1]] picks bd three times as often as sn.', 'sound(wchoose([["bd*4", 3], ["bd*8", 1]]))', undefined, ['choose']),
    cycleChoose: D('Picks a value from a list by the current cycle number when the code runs, so re-running it later gives the next value.', 'sound("saw").vowel(cycleChoose(["a", "e", "i"]))', undefined, ['choose']),

    // ---------------- Rearranging ----------------
    bite: D(
        'Divides each cycle into n parts and plays them in the order of an index pattern: bite(4, "0 2 1 3") swaps the middle two quarters.',
        'sound("arpy*8").note("c d e f g a b c5").bite(4, "0 2 <1 3> 0")',
        undefined,
        ['fitment', 'scramble', 'shuffle'],
    ),
    fitment: D('The same as bite().', 'sound("bd sn hh cp").fitment(4, "0 0 2 1")', undefined, ['bite']),
    chop: D(
        'Cuts each sound into n equal parts that play one after the other in the event\'s time. On a long sample, each part starts further into the recording, which gives granular, glitchy textures.',
        'sound("breaks125").chop(16).linger("<1 0.25>")',
        'Works best with recorded samples (see samples()). The number of parts can be a pattern.',
        ['striate', 'begin', 'linger'],
    ),
    striate: D(
        'Plays the pattern n times per cycle; each time, every sound plays a different slice of itself. Unlike chop(), the slices of different sounds are interleaved.',
        'sound("bd sn").striate(4)',
        undefined,
        ['chop'],
    ),

    // ---------------- Composition ----------------
    superimpose: D(
        'Plays the pattern and a changed copy of it at the same time. Good for octave doubling, echoes or thickening a part.',
        'sound("arpy*4").note("c e g b").superimpose(x => x.up(12).gain(0.5))',
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
        'Plays the pattern on k hits spread as evenly as possible over n steps: a Euclidean rhythm. Many traditional rhythms are Euclidean: (3,8) is the tresillo, (5,8) the cinquillo. The rotation shifts the hits along the steps.',
        'sound("bd").euclid(3, 8)\nsound("cp").euclid(2, 8, 2)',
        'In mini-notation write "bd(3,8)" or "bd(3,8,2)".',
        ['euclidInv', 'euclidFull', 'struct'],
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
    isaw: D('A ramp that falls from 1 to 0 over each cycle: the inverse of saw.', 'sound("hh*16").gain(isaw.range(0.2, 1))', undefined, ['saw']),
    tri: D('A triangle wave: rises from 0 to 1 in the first half of the cycle and falls back in the second.', 'sound("saw*8").lpf(tri.range(400, 2400))', 'Inside a sound string, tri is a triangle synth instead.', ['sine', 'saw']),
    square: D('A square wave: 0 for the first half of the cycle and 1 for the second.', 'sound("hh*8").pan(square.range(-0.7, 0.7))', 'Inside a sound string, square is a square-wave synth instead.', ['tri']),
    rand: D(
        'A random value from 0 to 1, different at every moment but the same each time that moment is played. Use it to vary controls.',
        'sound("hh*16").gain(rand.range(0.3, 1))',
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
    quantise: D('Rounds numeric values to the nearest whole number, e.g. to turn a signal into notes.', 'sound("arpy*8").note(sine.range(0, 12).segment(8).quantise())', undefined, ['range', 'smooth']),
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
    n: D(
        'Chooses the variation of a sound: for a sample bank, the file number (counting from 0); for synth drums, a slightly different version. bd:3 in a sound string is the same as .n(3).',
        'sound("hh*8").n("0 .. 7")',
        'In Tidal, n is also used for notes on synths; here use note() for pitch.',
        ['note', 'sound', 'nTake'],
    ),
    up: D('Transposes by a number of semitones: 12 is an octave up, -7 a fifth down. Works on notes and on samples.', 'sound("arpy").note("c e g").up("<0 5 7>")', undefined, ['note', 'speed']),
    freq: D('Sets the pitch directly as a frequency in Hz. 440 is the A above middle C.', 'sound("sine").freq("220 330 440 660")', undefined, ['note', 'midinote']),
    midinote: D('Sets the pitch as a MIDI note number: 60 is middle C, 69 is A440, one step per semitone.', 'sound("saw").midinote("48 55 60 63")', undefined, ['note', 'freq']),
    scale: D(
        'Turns scale degrees into notes. 0 is the root, 1 the second note of the scale and so on; negative degrees go down and degrees past the scale continue in the next octave. The name can include a root, like "e:minor", and can itself be a pattern.',
        'sound("arpy*8").note(scale("<c:major a:minor>", "0 2 4 <7 9>"))',
        'Hover a scale name to see its notes. scaleList() returns all the names.',
        ['note', 'chord', 'arp', 'scaleList'],
    ),
    scaleP: D('The same as scale().', undefined, undefined, ['scale']),
    scaleList: D('Returns the names of every scale scale() knows: major, minor, the church modes, pentatonics, blues and many more.', 'scaleList()', undefined, ['scale']),
    chord: D(
        'A pattern of chords written as root\'name, e.g. "c\'maj e\'min7". Each chord plays all its notes at once. Add \'i to invert, \'o to open the voicing, or a number for the note count.',
        'sound("saw").note(chord("<c\'maj a3\'min f3\'maj g3\'dom7>")).legato(1)',
        'The same chord words work directly in note("...").',
        ['arp', 'inversion', 'chordList', 'note'],
    ),
    chordList: D('Returns the names of every chord: major, minor, maj7, dom7, min7, dim, aug, sus2, sus4 and more.', 'chordList()', undefined, ['chord']),
    arp: D(
        'Arpeggiates chords: plays their notes one after another inside the chord\'s step instead of all at once. Modes: up, down, updown, downup, up&down, down&up, converge, diverge, disconverge, pinkyup and thumbup. The mode can be a pattern.',
        'sound("arpy").note("<c\'maj\'5 a3\'min7\'5>").arp("<up updown>")',
        'As a global, arp(mode, chords) takes the chords as a second argument.',
        ['chord', 'arpeggiate', 'inversion'],
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
    gain: D('Sets the volume: 1 is normal, 0 is silent and up to 2 is louder. Patterns of gain make accents.', 'sound("hh*8").gain("1 0.5 0.8 0.5")', undefined, ['pan', 'velocity']),
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
    resonance: D('The resonance (Q) of the low-pass filter: higher values emphasise the frequencies at the cutoff for a squelchy, acid sound. Try 5 to 20.', 'sound("saw*16").lpf(sine.range(300, 2000)).resonance(12)', undefined, ['lpf']),
    delay: D(
        'An echo: the value is the delay time in seconds, and the echoes fade out as they repeat. Each orbit has its own delay lines.',
        'sound("cp ~ ~ ~").delay(0.375)',
        'In TidalCycles, delay is the echo level and delaytime the time; here delay sets the time.',
        ['reverb', 'orbit', 'off'],
    ),
    reverb: D('Sends the sound to a reverb, from 0 (dry) to 1. Use size() for the size of the room.', 'sound("sn ~ arpy ~").note("c e").reverb(0.6).size(0.9)', undefined, ['room', 'size', 'orbit']),
    room: D('The same as reverb(): the amount of reverb, 0 to 1, as in TidalCycles.', 'sound("cp*2").room(0.4)', undefined, ['reverb', 'size']),
    size: D('The size of the reverb room, 0 to 1: larger rooms ring longer. Has an effect only together with room() or reverb().', 'sound("arpy").room(0.5).size(0.95)', undefined, ['room', 'reverb']),
    orbit: D(
        'Chooses the effect bus: sounds on the same orbit share one delay and one reverb. Put parts with different reverb sizes or delay times on different orbits so they do not affect each other.',
        'stack([sound("bd*4"), sound("cp").room(0.8).size(1).orbit(1)])',
        undefined,
        ['delay', 'reverb'],
    ),
    distortion: D('Waveshaping distortion, from 1 (subtle) to 100 (extreme). Adds grit to kicks and basses.', 'sound("bd sn bd sn").distortion("<1 10 50>")', undefined, ['crush']),
    crush: D('A bit crusher: reduces the resolution of the sound to n bits, from 16 (clean) to 1 (very harsh), for a lo-fi, 8-bit feel.', 'sound("arpy*4").note("c e g b").crush("<16 8 4 2>")', undefined, ['distortion']),
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
    loop: D('Repeats the sound n times in a row, up to 32.', 'sound("cp").loop(3)', undefined, ['ply']),
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

/** Globals whose help differs from the method of the same name. */
export const GLOBAL_DOCS: Record<string, Doc> = {
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
    hh: D('Hi-hat: short, bright noise. Usually plays fast patterns like hh*8 or hh*16.', 'sound("hh*8").gain(0.6)', undefined, ['oh', 'ch']),
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
};

/** Mini-notation symbols, by the title shown in the help. */
export const MINI_DOCS: Record<string, Doc> = {
    '~': D('A rest: one step of silence. In "bd ~ sn ~" the kick and snare alternate with silence.', 'sound("bd ~ ~ bd ~ ~ sn ~")'),
    '[ ]': D('Groups steps into a single step: everything inside shares the time of one step, so it plays faster. "bd [sn sn]" plays the two snares in the second half.', 'sound("bd [~ bd] sn [hh hh hh]")', 'Brackets can be nested: "bd [sn [hh hh]]".'),
    '< >': D('Alternation: plays one of the steps inside per cycle, in turn. "<bd sn cp>" is bd in cycle 0, sn in cycle 1, cp in cycle 2, then again.', 'sound("bd <sn cp> bd <sn [sn sn]>")', 'Great for chord progressions: note("<c\'maj a\'min f\'maj g\'maj>").'),
    '{ }': D('Polymeter: each comma-separated part keeps its own step length, so parts with different lengths drift against each other. The first part sets how many steps fit in a cycle, or %n sets it.', 'sound("{bd sn, hh hh hh}")\nsound("{bd sn hh}%4")'),
    ',': D('Plays the parts on each side at the same time. "[bd, hh hh]" plays a kick and two hats together.', 'sound("[bd*2, hh*4, ~ sn]")'),
    '|': D('Random choice: picks one of the parts each cycle.', 'sound("bd [sn | cp | oh] bd [hh | ~]")'),
    '*n': D('Plays the step n times in its slot: "hh*4" is four hats in the time of one step. n can be a fraction: "bd*1.5".', 'sound("bd*2 sn [hh hh]*2 cp*3")', undefined, ['fast', 'ply']),
    '/n': D('Stretches the step over n cycles: "bd/2" plays once every two cycles, "[a b c]/3" one item per cycle.', 'sound("bd sn/2")', undefined, ['slow']),
    '!n': D('Repeats the step: "bd!3 sn" is "bd bd bd sn". A lone ! repeats the previous step once more.', 'sound("bd!3 sn")'),
    '@n': D('Makes the step n times longer than the others (elongation): in "c@3 e" the c lasts three quarters of the cycle.', 'sound("tri").note("c@3 e g@2 b")'),
    '?': D('Removes the step at random: half of the time, or with the probability that follows, e.g. ?0.3.', 'sound("hh*8?")', undefined, ['degradeBy']),
    '(k,n,r)': D('A Euclidean rhythm: k hits spread as evenly as possible over n steps, rotated by r steps. (3,8) is the tresillo.', 'sound("bd(3,8) sn(2,8,4) hh(5,8)")', undefined, ['euclid']),
    ':n': D('Picks a sound variation: "sn:2" is the third variation (or the third file of a sample bank). The same as .n(2).', 'sound("bd:0 sn:1 hh:2 cp:3")', undefined, ['n']),
    '_': D('Extends the previous step by one more step: "c _ _ e" holds c for three steps.', 'sound("tri").note("c _ _ e g _ b _")'),
    '.': D('Groups steps with dots: "bd sn . hh hh hh" is the same as "[bd sn] [hh hh hh]".', 'sound("bd bd . sn . hh hh hh")'),
    '%n': D('Sets how many steps per cycle a polymeter plays: "{bd sn hh}%4" plays four steps of the three-step pattern each cycle.', 'sound("{bd sn hh}%4")'),
    '..': D('A range: "0 .. 7" expands to the steps 0 1 2 3 4 5 6 7, and "7 .. 0" counts down.', 'sound("hh*8").n("0 .. 7")'),
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
