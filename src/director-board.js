/* global document, window, URLSearchParams, Event */
/* eslint-disable arrow-parens, operator-linebreak, prefer-template, quotes, require-atomic-updates */

const layout = document.querySelector('.db-layout');
const frame = document.getElementById('module-frame');
const statusStrip = document.getElementById('status-strip');
const btnOpenProject = document.getElementById('btn-open-project');
const btnSaveProject = document.getElementById('btn-save-project');
const btnSaveProjectAs = document.getElementById('btn-save-project-as');
const btnImport = document.getElementById('btn-import');
const btnRefresh = document.getElementById('btn-refresh');
const btnStageFull = document.getElementById('btn-stage-full');
const btnExitStageFull = document.getElementById('btn-exit-stage-full');
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnRestart = document.getElementById('btn-restart');
const fileInput = document.getElementById('file-input');
const projectInput = document.getElementById('project-input');
const timelineRange = document.getElementById('timeline-range');
const timelineReadout = document.getElementById('timeline-readout');
const timelineFrames = document.getElementById('timeline-frames');
const timelineFps = document.getElementById('timeline-fps');
const timelineSmoothness = document.getElementById('timeline-smoothness');
const orbitDuration = document.getElementById('orbit-duration');
const orbitKeys = document.getElementById('orbit-keys');
const orbitDirection = document.getElementById('orbit-direction');
const orbitLookPitch = document.getElementById('orbit-look-pitch');
const orbitSummary = document.getElementById('orbit-summary');
const btnBuildOrbit = document.getElementById('btn-build-orbit');
const btnPreviewOrbit = document.getElementById('btn-preview-orbit');
const viewBgColor = document.getElementById('view-bg-color');
const viewPointColor = document.getElementById('view-point-color');
const viewPointAlpha = document.getElementById('view-point-alpha');
const viewSelectedColor = document.getElementById('view-selected-color');
const viewSelectedAlpha = document.getElementById('view-selected-alpha');
const viewLockedColor = document.getElementById('view-locked-color');
const viewLockedAlpha = document.getElementById('view-locked-alpha');
const viewTonemapping = document.getElementById('view-tonemapping');
const viewFov = document.getElementById('view-fov');
const viewShBands = document.getElementById('view-sh-bands');
const viewFlySpeed = document.getElementById('view-fly-speed');
const viewPointSize = document.getElementById('view-point-size');
const viewPointSizeReadout = document.getElementById('view-point-size-readout');
const viewRingSize = document.getElementById('view-ring-size');
const viewRingSizeReadout = document.getElementById('view-ring-size-readout');
const viewPointAlphaReadout = document.getElementById('view-point-alpha-readout');
const viewSelectedAlphaReadout = document.getElementById('view-selected-alpha-readout');
const viewLockedAlphaReadout = document.getElementById('view-locked-alpha-readout');
const viewFovReadout = document.getElementById('view-fov-readout');
const viewShBandsReadout = document.getElementById('view-sh-bands-readout');
const viewFlySpeedReadout = document.getElementById('view-fly-speed-readout');
const viewGridVisible = document.getElementById('view-grid-visible');
const viewBoundVisible = document.getElementById('view-bound-visible');
const viewCameraPosesVisible = document.getElementById('view-camera-poses-visible');
const viewOutlineSelection = document.getElementById('view-outline-selection');
const viewCentersGaussianColor = document.getElementById('view-centers-gaussian-color');
const selectionSummary = document.getElementById('selection-summary');
const splatList = document.getElementById('splat-list');
const paramGroups = document.getElementById('param-groups');
const sceneSummary = document.getElementById('scene-summary');
const colorPicker = document.getElementById('db-color-picker');
const colorPickerLabel = document.getElementById('db-color-picker-label');
const colorPickerClose = document.getElementById('db-color-picker-close');
const colorPlane = document.getElementById('db-color-plane');
const colorHue = document.getElementById('db-color-hue');
const colorPreview = document.getElementById('db-color-preview');
const colorHex = document.getElementById('db-color-hex');
const colorRecents = document.getElementById('db-color-recents');
const colorPresets = document.getElementById('db-color-presets');

let readyPollHandle = null;
let statePollHandle = null;
let lastState = null;
let liveApplyHandle = null;
let paramRerenderPausedUntil = 0;
let viewApplyHandle = null;
let pendingViewPatch = null;
let viewRerenderPausedUntil = 0;
let activeColorInput = null;
let colorDragActive = false;
let pickerHsv = { h: 0, s: 1, v: 1 };
let directorOrbitBuilt = false;
let lastOrbit = null;
let projectFileHandle = null;
const groupOpenState = {};
const PROJECT_FILE_TYPES = [{
    description: 'SuperSplat project',
    accept: {
        'application/x-supersplat': ['.ssproj']
    }
}];
const htmlEscapes = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};
const RECENT_COLORS_STORAGE_KEY = 'splatDirector.recentColors';
const RECENT_COLORS_LIMIT = 12;
const PRESET_COLORS = [
    '#000000', '#ffffff', '#d2c57c', '#ff4b3e', '#ff9d00', '#ffe84d',
    '#25d95f', '#00d4ff', '#3157ff', '#8a5cff', '#ff4fd8', '#7a8794'
];
const POINT_SIZE_SLIDER_MIN = 0;
const POINT_SIZE_SLIDER_MAX = 1;
const POINT_SIZE_SLIDER_STEP = 0.001;
const POINT_SIZE_MAX = 40;
// Perceptual mapping: the slider travels 0..1, the real point size follows a
// gamma curve so the useful small sizes get most of the travel and the large
// end stays smooth and continuous instead of jumping in ~1.5 unit steps.
const POINT_SIZE_GAMMA = 2.4;

function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function pointSizeToSlider(value) {
    const clamped = clampValue(value, 0, POINT_SIZE_MAX);
    return Math.pow(clamped / POINT_SIZE_MAX, 1 / POINT_SIZE_GAMMA);
}

function pointSizeFromSlider(sliderValue) {
    const clamped = clampValue(sliderValue, POINT_SIZE_SLIDER_MIN, POINT_SIZE_SLIDER_MAX);
    return Math.pow(clamped, POINT_SIZE_GAMMA) * POINT_SIZE_MAX;
}

