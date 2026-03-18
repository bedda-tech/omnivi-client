export class SfxManager {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private thrustOsc: OscillatorNode | null = null;
  private thrustGain: GainNode | null = null;
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  // Dynamic music layers
  private padOsc1: OscillatorNode | null = null;
  private padOsc2: OscillatorNode | null = null;
  private padOsc3: OscillatorNode | null = null;
  private padGain: GainNode | null = null;
  private nextBeatTime: number = 0;
  private beatCount: number = 0;
  private musicRunning: boolean = false;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.25;
    this.masterGain.connect(this.ctx.destination);
  }

  private tone(
    freq: number, type: OscillatorType, duration: number,
    volume: number, freqEnd?: number, startDelaySec: number = 0,
  ) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startDelaySec);
    if (freqEnd !== undefined) {
      osc.frequency.linearRampToValueAtTime(freqEnd, this.ctx.currentTime + startDelaySec + duration);
    }
    gain.gain.setValueAtTime(volume, this.ctx.currentTime + startDelaySec);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startDelaySec + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(this.ctx.currentTime + startDelaySec);
    osc.stop(this.ctx.currentTime + startDelaySec + duration);
  }

  /** Schedule a one-shot oscillator at an ABSOLUTE AudioContext time. */
  private toneAt(
    absTime: number, freq: number, type: OscillatorType,
    duration: number, volume: number, freqEnd?: number,
  ) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, absTime);
    if (freqEnd !== undefined) {
      osc.frequency.linearRampToValueAtTime(freqEnd, absTime + duration);
    }
    gain.gain.setValueAtTime(volume, absTime);
    gain.gain.exponentialRampToValueAtTime(0.001, absTime + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(absTime);
    osc.stop(absTime + duration + 0.01);
  }

  // ── Thrust ─────────────────────────────────────────────────────────────

  startThrust() {
    if (this.thrustOsc) return;
    void this.ctx.resume();
    this.thrustOsc = this.ctx.createOscillator();
    this.thrustGain = this.ctx.createGain();
    this.thrustOsc.type = 'sawtooth';
    this.thrustOsc.frequency.value = 52;
    this.thrustGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
    this.thrustGain.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 0.08);
    this.thrustOsc.connect(this.thrustGain);
    this.thrustGain.connect(this.masterGain);
    this.thrustOsc.start();
  }

  stopThrust() {
    if (!this.thrustOsc || !this.thrustGain) return;
    const t = this.ctx.currentTime;
    this.thrustGain.gain.setValueAtTime(this.thrustGain.gain.value, t);
    this.thrustGain.gain.linearRampToValueAtTime(0.001, t + 0.12);
    this.thrustOsc.stop(t + 0.14);
    this.thrustOsc = null;
    this.thrustGain = null;
  }

  /** Vary thrust engine pitch with player speed — call each frame while thrusting. */
  updateThrustPitch(speed: number) {
    if (!this.thrustOsc) return;
    // speed 0→200: freq 45→80hz (deeper rumble at slow, rising engine whine at full thrust)
    const freq = 45 + Math.min(speed / 200, 1) * 35;
    this.thrustOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.18);
  }

  // ── Absorption ─────────────────────────────────────────────────────────

  /**
   * gainedMass: mass actually absorbed (scales pitch and duration)
   * Pitch is log-scaled — eating a tiny dust = high soft pop, eating a planet = deep heavy thump
   */
  absorb(gainedMass: number) {
    void this.ctx.resume();
    const m = Math.max(1, gainedMass);
    // Log-scale: 1→400hz, 10→310hz, 100→200hz, 500→120hz, 2000→70hz
    const baseFreq = Math.max(65, 440 - Math.log10(m) * 130);
    const dur      = 0.06 + Math.min(0.45, m / 180);
    const vol      = 0.12 + Math.min(0.30, m / 350);
    if (m > 60) {
      // Asteroid/large mass: double-layer thump
      this.tone(baseFreq,        'sine',     dur,       vol,      baseFreq * 0.5);
      this.tone(baseFreq * 1.5,  'triangle', dur * 0.5, vol * 0.4, baseFreq * 0.8);
    } else {
      // Dust/small mass: bright airy pop
      this.tone(baseFreq, 'sine', dur, vol, baseFreq * 0.55);
    }
  }

  // ── One-shot SFX ───────────────────────────────────────────────────────

  bigShrink() {
    void this.ctx.resume();
    this.tone(40,  'sawtooth', 2.5, 0.07);
    this.tone(55,  'sawtooth', 2.5, 0.06);
    this.tone(70,  'sawtooth', 2.0, 0.05);
  }

  escaped() {
    void this.ctx.resume();
    const notes = [261, 329, 392, 523];
    notes.forEach((hz, i) => this.tone(hz, 'sine', 0.45, 0.28, hz * 1.05, i * 0.13));
  }

  death() {
    void this.ctx.resume();
    this.tone(220, 'sawtooth', 1.4, 0.35, 36);
    this.tone(110, 'sine',     1.0, 0.15, 20);
  }

  newHighScore() {
    void this.ctx.resume();
    const notes = [523, 659, 783, 1046];
    notes.forEach((hz, i) => this.tone(hz, 'sine', 0.3, 0.22, hz, i * 0.11));
  }

  bhRumble(intensity: number) {
    void this.ctx.resume();
    this.tone(25 + intensity * 12, 'sine',     0.5, intensity * 0.14, 18);
    this.tone(38 + intensity * 8,  'sawtooth', 0.4, intensity * 0.06, 28);
  }

  heartbeat() {
    void this.ctx.resume();
    this.tone(58, 'sine', 0.12, 0.20, 38);
    this.tone(48, 'sine', 0.10, 0.15, 32, 0.16);
  }

  boost() {
    void this.ctx.resume();
    this.tone(180, 'sawtooth', 0.12, 0.20, 500);
    this.tone(260, 'sine',     0.18, 0.13, 640);
  }

  eject() {
    void this.ctx.resume();
    this.tone(120, 'sine',     0.22, 0.30, 40);
    this.tone(170, 'sawtooth', 0.10, 0.10, 55);
  }

  shield() {
    void this.ctx.resume();
    this.tone(880, 'sine', 0.06, 0.25, 1320);
    this.tone(660, 'sine', 0.40, 0.15, 440);
  }

  shieldBreak() {
    void this.ctx.resume();
    this.tone(440, 'sawtooth', 0.18, 0.12, 110);
  }

  warnCountdown(urgency: number) {
    void this.ctx.resume();
    if (urgency === 0) {
      this.tone(220, 'triangle', 0.18, 0.16, 180);
      this.tone(180, 'sine',     0.22, 0.10, 140, 0.18);
    } else if (urgency === 1) {
      this.tone(260, 'triangle', 0.14, 0.18, 200);
      this.tone(320, 'sine',     0.16, 0.16, 240, 0.14);
      this.tone(400, 'sine',     0.14, 0.12, 300, 0.28);
    } else {
      for (let i = 0; i < 4; i++) {
        this.tone(550, 'square', 0.07, 0.18, 550, i * 0.10);
      }
      this.tone(660, 'sawtooth', 0.25, 0.28, 220, 0.42);
    }
  }

  clutchEscape() {
    void this.ctx.resume();
    const notes = [261, 392, 523, 659, 784, 1046];
    notes.forEach((hz, i) => this.tone(hz, 'sine', 0.40, 0.36, hz * 1.1, i * 0.08));
  }

  combo(level: number) {
    void this.ctx.resume();
    const base = Math.min(300 + level * 20, 700);
    this.tone(base,        'sine', 0.18, 0.12, base * 1.5);
    this.tone(base * 1.25, 'sine', 0.14, 0.10, base * 1.5, 0.07);
    this.tone(base * 1.5,  'sine', 0.10, 0.08, base * 1.5, 0.14);
  }

  /** Round start fanfare — cosmic ascending chord sweep. */
  roundStart() {
    void this.ctx.resume();
    // Low impact thud
    this.tone(55,  'sawtooth', 0.35, 0.22, 28);
    this.tone(82,  'sine',     0.30, 0.16, 40);
    // Rising arpeggio: A2 C#3 E3 A3 C#4 — cosmic major feel
    const notes = [110, 138, 165, 220, 277, 330];
    notes.forEach((hz, i) => {
      this.tone(hz, 'sine', 0.50 - i * 0.04, 0.20 - i * 0.02, hz * 1.02, 0.10 + i * 0.11);
    });
    // High shimmer on top
    this.tone(880,  'sine', 0.80, 0.10, 1100, 0.70);
    this.tone(1320, 'sine', 0.60, 0.07, 1760, 0.80);
  }

  // ── Tension drone (bass layer) ─────────────────────────────────────────

  startTensionDrone() {
    if (this.droneOsc) return;
    void this.ctx.resume();
    this.droneOsc = this.ctx.createOscillator();
    this.droneGain = this.ctx.createGain();
    this.droneOsc.type = 'sine';
    this.droneOsc.frequency.value = 40;
    this.droneGain.gain.value = 0;
    this.droneOsc.connect(this.droneGain);
    this.droneGain.connect(this.masterGain);
    this.droneOsc.start();
  }

  setTensionDrone(freq: number, volume: number) {
    if (!this.droneOsc || !this.droneGain) return;
    const t = this.ctx.currentTime;
    this.droneOsc.frequency.setTargetAtTime(freq, t, 1.5);
    this.droneGain.gain.setTargetAtTime(volume, t, 1.5);
  }

  stopTensionDrone() {
    if (this.droneOsc) {
      try { this.droneOsc.stop(); } catch { /* already stopped */ }
      this.droneOsc = null;
      this.droneGain = null;
    }
  }

  // ── Dynamic music (pad + percussion layers) ────────────────────────────

  /**
   * Start the layered music system (call once at round create).
   * Layers build up as intensity increases via updateMusic().
   */
  startMusic() {
    if (this.musicRunning) return;
    this.musicRunning = true;
    void this.ctx.resume();

    // Pad layer: three oscillators for a spacey chord (root + fifth + octave)
    this.padOsc1 = this.ctx.createOscillator();
    this.padOsc2 = this.ctx.createOscillator();
    this.padOsc3 = this.ctx.createOscillator();
    this.padGain = this.ctx.createGain();

    this.padOsc1.type = 'sine';
    this.padOsc2.type = 'sine';
    this.padOsc3.type = 'triangle';
    this.padOsc1.frequency.value = 55;    // A1 — root
    this.padOsc2.frequency.value = 82.4;  // E2 — perfect fifth
    this.padOsc3.frequency.value = 110.2; // A2 — octave (slightly detuned for warmth)
    this.padGain.gain.value = 0;

    this.padOsc1.connect(this.padGain);
    this.padOsc2.connect(this.padGain);
    this.padOsc3.connect(this.padGain);
    this.padGain.connect(this.masterGain);
    this.padOsc1.start();
    this.padOsc2.start();
    this.padOsc3.start();

    // Init beat scheduler half a second ahead so first beat doesn't fire immediately
    this.nextBeatTime = this.ctx.currentTime + 0.5;
    this.beatCount = 0;
  }

  stopMusic() {
    this.musicRunning = false;
    const oscs = [this.padOsc1, this.padOsc2, this.padOsc3];
    for (const o of oscs) { if (o) { try { o.stop(); } catch { /**/ } } }
    this.padOsc1 = null;
    this.padOsc2 = null;
    this.padOsc3 = null;
    this.padGain = null;
  }

  /**
   * Update dynamic music each frame.
   * intensity: 0 (round start) → 1 (peak shrink).
   * Called from Main.ts update() — same intensity that drives the tension drone.
   */
  updateMusic(intensity: number) {
    if (!this.musicRunning) return;

    // ── Pad layer ──────────────────────────────────────────────────────
    if (this.padGain) {
      // Pad fades in above 20% intensity, peaks at 0.09 volume
      const padVol = Math.max(0, (intensity - 0.20) / 0.80) * 0.09;
      const t = this.ctx.currentTime;
      this.padGain.gain.setTargetAtTime(padVol, t, 2.5);

      // Pads shift upward as tension rises — deeper space → brighter urgency
      if (this.padOsc1) this.padOsc1.frequency.setTargetAtTime(55  + intensity * 55,   t, 2.0);
      if (this.padOsc2) this.padOsc2.frequency.setTargetAtTime(82.4 + intensity * 82.4, t, 2.0);
      if (this.padOsc3) this.padOsc3.frequency.setTargetAtTime(110.2 + intensity * 110, t, 2.0);
    }

    // ── Percussion scheduler ───────────────────────────────────────────
    // No percussion below 18% intensity
    if (intensity < 0.18) {
      this.nextBeatTime = this.ctx.currentTime + 0.8;
      this.beatCount = 0;
      return;
    }

    const now         = this.ctx.currentTime;
    const lookAhead   = 0.12; // schedule 120 ms ahead
    // Tempo: 0.55s/beat at 18% → 0.25s/beat at 100% (54 BPM → 120 BPM)
    const beatInterval = 0.55 - intensity * 0.30;

    while (this.nextBeatTime < now + lookAhead) {
      const beat = this.beatCount % 4;

      // ── Kick on beat 0 (and beat 2 above 40%) ─────────────────────
      if (beat === 0 || (beat === 2 && intensity > 0.40)) {
        const kickVol = 0.14 + intensity * 0.20;
        // Kick = sine sweep 80→28hz
        this.toneAt(this.nextBeatTime, 80, 'sine', 0.22, kickVol, 28);
        // Sub thump underneath
        this.toneAt(this.nextBeatTime, 48, 'sine', 0.30, kickVol * 0.55, 22);
      }

      // ── Snare on beat 2 above 30% ─────────────────────────────────
      if (beat === 2 && intensity > 0.30) {
        const snareVol = 0.08 + intensity * 0.10;
        // Snare = mid-freq sawtooth pop + noise-like triangle blend
        this.toneAt(this.nextBeatTime, 200, 'sawtooth', 0.08, snareVol,        120);
        this.toneAt(this.nextBeatTime, 350, 'triangle', 0.06, snareVol * 0.7,  180);
      }

      // ── Hi-hat on every beat above 50% ────────────────────────────
      if (intensity > 0.50) {
        const hhVol = 0.04 + intensity * 0.06;
        this.toneAt(this.nextBeatTime, 4400, 'square', 0.035, hhVol, 6000);
      }

      // ── Off-beat hi-hat above 65% (8th notes) ─────────────────────
      if (intensity > 0.65) {
        const offTime = this.nextBeatTime + beatInterval * 0.5;
        const hhVol   = 0.03 + intensity * 0.04;
        this.toneAt(offTime, 5500, 'square', 0.025, hhVol, 7000);
      }

      // ── Rapid 16th subdivision at peak (intensity > 80%) ──────────
      if (intensity > 0.80 && (beat === 0 || beat === 2)) {
        const subVol = 0.025;
        const sub16  = beatInterval * 0.25;
        for (let s = 1; s <= 3; s++) {
          this.toneAt(this.nextBeatTime + s * sub16, 4000 + s * 800, 'square', 0.020, subVol, 5500 + s * 600);
        }
      }

      this.beatCount++;
      this.nextBeatTime += beatInterval;
    }
  }

  // ── Destroy ────────────────────────────────────────────────────────────

  destroy() {
    if (this.thrustOsc) { try { this.thrustOsc.stop(); } catch { /* already stopped */ } }
    this.stopTensionDrone();
    this.stopMusic();
    void this.ctx.close();
  }
}
