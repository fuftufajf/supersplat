/**
 * Splat Director — the registry of animatable display parameters.
 *
 * One shared contract between the keyframe engine (display-track.ts), the
 * renderer (projected-splat-renderer.ts reads `display` values into projector
 * uniforms), the native Director panel and the external board bridge.
 *
 * SuperSplat 3 bakes colour grades into a per-gaussian palette, so nothing here
 * writes committed splat data: shader-backed params live in the target's
 * `display` values and are applied live every frame, on top of the palette.
 * Transform and visibility params drive the layer entity directly.
 *
 * Keep this file free of runtime imports: the contract test compiles it alone.
 */

type DisplayParamId =
    | 'gaussianScale'
    | 'detailCull'
    | 'pointCloud'
    | 'pointSize'
    | 'revealProgress'
    | 'revealSoftness'
    | 'pulse'
    | 'pulseDepth'
    | 'pulseFrequency'
    | 'pulsePhase'
    | 'transparency'
    | 'tintR'
    | 'tintG'
    | 'tintB'
    | 'saturation'
    | 'brightness'
    | 'blackPoint'
    | 'whitePoint'
    | 'temperature'
    | 'positionX'
    | 'positionY'
    | 'positionZ'
    | 'rotationX'
    | 'rotationY'
    | 'rotationZ'
    | 'scaleX'
    | 'scaleY'
    | 'scaleZ'
    | 'visible'
    | 'exposure';

type DisplayParamGroup = 'shape' | 'reveal' | 'pulse' | 'color' | 'transform' | 'visibility' | 'scene';

// 'layer' params belong to one splat layer, 'scene' params to the whole view
type DisplayParamScope = 'layer' | 'scene';

type DisplayValues = Partial<Record<DisplayParamId, number>>;

type DisplayKeyframe = { frame: number, value: number };

type DisplayTrackSet = Partial<Record<DisplayParamId, DisplayKeyframe[]>>;

// what a parameter reads and writes. Layers add the entity-backed members.
interface DisplayTarget {
    display: DisplayValues;
    displayTracks: DisplayTrackSet;
    scene?: { forceRender: boolean };
}

type Vec3Like = { x: number, y: number, z: number };

interface LayerTarget extends DisplayTarget {
    visible: boolean;
    authoredEuler?: Vec3Like & { qx: number, qy: number, qz: number, qw: number };
    entity: {
        getLocalPosition(): Vec3Like;
        getLocalEulerAngles(): Vec3Like;
        getLocalRotation(): Vec3Like & { w: number };
        getLocalScale(): Vec3Like;
        setLocalPosition(x: number, y: number, z: number): void;
        setLocalEulerAngles(x: number, y: number, z: number): void;
        setLocalScale(x: number, y: number, z: number): void;
    };
    // with no arguments: refresh the world bound and announce the move
    move(): void;
}

