package co.edu.uptc.planification_model_service.services.algorithms;

import co.edu.uptc.planification_model_service.models.SimulationConfig;
import co.edu.uptc.planification_model_service.models.SimulationProcess;
import co.edu.uptc.planification_model_service.models.TickSnapshot;
import co.edu.uptc.planification_model_service.models.enums.AlgorithmType;
import co.edu.uptc.planification_model_service.models.enums.ProcessState;

import java.util.*;
import java.util.stream.Collectors;

public class MlfqScheduler implements SchedulingAlgorithm {

    private static final int NUM_QUEUES = 3;

    private List<SimulationProcess> allProcesses;
    private final List<Deque<SimulationProcess>> queues = new ArrayList<>();
    private int[] quantums;
    private SimulationProcess running;
    private int busyTicks;
    private boolean batchMode;
    private int currentBatchGroup;

    @Override
    public void initialize(List<SimulationProcess> processes, SimulationConfig config) {
        this.allProcesses = processes;
        this.quantums = config.getMlfqQuantums();
        this.batchMode = config.isBatchMode();
        this.currentBatchGroup = 0;
        for (int i = 0; i < NUM_QUEUES; i++) {
            queues.add(new ArrayDeque<>());
        }
    }

    @Override
    public TickSnapshot tick(int currentTick) {
        admitArrivals(currentTick);
        checkPreemption();

        if (running == null) {
            running = selectNext();
            if (running != null) {
                running.setState(ProcessState.RUNNING);
                if (!running.isHasStarted()) {
                    running.setFirstRunTick(currentTick);
                    running.setHasStarted(true);
                }
            }
        }

        if (running != null) {
            running.setRemainingTime(running.getRemainingTime() - 1);
            running.setCurrentQuantumUsed(running.getCurrentQuantumUsed() + 1);
            busyTicks++;

            int level = running.getCurrentQueueLevel();
            int qSize = quantums[Math.min(level, NUM_QUEUES - 1)];

            if (running.getRemainingTime() <= 0) {
                completeProcess(running, currentTick);
                running = null;
                if (batchMode) tryAdvanceBatch();
            } else if (running.getCurrentQuantumUsed() >= qSize) {
                running.setState(ProcessState.READY);
                int newLevel = Math.min(level + 1, NUM_QUEUES - 1);
                running.setCurrentQueueLevel(newLevel);
                running.setCurrentQuantumUsed(0);
                queues.get(newLevel).addLast(running);
                running = null;
            }
        }

        for (Deque<SimulationProcess> q : queues) {
            for (SimulationProcess p : q) {
                p.setWaitingTime(p.getWaitingTime() + 1);
            }
        }

        return buildSnapshot(currentTick);
    }

    private void checkPreemption() {
        if (running == null) return;
        int runningLevel = running.getCurrentQueueLevel();
        for (int i = 0; i < runningLevel; i++) {
            if (!queues.get(i).isEmpty()) {
                running.setState(ProcessState.READY);
                running.setCurrentQuantumUsed(0);
                queues.get(running.getCurrentQueueLevel()).addFirst(running);
                running = null;
                break;
            }
        }
    }

    private SimulationProcess selectNext() {
        for (Deque<SimulationProcess> q : queues) {
            if (!q.isEmpty()) return q.pollFirst();
        }
        return null;
    }

    private void admitArrivals(int tick) {
        for (SimulationProcess p : allProcesses) {
            if (p.getState() != ProcessState.NEW) continue;
            boolean canArrive = batchMode
                    ? (p.getBatchGroup() != null && p.getBatchGroup() == currentBatchGroup && p.getArrivalTime() <= tick)
                    : (p.getArrivalTime() <= tick);
            if (canArrive) {
                p.setState(ProcessState.READY);
                p.setCurrentQueueLevel(0);
                queues.getFirst().addLast(p);
            }
        }
    }

    private void completeProcess(SimulationProcess p, int tick) {
        p.setState(ProcessState.DONE);
        p.setCompletionTick(tick + 1);
        p.setTurnaroundTime(p.getCompletionTick() - p.getArrivalTime());
        p.setWaitingTime(p.getTurnaroundTime() - p.getBurstTime());
        p.setResponseTime(p.getFirstRunTick() - p.getArrivalTime());
    }

    private void tryAdvanceBatch() {
        boolean done = allProcesses.stream()
                .filter(p -> p.getBatchGroup() != null && p.getBatchGroup() == currentBatchGroup)
                .allMatch(p -> p.getState() == ProcessState.DONE);
        if (done) currentBatchGroup++;
    }

    private TickSnapshot buildSnapshot(int tick) {
        Map<String, List<String>> qMap = new LinkedHashMap<>();
        for (int i = 0; i < queues.size(); i++) {
            qMap.put("Q" + i, queues.get(i).stream().map(SimulationProcess::getId).collect(Collectors.toList()));
        }
        long completed = allProcesses.stream().filter(p -> p.getState() == ProcessState.DONE).count();
        return TickSnapshot.builder()
                .tick(tick)
                .algorithmType(AlgorithmType.MLFQ)
                .runningProcessId(running != null ? running.getId() : null)
                .runningProcessName(running != null ? running.getName() : null)
                .queues(qMap)
                .completedCount((int) completed)
                .totalProcesses(allProcesses.size())
                .cpuBusyRatio(tick > 0 ? (double) busyTicks / (tick + 1) : 0)
                .build();
    }

    @Override
    public boolean isFinished() {
        if (running != null) return false;
        for (Deque<SimulationProcess> q : queues) {
            if (!q.isEmpty()) return false;
        }
        return allProcesses.stream().allMatch(p -> p.getState() == ProcessState.DONE);
    }

    @Override
    public List<SimulationProcess> getProcesses() {
        return allProcesses;
    }

    @Override
    public int getBusyTicks() {
        return busyTicks;
    }
}
