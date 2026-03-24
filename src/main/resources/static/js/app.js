const API = '/api/simulations';
const COLORS = { VRR: '#3b82f6', MLFQ: '#8b5cf6', SRTF: '#10b981' };
const PROCESS_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1'
];
const ALGORITHMS = ['VRR', 'MLFQ', 'SRTF'];
const SPEED_PRESETS = [
    { label: 'Muy lenta', ms: 2200 },
    { label: 'Lenta', ms: 1700 },
    { label: 'Normal', ms: 1300 },
    { label: 'Rapida', ms: 950 },
    { label: 'Muy rapida', ms: 700 }
];

let simulationId = null;
let stompClient = null;
let processCounter = 0;
let processColorMap = {};
let playbackHistory = createEmptyPlaybackHistory();
let latestTick = -1;
let isPaused = false;
let reviewTick = null;
let simulationDone = false;
let controlsBusy = false;
let selectedConfigSpeedMs = 1300;
let selectedLiveSpeedMs = 1300;
let tutorialState = {
    active: false,
    steps: [],
    index: 0,
    overlay: null,
    overlayParts: null,
    tooltip: null,
    highlightBox: null,
    completedActions: {},
    highlightedEl: null
};

function createEmptyPlaybackHistory() {
    return { VRR: [], MLFQ: [], SRTF: [] };
}

document.addEventListener('DOMContentLoaded', init);

function init() {
    addDefaultProcesses();
    bindEvents();
}

function bindEvents() {
    document.getElementById('btn-add-process').addEventListener('click', () => addProcessRow());
    document.getElementById('btn-start').addEventListener('click', startSimulation);
    document.getElementById('btn-stop').addEventListener('click', stopSimulation);
    document.getElementById('btn-pause').addEventListener('click', togglePauseResume);
    document.getElementById('btn-next').addEventListener('click', stepNextTick);
    document.getElementById('btn-prev').addEventListener('click', stepPreviousTick);
    document.getElementById('btn-new').addEventListener('click', onNewSimulationClick);
    document.getElementById('btn-tutorial').addEventListener('click', startTutorial);

    setupSpeedPresets();

    window.addEventListener('resize', positionTutorialTooltip);
    window.addEventListener('scroll', positionTutorialTooltip, true);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && tutorialState.active) {
            stopTutorial();
        }
    });

    updatePlaybackControlStates();
}

function setupSpeedPresets() {
    const configButtons = document.querySelectorAll('#speed-preset-config .speed-option');
    const liveButtons = document.querySelectorAll('#speed-preset-live .speed-option');

    configButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const ms = parseInt(btn.dataset.ms);
            setSpeedPreset('config', ms, false);
        });
    });

    liveButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const ms = parseInt(btn.dataset.ms);
            setSpeedPreset('live', ms, true);
        });
    });

    setSpeedPreset('config', selectedConfigSpeedMs, false);
    setSpeedPreset('live', selectedLiveSpeedMs, false);
}

function formatSpeedLabel(ms) {
    const preset = SPEED_PRESETS.find(p => p.ms === ms);
    const name = preset ? preset.label : 'Personalizada';
    return `${name} · ${ms} ms por tick`;
}

function setSpeedPreset(target, ms, notifyServer) {
    const buttons = document.querySelectorAll(`#speed-preset-${target} .speed-option`);
    buttons.forEach(btn => {
        const buttonMs = parseInt(btn.dataset.ms);
        btn.classList.toggle('active', buttonMs === ms);
    });

    const labelId = target === 'config' ? 'speed-label' : 'live-speed-label';
    const labelEl = document.getElementById(labelId);
    if (labelEl) {
        labelEl.textContent = formatSpeedLabel(ms);
    }

    if (target === 'config') {
        selectedConfigSpeedMs = ms;
        return;
    }

    selectedLiveSpeedMs = ms;
    if (!notifyServer || !simulationId) {
        return;
    }

    fetch(`${API}/${simulationId}/speed`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickIntervalMs: ms })
    });
}

