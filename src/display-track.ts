import { AnimTrack } from './anim-track';
import {
    applyDisplayParamValue,
    displayParams,
    getDisplayParam,
    normalizeKeyframes,
    sampleKeyframes,
    type DisplayKeyframe,
    type DisplayParam,
    type DisplayParamId,
    type DisplayTarget,
    type DisplayTrackSet
} from './display-params';
import { Events } from './events';
import type { Scene } from './scene';
import type { Splat } from './splat';

/**
 * Splat Director keyframes. Every layer owns its tracks (splat.displayTracks)
 * and all layers animate together; scene-scoped params (exposure) live on one
 * scene target. The native timeline edits the active param of the selected
 * layer through DisplayParamAnimTrack (see track-manager).
 */

const copyTracks = (tracks: DisplayTrackSet): DisplayTrackSet => {
    const result: DisplayTrackSet = {};
    for (const [id, keys] of Object.entries(tracks)) {
        if (keys?.length) result[id as DisplayParamId] = keys.map(k => ({ frame: k.frame, value: k.value }));
    }
    return result;
};

class DisplayTrackEditOp {
    name: string;
    constructor(private manager: DisplayTrackManager, private target: DisplayTarget, private before: DisplayTrackSet, private after: DisplayTrackSet, name: string) {
        this.name = name;
    }

    do() {
        this.manager.restoreTarget(this.target, this.after);
    }

    undo() {
        this.manager.restoreTarget(this.target, this.before);
    }
}

// the AnimTrack face of one param on the current target, for the timeline panel
class DisplayParamAnimTrack implements AnimTrack {
    constructor(private manager: DisplayTrackManager, private paramId: DisplayParamId) {}

    get keys(): readonly number[] {
        return this.manager.keys(this.paramId);
    }

    addKey(frame: number) {
        return this.manager.addKey(this.paramId, frame, false);
    }

    removeKey(frame: number) {
        return this.manager.removeKey(this.paramId, frame, false);
    }

    moveKey(fromFrame: number, toFrame: number) {
        return this.manager.moveKey(this.paramId, fromFrame, toFrame, false);
    }

    copyKey(fromFrame: number, toFrame: number) {
        return this.manager.copyKey(this.paramId, fromFrame, toFrame, false);
    }

    clear() {
        this.manager.clear(this.paramId, false);
    }

    snapshot() {
        const target = this.manager.target(this.paramId);
        return target ? copyTracks(target.displayTracks) : {};
    }

    restore(snapshot: unknown) {
        const target = this.manager.target(this.paramId);
        if (target) this.manager.restoreTarget(target, snapshot as DisplayTrackSet);
    }
}

class DisplayTrackManager {
    readonly sceneTarget: DisplayTarget;
    private activeParamId: DisplayParamId | null = null;
    private wrappers = new Map<DisplayParamId, DisplayParamAnimTrack>();
    // playhead in (fractional) frames; pulse and other time-driven effects read it
    frameTime = 0;

    constructor(private events: Events, private scene: Scene) {
        this.sceneTarget = { display: {}, displayTracks: {}, scene };
        displayParams.forEach(p => this.wrappers.set(p.id, new DisplayParamAnimTrack(this, p.id)));

        // scrubbing fires frame, playback and video capture fire time
        events.on('timeline.frame', (frame: number) => this.applyFrame(frame));
        events.on('timeline.time', (time: number) => this.applyFrame(time));

        // the director follows the selection, but keeps its layer when the
        // selection drops it (hiding a layer deselects it, and a visibility key
        // must still be able to bring it back)
        events.on('selection.changed', (selection: Splat | null) => {
            if (selection) this.setFocus(selection);
        });
        events.on('scene.elementRemoved', (element: unknown) => {
            if (element === this.focus) this.setFocus((events.invoke('selection') as Splat) ?? null);
        });

        // a layer's tracks come with it; a new document starts without scene tracks
        events.on('scene.clear', () => {
            this.focus = null;
            this.sceneTarget.display = {};
            this.sceneTarget.displayTracks = {};
            events.fire('displayTrack.changed');
        });

        // exposure is engine state: push the director value before the frame renders
        events.on('prerender', () => {
            const exposure = this.sceneTarget.display.exposure;
            if (exposure !== undefined) scene.app.scene.exposure = exposure;
        });
    }