function formatPointSizeReadout(value) {
    const numeric = Number(value) || 0;
    return numeric < 1 ? numeric.toFixed(2) : numeric.toFixed(1);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

function pauseParamRerender() {
    paramRerenderPausedUntil = Date.now() + 450;
}

function canRerenderParams() {
    return Date.now() >= paramRerenderPausedUntil && !paramGroups.contains(document.activeElement);
}

function pauseViewRerender() {
    viewRerenderPausedUntil = Date.now() + 450;
}

function canRerenderView() {
    return Date.now() >= viewRerenderPausedUntil;
}

function setStatus(text, isError, tone) {
    statusStrip.textContent = text;
    statusStrip.classList.toggle('is-error', Boolean(isError));
    statusStrip.classList.toggle('is-saved', tone === 'saved');
    if (!isError && tone !== 'saved') {
        statusStrip.style.color = '#dce4df';
    } else {
        statusStrip.style.color = '';
    }
}

function getScene() {
    try {
        return frame.contentWindow && frame.contentWindow.__piScene ? frame.contentWindow.__piScene : null;
    } catch (error) {
        return null;
    }
}

function isStageFull() {
    return layout.dataset.stageFull === '1';
}

function setStageFull(enabled) {
    layout.dataset.stageFull = enabled ? '1' : '0';
}

function resolveIframeUrl() {
    const params = new URLSearchParams(window.location.search);
    params.set('embedded', '1');
    params.set('editor', '1');
    params.set('nosw', '1');
    params.delete('stage');
    params.delete('stageFull');
    const query = params.toString();
    return './' + (query ? '?' + query : '?embedded=1&editor=1&nosw=1');
}

function withCacheBust(url) {
    const bust = String(Date.now());
    return url + (url.includes('?') ? '&' : '?') + 'frameBust=' + encodeURIComponent(bust);
}

function loadScene() {
    lastState = null;
    sceneSummary.innerHTML = '<span>bridge: loading</span><span>splats: 0</span><span>frame: 0</span>';
    setStatus('loading embedded SuperSplat scene...');
    frame.src = withCacheBust(resolveIframeUrl());
}

function stopStatePolling() {
    if (statePollHandle !== null) {
        window.clearInterval(statePollHandle);
        statePollHandle = null;
    }
}

function startStatePolling() {
    stopStatePolling();
    statePollHandle = window.setInterval(() => {
        if (!getScene() || document.hidden) {
            return;
        }
        refreshState({ quiet: true });
    }, 250);
}

function renderTimeline(state) {
    const timeline = state.timeline || {};
    const frameValue = Number(timeline.frame || 0);
    const totalFrames = Math.max(1, Number(timeline.frames || 1));
    timelineRange.max = String(totalFrames - 1);
    timelineRange.value = String(Math.max(0, Math.min(totalFrames - 1, frameValue)));
    timelineReadout.textContent = frameValue + ' / ' + (totalFrames - 1);
    timelineFrames.value = String(totalFrames);
    timelineFps.value = String(Number(timeline.frameRate || 30));
    timelineSmoothness.value = String(Number(timeline.smoothness || 1));
    btnPlay.classList.toggle('is-accent', Boolean(timeline.playing));
    btnPause.classList.toggle('is-accent', !timeline.playing);
}

function renderSelection(state) {
    const selection = state.selection;
    if (!state.splats || state.splats.length === 0) {
        selectionSummary.textContent = 'Load a splat to start directing.';
        splatList.innerHTML = '<div class="db-empty">No splats loaded yet.</div>';
        return;
    }

    if (selection) {
        selectionSummary.textContent = 'Selected: ' + selection.name + ' | visible=' + selection.visible + ' | splats=' + selection.numSplats;
    } else {
        selectionSummary.textContent = 'Scene loaded, but nothing is selected.';
    }

    splatList.innerHTML = state.splats.map((splat) => {
        const visibleLabel = splat.visible ? 'Hide' : 'Show';
        const name = escapeHtml(splat.name);
        return [
            '<div class="db-splat-row' + (splat.selected ? ' is-selected' : '') + '">',
            '<span class="db-splat-index">' + (splat.index + 1) + '</span>',
            '<button class="db-splat-name" type="button" data-action="select-splat" data-splat-index="' + splat.index + '" title="' + name + '">' + name + '</button>',
            '<button class="db-eye" type="button" data-action="toggle-splat" data-splat-index="' + splat.index + '">' + visibleLabel + '</button>',
            '</div>'
        ].join('');
    }).join('');
}

function groupDisplayParams(state) {
    const metaById = {};
    (state.display.groups || []).forEach((group) => {
        metaById[group.id] = group;
    });

    const grouped = {};
    (state.display.params || []).forEach((param) => {
        if (!grouped[param.group]) {
            grouped[param.group] = [];
        }
        grouped[param.group].push(param);
    });

    return Object.keys(metaById).map((groupId) => ({
        meta: metaById[groupId],
        params: grouped[groupId] || []
    }));
}

function formatValue(param, value) {
    const precision = Number.isFinite(Number(param.precision)) ? Number(param.precision) : 2;
    return Number(value).toFixed(precision);
}

function paramSliderMin(param) {
    return Number.isFinite(Number(param.sliderMin)) ? Number(param.sliderMin) : Number(param.min);
}

function paramSliderMax(param) {
    return Number.isFinite(Number(param.sliderMax)) ? Number(param.sliderMax) : Number(param.max);
}

function paramSliderStep(param) {
    return Number.isFinite(Number(param.sliderStep)) ? Number(param.sliderStep) : Number(param.step);
}

function paramSliderValue(param) {
    return Number.isFinite(Number(param.sliderValue)) ? Number(param.sliderValue) : Number(param.value);
}

function channelToHex(value) {
    return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255).toString(16).padStart(2, '0');
}

function colorToHex(color) {
    return '#' + channelToHex(color && color.r) + channelToHex(color && color.g) + channelToHex(color && color.b);
}

function colorPatch(hexValue, alphaValue) {
    const hex = String(hexValue || '#000000').replace('#', '');
    const alpha = Number(alphaValue);
    return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1
    };
}

function normalizeHex(value) {
    const hex = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : '';
}

function hexToRgb(hexValue) {
    const hex = normalizeHex(hexValue) || '#ffffff';
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
    };
}

function rgbToHex(red, green, blue) {
    const toPart = (value) => Math.round(Math.max(0, Math.min(255, Number(value) || 0))).toString(16).padStart(2, '0');
    return '#' + toPart(red) + toPart(green) + toPart(blue);
}

function rgbToHsv(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;

    if (delta) {
        if (max === r) {
            hue = ((g - b) / delta) % 6;
        } else if (max === g) {
            hue = (b - r) / delta + 2;
        } else {
            hue = (r - g) / delta + 4;
        }
        hue = Math.round(hue * 60);
        if (hue < 0) {
            hue += 360;
        }
    }

    return {
        h: hue,
        s: max ? delta / max : 0,
        v: max
    };
}