function startTutorial() {
    if (tutorialState.active) {
        stopTutorial();
    }

    const steps = buildTutorialSteps();
    if (steps.length === 0) return;

    tutorialState.active = true;
    tutorialState.steps = steps;
    tutorialState.index = 0;
    tutorialState.completedActions = {};

    document.body.classList.add('tutorial-active');

    tutorialState.overlay = document.createElement('div');
    tutorialState.overlay.className = 'tutorial-overlay';

    tutorialState.overlayParts = {
        top: document.createElement('div'),
        left: document.createElement('div'),
        right: document.createElement('div'),
        bottom: document.createElement('div')
    };
    Object.values(tutorialState.overlayParts).forEach(part => {
        part.className = 'tutorial-overlay-part';
        part.addEventListener('click', () => refreshTutorialStep(true));
        tutorialState.overlay.appendChild(part);
    });

    document.body.appendChild(tutorialState.overlay);

    tutorialState.tooltip = document.createElement('div');
    tutorialState.tooltip.className = 'tutorial-tooltip';
    document.body.appendChild(tutorialState.tooltip);

    tutorialState.highlightBox = document.createElement('div');
    tutorialState.highlightBox.className = 'tutorial-highlight-box';
    tutorialState.highlightBox.style.display = 'none';
    document.body.appendChild(tutorialState.highlightBox);

    renderTutorialStep();
}

function stopTutorial() {
    tutorialState.active = false;
    clearTutorialHighlight();

    if (tutorialState.overlay) tutorialState.overlay.remove();
    if (tutorialState.tooltip) tutorialState.tooltip.remove();
    if (tutorialState.highlightBox) tutorialState.highlightBox.remove();

    tutorialState.overlay = null;
    tutorialState.overlayParts = null;
    tutorialState.tooltip = null;
    tutorialState.highlightBox = null;
    tutorialState.completedActions = {};
    tutorialState.steps = [];
    tutorialState.index = 0;

    document.body.classList.remove('tutorial-active');
}

function buildTutorialSteps() {
    return [
        {
            title: 'Paso 1: Antes de empezar',
            text: 'Este es el panel principal. Todo lo que pongas aqui define como sera la simulacion.',
            selector: '#config-panel'
        },
        {
            title: 'Paso 2: Procesos',
            text: 'Cada fila es una tarea que la CPU debe atender. Si cambias estos datos, el resultado cambia mucho.',
            selector: '#process-list'
        },
        {
            title: 'Paso 3: Agregar mas carga',
            text: 'Con este boton puedes crear otro proceso para que la prueba sea mas real.',
            selector: '#btn-add-process'
        },
        {
            title: 'Paso 4: Que significa cada campo',
            text: 'Nombre: etiqueta del proceso. Llegada: cuando aparece. Rafaga: cuanto CPU necesita. Prioridad: que tan urgente es. Color: para identificarlo visualmente.',
            selector: '.process-row'
        },
        {
            title: 'Paso 5: Velocidad de simulacion',
            text: 'Aqui eliges una de cinco velocidades faciles de entender para iniciar la simulacion.',
            selector: '#speed-preset-config'
        },
        {
            title: 'Paso 6: Ajustes de algoritmos',
            text: 'Aqui ajustas quantums. Son limites de tiempo que cambian el comportamiento de Round Robin Virtual y Cola Multinivel Realimentada.',
            selector: '#algorithm-params'
        },
        {
            title: 'Paso 7: Ejecutar',
            text: 'Este boton arranca la simulacion con los datos actuales.',
            selector: '#btn-start'
        },
        {
            title: 'Paso 8: Vista en vivo',
            text: 'Aqui veras los tres algoritmos funcionando al mismo tiempo.',
            selector: '#simulation-panel',
            waitForVisible: true,
            fallbackSelector: '#btn-start',
            waitingText: 'Aun no hay simulacion activa. Pulsa Iniciar Simulacion y luego Reintentar.'
        },
        {
            title: 'Paso 9: Tick y velocidad en vivo',
            text: 'Tick es el reloj de la simulacion. Tambien puedes ajustar la velocidad sin reiniciar.',
            selector: '.sim-controls',
            waitForVisible: true,
            fallbackSelector: '#simulation-panel',
            waitingText: 'Este bloque se muestra cuando la simulacion ya esta corriendo.'
        },
        {
            title: 'Paso 10: Controles tipo reproductor',
            text: 'Usa estos botones para pausar/reanudar, ir al paso anterior, avanzar un tick y detener la simulacion.',
            selector: '.player-controls',
            waitForVisible: true,
            fallbackSelector: '#simulation-panel',
            waitingText: 'Los controles aparecen durante la simulacion activa.'
        },
        {
            title: 'Paso 11: Tarjetas de algoritmos',
            text: 'Cada tarjeta te dice: proceso en CPU, colas de espera y cuanto lleva completado.',
            selector: '.algorithms-grid',
            waitForVisible: true,
            fallbackSelector: '#simulation-panel',
            waitingText: 'Las tarjetas aparecen durante la simulacion activa.'
        },
        {
            title: 'Paso 12: Gantt',
            text: 'Este diagrama guarda el historial. Cada celda muestra quien uso la CPU en cada tick.',
            selector: '.gantt-section',
            waitForVisible: true,
            fallbackSelector: '#simulation-panel',
            waitingText: 'El diagrama de Gantt aparece cuando la simulacion esta en curso.'
        },
        {
            title: 'Paso 13: Leer resultados',
            text: 'Aqui comparas metricas clave. La estrella marca el mejor valor de cada fila.',
            selector: '#results-panel',
            waitForVisible: true,
            fallbackSelector: '.player-controls',
            waitingText: 'Para ver esta seccion, deja terminar la simulacion o pulsa detener.'
        },
        {
            title: 'Paso 14: Volver a intentar',
            text: 'Con este boton limpias todo y haces una simulacion nueva desde cero.',
            selector: '#btn-new',
            waitForVisible: true,
            fallbackSelector: '#results-panel',
            requiredAction: 'newSimulation',
            waitingText: 'Este boton aparece cuando ya existen resultados en pantalla.'
        }
    ];
}

