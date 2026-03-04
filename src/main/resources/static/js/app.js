const API = '/api/simulations';
const COLORS = { VRR: '#3b82f6', MLFQ: '#8b5cf6', SRTF: '#10b981' };
const PROCESS_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1'
];

let simulationId = null;
let stompClient = null;
let processCounter = 0;
let processColorMap = {};
let comparisonChart = null;
let cpuChart = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
    addDefaultProcesses();
    bindEvents();
}

function bindEvents() {
    document.getElementById('btn-add-process').addEventListener('click', () => addProcessRow());
    document.getElementById('btn-start').addEventListener('click', startSimulation);
    document.getElementById('btn-stop').addEventListener('click', stopSimulation);
    document.getElementById('btn-new').addEventListener('click', resetUI);

    document.getElementById('speed-slider').addEventListener('input', e => {
        document.getElementById('speed-label').textContent = e.target.value + ' ms';
    });

    document.getElementById('live-speed').addEventListener('input', e => {
        document.getElementById('live-speed-label').textContent = e.target.value + ' ms';
    });

    document.getElementById('live-speed').addEventListener('change', e => {
        if (!simulationId) return;
        fetch(`${API}/${simulationId}/speed`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickIntervalMs: parseInt(e.target.value) })
        });
    });
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
    const container = document.getElementById('process-list');
    const row = document.createElement('div');
    row.className = 'process-row';
    row.id = `proc-row-${id}`;
    row.innerHTML = `
        <label>Nombre<input type="text" class="p-name" value="${data ? data.name : 'P' + id}"></label>
        <label>Llegada<input type="number" class="p-arrival" value="${data ? data.arrival : 0}" min="0"></label>
        <label>Ráfaga<input type="number" class="p-burst" value="${data ? data.burst : 4}" min="1"></label>
        <label>Prioridad<input type="number" class="p-priority" value="${data ? data.priority : 1}" min="1"></label>
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
        processes.push({
            id: 'p' + (idx + 1),
            name: name,
            arrivalTime: arrival,
            burstTime: burst,
            priority: priority
        });
        processColorMap['p' + (idx + 1)] = PROCESS_COLORS[idx % PROCESS_COLORS.length];
        idx++;
    });
    return processes;
}

async function startSimulation() {
    const processes = collectProcesses();
    if (processes.length === 0) return;

    const speed = parseInt(document.getElementById('speed-slider').value);
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

        document.getElementById('config-panel').classList.add('hidden');
        document.getElementById('simulation-panel').classList.remove('hidden');
        document.getElementById('results-panel').classList.add('hidden');
        document.getElementById('btn-stop').disabled = false;
        document.getElementById('live-speed').value = speed;
        document.getElementById('live-speed-label').textContent = speed + ' ms';

        clearGantt();
        connectWebSocket();
    } catch (err) {
        console.error('Error starting simulation:', err);
    }
}

async function stopSimulation() {
    if (!simulationId) return;
    try {
        await fetch(`${API}/${simulationId}`, { method: 'DELETE' });
    } catch (e) { /* ignore */ }
    document.getElementById('btn-stop').disabled = true;
    disconnectWebSocket();
    await loadFinalResults();
}

function connectWebSocket() {
    const socket = new SockJS('/ws/simulation');
    stompClient = Stomp.over(socket);
    stompClient.debug = null;

    stompClient.connect({}, () => {
        stompClient.subscribe(`/topic/simulation/${simulationId}/tick`, msg => {
            const snapshot = JSON.parse(msg.body);
            updateAlgorithmPanel(snapshot);
            updateGantt(snapshot);
        });

        stompClient.subscribe(`/topic/simulation/${simulationId}/result`, msg => {
            const result = JSON.parse(msg.body);
            document.getElementById('btn-stop').disabled = true;
            disconnectWebSocket();
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

    const cpuEl = document.getElementById(`cpu-${algo}`);
    if (snapshot.runningProcessName) {
        cpuEl.textContent = snapshot.runningProcessName;
        cpuEl.className = 'cpu-process active';
        cpuEl.style.background = processColorMap[snapshot.runningProcessId] || '#6366f1';
    } else {
        cpuEl.textContent = 'IDLE';
        cpuEl.className = 'cpu-process idle';
        cpuEl.style.background = '';
    }

    const queuesEl = document.getElementById(`queues-${algo}`);
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
        ? (snapshot.completedCount / snapshot.totalProcesses) * 100 : 0;
    document.getElementById(`progress-${algo}`).style.width = pct + '%';
    document.getElementById(`progress-text-${algo}`).textContent =
        `${snapshot.completedCount} / ${snapshot.totalProcesses}`;
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

async function loadFinalResults() {
    if (!simulationId) return;
    try {
        const res = await fetch(`${API}/${simulationId}/result`);
        const result = await res.json();
        showResults(result);
    } catch (e) {
        console.error('Error loading results:', e);
    }
}

function showResults(result) {
    document.getElementById('results-panel').classList.remove('hidden');

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

    renderCharts(statsByAlgo);
}

function renderCharts(statsByAlgo) {
    if (comparisonChart) comparisonChart.destroy();
    if (cpuChart) cpuChart.destroy();

    const labels = ['Turnaround', 'Waiting', 'Response'];
    const vrrData = [
        statsByAlgo['VRR']?.avgTurnaroundTime || 0,
        statsByAlgo['VRR']?.avgWaitingTime || 0,
        statsByAlgo['VRR']?.avgResponseTime || 0
    ];
    const mlfqData = [
        statsByAlgo['MLFQ']?.avgTurnaroundTime || 0,
        statsByAlgo['MLFQ']?.avgWaitingTime || 0,
        statsByAlgo['MLFQ']?.avgResponseTime || 0
    ];
    const srtfData = [
        statsByAlgo['SRTF']?.avgTurnaroundTime || 0,
        statsByAlgo['SRTF']?.avgWaitingTime || 0,
        statsByAlgo['SRTF']?.avgResponseTime || 0
    ];

    comparisonChart = new Chart(document.getElementById('chart-comparison'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'VRR', data: vrrData, backgroundColor: COLORS.VRR + 'cc', borderColor: COLORS.VRR, borderWidth: 1 },
                { label: 'MLFQ', data: mlfqData, backgroundColor: COLORS.MLFQ + 'cc', borderColor: COLORS.MLFQ, borderWidth: 1 },
                { label: 'SRTF', data: srtfData, backgroundColor: COLORS.SRTF + 'cc', borderColor: COLORS.SRTF, borderWidth: 1 }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: 'Comparación de Tiempos', color: '#e4e4e7' },
                legend: { labels: { color: '#9ca3af' } }
            },
            scales: {
                x: { ticks: { color: '#9ca3af' }, grid: { color: '#2a2d3a' } },
                y: { ticks: { color: '#9ca3af' }, grid: { color: '#2a2d3a' }, beginAtZero: true }
            }
        }
    });

    cpuChart = new Chart(document.getElementById('chart-cpu'), {
        type: 'doughnut',
        data: {
            labels: ['VRR', 'MLFQ', 'SRTF'],
            datasets: [{
                data: [
                    statsByAlgo['VRR']?.cpuUtilization || 0,
                    statsByAlgo['MLFQ']?.cpuUtilization || 0,
                    statsByAlgo['SRTF']?.cpuUtilization || 0
                ],
                backgroundColor: [COLORS.VRR + 'cc', COLORS.MLFQ + 'cc', COLORS.SRTF + 'cc'],
                borderColor: [COLORS.VRR, COLORS.MLFQ, COLORS.SRTF],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: 'Utilización de CPU (%)', color: '#e4e4e7' },
                legend: { labels: { color: '#9ca3af' } }
            }
        }
    });
}

function resetUI() {
    simulationId = null;
    document.getElementById('config-panel').classList.remove('hidden');
    document.getElementById('simulation-panel').classList.add('hidden');
    document.getElementById('results-panel').classList.add('hidden');
    document.getElementById('btn-stop').disabled = true;
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

    if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
    if (cpuChart) { cpuChart.destroy(); cpuChart = null; }
}

