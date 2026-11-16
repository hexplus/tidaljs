// Players stopped while they wait for their quant never play: one played at
// the top of the file (waiting for beat 2, stopped at beat 1), one in a
// routine (played at beat 0.5 with quant 4, stopped at beat 1.5) and a Pdef
// (the same; played again at beat 2.5, it starts again at beat 3).
(
p = Pbind(\note, 0, \dur, 1);
x = p.play(quant: [4, 2]);
Routine({ 1.wait; x.stop }).play;
Routine({ var y; 0.5.wait; y = Pbind(\note, 7, \dur, 1).play(quant: 4); 1.wait; y.stop }).play;
Pdef(\c, Pbind(\note, Pseq([4, 5], inf), \dur, 1));
Routine({ 0.5.wait; Pdef(\c).play(quant: 4); 1.wait; Pdef(\c).stop; 1.wait; Pdef(\c).play }).play;
Pbind(\note, 12, \dur, 2).play;
)