function renderTutorialStep() {
    if (!tutorialState.active || !tutorialState.tooltip) return;

    const step = tutorialState.steps[tutorialState.index];
    const target = resolveTutorialTarget(step);
    const blocked = step.waitForVisible && !isElementVisible(step.selector);
    const actionRequired = !!step.requiredAction;
    const actionDone = !actionRequired || isStepActionCompleted(step.requiredAction);

    clearTutorialHighlight();
    if (target) {
        tutorialState.highlightedEl = target;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        positionTutorialHighlightBox();
    }

    const text = blocked && step.waitingText ? step.waitingText : step.text;
    tutorialState.tooltip.innerHTML = `
        <div class="tutorial-step-title">${step.title}</div>
        <div class="tutorial-step-text">${text}</div>
        ${actionRequired && !actionDone ? '<div class="tutorial-step-note">Para continuar, primero realiza la accion en pantalla.</div>' : ''}
        <div class="tutorial-progress">Paso ${tutorialState.index + 1} de ${tutorialState.steps.length}</div>
        <div class="tutorial-actions">
            <button class="btn btn-secondary" id="tutorial-skip">Saltar guia</button>
            <button class="btn btn-secondary" id="tutorial-prev" ${tutorialState.index === 0 ? 'disabled' : ''}>Atras</button>
            ${blocked ? '<button class="btn btn-secondary" id="tutorial-retry">Reintentar</button>' : ''}
            <button class="btn btn-primary" id="tutorial-next" ${(blocked || !actionDone) ? 'disabled' : ''}>${tutorialState.index === tutorialState.steps.length - 1 ? 'Finalizar' : 'Siguiente'}</button>
        </div>
    `;

    tutorialState.tooltip.querySelector('#tutorial-skip').addEventListener('click', stopTutorial);
    tutorialState.tooltip.querySelector('#tutorial-prev').addEventListener('click', () => changeTutorialStep(-1));
    if (blocked) {
        tutorialState.tooltip.querySelector('#tutorial-retry').addEventListener('click', () => refreshTutorialStep(true));
    }
    tutorialState.tooltip.querySelector('#tutorial-next').addEventListener('click', () => changeTutorialStep(1));

    positionTutorialTooltip();
}

function resolveTutorialTarget(step) {
    if (isElementVisible(step.selector)) {
        return document.querySelector(step.selector);
    }

    if (step.fallbackSelector && isElementVisible(step.fallbackSelector)) {
        return document.querySelector(step.fallbackSelector);
    }

    return null;
}

function isElementVisible(selector) {
    const el = document.querySelector(selector);
    if (!el) return false;

    // Check the whole ancestor chain to avoid highlighting elements inside hidden panels.
    let current = el;
    while (current) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }
        if (current.classList && current.classList.contains('hidden')) {
            return false;
        }
        current = current.parentElement;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function clearTutorialHighlight() {
    if (tutorialState.highlightBox) {
        tutorialState.highlightBox.style.display = 'none';
    }
    updateTutorialOverlayCutout(null);
    tutorialState.highlightedEl = null;
}

function isStepActionCompleted(actionName) {
    return tutorialState.completedActions[actionName] === true;
}

function markTutorialActionCompleted(actionName) {
    if (!actionName) return;
    tutorialState.completedActions[actionName] = true;
}

function onNewSimulationClick() {
    const inRequiredStep = tutorialState.active
        && tutorialState.steps[tutorialState.index]
        && tutorialState.steps[tutorialState.index].requiredAction === 'newSimulation';

    if (inRequiredStep) {
        markTutorialActionCompleted('newSimulation');
    }

    resetUI();

    if (inRequiredStep && tutorialState.active) {
        changeTutorialStep(1);
    }
}

