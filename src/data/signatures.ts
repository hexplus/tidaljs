/**
 * Parameters of every function, used by the hover help
 * and the autocomplete labels. A "?" marks an optional parameter.
 */

export interface Param {
    name: string;
    desc: string;
}

/** A summary, then the parameters in order. */
export type Signature = [summary: string, ...params: Param[]];

const P = (name: string, desc: string): Param => ({ name, desc });
const PATTERN = 'a mini-notation string like "bd sn", an array, a function or a pattern';
const FN = 'a function that changes the pattern, e.g. x => x.fast(2)';

/** Global functions, by name. */
export const GLOBAL_SIGNATURES: Record<string, Signature> = {
    sound: ['Create a sound pattern', P('pattern', PATTERN)],
    s: ['Same as sound', P('pattern', PATTERN)],
    stack: ['Play patterns at the same time', P('patterns', 'an array of patterns, or patterns as separate arguments')],
    layer: ['Same as stack', P('patterns', 'an array of patterns, or patterns as separate arguments')],
    cat: ['Play one pattern per cycle', P('patterns', 'an array of patterns, or patterns as separate arguments')],
    slowcat: ['Same as cat', P('patterns', 'an array of patterns')],
    fastcat: ['Squeeze all patterns into one cycle', P('patterns', 'an array of patterns')],
    randcat: ['Play a random pattern each cycle', P('patterns', 'an array of patterns')],
    euclidFull: ['A Euclidean rhythm: one pattern on the hits, another on the rests', P('k', 'number of hits'),
        P('n', 'number of steps'), P('pattern', 'what plays on the hits'), P('other', 'what plays on the rests'), P('rotation?', 'steps to rotate (default 0)')],
    samples: ['Load sample banks; they replace synths of the same name', P('source', '"github:tidalcycles/dirt-samples", a strudel.json URL, or { name: [files] }'),
        P('base?', 'URL to put before relative file names')],
    struct: ['Rhythm from a structure, values from a pattern',
        P('structure', 'a boolean pattern like "x ~ x x", "t f t t" or "t(3,8)"'), P('pattern', 'the sounds or values to play')],
    irand: ['Random integers from 0 to n-1', P('n', 'how many values')],
    scale: ['Turn scale degrees into notes', P('name', 'a scale name like "major", "e:minor", or a pattern "<major minor>"'),
        P('degrees', 'scale degrees like "0 2 4", 0 is the root')],
    scaleP: ['Same as scale', P('name', 'scale name or pattern'), P('degrees', 'scale degrees')],
    chord: ['A pattern of chords', P('pattern', 'chord names like "c\'maj e\'min7\'i"')],
    arp: ['Arpeggiate a chord pattern', P('mode', 'up, down, updown, converge... or a pattern of modes'), P('pattern', 'chords, e.g. "c\'maj e\'min"')],
    fit: ['Pick values from a list, shifting each cycle', P('step', 'how far the list shifts every cycle'),
        P('list', 'an array of values, e.g. ["bd", "sn"]'), P('indices', 'index pattern like "0 1 2"')],
    setBus: ['Set a value that bus() reads while playing', P('name', 'bus name'), P('value', 'new value')],
    bus: ['A signal that reads a bus value', P('name', 'bus name'), P('fallback?', 'value used before setBus is called (default 0)')],
    setCPS: ['Set the tempo in cycles per second', P('cps', 'cycles per second, e.g. 0.5')],
    setcps: ['Same as setCPS', P('cps', 'cycles per second')],
    setTempo: ['Set the tempo in beats per minute', P('bpm', 'beats per minute, 4 beats per cycle')],
    choose: ['Pick a random value when the code runs', P('options', 'an array of values')],
    wchoose: ['Pick a weighted random value when the code runs', P('pairs', 'an array of [value, weight] pairs')],
    cycleChoose: ['Pick a value by the current cycle', P('options', 'an array of values')],
    setOscUrl: ['Set the OSC WebSocket bridge', P('url', 'e.g. "ws://localhost:8080"')],
    exportPattern: ['Download cycles of a pattern', P('pattern', 'a pattern or mini-notation string'),
        P('cycles?', 'how many cycles (default 4)'), P('format?', '"json" or "midi" (default "json")')],
    scaleList: ['Names of all scales'],
    chordList: ['Names of all chords'],
    stopAll: ['Stop everything'],
    hush: ['Same as stopAll'],
    midiOutputs: ['Names of the MIDI outputs'],
    record: ['Start recording the audio'],
    stopRecording: ['Stop recording and download the file'],
};