interface DisplayParam {
    id: DisplayParamId;
    group: DisplayParamGroup;
    scope: DisplayParamScope;
    label: string;
    min: number;
    max: number;
    step: number;
    precision?: number;
    default: number;
    // 'step' holds each key's value until the next key (cuts, visibility)
    interpolation?: 'linear' | 'step';
    experimental?: boolean;
    sliderMin?: number;
    sliderMax?: number;
    sliderStep?: number;
    toSlider?(value: number): number;
    fromSlider?(sliderValue: number): number;
    events?: string[];
    get(target: DisplayTarget): number;
    set(target: DisplayTarget, value: number): void;
    // restore a previously valid snapshot without re-normalizing coupled values
    restore?(target: DisplayTarget, value: number): void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const valueParam = (id: DisplayParamId, fallback: number) => ({
    get: (target: DisplayTarget) => target.display[id] ?? fallback,
    set: (target: DisplayTarget, value: number) => {
        target.display[id] = value;
    }
});

// gaussian size: 75% of the slider travel covers the fine 0..1 range
const gaussianScaleMax = 8;
const fineTravel = 0.75;
const gaussianScaleToSlider = (value: number) => {
    const v = clamp(value, 0, gaussianScaleMax);
    return v <= 1 ? v * fineTravel : fineTravel + ((v - 1) / (gaussianScaleMax - 1)) * (1 - fineTravel);
};
const gaussianScaleFromSlider = (slider: number) => {
    const s = clamp(slider, 0, 1);
    return s <= fineTravel ? s / fineTravel : 1 + ((s - fineTravel) / (1 - fineTravel)) * (gaussianScaleMax - 1);
};

const pointEpsilon = 0.001;

type Axis = 'x' | 'y' | 'z';

// Euler angles read back from a quaternion are canonicalized (Y 200 comes back
// as X 180, Y -20, Z 180), which would make keyed turns jump. The authored angles
// are kept beside the rotation they produced and trusted while it is unchanged;
// a gizmo rotation invalidates them.
const authoredEuler = (layer: LayerTarget) => {
    const q = layer.entity.getLocalRotation();
    const cache = layer.authoredEuler;
    if (cache && Math.abs(cache.qx - q.x) + Math.abs(cache.qy - q.y) + Math.abs(cache.qz - q.z) + Math.abs(cache.qw - q.w) < 1e-6) {
        return cache;
    }
    const e = layer.entity.getLocalEulerAngles();
    return { x: e.x, y: e.y, z: e.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
};

const axisParam = (kind: 'position' | 'rotation' | 'scale', axis: Axis) => {
    const read = (target: DisplayTarget) => {
        const layer = target as LayerTarget;
        return kind === 'position' ? layer.entity.getLocalPosition() :
            kind === 'rotation' ? authoredEuler(layer) : layer.entity.getLocalScale();
    };
    return {
        events: ['splat.moved'],
        get: (target: DisplayTarget) => read(target)[axis],
        set: (target: DisplayTarget, value: number) => {
            const layer = target as LayerTarget;
            const { entity } = layer;
            const current = read(target);
            if (current[axis] === value) return;
            const v = { x: current.x, y: current.y, z: current.z };
            v[axis] = value;
            if (kind === 'position') {
                entity.setLocalPosition(v.x, v.y, v.z);
            } else if (kind === 'rotation') {
                // ponytail: per-axis euler keys interpolate each angle linearly;
                // fine for turntables and tilts, gimbal flips need quaternion keys
                entity.setLocalEulerAngles(v.x, v.y, v.z);
                const q = entity.getLocalRotation();
                layer.authoredEuler = { ...v, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
            } else {
                entity.setLocalScale(v.x, v.y, v.z);
            }
            layer.move();
        }
    };
};

const axisLabel = { x: 'X', y: 'Y', z: 'Z' };

const transformParams = (['position', 'rotation', 'scale'] as const).flatMap(kind => (['x', 'y', 'z'] as const).map((axis): DisplayParam => ({
    id: `${kind}${axisLabel[axis]}` as DisplayParamId,
    group: 'transform',
    scope: 'layer',
    label: `${kind[0].toUpperCase()}${kind.slice(1)} ${axisLabel[axis]}`,
    min: kind === 'position' ? -100000 : kind === 'rotation' ? -3600 : 0.01,
    max: kind === 'position' ? 100000 : kind === 'rotation' ? 3600 : 20,
    step: kind === 'rotation' ? 0.1 : 0.01,
    precision: 2,
    default: kind === 'scale' ? 1 : 0,
    ...axisParam(kind, axis)
})));

// The Director intentionally exposes wider-than-stock ranges: this is the
// performance surface, not the conservative correction panel.
const displayParams: DisplayParam[] = [
    {
        id: 'gaussianScale',
        group: 'shape',
        scope: 'layer',
        label: 'Gaussian size',
        min: 0,
        max: gaussianScaleMax,
        step: 0.01,
        precision: 2,
        default: 1,
        sliderMin: 0,
        sliderMax: 1,
        sliderStep: 0.001,
        toSlider: gaussianScaleToSlider,
        fromSlider: gaussianScaleFromSlider,
        ...valueParam('gaussianScale', 1)
    },
    {
        // splats smaller than this many pixels are dropped: animate down to reveal detail
        id: 'detailCull',
        group: 'shape',
        scope: 'layer',
        label: 'Detail cull px',
        min: 0,
        max: 64,
        step: 0.1,
        precision: 1,
        default: 0,
        ...valueParam('detailCull', 0)
    },
    {
        // 0 = gaussians, 1 = opaque point cloud of pointSize px discs
        id: 'pointCloud',
        group: 'shape',
        scope: 'layer',
        label: 'Point cloud',
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 0,
        ...valueParam('pointCloud', 0)
    },
    {
        id: 'pointSize',
        group: 'shape',
        scope: 'layer',
        label: 'Point size px',
        min: 0.5,
        max: 16,
        step: 0.1,
        precision: 1,
        default: 2,
        ...valueParam('pointSize', 2)
    },
    {
        id: 'revealProgress',
        group: 'reveal',
        scope: 'layer',
        label: 'Reveal',
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 1,
        ...valueParam('revealProgress', 1)
    },
    {
        id: 'revealSoftness',
        group: 'reveal',
        scope: 'layer',
        label: 'Reveal soft',
        min: 0,
        max: 0.5,
        step: 0.005,
        precision: 3,
        default: 0,
        ...valueParam('revealSoftness', 0)
    },
    {
        id: 'pulse',
        group: 'pulse',
        scope: 'layer',
        label: 'Pulse amount',
        experimental: true,
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 0,
        ...valueParam('pulse', 0)
    },
    {
        id: 'pulseDepth',
        group: 'pulse',
        scope: 'layer',
        label: 'Pulse dimming',
        experimental: true,
        min: 0,
        max: 1.5,
        step: 0.01,
        precision: 2,
        default: 0.7,
        ...valueParam('pulseDepth', 0.7)
    },
    {
        id: 'pulseFrequency',
        group: 'pulse',
        scope: 'layer',
        label: 'Pulse speed',
        experimental: true,
        min: 0.05,
        max: 6,
        step: 0.01,
        precision: 2,
        default: 1,
        ...valueParam('pulseFrequency', 1)
    },
    {
        id: 'pulsePhase',
        group: 'pulse',
        scope: 'layer',
        label: 'Pulse offset',
        experimental: true,
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 0,
        ...valueParam('pulsePhase', 0)
    },
    {
        // log space: the grade multiplies alpha by exp(value)
        id: 'transparency',
        group: 'color',
        scope: 'layer',
        label: 'panel.colors.transparency',
        min: -8,
        max: 8,
        step: 0.01,
        precision: 2,
        default: 0,
        ...valueParam('transparency', 0)
    },
    ...(['R', 'G', 'B'] as const).map((c): DisplayParam => ({
        id: `tint${c}` as DisplayParamId,
        group: 'color',
        scope: 'layer',
        label: `Tint ${c}`,
        min: 0,
        max: 3,
        step: 0.01,
        precision: 2,
        default: 1,
        ...valueParam(`tint${c}` as DisplayParamId, 1)
    })),
    {
        id: 'saturation',
        group: 'color',
        scope: 'layer',
        label: 'panel.colors.saturation',
        min: 0,
        max: 4,
        step: 0.01,
        precision: 2,
        default: 1,
        ...valueParam('saturation', 1)
    },
    {
        id: 'brightness',
        group: 'color',
        scope: 'layer',
        label: 'panel.colors.brightness',
        min: -3,
        max: 3,
        step: 0.01,
        precision: 2,
        default: 0,
        ...valueParam('brightness', 0)
    },
    {
        id: 'blackPoint',
        group: 'color',
        scope: 'layer',
        label: 'panel.colors.black-point',
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 0,
        get: target => target.display.blackPoint ?? 0,
        set: (target, value) => {
            target.display.blackPoint = Math.min(value, (target.display.whitePoint ?? 1) - pointEpsilon);
        },
        restore: (target, value) => {
            target.display.blackPoint = value;
        }
    },
    {
        id: 'whitePoint',
        group: 'color',
        scope: 'layer',
        label: 'panel.colors.white-point',
        min: 0,
        max: 2,
        step: 0.01,
        precision: 2,
        default: 1,
        get: target => target.display.whitePoint ?? 1,
        set: (target, value) => {
            target.display.whitePoint = Math.max(value, (target.display.blackPoint ?? 0) + pointEpsilon);
        },
        restore: (target, value) => {
            target.display.whitePoint = value;
        }
    },
    {
        id: 'temperature',
        group: 'color',
        scope: 'layer',
        label: 'panel.colors.temperature',
        min: -1,
        max: 1,
        step: 0.005,
        precision: 3,
        default: 0,
        ...valueParam('temperature', 0)
    },
    ...transformParams,
    {
        id: 'visible',
        group: 'visibility',
        scope: 'layer',
        label: 'Visible',
        min: 0,
        max: 1,
        step: 1,
        precision: 0,
        default: 1,
        interpolation: 'step',
        events: ['splat.visibility'],
        get: target => ((target as LayerTarget).visible ? 1 : 0),
        set: (target, value) => {
            (target as LayerTarget).visible = value >= 0.5;
        }
    },
    {
        // multiplies scene brightness before tone mapping
        id: 'exposure',
        group: 'scene',
        scope: 'scene',
        label: 'Exposure',
        min: 0,
        max: 8,
        step: 0.01,
        precision: 2,
        default: 1,
        ...valueParam('exposure', 1)
    }
];

const getDisplayParam = (id: string): DisplayParam | undefined => displayParams.find(p => p.id === id);

// live grade inputs in the shape color-grade.gradeTerms expects
const displayGradeParams = (target: DisplayTarget) => {
    const d = target.display;
    return {
        tintClr: { r: d.tintR ?? 1, g: d.tintG ?? 1, b: d.tintB ?? 1 },
        temperature: d.temperature ?? 0,
        saturation: d.saturation ?? 1,
        brightness: d.brightness ?? 0,
        blackPoint: d.blackPoint ?? 0,
        whitePoint: Math.max(d.whitePoint ?? 1, (d.blackPoint ?? 0) + pointEpsilon),
        transparency: Math.exp(d.transparency ?? 0)
    };
};

const gradeIds: DisplayParamId[] = ['transparency', 'tintR', 'tintG', 'tintB', 'saturation', 'brightness', 'blackPoint', 'whitePoint', 'temperature'];

// whether the live grade differs from identity (lets the shader skip it)
const hasDisplayGrade = (target: DisplayTarget) => gradeIds.some(id => (target.display[id] ?? getDisplayParam(id).default) !== getDisplayParam(id).default);

// sampled value of a keyframe list; undefined when the list is empty
const sampleKeyframes = (keys: readonly DisplayKeyframe[] | undefined, frame: number, interpolation: 'linear' | 'step' = 'linear') => {
    if (!keys || keys.length === 0) return undefined;
    if (frame <= keys[0].frame) return keys[0].value;
    const last = keys[keys.length - 1];
    if (frame >= last.frame) return last.value;
    for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i];
        const b = keys[i + 1];
        if (frame >= a.frame && frame < b.frame) {
            if (interpolation === 'step') return a.value;
            return a.value + (b.value - a.value) * (frame - a.frame) / (b.frame - a.frame);
        }
    }
    return last.value;
};

// normalize a stored keyframe list: integer frames, clamped values, sorted, unique
const normalizeKeyframes = (param: DisplayParam, keys: unknown): DisplayKeyframe[] => {
    const byFrame = new Map<number, DisplayKeyframe>();
    (Array.isArray(keys) ? keys : []).forEach((key: any) => {
        const frame = Math.round(Number(key?.frame));
        const value = Number(key?.value);
        if (Number.isFinite(frame) && Number.isFinite(value)) {
            byFrame.set(frame, { frame, value: clamp(value, param.min, param.max) });
        }
    });
    return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
};

class SetDisplayParamOp {
    name = 'setDisplayParam';
    target: DisplayTarget;
    param: DisplayParam;
    oldValue: number;
    newValue: number;

