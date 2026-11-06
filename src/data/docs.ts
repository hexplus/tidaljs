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
        'An echo, as in Tidal: delay is how loud the echoes are (0 to 1), delaytime the time between them in seconds (default 0.25) and delayfeedback how much each echo repeats (default 0.5). Each orbit has its own delay lines.',
        'sound("cp ~ ~ ~").delay(0.6).delaytime(0.375).delayfeedback(0.5)',
        'With .lock(1), delaytime is in cycles instead, so the echoes follow the tempo.',
        ['delaytime', 'delayfeedback', 'reverb', 'off'],
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
        'Tidal\'s |+ operator: adds numbers, keeping the rhythm of this pattern. Controls add key by key: note("0 4").add(note("<0 12>")) adds an octave every other cycle. A plain number adds to note (or n). Strings join: sound("drum").add(s(":3")) is drum:3.',
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
    euclidOff: D('A Euclidean rhythm with a rotation, as Tidal\'s euclidOff: the same as euclid(k, n, rotation).', 'sound("bd").euclidOff(3, 8, 2)', undefined, ['euclid', 'eoff']),
    eoff: D('Short for euclidOff.', 'sound("cp").eoff(3, 8, 2)', undefined, ['euclidOff']),
    euclidOffFull: D('euclidOff on the hits and another pattern on the rests.', 'sound("bd").euclidOffFull(3, 8, 2, sound("hh"))', undefined, ['euclidFull']),
    zoom: D('Zooms into part of each cycle: zoom(0.25, 0.75) plays the middle half of every cycle, stretched to fill it.', 'sound("bd*2 sn hh*4 cp").zoom(0.25, 0.75)', undefined, ['compress', 'linger']),
    zoomArc: D('The same as zoom().', undefined, undefined, ['zoom']),
    fastGap: D('Squashes each cycle into its first 1/n and leaves the rest silent: unlike fast, nothing repeats.', 'sound("bd sn hh cp").fastGap("<1 2>")', undefined, ['fast', 'compress']),
    densityGap: D('The same as fastGap().', undefined, undefined, ['fastGap']),
    trunc: D('Plays only the first part of each cycle: trunc(0.75) cuts the last quarter off.', 'sound("bd sn hh cp").trunc("<1 0.75 0.5>")', undefined, ['linger', 'fastGap']),
    repeatCycles: D('Repeats each cycle n times before moving on to the next.', 'sound("<bd sn cp hh>*4").repeatCycles(2)', undefined, ['loopFirst', 'linger']),
    loopFirst: D('Plays the first cycle of the pattern over and over.', 'sound("<bd sn cp>*4").loopFirst()', undefined, ['repeatCycles']),
    discretise: D('The same as segment(): samples the pattern n times per cycle.', 'sound("sine").freq(saw.range(200, 800).discretise(8))', undefined, ['segment']),
    press: D('Moves every event to the second half of its step, so the pattern plays on the off-beats.', 'sound("hh*4").press().overlay("bd*4")', undefined, ['pressBy', 'late']),
    pressBy: D('Moves every event later by a fraction of its own step (and shortens it): pressBy(0.5) is press().', 'sound("hh*4").pressBy("<0 0.25 0.5>")', undefined, ['press']),
    plyWith: D(
        'Repeats each event n times within its step, applying the function once more to each repeat: echoes that fade, rise or change.',
        'sound("cp*2").plyWith(4, x => x.gain(0.6))',
        undefined,
        ['ply', 'echoWith'],
    ),
    rolled: D('Strums chords: instead of all at once, their notes start one after another, from the lowest, over the first quarter of the event.', 'sound("tri").note("<c\'maj e\'min7 f\'maj>").rolled().legato(1)', undefined, ['rolledBy', 'arp']),
    rolledBy: D('Strums chords by an amount of the event: rolledBy(0.5) spreads the notes over half of it, a negative amount strums from the top down.', 'sound("tri").note("<c\'maj\'5 a\'min\'5>").rolledBy("<0.25 -0.5>")', undefined, ['rolled', 'arp']),

    // Conditions
    when: D('Applies a function on the cycles for which a test of the cycle number is true: when(c => c % 4 === 3, f) changes every fourth cycle.', 'sound("bd sn hh cp").when(c => c % 4 === 3, x => x.fast(2))', 'Tidal writes the test as ((elem \'4\') . show) or similar; here it is a JavaScript function.', ['ifp', 'every', 'whenmod']),
    ifp: D('Applies one function on the cycles a test accepts and another on the rest.', 'sound("bd sn hh cp").ifp(c => c % 2 === 0, x => x.rev(), x => x.fast(2))', undefined, ['when']),
    foldEvery: D('Like every(), with several periods: foldEvery([3, 5], f) applies f on cycles divisible by 3 or by 5.', 'sound("bd sn").foldEvery([3, 5], x => x.fast(2))', undefined, ['every']),
    someCyclesBy: D('Applies a function to whole cycles at random, each with the given probability. sometimesBy decides per event; this decides per cycle.', 'sound("bd*8").someCyclesBy(0.3, x => x.speed(2))', undefined, ['someCycles', 'sometimesBy']),
    someCycles: D('Applies a function to about half of the cycles, chosen at random.', 'sound("hh*8").someCycles(x => x.hpf(4000))', undefined, ['someCyclesBy']),
    somecyclesBy: D('The same as someCyclesBy().', undefined, undefined, ['someCyclesBy']),
    somecycles: D('The same as someCycles().', undefined, undefined, ['someCycles']),
    always: D('Always applies the function: the same as calling it. Useful to switch a change on and off by renaming always to never.', 'sound("bd sn").always(x => x.fast(2))', undefined, ['never']),
    never: D('Never applies the function: the pattern plays unchanged. Rename it to always to switch the change on.', 'sound("bd sn").never(x => x.fast(2))', undefined, ['always']),
    inside: D('Applies a function inside each part of the cycle: inside(2, x => x.rev()) reverses each half cycle instead of the whole cycle.', 'sound("bd sn hh cp").inside(2, x => x.rev())', undefined, ['outside', 'within']),
    outside: D('Applies a function over several cycles at once: outside(2, x => x.rev()) reverses each pair of cycles.', 'sound("<[bd sn] [hh cp]>").outside(2, x => x.rev())', undefined, ['inside']),
    chunkBack: D('Like chunk(), moving backwards through the parts: the last part first (Tidal\'s chunk\').', 'sound("bd sn hh cp").chunkBack(4, x => x.hurry(2))', undefined, ['chunk']),
    fix: D('Applies a function only to the events with the given controls: fix(x => x.fast(2), { s: "bd" }) doubles the kicks only. A list matches any of its values.', 'sound("bd sn hh cp").fix(x => x.speed(2), { s: ["sn", "cp"] })', undefined, ['unfix', 'contrast']),
    unfix: D('Applies a function to the events without the given controls.', 'sound("bd sn hh cp").unfix(x => x.gain(0.5), { s: "bd" })', undefined, ['fix']),
    contrast: D('Applies one function to the events with the given controls and another to the rest.', 'sound("bd sn hh cp").contrast(x => x.speed(2), x => x.gain(0.4), { s: "bd" })', undefined, ['fix']),
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
        ['echoWith', 'stut', 'delay'],
    ),
    echoWith: D('Echoes changed by a function: each echo is the previous one with the function applied once more, `time` cycles later.', 'sound("arpy").note("c e").echoWith(4, 1/8, x => x.up(7).gain(0.8))', undefined, ['echo', 'plyWith', 'off']),
    stutWith: D('The same as echoWith(), with Tidal\'s older name.', undefined, undefined, ['echoWith']),
    stut: D('Tidal\'s classic echo: count sounds, `time` cycles apart, getting quieter towards the gain given by feedback.', 'sound("bd sn").stut(3, 0.5, 1/8)', undefined, ['echo']),
    stutter: D('Repeats each sound n times, `time` cycles apart, at the same volume: a stutter or roll.', 'sound("sn").stutter(4, 1/16)', undefined, ['echo', 'ply']),
    ghost: D('Adds two ghost notes after each event: quieter, shorter and a little higher, like a drummer\'s ghost strokes.', 'sound("~ sn").ghost().overlay("bd*2")', undefined, ['ghostWith']),
    ghostWith: D('Adds ghost notes changed by a function, 1.5 and 2.5 times `time` after each event.', 'sound("~ sn").ghostWith(1/8, x => x.gain(0.5).speed(2))', undefined, ['ghost', 'off']),

    // Values
    rangex: D('Like range(), but exponential: better for frequencies, where each octave doubles.', 'sound("saw*8").lpf(sine.rangex(100, 5000).slow(4))', undefined, ['range']),
    qfloor: D('Rounds numbers down to whole numbers.', 'n(sine.range(0, 8).segment(8).qfloor()).sound("arpy")', undefined, ['qceiling', 'quantise']),
    qceiling: D('Rounds numbers up to whole numbers.', 'n(sine.range(0, 8).segment(8).qceiling()).sound("arpy")', undefined, ['qfloor', 'quantise']),
    qround: D('Rounds numbers to the nearest whole number: the same as quantise().', undefined, undefined, ['quantise']),
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
    striateBy: D('Like striate(), with slices of a given length (0 to 1) that can overlap.', 'sound("breaks125").striateBy(8, 0.25)', undefined, ['striate', 'chop']),

    // Triggers
    qtrigger: D('Restarts the pattern from its first cycle at the next cycle after the code runs, so a sequence starts at its beginning instead of the middle.', 'sound("<bd sn cp hh>").qtrigger()', 'Each time the code runs (Play or a live update), it restarts.', ['trigger', 'once']),
    qt: D('Short for qtrigger().', undefined, undefined, ['qtrigger']),
    trigger: D('Restarts the pattern from its beginning at the very moment the code runs, mid-cycle if need be.', 'sound("bd sn hh cp").trigger()', undefined, ['qtrigger']),
    once: D('Plays the first cycle of the pattern once, right away, without adding it to what is playing.', 'once(sound("cp*4").speed(2))', undefined, ['qtrigger']),

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
    select: D('Switches between patterns with a number from 0 to 1: with two patterns, below 0.5 picks the first.', 'select("<0 0.5>", [sound("bd*2 sn"), sound("hh*8")])', undefined, ['squeeze', 'pickF']),
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
    delaytime: D('The time between echoes of delay(), in seconds (in cycles with lock(1)). Default 0.25.', 'sound("cp ~ ~ ~").delay(0.6).delaytime(0.125)', undefined, ['delay', 'delayfeedback', 'lock']),
    delayt: D('Short for delaytime().', undefined, undefined, ['delaytime']),
    delayfeedback: D('How much each echo of delay() repeats, 0 to 1 (kept below 0.95). Default 0.5.', 'sound("cp ~ ~ ~").delay(0.6).delayfeedback(0.8)', undefined, ['delay', 'delaytime']),
    delayfb: D('Short for delayfeedback().', undefined, undefined, ['delayfeedback']),
    dfb: D('Short for delayfeedback().', undefined, undefined, ['delayfeedback']),
    lock: D('With lock(1), delaytime is in cycles instead of seconds, so the echoes follow the tempo.', 'sound("cp ~ ~ ~").delay(0.6).delaytime(0.1875).lock(1)', undefined, ['delaytime']),
    shape: D('Waveshaping distortion as in SuperDirt, from 0 (none) to 1 (a lot). Warmer than crush.', 'sound("bd*4").shape("<0 0.5 0.9>")', undefined, ['distort', 'distortion', 'crush']),
    distort: D('Tidal\'s distortion amount, 0 to 1 (the same effect as distortion(), which goes from 1 to 100).', 'sound("arpy*4").note("c e g b").distort(0.4)', undefined, ['distortion', 'shape']),
    coarse: D('Lowers the sample rate of recorded samples: 1 is unchanged, 2 half, 8 an eighth, for a gritty, aliased sound.', 'sound("breaks125").chop(8).coarse("<1 4 8 16>")', 'Works on loaded samples; the built-in synths ignore it.', ['crush']),
    cut: D('Cut groups: a new sound stops the sound still playing in the same group (and orbit), like an open hi-hat cut by a closed one.', 'sound("oh*4 [~ ch]*4").cut(1)', undefined, ['legato']),
    accelerate: D('Changes the pitch while the sound plays: 1 rises an octave by the end, -0.5 falls by half. Works on samples and pitched synths.', 'sound("sine*4").note("c3").legato(1).accelerate("<1 -0.5>")', undefined, ['speed']),
    djf: D('A DJ filter on one knob: below 0.5 it is a low-pass that closes as it goes down, above 0.5 a high-pass that opens as it goes up; 0.5 does nothing.', 'sound("bd*4 hh*8").djf(sine.slow(8))', undefined, ['lpf', 'hpf']),
    lpq: D('The resonance of the low-pass filter: the same as resonance().', 'sound("saw*8").lpf(800).lpq(10)', undefined, ['resonance']),
    hpq: D('The resonance (Q) of the high-pass filter.', 'sound("saw*8").hpf(600).hpq(12)', undefined, ['hpf', 'resonance']),
    hresonance: D('The same as hpq().', undefined, undefined, ['hpq']),
    bpq: D('The resonance (Q) of the band-pass filter: higher values make a narrower band.', 'sound("saw*8").bpf(1200).bpq(15)', undefined, ['bpf']),
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
        'xfadeIn(1, 8, sound("hh*8").gain(0.7))',
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
        'Patterns count their steps from the mini-notation: "bd sn hh" has 3, "bd@3 sn" 4, "<a b>" 1. .steps() tells you.',
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
        'ur(8, "intro verse [verse, hats] verse:fast", {\n  intro: sound("bd ~ ~ ~"),\n  verse: sound("bd*2 sn"),\n  hats: sound("hh*8").gain(0.5)\n}, { fast: x => x.fast(2) })',
        undefined,
        ['inhabit', 'cat', 'squeeze'],
    ),
    inhabit: D('Fits named patterns into the steps of a pattern of names: each step plays a whole cycle of its pattern, squeezed.', 'inhabit({ a: sound("bd sn"), b: sound("hh*3") }, "a [b a] b")', undefined, ['squeeze', 'ur']),
    swap: D('Replaces the values of a pattern from a table; values not in it become rests.', 'sound(swap({ a: "bd", b: "sn", c: "hh" }, "a [b c] a c"))', undefined, ['fit']),
    weave: D('Spreads a control pattern across several patterns, each offset in time, so over the given cycles each pattern gets the whole of it.', 'weave(8, pan(saw2), [sound("bd sn"), sound("hh*4"), sound("arpy*3")])', undefined, ['spin', 'set']),
    snowball: D('Like soak, accumulating: each cycle combines the previous result with the function applied once more.', 'n("0 2").snowball(4, (a, b) => a.add(b), x => x.fast(2)).sound("arpy")', 'Add the sound after: add() joins strings, so snowballing a sound gives "arpyarpy". Also a global: snowball(depth, combine, fn, pattern).', ['soak']),
    chew: D('Like bite(), but each part also plays faster or slower to match how much it was squeezed or stretched.', 'sound("breaks125").chop(8).chew(4, "0 [1 3] <2 0>")', undefined, ['bite', 'splice']),
    arpg: D('The same as arp().', undefined, undefined, ['arp']),
});

