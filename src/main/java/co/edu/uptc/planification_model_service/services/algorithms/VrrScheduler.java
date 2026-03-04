package co.edu.uptc.planification_model_service.services.algorithms;

import co.edu.uptc.planification_model_service.models.SimulationConfig;
import co.edu.uptc.planification_model_service.models.SimulationProcess;
import co.edu.uptc.planification_model_service.models.TickSnapshot;
import co.edu.uptc.planification_model_service.models.enums.AlgorithmType;
import co.edu.uptc.planification_model_service.models.enums.ProcessState;

import java.util.*;
import java.util.stream.Collectors;

public class VrrScheduler implements SchedulingAlgorithm {

    private List<SimulationProcess> allProcesses;
    private final Deque<SimulationProcess> readyQueue = new ArrayDeque<>();
    private final Deque<SimulationProcess> auxQueue = new ArrayDeque<>();
    private SimulationProcess running;
    private int quantum;
    private int busyTicks;
    private boolean batchMode;
    private int currentBatchGroup;

    @Override
    public void initialize(List<SimulationProcess> processes, SimulationConfig config) {
        this.allProcesses = processes;
        this.quantum = config.getVrrQuantum();
        this.batchMode = config.isBatchMode();
        this.currentBatchGroup = 0;
    }

    @Override
    public TickSnapshot tick(int currentTick) {
        admitArrivals(currentTick);

        if (running != null && running.getRemainingQuantum() <= 0) {
            running.setState(ProcessState.READY);
            readyQueue.addLast(running);
            running = null;
        }

        if (running == null) {
            if (!auxQueue.isEmpty()) {
                running = auxQueue.pollFirst();
            } else if (!readyQueue.isEmpty()) {
                running = readyQueue.pollFirst();
                running.setRemainingQuantum(quantum);
            }
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
            running.setRemainingQuantum(running.getRemainingQuantum() - 1);
            busyTicks++;

            if (running.getRemainingTime() <= 0) {
                completeProcess(running, currentTick);
                running = null;
                if (batchMode) tryAdvanceBatch();
            } else if (running.getRemainingQuantum() <= 0) {
                running.setState(ProcessState.READY);
                readyQueue.addLast(running);
                running = null;
            }
        }

        incrementWaitingTime(readyQueue);
        incrementWaitingTime(auxQueue);

        return buildSnapshot(currentTick);
    }

    private void admitArrivals(int tick) {
        for (SimulationProcess p : allProcesses) {
            if (p.getState() != ProcessState.NEW) continue;
            if (batchMode) {
                if (p.getBatchGroup() != null && p.getBatchGroup() == currentBatchGroup && p.getArrivalTime() <= tick) {
                    p.setState(ProcessState.READY);
                    readyQueue.addLast(p);
                }
            } else if (p.getArrivalTime() <= tick) {
                p.setState(ProcessState.READY);
                readyQueue.addLast(p);
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

    private void incrementWaitingTime(Deque<SimulationProcess> queue) {
        for (SimulationProcess p : queue) {
            if (p.getState() == ProcessState.READY) {
                p.setWaitingTime(p.getWaitingTime() + 1);
            }
        }
    }

    private void tryAdvanceBatch() {
        boolean done = allProcesses.stream()
                .filter(p -> p.getBatchGroup() != null && p.getBatchGroup() == currentBatchGroup)
                .allMatch(p -> p.getState() == ProcessState.DONE);
        if (done) currentBatchGroup++;
    }

    private TickSnapshot buildSnapshot(int tick) {
        Map<String, List<String>> queues = new LinkedHashMap<>();
        queues.put("READY", readyQueue.stream().map(SimulationProcess::getId).collect(Collectors.toList()));
        queues.put("AUX", auxQueue.stream().map(SimulationProcess::getId).collect(Collectors.toList()));
        long completed = allProcesses.stream().filter(p -> p.getState() == ProcessState.DONE).count();

        return TickSnapshot.builder()
                .tick(tick)
                .algorithmType(AlgorithmType.VRR)
                .runningProcessId(running != null ? running.getId() : null)
                .runningProcessName(running != null ? running.getName() : null)
                .queues(queues)
                .completedCount((int) completed)
                .totalProcesses(allProcesses.size())
                .cpuBusyRatio(tick > 0 ? (double) busyTicks / (tick + 1) : 0)
                .build();
    }

    @Override
    public boolean isFinished() {
        return allProcesses.stream().allMatch(p -> p.getState() == ProcessState.DONE)
                && readyQueue.isEmpty() && auxQueue.isEmpty() && running == null;
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