function updateTutorialOverlayCutout(rect) {
    if (!tutorialState.overlayParts) return;

    const top = tutorialState.overlayParts.top;
    const left = tutorialState.overlayParts.left;
    const right = tutorialState.overlayParts.right;
    const bottom = tutorialState.overlayParts.bottom;

    if (!rect) {
        top.style.top = '0';
        top.style.left = '0';
        top.style.width = '100vw';
        top.style.height = '100vh';

        left.style.width = '0';
        right.style.width = '0';
        bottom.style.height = '0';
        return;
    }

    const cutTop = Math.max(0, rect.top);
    const cutLeft = Math.max(0, rect.left);
    const cutRight = Math.min(window.innerWidth, rect.left + rect.width);
    const cutBottom = Math.min(window.innerHeight, rect.top + rect.height);

    top.style.top = '0px';
    top.style.left = '0px';
    top.style.width = '100vw';
    top.style.height = `${cutTop}px`;

    bottom.style.top = `${cutBottom}px`;
    bottom.style.left = '0px';
    bottom.style.width = '100vw';
    bottom.style.height = `${Math.max(0, window.innerHeight - cutBottom)}px`;

    left.style.top = `${cutTop}px`;
    left.style.left = '0px';
    left.style.width = `${cutLeft}px`;
    left.style.height = `${Math.max(0, cutBottom - cutTop)}px`;

    right.style.top = `${cutTop}px`;
    right.style.left = `${cutRight}px`;
    right.style.width = `${Math.max(0, window.innerWidth - cutRight)}px`;
    right.style.height = `${Math.max(0, cutBottom - cutTop)}px`;
}

function positionTutorialHighlightBox() {
    if (!tutorialState.active || !tutorialState.highlightBox || !tutorialState.highlightedEl) return;

    const rect = tutorialState.highlightedEl.getBoundingClientRect();
    const padding = 12;
    const top = Math.max(6, rect.top - padding);
    const left = Math.max(6, rect.left - padding);
    const width = Math.max(20, rect.width + (padding * 2));
    const height = Math.max(20, rect.height + (padding * 2));

    tutorialState.highlightBox.style.top = `${top}px`;
    tutorialState.highlightBox.style.left = `${left}px`;
    const finalWidth = Math.min(width, window.innerWidth - left - 6);
    const finalHeight = Math.min(height, window.innerHeight - top - 6);
    tutorialState.highlightBox.style.width = `${finalWidth}px`;
    tutorialState.highlightBox.style.height = `${finalHeight}px`;
    tutorialState.highlightBox.style.display = 'block';

    updateTutorialOverlayCutout({ top, left, width: finalWidth, height: finalHeight });
}

function changeTutorialStep(delta) {
    if (!tutorialState.active) return;

    const nextIndex = tutorialState.index + delta;
    if (nextIndex < 0) return;

    if (nextIndex >= tutorialState.steps.length) {
        stopTutorial();
        return;
    }

    tutorialState.index = nextIndex;
    renderTutorialStep();
}

function refreshTutorialStep(forceRerender = false) {
    if (!tutorialState.active) return;
    if (forceRerender) {
        renderTutorialStep();
    } else {
        positionTutorialTooltip();
    }
}

