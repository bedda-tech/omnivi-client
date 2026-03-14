export class SfxManager {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private thrustOsc: OscillatorNode | null = null;
  private thrustGain: GainNode | null = null;
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

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

  absorb(mass: number) {
    void this.ctx.resume();
    if (mass > 50) {
      // Asteroid/planet thump
      this.tone(110, 'sine', 0.3, 0.35, 55);
    } else {
      // Dust pop — short, higher
      this.tone(380, 'sine', 0.07, 0.2, 220);
    }
  }

  bigShrink() {
    void this.ctx.resume();
    // Three low sawtooth drones for an ominous chord
    this.tone(40,  'sawtooth', 2.5, 0.07);
    this.tone(55,  'sawtooth', 2.5, 0.06);
    this.tone(70,  'sawtooth', 2.0, 0.05);
  }

  escaped() {
    void this.ctx.resume();
    // Rising major arpeggio: C4 E4 G4 C5
    const notes = [261, 329, 392, 523];
    notes.forEach((hz, i) => this.tone(hz, 'sine', 0.45, 0.28, hz * 1.05, i * 0.13));
  }

  death() {
    void this.ctx.resume();
    // Descending sweep from 220 Hz down to 36 Hz
    this.tone(220, 'sawtooth', 1.4, 0.35, 36);
    this.tone(110, 'sine',     1.0, 0.15, 20);
  }

  newHighScore() {
    void this.ctx.resume();
    // Cheerful ascending arpeggio: C5 E5 G5 C6
    const notes = [523, 659, 783, 1046];
    notes.forEach((hz, i) => this.tone(hz, 'sine', 0.3, 0.22, hz, i * 0.11));
  }

  /** Deep bass rumble near black hole. intensity 0..1 */
  bhRumble(intensity: number) {
    void this.ctx.resume();
    this.tone(25 + intensity * 12, 'sine',     0.5, intensity * 0.14, 18);
    this.tone(38 + intensity * 8,  'sawtooth', 0.4, intensity * 0.06, 28);
  }

  /** Two-pulse heartbeat when low on mass. */
  heartbeat() {
    void this.ctx.resume();
    this.tone(58, 'sine', 0.12, 0.20, 38);
    this.tone(48, 'sine', 0.10, 0.15, 32, 0.16);
  }

  /** Whoosh for boost burst. */
  boost() {
    void this.ctx.resume();
    this.tone(180, 'sawtooth', 0.12, 0.20, 500);
    this.tone(260, 'sine',     0.18, 0.13, 640);
  }

  /** Chunky thud for mass ejection projectile. */
  eject() {
    void this.ctx.resume();
    this.tone(120, 'sine',     0.22, 0.30, 40);
    this.tone(170, 'sawtooth', 0.10, 0.10, 55);
  }

  /** Shield activation — resonant bell ping. */
  shield() {
    void this.ctx.resume();
    this.tone(880, 'sine', 0.06, 0.25, 1320);
    this.tone(660, 'sine', 0.40, 0.15, 440);
  }

  /** Shield break/expire — descending sizzle. */
  shieldBreak() {
    void this.ctx.resume();
    this.tone(440, 'sawtooth', 0.18, 0.12, 110);
  }

  /** Warning countdown alert. urgency: 0=60s, 1=30s, 2=10s */
  warnCountdown(urgency: number) {
    void this.ctx.resume();
    if (urgency === 0) {
      // 60s: two low-tone alert — heads-up
      this.tone(220, 'triangle', 0.18, 0.16, 180);
      this.tone(180, 'sine',     0.22, 0.10, 140, 0.18);
    } else if (urgency === 1) {
      // 30s: three-tone rising alarm — get ready
      this.tone(260, 'triangle', 0.14, 0.18, 200);
      this.tone(320, 'sine',     0.16, 0.16, 240, 0.14);
      this.tone(400, 'sine',     0.14, 0.12, 300, 0.28);
    } else {
      // 10s: rapid-fire alarm — NOW!
      for (let i = 0; i < 4; i++) {
        this.tone(550, 'square', 0.07, 0.18, 550, i * 0.10);
      }
      this.tone(660, 'sawtooth', 0.25, 0.28, 220, 0.42);
    }
  }

  /** Extended fanfare for clutch escape at low mass. */
  clutchEscape() {
    void this.ctx.resume();
    const notes = [261, 392, 523, 659, 784, 1046];
    notes.forEach((hz, i) => this.tone(hz, 'sine', 0.40, 0.36, hz * 1.1, i * 0.08));
  }

  /** Rising arpeggio for combo milestones — pitch scales with combo level. */
  combo(level: number) {
    void this.ctx.resume();
    const base = Math.min(300 + level * 20, 700);
    this.tone(base,        'sine', 0.18, 0.12, base * 1.5);
    this.tone(base * 1.25, 'sine', 0.14, 0.10, base * 1.5, 0.07);
    this.tone(base * 1.5,  'sine', 0.10, 0.08, base * 1.5, 0.14);
  }

  /** Start a continuous low-frequency tension drone (call once at round start). */
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

  /** Update tension drone frequency and volume with smooth ramping. */
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

  destroy() {
    if (this.thrustOsc) { try { this.thrustOsc.stop(); } catch { /* already stopped */ } }
    this.stopTensionDrone();
    void this.ctx.close();
  }
}