    layers(): Splat[] {
        return (this.events.invoke('scene.allSplats') as Splat[]) ?? [];
    }

    focus: Splat | null = null;

    setFocus(layer: Splat | null) {
        if (layer === this.focus) return;
        this.focus = layer;
        if (this.activeParamId) this.events.fire('track.keysLoaded');
        this.events.fire('displayTrack.focusChanged', layer);
        this.events.fire('displayTrack.changed');
    }

    // the target a param's edits address: the focused layer, or the scene
    target(paramId: DisplayParamId): DisplayTarget | null {
        const param = getDisplayParam(paramId);
        if (!param) return null;
        return param.scope === 'scene' ? this.sceneTarget : this.focus;
    }

    private normalizeFrame(frame: number) {
        const frames = this.events.invoke('timeline.frames') ?? 1;
        return Math.max(0, Math.min(frames - 1, Math.round(frame)));
    }

    private edit(name: string, paramId: DisplayParamId, recordEdit: boolean, mutate: (keys: DisplayKeyframe[], param: DisplayParam, target: DisplayTarget) => DisplayKeyframe[] | null) {
        const param = getDisplayParam(paramId);
        const target = this.target(paramId);
        if (!param || !target) return false;

        const before = copyTracks(target.displayTracks);
        const next = mutate((target.displayTracks[paramId] ?? []).map(k => ({ ...k })), param, target);
        if (!next) return false;

        if (next.length) {
            target.displayTracks[paramId] = next.sort((a, b) => a.frame - b.frame);
        } else {
            delete target.displayTracks[paramId];
        }
        if (recordEdit) {
            this.events.fire('edit.add', new DisplayTrackEditOp(this, target, before, copyTracks(target.displayTracks), name), true);
        }
        this.changed(target, paramId);
        return true;
    }

    addKey(paramId: DisplayParamId, frame?: number, recordEdit = true) {
        const at = this.normalizeFrame(frame ?? this.events.invoke('timeline.frame') ?? 0);
        let updated = false;
        const changed = this.edit(`displayTrack.addKey:${paramId}`, paramId, recordEdit, (keys, param, target) => {
            const value = param.get(target);
            const existing = keys.find(k => k.frame === at);
            if (existing) {
                if (existing.value === value) return null;
                existing.value = value;
                updated = true;
            } else {
                keys.push({ frame: at, value });
            }
            return keys;
        });
        if (changed && this.activeParamId === paramId) this.events.fire(updated ? 'track.keyUpdated' : 'track.keyAdded', at);
        return changed;
    }

    removeKey(paramId: DisplayParamId, frame?: number, recordEdit = true) {
        const at = this.normalizeFrame(frame ?? this.events.invoke('timeline.frame') ?? 0);
        const changed = this.edit(`displayTrack.removeKey:${paramId}`, paramId, recordEdit, (keys) => {
            const next = keys.filter(k => k.frame !== at);
            return next.length === keys.length ? null : next;
        });
        if (changed && this.activeParamId === paramId) this.events.fire('track.keyRemoved', at);
        return changed;
    }

    moveKey(paramId: DisplayParamId, fromFrame: number, toFrame: number, recordEdit = true) {
        const from = this.normalizeFrame(fromFrame);
        const to = this.normalizeFrame(toFrame);
        const changed = this.edit(`displayTrack.moveKey:${paramId}`, paramId, recordEdit, (keys) => {
            const source = keys.find(k => k.frame === from);
            if (from === to || !source) return null;
            return [...keys.filter(k => k.frame !== from && k.frame !== to), { frame: to, value: source.value }];
        });
        if (changed && this.activeParamId === paramId) this.events.fire('track.keyMoved', from, to);
        return changed;
    }

