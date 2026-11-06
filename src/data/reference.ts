/** Content of the Reference tab. Text in `backticks` is shown as code. */

export interface ReferenceSection {
    title: string;
    /** Paragraphs before the list. */
    notes?: string[];
    /** Term and description pairs. */
    items?: [term: string, description: string][];
    /** A paragraph after the list. */
    after?: string;
}

// The Reference tab. Text in `backticks` is shown as code.
export const REFERENCE: ReferenceSection[] = [
    {
        title: 'Sounds',
        notes: [
            '`bd` kick, `sn` snare, `hh` hi-hat, `oh` open hat, `ch` closed hat, `cp` clap, `cy` cymbal, `arpy` pluck, `sine`, `saw`, `square` synths.',
            '`tri`, `noise`, `pink` are also synths. Use `"bd:2"` or `.n(2)` for variations.',
        ],
    },
    {
        title: 'Mini-notation',
        items: [
            ['"bd sn"', 'Steps share one cycle'],
            ['"bd ~ sn"', '`~` is a rest'],
            ['"hh*4" "bd/2"', 'Faster / slower step'],
            ['"bd [sn sn]"', 'Subdivide a step'],
            ['"bd <sn cp>"', 'One choice per cycle'],
            ['"[bd, hh hh]"', 'Play at the same time'],
            ['"{a b, c d e}"', 'Polymeter (`%n` sets steps)'],
            ['"bd(3,8,2)"', 'Euclidean rhythm, optional rotation'],
            ['"bd? hh?0.3"', 'Random removal'],
            ['"bd!3" "bd !"', 'Repeat a step'],
            ['"bd@3 sn" "bd _"', 'Longer step'],
            ['"[bd | sn]"', 'Random choice per cycle'],
            ['"bd . hh hh"', 'Group steps'],
            ['"c\'maj e\'min7\'i"', 'Chords in note patterns'],
        ],
    },
    {
        title: 'Patterns',
        items: [
            ['sound(p)', 'Sound pattern from a string, array or function'],
            ['.n(p)', 'Sound variation number'],
            ['.note(p)', 'Note names (c, eb3, f#5) or semitones from middle C'],
            ['.up(p)', 'Transpose in semitones'],
            ['.freq(p)', 'Frequency in Hz'],
            ['.midinote(p)', 'MIDI note number'],
        ],
    },
    {
        title: 'Time',
        items: [
            ['.fast(n)', 'Play n times per cycle'],
            ['.slow(n)', 'Stretch over n cycles'],
            ['.density(n)', 'Same as fast'],
            ['.rev()', 'Reverse each cycle'],
            ['.late(n) .early(n)', 'Shift in time by n cycles'],
            ['.every(n, f)', 'Apply f every n cycles'],
            ['.whenmod(n, m, f)', 'Apply f when cycle mod n >= m'],
            ['.sometimes(f)', 'Apply f to 50% of events'],
            ['.often(f)', '75%'],
            ['.rarely(f)', '25%'],
            ['.almostAlways(f)', '90%'],
            ['.almostNever(f)', '10%'],
            ['.sometimesBy(x, f)', 'Apply f with probability x'],
        ],
    },
    {
        title: 'Effects',
        items: [
            ['.gain(x)', 'Volume, 0 to 2 (default 1)'],
            ['.pan(x)', 'Stereo position, -1 to 1'],
            ['.lpf(hz)', 'Low-pass filter'],
            ['.hpf(hz)', 'High-pass filter'],
            ['.bpf(hz)', 'Band-pass filter'],
            ['.delay(s)', 'Echo with the given time in seconds'],
            ['.reverb(x)', 'Reverb amount, 0 to 1'],
            ['.distortion(x)', 'Distortion, 1 to 100'],
            ['.crush(bits)', 'Bit crusher, 1 to 16'],
            ['.vowel(v)', 'Formant filter: a, e, i, o, u'],
        ],
        after: 'Every control also takes a pattern, e.g. `.lpf("400 2000")`.',
    },
    {
        title: 'Composition',
        items: [
            ['stack([..])', 'Play patterns together'],
            ['layer([..])', 'Same as stack'],
            ['cat([..])', 'One pattern per cycle'],
            ['fastcat([..])', 'All patterns in one cycle'],
            ['struct(s, p)', 'Rhythm from s ("x ~ x x"), values from p'],
            ['.append(p)', 'Play p in the next cycle'],
            ['.overlay(p)', 'Play p at the same time'],
            ['.superimpose(f)', 'Play the pattern and f(pattern)'],
        ],
    },
    {
        title: 'Rearranging',
        items: [
            ['.chunk(n, f)', 'Apply f to one of n parts, in turn'],
            ['.scramble(n)', 'Random parts, with repeats'],
            ['.shuffle(n)', 'Random order of parts'],
            ['.bite(n, "0 2 1")', 'Parts in a given order (also fitment)'],
            ['.palindrome()', 'Forwards, then backwards'],
            ['.swingBy(x, n)', 'Swing; .swing(n) uses 1/3'],
            ['.compress(b, e)', 'Squeeze into part of a cycle'],
            ['.stretch()', 'Zoom to fill the cycle'],
            ['.chop(n)', 'Cut each sound into n parts'],
            ['.striate(n)', 'Interleave slices of sounds'],
            ['.hurry(n)', 'Faster and higher'],
            ['.sparsity(n)', 'Same as slow'],
        ],
    },
    {
        title: 'Randomness and conditions',
        items: [
            ['.degradeBy(x)', 'Remove events with probability x'],
            ['.degrade()', 'Remove half of the events'],
            ['randcat([..])', 'A random pattern each cycle'],
            ['.within(b, e, f)', 'Apply f to part of each cycle'],
            ['.while("1 0", f)', 'Apply f where the pattern is true'],
            ['.until(n, f)', 'Apply f until cycle n'],
            ['.playFor(a, b)', 'Only play between cycles a and b'],
            ['.stopFor(a, b)', 'Silent between cycles a and b'],
        ],
    },
    {
        title: 'Signals',
        items: [
            ['sine cosine saw isaw tri square', 'Waves from 0 to 1'],
            ['rand irand(n) perlin', 'Random values'],
            ['.range(lo, hi)', 'Scale 0..1 to lo..hi'],
            ['.quantise()', 'Round values'],
            ['.segment(n)', 'Sample n times per cycle'],
            ['.smooth()', 'Glide between values'],
            ['setBus(k, v) / bus(k)', 'Values you change while playing'],
        ],
        after: 'e.g. `.lpf(sine.range(300, 3000).slow(4))`',
    },
    {
        title: 'Harmony',
        items: [
            ['scale(name, p)', 'Degrees to notes, e.g. scale("e:minor", "0 2 4")'],
            ['chord(p)', 'Chord pattern, e.g. chord("c\'maj e\'min")'],
            ['.arp(mode)', 'up, down, updown, converge, thumbup...'],
            ['.inversion(n)', 'Raise the lowest notes an octave'],
            ['fit(step, list, p)', 'Pick from a list, shifting each cycle'],
        ],
    },
    {
        title: 'Sound shaping',
        items: [
            ['.speed(x)', 'Playback speed and pitch'],
            ['.begin(x) .end(x)', 'Play part of a sound (0 to 1)'],
            ['.legato(x)', 'Length relative to the step'],
            ['.sustain(s)', 'Length in seconds'],
            ['.attack(s) .release(s)', 'Fade in / fade out'],
            ['.loop(n)', 'Repeat the sound n times'],
            ['.cutoff .resonance', 'Low-pass filter and its Q'],
            ['.room(x) .size(x)', 'Reverb amount and room size'],
            ['.orbit(n)', 'Separate effect buses'],
            ['.nudge(s)', 'Shift timing in seconds'],
        ],
    },
    {
        title: 'Output',
        items: [
            ['.midi(out)', 'Send to a MIDI output (index or name)'],
            ['.vel .ccn .ccv .pgm .midichan', 'MIDI values'],
            ['midiOutputs()', 'List MIDI outputs'],
            ['.osc()', 'Send OSC over a WebSocket bridge'],
            ['setOscUrl(url)', 'Bridge address (ws://localhost:8080)'],
            ['record() / stopRecording()', 'Record the audio to a file'],
            ['exportPattern(p, n, f)', 'Save n cycles as "json" or "midi"'],
        ],
    },
    {
        title: 'Tempo and control',
        items: [
            ['setCPS(x)', 'Cycles per second'],
            ['setTempo(bpm)', 'Beats per minute (4 beats per cycle)'],
            ['stopAll()', 'Stop everything'],
            ['choose([..])', 'Random pick when the code runs'],
            ['cycleChoose([..])', 'Pick by current cycle'],
        ],
    },
    {
        title: 'Keys',
        items: [
            ['Ctrl+Enter', 'Evaluate and play (Cmd+Enter on Mac)'],
            ['Esc, Ctrl+.', 'Stop'],
            ['Tab', 'Indent'],
            ['Ctrl+Space', 'Show suggestions; they also appear as you type'],
            ['Up, Down, Enter', 'Pick and insert a suggestion (Esc closes)'],
            ['Inside ( )', 'Parameter help shows what each argument does'],
            ['Mouse over code', 'Explains the function, sound, note, chord or symbol under the pointer'],
            ['Tab, Shift+Tab', 'After inserting a call: next / previous parameter'],
            ['Live update', 'While playing, changes apply after a short pause'],
        ],
        after: 'Each top-level expression that results in a pattern plays. Separate patterns with a blank line or put them in `stack([...])`.',
    },
];
