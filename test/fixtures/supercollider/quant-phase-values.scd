// A finite pattern played with quant [2, 0.5] at the top of the file: it starts
// half a beat into its loop and ends at beat 2.5, halfway through one. Each
// value plays at its own note's onset: MIDI 60 at beat 0.5, MIDI 61 at 1.5.
Pbind(\midinote, Pseq([60, 61], 1), \dur, 1).play(quant: [2, 0.5]);