    copyKey(paramId: DisplayParamId, fromFrame: number, toFrame: number, recordEdit = true) {
        const from = this.normalizeFrame(fromFrame);
        const to = this.normalizeFrame(toFrame);
        const changed = this.edit(`displayTrack.copyKey:${paramId}`, paramId, recordEdit, (keys) => {
            const source = keys.find(k => k.frame === from);
            if (from === to || !source) return null;
            return [...keys.filter(k => k.frame !== to), { frame: to, value: source.value }];
        });
        if (changed && this.activeParamId === paramId) this.events.fire('track.keyAdded', to);
        return changed;
    }

    // one param's keys on its target, or every track of the selected layer and the scene
    clear(paramId?: DisplayParamId, recordEdit = true) {
        if (paramId) {
            const changed = this.edit(`displayTrack.clear:${paramId}`, paramId, recordEdit, keys => (keys.length ? [] : null));
            if (changed && this.activeParamId === paramId) this.events.fire('track.keysCleared');
            return changed;
        }
        let changed = false;
        displayParams.forEach((param) => {
            changed = this.clear(param.id, recordEdit) || changed;
        });
        return changed;
    }

    keys(paramId: DisplayParamId): number[] {
        return (this.target(paramId)?.displayTracks[paramId] ?? []).map(k => k.frame);
    }

    value(paramId: DisplayParamId, frame: number) {
        const param = getDisplayParam(paramId);
        const target = this.target(paramId);
        return param && target ? sampleKeyframes(target.displayTracks[paramId], frame, param.interpolation) : undefined;
    }

    // set a param's current value on its target (undoable); keyed frames are updated in place
    setValue(paramId: DisplayParamId, value: number, recordEdit = true) {
        const param = getDisplayParam(paramId);
        const target = this.target(paramId);
        if (!param || !target || !Number.isFinite(value)) return false;
        const op = applyDisplayParamValue(target, param, value);
        if (!op) return false;
        if (recordEdit) this.events.fire('edit.add', op, true);
        this.events.fire('displayTrack.valueChanged', paramId);
        return true;
    }

    restoreTarget(target: DisplayTarget, tracks: DisplayTrackSet) {
        target.displayTracks = copyTracks(tracks);
        this.changed(target);
        if (this.activeParamId) this.events.fire('track.keysLoaded');
    }

    activeParam() {
        return this.activeParamId;
    }

    setActiveParam(paramId: DisplayParamId | null) {
        if ((paramId && !getDisplayParam(paramId)) || this.activeParamId === paramId) return false;
        this.activeParamId = paramId;
        this.events.fire('displayTrack.activeParamChanged', paramId);
        this.events.fire('track.keysLoaded');
        return true;
    }

    activeTrack(): AnimTrack | null {
        return this.activeParamId && this.target(this.activeParamId) ? this.wrappers.get(this.activeParamId) : null;
    }

    // a key edit re-evaluates only its own param: re-applying every track would
    // overwrite values the operator changed on other params but hasn't keyed yet.
    // Undo/redo (no paramId) restores the whole target
    private changed(target: DisplayTarget, paramId?: DisplayParamId) {
        this.applyTarget(target, this.frameTime, true, paramId);
        this.events.fire('displayTrack.changed', paramId);
    }

    private applyTarget(target: DisplayTarget, frame: number, restore = false, only?: DisplayParamId) {
        let changed = false;
        for (const [id, keys] of Object.entries(target.displayTracks)) {
            if (only && id !== only) continue;
            const param = getDisplayParam(id);
            const value = param && sampleKeyframes(keys, frame, param.interpolation);
            if (value === undefined || param.get(target) === value) continue;
            (restore && param.restore ? param.restore : param.set)(target, value);
            changed = true;
        }
        return changed;
    }