/** Pattern methods, by name. */
export const METHOD_SIGNATURES: Record<string, Signature> = {
    fast: ['Play the pattern n times per cycle', P('factor', 'how many times faster, e.g. 2, or a pattern like "<1 2>"')],
    slow: ['Stretch the pattern over n cycles', P('factor', 'how many times slower, e.g. 2, or a pattern like "<1 2>"')],
    density: ['Same as fast', P('factor', 'how many times faster, or a pattern like "<1 2>"')],
    sparsity: ['Same as slow', P('factor', 'how many times slower, or a pattern like "<1 2>"')],
    hurry: ['Faster and higher', P('factor', 'speed and pitch multiplier, or a pattern like "<1 2>"')],
    rev: ['Reverse each cycle'],
    ply: ['Repeat each event n times within its span', P('n', 'repeats, or a pattern like "<1 2>"')],
    iter: ['Start each cycle one nth further into the pattern', P('n', 'number of starting points, or a pattern')],
    iterBack: ['Like iter, moving backwards', P('n', 'number of starting points, or a pattern')],
    linger: ['Repeat the first part of each cycle', P('fraction', 'e.g. 0.25 for the first quarter; negative takes the end')],
    rot: ['Shift values along the events of each cycle, keeping the rhythm', P('n', 'steps to shift, or a pattern')],
    late: ['Shift the pattern later', P('cycles', 'how far, e.g. 0.25 for a quarter cycle, or a pattern like "<1 2>"')],
    early: ['Shift the pattern earlier', P('cycles', 'how far, e.g. 0.25 for a quarter cycle, or a pattern like "<1 2>"')],
    palindrome: ['Forwards, then backwards'],
    compress: ['Squeeze each cycle into part of the cycle', P('begin', 'start, 0 to 1'), P('end', 'end, 0 to 1')],
    stretch: ['Zoom each cycle so its events fill it'],
    swingBy: ['Delay every other step', P('amount', 'delay as a fraction of a slice, e.g. 1/3'), P('slices', 'slices per cycle')],
    swing: ['Swing by a third', P('slices', 'slices per cycle, e.g. 4, or a pattern like "<1 2>"')],
    every: ['Apply a function every n cycles', P('n', 'apply on cycles 0, n, 2n..., or a pattern like "<1 2>"'), P('fn', FN)],
    whenmod: ['Apply a function when cycle mod n >= offset', P('n', 'cycle period'), P('offset', 'first cycle in the period to apply it'), P('fn', FN)],
    within: ['Apply a function to part of each cycle', P('begin', 'start, 0 to 1 (or an array [begin, end])'), P('end', 'end, 0 to 1'), P('fn', FN)],
    chunk: ['Apply a function to one of n parts, in turn', P('n', 'number of parts'), P('fn', FN)],
    while: ['Apply a function where a boolean pattern is true', P('booleans', 'e.g. "1 0" or "t f t t"'), P('fn', FN)],
    until: ['Apply a function until a cycle', P('cycle', 'the cycle where it stops'), P('fn', FN)],
    playFor: ['Only play between two cycles', P('begin', 'first cycle'), P('end', 'cycle where it stops')],
    stopFor: ['Be silent between two cycles', P('begin', 'first silent cycle'), P('end', 'cycle where it plays again')],
    sometimesBy: ['Apply a function to some events', P('probability', '0 to 1'), P('fn', FN)],
    sometimes: ['Apply a function to 50% of events', P('fn', FN), P('probability?', 'default 0.5')],
    often: ['Apply a function to 75% of events', P('fn', FN)],
    rarely: ['Apply a function to 25% of events', P('fn', FN)],
    almostNever: ['Apply a function to 10% of events', P('fn', FN)],
    almostAlways: ['Apply a function to 90% of events', P('fn', FN)],
    degradeBy: ['Remove events at random', P('amount', 'probability of removal, 0 to 1, or a pattern like "<1 2>"')],
    degrade: ['Remove half of the events at random'],
    unDegradeBy: ['Keep only what degradeBy would remove', P('amount', 'probability, 0 to 1')],
    scramble: ['Play random parts, with repeats', P('n', 'parts per cycle')],
    shuffle: ['Play parts in a random order', P('n', 'parts per cycle')],
    bite: ['Play parts in a given order', P('n', 'parts per cycle'), P('indices', 'index pattern, e.g. "0 2 1 3"')],
    fitment: ['Same as bite', P('n', 'parts per cycle'), P('indices', 'index pattern')],
    chop: ['Cut each sound into parts', P('n', 'number of parts, or a pattern like "<1 2>"')],
    striate: ['Interleave slices of every sound', P('n', 'number of slices, or a pattern like "<1 2>"')],
    superimpose: ['Play the pattern and a changed copy', P('fn', FN)],
    off: ['Play a shifted, changed copy on top', P('time', 'how much later, in cycles (e.g. 0.125), or a pattern'), P('fn', FN)],
    jux: ['The pattern on the left, a changed copy on the right', P('fn', FN)],
    juxBy: ['Like jux, panned only part of the way', P('amount', '0 (centre) to 1 (fully left and right)'), P('fn', FN)],
    euclid: ['Play on k of n evenly spread steps', P('k', 'number of hits'), P('n', 'number of steps'), P('rotation?', 'steps to rotate (default 0)')],
    euclidInv: ['Play on the steps a Euclidean rhythm leaves empty', P('k', 'number of hits'), P('n', 'number of steps'), P('rotation?', 'steps to rotate (default 0)')],
    euclidFull: ['This pattern on the hits, another on the rests', P('k', 'number of hits'), P('n', 'number of steps'),
        P('other', 'what plays on the rests'), P('rotation?', 'steps to rotate (default 0)')],
    nTake: ['Give each played event the next value of a list as n', P('name', 'a name, so the count continues across changes'), P('list', 'numbers, e.g. [0, 2, 4]')],
    overlay: ['Play another pattern at the same time', P('pattern', PATTERN)],
    append: ['Play another pattern in the next cycle', P('pattern', PATTERN)],
    struct: ['Take the rhythm from a structure', P('structure', 'boolean pattern like "x ~ x x"'), P('source?', 'values to use (default: this pattern)')],
    segment: ['Sample the pattern n times per cycle', P('n', 'samples per cycle, or a pattern like "<1 2>"')],
    range: ['Scale values from 0..1 to lo..hi', P('lo', 'value for 0'), P('hi', 'value for 1')],
    quantise: ['Round values to whole numbers'],
    quantize: ['Same as quantise'],
    smooth: ['Glide between values'],
    arp: ['Play the notes of each chord in turn', P('mode?', 'up, down, updown, downup, converge, diverge, pinkyup, thumbup... (default up)')],
    arpeggiate: ['Same as arp', P('mode?', 'arpeggio mode (default up)')],
    inversion: ['Raise the lowest notes of each chord an octave', P('n?', 'how many notes (default 1)')],
    midi: ['Send events to a MIDI output', P('output?', 'index or name of the output (default 0)')],
    osc: ['Send events as OSC messages', P('address?', 'OSC address (default "/dirt/play")')],
    setCPS: ['Set the tempo in cycles per second', P('cps', 'cycles per second')],
    setTempo: ['Set the tempo in beats per minute', P('bpm', 'beats per minute')],
    play: ['Start playing this pattern'],
    stop: ['Stop this pattern'],
    query: ['Events between two times', P('begin', 'start cycle'), P('end', 'end cycle')],
    firstCycle: ['Events of the first cycle'],
    sound: ['Set the sound', P('pattern', 'sound names, e.g. "bd sn"')],
    s: ['Same as sound', P('pattern', 'sound names')],

    // Combining (Tidal's #, |+, |-, |*, |/, |%)
    set: ['Add or replace controls, keeping this rhythm (Tidal\'s #)', P('controls', 'a control pattern, e.g. speed("1 2"), or { gain: 0.8 }')],
    add: ['Add to numbers, keeping this rhythm (Tidal\'s |+)', P('value', 'a number, "0 12" or a control pattern like note("<0 7>")')],
    sub: ['Subtract from numbers (Tidal\'s |-)', P('value', 'a number, a pattern or a control pattern')],
    mul: ['Multiply numbers (Tidal\'s |*)', P('value', 'a number, a pattern or a control pattern')],
    div: ['Divide numbers (Tidal\'s |/)', P('value', 'a number, a pattern or a control pattern')],
    mod: ['Remainder of numbers (Tidal\'s |%)', P('value', 'a number, a pattern or a control pattern')],
    pow: ['Raise numbers to a power', P('value', 'a number, a pattern or a control pattern')],

    // Structure
    brak: ['Squash every other cycle and shift it a quarter: a breakbeat feel'],
    mask: ['Keep only the events where a boolean pattern is true', P('booleans', 'e.g. "1 0 1 1" or "t f"')],
    inv: ['Invert a boolean pattern'],
    sew: ['This pattern where true, another where false', P('booleans', 'e.g. "t f"'), P('other', PATTERN)],
    stitch: ['Rhythm of a boolean pattern, values from this or another', P('booleans', 'e.g. "t f t t"'), P('other', PATTERN)],
    wedge: ['This pattern in the first part of the cycle, another in the rest', P('time', 'fraction of the cycle, e.g. 0.25'), P('other', PATTERN)],
    euclidOff: ['Euclidean rhythm with a rotation', P('k', 'number of hits'), P('n', 'number of steps'), P('rotation', 'steps to rotate')],
    eoff: ['Same as euclidOff', P('k', 'number of hits'), P('n', 'number of steps'), P('rotation', 'steps to rotate')],
    euclidOffFull: ['euclidOff on the hits, another pattern on the rests', P('k', 'number of hits'), P('n', 'number of steps'),
        P('rotation', 'steps to rotate'), P('other', 'what plays on the rests')],
    zoom: ['Play part of each cycle, stretched to fill it', P('begin', '0 to 1'), P('end', '0 to 1')],
    zoomArc: ['Same as zoom', P('begin', '0 to 1'), P('end', '0 to 1')],
    fastGap: ['Squash each cycle into its first 1/n, then silence', P('n', 'how many times faster, or a pattern')],
    densityGap: ['Same as fastGap', P('n', 'how many times faster')],
    trunc: ['Play only the first part of each cycle', P('fraction', '0 to 1, or a pattern')],
    repeatCycles: ['Repeat each cycle n times', P('n', 'repeats, or a pattern')],
    loopFirst: ['Loop the first cycle'],
    discretise: ['Same as segment', P('n', 'samples per cycle')],
    press: ['Move every event to the second half of its step'],
    pressBy: ['Move every event later by part of its step', P('ratio', '0 to 1, or a pattern')],
    plyWith: ['Repeat each event, applying a function once more each time', P('n', 'repeats, or a pattern'), P('fn', FN)],
    rolled: ['Strum chords: their notes start one after another'],
    rolledBy: ['Strum chords by an amount of the event', P('amount', 'e.g. 0.25; negative strums downwards')],

    // Conditions
    when: ['Apply a function on the cycles a test accepts', P('test', 'a function of the cycle number, e.g. c => c % 4 === 3'), P('fn', FN)],
    ifp: ['One function on the cycles a test accepts, another on the rest', P('test', 'a function of the cycle number'),
        P('fnTrue', FN), P('fnFalse', FN)],
    foldEvery: ['Apply a function every n cycles, for several n', P('ns', 'a list, e.g. [3, 5]'), P('fn', FN)],
    someCyclesBy: ['Apply a function to whole cycles at random', P('probability', '0 to 1, or a pattern'), P('fn', FN)],
    someCycles: ['Apply a function to half of the cycles, at random', P('fn', FN)],
    somecyclesBy: ['Same as someCyclesBy', P('probability', '0 to 1'), P('fn', FN)],
    somecycles: ['Same as someCycles', P('fn', FN)],
    always: ['Always apply a function', P('fn', FN)],
    never: ['Never apply a function', P('fn', FN)],
    inside: ['Apply a function inside a fraction of the cycle', P('n', 'e.g. 2 for each half cycle'), P('fn', FN)],
    outside: ['Apply a function over several cycles', P('n', 'e.g. 2 for each pair of cycles'), P('fn', FN)],
    chunkBack: ['Like chunk, moving backwards', P('n', 'number of parts, or a pattern'), P('fn', FN)],
    fix: ['Apply a function to events with given controls', P('fn', FN), P('controls', 'e.g. { s: "bd" } or { n: [1, 2] }')],
    unfix: ['Apply a function to events without given controls', P('fn', FN), P('controls', 'e.g. { s: "bd" }')],
    contrast: ['One function for events with given controls, another for the rest', P('fnMatch', FN), P('fnOther', FN),
        P('controls', 'e.g. { s: "bd" }')],
    spread: ['Apply a function with each value of a list, one per cycle', P('fn', 'a function of the pattern and a value, e.g. (p, x) => p.fast(x)'),
        P('values', 'a list, e.g. [1, 2, 4]')],
    slowspread: ['Same as spread', P('fn', '(p, x) => ...'), P('values', 'a list')],
    fastspread: ['Like spread, all values in one cycle', P('fn', '(p, x) => ...'), P('values', 'a list')],
    spreadChoose: ['Like spread, a random value each cycle', P('fn', '(p, x) => ...'), P('values', 'a list')],
    spreadr: ['Same as spreadChoose', P('fn', '(p, x) => ...'), P('values', 'a list')],
    pickF: ['Apply the function an index pattern picks', P('indices', 'e.g. "<0 1 2>"'), P('fns', 'a list of functions')],
    selectF: ['Apply the function a number from 0 to 1 picks', P('amount', 'e.g. "<0 0.5>" or a signal'), P('fns', 'a list of functions')],
    soak: ['Apply a function once more each cycle', P('depth', 'number of cycles'), P('fn', FN)],

    // Randomness
    fadeOut: ['Fade out over n cycles by dropping events', P('cycles', 'how many cycles')],
    fadeIn: ['Fade in over n cycles by adding events', P('cycles', 'how many cycles')],
    fadeOutFrom: ['Fade out from a cycle on', P('from', 'cycle to start at'), P('cycles', 'how many cycles')],
    fadeInFrom: ['Fade in from a cycle on', P('from', 'cycle to start at'), P('cycles', 'how many cycles')],
    stripe: ['n random-length segments per cycle, each a whole cycle', P('n', 'segments per cycle, or a pattern')],
    slowstripe: ['Like stripe, spread over n cycles', P('n', 'number of cycles')],

    // Echoes
    echo: ['Echoes that get quieter', P('count', 'number of sounds'), P('time', 'cycles between them, e.g. 0.2'), P('feedback', 'gain of each echo relative to the last, e.g. 0.5')],
    echoWith: ['Echoes changed by a function', P('count', 'number of sounds'), P('time', 'cycles between them'), P('fn', FN)],
    stutWith: ['Same as echoWith', P('count', 'number of sounds'), P('time', 'cycles between them'), P('fn', FN)],
    stut: ['Tidal\'s classic echo', P('count', 'number of sounds'), P('feedback', 'how quiet the last one gets, 0 to 1'), P('time', 'cycles between them')],
    stutter: ['Repeat each sound quickly', P('count', 'number of sounds'), P('time', 'cycles between them, e.g. 1/16')],
    ghost: ['Add ghost notes after each event'],
    ghostWith: ['Add ghost notes changed by a function', P('time', 'cycles, e.g. 1/8'), P('fn', FN)],

    // Values
    rangex: ['Scale values from 0..1 to lo..hi exponentially', P('lo', 'value for 0, above 0'), P('hi', 'value for 1')],
    qfloor: ['Round values down'],
    qceiling: ['Round values up'],
    qround: ['Round values to the nearest whole number'],
    toScale: ['Turn numbers into notes of a scale', P('steps', 'semitones of the scale, e.g. [0, 2, 4, 5, 7, 9, 11]')],

    // Samples
    slice: ['Play slices of each sample in an index pattern\'s rhythm', P('n', 'number of slices'), P('indices', 'e.g. "0 2 <1 3>"')],
    splice: ['Like slice, each slice fitted to its step', P('n', 'number of slices'), P('indices', 'e.g. "0 2 <1 3>"')],
    randslice: ['Play a random slice of each sample', P('n', 'number of slices')],
    loopAt: ['Fit each sample to n cycles', P('n', 'cycles, or a pattern')],
    smash: ['striate, then play at several speeds', P('n', 'number of slices'), P('speeds', 'a list, e.g. [2, 3, 4]')],
    spin: ['n copies, shifted and panned', P('n', 'number of copies, or a pattern')],
    striateBy: ['striate with slices of a given length', P('n', 'number of slices'), P('length', 'slice length, 0 to 1')],

    // Triggers
    qtrigger: ['Restart the pattern at the next cycle when the code runs'],
    qt: ['Same as qtrigger'],
    trigger: ['Restart the pattern when the code runs'],
    once: ['Play the first cycle once, right away'],
};

