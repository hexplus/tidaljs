// The same pattern played twice: the second playback starts 2.5 beats after
// the first, while it still plays, and the routine then stops the first one
// (x.stop) at beat 6.25. Each playback has its own start and end.
(
p = Pbind(\degree, Pseq([0, 2, 4, 5], inf), \dur, 1);
x = p.play;
Routine({ 2.5.wait; p.play; 3.75.wait; x.stop; }).play;
)