/** Globals whose help differs from the method of the same name. */
export const GLOBAL_DOCS: Record<string, Doc> = {
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
    '*n': D('Plays the step n times in its slot: "hh*4" is four hats in the time of one step. n can be a fraction ("bd*1.5") or a pattern in < > or [ ]: "bd*<2 3>" is 2 one cycle and 3 the next.', 'sound("bd*2 sn [hh hh]*2 cp*<3 4>")', undefined, ['fast', 'ply']),
    '/n': D('Stretches the step over n cycles: "bd/2" plays once every two cycles, "[a b c]/3" one item per cycle.', 'sound("bd sn/2")', undefined, ['slow']),
    '!n': D('Repeats the step: "bd!3 sn" is "bd bd bd sn". A lone ! repeats the previous step once more.', 'sound("bd!3 sn")'),
    '@n': D('Makes the step n times longer than the others (elongation): in "c@3 e" the c lasts three quarters of the cycle.', 'sound("tri").note("c@3 e g@2 b")'),
    '?': D('Removes the step at random: half of the time, or with the probability that follows, e.g. ?0.3.', 'sound("hh*8?")', undefined, ['degradeBy']),
    '(k,n,r)': D('A Euclidean rhythm: k hits spread as evenly as possible over n steps, rotated by r steps. (3,8) is the tresillo. Each number can be a pattern: "bd(<3 5>,8)".', 'sound("bd(3,8) sn(2,8,4) hh(5,8)")', undefined, ['euclid']),
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