function hsvToHex(hue, saturation, value) {
    const h = ((Number(hue) || 0) % 360) / 60;
    const s = Math.max(0, Math.min(1, Number(saturation)));
    const v = Math.max(0, Math.min(1, Number(value)));
    const c = v * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h >= 0 && h < 1) {
        r = c; g = x;
    } else if (h < 2) {
        r = x; g = c;
    } else if (h < 3) {
        g = c; b = x;
    } else if (h < 4) {
        g = x; b = c;
    } else if (h < 5) {
        r = x; b = c;
    } else {
        r = c; b = x;
    }

    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function readRecentColors() {
    try {
        const stored = window.localStorage && window.localStorage.getItem(RECENT_COLORS_STORAGE_KEY);
        return normalizeColorList(stored ? JSON.parse(stored) : []);
    } catch (error) {
        return [];
    }
}

function writeRecentColors(colors) {
    try {
        if (window.localStorage) {
            window.localStorage.setItem(RECENT_COLORS_STORAGE_KEY, JSON.stringify(normalizeColorList(colors)));
        }
    } catch (error) {
        // The picker remains usable without persistence.
    }
}

function normalizeColorList(colors) {
    const seen = new Set();
    const normalized = [];
    (Array.isArray(colors) ? colors : []).forEach((color) => {
        const hex = normalizeHex(color);
        if (!hex || seen.has(hex)) {
            return;
        }
        seen.add(hex);
        normalized.push(hex);
    });
    return normalized.slice(0, RECENT_COLORS_LIMIT);
}

function recordRecentColor(hexValue) {
    const hex = normalizeHex(hexValue);
    if (!hex) {
        return;
    }
    const recents = readRecentColors().filter((color) => color !== hex);
    writeRecentColors([hex].concat(recents));
    renderColorSwatches();
}

function makeSwatch(hexValue, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'db-color-swatch';
    button.title = title || hexValue;
    button.style.setProperty('--db-color-value', hexValue);
    button.addEventListener('click', () => {
        commitColor(hexValue, { final: true });
    });
    return button;
}

function renderColorSwatches() {
    const recents = readRecentColors();
    colorRecents.replaceChildren(...(recents.length ? recents.map((color) => makeSwatch(color)) : [document.createTextNode('No recent colors yet')]));
    colorPresets.replaceChildren(...PRESET_COLORS.map((color) => makeSwatch(color)));
}

function syncColorTrigger(input) {
    const trigger = input && input.nextElementSibling && input.nextElementSibling.classList.contains('db-color-trigger')
        ? input.nextElementSibling
        : null;
    if (!trigger) {
        return;
    }
    const hex = normalizeHex(input.value) || '#000000';
    trigger.style.setProperty('--db-color-value', hex);
    const value = trigger.querySelector('.db-color-value');
    if (value) {
        value.textContent = hex;
    }
}

function syncColorTriggers() {
    document.querySelectorAll('.db-color').forEach((input) => syncColorTrigger(input));
}

function setPickerColor(hexValue) {
    const hex = normalizeHex(hexValue) || '#ffffff';
    const rgb = hexToRgb(hex);
    pickerHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    colorHue.value = String(Math.round(pickerHsv.h));
    colorHex.value = hex.toUpperCase();
    colorPreview.style.setProperty('--db-color-value', hex);
    colorPlane.style.setProperty('--db-picker-hue', String(Math.round(pickerHsv.h)));
    colorPlane.style.setProperty('--db-picker-sat', String(pickerHsv.s * 100));
    colorPlane.style.setProperty('--db-picker-val', String(pickerHsv.v * 100));
}

function commitColor(hexValue, options = {}) {
    const hex = normalizeHex(hexValue);
    if (!hex || !activeColorInput) {
        return;
    }
    activeColorInput.value = hex;
    syncColorTrigger(activeColorInput);
    setPickerColor(hex);
    activeColorInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (options.final) {
        activeColorInput.dispatchEvent(new Event('change', { bubbles: true }));
        recordRecentColor(hex);
    }
}

function closeColorPicker(options = {}) {
    if (activeColorInput && options.final) {
        recordRecentColor(activeColorInput.value);
    }
    if (activeColorInput && activeColorInput.nextElementSibling) {
        activeColorInput.nextElementSibling.classList.remove('is-active');
    }
    activeColorInput = null;
    colorPicker.hidden = true;
}

function positionColorPicker(trigger) {
    const rect = trigger.getBoundingClientRect();
    const pickerWidth = 286;
    const left = Math.max(10, Math.min(window.innerWidth - pickerWidth - 10, rect.left));
    const top = Math.max(10, Math.min(window.innerHeight - 372, rect.bottom + 8));
    colorPicker.style.left = left + 'px';
    colorPicker.style.top = top + 'px';
}

function openColorPicker(input) {
    if (activeColorInput && activeColorInput !== input) {
        closeColorPicker();
    }
    activeColorInput = input;
    const trigger = input.nextElementSibling;
    trigger.classList.add('is-active');
    colorPickerLabel.textContent = input.closest('.db-field')?.querySelector('label')?.textContent || 'Color';
    setPickerColor(input.value);
    renderColorSwatches();
    colorPicker.hidden = false;
    positionColorPicker(trigger);
    colorHex.focus();
    colorHex.select();
}

function updateColorFromPlane(event, options = {}) {
    const rect = colorPlane.getBoundingClientRect();
    pickerHsv.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    pickerHsv.v = Math.max(0, Math.min(1, 1 - ((event.clientY - rect.top) / rect.height)));
    commitColor(hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v), options);
}

function enhanceColorInputs() {
    document.querySelectorAll('.db-color').forEach((input) => {
        input.classList.add('db-native-color');
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'db-color-trigger';
        trigger.innerHTML = '<span class="db-color-chip"></span><span class="db-color-value"></span>';
        input.insertAdjacentElement('afterend', trigger);
        trigger.addEventListener('click', () => openColorPicker(input));
        input.addEventListener('input', () => syncColorTrigger(input));
        input.addEventListener('change', () => recordRecentColor(input.value));
        syncColorTrigger(input);
    });

    colorPickerClose.addEventListener('click', () => closeColorPicker({ final: true }));
    colorHue.addEventListener('input', () => {
        pickerHsv.h = Number(colorHue.value || 0);
        commitColor(hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v));
    });
    colorHue.addEventListener('change', () => commitColor(hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v), { final: true }));
    colorHex.addEventListener('input', () => {
        const hex = normalizeHex(colorHex.value);
        if (hex) {
            commitColor(hex);
        }
    });
    colorHex.addEventListener('change', () => {
        const hex = normalizeHex(colorHex.value);
        if (hex) {
            commitColor(hex, { final: true });
        } else if (activeColorInput) {
            colorHex.value = normalizeHex(activeColorInput.value).toUpperCase();
        }
    });
    colorPlane.addEventListener('pointerdown', (event) => {
        colorDragActive = true;
        colorPlane.setPointerCapture(event.pointerId);
        updateColorFromPlane(event);
    });
    colorPlane.addEventListener('pointermove', (event) => {
        if (colorDragActive) {
            updateColorFromPlane(event);
        }
    });
    colorPlane.addEventListener('pointerup', (event) => {
        if (!colorDragActive) {
            return;
        }
        colorDragActive = false;
        updateColorFromPlane(event, { final: true });
    });
    document.addEventListener('pointerdown', (event) => {
        if (colorPicker.hidden || colorPicker.contains(event.target) || event.target.closest('.db-color-trigger')) {
            return;
        }
        closeColorPicker({ final: true });
    });
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !colorPicker.hidden) {
            closeColorPicker();
        }
    });
    window.addEventListener('resize', () => {
        if (activeColorInput && !colorPicker.hidden) {
            positionColorPicker(activeColorInput.nextElementSibling);
        }
    });
    renderColorSwatches();
}

