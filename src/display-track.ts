import { displayParams, getDisplayParam, type DisplayParam, type DisplayParamId } from './display-params';
import { Events } from './events';
import { Splat } from './splat';

type DisplayKeyframe = {
    frame: number,
    value: number
};

type DisplayTrackSnapshot = Partial<Record<DisplayParamId, DisplayKeyframe[]>>;

class DisplayTrackEditOp {
    name: string;
    private manager: DisplayTrackManager;
    private before: DisplayTrackSnapshot;
    private after: DisplayTrackSnapshot;

    constructor(name: string, manager: DisplayTrackManager, before: DisplayTrackSnapshot, after: DisplayTrackSnapshot) {
        this.name = name;
        this.manager = manager;
        this.before = before;
        this.after = after;
    }

    do() {
        this.manager.restore(this.after);
    }

    undo() {
        this.manager.restore(this.before);
    }
}

class DisplayParamTrack {
    private param: DisplayParam;
    private keyframes: DisplayKeyframe[] = [];

    constructor(param: DisplayParam) {
        this.param = param;
    }

    get keys(): readonly number[] {
        return this.keyframes.map(key => key.frame);
    }

    addKey(frame: number, value: number): boolean {
        const normalized = this.normalizeKeyframe(frame, value);
        const existing = this.keyframes.find(key => key.frame === normalized.frame);

        if (existing) {
            if (existing.value === normalized.value) {
                return false;
            }
            existing.value = normalized.value;
            return true;
        }

        this.keyframes.push(normalized);
        this.sortKeyframes();
        return true;
    }

    removeKey(frame: number): boolean {
        const index = this.keyframes.findIndex(key => key.frame === frame);
        if (index === -1) {
            return false;
        }

        this.keyframes.splice(index, 1);
        return true;
    }

    clear(): boolean {
        if (this.keyframes.length === 0) {
            return false;
        }

        this.keyframes.length = 0;
        return true;
    }

    valueAt(frame: number): number | undefined {
        if (this.keyframes.length === 0) {
            return undefined;
        }

        if (frame <= this.keyframes[0].frame) {
            return this.keyframes[0].value;
        }

        const last = this.keyframes[this.keyframes.length - 1];
        if (frame >= last.frame) {
            return last.value;
        }

        for (let i = 0; i < this.keyframes.length - 1; i++) {
            const a = this.keyframes[i];
            const b = this.keyframes[i + 1];
            if (frame >= a.frame && frame <= b.frame) {
                const t = (frame - a.frame) / Math.max(0.0001, b.frame - a.frame);
                return a.value + (b.value - a.value) * t;
            }
        }

        return last.value;
    }

    snapshot(): DisplayKeyframe[] {
        return this.keyframes.map(key => ({
            frame: key.frame,
            value: key.value
        }));
    }

    restore(snapshot: DisplayKeyframe[] = []) {
        const byFrame = new Map<number, DisplayKeyframe>();

        snapshot.forEach((keyframe) => {
            if (!keyframe) {
                return;
            }

            const frame = Math.round(keyframe.frame);
            const value = Number(keyframe.value);
            if (!Number.isFinite(frame) || !Number.isFinite(value)) {
                return;
            }

            byFrame.set(frame, this.normalizeKeyframe(frame, value));
        });

        this.keyframes = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
    }

    private normalizeKeyframe(frame: number, value: number): DisplayKeyframe {
        return {
            frame: Math.round(frame),
            value: Math.max(this.param.min, Math.min(this.param.max, value))
        };
    }

    private sortKeyframes() {
        this.keyframes.sort((a, b) => a.frame - b.frame);
    }
}

class DisplayTrackManager {
    private events: Events;
    private tracks = new Map<DisplayParamId, DisplayParamTrack>();

    constructor(events: Events) {
        this.events = events;

        displayParams.forEach((param) => {
            this.tracks.set(param.id, new DisplayParamTrack(param));
        });

        events.on('timeline.frame', (frame: number) => {
            this.applyFrame(frame);
        });

        events.on('timeline.time', (frame: number) => {
            this.applyFrame(frame);
        });

        events.on('selection.changed', () => {
            this.applyFrame(events.invoke('timeline.frame') ?? 0);
        });

        events.on('scene.clear', () => {
            if (this.clearAll()) {
                this.fireChanged();
            }
        });
    }

    addKey(paramId: DisplayParamId, frame?: number): boolean {
        const param = getDisplayParam(paramId);
        const splat = this.getTargetSplat();

        if (!param || !splat) {
            return false;
        }

        const track = this.tracks.get(param.id);
        const keyFrame = this.normalizeFrame(frame ?? this.events.invoke('timeline.frame') ?? 0);
        const value = param.get(splat);

        return this.edit(`displayTrack.addKey:${param.id}`, () => {
            return track.addKey(keyFrame, value);
        }, param.id);
    }

