import { readFileSync } from 'node:fs';

import {
    SetDisplayParamOp,
    SetSplatVisibilityOp,
    applyDisplayParamValue,
    displayParamValuesFromState,
    getDisplayParam
} from '../src/display-params';

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const splat = {
    value: 1,
    scene: {
        forceRender: false
    }
} as any;

const param = {
    id: 'brightness',
    get: (target: typeof splat) => target.value,
    set: (target: typeof splat, value: number) => {
        target.value = value;
    }
} as any;

const op = new SetDisplayParamOp({
    splat,
    param,
    oldValue: 1,
    newValue: 2
});

op.do();
assertEqual(splat.value, 2, 'redo applies the new display value');
assertEqual(splat.scene.forceRender, true, 'redo requests a render');

splat.scene.forceRender = false;
op.undo();
assertEqual(splat.value, 1, 'undo restores the old display value');
assertEqual(splat.scene.forceRender, true, 'undo requests a render');

const visibleSplat = {
    visible: true,
    scene: {
        forceRender: false
    }
} as any;
const visibilityOp = new SetSplatVisibilityOp(visibleSplat, true, false);
visibilityOp.do();
assertEqual(visibleSplat.visible, false, 'redo applies splat visibility');
visibilityOp.undo();
assertEqual(visibleSplat.visible, true, 'undo restores splat visibility');

const coupledPoints = { blackPoint: 0.5, whitePoint: 0.5 } as any;
const blackPoint = getDisplayParam('blackPoint');
if (!blackPoint) {
    throw new Error('blackPoint parameter is missing');
}
assertEqual(applyDisplayParamValue(coupledPoints, blackPoint, 0.5), null, 'equal value is a no-op');
assertEqual(coupledPoints.blackPoint, 0.5, 'no-op does not normalize an equal black point');
assertEqual(coupledPoints.whitePoint, 0.5, 'no-op does not alter the coupled white point');

const editedBlackPoints = {
    blackPoint: 0.5,
    whitePoint: 0.5,
    scene: { forceRender: false }
} as any;
const blackPointOp = applyDisplayParamValue(editedBlackPoints, blackPoint, 0.4);
if (!blackPointOp) {
    throw new Error('blackPoint edit did not create an operation');
}
blackPointOp.undo();
assertEqual(editedBlackPoints.blackPoint, 0.5, 'blackPoint undo restores an equal coupled value exactly');
assertEqual(editedBlackPoints.whitePoint, 0.5, 'blackPoint undo preserves the coupled white point');

const whitePoint = getDisplayParam('whitePoint');
if (!whitePoint) {
    throw new Error('whitePoint parameter is missing');
}
const editedWhitePoints = {
    blackPoint: 0.5,
    whitePoint: 0.5,
    scene: { forceRender: false }
} as any;
const whitePointOp = applyDisplayParamValue(editedWhitePoints, whitePoint, 0.6);
if (!whitePointOp) {
    throw new Error('whitePoint edit did not create an operation');
}
whitePointOp.undo();
assertEqual(editedWhitePoints.blackPoint, 0.5, 'whitePoint undo preserves the coupled black point');
assertEqual(editedWhitePoints.whitePoint, 0.5, 'whitePoint undo restores an equal coupled value exactly');

const directorPanelSource = readFileSync('src/ui/director-panel.ts', 'utf8');
const slideStartBegin = directorPanelSource.indexOf('_onSlideStart(pageX: number)');
const slideStartEnd = directorPanelSource.indexOf('_onSlideEnd(pageX: number)', slideStartBegin);
const slideStartBody = directorPanelSource.slice(slideStartBegin, slideStartEnd);
assertEqual(slideStartBegin >= 0 && slideStartEnd > slideStartBegin, true, 'Director slider overrides slide start');
assertEqual(
    slideStartBody.indexOf("this.emit('slide:start')") < slideStartBody.indexOf('super._onSlideStart(pageX)'),
    true,
    'Director slide transaction starts before the base slider mutates its value'
);
const slideEndBody = directorPanelSource.slice(
    slideStartEnd,
    directorPanelSource.indexOf("slider.on('change'", slideStartEnd)
);
assertEqual(
    slideEndBody.includes('!state.updateKeyOnEnd'),
    true,
    'a keyed drag leaves history ownership to the display track operation'
);
const sliderChangeBody = directorPanelSource.slice(
    directorPanelSource.indexOf("slider.on('change'"),
    directorPanelSource.indexOf("keyButton.on('click'", slideStartEnd)
);
assertEqual(
    sliderChangeBody.includes('const updateCurrentKey = !state.dragging && hasKeyAtCurrentFrame(param.id)'),
    true,
    'a keyed numeric change chooses track history before recording a standalone parameter edit'
);
assertEqual(
    sliderChangeBody.includes('const target = state.dragging ? state.dragSplat : selected'),
    true,
    'drag changes remain bound to the splat captured at slide start'
);
assertEqual(
    slideEndBody.includes('const selectionMatchesDrag = selected === state.dragSplat'),
    true,
    'a keyed drag checks that selection still matches before updating its track'
);

const displayTrackSource = readFileSync('src/display-track.ts', 'utf8');
const restoreBegin = displayTrackSource.indexOf('restore(snapshot: DisplayTrackSnapshot = {})');
const restoreParamBegin = displayTrackSource.indexOf('restoreParam(', restoreBegin);
const restoreBody = displayTrackSource.slice(restoreBegin, restoreParamBegin);
assertEqual(
    restoreBody.includes('this.applyFrame(this.events.invoke(\'timeline.frame\') ?? 0, true)'),
    true,
    'display track history restores the exact keyed snapshot value'
);
const applyFrameBegin = displayTrackSource.indexOf('private applyFrame(');
const applyFrameBody = displayTrackSource.slice(applyFrameBegin, displayTrackSource.indexOf('\n    }\n}', applyFrameBegin));
assertEqual(
    applyFrameBody.includes('restore && param.restore'),
    true,
    'exact track restoration uses the parameter restore path when available'
);

const exportedValues = displayParamValuesFromState({
    params: [
        { id: 'brightness', value: 1.5 },
        { id: 'pulse', value: 0.25 }
    ]
});
assertEqual(exportedValues.length, 2, 'getState display.params are accepted');
assertEqual(exportedValues[0][0], 'brightness', 'first exported parameter id is retained');
assertEqual(exportedValues[0][1], 1.5, 'first exported parameter value is retained');

const disabledValues = displayParamValuesFromState({
    params: [
        { id: 'brightness', value: 0, disabled: true }
    ]
});
assertEqual(disabledValues.length, 0, 'disabled parameters from an empty export are ignored');

const legacyValues = displayParamValuesFromState({
    values: {
        brightness: 2,
        pulse: 0.5
    }
});
assertEqual(legacyValues.length, 2, 'legacy display.values remain accepted');