// Controls take one value: a number, a mini-notation string or a pattern.
const CONTROL_HELP: Record<string, [summary: string, value: string]> = {
    n: ['Sound variation', 'variation number, e.g. "0 1 2"'],
    note: ['Musical notes', 'note names like "c e g", "eb3", chords "c\'maj", or semitones from middle C'],
    up: ['Transpose', 'semitones, e.g. 12 for an octave'],
    freq: ['Frequency', 'Hz, e.g. 440'],
    midinote: ['MIDI note', 'MIDI number, 60 is middle C'],
    gain: ['Volume', '0 to 2, default 1'],
    pan: ['Stereo position', '-1 (left) to 1 (right)'],
    lpf: ['Low-pass filter', 'cutoff in Hz, e.g. 800'],
    cutoff: ['Same as lpf', 'cutoff in Hz'],
    hpf: ['High-pass filter', 'cutoff in Hz, e.g. 200'],
    hcutoff: ['Same as hpf', 'cutoff in Hz'],
    bpf: ['Band-pass filter', 'center in Hz, e.g. 1000'],
    bandf: ['Same as bpf', 'center in Hz'],
    resonance: ['Low-pass filter resonance', 'Q, e.g. 5'],
    delay: ['Echo level', '0 to 1, e.g. 0.5'],
    reverb: ['Reverb', 'amount, 0 to 1'],
    room: ['Same as reverb', 'amount, 0 to 1'],
    size: ['Reverb room size', '0 to 1'],
    orbit: ['Effect bus', 'orbit number, e.g. 1'],
    distortion: ['Distortion', '1 to 100'],
    crush: ['Bit crusher', 'bits, 1 to 16 (lower is harsher)'],
    vowel: ['Formant filter', '"a", "e", "i", "o" or "u"'],
    speed: ['Playback speed and pitch', 'multiplier, e.g. 2 for an octave up'],
    begin: ['Start part way into the sound', '0 to 1'],
    end: ['Stop part way through the sound', '0 to 1'],
    loop: ['Repeat the sound', 'number of times'],
    legato: ['Length relative to the step', 'e.g. 1 for the full step'],
    sustain: ['Length in seconds', 'seconds'],
    attack: ['Fade-in time', 'seconds'],
    release: ['Fade-out time', 'seconds'],
    nudge: ['Shift timing', 'seconds, can be negative'],
    vel: ['MIDI velocity', '0 to 1, or 0 to 127'],
    velocity: ['Same as vel', '0 to 1, or 0 to 127'],
    ccn: ['MIDI control change number', '0 to 127'],
    ccv: ['MIDI control change value', '0 to 127'],
    pgm: ['MIDI program change', '0 to 127'],
    midichan: ['MIDI channel', '0 to 15'],
    delaytime: ['Time between echoes', 'seconds, e.g. 0.25 (cycles with lock(1))'],
    delayt: ['Same as delaytime', 'seconds'],
    delayfeedback: ['How much each echo repeats', '0 to 1, default 0.5'],
    delayfb: ['Same as delayfeedback', '0 to 1'],
    dfb: ['Same as delayfeedback', '0 to 1'],
    lock: ['Delay time in cycles', '1 for cycles, 0 for seconds'],
    shape: ['Waveshaping distortion', '0 to 1'],
    distort: ['Distortion, as in Tidal', '0 to 1'],
    coarse: ['Lower the sample rate of samples', '1 for none, 2 for half, 8 for an eighth'],
    cut: ['Cut group: a new sound stops the last one', 'group number, e.g. 1'],
    accelerate: ['Change the pitch while the sound plays', 'e.g. 1 to rise an octave, -0.5 to fall'],
    djf: ['DJ filter', '0 to 1: below 0.5 low-pass, above high-pass'],
    lpq: ['Same as resonance', 'Q, e.g. 5'],
    hpq: ['High-pass filter resonance', 'Q, e.g. 5'],
    hresonance: ['Same as hpq', 'Q'],
    bpq: ['Band-pass filter resonance', 'Q, e.g. 5'],
    bandq: ['Same as bpq', 'Q'],
    amp: ['Volume, as in SuperDirt', '0.4 is normal'],
    octave: ['Octave of synth notes', '5 is normal, 6 an octave up'],
    unit: ['Unit of speed', '"c" for cycles, "r" for rate'],
    tremolorate: ['Tremolo speed', 'Hz, e.g. 4'],
    tremr: ['Same as tremolorate', 'Hz'],
    tremolodepth: ['Tremolo depth', '0 to 1'],
    tremdp: ['Same as tremolodepth', '0 to 1'],
    phaserrate: ['Phaser speed', 'Hz, e.g. 0.5'],
    phasr: ['Same as phaserrate', 'Hz'],
    phaserdepth: ['Phaser depth', '0 to 1'],
    phasdp: ['Same as phaserdepth', '0 to 1'],
    ring: ['Ring modulation amount', '0 to 1'],
    ringf: ['Ring modulation frequency', 'Hz, e.g. 200'],
    ctf: ['Same as lpf', 'cutoff in Hz'],
    sz: ['Same as size', '0 to 1'],
    sus: ['Same as sustain', 'seconds'],
    att: ['Same as attack', 'seconds'],
    rel: ['Same as release', 'seconds'],
};
for (const [name, [summary, desc]] of Object.entries(CONTROL_HELP)) {
    METHOD_SIGNATURES[name] = [summary, P('value', desc + '. A number or a pattern')];
}