    removeKey(paramId: DisplayParamId, frame?: number): boolean {
        const param = getDisplayParam(paramId);
        if (!param) {
            return false;
        }

        const track = this.tracks.get(param.id);
        const keyFrame = this.normalizeFrame(frame ?? this.events.invoke('timeline.frame') ?? 0);

        return this.edit(`displayTrack.removeKey:${param.id}`, () => {
            return track.removeKey(keyFrame);
        }, param.id);
    }

    clear(paramId?: DisplayParamId): boolean {
        if (paramId) {
            const param = getDisplayParam(paramId);
            if (!param) {
                return false;
            }

            return this.edit(`displayTrack.clear:${param.id}`, () => {
                return this.tracks.get(param.id).clear();
            }, param.id);
        }

        return this.edit('displayTrack.clearAll', () => {
            return this.clearAll();
        });
    }

    keys(paramId: DisplayParamId): number[] {
        const param = getDisplayParam(paramId);
        if (!param) {
            return [];
        }

        return [...this.tracks.get(param.id).keys];
    }

    value(paramId: DisplayParamId, frame: number): number | undefined {
        const param = getDisplayParam(paramId);
        if (!param || !Number.isFinite(frame)) {
            return undefined;
        }

        return this.tracks.get(param.id).valueAt(frame);
    }

    snapshot(): DisplayTrackSnapshot {
        const result: DisplayTrackSnapshot = {};

        displayParams.forEach((param) => {
            const snapshot = this.tracks.get(param.id).snapshot();
            if (snapshot.length > 0) {
                result[param.id] = snapshot;
            }
        });

        return result;
    }

    restore(snapshot: DisplayTrackSnapshot = {}) {
        displayParams.forEach((param) => {
            this.tracks.get(param.id).restore(snapshot[param.id] ?? []);
        });

        this.fireChanged();
        this.applyFrame(this.events.invoke('timeline.frame') ?? 0);
    }

    private edit(name: string, mutate: () => boolean, changedParamId?: DisplayParamId) {
        const before = this.snapshot();
        if (!mutate()) {
            return false;
        }

        const after = this.snapshot();
        this.fireChanged(changedParamId);
        this.applyFrame(this.events.invoke('timeline.frame') ?? 0);
        this.events.fire('edit.add', new DisplayTrackEditOp(name, this, before, after), true);
        return true;
    }

    private clearAll(): boolean {
        let changed = false;
        this.tracks.forEach((track) => {
            changed = track.clear() || changed;
        });
        return changed;
    }

    private fireChanged(paramId?: DisplayParamId) {
        this.events.fire('displayTrack.changed', paramId);
    }

    private getTargetSplat(): Splat | null {
        const selection = this.events.invoke('selection');
        return selection instanceof Splat ? selection : null;
    }

    private normalizeFrame(frame: number): number {
        const timelineFrames = this.events.invoke('timeline.frames') ?? 1;
        const maxFrame = Math.max(0, timelineFrames - 1);
        return Math.max(0, Math.min(maxFrame, Math.round(frame)));
    }

    private applyFrame(frame: number) {
        const splat = this.getTargetSplat();
        if (!splat || !Number.isFinite(frame)) {
            return;
        }

        let changed = false;

        displayParams.forEach((param) => {
            const value = this.tracks.get(param.id).valueAt(frame);
            if (value !== undefined && param.get(splat) !== value) {
                param.set(splat, value);
                changed = true;
            }
        });

        if (changed) {
            splat.scene.forceRender = true;
        }
    }
}

const registerDisplayTrackEvents = (events: Events) => {
    const manager = new DisplayTrackManager(events);

    events.on('displayTrack.addKey', (paramId: DisplayParamId, frame?: number) => {
        manager.addKey(paramId, frame);
    });

    events.on('displayTrack.removeKey', (paramId: DisplayParamId, frame?: number) => {
        manager.removeKey(paramId, frame);
    });

    events.on('displayTrack.clear', (paramId?: DisplayParamId) => {
        manager.clear(paramId);
    });

    events.function('displayTrack.keys', (paramId: DisplayParamId) => {
        return manager.keys(paramId);
    });

    events.function('displayTrack.value', (paramId: DisplayParamId, frame: number) => {
        return manager.value(paramId, frame);
    });

    events.function('docSerialize.displayTracks', () => {
        return manager.snapshot();
    });

    events.function('docDeserialize.displayTracks', (snapshot: DisplayTrackSnapshot = {}) => {
        manager.restore(snapshot);
    });
};

export { registerDisplayTrackEvents };
export type { DisplayKeyframe, DisplayTrackSnapshot };
