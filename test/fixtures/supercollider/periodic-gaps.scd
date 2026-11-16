// A routine that plays the same Pbind and stops it again and again, for ever:
// three notes, then a gap, every 5 beats (each playback starts again from the
// first note).
(
p = Pbind(\degree, Pseq([0, 1, 2, 3, 4], inf), \dur, 1);
Routine({
    loop {
        var x = p.play;
        2.5.wait;
        x.stop;
        2.5.wait;
    }
}).play;
)
