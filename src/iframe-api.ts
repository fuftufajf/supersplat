import { Color, Vec3 } from 'playcanvas';

import { displayParams, getDisplayParam, type DisplayParam, type DisplayParamGroup, type DisplayParamId } from './display-params';
import { AnimTrackEditOp } from './edit-ops';
import { Events } from './events';
import { Splat } from './splat';
import { localize } from './ui/localization';

const IS_SCENE_DIRTY = 'supersplat:is-scene-dirty';

interface IsSceneDirtyQuery {
    type: typeof IS_SCENE_DIRTY;
}

interface IsSceneDirtyResponse {
    type: typeof IS_SCENE_DIRTY;
    result: boolean;
}

type GroupMeta = {
    label: string;
    description: string;
    collapsed: boolean;
    experimental?: boolean;
};

type Rgba = {
    r: number;
    g: number;
    b: number;
    a: number;
};

declare global {
    interface Window {
        __piScene?: any;
    }
}

const groupMeta: Record<DisplayParamGroup, GroupMeta> = {
    shape: {
        label: 'Shape & volume',
        description: 'Broad silhouette and the perceived thickness of the splat.',
        collapsed: false
    },
    reveal: {
        label: 'Reveal',
        description: 'How much of the splat is visible and how soft that reveal feels.',
        collapsed: false
    },
    color: {
        label: 'Color & light',
        description: 'Tone, tint, exposure and contrast shaping for the visible result.',
        collapsed: false
    },
    transform: {
        label: 'Axis scale',
        description: 'Per-axis stretch when the shot needs a controlled deformation.',
        collapsed: false
    },
    pulse: {
        label: 'PULS (experimental)',
        description: 'Hidden by default until the effect stops behaving like an opaque black box.',
        collapsed: true,
        experimental: true
    }
};

const isSceneDirtyQuery = (data: any): data is IsSceneDirtyQuery => {
    return (
        data &&
        typeof data === 'object' &&
        data.type === IS_SCENE_DIRTY
    );
};