function positionTutorialTooltip() {
    if (!tutorialState.active || !tutorialState.tooltip) return;

    positionTutorialHighlightBox();

    const tooltip = tutorialState.tooltip;
    const margin = 12;

    let top = (window.innerHeight - tooltip.offsetHeight) / 2;
    let left = (window.innerWidth - tooltip.offsetWidth) / 2;

    if (tutorialState.highlightedEl) {
        const rect = tutorialState.highlightedEl.getBoundingClientRect();

        const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
        const clampTop = value => clamp(value, margin, window.innerHeight - tooltip.offsetHeight - margin);
        const clampLeft = value => clamp(value, margin, window.innerWidth - tooltip.offsetWidth - margin);

        const targetCenterX = rect.left + rect.width / 2;
        const targetCenterY = rect.top + rect.height / 2;

        const candidates = [
            { top: rect.bottom + margin, left: targetCenterX - tooltip.offsetWidth / 2 }, // below
            { top: rect.top - tooltip.offsetHeight - margin, left: targetCenterX - tooltip.offsetWidth / 2 }, // above
            { top: targetCenterY - tooltip.offsetHeight / 2, left: rect.right + margin }, // right
            { top: targetCenterY - tooltip.offsetHeight / 2, left: rect.left - tooltip.offsetWidth - margin } // left
        ].map(pos => ({
            top: clampTop(pos.top),
            left: clampLeft(pos.left)
        }));

        const paddedTarget = {
            left: rect.left - 6,
            top: rect.top - 6,
            right: rect.right + 6,
            bottom: rect.bottom + 6
        };

        const scoreCandidate = candidate => {
            const tooltipRect = {
                left: candidate.left,
                top: candidate.top,
                right: candidate.left + tooltip.offsetWidth,
                bottom: candidate.top + tooltip.offsetHeight
            };

            const overlapWidth = Math.max(0, Math.min(tooltipRect.right, paddedTarget.right) - Math.max(tooltipRect.left, paddedTarget.left));
            const overlapHeight = Math.max(0, Math.min(tooltipRect.bottom, paddedTarget.bottom) - Math.max(tooltipRect.top, paddedTarget.top));
            const overlapArea = overlapWidth * overlapHeight;

            const tooltipCenterX = candidate.left + tooltip.offsetWidth / 2;
            const tooltipCenterY = candidate.top + tooltip.offsetHeight / 2;
            const distance = Math.hypot(tooltipCenterX - targetCenterX, tooltipCenterY - targetCenterY);

            return { overlapArea, distance };
        };

        let bestCandidate = candidates[0];
        let bestScore = scoreCandidate(bestCandidate);

        for (let i = 1; i < candidates.length; i++) {
            const candidate = candidates[i];
            const score = scoreCandidate(candidate);
            const betterOverlap = score.overlapArea < bestScore.overlapArea;
            const sameOverlapCloser = score.overlapArea === bestScore.overlapArea && score.distance < bestScore.distance;

            if (betterOverlap || sameOverlapCloser) {
                bestCandidate = candidate;
                bestScore = score;
            }
        }

        top = bestCandidate.top;
        left = bestCandidate.left;
    }

    top = Math.max(margin, Math.min(top, window.innerHeight - tooltip.offsetHeight - margin));
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltip.offsetWidth - margin));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}

function setControlsBusy(busy) {
    controlsBusy = busy;
    updatePlaybackControlStates();
}

function updatePlaybackControlStates() {
    const btnPause = document.getElementById('btn-pause');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnStop = document.getElementById('btn-stop');
    if (!btnPause || !btnPrev || !btnNext || !btnStop) return;

    const hasSimulation = !!simulationId;
    const currentViewTick = reviewTick !== null ? reviewTick : latestTick;

    btnPause.disabled = !hasSimulation || simulationDone || controlsBusy;
    btnNext.disabled = !hasSimulation || simulationDone || controlsBusy;
    btnStop.disabled = !hasSimulation || simulationDone || controlsBusy;
    btnPrev.disabled = !hasSimulation || simulationDone || controlsBusy || !isPaused || currentViewTick <= 0;

    btnPause.textContent = isPaused ? '▶' : '⏸';
    btnPause.title = isPaused ? 'Reanudar' : 'Pausar';
}

function saveSnapshot(snapshot) {
    const algo = snapshot.algorithmType;
    if (!playbackHistory[algo]) {
        playbackHistory[algo] = [];
    }
    playbackHistory[algo][snapshot.tick] = snapshot;
    latestTick = Math.max(latestTick, snapshot.tick);
}

function getSnapshotAtOrBeforeTick(algo, tick) {
    const history = playbackHistory[algo] || [];
    for (let t = tick; t >= 0; t--) {
        if (history[t]) return history[t];
    }
    return null;
}

function applySnapshotToAlgorithmPanel(algo, snapshot) {
    const cpuEl = document.getElementById(`cpu-${algo}`);
    const queuesEl = document.getElementById(`queues-${algo}`);
    const progressEl = document.getElementById(`progress-${algo}`);
    const progressTextEl = document.getElementById(`progress-text-${algo}`);

    if (!snapshot) {
        cpuEl.textContent = 'IDLE';
        cpuEl.className = 'cpu-process idle';
        cpuEl.style.background = '';
        queuesEl.innerHTML = '';
        progressEl.style.width = '0%';
        progressTextEl.textContent = '0 / 0';
        return;
    }

    if (snapshot.runningProcessName) {
        cpuEl.textContent = snapshot.runningProcessName;
        cpuEl.className = 'cpu-process active';
        cpuEl.style.background = processColorMap[snapshot.runningProcessId] || '#6366f1';
    } else {
        cpuEl.textContent = 'IDLE';
        cpuEl.className = 'cpu-process idle';
        cpuEl.style.background = '';
    }

    queuesEl.innerHTML = '';
    if (snapshot.queues) {
        Object.entries(snapshot.queues).forEach(([name, ids]) => {
            const row = document.createElement('div');
            row.className = 'queue-row';
            row.innerHTML = `<span class="queue-name">${name}:</span>`;
            ids.forEach(id => {
                const item = document.createElement('span');
                item.className = 'queue-item';
                item.textContent = id;
                item.style.borderColor = processColorMap[id] || '#6366f1';
                row.appendChild(item);
            });
            if (ids.length === 0) {
                const empty = document.createElement('span');
                empty.className = 'queue-item';
                empty.textContent = '—';
                empty.style.opacity = '0.4';
                row.appendChild(empty);
            }
            queuesEl.appendChild(row);
        });
    }

    const pct = snapshot.totalProcesses > 0
        ? (snapshot.completedCount / snapshot.totalProcesses) * 100
        : 0;
    progressEl.style.width = pct + '%';
    progressTextEl.textContent = `${snapshot.completedCount} / ${snapshot.totalProcesses}`;
}

