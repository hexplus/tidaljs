// A pattern on a second TempoClock (4 beats per second) beside one on the main
// clock (1.5 beats per second). A routine on the main clock stops the first
// after 4.25 of its beats, then starts the pattern again on the second clock
// on its next bar (quant 4).
(
TempoClock.default.tempo = 1.5;
c = TempoClock(4);
p = Pbind(\degree, Pseq([0, 1, 2, 3], inf), \dur, 1);
x = p.play(c);
Pbind(\degree, 7, \dur, 1, \legato, 0.5).play;
Routine({
    4.25.wait;
    x.stop;
    1.wait;
    p.play(c, quant: 4);
}).play;
)
