/**
 * Parameters of every function, used by the parameter help, the hover help
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
    fast: ['Play the pattern n times per cycle', P('factor', 'how many times faster, e.g. 2')],
    slow: ['Stretch the pattern over n cycles', P('factor', 'how many times slower, e.g. 2')],
    density: ['Same as fast', P('factor', 'how many times faster')],
    sparsity: ['Same as slow', P('factor', 'how many times slower')],
    hurry: ['Faster and higher', P('factor', 'speed and pitch multiplier')],
    rev: ['Reverse each cycle'],
    late: ['Shift the pattern later', P('cycles', 'how far, e.g. 0.25 for a quarter cycle')],
    early: ['Shift the pattern earlier', P('cycles', 'how far, e.g. 0.25 for a quarter cycle')],
    palindrome: ['Forwards, then backwards'],
    compress: ['Squeeze each cycle into part of the cycle', P('begin', 'start, 0 to 1'), P('end', 'end, 0 to 1')],
    stretch: ['Zoom each cycle so its events fill it'],
    swingBy: ['Delay every other step', P('amount', 'delay as a fraction of a slice, e.g. 1/3'), P('slices', 'slices per cycle')],
    swing: ['Swing by a third', P('slices', 'slices per cycle, e.g. 4')],
    every: ['Apply a function every n cycles', P('n', 'apply on cycles 0, n, 2n...'), P('fn', FN)],
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
    degradeBy: ['Remove events at random', P('amount', 'probability of removal, 0 to 1')],
    degrade: ['Remove half of the events at random'],
    unDegradeBy: ['Keep only what degradeBy would remove', P('amount', 'probability, 0 to 1')],
    scramble: ['Play random parts, with repeats', P('n', 'parts per cycle')],
    shuffle: ['Play parts in a random order', P('n', 'parts per cycle')],
    bite: ['Play parts in a given order', P('n', 'parts per cycle'), P('indices', 'index pattern, e.g. "0 2 1 3"')],
    fitment: ['Same as bite', P('n', 'parts per cycle'), P('indices', 'index pattern')],
    chop: ['Cut each sound into parts', P('n', 'number of parts')],
    striate: ['Interleave slices of every sound', P('n', 'number of slices')],
    superimpose: ['Play the pattern and a changed copy', P('fn', FN)],
    overlay: ['Play another pattern at the same time', P('pattern', PATTERN)],
    append: ['Play another pattern in the next cycle', P('pattern', PATTERN)],
    struct: ['Take the rhythm from a structure', P('structure', 'boolean pattern like "x ~ x x"'), P('source?', 'values to use (default: this pattern)')],
    segment: ['Sample the pattern n times per cycle', P('n', 'samples per cycle')],
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
    delay: ['Echo', 'delay time in seconds, e.g. 0.25'],
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
};
for (const [name, [summary, desc]] of Object.entries(CONTROL_HELP)) {
    METHOD_SIGNATURES[name] = [summary, P('value', desc + '. A number or a pattern')];
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