function renderHistoricalTick(tick) {
    if (tick < 0) return;
    document.getElementById('tick-counter').textContent = 'Tick: ' + tick;

    ALGORITHMS.forEach(algo => {
        const snapshot = getSnapshotAtOrBeforeTick(algo, tick);
        applySnapshotToAlgorithmPanel(algo, snapshot);
    });

    rebuildGanttUntilTick(tick);
}

function rebuildGanttUntilTick(tick) {
    ALGORITHMS.forEach(algo => {
        const track = document.getElementById(`gantt-${algo}`);
        track.innerHTML = '';

        for (let t = 0; t <= tick; t++) {
            const snapshot = getSnapshotAtOrBeforeTick(algo, t);
            const cell = document.createElement('div');
            cell.className = 'gantt-cell';

            if (snapshot && snapshot.runningProcessId) {
                cell.style.background = processColorMap[snapshot.runningProcessId] || '#6366f1';
                cell.textContent = snapshot.runningProcessName || '';
                cell.title = `Tick ${t}: ${snapshot.runningProcessName}`;
            } else {
                cell.classList.add('idle');
                cell.textContent = '—';
                cell.title = `Tick ${t}: IDLE`;
            }

            track.appendChild(cell);
        }

        track.scrollLeft = track.scrollWidth;
    });
}

async function pauseSimulationPlayback() {
    if (!simulationId || isPaused || simulationDone) return;
    setControlsBusy(true);
    try {
        await fetch(`${API}/${simulationId}/pause`, { method: 'PATCH' });
        isPaused = true;
    } finally {
        setControlsBusy(false);
    }
}

async function resumeSimulationPlayback() {
    if (!simulationId || !isPaused || simulationDone) return;
    setControlsBusy(true);
    try {
        if (reviewTick !== null && latestTick >= 0) {
            reviewTick = null;
            renderHistoricalTick(latestTick);
        }
        await fetch(`${API}/${simulationId}/resume`, { method: 'PATCH' });
        isPaused = false;
    } finally {
        setControlsBusy(false);
    }
}

async function togglePauseResume() {
    if (isPaused) {
        await resumeSimulationPlayback();
    } else {
        await pauseSimulationPlayback();
    }
}

async function ensurePausedForStep() {
    if (!isPaused) {
        await pauseSimulationPlayback();
    }
}

async function stepPreviousTick() {
    if (!simulationId || simulationDone) return;
    await ensurePausedForStep();
    if (latestTick <= 0) {
        updatePlaybackControlStates();
        return;
    }

    const baseTick = reviewTick !== null ? reviewTick : latestTick;
    if (baseTick <= 0) {
        updatePlaybackControlStates();
        return;
    }

    reviewTick = baseTick - 1;
    renderHistoricalTick(reviewTick);
    updatePlaybackControlStates();
}

async function stepNextTick() {
    if (!simulationId || simulationDone) return;
    await ensurePausedForStep();

    if (reviewTick !== null && reviewTick < latestTick) {
        reviewTick += 1;
        renderHistoricalTick(reviewTick);
        if (reviewTick === latestTick) {
            reviewTick = null;
        }
        updatePlaybackControlStates();
        return;
    }

    reviewTick = null;
    setControlsBusy(true);
    try {
        await fetch(`${API}/${simulationId}/step`, { method: 'PATCH' });
    } finally {
        setControlsBusy(false);
    }
}

function addDefaultProcesses() {
    const defaults = [
        { name: 'P1', arrival: 0, burst: 6, priority: 1 },
        { name: 'P2', arrival: 1, burst: 4, priority: 2 },
        { name: 'P3', arrival: 2, burst: 8, priority: 1 },
        { name: 'P4', arrival: 3, burst: 3, priority: 3 },
        { name: 'P5', arrival: 5, burst: 5, priority: 2 }
    ];
    defaults.forEach(p => addProcessRow(p));
}