function getParamState(paramId) {
    return lastState && lastState.display && Array.isArray(lastState.display.params)
        ? lastState.display.params.find((entry) => entry.id === paramId)
        : null;
}

function formatKeyList(keys) {
    return Array.isArray(keys) && keys.length ? keys.map((key) => Number(key)).join(', ') : 'none yet';
}

function renderParamGroups(state) {
    const selection = state.selection;
    if (!selection) {
        paramGroups.innerHTML = '<div class="db-empty">Load or select a splat to expose animatable director sliders. After import, the first splat should be selected automatically.</div>';
        return;
    }

    paramGroups.innerHTML = groupDisplayParams(state).map((entry) => {
        const group = entry.meta;
        const open = Object.prototype.hasOwnProperty.call(groupOpenState, group.id) ? groupOpenState[group.id] : !group.collapsed;

        const body = entry.params.map((param) => {
            const keyClass = param.keyedAtFrame ? ' is-keyed' : '';
            const activeClass = param.active ? ' is-active' : '';
            const disabledAttr = param.disabled ? ' disabled' : '';
            const keyLabel = param.keyedAtFrame ? 'Keyed here' : 'Add keyframe';
            const label = escapeHtml(param.label);
            return [
                '<div class="db-param' + activeClass + '" data-param-id="' + param.id + '">',
                '<div class="db-param-head">',
                '<div class="db-param-title">',
                '<strong>' + label + '</strong>',
                '<span>Current: ' + formatValue(param, param.value) + ' | Default: ' + formatValue(param, param.default) + '</span>',
                '</div>',
                '</div>',
                '<label class="db-range-control">',
                '<span class="db-range-head"><span>Value</span><strong data-param-output="' + param.id + '">' + formatValue(param, param.value) + '</strong></span>',
                '<input type="range" min="' + paramSliderMin(param) + '" max="' + paramSliderMax(param) + '" step="' + paramSliderStep(param) + '" value="' + paramSliderValue(param) + '" data-action="set-param" data-param-id="' + param.id + '"' + disabledAttr + ' />',
                '</label>',
                '<div class="db-keyframe-row">',
                '<button class="db-chip db-key-main is-key-action' + keyClass + '" type="button" data-action="toggle-key" data-param-id="' + param.id + '"' + disabledAttr + '>',
                '<span class="db-key-main-icon" aria-hidden="true">' + (param.keyedAtFrame ? 'K' : '+') + '</span>',
                '<span class="db-key-main-text">' + keyLabel + '</span>',
                '</button>',
                '<div class="db-param-actions">',
                '<button class="db-chip" type="button" data-action="prev-key" data-param-id="' + param.id + '"' + disabledAttr + '>Prev key</button>',
                '<button class="db-chip" type="button" data-action="next-key" data-param-id="' + param.id + '"' + disabledAttr + '>Next key</button>',
                '<button class="db-chip" type="button" data-action="reset-param" data-param-id="' + param.id + '"' + disabledAttr + '>Default</button>',
                '<button class="db-chip" type="button" data-action="clear-keys" data-param-id="' + param.id + '"' + disabledAttr + '>Clear keys</button>',
                '</div>',
                '</div>',
                '<div class="db-key-list"><strong>Keys</strong><span>' + formatKeyList(param.keys) + '</span></div>',
                '</div>'
            ].join('');
        }).join('');

        const badge = group.experimental ? '<span class="db-group-badge">experimental</span>' : '';
        const count = '<span class="db-group-count">' + entry.params.length + '</span>';

        return [
            '<details class="db-group" data-group-id="' + group.id + '"' + (open ? ' open' : '') + '>',
            '<summary>',
            '<div class="db-group-title"><strong>' + escapeHtml(group.label) + '</strong><span class="db-group-title-meta">' + badge + count + '</span></div>',
            '<div class="db-group-description">' + escapeHtml(group.description) + '</div>',
            '</summary>',
            '<div class="db-group-body">' + body + '</div>',
            '</details>'
        ].join('');
    }).join('');
}

function renderSceneSummary(state) {
    const timeline = state.timeline || {};
    const selection = state.selection;
    const splatCount = Array.isArray(state.splats) ? state.splats.length : 0;
    const frame = Number(timeline.frame || 0);
    const frames = Math.max(1, Number(timeline.frames || 1));
    const selectedName = selection ? selection.name : 'none';

    sceneSummary.innerHTML = [
        '<span title="Scene bridge is ready">bridge: ready</span>',
        '<span title="Current project">' + escapeHtml(state.documentName || 'untitled') + '</span>',
        '<span title="Loaded splats">splats: ' + splatCount + '</span>',
        '<span title="Current frame">frame: ' + frame + '/' + (frames - 1) + '</span>',
        '<span title="Selected splat">selected: ' + selectedName + '</span>',
        '<span title="Scene dirty flag">dirty: ' + (state.sceneDirty ? 'yes' : 'no') + '</span>',
        '<span title="Playback">play: ' + (timeline.playing ? 'on' : 'off') + '</span>'
    ].join('');
}

