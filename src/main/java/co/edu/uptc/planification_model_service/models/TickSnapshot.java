package co.edu.uptc.planification_model_service.models;

import co.edu.uptc.planification_model_service.models.enums.AlgorithmType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TickSnapshot {
    private int tick;
    private AlgorithmType algorithmType;
    private String runningProcessId;
    private String runningProcessName;
    private Map<String, List<String>> queues;
    private int completedCount;
    private int totalProcesses;
    private double cpuBusyRatio;
}