/** Names of the controls: each is a method and also a global, e.g. n("0 2"). */
export const CONTROL_NAMES = Object.keys(CONTROL_HELP);

// Global functions from the rest of Tidal's library.
Object.assign(GLOBAL_SIGNATURES, {
    run: ['The numbers 0 to n-1 in one cycle', P('n', 'how many, or a pattern like "<4 8>"')],
    scan: ['run(1), run(2) ... run(n), one per cycle', P('n', 'the largest')],
    toScale: ['Numbers to notes of a scale', P('steps', 'semitones, e.g. [0, 2, 4, 5, 7, 9, 11]'), P('pattern', 'numbers, e.g. "0 1 2 3"')],
    markovPat: ['A Markov chain of states', P('n', 'steps per cycle'), P('start', 'first state'), P('matrix', 'transition probabilities, e.g. [[0.2, 0.8], [0.5, 0.5]]')],
    lindenmayer: ['Grow a string with L-system rules', P('n', 'generations'), P('rules', 'e.g. "a:b,b:ab"'), P('axiom', 'starting string, e.g. "a"')],
    fromList: ['One value per cycle from a list', P('list', 'e.g. ["bd", "sn"]')],
    fastFromList: ['All values of a list in one cycle', P('list', 'e.g. ["bd", "sn"]')],
    listToPat: ['Same as fastFromList', P('list', 'a list')],
    fromMaybes: ['Values of a list in one cycle, null for rests', P('list', 'e.g. ["bd", null, "sn"]')],
    timeCat: ['Patterns in one cycle, each with a relative length', P('steps', 'pairs, e.g. [[1, sound("bd*4")], [2, sound("hh*8")]]')],
    timecat: ['Same as timeCat', P('steps', 'pairs of [length, pattern]')],
    wrandcat: ['A random pattern each cycle, with weights', P('items', 'pairs, e.g. [[sound("bd*2"), 3], [sound("cp"), 1]]')],
    binary: ['The bits of a number as booleans', P('n', 'a number from 0 to 255')],
    binaryN: ['The bits of a number as booleans', P('bits', 'how many bits'), P('n', 'the number')],
    ascii: ['The bits of text as booleans', P('text', 'e.g. "hi"')],
    necklace: ['A rhythm from gaps between hits', P('steps', 'steps per cycle, e.g. 12'), P('gaps', 'e.g. [4, 2]')],
    chooseBy: ['Pick from a list with a signal', P('signal', 'values 0 to 1, e.g. rand or sine'), P('list', 'e.g. ["bd", "sn"]')],
    wchooseBy: ['Pick from a list with a signal, with weights', P('signal', 'values 0 to 1'), P('pairs', 'e.g. [["bd", 3], ["sn", 1]]')],
    select: ['Switch between patterns with a number from 0 to 1', P('amount', 'e.g. "<0 0.5>" or a signal'), P('patterns', 'a list of patterns')],
    squeeze: ['Fit the pattern an index picks into each step', P('indices', 'e.g. "0 [1 0]"'), P('patterns', 'a list of patterns')],
    pickF: ['Apply the function an index pattern picks', P('indices', 'e.g. "<0 1>"'), P('fns', 'a list of functions'), P('pattern', PATTERN)],
    selectF: ['Apply the function a number from 0 to 1 picks', P('amount', 'e.g. "<0 0.5>"'), P('fns', 'a list of functions'), P('pattern', PATTERN)],
    sew: ['One pattern where true, another where false', P('booleans', 'e.g. "t f"'), P('a', PATTERN), P('b', PATTERN)],
    stitch: ['Rhythm of booleans, values from two patterns', P('booleans', 'e.g. "t f t t"'), P('a', 'values for true'), P('b', 'values for false')],
    wedge: ['One pattern in the first part of the cycle, another in the rest', P('time', 'e.g. 0.25'), P('a', PATTERN), P('b', PATTERN)],
    spread: ['Apply a function with each value of a list, one per cycle', P('fn', '(p, x) => ...'), P('values', 'a list'), P('pattern', PATTERN)],
    fastspread: ['Like spread, all values in one cycle', P('fn', '(p, x) => ...'), P('values', 'a list'), P('pattern', PATTERN)],
    brandBy: ['Random true or false with a probability', P('probability', '0 to 1')],
    once: ['Play the first cycle once, right away', P('pattern', PATTERN)],
});
for (let i = 1; i <= 16; i++) {
    GLOBAL_SIGNATURES['d' + i] = ['Play a pattern in stream d' + i + ', as Tidal\'s d' + i + ' $ ...', P('pattern', PATTERN)];
}

