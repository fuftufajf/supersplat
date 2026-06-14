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
 * Each parameter exposes get/set in UI-slider space (the same space SuperSplat's
 * color panel uses), so keyframe values interpolate the way the operator sees them.
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
    | 'revealProgress'
    | 'transparency'
    | 'saturation'
    | 'brightness'
    | 'blackPoint'
    | 'whitePoint'
    | 'temperature';

interface DisplayParam {
    /** stable id used as the track key and in serialization */
    id: DisplayParamId;
    /** i18n-able label key shown in the Director panel */
    label: string;
    /** slider-space minimum */
    min: number;
    /** slider-space maximum */
    max: number;
    /** slider step */
    step: number;
    /** slider-space default (neutral) value */
    default: number;
    /** read the current value from the splat, in slider space */
    get(splat: Splat): number;
    /** write a slider-space value to the splat (drives onPreRender via existing public fields) */
    set(splat: Splat, value: number): void;
}

// Ranges mirror src/ui/color-panel.ts exactly so the Director panel and the
// stock color panel agree. transparency is stored as a multiplier but edited in
// log space (slider = ln(transparency)); all others are identity.
const displayParams: DisplayParam[] = [
    {
        id: 'revealProgress',
        label: 'Reveal',
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        get: splat => splat.revealProgress,
        set: (splat, value) => {
            splat.revealProgress = value;
        }
    },
    {
        id: 'transparency',
        label: 'panel.colors.transparency',
        min: -6,
        max: 6,
        step: 0.01,
        default: 0, // ln(1)
        get: splat => Math.log(splat.transparency),
        set: (splat, value) => {
            splat.transparency = Math.exp(value);
        }
    },
    {
        id: 'saturation',
        label: 'panel.colors.saturation',
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        get: splat => splat.saturation,
        set: (splat, value) => {
            splat.saturation = value;
        }
    },
    {
        id: 'brightness',
        label: 'panel.colors.brightness',
        min: -1,
        max: 1,
        step: 0.1,
        default: 0,
        get: splat => splat.brightness,
        set: (splat, value) => {
            splat.brightness = value;
        }
    },
    {
        id: 'blackPoint',
        label: 'panel.colors.black-point',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0,
        get: splat => splat.blackPoint,
        set: (splat, value) => {
            splat.blackPoint = value;
        }
    },
    {
        id: 'whitePoint',
        label: 'panel.colors.white-point',
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        get: splat => splat.whitePoint,
        set: (splat, value) => {
            splat.whitePoint = value;
        }
    },
    {
        id: 'temperature',
        label: 'panel.colors.temperature',
        min: -0.5,
        max: 0.5,
        step: 0.005,
        default: 0,
        get: splat => splat.temperature,
        set: (splat, value) => {
            splat.temperature = value;
        }
    }
];

const getDisplayParam = (id: DisplayParamId): DisplayParam | undefined => {
    return displayParams.find(p => p.id === id);
};

export { DisplayParam, DisplayParamId, displayParams, getDisplayParam };
