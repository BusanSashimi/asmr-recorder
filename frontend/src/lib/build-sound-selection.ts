import type { BuildSoundSelectionMode } from "@/types/build-sounds";

export class BuildSoundSelector {
  private sequentialIndex = 0;
  private shuffleBag: string[] = [];
  private lastSelected: string | null = null;
  private mode: BuildSoundSelectionMode;
  private readonly random: () => number;

  constructor(
    mode: BuildSoundSelectionMode,
    random: () => number = Math.random,
  ) {
    this.mode = mode;
    this.random = random;
  }

  reset(mode: BuildSoundSelectionMode = this.mode) {
    this.mode = mode;
    this.sequentialIndex = 0;
    this.shuffleBag = [];
    this.lastSelected = null;
  }

  select(playableIds: readonly string[]): string | null {
    const ids = [...new Set(playableIds)];
    if (ids.length === 0) return null;

    if (this.mode === "sequential") {
      const selected = ids[this.sequentialIndex % ids.length];
      this.sequentialIndex = (this.sequentialIndex + 1) % ids.length;
      this.lastSelected = selected;
      return selected;
    }

    const playable = new Set(ids);
    this.shuffleBag = this.shuffleBag.filter((id) => playable.has(id));
    if (this.shuffleBag.length === 0) {
      this.shuffleBag = this.shuffled(ids);
      if (
        this.shuffleBag.length > 1 &&
        this.shuffleBag[0] === this.lastSelected
      ) {
        const swapIndex = this.shuffleBag.findIndex(
          (id) => id !== this.lastSelected,
        );
        [this.shuffleBag[0], this.shuffleBag[swapIndex]] = [
          this.shuffleBag[swapIndex],
          this.shuffleBag[0],
        ];
      }
    }
    const selected = this.shuffleBag.shift() ?? null;
    this.lastSelected = selected;
    return selected;
  }

  private shuffled(ids: string[]): string[] {
    const result = [...ids];
    for (let index = result.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }
}

interface SourceLike {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  connect(node: AudioNode): unknown;
  disconnect(): void;
  start(when?: number): void;
}

interface ContextLike {
  createBufferSource(): SourceLike;
}

export function scheduleSoundbite(
  context: ContextLike,
  gain: AudioNode,
  buffer: AudioBuffer,
  active: Set<SourceLike>,
): SourceLike {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  active.add(source);
  source.onended = () => {
    active.delete(source);
    source.disconnect();
  };
  source.start();
  return source;
}
