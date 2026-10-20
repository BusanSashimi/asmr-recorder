export interface Transport {
  playing: boolean;
  speed: number;
  looping: boolean;
  time: string;
  sourceTime: string;
  target: "source" | "program";
  note?: string;
}

interface ProgramState {
  time: string | null;
  status: Transport | null;
  seeking: boolean;
  error: string | null;
}

type Send = (action: string, time?: string) => Promise<Transport>;

// One owner for program seeks, including when the Program panel is closed.
// Pending pointer positions replace one another instead of filling the IPC queue.
export class ProgramTransport {
  private state: ProgramState = {
    time: null,
    status: null,
    seeking: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private pending: { time: string; version: number } | null = null;
  private inFlight = false;
  private frame: number | null = null;
  private waiters = new Set<() => void>();
  private commands: Promise<void> = Promise.resolve();
  private epoch = 0;
  private send: Send;
  version = 0;

  constructor(send: Send) { this.send = send; }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<ProgramState>) {
    if (Object.entries(patch).every(
      ([key, value]) => this.state[key as keyof ProgramState] === value,
    )) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  isCurrent = (version: number) => version === this.version;

  observe(status: Transport, version: number, updateTime: boolean) {
    if (!this.isCurrent(version) || this.state.seeking) return false;
    const previous = this.state.status;
    const keys = ["playing", "speed", "looping", "time", "sourceTime", "target", "note"] as const;
    if (previous && keys.every((key) => previous[key] === status[key]))
      status = previous;
    this.update({ status, ...(updateTime ? { time: status.time } : {}) });
    return true;
  }

  seek = (time: string, { flush = false }: { flush?: boolean } = {}) => {
    const { status } = this.state;
    const duplicate = time === this.state.time && !this.state.error &&
      (this.state.seeking || (status?.target === "program" &&
        !status.playing && status.time === time));
    if (!duplicate) {
      this.pending = { time, version: ++this.version };
      this.update({ time, seeking: true, error: null });
    }
    if (flush) this.flush();
    else this.schedule();
  };

  private schedule() {
    if (this.frame !== null || this.inFlight || !this.pending) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      void this.pump();
    });
  }

  private flush() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    void this.pump();
  }

  private async pump() {
    if (this.inFlight || !this.pending) return;
    const request = this.pending;
    this.pending = null;
    this.inFlight = true;
    try {
      const status = await this.send("seek", request.time);
      if (this.isCurrent(request.version))
        this.update({ status, time: status.time, error: null });
    } catch (error) {
      if (this.isCurrent(request.version)) {
        // Seeking may be rejected during voice-over. Restore the native position
        // without sending pause (which would stop and save the recording).
        this.update({ error: String(error) });
        try {
          const status = await this.send("status");
          if (this.isCurrent(request.version))
            this.update({ status, time: status.time });
        } catch { /* retain the original seek error */ }
      }
    } finally {
      this.inFlight = false;
      if (this.pending) this.schedule();
      else {
        this.update({ seeking: false });
        this.waiters.forEach((resolve) => resolve());
        this.waiters.clear();
      }
    }
  }

  private async settled() {
    if (!this.state.seeking) return;
    const done = new Promise<void>((resolve) => this.waiters.add(resolve));
    this.flush();
    await done;
  }

  run = (action: string, time?: string): Promise<void> => {
    if (action === "seek" && time !== undefined) {
      this.seek(time, { flush: true });
      return this.settled();
    }
    const epoch = this.epoch;
    const command = this.commands.then(async () => {
      await this.settled();
      if (epoch !== this.epoch) return;
      const version = ++this.version;
      try {
        if (action === "toggle") {
          const status = await this.send("status");
          if (!this.isCurrent(version)) return;
          action = status.playing ? "pause" : "play";
        }
        const status = await this.send(action, time);
        if (this.isCurrent(version))
          this.update({ status, time: status.time, error: null });
      } catch (error) {
        if (this.isCurrent(version)) this.update({ error: String(error) });
      }
    });
    this.commands = command;
    return command;
  };

  cancel = () => {
    ++this.version;
    ++this.epoch;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
    this.update({ time: null, status: null, seeking: false, error: null });
    this.waiters.forEach((resolve) => resolve());
    this.waiters.clear();
  };
}
