package co.edu.uptc.planification_model_service.services.algorithms;

import co.edu.uptc.planification_model_service.models.SimulationConfig;
import co.edu.uptc.planification_model_service.models.SimulationProcess;
import co.edu.uptc.planification_model_service.models.TickSnapshot;
import co.edu.uptc.planification_model_service.models.enums.AlgorithmType;
import co.edu.uptc.planification_model_service.models.enums.ProcessState;

import java.util.*;
import java.util.stream.Collectors;

public class SrtfScheduler implements SchedulingAlgorithm {

    private List<SimulationProcess> allProcesses;
    private final List<SimulationProcess> readyQueue = new ArrayList<>();
    private SimulationProcess running;
    private int busyTicks;
    private boolean batchMode;
    private int currentBatchGroup;

    @Override
    public void initialize(List<SimulationProcess> processes, SimulationConfig config) {
        this.allProcesses = processes;
        this.batchMode = config.isBatchMode();
        this.currentBatchGroup = 0;
    }

    @Override
    public TickSnapshot tick(int currentTick) {
        admitArrivals(currentTick);
        checkPreemption();

        if (running == null) {
            running = selectShortest();
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
            busyTicks++;

            if (running.getRemainingTime() <= 0) {
                completeProcess(running, currentTick);
                running = null;
                if (batchMode) tryAdvanceBatch();
            }
        }

        for (SimulationProcess p : readyQueue) {
            p.setWaitingTime(p.getWaitingTime() + 1);
        }

        return buildSnapshot(currentTick);
    }

    private void checkPreemption() {
        if (running == null || readyQueue.isEmpty()) return;
        SimulationProcess shortest = readyQueue.stream()
                .min(Comparator.comparingInt(SimulationProcess::getRemainingTime))
                .orElse(null);
        if (shortest != null && shortest.getRemainingTime() < running.getRemainingTime()) {
            running.setState(ProcessState.READY);
            readyQueue.add(running);
            running = null;
        }
    }

    private SimulationProcess selectShortest() {
        if (readyQueue.isEmpty()) return null;
        SimulationProcess shortest = readyQueue.stream()
                .min(Comparator.comparingInt(SimulationProcess::getRemainingTime))
                .orElse(null);
        readyQueue.remove(shortest);
        return shortest;
    }

    private void admitArrivals(int tick) {
        for (SimulationProcess p : allProcesses) {
            if (p.getState() != ProcessState.NEW) continue;
            boolean canArrive = batchMode
                    ? (p.getBatchGroup() != null && p.getBatchGroup() == currentBatchGroup && p.getArrivalTime() <= tick)
                    : (p.getArrivalTime() <= tick);
            if (canArrive) {
                p.setState(ProcessState.READY);
                readyQueue.add(p);
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
        qMap.put("READY", readyQueue.stream().map(SimulationProcess::getId).collect(Collectors.toList()));
        long completed = allProcesses.stream().filter(p -> p.getState() == ProcessState.DONE).count();
        return TickSnapshot.builder()
                .tick(tick)
                .algorithmType(AlgorithmType.SRTF)
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
        return running == null && readyQueue.isEmpty()
                && allProcesses.stream().allMatch(p -> p.getState() == ProcessState.DONE);
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