const ID = P('stream', 'a number (1 is d1) or a name');
const CYCLES = (what: string) => P('cycles', what);
Object.assign(GLOBAL_SIGNATURES, {
    // Streams and transitions
    p: ['Play a pattern in a named stream, as Tidal\'s p "name" $ ...', P('name', 'a name or number'), P('pattern', PATTERN)],
    xfade: ['Crossfade the stream to a new pattern over 4 cycles', ID, P('pattern', PATTERN)],
    xfadeIn: ['Crossfade the stream to a new pattern', ID, CYCLES('length of the crossfade'), P('pattern', PATTERN)],
    jump: ['Switch the stream to a new pattern now', ID, P('pattern', PATTERN)],
    jumpIn: ['Switch the stream after some cycles', ID, CYCLES('cycles to wait'), P('pattern', PATTERN)],
    jumpMod: ['Switch the stream at the next cycle divisible by n', ID, P('n', 'e.g. 4 to switch at the start of a 4-cycle phrase'), P('pattern', PATTERN)],
    clutch: ['Swap events of the old pattern for the new one over 2 cycles', ID, P('pattern', PATTERN)],
    clutchIn: ['Swap events of the old pattern for the new one at random', ID, CYCLES('length of the change'), P('pattern', PATTERN)],
    anticipate: ['Echo the old pattern faster and faster for 8 cycles, then switch', ID, P('pattern', PATTERN)],
    anticipateIn: ['Echo the old pattern faster and faster, then switch', ID, CYCLES('length of the build-up'), P('pattern', PATTERN)],
    interpolate: ['Glide numeric controls to the new pattern over 4 cycles', ID, P('pattern', PATTERN)],
    interpolateIn: ['Glide numeric controls to the new pattern', ID, CYCLES('length of the glide'), P('pattern', PATTERN)],
    wait: ['Silence, then the new pattern', ID, CYCLES('cycles of silence'), P('pattern', PATTERN)],
    mortal: ['Play the new pattern for a while, then fade it out', ID, P('life', 'cycles it plays'), P('release', 'cycles it fades over'), P('pattern', PATTERN)],
    mute: ['Mute a stream', ID],
    unmute: ['Unmute a stream', ID],
    solo: ['Solo a stream: only soloed streams play', ID],
    unsolo: ['Stop soloing a stream', ID],
    unmuteAll: ['Unmute every stream'],
    unsoloAll: ['Stop soloing every stream'],

    // Stepwise
    stepcat: ['Patterns in one cycle, each given time by its steps', P('patterns', 'patterns, e.g. sound("bd sn"), sound("hh hh hh")')],
    s_cat: ['Same as stepcat', P('patterns', 'patterns')],
    stepalt: ['Alternate between lists of patterns, stepwise', P('groups', 'lists of patterns, e.g. [[sound("bd sn")], [sound("hh*3"), sound("cp")]]')],
    stepzip: ['Interleave the steps of several patterns', P('patterns', 'a list of patterns')],

    // More of Tidal
    ur: ['A pattern of named patterns, over many cycles', P('cycles', 'how long the structure lasts'), P('structure', 'names, e.g. "intro [verse, drums:fast]"'),
        P('patterns', '{ name: pattern }'), P('fx?', '{ name: function } for "name:fx"')],
    inhabit: ['Named patterns squeezed into the steps of a pattern of names', P('patterns', '{ a: sound("bd sn"), b: ... }'), P('names', 'e.g. "a [b a]"')],
    swap: ['Replace values from a table', P('table', '{ a: "bd", b: "sn" }'), P('pattern', 'e.g. "a b a"')],
    weave: ['Spread a control pattern across patterns, offset in time', P('cycles', 'how long one pass takes'), P('controls', 'a control pattern, e.g. pan(saw)'), P('patterns', 'a list of patterns')],
    snowball: ['Accumulate a function, cycle by cycle', P('depth', 'cycles'), P('combine', '(a, b) => a.add(b)'), P('fn', FN), P('pattern', PATTERN)],
});