const registerIframeApi = (events: Events, canvas: HTMLCanvasElement) => {
    let directorMetadata: any = {};

    events.function('docSerialize.director', () => directorMetadata);
    events.function('docDeserialize.director', (metadata: any = {}) => {
        directorMetadata = metadata && typeof metadata === 'object' ? metadata : {};
    });

    const wrap = (fn: (...args: any[]) => any) => {
        return (...args: any[]) => {
            try {
                const result = fn(...args);
                if (result && typeof result === 'object' && result.hasOwnProperty('ok')) {
                    return result;
                }
                return {
                    ok: true,
                    value: result ?? null
                };
            } catch (error) {
                return {
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        };
    };

    const wrapAsync = (fn: (...args: any[]) => Promise<any>) => {
        return async (...args: any[]) => {
            try {
                const result = await fn(...args);
                if (result && typeof result === 'object' && result.hasOwnProperty('ok')) {
                    return result;
                }
                return {
                    ok: true,
                    value: result ?? null
                };
            } catch (error) {
                return {
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        };
    };

    const currentFrame = () => Number(events.invoke('timeline.frame') ?? 0);
    const totalFrames = () => Math.max(1, Number(events.invoke('timeline.frames') ?? 1));

    const getSplats = () => {
        return (events.invoke('scene.allSplats') as Splat[]) ?? [];
    };

    const getSelection = () => {
        const selection = events.invoke('selection');
        return selection instanceof Splat ? selection : null;
    };

    const clampFrame = (value: number) => {
        return Math.max(0, Math.min(totalFrames() - 1, Math.round(Number(value) || 0)));
    };

    const clampNumber = (value: number, min: number, max: number, fallback: number) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallback;
        }
        return Math.max(min, Math.min(max, numeric));
    };

    const serializeColor = (color: Color): Rgba => ({
        r: color.r,
        g: color.g,
        b: color.b,
        a: color.a
    });

    const serializeVec3 = (value: Vec3) => ({
        x: value.x,
        y: value.y,
        z: value.z
    });

    const parseColor = (value: any, fallbackAlpha = 1) => {
        if (typeof value === 'string') {
            const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
            if (match) {
                const hex = match[1];
                return new Color(
                    parseInt(hex.slice(0, 2), 16) / 255,
                    parseInt(hex.slice(2, 4), 16) / 255,
                    parseInt(hex.slice(4, 6), 16) / 255,
                    fallbackAlpha
                );
            }
        }

        if (value && typeof value === 'object') {
            return new Color(
                clampNumber(value.r, 0, 1, 0),
                clampNumber(value.g, 0, 1, 0),
                clampNumber(value.b, 0, 1, 0),
                clampNumber(value.a, 0, 1, fallbackAlpha)
            );
        }

        return null;
    };

    const resolveParamLabel = (param: DisplayParam) => {
        if (!param.label.includes('.')) {
            return param.label;
        }
        return localize(param.label);
    };

    const serializeSplat = (splat: Splat, index: number, selection: Splat | null) => {
        const scale = splat.entity.getLocalScale();
        return {
            index,
            name: splat.name,
            filename: splat.filename,
            visible: splat.visible,
            selected: splat === selection,
            numSplats: splat.numSplats,
            scale: {
                x: scale.x,
                y: scale.y,
                z: scale.z
            }
        };
    };

    const serializeDisplayParam = (param: DisplayParam, splat: Splat | null) => {
        const frame = currentFrame();
        const keys = (events.invoke('displayTrack.keys', param.id) as number[]) ?? [];
        const value = splat ? param.get(splat) : param.default;
        const sliderMin = Number.isFinite(param.sliderMin) ? Number(param.sliderMin) : param.min;
        const sliderMax = Number.isFinite(param.sliderMax) ? Number(param.sliderMax) : param.max;
        const sliderStep = Number.isFinite(param.sliderStep) ? Number(param.sliderStep) : param.step;
        const sliderValue = param.toSlider ? param.toSlider(value) : value;
        const sliderDefault = param.toSlider ? param.toSlider(param.default) : param.default;

        return {
            id: param.id,
            group: param.group,
            groupLabel: groupMeta[param.group].label,
            label: resolveParamLabel(param),
            min: param.min,
            max: param.max,
            step: param.step,
            sliderMin,
            sliderMax,
            sliderStep,
            sliderValue,
            sliderDefault,
            precision: param.precision ?? 2,
            default: param.default,
            value,
            animatable: true,
            keys,
            keyedAtFrame: keys.includes(frame),
            active: events.invoke('displayTrack.activeParam') === param.id,
            disabled: !splat
        };
    };

    const resolveSplat = (ref?: number | string | { index?: number; name?: string }) => {
        const splats = getSplats();
        if (typeof ref === 'number' && splats[ref]) {
            return splats[ref];
        }

        if (typeof ref === 'string') {
            return splats.find(splat => splat.name === ref || splat.filename === ref) ?? null;
        }

        if (ref && typeof ref === 'object') {
            if (Number.isFinite(ref.index) && splats[ref.index]) {
                return splats[ref.index];
            }
            if (typeof ref.name === 'string') {
                return splats.find(splat => splat.name === ref.name || splat.filename === ref.name) ?? null;
            }
        }

        return null;
    };

    const setSelection = (ref?: number | string | { index?: number; name?: string }) => {
        const splat = resolveSplat(ref);
        if (!splat) {
            return {
                ok: false,
                error: 'selection target not found'
            };
        }

        events.fire('selection', splat);
        return {
            ok: true,
            value: serializeSplat(splat, getSplats().indexOf(splat), getSelection())
        };
    };

    const ensureSelection = () => {
        if (getSelection()) {
            return;
        }
        const firstSplat = getSplats()[0];
        if (firstSplat) {
            events.fire('selection', firstSplat);
        }
    };

    const setParamValue = (paramId: DisplayParamId, value: number) => {
        const splat = getSelection();
        if (!splat) {
            return {
                ok: false,
                error: 'no splat selected',
                limitation: 'select a splat before directing its display parameters'
            };
        }

        const param = getDisplayParam(paramId);
        if (!param) {
            return {
                ok: false,
                error: `unknown display parameter '${paramId}'`
            };
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return {
                ok: false,
                error: `invalid value for '${paramId}'`,
                limitation: 'parameter values must be finite numbers'
            };
        }

        const clamped = Math.max(param.min, Math.min(param.max, numericValue));
        param.set(splat, clamped);
        splat.scene.forceRender = true;
        events.fire('displayTrack.changed', param.id);

        return {
            ok: true,
            value: serializeDisplayParam(param, splat)
        };
    };

    const setParamSliderValue = (paramId: DisplayParamId, sliderValue: number) => {
        const param = getDisplayParam(paramId);
        if (!param) {
            return {
                ok: false,
                error: `unknown display parameter '${paramId}'`
            };
        }

        const numericSliderValue = Number(sliderValue);
        if (!Number.isFinite(numericSliderValue)) {
            return {
                ok: false,
                error: `invalid slider value for '${paramId}'`,
                limitation: 'parameter slider values must be finite numbers'
            };
        }

        const sliderMin = Number.isFinite(param.sliderMin) ? Number(param.sliderMin) : param.min;
        const sliderMax = Number.isFinite(param.sliderMax) ? Number(param.sliderMax) : param.max;
        const clampedSliderValue = Math.max(sliderMin, Math.min(sliderMax, numericSliderValue));
        const value = param.fromSlider ? param.fromSlider(clampedSliderValue) : clampedSliderValue;
        return setParamValue(paramId, value);
    };

    const requireParam = (paramId: DisplayParamId) => {
        const param = getDisplayParam(paramId);
        if (!param) {
            return {
                ok: false,
                error: `unknown display parameter '${paramId}'`
            };
        }
        return {
            ok: true,
            value: param
        };
    };

    const jumpDisplayKey = (paramId: DisplayParamId, direction: 'prev' | 'next') => {
        const keys = ((events.invoke('displayTrack.keys', paramId) as number[]) ?? []).slice().sort((a, b) => a - b);
        if (keys.length === 0) {
            return {
                ok: false,
                error: `no keyframes on '${paramId}'`,
                limitation: 'add a keyframe before jumping between keys'
            };
        }

        const frame = currentFrame();
        let nextFrame = keys[0];

        if (direction === 'prev') {
            const previousKeys = keys.filter(key => key < frame);
            nextFrame = previousKeys.length > 0 ? previousKeys[previousKeys.length - 1] : keys[keys.length - 1];
        } else {
            const followingKeys = keys.filter(key => key > frame);
            nextFrame = followingKeys.length > 0 ? followingKeys[0] : keys[0];
        }

        events.fire('displayTrack.setActiveParam', paramId);
        events.fire('timeline.setFrame', nextFrame);

        return {
            ok: true,
            value: {
                frame: nextFrame,
                paramId
            }
        };
    };

    const getViewState = () => ({
        background: serializeColor(events.invoke('bgClr') as Color),
        selectedColor: serializeColor(events.invoke('selectedClr') as Color),
        unselectedColor: serializeColor(events.invoke('unselectedClr') as Color),
        lockedColor: serializeColor(events.invoke('lockedClr') as Color),
        tonemapping: String(events.invoke('camera.tonemapping') ?? 'linear'),
        fov: Number(events.invoke('camera.fov') ?? 60),
        shBands: Number(events.invoke('view.bands') ?? 3),
        flySpeed: Number(events.invoke('camera.flySpeed') ?? 1),
        pointSize: Number(events.invoke('camera.splatSize') ?? 2),
        ringSize: Number(events.invoke('camera.ringSize') ?? 0.04),
        centersUseGaussianColor: Boolean(events.invoke('view.centersUseGaussianColor')),
        outlineSelection: Boolean(events.invoke('view.outlineSelection')),
        gridVisible: Boolean(events.invoke('grid.visible')),
        boundVisible: Boolean(events.invoke('camera.bound')),
        cameraPosesVisible: Boolean(events.invoke('camera.showPoses'))
    });

    const setViewState = (view: any = {}) => {
        if (view.background !== undefined) {
            const color = parseColor(view.background, 1);
            if (!color) {
                return { ok: false, error: 'invalid background color' };
            }
            events.fire('setBgClr', color);
        }
        if (view.selectedColor !== undefined) {
            const color = parseColor(view.selectedColor, 1);
            if (!color) {
                return { ok: false, error: 'invalid selected color' };
            }
            events.fire('setSelectedClr', color);
        }
        if (view.unselectedColor !== undefined) {
            const color = parseColor(view.unselectedColor, 1);
            if (!color) {
                return { ok: false, error: 'invalid unselected color' };
            }
            events.fire('setUnselectedClr', color);
        }
        if (view.lockedColor !== undefined) {
            const color = parseColor(view.lockedColor, 1);
            if (!color) {
                return { ok: false, error: 'invalid locked color' };
            }
            events.fire('setLockedClr', color);
        }
        if (view.tonemapping !== undefined) {
            events.fire('camera.setTonemapping', String(view.tonemapping));
        }
        if (view.fov !== undefined) {
            events.fire('camera.setFov', clampNumber(view.fov, 10, 120, events.invoke('camera.fov') ?? 60));
        }
        if (view.shBands !== undefined) {
            events.fire('view.setBands', Math.round(clampNumber(view.shBands, 0, 3, events.invoke('view.bands') ?? 3)));
        }
        if (view.flySpeed !== undefined) {
            events.fire('camera.setFlySpeed', clampNumber(view.flySpeed, 0.1, 30, events.invoke('camera.flySpeed') ?? 1));
        }
        if (view.pointSize !== undefined) {
            events.fire('camera.setSplatSize', clampNumber(view.pointSize, 0, 40, events.invoke('camera.splatSize') ?? 2));
            events.fire('camera.setOverlay', true);
            events.fire('camera.setMode', 'centers');
        }
        if (view.ringSize !== undefined) {
            events.fire('camera.setRingSize', clampNumber(view.ringSize, 0, 0.5, events.invoke('camera.ringSize') ?? 0.04));
            events.fire('camera.setOverlay', true);
            events.fire('camera.setMode', 'rings');
        }
        if (view.centersUseGaussianColor !== undefined) {
            events.fire('view.setCentersUseGaussianColor', Boolean(view.centersUseGaussianColor));
        }
        if (view.outlineSelection !== undefined) {
            events.fire('view.setOutlineSelection', Boolean(view.outlineSelection));
        }
        if (view.gridVisible !== undefined) {
            events.fire('grid.setVisible', Boolean(view.gridVisible));
        }
        if (view.boundVisible !== undefined) {
            events.fire('camera.setBound', Boolean(view.boundVisible));
        }
        if (view.cameraPosesVisible !== undefined) {
            events.fire('camera.setShowPoses', Boolean(view.cameraPosesVisible));
        }

        return {
            ok: true,
            value: getViewState()
        };
    };

    const buildCameraOrbit = (options: any = {}) => {
        const pose = events.invoke('camera.getPose');
        if (!pose?.position || !pose?.target) {
            return {
                ok: false,
                error: 'camera pose unavailable'
            };
        }

        const durationSeconds = clampNumber(options.durationSeconds, 1, 120, 12);
        const frameRate = Math.max(1, Math.round(Number(events.invoke('timeline.frameRate') ?? 30)));
        const frames = Math.max(2, Math.round(durationSeconds * frameRate));
        const keyCount = Math.max(4, Math.min(64, Math.round(Number(options.keyCount) || 16)));
        const direction = options.direction === 'clockwise' ? -1 : 1;
        const startAngle = Number(options.startAngleDegrees) || 0;
        const target = new Vec3(0, 0, 0);
        const startOffset = new Vec3(pose.position.x, pose.position.y, pose.position.z);
        const poseTarget = new Vec3(pose.target.x, pose.target.y, pose.target.z);
        const horizontalRadius = Math.hypot(startOffset.x, startOffset.z);

        if (horizontalRadius < 0.0001) {
            return {
                ok: false,
                error: 'camera is too close to the orbit axis',
                limitation: 'move the camera to an angled view before building an orbit'
            };
        }

        const track = events.invoke('camera.animTrack');
        if (!track || typeof track.clear !== 'function') {
            return {
                ok: false,
                error: 'camera animation track unavailable'
            };
        }

        events.fire('timeline.setPlaying', false);
        events.fire('timeline.setFrames', frames);
        events.fire('timeline.setFrame', 0);
        const before = track.snapshot();
        track.clear();

        const angleOffset = startAngle * Math.PI / 180;
        const currentLookDistance = Math.hypot(poseTarget.x - startOffset.x, poseTarget.z - startOffset.z);
        const currentPitchDegrees = currentLookDistance > 0.0001 ?
            Math.atan2(poseTarget.y - startOffset.y, currentLookDistance) * 180 / Math.PI :
            0;
        const hasExplicitLookPitch = options.lookPitchDegrees !== null &&
            options.lookPitchDegrees !== undefined &&
            String(options.lookPitchDegrees).trim() !== '';
        const explicitLookPitch = Number(options.lookPitchDegrees);
        const lookPitchDegrees = hasExplicitLookPitch && Number.isFinite(explicitLookPitch) ?
            clampNumber(explicitLookPitch, -85, 85, 0) :
            clampNumber(currentPitchDegrees, -85, 85, 0);
        const lookTargetY = (position: Vec3) => {
            return position.y + Math.tan(lookPitchDegrees * Math.PI / 180) * horizontalRadius;
        };
        const keys = [];
        for (let i = 0; i < keyCount; i++) {
            const t = i / keyCount;
            const angle = direction * t * Math.PI * 2 + angleOffset;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const position = new Vec3(
                target.x + startOffset.x * cos - startOffset.z * sin,
                target.y + startOffset.y,
                target.z + startOffset.x * sin + startOffset.z * cos
            );
            const frame = Math.round(i * frames / keyCount);
            keys.push(frame);
            events.fire('camera.addPose', {
                name: `director_orbit_${i}`,
                frame,
                position,
                target: new Vec3(target.x, lookTargetY(position), target.z),
                fov: pose.fov
            });
        }

        events.fire('camera.setShowPoses', true);
        events.fire('camera.setPose', {
            position: new Vec3(pose.position.x, pose.position.y, pose.position.z),
            target: new Vec3(target.x, lookTargetY(startOffset), target.z),
            fov: pose.fov
        }, 0);
        events.fire('edit.add', new AnimTrackEditOp('directorOrbit', track, before, track.snapshot()), true);

        return {
            ok: true,
            value: {
                durationSeconds,
                frameRate,
                frames,
                keyCount,
                keys,
                radius: horizontalRadius,
                lookPitchDegrees,
                targetHeight: lookTargetY(startOffset),
                startPosition: serializeVec3(startOffset),
                center: {
                    x: target.x,
                    y: target.y,
                    z: target.z
                },
                direction: options.direction === 'clockwise' ? 'clockwise' : 'counterclockwise'
            }
        };
    };

    const getState = () => {
        const selection = getSelection();
        const splats = getSplats();
        const frame = currentFrame();
        const frames = totalFrames();
        const activeParamId = (events.invoke('displayTrack.activeParam') as DisplayParamId | null) ?? null;
        const pose = events.invoke('camera.getPose');
        const cameraPoses = ((events.invoke('camera.poses') as any[]) ?? []);

        return {
            schema: 'pi.scene.supersplat-director.v1',
            module: {
                id: 'supersplat-director-scene',
                type: 'supersplat-editor',
                title: 'SuperSplat Director Scene',
                schemaVersion: 'pi.scene.v0'
            },
            documentName: (events.invoke('doc.name') as string | null) ?? null,
            embedded: document.body.dataset.embedded === '1',
            sceneDirty: Boolean(events.invoke('scene.dirty')),
            director: directorMetadata,
            view: getViewState(),
            camera: {
                position: pose?.position ? serializeVec3(pose.position) : null,
                target: pose?.target ? serializeVec3(pose.target) : null,
                fov: pose?.fov ?? events.invoke('camera.fov') ?? 60,
                keyCount: cameraPoses.length,
                directorOrbitKeyCount: cameraPoses.filter(p => String(p?.name || '').startsWith('director_orbit_')).length
            },
            timeline: {
                frame,
                frames,
                frameRate: Number(events.invoke('timeline.frameRate') ?? 30),
                smoothness: Number(events.invoke('timeline.smoothness') ?? 1),
                playing: Boolean(events.invoke('timeline.playing')),
                normalizedTime: frames > 1 ? frame / (frames - 1) : 0
            },
            selection: selection ? serializeSplat(selection, splats.indexOf(selection), selection) : null,
            splats: splats.map((splat, index) => serializeSplat(splat, index, selection)),
            display: {
                activeParamId,
                groups: Object.entries(groupMeta).map(([id, meta]) => ({
                    id,
                    ...meta
                })),
                params: displayParams.map(param => serializeDisplayParam(param, selection))
            }
        };
    };

    const setState = (state: any = {}) => {
        if (state.timeline) {
            if (Number.isFinite(state.timeline.frames)) {
                events.fire('timeline.setFrames', Math.max(1, Math.round(state.timeline.frames)));
            }
            if (Number.isFinite(state.timeline.frameRate)) {
                events.fire('timeline.setFrameRate', Math.max(1, Math.round(state.timeline.frameRate)));
            }
            if (Number.isFinite(state.timeline.smoothness)) {
                events.fire('timeline.setSmoothness', Math.max(0, Number(state.timeline.smoothness)));
            }
            if (Number.isFinite(state.timeline.frame)) {
                events.fire('timeline.setFrame', clampFrame(state.timeline.frame));
            }
            if (typeof state.timeline.playing === 'boolean') {
                events.fire('timeline.setPlaying', state.timeline.playing);
            }
        }

        if (state.selection !== undefined && state.selection !== null) {
            const result = setSelection(state.selection.index ?? state.selection.name ?? state.selection);
            if (!result.ok) {
                return result;
            }
        }

        if (state.display) {
            if (state.display.activeParamId !== undefined) {
                events.fire('displayTrack.setActiveParam', state.display.activeParamId);
            }

            if (state.display.values && typeof state.display.values === 'object') {
                for (const [paramId, value] of Object.entries(state.display.values)) {
                    const result = setParamValue(paramId as DisplayParamId, Number(value));
                    if (!result.ok) {
                        return result;
                    }
                }
            }
        }

        if (state.view) {
            const result = setViewState(state.view);
            if (!result.ok) {
                return result;
            }
        }

        return {
            ok: true,
            value: getState()
        };
    };

    const api = {
        version: 'pi.scene.v0',
        module: Object.freeze({
            id: 'supersplat-director-scene',
            type: 'supersplat-editor',
            title: 'SuperSplat Director Scene',
            schemaVersion: 'pi.scene.v0'
        }),
        capabilities: Object.freeze({
            playback: true,
            seek: true,
            projectOpen: true,
            projectSave: true,
            viewControls: true,
            cameraOrbit: true,
            stateExport: true,
            stateImport: true,
            previewCapture: true,
            narrativeBlockExport: false
        }),
        lifecycle: {
            ready: true,
            warnings: [] as string[],
            errors: [] as string[]
        },

        getState: wrap(getState),
        setState: wrap(setState),
        setViewState: wrap(setViewState),
        setDirectorMetadata: wrap((metadata: any = {}) => {
            directorMetadata = metadata && typeof metadata === 'object' ? metadata : {};
            return directorMetadata;
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
            events.fire('timeline.setFrame', clampFrame((totalFrames() - 1) * Math.max(0, Math.min(1, Number(normalizedTime) || 0))));
            return {
                ok: true,
                value: getState().timeline
            };
        }),
        capturePreview: wrap(() => {
            return {
                ok: true,
                value: {
                    dataUrl: canvas.toDataURL('image/png'),
                    width: canvas.width,
                    height: canvas.height
                }
            };
        }),
        getAgentContext: wrap(() => {
            const state = getState();
            return {
                moduleId: state.module.id,
                timeline: state.timeline,
                selection: state.selection,
                activeParamId: state.display.activeParamId,
                visibleGroups: state.display.groups.filter(group => !group.collapsed).map(group => group.label)
            };
        }),

        importFiles: wrapAsync(async (files: File[]) => {
            const list = Array.isArray(files) ? files : [];
            if (list.length === 0) {
                return {
                    ok: false,
                    error: 'no files provided'
                };
            }

            await events.invoke('import', list.map(file => ({
                filename: file.name,
                contents: file
            })));

            ensureSelection();
            return {
                ok: true,
                value: getState()
            };
        }),
        openProjectFile: wrapAsync(async (file: File, handle?: FileSystemFileHandle) => {
            if (!file) {
                return {
                    ok: false,
                    error: 'no project file provided'
                };
            }

            const loaded = await events.invoke('doc.load', file, handle);
            if (loaded !== true) {
                return {
                    ok: false,
                    error: 'project open cancelled or failed'
                };
            }

            ensureSelection();
            return {
                ok: true,
                value: getState()
            };
        }),
        saveProject: wrapAsync(async () => {
            if (await events.invoke('doc.save') !== true) {
                return {
                    ok: false,
                    error: 'project save cancelled or failed'
                };
            }
            return getState();
        }),
        saveProjectAs: wrapAsync(async () => {
            if (await events.invoke('doc.saveAs') !== true) {
                return {
                    ok: false,
                    error: 'project save cancelled or failed'
                };
            }
            return getState();
        }),
        saveProjectToStream: wrapAsync(async (stream: FileSystemWritableFileStream, filename?: string) => {
            if (await events.invoke('doc.saveToStream', stream, filename) !== true) {
                return {
                    ok: false,
                    error: 'project save failed'
                };
            }
            return getState();
        }),
        setSelection: wrap(setSelection),
        toggleSplatVisibility: wrap((ref?: number | string | { index?: number; name?: string }) => {
            const splat = resolveSplat(ref);
            if (!splat) {
                return {
                    ok: false,
                    error: 'splat not found'
                };
            }

            splat.visible = !splat.visible;
            splat.scene.forceRender = true;

            return {
                ok: true,
                value: serializeSplat(splat, getSplats().indexOf(splat), getSelection())
            };
        }),
        setActiveParam: wrap((paramId: DisplayParamId | null) => {
            if (paramId !== null) {
                const paramResult = requireParam(paramId);
                if (!paramResult.ok) {
                    return paramResult;
                }
            }
            events.fire('displayTrack.setActiveParam', paramId);
            return {
                ok: true,
                value: {
                    activeParamId: (events.invoke('displayTrack.activeParam') as DisplayParamId | null) ?? null
                }
            };
        }),
        setParamValue: wrap(setParamValue),
        setParamSliderValue: wrap(setParamSliderValue),
        addDisplayKey: wrap((paramId: DisplayParamId, frame?: number) => {
            const paramResult = requireParam(paramId);
            if (!paramResult.ok) {
                return paramResult;
            }
            events.fire('displayTrack.setActiveParam', paramId);
            events.fire('displayTrack.addKey', paramId, Number.isFinite(frame) ? clampFrame(frame) : currentFrame());
            return getState();
        }),
        removeDisplayKey: wrap((paramId: DisplayParamId, frame?: number) => {
            const paramResult = requireParam(paramId);
            if (!paramResult.ok) {
                return paramResult;
            }
            events.fire('displayTrack.setActiveParam', paramId);
            events.fire('displayTrack.removeKey', paramId, Number.isFinite(frame) ? clampFrame(frame) : currentFrame());
            return getState();
        }),
        clearDisplayKeys: wrap((paramId?: DisplayParamId) => {
            if (paramId !== undefined) {
                const paramResult = requireParam(paramId);
                if (!paramResult.ok) {
                    return paramResult;
                }
            }
            events.fire('displayTrack.clear', paramId);
            return getState();
        }),
        jumpDisplayKey: wrap(jumpDisplayKey)
    };

    window.__piScene = api;

    window.addEventListener('message', (event: MessageEvent) => {
        const source = event.source as Window | null;
        if (!source) {
            return;
        }

        if (isSceneDirtyQuery(event.data)) {
            const response: IsSceneDirtyResponse = {
                type: IS_SCENE_DIRTY,
                result: Boolean(events.invoke('scene.dirty'))
            };
            source.postMessage(response, event.origin);
        }
    });

    try {
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'pi-scene-ready',
                version: 'pi.scene.v0',
                moduleId: api.module.id
            }, '*');
        }
    } catch {
        // ignore cross-origin access
    }
};

export { registerIframeApi };
