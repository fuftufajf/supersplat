import { Color, Vec3 } from 'playcanvas';

import type { Pose } from './camera-poses';
import {
    displayParamValuesFromState,
    displayParams,
    getDisplayParam,
    type DisplayParam,
    type DisplayParamGroup,
    type DisplayParamId
} from './display-params';
import { AnimTrackEditOp } from './edit-ops';
import { Events } from './events';
import type { Splat } from './splat';
import { i18n } from './ui/localization';

/**
 * Splat Director bridge: `window.__piScene`, the control surface the external
 * Director Board (director-board.html) drives through its iframe. Every call
 * returns { ok, value } or { ok: false, error, limitation? }.
 */

declare global {
    interface Window {
        __piScene?: any;
    }
}

type SplatRef = number | string | { index?: number, name?: string };

const groupMeta: Record<DisplayParamGroup, { label: string, description: string, collapsed: boolean, experimental?: boolean }> = {
    shape: { label: 'Shape & volume', description: 'Gaussian size, detail cull and the point cloud look.', collapsed: false },
    reveal: { label: 'Reveal', description: 'Grow the layer from the ground up, hard or soft.', collapsed: false },
    color: { label: 'Color & light', description: 'Live tone, tint and transparency over the baked colours.', collapsed: false },
    transform: { label: 'Transform', description: 'Layer position, rotation (degrees) and per-axis scale.', collapsed: false },
    visibility: { label: 'Visibility', description: 'Cut a layer in and out; keys hold until the next one.', collapsed: false },
    scene: { label: 'Scene', description: 'Whole-view exposure before tone mapping.', collapsed: false },
    pulse: { label: 'PULS (experimental)', description: 'Breathing opacity over time.', collapsed: true, experimental: true }
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
};

const packColor = (c: Color) => ({ r: c.r, g: c.g, b: c.b, a: c.a });
const packVec3 = (v: Vec3) => ({ x: v.x, y: v.y, z: v.z });

