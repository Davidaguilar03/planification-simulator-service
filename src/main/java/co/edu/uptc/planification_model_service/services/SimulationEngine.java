package co.edu.uptc.planification_model_service.services;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

import co.edu.uptc.planification_model_service.models.SimulationConfig;
import co.edu.uptc.planification_model_service.models.SimulationProcess;
import co.edu.uptc.planification_model_service.models.SimulationResult;
import co.edu.uptc.planification_model_service.models.SimulationStats;
import co.edu.uptc.planification_model_service.models.TickSnapshot;
import co.edu.uptc.planification_model_service.models.enums.AlgorithmType;
import co.edu.uptc.planification_model_service.models.enums.SimulationState;
import co.edu.uptc.planification_model_service.services.algorithms.MlfqScheduler;
import co.edu.uptc.planification_model_service.services.algorithms.SchedulingAlgorithm;
import co.edu.uptc.planification_model_service.services.algorithms.SrtfScheduler;
import co.edu.uptc.planification_model_service.services.algorithms.VrrScheduler;
import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class SimulationEngine {

    private final SimpMessagingTemplate messagingTemplate;
    private final StatisticsService statisticsService;
    private final TaskScheduler taskScheduler;
    private final Map<String, SimulationSession> sessions = new ConcurrentHashMap<>();

    public SimulationEngine(SimpMessagingTemplate messagingTemplate,
                            StatisticsService statisticsService,
                            TaskScheduler taskScheduler) {
        this.messagingTemplate = messagingTemplate;
        this.statisticsService = statisticsService;
        this.taskScheduler = taskScheduler;
    }

    public SimulationResult start(SimulationConfig config) {
        String id = config.getSimulationId() != null
                ? config.getSimulationId()
                : UUID.randomUUID().toString();
        config.setSimulationId(id);

        SimulationSession session = new SimulationSession(config);
        sessions.put(id, session);
        scheduleSession(session);

        return buildResult(session);
    }

    public void stop(String sessionId) {
        SimulationSession session = sessions.get(sessionId);
        if (session == null) return;
        synchronized (session) {
            if (session.getState() == SimulationState.DONE || session.getState() == SimulationState.STOPPED) {
                return;
            }
            session.cancel();
            int currentTick = Math.max(0, session.getCurrentTick().get());
            List<SimulationStats> statsList = new ArrayList<>();
            for (Map.Entry<AlgorithmType, SchedulingAlgorithm> entry : session.getAlgorithms().entrySet()) {
                statsList.add(statisticsService.compute(
                        entry.getKey(),
                        entry.getValue().getProcesses(),
                        currentTick,
                        entry.getValue().getBusyTicks()));
            }
            session.setStats(statsList);
            session.setState(SimulationState.STOPPED);
        }
    }

    public void pause(String sessionId) {
        SimulationSession session = sessions.get(sessionId);
        if (session == null) return;
        synchronized (session) {
            if (session.getState() != SimulationState.RUNNING) return;
            session.cancel();
            session.setState(SimulationState.PAUSED);
        }
    }

    public void resume(String sessionId) {
        SimulationSession session = sessions.get(sessionId);
        if (session == null) return;
        synchronized (session) {
            if (session.getState() != SimulationState.PAUSED) return;
            scheduleSession(session);
        }
    }

    public void stepForward(String sessionId) {
        SimulationSession session = sessions.get(sessionId);
        if (session == null) return;
        synchronized (session) {
            if (session.getState() != SimulationState.PAUSED) return;
            executeTickInternal(session, false);
        }
    }

    public void setSpeed(String sessionId, int tickIntervalMs) {
        SimulationSession session = sessions.get(sessionId);
        if (session == null) return;
        synchronized (session) {
            session.cancel();
            session.getConfig().setTickIntervalMs(tickIntervalMs);
            if (session.getState() == SimulationState.RUNNING) {
                scheduleSession(session);
            }
        }
    }

    public SimulationResult getResult(String sessionId) {
        SimulationSession session = sessions.get(sessionId);
        if (session == null) return null;
        return buildResult(session);
    }

    public SimulationState getStatus(String sessionId) {
        SimulationSession session = sessions.get(sessionId);
        return session == null ? null : session.getState();
    }

    public List<TickSnapshot> getSnapshots(String sessionId, AlgorithmType algorithmType, int from, int to) {
        SimulationSession session = sessions.get(sessionId);
        if (session == null) return Collections.emptyList();
        List<TickSnapshot> full = session.getHistory().getOrDefault(algorithmType.name(), Collections.emptyList());
        int start = Math.max(0, from);
        int end = Math.min(full.size(), to + 1);
        if (start >= end) return Collections.emptyList();
        return full.subList(start, end);
    }

    private void scheduleSession(SimulationSession session) {
        Duration interval = Duration.ofMillis(session.getConfig().getTickIntervalMs());
        ScheduledFuture<?> future = taskScheduler.scheduleAtFixedRate(
                () -> executeTickScheduled(session), interval);
        session.setFuture(future);
        session.setState(SimulationState.RUNNING);
    }

    private void executeTickScheduled(SimulationSession session) {
        synchronized (session) {
            if (session.getState() != SimulationState.RUNNING) return;
            executeTickInternal(session, true);
        }
    }

    private void executeTickInternal(SimulationSession session, boolean keepRunning) {
        int tick = session.getCurrentTick().getAndIncrement();
        boolean allDone = true;

        for (Map.Entry<AlgorithmType, SchedulingAlgorithm> entry : session.getAlgorithms().entrySet()) {
            SchedulingAlgorithm alg = entry.getValue();
            if (!alg.isFinished()) {
                TickSnapshot snapshot = alg.tick(tick);
                session.getHistory()
                        .computeIfAbsent(entry.getKey().name(), k -> new ArrayList<>())
                        .add(snapshot);
                messagingTemplate.convertAndSend(
                        "/topic/simulation/" + session.getConfig().getSimulationId() + "/tick",
                        snapshot);
                allDone = false;
            } else {
                List<TickSnapshot> hist = session.getHistory().get(entry.getKey().name());
                if (hist != null && !hist.isEmpty()) {
                    messagingTemplate.convertAndSend(
                            "/topic/simulation/" + session.getConfig().getSimulationId() + "/tick",
                            hist.get(hist.size() - 1));
                }
            }
        }

        if (allDone) {
            finalizeSimulation(session, tick);
            return;
        }

        if (!keepRunning && session.getState() == SimulationState.PAUSED) {
            session.cancel();
        }
    }

    private void finalizeSimulation(SimulationSession session, int finalTick) {
        session.cancel();
        session.setState(SimulationState.DONE);

        List<SimulationStats> statsList = new ArrayList<>();
        for (Map.Entry<AlgorithmType, SchedulingAlgorithm> entry : session.getAlgorithms().entrySet()) {
            statsList.add(statisticsService.compute(
                    entry.getKey(),
                    entry.getValue().getProcesses(),
                    finalTick,
                    entry.getValue().getBusyTicks()));
        }
        session.setStats(statsList);

        messagingTemplate.convertAndSend(
                "/topic/simulation/" + session.getConfig().getSimulationId() + "/result",
                buildResult(session));
        log.info("Simulation {} finished at tick {}", session.getConfig().getSimulationId(), finalTick);
    }

    private SimulationResult buildResult(SimulationSession session) {
        return SimulationResult.builder()
                .simulationId(session.getConfig().getSimulationId())
                .config(session.getConfig())
                .state(session.getState())
                .currentTick(session.getCurrentTick().get())
                .stats(session.getStats())
                .tickHistory(session.getHistory())
                .build();
    }

    @Getter
    public static class SimulationSession {
        private final SimulationConfig config;
        private final Map<AlgorithmType, SchedulingAlgorithm> algorithms = new LinkedHashMap<>();
        private final Map<String, List<TickSnapshot>> history = new ConcurrentHashMap<>();
        private final AtomicInteger currentTick = new AtomicInteger(0);
        @Setter private volatile SimulationState state = SimulationState.STOPPED;
        @Setter private volatile ScheduledFuture<?> future;
        @Setter private List<SimulationStats> stats = new ArrayList<>();

        public SimulationSession(SimulationConfig config) {
            this.config = config;
            initAlgorithms();
        }

        private void initAlgorithms() {
            VrrScheduler vrr = new VrrScheduler();
            vrr.initialize(copyProcesses(), config);
            algorithms.put(AlgorithmType.VRR, vrr);

            MlfqScheduler mlfq = new MlfqScheduler();
            mlfq.initialize(copyProcesses(), config);
            algorithms.put(AlgorithmType.MLFQ, mlfq);

            SrtfScheduler srtf = new SrtfScheduler();
            srtf.initialize(copyProcesses(), config);
            algorithms.put(AlgorithmType.SRTF, srtf);
        }

        private List<SimulationProcess> copyProcesses() {
            return config.getProcesses().stream()
                    .map(SimulationProcess::from)
                    .collect(Collectors.toList());
        }

        public void cancel() {
            if (future != null && !future.isCancelled()) {
                future.cancel(false);
            }
        }
    }
}