function addProcessRow(data = null) {
    processCounter++;
    const id = processCounter;
    const defaultColor = data && data.color
        ? data.color
        : PROCESS_COLORS[(id - 1) % PROCESS_COLORS.length];
    const container = document.getElementById('process-list');
    const row = document.createElement('div');
    row.className = 'process-row';
    row.id = `proc-row-${id}`;
    row.innerHTML = `
        <label>Nombre<input type="text" class="p-name" value="${data ? data.name : 'P' + id}"></label>
        <label>Llegada<input type="number" class="p-arrival" value="${data ? data.arrival : 0}" min="0"></label>
        <label>Ráfaga<input type="number" class="p-burst" value="${data ? data.burst : 4}" min="1"></label>
        <label>Prioridad<input type="number" class="p-priority" value="${data ? data.priority : 1}" min="1"></label>
        <label class="color-field">Color<input type="color" class="p-color" value="${defaultColor}" aria-label="Color del proceso"></label>
        <button class="btn-remove" onclick="removeProcess(${id})">✕</button>
    `;
    container.appendChild(row);
}

function removeProcess(id) {
    const row = document.getElementById(`proc-row-${id}`);
    if (row) row.remove();
}

function collectProcesses() {
    const rows = document.querySelectorAll('.process-row');
    const processes = [];
    let idx = 0;
    rows.forEach(row => {
        const name = row.querySelector('.p-name').value.trim() || ('P' + (idx + 1));
        const arrival = parseInt(row.querySelector('.p-arrival').value) || 0;
        const burst = parseInt(row.querySelector('.p-burst').value) || 1;
        const priority = parseInt(row.querySelector('.p-priority').value) || 1;
        const color = row.querySelector('.p-color')?.value || PROCESS_COLORS[idx % PROCESS_COLORS.length];
        processes.push({
            id: 'p' + (idx + 1),
            name: name,
            arrivalTime: arrival,
            burstTime: burst,
            priority: priority
        });
        processColorMap['p' + (idx + 1)] = color;
        idx++;
    });
    return processes;
}

async function startSimulation() {
    const processes = collectProcesses();
    if (processes.length === 0) return;

    const speed = selectedConfigSpeedMs;
    const config = {
        processes: processes,
        tickIntervalMs: speed,
        vrrQuantum: parseInt(document.getElementById('vrr-quantum').value) || 4,
        mlfqQuantums: [
            parseInt(document.getElementById('mlfq-q0').value) || 2,
            parseInt(document.getElementById('mlfq-q1').value) || 4,
            parseInt(document.getElementById('mlfq-q2').value) || 8
        ],
        batchMode: false
    };

    try {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        const result = await res.json();
        simulationId = result.simulationId;
        playbackHistory = createEmptyPlaybackHistory();
        latestTick = -1;
        isPaused = false;
        reviewTick = null;
        simulationDone = false;
        updatePlaybackControlStates();

        document.getElementById('config-panel').classList.add('hidden');
        document.getElementById('simulation-panel').classList.remove('hidden');
        document.getElementById('results-panel').classList.add('hidden');
        setSpeedPreset('live', speed, false);

        clearGantt();
        connectWebSocket();
        refreshTutorialStep(true);
    } catch (err) {
        console.error('Error starting simulation:', err);
    }
}

async function stopSimulation() {
    if (!simulationId || simulationDone) return;
    setControlsBusy(true);
    try {
        await fetch(`${API}/${simulationId}`, { method: 'DELETE' });
    } catch (e) {
        // Ignore stop API errors and try to load current result anyway.
    } finally {
        disconnectWebSocket();
        isPaused = true;
        simulationDone = true;
        await loadFinalResults();
        setControlsBusy(false);
    }
}

async function loadFinalResults() {
    if (!simulationId) return;
    try {
        const res = await fetch(`${API}/${simulationId}/result`);
        if (!res.ok) return;
        const result = await res.json();
        showResults(result);
    } catch (e) {
        console.error('Error loading results:', e);
    }
}

function connectWebSocket() {
    const socket = new SockJS('/ws/simulation');
    stompClient = Stomp.over(socket);
    stompClient.debug = null;

    stompClient.connect({}, () => {
        stompClient.subscribe(`/topic/simulation/${simulationId}/tick`, msg => {
            const snapshot = JSON.parse(msg.body);
            saveSnapshot(snapshot);
            if (reviewTick === null) {
                updateAlgorithmPanel(snapshot);
                updateGantt(snapshot);
            }
            updatePlaybackControlStates();
        });

        stompClient.subscribe(`/topic/simulation/${simulationId}/result`, msg => {
            const result = JSON.parse(msg.body);
            disconnectWebSocket();
            simulationDone = true;
            isPaused = true;
            reviewTick = null;
            updatePlaybackControlStates();
            showResults(result);
        });
    });
}