function renderViewControls(state) {
    const view = state.view || {};
    if (!viewBgColor.matches(':focus')) {
        viewBgColor.value = colorToHex(view.background);
    }
    if (!viewPointColor.matches(':focus')) {
        viewPointColor.value = colorToHex(view.unselectedColor);
    }
    if (!viewPointAlpha.matches(':focus')) {
        const pointAlpha = Number(view.unselectedColor?.a ?? 1);
        viewPointAlpha.value = String(pointAlpha);
        viewPointAlphaReadout.textContent = pointAlpha.toFixed(2);
    }
    if (!viewSelectedColor.matches(':focus')) {
        viewSelectedColor.value = colorToHex(view.selectedColor);
    }
    if (!viewSelectedAlpha.matches(':focus')) {
        const selectedAlpha = Number(view.selectedColor?.a ?? 1);
        viewSelectedAlpha.value = String(selectedAlpha);
        viewSelectedAlphaReadout.textContent = selectedAlpha.toFixed(2);
    }
    if (!viewLockedColor.matches(':focus')) {
        viewLockedColor.value = colorToHex(view.lockedColor);
    }
    if (!viewLockedAlpha.matches(':focus')) {
        const lockedAlpha = Number(view.lockedColor?.a ?? 1);
        viewLockedAlpha.value = String(lockedAlpha);
        viewLockedAlphaReadout.textContent = lockedAlpha.toFixed(2);
    }
    if (!viewTonemapping.matches(':focus')) {
        viewTonemapping.value = view.tonemapping || 'linear';
    }
    if (!viewFov.matches(':focus')) {
        const fov = Number(view.fov || 60);
        viewFov.value = String(fov);
        viewFovReadout.textContent = String(Math.round(fov));
    }
    if (!viewShBands.matches(':focus')) {
        const shBands = Number(view.shBands ?? 3);
        viewShBands.value = String(shBands);
        viewShBandsReadout.textContent = String(Math.round(shBands));
    }
    if (!viewFlySpeed.matches(':focus')) {
        const flySpeed = Number(view.flySpeed ?? 1);
        viewFlySpeed.value = String(flySpeed);
        viewFlySpeedReadout.textContent = flySpeed.toFixed(1);
    }
    if (!viewPointSize.matches(':focus')) {
        const pointSize = Number(view.pointSize ?? 2);
        viewPointSize.min = String(POINT_SIZE_SLIDER_MIN);
        viewPointSize.max = String(POINT_SIZE_SLIDER_MAX);
        viewPointSize.step = String(POINT_SIZE_SLIDER_STEP);
        viewPointSize.value = String(pointSizeToSlider(pointSize));
        viewPointSizeReadout.textContent = formatPointSizeReadout(pointSize);
    }
    if (!viewRingSize.matches(':focus')) {
        viewRingSize.value = String(Number(view.ringSize ?? 0.04));
        viewRingSizeReadout.textContent = Number(view.ringSize ?? 0.04).toFixed(3);
    }
    viewGridVisible.checked = Boolean(view.gridVisible);
    viewBoundVisible.checked = Boolean(view.boundVisible);
    viewCameraPosesVisible.checked = Boolean(view.cameraPosesVisible);
    viewOutlineSelection.checked = Boolean(view.outlineSelection);
    viewCentersGaussianColor.checked = Boolean(view.centersUseGaussianColor);
    syncColorTriggers();
}

function applyViewPatch(patch, options = {}) {
    const scene = getScene();
    if (!scene || typeof scene.setViewState !== 'function') {
        setStatus('view bridge unavailable', true);
        return;
    }

    const result = scene.setViewState(patch);
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'view update failed', true);
        return;
    }
    if (!options.live) {
        refreshState({ quiet: true });
    }
}

// Coalesce live slider drags into one scene update per animation frame and skip
// the full panel re-render while dragging, so the value reaches the image
// smoothly instead of the panel fighting the drag with a getState()+render on
// every input tick. The readout is updated by the caller for instant feedback.
function scheduleLiveViewPatch(patch) {
    pendingViewPatch = Object.assign(pendingViewPatch || {}, patch);
    pauseViewRerender();
    if (viewApplyHandle !== null) {
        return;
    }
    viewApplyHandle = window.requestAnimationFrame(() => {
        viewApplyHandle = null;
        const patchToApply = pendingViewPatch;
        pendingViewPatch = null;
        if (patchToApply) {
            applyViewPatch(patchToApply, { live: true });
        }
    });
}

async function runProjectAction(action, successMessage) {
    const scene = getScene();
    if (!scene || typeof scene[action] !== 'function') {
        setStatus('project bridge unavailable', true);
        return;
    }

    setStatus(successMessage + ' ...');
    const result = await scene[action]();
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || (successMessage + ' failed'), true);
        return;
    }

    refreshState({ quiet: true });
    setStatus(successMessage + ' complete');
}

function hasNativeProjectSavePicker() {
    return typeof window.showSaveFilePicker === 'function';
}

function canSaveProjectToStream(scene) {
    return Boolean(scene && typeof scene.saveProjectToStream === 'function');
}

function savedTimestamp() {
    return new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function readOptionalNumber(input) {
    const raw = String(input.value || '').trim();
    return raw === '' ? null : Number(raw);
}

function collectDirectorMetadata() {
    return {
        schema: 'supersplat-director.v1',
        savedAt: new Date().toISOString(),
        orbit: {
            durationSeconds: Number(orbitDuration.value || 12),
            keyCount: Number(orbitKeys.value || 16),
            direction: orbitDirection.value || 'counterclockwise',
            lookPitchDegrees: readOptionalNumber(orbitLookPitch),
            lastOrbit
        },
        panel: {
            stageFull: isStageFull(),
            groups: { ...groupOpenState }
        }
    };
}

function applyDirectorMetadata(metadata = {}) {
    if (metadata.orbit && typeof metadata.orbit === 'object') {
        if (Number.isFinite(metadata.orbit.durationSeconds) && !orbitDuration.matches(':focus')) {
            orbitDuration.value = String(metadata.orbit.durationSeconds);
        }
        if (Number.isFinite(metadata.orbit.keyCount) && !orbitKeys.matches(':focus')) {
            orbitKeys.value = String(metadata.orbit.keyCount);
        }
        if (typeof metadata.orbit.direction === 'string' && !orbitDirection.matches(':focus')) {
            orbitDirection.value = metadata.orbit.direction;
        }
        if (!orbitLookPitch.matches(':focus')) {
            orbitLookPitch.value = Number.isFinite(metadata.orbit.lookPitchDegrees)
                ? String(metadata.orbit.lookPitchDegrees)
                : '';
        }
        if (metadata.orbit.lastOrbit && typeof metadata.orbit.lastOrbit === 'object') {
            lastOrbit = metadata.orbit.lastOrbit;
            directorOrbitBuilt = true;
        }
    }

    if (metadata.panel && typeof metadata.panel === 'object') {
        if (typeof metadata.panel.stageFull === 'boolean') {
            setStageFull(metadata.panel.stageFull);
        }
        if (metadata.panel.groups && typeof metadata.panel.groups === 'object') {
            Object.assign(groupOpenState, metadata.panel.groups);
        }
    }
}

function syncDirectorMetadata(scene) {
    if (scene && typeof scene.setDirectorMetadata === 'function') {
        scene.setDirectorMetadata(collectDirectorMetadata());
    }
}

async function chooseProjectSaveHandle() {
    if (!hasNativeProjectSavePicker()) {
        throw new Error('Native file picker unavailable');
    }
    return await window.showSaveFilePicker({
        id: 'SuperSplatDirectorProjectSave',
        types: PROJECT_FILE_TYPES,
        suggestedName: lastState?.documentName || projectFileHandle?.name || 'scene.ssproj'
    });
}

async function writeProjectToHandle(handle) {
    const scene = getScene();
    if (!canSaveProjectToStream(scene)) {
        await runProjectAction('saveProjectAs', 'save as download fallback');
        return;
    }

    syncDirectorMetadata(scene);
    setStatus('saving ' + handle.name + ' ...');
    const stream = await handle.createWritable();
    const result = await scene.saveProjectToStream(stream, handle.name);
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'save failed', true);
        return;
    }

    projectFileHandle = handle;
    refreshState({ quiet: true });
    setStatus('Saved ' + handle.name + ' at ' + savedTimestamp(), false, 'saved');
}

