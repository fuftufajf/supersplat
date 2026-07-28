import type { Splat } from './splat';

/**
 * Splat Director — frozen contract for animatable display parameters.
 *
 * This registry is the single shared interface between:
 *   - the display-animation engine (DisplayParamTrack, registered in display-track.ts), and
 *   - the Director panel UI (ui/director-panel.ts).
 *
 * Both sides depend ONLY on this file so they can be developed in parallel without
 * touching each other's code. Keep it dependency-light (type-only Splat import).
 *
 * Each parameter exposes get/set in director value space (the same space SuperSplat's
 * color panel uses for the visible numeric result). Physical slider travel may be
 * remapped separately when a parameter needs finer low-end control.
 * The setters write the splat's existing public fields, which onPreRender() already
 * reads and pushes to the gsplat material every frame — so animating a parameter needs
 * no shader changes for this first set.
 *
 * Phase 1 covers the scalar color/exposure params. Vector params (tint colour),
 * the display-mode morph (centers -> rings -> gaussian), ring geometry, and the
 * spatial reveal mask are added in later phases as additional registry entries
 * and/or shader-backed params, against this same interface.
 */

type DisplayParamId =
    | 'gaussianScale'
    | 'pulse'
    | 'pulseDepth'
    | 'pulseFrequency'
    | 'pulsePhase'
    | 'revealProgress'
    | 'revealSoftness'
    | 'transparency'
    | 'tintR'
    | 'tintG'
    | 'tintB'
    | 'saturation'
    | 'brightness'
    | 'blackPoint'
    | 'whitePoint'
    | 'temperature'
    | 'scaleX'
    | 'scaleY'
    | 'scaleZ';

type DisplayParamGroup = 'shape' | 'reveal' | 'color' | 'transform' | 'pulse';

interface DisplayParam {
    /** stable id used as the track key and in serialization */
    id: DisplayParamId;
    /** visual group shown in the Director panel */
    group: DisplayParamGroup;
    /** i18n-able label key shown in the Director panel */
    label: string;
    /** slider-space minimum */
    min: number;
    /** slider-space maximum */
    max: number;
    /** slider step */
    step: number;
    /** optional physical slider-space minimum when UI needs non-linear control travel */
    sliderMin?: number;
    /** optional physical slider-space maximum when UI needs non-linear control travel */
    sliderMax?: number;
    /** optional physical slider step when UI needs non-linear control travel */
    sliderStep?: number;
    /** numeric input precision */
    precision?: number;
    /** slider-space default (neutral) value */
    default: number;
    /** source events that should refresh this parameter's UI */
    events?: string[];
    /** map a displayed parameter value into physical slider space */
    toSlider?(value: number): number;
    /** map a physical slider position back into displayed parameter value space */
    fromSlider?(sliderValue: number): number;
    /** read the current value from the splat, in director value space */
    get(splat: Splat): number;
    /** write a director-space value to the splat (drives onPreRender via existing public fields) */
    set(splat: Splat, value: number): void;
}

const setTintChannel = (splat: Splat, channel: 'r' | 'g' | 'b', value: number) => {
    const color = splat.tintClr.clone();
    color[channel] = value;
    splat.tintClr = color;
};

const pointEpsilon = 0.001;
const gaussianScaleFineMax = 1;
const gaussianScaleFineTravel = 0.75;
const gaussianScaleSliderMin = 0;
const gaussianScaleSliderMax = 1;
const gaussianScaleSliderStep = 0.001;
const gaussianScaleMax = 8;

const clamp = (value: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, value));
};

const gaussianScaleToSlider = (value: number) => {
    const clamped = clamp(value, 0, gaussianScaleMax);
    if (clamped <= gaussianScaleFineMax) {
        return (clamped / gaussianScaleFineMax) * gaussianScaleFineTravel;
    }

    return gaussianScaleFineTravel +
        ((clamped - gaussianScaleFineMax) / (gaussianScaleMax - gaussianScaleFineMax)) *
        (gaussianScaleSliderMax - gaussianScaleFineTravel);
};