    applyFrame(frame: number) {
        if (!Number.isFinite(frame)) return;
        this.frameTime = frame;
        let changed = this.applyTarget(this.sceneTarget, frame);
        let pulsing = false;
        for (const layer of this.layers()) {
            changed = this.applyTarget(layer, frame) || changed;
            pulsing ||= (layer.display.pulse ?? 0) > 0;
        }
        // display values are not in the scene state diff, so request the frame here
        if (changed || pulsing) this.scene.forceRender = true;
    }
}

const serializeTarget = (target: DisplayTarget) => {
    const values = Object.fromEntries(Object.entries(target.display).filter(([id, v]) => getDisplayParam(id) && v !== getDisplayParam(id).default));
    const tracks = copyTracks(target.displayTracks);
    return Object.keys(values).length || Object.keys(tracks).length ? { values, tracks } : undefined;
};

const deserializeTarget = (target: DisplayTarget, data: any) => {
    target.displayTracks = {};
    for (const [id, keys] of Object.entries(data?.tracks ?? {})) {
        const param = getDisplayParam(id);
        const normalized = param && normalizeKeyframes(param, keys);
        if (normalized?.length) target.displayTracks[param.id] = normalized;
    }
    for (const [id, value] of Object.entries(data?.values ?? {})) {
        const param = getDisplayParam(id);
        if (param && Number.isFinite(value)) param.set(target, Number(value));
    }
};

const registerDisplayTrackEvents = (events: Events, scene: Scene) => {
    const manager = new DisplayTrackManager(events, scene);

    events.on('displayTrack.addKey', (paramId: DisplayParamId, frame?: number) => manager.addKey(paramId, frame));
    events.on('displayTrack.removeKey', (paramId: DisplayParamId, frame?: number) => manager.removeKey(paramId, frame));
    events.on('displayTrack.moveKey', (paramId: DisplayParamId, from: number, to: number) => manager.moveKey(paramId, from, to));
    events.on('displayTrack.copyKey', (paramId: DisplayParamId, from: number, to: number) => manager.copyKey(paramId, from, to));
    events.on('displayTrack.clear', (paramId?: DisplayParamId) => manager.clear(paramId));
    events.on('displayTrack.setActiveParam', (paramId: DisplayParamId | null) => manager.setActiveParam(paramId));

    events.function('displayTrack.keys', (paramId: DisplayParamId) => manager.keys(paramId));
    events.function('displayTrack.value', (paramId: DisplayParamId, frame: number) => manager.value(paramId, frame));
    events.function('displayTrack.setValue', (paramId: DisplayParamId, value: number, recordEdit = true) => manager.setValue(paramId, value, recordEdit));
    events.function('displayTrack.target', (paramId: DisplayParamId) => manager.target(paramId));
    events.function('displayTrack.activeParam', () => manager.activeParam());
    events.function('displayTrack.activeTrack', () => manager.activeTrack());
    events.function('displayTrack.frameTime', () => manager.frameTime);
    events.function('displayTrack.focus', () => manager.focus);
    events.on('displayTrack.setFocus', (layer: Splat | null) => manager.setFocus(layer));

    // scene target; layer data travels with each splat's own document entry
    events.function('docSerialize.sceneDirector', () => serializeTarget(manager.sceneTarget));
    events.function('docDeserialize.sceneDirector', (data: any) => {
        deserializeTarget(manager.sceneTarget, data);
        manager.applyFrame(events.invoke('timeline.frame') ?? 0);
    });

    // re-evaluate once layers and the timeline are in place after a document load
    events.on('displayTrack.refresh', () => manager.applyFrame(events.invoke('timeline.frame') ?? 0));

    // opaque board metadata (orbit settings, panel state) saved with the document
    let metadata: unknown = null;
    events.function('director.metadata', () => metadata);
    events.on('director.setMetadata', (value: unknown) => {
        metadata = value ?? null;
    });
    events.on('scene.clear', () => {
        metadata = null;
    });
    events.function('docSerialize.director', () => metadata ?? undefined);
    events.function('docDeserialize.director', (value: unknown) => {
        metadata = value ?? null;
    });
};

export { registerDisplayTrackEvents, serializeTarget, deserializeTarget };