async function saveProject(useSaveAs) {
    const scene = getScene();
    if (!scene) {
        setStatus('project bridge unavailable', true);
        return;
    }

    const canStreamSave = canSaveProjectToStream(scene);
    const canPickHandle = hasNativeProjectSavePicker();

    if (canStreamSave && (projectFileHandle || canPickHandle)) {
        try {
            const handle = useSaveAs || !projectFileHandle ? await chooseProjectSaveHandle() : projectFileHandle;
            await writeProjectToHandle(handle);
            return;
        } catch (error) {
            if (error.name === 'AbortError') {
                setStatus('save cancelled');
                return;
            }
            if (canPickHandle) {
                setStatus((error && error.message) || 'save failed', true);
                return;
            }
        }
    }

    syncDirectorMetadata(scene);
    if (typeof scene.saveProjectAs === 'function') {
        await runProjectAction('saveProjectAs', canPickHandle ? 'save as fallback' : 'save as download fallback');
        return;
    }

    if (typeof scene.saveProject === 'function') {
        await runProjectAction('saveProject', 'save fallback');
        return;
    }

    setStatus('save bridge unavailable', true);
}

async function openProjectFile(file, handle) {
    const scene = getScene();
    if (!scene || typeof scene.openProjectFile !== 'function') {
        setStatus('project bridge unavailable', true);
        return;
    }

    setStatus('opening project ' + file.name + ' ...');
    const result = await scene.openProjectFile(file, handle);
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'open project failed', true);
        return;
    }

    projectFileHandle = handle || null;
    applyDirectorMetadata(result.value?.director);
    refreshState({ quiet: true });
    setStatus(handle
        ? 'Opened ' + file.name + '. Save will update this file.'
        : 'Opened ' + file.name + '. Save will ask where to store the project.');
}

function openProject() {
    projectInput.value = '';
    projectInput.click();
}

function renderState(state, options = {}) {
    renderSceneSummary(state);
    if (options.forceView || canRerenderView()) {
        renderViewControls(state);
    }
    renderTimeline(state);
    renderSelection(state);
    if (options.forceParams || canRerenderParams()) {
        renderParamGroups(state);
    }
}

function refreshState(options = {}) {
    const scene = getScene();
    if (!scene) {
        if (!options.quiet) {
            setStatus('scene bridge unavailable', true);
        }
        return false;
    }

    const result = scene.getState();
    if (!result || !result.ok) {
        if (!options.quiet) {
            setStatus((result && (result.limitation || result.error)) || 'failed to read scene state', true);
        }
        return false;
    }

    lastState = result.value;
    renderState(lastState, options);
    if (!options.quiet) {
        setStatus('scene state synced');
    }
    return true;
}

function handleSceneReady() {
    if (readyPollHandle !== null) {
        window.clearInterval(readyPollHandle);
        readyPollHandle = null;
    }

    readyPollHandle = window.setInterval(() => {
        if (!getScene()) {
            return;
        }
        window.clearInterval(readyPollHandle);
        readyPollHandle = null;
        setStatus('embedded scene ready');
        refreshState({ quiet: true });
        startStatePolling();
    }, 150);
}

function applyTimelinePatch(patch) {
    const scene = getScene();
    if (!scene) {
        setStatus('scene bridge unavailable', true);
        return;
    }

    const result = scene.setState({ timeline: patch });
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'timeline update failed', true);
        return;
    }
    refreshState({ quiet: true });
}

function buildCameraOrbit(options = {}) {
    const scene = getScene();
    if (!scene || typeof scene.buildCameraOrbit !== 'function') {
        setStatus('camera orbit bridge unavailable', true);
        return null;
    }

    const result = scene.buildCameraOrbit({
        durationSeconds: Number(orbitDuration.value || 12),
        keyCount: Number(orbitKeys.value || 16),
        direction: orbitDirection.value,
        lookPitchDegrees: readOptionalNumber(orbitLookPitch)
    });

    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'orbit build failed', true);
        return result;
    }

    const orbit = result.value || {};
    directorOrbitBuilt = true;
    lastOrbit = orbit;
    if (!orbitLookPitch.matches(':focus') && Number.isFinite(orbit.lookPitchDegrees)) {
        orbitLookPitch.value = String(Number(orbit.lookPitchDegrees).toFixed(1));
    }
    orbitSummary.textContent = 'Origin orbit ready: ' + Number(orbit.durationSeconds || 12).toFixed(1) +
        's, ' + orbit.frames + ' frames, ' + orbit.keyCount + ' camera keys, pitch ' +
        Number(orbit.lookPitchDegrees || 0).toFixed(1) + ' deg.';
    if (!options.quiet) {
        setStatus('camera orbit built');
    }
    refreshState({ quiet: true });
    return result;
}

function scheduleLiveParamApply(paramId, value, options = {}) {
    pauseParamRerender();
    if (liveApplyHandle !== null) {
        window.cancelAnimationFrame(liveApplyHandle);
    }

    liveApplyHandle = window.requestAnimationFrame(() => {
        liveApplyHandle = null;
        const scene = getScene();
        if (!scene) {
            return;
        }
        scene.setActiveParam(paramId);
        const result = typeof scene.setParamSliderValue === 'function'
            ? scene.setParamSliderValue(paramId, Number(value))
            : scene.setParamValue(paramId, Number(value));
        if (!result || !result.ok) {
            setStatus((result && (result.limitation || result.error)) || 'parameter update failed', true);
            return;
        }

        const param = result.value || getParamState(paramId);
        if (options.updateKey && param && param.keyedAtFrame) {
            scene.addDisplayKey(paramId);
        }

        const output = paramGroups.querySelector('[data-param-output="' + paramId + '"]');
        if (output) {
            output.textContent = param ? formatValue(param, param.value) : Number(value).toFixed(3).replace(/\.?0+$/, '');
        }
    });
}