const gaussianScaleFromSlider = (sliderValue: number) => {
    const clamped = clamp(sliderValue, gaussianScaleSliderMin, gaussianScaleSliderMax);
    if (clamped <= gaussianScaleFineTravel) {
        return (clamped / gaussianScaleFineTravel) * gaussianScaleFineMax;
    }

    return gaussianScaleFineMax +
        ((clamped - gaussianScaleFineTravel) / (gaussianScaleSliderMax - gaussianScaleFineTravel)) *
        (gaussianScaleMax - gaussianScaleFineMax);
};

const setBlackPoint = (splat: Splat, value: number) => {
    splat.blackPoint = Math.min(value, splat.whitePoint - pointEpsilon);
};

const setWhitePoint = (splat: Splat, value: number) => {
    splat.whitePoint = Math.max(value, splat.blackPoint + pointEpsilon);
};

const getScaleAxis = (splat: Splat, axis: 'x' | 'y' | 'z') => {
    return splat.entity.getLocalScale()[axis];
};

const setScaleAxis = (splat: Splat, axis: 'x' | 'y' | 'z', value: number) => {
    const scale = splat.entity.getLocalScale().clone();
    scale[axis] = value;
    splat.move(undefined, undefined, scale);
};

// The Director intentionally exposes wider-than-stock ranges. This is the
// performance surface, not the conservative correction panel.
const displayParams: DisplayParam[] = [
    {
        id: 'gaussianScale',
        group: 'shape',
        label: 'Gaussian size',
        min: 0,
        max: gaussianScaleMax,
        step: 0.01,
        sliderMin: gaussianScaleSliderMin,
        sliderMax: gaussianScaleSliderMax,
        sliderStep: gaussianScaleSliderStep,
        precision: 2,
        default: 1,
        toSlider: gaussianScaleToSlider,
        fromSlider: gaussianScaleFromSlider,
        get: splat => splat.gaussianScale,
        set: (splat, value) => {
            splat.gaussianScale = value;
        }
    },
    {
        id: 'pulse',
        group: 'pulse',
        label: 'Pulse amount',
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 0,
        get: splat => splat.pulse,
        set: (splat, value) => {
            splat.pulse = value;
        }
    },
    {
        id: 'pulseDepth',
        group: 'pulse',
        label: 'Pulse dimming',
        min: 0,
        max: 1.5,
        step: 0.01,
        precision: 2,
        default: 0.7,
        get: splat => splat.pulseDepth,
        set: (splat, value) => {
            splat.pulseDepth = value;
        }
    },
    {
        id: 'pulseFrequency',
        group: 'pulse',
        label: 'Pulse speed',
        min: 0.05,
        max: 6,
        step: 0.01,
        precision: 2,
        default: 1,
        get: splat => splat.pulseFrequency,
        set: (splat, value) => {
            splat.pulseFrequency = value;
        }
    },
    {
        id: 'pulsePhase',
        group: 'pulse',
        label: 'Pulse offset',
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 0,
        get: splat => splat.pulsePhase,
        set: (splat, value) => {
            splat.pulsePhase = value;
        }
    },
    {
        id: 'revealProgress',
        group: 'reveal',
        label: 'Reveal',
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 1,
        get: splat => splat.revealProgress,
        set: (splat, value) => {
            splat.revealProgress = value;
        }
    },
    {
        id: 'revealSoftness',
        group: 'reveal',
        label: 'Reveal soft',
        min: 0,
        max: 0.5,
        step: 0.005,
        precision: 3,
        default: 0,
        get: splat => splat.revealSoftness,
        set: (splat, value) => {
            splat.revealSoftness = value;
        }
    },
    {
        id: 'transparency',
        group: 'color',
        label: 'panel.colors.transparency',
        min: -8,
        max: 8,
        step: 0.01,
        precision: 2,
        default: 0, // ln(1)
        get: splat => Math.log(splat.transparency),
        set: (splat, value) => {
            splat.transparency = Math.exp(value);
        }
    },
    {
        id: 'tintR',
        group: 'color',
        label: 'Tint R',
        min: 0,
        max: 3,
        step: 0.01,
        precision: 2,
        default: 1,
        events: ['splat.tintClr'],
        get: splat => splat.tintClr.r,
        set: (splat, value) => {
            setTintChannel(splat, 'r', value);
        }
    },
    {
        id: 'tintG',
        group: 'color',
        label: 'Tint G',
        min: 0,
        max: 3,
        step: 0.01,
        precision: 2,
        default: 1,
        events: ['splat.tintClr'],
        get: splat => splat.tintClr.g,
        set: (splat, value) => {
            setTintChannel(splat, 'g', value);
        }
    },
    {
        id: 'tintB',
        group: 'color',
        label: 'Tint B',
        min: 0,
        max: 3,
        step: 0.01,
        precision: 2,
        default: 1,
        events: ['splat.tintClr'],
        get: splat => splat.tintClr.b,
        set: (splat, value) => {
            setTintChannel(splat, 'b', value);
        }
    },
    {
        id: 'saturation',
        group: 'color',
        label: 'panel.colors.saturation',
        min: 0,
        max: 4,
        step: 0.01,
        precision: 2,
        default: 1,
        get: splat => splat.saturation,
        set: (splat, value) => {
            splat.saturation = value;
        }
    },
    {
        id: 'brightness',
        group: 'color',
        label: 'panel.colors.brightness',
        min: -3,
        max: 3,
        step: 0.01,
        precision: 2,
        default: 0,
        get: splat => splat.brightness,
        set: (splat, value) => {
            splat.brightness = value;
        }
    },
    {
        id: 'blackPoint',
        group: 'color',
        label: 'panel.colors.black-point',
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
        default: 0,
        get: splat => splat.blackPoint,
        set: (splat, value) => {
            setBlackPoint(splat, value);
        }
    },
    {
        id: 'whitePoint',
        group: 'color',
        label: 'panel.colors.white-point',
        min: 0,
        max: 2,
        step: 0.01,
        precision: 2,
        default: 1,
        get: splat => splat.whitePoint,
        set: (splat, value) => {
            setWhitePoint(splat, value);
        }
    },
    {
        id: 'temperature',
        group: 'color',
        label: 'panel.colors.temperature',
        min: -1,
        max: 1,
        step: 0.005,
        precision: 3,
        default: 0,
        get: splat => splat.temperature,
        set: (splat, value) => {
            splat.temperature = value;
        }
    },
    {
        id: 'scaleX',
        group: 'transform',
        label: 'Scale X',
        min: 0.01,
        max: 20,
        step: 0.01,
        precision: 2,
        default: 1,
        events: ['splat.moved'],
        get: splat => getScaleAxis(splat, 'x'),
        set: (splat, value) => {
            setScaleAxis(splat, 'x', value);
        }
    },
    {
        id: 'scaleY',
        group: 'transform',
        label: 'Scale Y',
        min: 0.01,
        max: 20,
        step: 0.01,
        precision: 2,
        default: 1,
        events: ['splat.moved'],
        get: splat => getScaleAxis(splat, 'y'),
        set: (splat, value) => {
            setScaleAxis(splat, 'y', value);
        }
    },
    {
        id: 'scaleZ',
        group: 'transform',
        label: 'Scale Z',
        min: 0.01,
        max: 20,
        step: 0.01,
        precision: 2,
        default: 1,
        events: ['splat.moved'],
        get: splat => getScaleAxis(splat, 'z'),
        set: (splat, value) => {
            setScaleAxis(splat, 'z', value);
        }
    }
];

const getDisplayParam = (id: DisplayParamId): DisplayParam | undefined => {
    return displayParams.find(p => p.id === id);
};

export { DisplayParam, DisplayParamGroup, DisplayParamId, displayParams, getDisplayParam };
