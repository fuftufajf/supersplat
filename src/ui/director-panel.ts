import { BooleanInput, Button, Container, Label, SliderInput } from '@playcanvas/pcui';

import { SetDisplayParamOp, displayParams, type DisplayParam, type DisplayParamGroup, type DisplayParamId, type DisplayTarget } from '../display-params';
import { Events } from '../events';
import type { Splat } from '../splat';
import { i18n } from './localization';
import { Tooltips } from './tooltips';

// pcui's slider only reports value changes; the director needs the drag's
// start and end to record one undo step and to update a key once
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

const groupLabels: Record<DisplayParamGroup, string> = {
    shape: 'Shape',
    reveal: 'Reveal',
    pulse: 'Pulse (experimental)',
    color: 'Color & light',
    transform: 'Transform',
    visibility: 'Visibility',
    scene: 'Scene'
};

type Row = {
    param: DisplayParam;
    row: Container;
    input: DirectorSliderInput | BooleanInput;
    keyButton: Button;
    trackButton: Button;
    prevButton: Button;
    nextButton: Button;
    clearButton: Button;
    keyInfo: Label;
};

/**
 * Splat Director panel: every display parameter of the focused layer (and the
 * scene) with its keyframes. Shown with the timeline; "Track" puts a param's
 * keys on the timeline in place of the camera's.
 */
class DirectorPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        super({ ...args, id: 'director-panel', class: 'panel', hidden: true });

        // keep camera controls from reacting to interaction with the panel
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((name) => {
            this.dom.addEventListener(name, (event: Event) => event.stopPropagation());
        });

        const header = new Container({ class: ['panel-header', 'director-panel-header'] });
        const title = new Label({ class: 'panel-header-label', text: 'Director' });
        const layerLabel = new Label({ class: 'director-layer-label', text: '' });
        const frameLabel = new Label({ class: 'director-frame-label', text: 'F0' });
        const collapseButton = new Button({ class: 'director-header-action', text: '-' });
        header.append(title);
        header.append(layerLabel);
        header.append(frameLabel);
        header.append(collapseButton);

        const body = new Container({ class: 'director-panel-body' });
        this.append(header);
        this.append(body);

        const frame = () => Math.round(events.invoke('timeline.frame') ?? 0);
        const target = (id: DisplayParamId) => events.invoke('displayTrack.target', id) as DisplayTarget | null;
        const keys = (id: DisplayParamId) => (events.invoke('displayTrack.keys', id) as number[]) ?? [];
        const label = (param: DisplayParam) => (param.label.startsWith('panel.') ? i18n.t(param.label) : param.label);

        let suppress = false;
        const rows: Row[] = [];
        // one collapsible section per group, in registry order; pulse starts closed
        const sectionBodies = new Map<DisplayParamGroup, Container>();
        const bodyFor = (group: DisplayParamGroup) => {
            if (!sectionBodies.has(group)) {
                const sectionLabel = new Label({ class: 'director-section-label', text: groupLabels[group] });
                const sectionBody = new Container({ class: 'director-section-body', hidden: group === 'pulse' });
                sectionLabel.dom.addEventListener('click', () => {
                    sectionBody.hidden = !sectionBody.hidden;
                });
                body.append(sectionLabel);
                body.append(sectionBody);
                sectionBodies.set(group, sectionBody);
            }
            return sectionBodies.get(group);
        };

        const refresh = () => {
            const now = frame();
            const active = events.invoke('displayTrack.activeParam');
            const layer = events.invoke('displayTrack.focus') as Splat | null;
            layerLabel.text = layer ? layer.name : 'no layer';
            frameLabel.text = `F${now}`;
            suppress = true;
            rows.forEach(({ param, row, input, keyButton, trackButton, prevButton, nextButton, clearButton, keyInfo }) => {
                const t = target(param.id);
                const k = keys(param.id);
                const enabled = !!t;
                input.value = t ? (param.id === 'visible' ? param.get(t) >= 0.5 : param.get(t)) : (param.id === 'visible' ? true : param.default);
                input.enabled = enabled;
                const keyed = k.includes(now);
                keyButton.text = keyed ? '◆' : '◇';
                keyButton.class[keyed ? 'add' : 'remove']('keyed');
                keyButton.enabled = enabled;
                trackButton.enabled = enabled;
                trackButton.class[active === param.id ? 'add' : 'remove']('active');
                row.class[active === param.id ? 'add' : 'remove']('active-track');
                prevButton.enabled = enabled && k.some(f => f < now);
                nextButton.enabled = enabled && k.some(f => f > now);
                clearButton.enabled = enabled && k.length > 0;
                keyInfo.text = k.length ? `${k.length}` : '';
            });
            suppress = false;
        };

        displayParams.forEach((param) => {
            const row = new Container({ class: 'director-row' });
            const rowLabel = new Label({ class: 'director-row-label', text: label(param) });
            const input = param.id === 'visible' ?
                new BooleanInput({ class: 'director-toggle', type: 'toggle', value: true }) :
                new DirectorSliderInput({ class: 'director-slider', min: param.min, max: param.max, step: param.step, precision: param.precision ?? 2, value: param.default });
            // transforms have unbounded practical ranges: let the number box take any value
            if (input instanceof DirectorSliderInput && param.group === 'transform') {
                input.sliderMin = param.id.startsWith('rotation') ? -180 : param.id.startsWith('scale') ? 0.01 : -10;
                input.sliderMax = param.id.startsWith('rotation') ? 180 : param.id.startsWith('scale') ? 4 : 10;
            }
            const keyButton = new Button({ class: 'director-key-button', text: '◇' });
            const trackButton = new Button({ class: 'director-mini-button', text: 'T' });
            const prevButton = new Button({ class: 'director-mini-button', text: '<' });
            const nextButton = new Button({ class: 'director-mini-button', text: '>' });
            const clearButton = new Button({ class: 'director-mini-button', text: 'x' });
            const keyInfo = new Label({ class: 'director-key-info', text: '' });

            [rowLabel, input, keyButton, trackButton, prevButton, nextButton, clearButton, keyInfo].forEach(e => row.append(e));
            bodyFor(param.group).append(row);
            rows.push({ param, row, input, keyButton, trackButton, prevButton, nextButton, clearButton, keyInfo });

            const keyedNow = () => keys(param.id).includes(frame());

            // a drag writes live and records one step at the end: a key at this
            // frame is updated (its own undo step), otherwise the value change is
            let dragStart: { target: DisplayTarget, value: number } | null = null;
            if (input instanceof DirectorSliderInput) {
                input.on('slide:start', () => {
                    const t = target(param.id);
                    dragStart = t ? { target: t, value: param.get(t) } : null;
                });
                input.on('slide:end', () => {
                    const start = dragStart;
                    dragStart = null;
                    if (!start || start.target !== target(param.id)) return;
                    if (keyedNow()) {
                        events.fire('displayTrack.addKey', param.id);
                    } else if (param.get(start.target) !== start.value) {
                        events.fire('edit.add', new SetDisplayParamOp({ target: start.target, param, oldValue: start.value, newValue: param.get(start.target) }), true);
                    }
                });
            }

            input.on('change', (value: number | boolean) => {
                if (suppress) return;
                const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : value;
                if (dragStart) {
                    param.set(dragStart.target, numeric);
                    if (dragStart.target.scene) dragStart.target.scene.forceRender = true;
                    return;
                }
                const keyed = keyedNow();
                events.invoke('displayTrack.setValue', param.id, numeric, !keyed);
                if (keyed) events.fire('displayTrack.addKey', param.id);
            });

            keyButton.on('click', () => {
                events.fire('displayTrack.setActiveParam', param.id);
                events.fire(keyedNow() ? 'displayTrack.removeKey' : 'displayTrack.addKey', param.id);
            });
            trackButton.on('click', () => {
                events.fire('displayTrack.setActiveParam', events.invoke('displayTrack.activeParam') === param.id ? null : param.id);
            });
            const jump = (direction: 1 | -1) => {
                const now = frame();
                const k = keys(param.id).filter(f => (direction > 0 ? f > now : f < now));
                if (!k.length) return;
                events.fire('displayTrack.setActiveParam', param.id);
                events.fire('timeline.setFrame', direction > 0 ? Math.min(...k) : Math.max(...k));
            };
            prevButton.on('click', () => jump(-1));
            nextButton.on('click', () => jump(1));
            clearButton.on('click', () => events.fire('displayTrack.clear', param.id));

            tooltips.register(keyButton, `${label(param)}: key at this frame`, 'left');
            tooltips.register(trackButton, `${label(param)}: show keys on the timeline`, 'left');
            tooltips.register(clearButton, `${label(param)}: clear keys`, 'left');
        });

        collapseButton.on('click', () => {
            body.hidden = !body.hidden;
            collapseButton.text = body.hidden ? '+' : '-';
        });

        [
            'timeline.frame', 'timeline.time', 'displayTrack.changed', 'displayTrack.valueChanged',
            'displayTrack.activeParamChanged', 'displayTrack.focusChanged', 'splat.moved', 'splat.visibility', 'splat.name',
            'edit.apply'
        ].forEach(name => events.on(name, () => {
            if (!this.hidden) refresh();
        }));
        this.on('show', refresh);
    }
}

export { DirectorPanel };
