// One quant rule for every .play: the next multiple of quant on the
// playback's own clock, plus the phase. At the top of the file (time 0), in
// a routine started at time 0 and in a routine inside a routine on another
// clock, the same quant gives the same onset.
(
c = TempoClock(2);
Pbind(\note, 0, \dur, 1).play(quant: [4, 1.5]);
Routine({ Pbind(\note, 2, \dur, 1).play(quant: [4, 1.5]) }).play;
Pbind(\note, 4, \dur, 1).play(c, quant: [4, 1]);
Routine({ Routine({ Pbind(\note, 5, \dur, 1).play(c, quant: [4, 1]) }).play(TempoClock(4)) }).play;
Routine({ 1.wait; Routine({ 1.wait; Pbind(\note, 7, \dur, 1).play(c, quant: [4, 1]) }).play(TempoClock(4)) }).play;
Pdef(\g, Pbind(\note, 9, \dur, 2)).play(quant: [4, 3]);
Routine({ Pdef(\h, Pbind(\note, 11, \dur, 2)).play(quant: [4, 3]) }).play;
)
