import { Button, Container, Label, SliderInput } from '@playcanvas/pcui';

import { SetDisplayParamOp, applyDisplayParamValue, displayParams, type DisplayParam, type DisplayParamGroup } from '../display-params';
import { Events } from '../events';
import { Splat } from '../splat';
import { localize } from './localization';
import { Tooltips } from './tooltips';

class DirectorSliderInput extends SliderInput {
    _onSlideStart(pageX: number) {
        this.emit('slide:start');
        super._onSlideStart(pageX);
    }

    _onSlideEnd(pageX: number) {
        super._onSlideEnd(pageX);
        this.emit('slide:end');
    }
}

type ParamRow = {
    animRow: Container;
    clearButton: Button;
    dragSplat: Splat | null;
    dragStartValue: number | null;
    dragging: boolean;
    keyButton: Button;
    keyInfo: Label;
    nextButton: Button;
    param: DisplayParam;
    prevButton: Button;
    row: Container;
    slider: DirectorSliderInput;
    trackButton: Button;
    updateKeyOnEnd: boolean;
};

const groupLabels: Record<DisplayParamGroup, string> = {
    shape: 'Shape',
    reveal: 'Reveal',
    color: 'Color',
    transform: 'Transform',
    pulse: 'Pulse'
};

class DirectorPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'director-panel',
            class: 'panel',
            flex: true,
            flexDirection: 'column',
            hidden: true
        };

        super(args);

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = new Container({
            class: ['panel-header', 'director-panel-header']
        });

        const icon = new Label({
            class: 'panel-header-icon',
            text: '\u25C6'
        });

        const label = new Label({
            class: 'panel-header-label',
            text: 'Director'
        });

        const frameLabel = new Label({
            class: 'director-frame-label',
            text: 'F0'
        });

        const collapseButton = new Button({
            text: '<'
        });
        collapseButton.dom.classList.add('panel-header-button', 'director-header-action');

        const clearButton = new Button({
            text: 'Keys'
        });
        clearButton.dom.classList.add('panel-header-button', 'director-header-action');

        header.append(icon);
        header.append(label);
        header.append(frameLabel);
        header.append(clearButton);
        header.append(collapseButton);

        const body = new Container({
            class: 'director-panel-body',
            flex: true,
            flexDirection: 'column'
        });

        this.append(header);
        this.append(body);

        let collapsed = false;
        let selected: Splat | null = null;
        let suppress = false;
        let activeParamId = (events.invoke('displayTrack.activeParam') as DisplayParam['id'] | null) ?? null;

        const displayLabel = (text: string) => {
            return text.startsWith('panel.') ? localize(text) : text;
        };

        const hasEventFunction = (name: string) => {
            return events.functions.has(name);
        };

        const invokeOrDefault = <T>(name: string, fallback: T): T => {
            return hasEventFunction(name) ? (events.invoke(name) as T) : fallback;
        };

        const currentFrame = () => {
            return Math.round(events.invoke('timeline.frame') ?? 0);
        };

        const getParamKeys = (paramId: DisplayParam['id']) => {
            if (!hasEventFunction('displayTrack.keys')) {
                return [];
            }
            return (events.invoke('displayTrack.keys', paramId) as number[] ?? []);
        };

        const hasKeyAtCurrentFrame = (paramId: DisplayParam['id']) => {
            return getParamKeys(paramId).includes(currentFrame());
        };

        const getAdjacentKey = (paramId: DisplayParam['id'], direction: -1 | 1) => {
            const keys = getParamKeys(paramId);
            const frame = currentFrame();
            if (direction < 0) {
                for (let i = keys.length - 1; i >= 0; i--) {
                    if (keys[i] < frame) {
                        return keys[i];
                    }
                }
            } else {
                for (let i = 0; i < keys.length; i++) {
                    if (keys[i] > frame) {
                        return keys[i];
                    }
                }
            }
            return null;
        };

        const createSection = (title: string) => {
            const section = new Container({
                class: 'director-section'
            });
            const sectionLabel = new Label({
                class: 'director-section-label',
                text: title
            });
            section.append(sectionLabel);
            body.append(section);
            return section;
        };

        const createViewControls = () => {
            const section = createSection('View');

            const modeRow = new Container({
                class: ['director-row', 'director-mode-row']
            });

            const modeLabel = new Label({
                class: 'director-row-label',
                text: 'Display'
            });

            const modeButtons = new Container({
                class: 'director-mode-buttons'
            });

            const pointsButton = new Button({
                text: 'Points'
            });
            pointsButton.dom.classList.add('director-mode-button');

            const ringsButton = new Button({
                text: 'Rings'
            });
            ringsButton.dom.classList.add('director-mode-button');

            modeButtons.append(pointsButton);
            modeButtons.append(ringsButton);
            modeRow.append(modeLabel);
            modeRow.append(modeButtons);
            section.append(modeRow);

            const pointSizeRow = new Container({
                class: 'director-row'
            });

            const pointSizeLabel = new Label({
                class: 'director-row-label',
                text: 'Point size'
            });

            const pointSizeSlider = new DirectorSliderInput({
                class: ['director-slider', 'director-view-slider'],
                min: 0,
                max: 40,
                step: 0.1,
                precision: 1,
                value: invokeOrDefault('camera.splatSize', 2)
            });

            pointSizeRow.append(pointSizeLabel);
            pointSizeRow.append(pointSizeSlider);
            section.append(pointSizeRow);

            const updateModeButtons = () => {
                const mode = invokeOrDefault<string>('camera.mode', 'centers');
                pointsButton.dom.classList[mode === 'centers' ? 'add' : 'remove']('active');
                ringsButton.dom.classList[mode === 'rings' ? 'add' : 'remove']('active');
            };

            pointsButton.on('click', () => {
                events.fire('camera.setOverlay', true);
                events.fire('camera.setMode', 'centers');
            });

            ringsButton.on('click', () => {
                events.fire('camera.setOverlay', true);
                events.fire('camera.setMode', 'rings');
            });

            pointSizeSlider.on('change', (value: number) => {
                events.fire('camera.setSplatSize', value);
                events.fire('camera.setOverlay', true);
                events.fire('camera.setMode', 'centers');
            });

            events.on('camera.mode', updateModeButtons);
            events.on('camera.splatSize', (value: number) => {
                pointSizeSlider.value = value;
            });

            updateModeButtons();
        };

        createViewControls();

        let rows: ParamRow[] = [];

        const setEnabled = () => {
            const enabled = !!selected;
            rows.forEach((row) => {
                row.slider.enabled = enabled;
                row.keyButton.enabled = enabled;
                row.trackButton.enabled = enabled;
                row.prevButton.enabled = enabled;
                row.nextButton.enabled = enabled;
                row.clearButton.enabled = enabled;
            });
        };

        const refreshKeyButtons = () => {
            rows.forEach((row) => {
                const keyed = !!selected && hasKeyAtCurrentFrame(row.param.id);
                row.keyButton.text = keyed ? '\u25C6' : '\u25C7';
                row.keyButton.dom.style.color = keyed ? '#ff9900' : '#8a8a8a';
            });
        };

        const refreshTrackControls = () => {
            rows.forEach((row) => {
                const keys = getParamKeys(row.param.id);
                const hasSelection = !!selected;
                const prevKey = hasSelection ? getAdjacentKey(row.param.id, -1) : null;
                const nextKey = hasSelection ? getAdjacentKey(row.param.id, 1) : null;
                const isActive = activeParamId === row.param.id;
                const keyCount = keys.length;

                row.prevButton.enabled = hasSelection && prevKey !== null;
                row.nextButton.enabled = hasSelection && nextKey !== null;
                row.clearButton.enabled = hasSelection && keyCount > 0;
                row.trackButton.enabled = hasSelection;
                row.trackButton.text = isActive ? 'Track*' : 'Track';
                row.trackButton.dom.classList[isActive ? 'add' : 'remove']('active');
                row.keyInfo.text = keyCount === 1 ? '1 key' : `${keyCount} keys`;
                row.row.dom.classList[isActive ? 'add' : 'remove']('active-track');
                row.animRow.dom.classList[isActive ? 'add' : 'remove']('active-track');
            });
        };

        const updateFrameLabel = () => {
            frameLabel.text = `F${currentFrame()}`;
        };

        const refreshSliderValues = () => {
            suppress = true;
            rows.forEach((row) => {
                row.slider.value = selected ? row.param.get(selected) : row.param.default;
            });
            suppress = false;
        };

        const refreshUI = () => {
            refreshSliderValues();
            setEnabled();
            refreshKeyButtons();
            refreshTrackControls();
            updateFrameLabel();
        };

        let section: Container | null = null;
        let currentGroup: DisplayParamGroup | null = null;

        rows = displayParams.map((param) => {
            if (param.group !== currentGroup) {
                currentGroup = param.group;
                section = createSection(groupLabels[param.group]);
            }

            const row = new Container({
                class: 'director-row'
            });

            const rowLabel = new Label({
                class: 'director-row-label',
                text: displayLabel(param.label)
            });

            const slider = new DirectorSliderInput({
                class: 'director-slider',
                min: param.min,
                max: param.max,
                step: param.step,
                precision: param.precision ?? 2,
                value: param.default
            });

            const keyButton = new Button({
                text: '\u25C7'
            });
            keyButton.dom.classList.add('panel-header-button', 'director-key-button');

            row.append(rowLabel);
            row.append(slider);
            row.append(keyButton);
            section.append(row);

            const animRow = new Container({
                class: 'director-anim-row'
            });

            const animSpacer = new Container();

            const animControls = new Container({
                class: 'director-anim-controls'
            });

            const trackButton = new Button({
                text: 'Track'
            });
            trackButton.dom.classList.add('director-mini-button', 'director-track-button');

            const prevButton = new Button({
                text: '<'
            });
            prevButton.dom.classList.add('director-mini-button');

            const nextButton = new Button({
                text: '>'
            });
            nextButton.dom.classList.add('director-mini-button');

            const clearParamButton = new Button({
                text: 'Clr'
            });
            clearParamButton.dom.classList.add('director-mini-button');

            const keyInfo = new Label({
                class: 'director-key-info',
                text: '0 keys'
            });

            animControls.append(trackButton);
            animControls.append(prevButton);
            animControls.append(nextButton);
            animControls.append(clearParamButton);
            animControls.append(keyInfo);

            animRow.append(animSpacer);
            animRow.append(animControls);
            section.append(animRow);

            const state: ParamRow = {
                animRow,
                clearButton: clearParamButton,
                dragSplat: null,
                dragStartValue: null,
                dragging: false,
                keyButton,
                keyInfo,
                nextButton,
                param,
                prevButton,
                row,
                slider,
                trackButton,
                updateKeyOnEnd: false
            };

            const armTrack = () => {
                if (!selected) {
                    return;
                }
                events.fire('displayTrack.setActiveParam', param.id);
            };

            slider.on('slide:start', () => {
                armTrack();
                state.dragSplat = selected;
                state.dragStartValue = state.dragSplat ? param.get(state.dragSplat) : null;
                state.dragging = true;
                state.updateKeyOnEnd = !!selected && hasKeyAtCurrentFrame(param.id);
            });

            slider.on('slide:end', () => {
                state.dragging = false;
                const selectionMatchesDrag = selected === state.dragSplat;

                if (state.updateKeyOnEnd && !selectionMatchesDrag && state.dragSplat && state.dragStartValue !== null) {
                    if (param.restore) {
                        param.restore(state.dragSplat, state.dragStartValue);
                    } else {
                        param.set(state.dragSplat, state.dragStartValue);
                    }
                    state.dragSplat.scene.forceRender = true;
                }

                if (!state.updateKeyOnEnd && state.dragSplat && state.dragStartValue !== null) {
                    const newValue = param.get(state.dragSplat);
                    if (state.dragStartValue !== newValue) {
                        events.fire('edit.add', new SetDisplayParamOp({
                            splat: state.dragSplat,
                            param,
                            oldValue: state.dragStartValue,
                            newValue
                        }), true);
                    }
                }
                state.dragSplat = null;
                state.dragStartValue = null;

                if (selected && selectionMatchesDrag && state.updateKeyOnEnd) {
                    events.fire('displayTrack.addKey', param.id, currentFrame());
                }

                state.updateKeyOnEnd = false;
                refreshKeyButtons();
            });

            slider.on('change', (value: number) => {
                const target = state.dragging ? state.dragSplat : selected;
                if (suppress || !target) {
                    return;
                }

                if (!state.dragging) {
                    armTrack();
                }
                const updateCurrentKey = !state.dragging && hasKeyAtCurrentFrame(param.id);
                if (state.dragging) {
                    param.set(target, value);
                    target.scene.forceRender = true;
                } else {
                    const op = applyDisplayParamValue(target, param, value);
                    if (updateCurrentKey) {
                        events.fire('displayTrack.addKey', param.id, currentFrame());
                        refreshKeyButtons();
                    } else if (op) {
                        events.fire('edit.add', op, true);
                    }
                }
            });

            keyButton.on('click', () => {
                if (!selected) {
                    return;
                }

                armTrack();
                if (hasKeyAtCurrentFrame(param.id)) {
                    events.fire('displayTrack.removeKey', param.id, currentFrame());
                } else {
                    param.set(selected, slider.value);
                    selected.scene.forceRender = true;
                    events.fire('displayTrack.addKey', param.id, currentFrame());
                }

                refreshKeyButtons();
            });

            trackButton.on('click', () => {
                if (!selected) {
                    return;
                }

                events.fire('displayTrack.setActiveParam', activeParamId === param.id ? null : param.id);
            });

            prevButton.on('click', () => {
                if (!selected) {
                    return;
                }

                const frame = getAdjacentKey(param.id, -1);
                if (frame !== null) {
                    armTrack();
                    events.fire('timeline.setFrame', frame);
                }
            });

            nextButton.on('click', () => {
                if (!selected) {
                    return;
                }

                const frame = getAdjacentKey(param.id, 1);
                if (frame !== null) {
                    armTrack();
                    events.fire('timeline.setFrame', frame);
                }
            });

            clearParamButton.on('click', () => {
                if (!selected) {
                    return;
                }

                armTrack();
                events.fire('displayTrack.clear', param.id);
            });

            tooltips.register(slider, displayLabel(param.label), 'left');
            tooltips.register(keyButton, `${displayLabel(param.label)} keyframe`, 'left');
            tooltips.register(trackButton, `${displayLabel(param.label)} track in timeline`, 'left');
            tooltips.register(prevButton, `${displayLabel(param.label)} previous key`, 'left');
            tooltips.register(nextButton, `${displayLabel(param.label)} next key`, 'left');
            tooltips.register(clearParamButton, `${displayLabel(param.label)} clear keys`, 'left');

            return state;
        });

        clearButton.on('click', () => {
            events.fire('displayTrack.clear');
            refreshKeyButtons();
        });

        collapseButton.on('click', () => {
            collapsed = !collapsed;
            body.hidden = collapsed;
            collapseButton.text = collapsed ? '>' : '<';
            this.dom.classList[collapsed ? 'add' : 'remove']('collapsed');
        });

        events.on('selection.changed', (selection) => {
            selected = selection instanceof Splat ? selection : null;
            refreshUI();
        });

        displayParams.forEach((param) => {
            const eventNames = param.events ?? [`splat.${param.id}`];
            eventNames.forEach((eventName) => {
                events.on(eventName, (splat: Splat) => {
                    if (splat === selected) {
                        refreshSliderValues();
                    }
                });
            });
        });

        events.on('timeline.frame', () => {
            updateFrameLabel();
            refreshKeyButtons();
            refreshTrackControls();
        });

        events.on('displayTrack.changed', () => {
            refreshKeyButtons();
            refreshTrackControls();
        });

        events.on('displayTrack.activeParamChanged', (paramId: DisplayParam['id'] | null) => {
            activeParamId = paramId;
            refreshTrackControls();
        });

        setEnabled();
        refreshUI();
    }
}

export { DirectorPanel };