function toggleKey(paramId) {
    const scene = getScene();
    if (!scene || !lastState) {
        return;
    }

    const param = (lastState.display.params || []).find((entry) => entry.id === paramId);
    if (!param) {
        return;
    }

    scene.setActiveParam(paramId);
    const result = param.keyedAtFrame ? scene.removeDisplayKey(paramId) : scene.addDisplayKey(paramId);
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'key operation failed', true);
        return;
    }
    refreshState({ quiet: true, forceParams: true });
    setStatus(param.keyedAtFrame ? 'key removed' : 'key added');
}

function runSceneAction(action, paramId) {
    const scene = getScene();
    if (!scene) {
        setStatus('scene bridge unavailable', true);
        return;
    }

    scene.setActiveParam(paramId);

    let result = null;
    let successMessage = 'scene action complete';
    if (action === 'prev-key') {
        result = scene.jumpDisplayKey(paramId, 'prev');
        successMessage = 'previous key';
    } else if (action === 'next-key') {
        result = scene.jumpDisplayKey(paramId, 'next');
        successMessage = 'next key';
    } else if (action === 'reset-param') {
        const param = getParamState(paramId);
        if (!param) {
            setStatus('parameter state unavailable', true);
            return;
        }
        result = scene.setParamValue(paramId, param.default);
        if (result && result.ok && param.keyedAtFrame) {
            scene.addDisplayKey(paramId);
        }
        successMessage = 'default applied';
    } else if (action === 'clear-keys') {
        result = scene.clearDisplayKeys(paramId);
        successMessage = 'keys cleared';
    }

    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'scene action failed', true);
        return;
    }
    refreshState({ quiet: true, forceParams: true });
    setStatus(successMessage);
}

btnImport.addEventListener('click', () => {
    fileInput.click();
});

btnOpenProject.addEventListener('click', () => {
    openProject();
});

projectInput.addEventListener('change', async () => {
    const file = projectInput.files && projectInput.files[0];
    if (!file) {
        return;
    }

    try {
        await openProjectFile(file);
    } finally {
        projectInput.value = '';
    }
});

btnSaveProject.addEventListener('click', async () => {
    await saveProject(false);
});

btnSaveProjectAs.addEventListener('click', async () => {
    await saveProject(true);
});

fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) {
        return;
    }

    const scene = getScene();
    if (!scene || typeof scene.importFiles !== 'function') {
        setStatus('import bridge unavailable', true);
        return;
    }

    setStatus('importing ' + files.map((file) => file.name).join(', ') + ' ...');
    try {
        const result = await scene.importFiles(files);
        if (!result || !result.ok) {
            setStatus((result && (result.limitation || result.error)) || 'import failed', true);
            return;
        }
        refreshState({ quiet: true });
        setStatus('import complete');
    } finally {
        fileInput.value = '';
    }
});

btnRefresh.addEventListener('click', () => {
    refreshState();
});

btnStageFull.addEventListener('click', () => {
    setStageFull(true);
});

btnExitStageFull.addEventListener('click', () => {
    setStageFull(false);
});

btnPlay.addEventListener('click', () => {
    const scene = getScene();
    if (!scene) {
        return;
    }
    if (directorOrbitBuilt && Number(lastState?.timeline?.frame || 0) === 0) {
        const buildResult = buildCameraOrbit({ quiet: true });
        if (!buildResult || !buildResult.ok) {
            return;
        }
    }
    const result = scene.play();
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'play failed', true);
        return;
    }
    refreshState({ quiet: true });
});

btnPause.addEventListener('click', () => {
    const scene = getScene();
    if (!scene) {
        return;
    }
    const result = scene.pause();
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'pause failed', true);
        return;
    }
    refreshState({ quiet: true });
});

btnRestart.addEventListener('click', () => {
    const scene = getScene();
    if (!scene) {
        return;
    }
    scene.pause();
    scene.seek(0);
    refreshState({ quiet: true });
});

timelineRange.addEventListener('input', () => {
    const scene = getScene();
    if (!scene) {
        return;
    }
    scene.pause();
    const max = Math.max(1, Number(timelineRange.max || 1));
    const normalized = Number(timelineRange.value || 0) / max;
    const result = scene.seek(normalized);
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'seek failed', true);
        return;
    }
    refreshState({ quiet: true });
});

timelineFrames.addEventListener('change', () => {
    applyTimelinePatch({ frames: Number(timelineFrames.value || 1) });
});

timelineFps.addEventListener('change', () => {
    applyTimelinePatch({ frameRate: Number(timelineFps.value || 30) });
});

timelineSmoothness.addEventListener('change', () => {
    applyTimelinePatch({ smoothness: Number(timelineSmoothness.value || 1) });
});

btnBuildOrbit.addEventListener('click', () => {
    buildCameraOrbit();
});

btnPreviewOrbit.addEventListener('click', () => {
    const scene = getScene();
    if (!scene) {
        return;
    }
    const buildResult = buildCameraOrbit({ quiet: true });
    if (!buildResult || !buildResult.ok) {
        return;
    }
    scene.seek(0);
    const result = scene.play();
    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'orbit playback failed', true);
        return;
    }
    setStatus('orbit preview playing');
    refreshState({ quiet: true });
});

function pointColorPatch() {
    return { unselectedColor: colorPatch(viewPointColor.value, viewPointAlpha.value) };
}

function selectedColorPatch() {
    return { selectedColor: colorPatch(viewSelectedColor.value, viewSelectedAlpha.value) };
}

function lockedColorPatch() {
    return { lockedColor: colorPatch(viewLockedColor.value, viewLockedAlpha.value) };
}

viewBgColor.addEventListener('input', () => {
    scheduleLiveViewPatch({ background: viewBgColor.value });
});
viewBgColor.addEventListener('change', () => {
    applyViewPatch({ background: viewBgColor.value });
});

viewPointColor.addEventListener('input', () => {
    scheduleLiveViewPatch(pointColorPatch());
});
viewPointColor.addEventListener('change', () => {
    applyViewPatch(pointColorPatch());
});

viewPointAlpha.addEventListener('input', () => {
    viewPointAlphaReadout.textContent = Number(viewPointAlpha.value).toFixed(2);
    scheduleLiveViewPatch(pointColorPatch());
});
viewPointAlpha.addEventListener('change', () => {
    viewPointAlphaReadout.textContent = Number(viewPointAlpha.value).toFixed(2);
    applyViewPatch(pointColorPatch());
});

