// A pattern played, stopped after 3.75 beats, and played again 2.25 beats
// later: each .play is a playback of its own, so the second one starts again
// from the first note at beat 6, after a gap, and plays on for ever.
(
p = Pbind(\degree, Pseq([0, 2, 4], inf), \dur, 0.5);
Routine({
    var x;
    x = p.play;
    3.75.wait;
    x.stop;
    2.25.wait;
    p.play;
}).play;
)