function disconnectWebSocket() {
    if (stompClient && stompClient.connected) {
        stompClient.disconnect();
    }
    stompClient = null;
}

function updateAlgorithmPanel(snapshot) {
    const algo = snapshot.algorithmType;
    document.getElementById('tick-counter').textContent = 'Tick: ' + snapshot.tick;
    applySnapshotToAlgorithmPanel(algo, snapshot);
}

function clearGantt() {
    ['VRR', 'MLFQ', 'SRTF'].forEach(a => {
        document.getElementById(`gantt-${a}`).innerHTML = '';
    });
}

function updateGantt(snapshot) {
    const algo = snapshot.algorithmType;
    const track = document.getElementById(`gantt-${algo}`);
    const cell = document.createElement('div');
    cell.className = 'gantt-cell';

    if (snapshot.runningProcessId) {
        cell.style.background = processColorMap[snapshot.runningProcessId] || '#6366f1';
        cell.textContent = snapshot.runningProcessName || '';
        cell.title = `Tick ${snapshot.tick}: ${snapshot.runningProcessName}`;
    } else {
        cell.classList.add('idle');
        cell.textContent = '—';
        cell.title = `Tick ${snapshot.tick}: IDLE`;
    }

    track.appendChild(cell);
    track.scrollLeft = track.scrollWidth;
}

function showResults(result) {
    document.getElementById('results-panel').classList.remove('hidden');
    simulationDone = true;
    isPaused = true;
    reviewTick = null;
    updatePlaybackControlStates();
    refreshTutorialStep(true);

    if (!result.stats || result.stats.length === 0) return;

    const metrics = [
        { key: 'cpuUtilization', label: 'Utilización CPU (%)', higher: true },
        { key: 'throughput', label: 'Throughput (proc/tick)', higher: true },
        { key: 'avgTurnaroundTime', label: 'Turnaround Time (avg)', higher: false },
        { key: 'avgWaitingTime', label: 'Waiting Time (avg)', higher: false },
        { key: 'avgResponseTime', label: 'Response Time (avg)', higher: false },
        { key: 'fairnessIndex', label: 'Fairness Index (Jain)', higher: true }
    ];

    const statsByAlgo = {};
    result.stats.forEach(s => { statsByAlgo[s.algorithmType] = s; });

    const tbody = document.getElementById('stats-body');
    tbody.innerHTML = '';

    metrics.forEach(m => {
        const vrr = statsByAlgo['VRR'] ? statsByAlgo['VRR'][m.key] : 0;
        const mlfq = statsByAlgo['MLFQ'] ? statsByAlgo['MLFQ'][m.key] : 0;
        const srtf = statsByAlgo['SRTF'] ? statsByAlgo['SRTF'][m.key] : 0;

        const vals = [vrr, mlfq, srtf];
        const best = m.higher ? Math.max(...vals) : Math.min(...vals);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${m.label}</td>
            <td class="${vrr === best ? 'best' : ''}">${vrr}</td>
            <td class="${mlfq === best ? 'best' : ''}">${mlfq}</td>
            <td class="${srtf === best ? 'best' : ''}">${srtf}</td>
        `;
        tbody.appendChild(tr);
    });
}

function resetUI() {
    disconnectWebSocket();
    simulationId = null;
    playbackHistory = createEmptyPlaybackHistory();
    latestTick = -1;
    isPaused = false;
    reviewTick = null;
    simulationDone = false;
    document.getElementById('config-panel').classList.remove('hidden');
    document.getElementById('simulation-panel').classList.add('hidden');
    document.getElementById('results-panel').classList.add('hidden');
    document.getElementById('tick-counter').textContent = 'Tick: 0';

    ['VRR', 'MLFQ', 'SRTF'].forEach(a => {
        document.getElementById(`cpu-${a}`).textContent = 'IDLE';
        document.getElementById(`cpu-${a}`).className = 'cpu-process idle';
        document.getElementById(`cpu-${a}`).style.background = '';
        document.getElementById(`queues-${a}`).innerHTML = '';
        document.getElementById(`progress-${a}`).style.width = '0%';
        document.getElementById(`progress-text-${a}`).textContent = '0 / 0';
        document.getElementById(`gantt-${a}`).innerHTML = '';
    });

    updatePlaybackControlStates();
    refreshTutorialStep(true);
}