viewSelectedColor.addEventListener('input', () => {
    scheduleLiveViewPatch(selectedColorPatch());
});
viewSelectedColor.addEventListener('change', () => {
    applyViewPatch(selectedColorPatch());
});

viewSelectedAlpha.addEventListener('input', () => {
    viewSelectedAlphaReadout.textContent = Number(viewSelectedAlpha.value).toFixed(2);
    scheduleLiveViewPatch(selectedColorPatch());
});
viewSelectedAlpha.addEventListener('change', () => {
    viewSelectedAlphaReadout.textContent = Number(viewSelectedAlpha.value).toFixed(2);
    applyViewPatch(selectedColorPatch());
});

viewLockedColor.addEventListener('input', () => {
    scheduleLiveViewPatch(lockedColorPatch());
});
viewLockedColor.addEventListener('change', () => {
    applyViewPatch(lockedColorPatch());
});

viewLockedAlpha.addEventListener('input', () => {
    viewLockedAlphaReadout.textContent = Number(viewLockedAlpha.value).toFixed(2);
    scheduleLiveViewPatch(lockedColorPatch());
});
viewLockedAlpha.addEventListener('change', () => {
    viewLockedAlphaReadout.textContent = Number(viewLockedAlpha.value).toFixed(2);
    applyViewPatch(lockedColorPatch());
});

viewTonemapping.addEventListener('change', () => {
    applyViewPatch({ tonemapping: viewTonemapping.value });
});

viewFov.addEventListener('input', () => {
    viewFovReadout.textContent = String(Math.round(Number(viewFov.value || 60)));
    scheduleLiveViewPatch({ fov: Number(viewFov.value || 60) });
});
viewFov.addEventListener('change', () => {
    applyViewPatch({ fov: Number(viewFov.value || 60) });
});

viewShBands.addEventListener('input', () => {
    viewShBandsReadout.textContent = String(Math.round(Number(viewShBands.value || 0)));
    scheduleLiveViewPatch({ shBands: Number(viewShBands.value || 0) });
});
viewShBands.addEventListener('change', () => {
    applyViewPatch({ shBands: Number(viewShBands.value || 0) });
});

viewFlySpeed.addEventListener('input', () => {
    viewFlySpeedReadout.textContent = Number(viewFlySpeed.value || 1).toFixed(1);
    scheduleLiveViewPatch({ flySpeed: Number(viewFlySpeed.value || 1) });
});
viewFlySpeed.addEventListener('change', () => {
    applyViewPatch({ flySpeed: Number(viewFlySpeed.value || 1) });
});

viewPointSize.addEventListener('input', () => {
    const pointSize = pointSizeFromSlider(viewPointSize.value || pointSizeToSlider(2));
    viewPointSizeReadout.textContent = formatPointSizeReadout(pointSize);
    scheduleLiveViewPatch({ pointSize });
});
viewPointSize.addEventListener('change', () => {
    const pointSize = pointSizeFromSlider(viewPointSize.value || pointSizeToSlider(2));
    viewPointSizeReadout.textContent = formatPointSizeReadout(pointSize);
    applyViewPatch({ pointSize });
});

viewRingSize.addEventListener('input', () => {
    viewRingSizeReadout.textContent = Number(viewRingSize.value || 0.04).toFixed(3);
    scheduleLiveViewPatch({ ringSize: Number(viewRingSize.value || 0.04) });
});
viewRingSize.addEventListener('change', () => {
    viewRingSizeReadout.textContent = Number(viewRingSize.value || 0.04).toFixed(3);
    applyViewPatch({ ringSize: Number(viewRingSize.value || 0.04) });
});

viewGridVisible.addEventListener('change', () => {
    applyViewPatch({ gridVisible: viewGridVisible.checked });
});

viewBoundVisible.addEventListener('change', () => {
    applyViewPatch({ boundVisible: viewBoundVisible.checked });
});

viewCameraPosesVisible.addEventListener('change', () => {
    applyViewPatch({ cameraPosesVisible: viewCameraPosesVisible.checked });
});

viewOutlineSelection.addEventListener('change', () => {
    applyViewPatch({ outlineSelection: viewOutlineSelection.checked });
});

viewCentersGaussianColor.addEventListener('change', () => {
    applyViewPatch({ centersUseGaussianColor: viewCentersGaussianColor.checked });
});

splatList.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) {
        return;
    }

    const scene = getScene();
    if (!scene) {
        return;
    }

    const index = Number(button.dataset.splatIndex);
    const action = button.dataset.action;
    const result = action === 'toggle-splat'
        ? scene.toggleSplatVisibility(index)
        : scene.setSelection(index);

    if (!result || !result.ok) {
        setStatus((result && (result.limitation || result.error)) || 'splat action failed', true);
        return;
    }
    refreshState({ quiet: true });
});

paramGroups.addEventListener('toggle', (event) => {
    const details = event.target.closest('details[data-group-id]');
    if (!details) {
        return;
    }
    groupOpenState[details.dataset.groupId] = details.open;
});

paramGroups.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-action="set-param"]');
    if (!input) {
        return;
    }
    scheduleLiveParamApply(input.dataset.paramId, input.value);
});

paramGroups.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-action="set-param"]');
    if (!input) {
        return;
    }
    scheduleLiveParamApply(input.dataset.paramId, input.value, { updateKey: true });
    window.setTimeout(() => refreshState({ quiet: true }), 40);
});

paramGroups.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
        return;
    }

    const action = button.dataset.action;
    const paramId = button.dataset.paramId;
    if (!paramId) {
        return;
    }

    if (action === 'toggle-key') {
        toggleKey(paramId);
        return;
    }

    if (action === 'prev-key' || action === 'next-key' || action === 'reset-param' || action === 'clear-keys') {
        runSceneAction(action, paramId);
    }
});

frame.addEventListener('load', () => {
    setStatus('waiting for pi-scene bridge...');
    handleSceneReady();
});

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'pi-scene-ready') {
        setStatus('scene reported ready');
        handleSceneReady();
    }
});

window.__directorBoard = {
    getState() {
        return {
            iframeUrl: frame.src,
            stageFull: isStageFull(),
            lastOrbit,
            scene: lastState
        };
    },
    refreshState,
    setStageFull
};

enhanceColorInputs();
viewPointSize.min = String(POINT_SIZE_SLIDER_MIN);
viewPointSize.max = String(POINT_SIZE_SLIDER_MAX);
viewPointSize.step = String(POINT_SIZE_SLIDER_STEP);
viewPointSize.value = String(pointSizeToSlider(2));
viewPointSizeReadout.textContent = formatPointSizeReadout(2);
loadScene();
