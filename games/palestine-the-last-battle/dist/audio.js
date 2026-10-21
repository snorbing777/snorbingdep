export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ambience = null;
  }
  start() {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume();
      if (!this.ambience) {
        this.ambience = this.ctx.createGain();
        this.ambience.connect(this.ctx.destination);
        for (let f of [48, 72.2, 96.1]) {
          let o = this.ctx.createOscillator();
          o.frequency.value = f;
          o.type = "sine";
          o.connect(this.ambience);
          o.start();
        }
        this.apply();
      }
    } catch {}
  }
  apply() {
    if (this.ambience)
      this.ambience.gain.setTargetAtTime(
        this.settings.master * this.settings.ambient * 0.025,
        this.ctx.currentTime,
        0.1,
      );
  }
  tone(f, d = 0.1, v = 0.05, type = "sine", end = f / 2, pan = 0) {
    if (!this.ctx || !this.settings.master) return;
    let t = this.ctx.currentTime,
      o = this.ctx.createOscillator(),
      g = this.ctx.createGain(),
      p = this.ctx.createStereoPanner();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + d);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(
      v * this.settings.master * this.settings.sfx,
      t + 0.005,
    );
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g);
    g.connect(p);
    p.connect(this.ctx.destination);
    o.start();
    o.stop(t + d);
  }
  noise(d = 0.1, v = 0.1, cutoff = 2200, pan = 0) {
    if (!this.ctx || !this.settings.master) return;
    let b = this.ctx.createBuffer(
        1,
        Math.floor(this.ctx.sampleRate * d),
        this.ctx.sampleRate,
      ),
      data = b.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    let s = this.ctx.createBufferSource(),
      f = this.ctx.createBiquadFilter(),
      g = this.ctx.createGain(),
      p = this.ctx.createStereoPanner();
    s.buffer = b;
    f.type = "lowpass";
    f.frequency.value = cutoff;
    g.gain.value = v * this.settings.master * this.settings.sfx;
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(this.ctx.destination);
    s.start();
  }
  cue(type, pan = 0) {
    switch (type) {
      case "ar":
      case "lmg":
        this.noise(0.13, 0.22, 2300);
        this.tone(90, 0.14, 0.07, "sawtooth", 30);
        break;
      case "smg":
        this.noise(0.08, 0.16, 3200);
        this.tone(140, 0.08, 0.035, "square", 40);
        break;
      case "sg":
        this.noise(0.3, 0.35, 1400);
        this.tone(65, 0.3, 0.14, "sawtooth", 20);
        break;
      case "sniper":
      case "dmr":
        this.noise(0.23, 0.3, 2000);
        this.tone(80, 0.25, 0.12, "sawtooth", 22);
        break;
      case "pistol":
        this.noise(0.12, 0.2, 2900);
        this.tone(125, 0.13, 0.06, "square", 35);
        break;
      case "hit":
        this.tone(1100, 0.04, 0.045, "triangle", 1600);
        break;
      case "kill":
        this.tone(500, 0.12, 0.045, "triangle", 200);
        break;
      case "step":
        this.noise(0.06, 0.04, 550);
        break;
      case "boost":
        this.noise(0.35, 0.16, 1000);
        this.tone(90, 0.3, 0.035, "sawtooth", 450);
        break;
      case "jump":
        this.tone(130, 0.15, 0.025, "triangle", 320);
        break;
      case "bomb":
        this.noise(0.8, 0.4, 550);
        this.tone(75, 0.7, 0.16, "sawtooth", 20);
        break;
      case "damage":
        this.noise(0.2, 0.18, 850, pan);
        this.tone(70, 0.2, 0.08, "sine", 30, pan);
        break;
      case "reload":
        this.noise(0.09, 0.09, 4200);
        break;
      case "ready":
        this.noise(0.07, 0.06, 2500);
        this.tone(600, 0.07, 0.02, "triangle", 850);
        break;
      case "heal":
        this.tone(550, 0.25, 0.04, "sine", 1100);
        break;
      case "enemy":
        this.tone(180, 0.2, 0.02, "sawtooth", 65, pan);
        break;
      case "wave":
        for (let [i, f] of [330, 440, 660].entries())
          setTimeout(() => this.tone(f, 0.3, 0.045, "sine", f), i * 160);
        break;
      case "win":
        for (let [i, f] of [330, 440, 550, 660, 880].entries())
          setTimeout(() => this.tone(f, 0.4, 0.04, "triangle", f), i * 140);
        break;
      case "lose":
        this.tone(160, 0.9, 0.08, "sawtooth", 30);
        break;
      case "ui":
        this.tone(600, 0.055, 0.02, "sine", 800);
    }
  }
}
