package co.edu.uptc.planification_model_service.models;

import co.edu.uptc.planification_model_service.models.enums.AlgorithmType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationStats {
    private AlgorithmType algorithmType;
    private double cpuUtilization;        // percentage 0-100
    private double throughput;             // processes per tick
    private double avgTurnaroundTime;
    private double avgWaitingTime;
    private double avgResponseTime;
    private double fairnessIndex;          // Jain's fairness index 0-1
    private int totalTicks;
    private int completedProcesses;
}

