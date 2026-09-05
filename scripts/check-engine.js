'use strict';
const Astronomy = require('astronomy-engine');
const d = new Date('2000-01-01T00:00:00Z');
const sun = Astronomy.SunPosition(d);
if (!Number.isFinite(sun.elon)) throw new Error('Astronomy Engine did not return a solar longitude.');
console.log('Astronomy Engine OK. Sun longitude:', sun.elon.toFixed(6));