    constructor(options: { target: DisplayTarget, param: DisplayParam, oldValue: number, newValue: number }) {
        this.target = options.target;
        this.param = options.param;
        this.oldValue = options.oldValue;
        this.newValue = options.newValue;
    }

    private apply(value: number, restore: boolean) {
        (restore && this.param.restore ? this.param.restore : this.param.set)(this.target, value);
        if (this.target.scene) this.target.scene.forceRender = true;
    }

    do() {
        this.apply(this.newValue, false);
    }

    undo() {
        this.apply(this.oldValue, true);
    }
}

// set a value now; returns the undo op, or null when nothing changed
const applyDisplayParamValue = (target: DisplayTarget, param: DisplayParam, value: number) => {
    const oldValue = param.get(target);
    param.set(target, clamp(value, param.min, param.max));
    const newValue = param.get(target);
    if (Object.is(oldValue, newValue)) {
        return null;
    }
    if (target.scene) target.scene.forceRender = true;
    return new SetDisplayParamOp({ target, param, oldValue, newValue });
};

// board state import: accepts getState's `params` list and the older `values` map
const displayParamValuesFromState = (display: any): Array<[DisplayParamId, unknown]> => {
    if (display?.values && typeof display.values === 'object') {
        return Object.entries(display.values) as Array<[DisplayParamId, unknown]>;
    }
    if (Array.isArray(display?.params)) {
        return display.params
        .filter((item: any) => item && item.disabled !== true && typeof item.id === 'string' && Object.hasOwn(item, 'value'))
        .map((item: any) => [item.id as DisplayParamId, item.value]);
    }
    return [];
};

export {
    SetDisplayParamOp,
    applyDisplayParamValue,
    displayGradeParams,
    displayParamValuesFromState,
    displayParams,
    getDisplayParam,
    hasDisplayGrade,
    normalizeKeyframes,
    sampleKeyframes
};
export type {
    DisplayKeyframe,
    DisplayParam,
    DisplayParamGroup,
    DisplayParamId,
    DisplayParamScope,
    DisplayTarget,
    DisplayTrackSet,
    DisplayValues,
    LayerTarget
};
