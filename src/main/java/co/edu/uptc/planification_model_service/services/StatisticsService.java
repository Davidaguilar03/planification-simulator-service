package co.edu.uptc.planification_model_service.services;

import co.edu.uptc.planification_model_service.models.SimulationProcess;
import co.edu.uptc.planification_model_service.models.SimulationStats;
import co.edu.uptc.planification_model_service.models.enums.AlgorithmType;
import co.edu.uptc.planification_model_service.models.enums.ProcessState;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class StatisticsService {

    public SimulationStats compute(AlgorithmType algorithmType,
                                   List<SimulationProcess> processes,
                                   int totalTicks,
                                   int busyTicks) {
        List<SimulationProcess> completed = processes.stream()
                .filter(p -> p.getState() == ProcessState.DONE)
                .toList();

        int n = completed.size();
        double cpuUtilization = totalTicks > 0 ? ((double) busyTicks / totalTicks) * 100.0 : 0.0;
        double throughput = totalTicks > 0 ? (double) n / totalTicks : 0.0;

        double avgTurnaround = n > 0
                ? completed.stream().mapToInt(SimulationProcess::getTurnaroundTime).average().orElse(0.0) : 0.0;
        double avgWaiting = n > 0
                ? completed.stream().mapToInt(SimulationProcess::getWaitingTime).average().orElse(0.0) : 0.0;
        double avgResponse = n > 0
                ? completed.stream().mapToInt(SimulationProcess::getResponseTime).average().orElse(0.0) : 0.0;

        return SimulationStats.builder()
                .algorithmType(algorithmType)
                .cpuUtilization(round2(cpuUtilization))
                .throughput(round4(throughput))
                .avgTurnaroundTime(round2(avgTurnaround))
                .avgWaitingTime(round2(avgWaiting))
                .avgResponseTime(round2(avgResponse))
                .fairnessIndex(round4(computeJainFairness(completed)))
                .totalTicks(totalTicks)
                .completedProcesses(n)
                .build();
    }

    private double computeJainFairness(List<SimulationProcess> completed) {
        if (completed.isEmpty()) return 0.0;
        double sum = 0.0;
        double sumSq = 0.0;
        for (SimulationProcess p : completed) {
            double w = p.getWaitingTime();
            sum += w;
            sumSq += w * w;
        }
        if (sumSq == 0.0) return 1.0;
        return (sum * sum) / ((double) completed.size() * sumSq);
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private double round4(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
