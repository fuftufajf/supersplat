import { Button, Container, Label, SliderInput } from '@playcanvas/pcui';

import { displayParams, type DisplayParam } from '../display-params';
import { Events } from '../events';
import { Splat } from '../splat';
import { localize } from './localization';
import { Tooltips } from './tooltips';

class DirectorSliderInput extends SliderInput {
    _onSlideStart(pageX: number) {
        super._onSlideStart(pageX);
        this.emit('slide:start');
    }

    _onSlideEnd(pageX: number) {
        super._onSlideEnd(pageX);
        this.emit('slide:end');
    }
}

type ParamRow = {
    dragging: boolean;
    keyButton: Button;
    param: DisplayParam;
    slider: DirectorSliderInput;
    updateKeyOnEnd: boolean;
};

class DirectorPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'director-panel',
            class: 'panel',
            flex: true,
            flexDirection: 'column'
        };

        super(args);

        this.dom.style.margin = '8px 8px 0 8px';
        this.dom.style.width = 'calc(100% - 16px)';
        this.dom.style.flexShrink = '0';
        this.dom.style.position = 'relative';

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = new Container({
            class: 'panel-header'
        });

        const icon = new Label({
            class: 'panel-header-icon',
            text: '\u25C6'
        });
        icon.dom.style.fontFamily = 'inherit';

        const label = new Label({
            class: 'panel-header-label',
            text: 'Director'
        });

        const frameLabel = new Label({
            text: 'F0'
        });
        frameLabel.dom.style.color = '#ff9900';
        frameLabel.dom.style.fontWeight = 'bold';
        frameLabel.dom.style.marginRight = '8px';

        const clearButton = new Button({
            text: 'Clear'
        });
        clearButton.dom.classList.add('panel-header-button');
        clearButton.dom.style.fontFamily = 'inherit';
        clearButton.dom.style.fontSize = '11px';
        clearButton.dom.style.textTransform = 'uppercase';
        clearButton.dom.style.padding = '2px 8px';

        header.append(icon);
        header.append(label);
        header.append(frameLabel);
        header.append(clearButton);

        this.append(header);

        let selected: Splat | null = null;
        let suppress = false;

        const hasDisplayTrackFunction = (name: string) => {
            return events.functions.has(name);
        };

        const currentFrame = () => {
            return Math.round(events.invoke('timeline.frame') ?? 0);
        };

        const getParamKeys = (paramId: DisplayParam['id']) => {
            if (!hasDisplayTrackFunction('displayTrack.keys')) {
                return [];
            }
            return (events.invoke('displayTrack.keys', paramId) as number[] ?? []);
        };

        const hasKeyAtCurrentFrame = (paramId: DisplayParam['id']) => {
            return getParamKeys(paramId).includes(currentFrame());
        };

        let rows: ParamRow[] = [];

        const setEnabled = () => {
            const enabled = !!selected;
            rows.forEach((row) => {
                row.slider.enabled = enabled;
                row.keyButton.enabled = enabled;
            });
        };

        const refreshKeyButtons = () => {
            rows.forEach((row) => {
                const keyed = !!selected && hasKeyAtCurrentFrame(row.param.id);
                row.keyButton.text = keyed ? '\u25C6' : '\u25C7';
                row.keyButton.dom.style.color = keyed ? '#ff9900' : '#8a8a8a';
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
            updateFrameLabel();
        };

        rows = displayParams.map((param) => {
            const row = new Container();
            row.dom.style.display = 'flex';
            row.dom.style.alignItems = 'center';
            row.dom.style.gap = '8px';
            row.dom.style.padding = '4px 8px';

            const rowLabel = new Label({
                text: localize(param.label)
            });
            rowLabel.dom.style.flex = '0 0 180px';
            rowLabel.dom.style.color = '#d0d0d0';

            const slider = new DirectorSliderInput({
                min: param.min,
                max: param.max,
                step: param.step,
                value: param.default
            });
            slider.dom.style.flex = '1 1 auto';
            slider.dom.style.margin = '0';

            const keyButton = new Button({
                text: '\u25C7'
            });
            keyButton.dom.classList.add('panel-header-button');
            keyButton.dom.style.fontFamily = 'inherit';
            keyButton.dom.style.fontSize = '16px';
            keyButton.dom.style.lineHeight = '1';
            keyButton.dom.style.padding = '2px 8px';

            row.append(rowLabel);
            row.append(slider);
            row.append(keyButton);
            this.append(row);

            const state: ParamRow = {
                dragging: false,
                keyButton,
                param,
                slider,
                updateKeyOnEnd: false
            };

            slider.on('slide:start', () => {
                state.dragging = true;
                state.updateKeyOnEnd = !!selected && hasKeyAtCurrentFrame(param.id);
            });

            slider.on('slide:end', () => {
                state.dragging = false;

                if (selected && state.updateKeyOnEnd) {
                    events.fire('displayTrack.addKey', param.id, currentFrame());
                }

                state.updateKeyOnEnd = false;
                refreshKeyButtons();
            });

            slider.on('change', (value: number) => {
                if (suppress || !selected) {
                    return;
                }

                param.set(selected, value);
                selected.scene.forceRender = true;

                if (!state.dragging && hasKeyAtCurrentFrame(param.id)) {
                    events.fire('displayTrack.addKey', param.id, currentFrame());
                    refreshKeyButtons();
                }
            });

            keyButton.on('click', () => {
                if (!selected) {
                    return;
                }

                if (hasKeyAtCurrentFrame(param.id)) {
                    events.fire('displayTrack.removeKey', param.id, currentFrame());
                } else {
                    param.set(selected, slider.value);
                    selected.scene.forceRender = true;
                    events.fire('displayTrack.addKey', param.id, currentFrame());
                }

                refreshKeyButtons();
            });

            tooltips.register(slider, localize(param.label), 'top');
            tooltips.register(keyButton, `${localize(param.label)} keyframe`, 'left');

            return state;
        });

        clearButton.on('click', () => {
            events.fire('displayTrack.clear');
            refreshKeyButtons();
        });

        events.on('selection.changed', (selection) => {
            selected = selection instanceof Splat ? selection : null;
            refreshUI();
        });

        displayParams.forEach((param) => {
            events.on(`splat.${param.id}`, (splat: Splat) => {
                if (splat === selected) {
                    refreshSliderValues();
                }
            });
        });

        events.on('timeline.frame', () => {
            updateFrameLabel();
            refreshKeyButtons();
        });

        events.on('displayTrack.changed', () => {
            refreshKeyButtons();
        });

        setEnabled();
        refreshUI();
    }
}

export { DirectorPanel };