const parseColor = (value: any) => {
    const hex = typeof value === 'string' && value.trim().match(/^#?([0-9a-f]{6})$/i)?.[1];
    if (hex) {
        return new Color(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, 1);
    }
    if (value && typeof value === 'object') {
        return new Color(clampNumber(value.r, 0, 1, 0), clampNumber(value.g, 0, 1, 0), clampNumber(value.b, 0, 1, 0), clampNumber(value.a, 0, 1, 1));
    }
    return null;
};

const fail = (error: string, limitation?: string) => ({ ok: false, error, ...(limitation ? { limitation } : {}) });

const settle = (result: any) => (result && typeof result === 'object' && Object.hasOwn(result, 'ok') ? result : { ok: true, value: result ?? null });

const errorResult = (error: unknown) => fail(error instanceof Error ? error.message : String(error));

// the board calls these synchronously; only the file operations are async
const wrap = (fn: (...args: any[]) => any) => (...args: any[]) => {
    try {
        return settle(fn(...args));
    } catch (error) {
        return errorResult(error);
    }
};

const wrapAsync = (fn: (...args: any[]) => Promise<any>) => async (...args: any[]) => {
    try {
        return settle(await fn(...args));
    } catch (error) {
        return errorResult(error);
    }
};

const registerDirectorBridge = (events: Events) => {
    const splats = () => (events.invoke('scene.allSplats') as Splat[]) ?? [];
    const focus = () => (events.invoke('displayTrack.focus') as Splat) ?? null;
    const frame = () => Number(events.invoke('timeline.frame') ?? 0);
    const frames = () => Math.max(1, Number(events.invoke('timeline.frames') ?? 1));
    const clampFrame = (value: unknown) => Math.max(0, Math.min(frames() - 1, Math.round(Number(value) || 0)));

    const resolveSplat = (ref: SplatRef) => {
        const list = splats();
        const byName = (name: string) => list.find(s => s.name === name || s.filename === name) ?? null;
        if (typeof ref === 'number') return list[ref] ?? null;
        if (typeof ref === 'string') return byName(ref);
        if (ref && typeof ref === 'object') return Number.isFinite(ref.index) ? list[ref.index] ?? null : typeof ref.name === 'string' ? byName(ref.name) : null;
        return null;
    };

    const serializeSplat = (splat: Splat, index: number) => {
        const scale = splat.entity.getLocalScale();
        return {
            index,
            name: splat.name,
            filename: splat.filename,
            visible: splat.visible,
            selected: splat === events.invoke('selection'),
            focused: splat === focus(),
            numSplats: splat.numSplats,
            scale: packVec3(scale),
            keyedParams: Object.keys(splat.displayTracks)
        };
    };

    const serializeParam = (param: DisplayParam) => {
        const target = events.invoke('displayTrack.target', param.id);
        const keys = (events.invoke('displayTrack.keys', param.id) as number[]) ?? [];
        const value = target ? param.get(target) : param.default;
        return {
            id: param.id,
            group: param.group,
            groupLabel: groupMeta[param.group].label,
            scope: param.scope,
            label: param.label.includes('.') ? i18n.t(param.label) : param.label,
            min: param.min,
            max: param.max,
            step: param.step,
            sliderMin: param.sliderMin ?? param.min,
            sliderMax: param.sliderMax ?? param.max,
            sliderStep: param.sliderStep ?? param.step,
            sliderValue: param.toSlider ? param.toSlider(value) : value,
            sliderDefault: param.toSlider ? param.toSlider(param.default) : param.default,
            precision: param.precision ?? 2,
            default: param.default,
            interpolation: param.interpolation ?? 'linear',
            experimental: !!param.experimental,
            value,
            animatable: true,
            keys,
            keyedAtFrame: keys.includes(frame()),
            active: events.invoke('displayTrack.activeParam') === param.id,
            disabled: !target
        };
    };

    const getViewState = () => ({
        background: packColor(events.invoke('bgClr')),
        selectedColor: packColor(events.invoke('selectedClr')),
        unselectedColor: packColor(events.invoke('unselectedClr')),
        lockedColor: packColor(events.invoke('lockedClr')),
        tonemapping: String(events.invoke('camera.tonemapping') ?? 'linear'),
        fov: Number(events.invoke('camera.fov') ?? 60),
        fovDolly: Boolean(events.invoke('camera.fovDolly')),
        shBands: Number(events.invoke('view.bands') ?? 3),
        flySpeed: Number(events.invoke('camera.flySpeed') ?? 1),
        gaussians: Boolean(events.invoke('view.gaussians')),
        centers: Boolean(events.invoke('view.centers')),
        rings: Boolean(events.invoke('view.rings')),
        centerSize: Number(events.invoke('view.centerSize') ?? 2),
        ringSize: Number(events.invoke('view.ringSize') ?? 4),
        editView: Boolean(events.invoke('view.editView')),
        stochastic: String(events.invoke('view.stochastic') ?? 'auto'),
        minPixelSize: Number(events.invoke('view.minPixelSize') ?? 2),
        outlineSelection: Boolean(events.invoke('view.outlineSelection')),
        gridVisible: Boolean(events.invoke('grid.visible')),
        boundVisible: Boolean(events.invoke('camera.bound')),
        cameraPosesVisible: Boolean(events.invoke('camera.showPoses'))
    });

    const setViewState = (view: any = {}) => {
        const colors: [string, string][] = [['background', 'setBgClr'], ['selectedColor', 'setSelectedClr'], ['unselectedColor', 'setUnselectedClr'], ['lockedColor', 'setLockedClr']];
        for (const [key, event] of colors) {
            if (view[key] === undefined) continue;
            const color = parseColor(view[key]);
            if (!color) return fail(`invalid ${key}`);
            events.fire(event, color);
        }
        const numbers: [string, string, number, number][] = [
            ['fov', 'camera.setFov', 10, 120], ['shBands', 'view.setBands', 0, 3], ['flySpeed', 'camera.setFlySpeed', 0.1, 30],
            ['centerSize', 'view.setCenterSize', 0, 10], ['ringSize', 'view.setRingSize', 1, 50], ['minPixelSize', 'view.setMinPixelSize', 0, 64]
        ];
        for (const [key, event, min, max] of numbers) {
            if (view[key] !== undefined) events.fire(event, clampNumber(view[key], min, max, min));
        }
        const flags: [string, string][] = [
            ['fovDolly', 'camera.setFovDolly'], ['gaussians', 'view.setGaussians'], ['centers', 'view.setCenters'], ['rings', 'view.setRings'],
            ['editView', 'view.setEditView'], ['outlineSelection', 'view.setOutlineSelection'], ['gridVisible', 'grid.setVisible'],
            ['boundVisible', 'camera.setBound'], ['cameraPosesVisible', 'camera.setShowPoses']
        ];
        for (const [key, event] of flags) {
            if (view[key] !== undefined) events.fire(event, Boolean(view[key]));
        }
        if (view.tonemapping !== undefined) {
            if (!['linear', 'neutral', 'aces', 'aces2', 'filmic', 'hejl'].includes(String(view.tonemapping))) return fail(`invalid tonemapping '${view.tonemapping}'`);
            events.fire('camera.setTonemapping', String(view.tonemapping));
        }
        if (view.stochastic !== undefined) events.fire('view.setStochastic', String(view.stochastic));
        return getViewState();
    };

    // camera orbit around the world origin, keyed evenly over durationSeconds
    const buildCameraOrbit = (options: any = {}) => {
        const pose = events.invoke('camera.getPose');
        const track = events.invoke('camera.animTrack');
        if (!pose?.position || !pose?.target || !track) return fail('camera pose unavailable');

        const durationSeconds = clampNumber(options.durationSeconds, 1, 120, 12);
        const frameRate = Math.max(1, Math.round(Number(events.invoke('timeline.frameRate') ?? 30)));
        const orbitFrames = Math.max(2, Math.round(durationSeconds * frameRate));
        const keyCount = Math.round(clampNumber(options.keyCount, 4, 64, 16));
        const direction = options.direction === 'clockwise' ? -1 : 1;
        const start = new Vec3(pose.position.x, pose.position.y, pose.position.z);
        const radius = Math.hypot(start.x, start.z);
        if (radius < 0.0001) {
            return fail('camera is too close to the orbit axis', 'move the camera to an angled view before building an orbit');
        }

        // blank pitch keeps the current look pitch; 0 looks level, negative looks down
        const lookDistance = Math.hypot(pose.target.x - start.x, pose.target.z - start.z);
        const currentPitch = lookDistance > 0.0001 ? Math.atan2(pose.target.y - start.y, lookDistance) * 180 / Math.PI : 0;
        const explicit = options.lookPitchDegrees !== null && options.lookPitchDegrees !== undefined && String(options.lookPitchDegrees).trim() !== '';
        const lookPitchDegrees = clampNumber(explicit ? options.lookPitchDegrees : currentPitch, -85, 85, 0);
        const targetY = start.y + Math.tan(lookPitchDegrees * Math.PI / 180) * radius;
        const startAngle = (Number(options.startAngleDegrees) || 0) * Math.PI / 180;

        events.fire('timeline.setPlaying', false);
        events.fire('timeline.setFrames', orbitFrames);
        events.fire('timeline.setFrame', 0);

        const before = track.snapshot();
        const poses: Pose[] = [];
        for (let i = 0; i < keyCount; i++) {
            const angle = direction * (i / keyCount) * Math.PI * 2 + startAngle;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            poses.push({
                name: `director_orbit_${i}`,
                frame: Math.round(i * orbitFrames / keyCount),
                position: new Vec3(start.x * cos - start.z * sin, start.y, start.x * sin + start.z * cos),
                target: new Vec3(0, targetY, 0),
                fov: pose.fov
            });
        }
        track.loadPoses(poses);
        events.fire('edit.add', new AnimTrackEditOp('directorOrbit', track, before, track.snapshot()), true);
        events.fire('camera.setShowPoses', true);

        return {
            durationSeconds,
            frameRate,
            frames: orbitFrames,
            keyCount,
            keys: poses.map(p => p.frame),
            radius,
            lookPitchDegrees,
            targetHeight: targetY,
            startPosition: packVec3(start),
            center: { x: 0, y: 0, z: 0 },
            direction: direction < 0 ? 'clockwise' : 'counterclockwise'
        };
    };

    const getState = () => {
        const list = splats();
        const selection = events.invoke('selection') as Splat;
        const layer = focus();
        const pose = events.invoke('camera.getPose');
        const poses = (events.invoke('camera.poses') as Pose[]) ?? [];
        const count = frames();
        return {
            schema: 'pi.scene.supersplat-director.v2',
            module: { id: 'supersplat-director-scene', type: 'supersplat-editor', title: 'SuperSplat Director Scene', schemaVersion: 'pi.scene.v0' },
            engine: 'supersplat-3',
            documentName: (events.invoke('doc.name') as string) ?? null,
            embedded: document.documentElement.dataset.embedded === '1',
            sceneDirty: Boolean(events.invoke('scene.dirty')),
            director: events.invoke('director.metadata') ?? {},
            view: getViewState(),
            camera: {
                position: pose?.position ? packVec3(pose.position) : null,
                target: pose?.target ? packVec3(pose.target) : null,
                fov: pose?.fov ?? events.invoke('camera.fov') ?? 60,
                keyCount: poses.length,
                directorOrbitKeyCount: poses.filter(p => String(p?.name ?? '').startsWith('director_orbit_')).length
            },
            timeline: {
                frame: frame(),
                frames: count,
                frameRate: Number(events.invoke('timeline.frameRate') ?? 30),
                smoothness: Number(events.invoke('timeline.smoothness') ?? 1),
                loop: Boolean(events.invoke('timeline.loop')),
                playing: Boolean(events.invoke('timeline.playing')),
                normalizedTime: count > 1 ? frame() / (count - 1) : 0
            },
            selection: selection ? serializeSplat(selection, list.indexOf(selection)) : null,
            focus: layer ? serializeSplat(layer, list.indexOf(layer)) : null,
            splats: list.map(serializeSplat),
            display: {
                activeParamId: events.invoke('displayTrack.activeParam') ?? null,
                groups: Object.entries(groupMeta).map(([id, meta]) => ({ id, ...meta })),
                params: displayParams.map(serializeParam)
            }
        };
    };

    const requireParam = (paramId: DisplayParamId) => (getDisplayParam(paramId) ? null : fail(`unknown display parameter '${paramId}'`));

    // select a layer, or focus it when hidden (the editor refuses to select hidden layers)
    const setSelection = (ref: SplatRef) => {
        const splat = resolveSplat(ref);
        if (!splat) return fail('selection target not found');
        if (splat.visible) events.fire('selection', splat);
        events.fire('displayTrack.setFocus', splat);
        return serializeSplat(splat, splats().indexOf(splat));
    };

    const setParamValue = (paramId: DisplayParamId, value: number) => {
        const param = getDisplayParam(paramId);
        if (!param) return fail(`unknown display parameter '${paramId}'`);
        if (!events.invoke('displayTrack.target', paramId)) return fail('no splat selected', 'select a splat before directing its display parameters');
        if (!Number.isFinite(Number(value))) return fail(`invalid value for '${paramId}'`, 'parameter values must be finite numbers');
        events.invoke('displayTrack.setValue', paramId, Number(value));
        events.fire('displayTrack.changed', paramId);
        return serializeParam(param);
    };

    const setState = (state: any = {}) => {
        const t = state.timeline;
        if (t) {
            if (Number.isFinite(t.frames)) events.fire('timeline.setFrames', Math.max(1, Math.round(t.frames)));
            if (Number.isFinite(t.frameRate)) events.fire('timeline.setFrameRate', Math.max(1, Math.round(t.frameRate)));
            if (Number.isFinite(t.smoothness)) events.fire('timeline.setSmoothness', Math.max(0, Number(t.smoothness)));
            if (typeof t.loop === 'boolean') events.fire('timeline.setLoop', t.loop);
            if (Number.isFinite(t.frame)) events.fire('timeline.setFrame', clampFrame(t.frame));
            if (typeof t.playing === 'boolean') events.fire('timeline.setPlaying', t.playing);
        }
        if (state.selection !== undefined && state.selection !== null) {
            const result = setSelection(state.selection.index ?? state.selection.name ?? state.selection);
            if ((result as any).ok === false) return result;
        }
        if (state.display) {
            if (state.display.activeParamId !== undefined) events.fire('displayTrack.setActiveParam', state.display.activeParamId);
            for (const [paramId, value] of displayParamValuesFromState(state.display)) {
                const result = setParamValue(paramId, Number(value));
                if ((result as any).ok === false) return result;
            }
        }
        if (state.view) {
            const result = setViewState(state.view);
            if ((result as any).ok === false) return result;
        }
        return getState();
    };

    const ensureSelection = () => {
        if (!events.invoke('selection') && splats()[0]) events.fire('selection', splats()[0]);
    };

    const keyOp = (event: string) => (paramId: DisplayParamId, at?: number) => {
        const missing = requireParam(paramId);
        if (missing) return missing;
        events.fire('displayTrack.setActiveParam', paramId);
        events.fire(event, paramId, Number.isFinite(at) ? clampFrame(at) : frame());
        return getState();
    };

    const api = {
        version: 'pi.scene.v0',
        module: Object.freeze({ id: 'supersplat-director-scene', type: 'supersplat-editor', title: 'SuperSplat Director Scene', schemaVersion: 'pi.scene.v0' }),
        capabilities: Object.freeze({
            playback: true,
            seek: true,
            projectOpen: true,
            projectSave: true,
            viewControls: true,
            cameraOrbit: true,
            stateExport: true,
            stateImport: true,
            previewCapture: false,
            narrativeBlockExport: false,
            layerFocus: true
        }),
        lifecycle: { ready: true, warnings: [] as string[], errors: [] as string[] },

        getState: wrap(getState),
        setState: wrap(setState),
        setViewState: wrap(setViewState),
        setDirectorMetadata: wrap((metadata: any = {}) => {
            events.fire('director.setMetadata', metadata && typeof metadata === 'object' ? metadata : {});
            return events.invoke('director.metadata');
        }),
        buildCameraOrbit: wrap(buildCameraOrbit),
        play: wrap(() => {
            events.fire('timeline.setPlaying', true);
            return getState().timeline;
        }),
        pause: wrap(() => {
            events.fire('timeline.setPlaying', false);
            return getState().timeline;
        }),
        seek: wrap((normalizedTime: number) => {
            events.fire('timeline.setPlaying', false);
            events.fire('timeline.setFrame', clampFrame((frames() - 1) * clampNumber(normalizedTime, 0, 1, 0)));
            return getState().timeline;
        }),
        importFiles: wrapAsync(async (files: File[]) => {
            if (!Array.isArray(files) || files.length === 0) return fail('no files provided');
            await events.invoke('import', files.map(file => ({ filename: file.name, contents: file })));
            ensureSelection();
            return getState();
        }),
        openProjectFile: wrapAsync(async (file: File, handle?: FileSystemFileHandle) => {
            if (!file) return fail('no project file provided');
            if (await events.invoke('doc.load', file, handle) !== true) return fail('project open cancelled or failed');
            ensureSelection();
            return getState();
        }),
        saveProjectToHandle: wrapAsync(async (handle: FileSystemFileHandle) => {
            if (!handle) return fail('no file handle provided');
            if (await events.invoke('doc.saveToHandle', handle) !== true) return fail('project save failed');
            return getState();
        }),
        setSelection: wrap(setSelection),
        toggleSplatVisibility: wrap((ref: SplatRef) => {
            const splat = resolveSplat(ref);
            if (!splat) return fail('splat not found');
            events.fire('displayTrack.setFocus', splat);
            // same path as setParamValue; a key at this frame is updated, not overridden on the next scrub
            const keyed = ((events.invoke('displayTrack.keys', 'visible') as number[]) ?? []).includes(frame());
            events.invoke('displayTrack.setValue', 'visible', splat.visible ? 0 : 1, !keyed);
            if (keyed) events.fire('displayTrack.addKey', 'visible');
            events.fire('displayTrack.changed', 'visible');
            return serializeSplat(splat, splats().indexOf(splat));
        }),
        setActiveParam: wrap((paramId: DisplayParamId | null) => {
            const missing = paramId !== null && requireParam(paramId);
            if (missing) return missing;
            events.fire('displayTrack.setActiveParam', paramId);
            return { activeParamId: events.invoke('displayTrack.activeParam') ?? null };
        }),
        setParamValue: wrap(setParamValue),
        setParamSliderValue: wrap((paramId: DisplayParamId, sliderValue: number) => {
            const param = getDisplayParam(paramId);
            if (!param) return fail(`unknown display parameter '${paramId}'`);
            if (!Number.isFinite(Number(sliderValue))) return fail(`invalid slider value for '${paramId}'`);
            const slider = clampNumber(sliderValue, param.sliderMin ?? param.min, param.sliderMax ?? param.max, param.default);
            return setParamValue(paramId, param.fromSlider ? param.fromSlider(slider) : slider);
        }),
        addDisplayKey: wrap(keyOp('displayTrack.addKey')),
        removeDisplayKey: wrap(keyOp('displayTrack.removeKey')),
        clearDisplayKeys: wrap((paramId?: DisplayParamId) => {
            const missing = paramId !== undefined && requireParam(paramId);
            if (missing) return missing;
            events.fire('displayTrack.clear', paramId);
            return getState();
        }),
        jumpDisplayKey: wrap((paramId: DisplayParamId, direction: 'prev' | 'next') => {
            const keys = ((events.invoke('displayTrack.keys', paramId) as number[]) ?? []).slice().sort((a, b) => a - b);
            if (keys.length === 0) return fail(`no keyframes on '${paramId}'`, 'add a keyframe before jumping between keys');
            const now = frame();
            const target = direction === 'prev' ?
                keys.filter(k => k < now).pop() ?? keys[keys.length - 1] :
                keys.find(k => k > now) ?? keys[0];
            events.fire('displayTrack.setActiveParam', paramId);
            events.fire('timeline.setFrame', target);
            return { frame: target, paramId };
        })
    };

    window.__piScene = api;

    try {
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'pi-scene-ready', version: 'pi.scene.v0', moduleId: api.module.id }, '*');
        }
    } catch {
        // cross-origin parent
    }
};

export { registerDirectorBridge };
