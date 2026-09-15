import {
    applyDisplayParamValue,
    displayGradeParams,
    displayParamValuesFromState,
    displayParams,
    getDisplayParam,
    hasDisplayGrade,
    normalizeKeyframes,
    sampleKeyframes
} from '../src/display-params';

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const target = () => ({ display: {} as any, displayTracks: {}, scene: { forceRender: false } });

// ids are unique and every default sits inside its range
assertEqual(new Set(displayParams.map(p => p.id)).size, displayParams.length, 'param ids are unique');
displayParams.forEach((p) => {
    assertEqual(p.default >= p.min && p.default <= p.max, true, `${p.id} default within range`);
});

// value edits are undoable and restore exactly
const t = target();
const brightness = getDisplayParam('brightness');
const op = applyDisplayParamValue(t, brightness, 2);
assertEqual(t.display.brightness, 2, 'edit applies the value');
assertEqual(t.scene.forceRender, true, 'edit requests a render');
op.undo();
assertEqual(t.display.brightness, 0, 'undo restores the default');
op.do();
assertEqual(t.display.brightness, 2, 'redo re-applies');
assertEqual(applyDisplayParamValue(t, brightness, 2), null, 'equal value is a no-op');
applyDisplayParamValue(t, brightness, 99);
assertEqual(t.display.brightness, brightness.max, 'values clamp to the range');

// black and white point never cross, and undo restores the coupled pair exactly
const points = target();
const black = getDisplayParam('blackPoint');
const white = getDisplayParam('whitePoint');
applyDisplayParamValue(points, white, 0.5);
const blackOp = applyDisplayParamValue(points, black, 0.9);
assertEqual(points.display.blackPoint < points.display.whitePoint, true, 'black point stays below white point');
blackOp.undo();
assertEqual(points.display.blackPoint, 0, 'black point undo restores exactly');

// the live grade is identity until something moves off its default
const grade = target();
assertEqual(hasDisplayGrade(grade), false, 'default display has no grade');
applyDisplayParamValue(grade, getDisplayParam('transparency'), -1);
assertEqual(hasDisplayGrade(grade), true, 'transparency enables the grade');
assertEqual(Math.abs(displayGradeParams(grade).transparency - Math.exp(-1)) < 1e-12, true, 'transparency is log space');

// keyframe sampling: linear between keys, held outside, step for cuts
const keys = normalizeKeyframes(getDisplayParam('revealProgress'), [{ frame: 60, value: 1 }, { frame: 0, value: 0 }, { frame: 'x', value: 1 }]);
assertEqual(keys.length, 2, 'invalid keys are dropped');
assertEqual(sampleKeyframes(keys, 30), 0.5, 'linear midpoint');
assertEqual(sampleKeyframes(keys, -5), 0, 'held before the first key');
assertEqual(sampleKeyframes(keys, 99), 1, 'held after the last key');
assertEqual(sampleKeyframes(keys, 59.9, 'step'), 0, 'step holds the previous key');
assertEqual(sampleKeyframes([], 10), undefined, 'empty track samples nothing');
assertEqual(normalizeKeyframes(getDisplayParam('visible'), [{ frame: 1.4, value: 5 }])[0].value, 1, 'stored keys clamp and round');

// board state import formats
const exported = displayParamValuesFromState({ params: [{ id: 'brightness', value: 1.5 }, { id: 'pulse', value: 0, disabled: true }] });
assertEqual(exported.length, 1, 'disabled params are ignored');
assertEqual(displayParamValuesFromState({ values: { brightness: 2 } })[0][1], 2, 'values map is accepted');

console.log('display-param contract ok');