Object.assign(METHOD_SIGNATURES, {
    steptake: ['Keep the first n steps (the last n if negative)', P('n', 'steps, or a pattern')],
    stepdrop: ['Drop steps from the end (the start if negative)', P('n', 'steps, or a pattern')],
    expand: ['Multiply the steps, so stepcat gives more room', P('factor', 'e.g. 2')],
    contract: ['Divide the steps', P('factor', 'e.g. 2')],
    extend: ['Repeat the pattern and multiply its steps', P('factor', 'e.g. 2')],
    pace: ['Play a given number of steps per cycle', P('steps', 'steps per cycle')],
    steps: ['The number of steps of the pattern'],
    snowball: ['Accumulate a function, cycle by cycle', P('depth', 'cycles'), P('combine', '(a, b) => a.add(b)'), P('fn', FN)],
    chew: ['Like bite, changing the speed of each part to fit', P('n', 'parts per cycle'), P('indices', 'index pattern, e.g. "0 [2 3]"')],
    arpg: ['Same as arp', P('mode?', 'arpeggio mode (default up)')],
});
for (const name of CONTROL_NAMES) {
    if (!GLOBAL_SIGNATURES[name]) GLOBAL_SIGNATURES[name] = METHOD_SIGNATURES[name];
}

/** The parameters of a signature, without its summary. */
export function paramsOf(sig: Signature): Param[] {
    const [, ...params] = sig;
    return params;
}

/** "fast(factor)" style label for a signature. */
export function signatureLabel(name: string, sig?: Signature): string {
    if (!sig) return name + '()';
    return name + '(' + paramsOf(sig).map((p) => p.name).join(', ') + ')';
}
