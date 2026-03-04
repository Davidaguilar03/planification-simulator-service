package co.edu.uptc.planification_model_service.models;

import co.edu.uptc.planification_model_service.models.enums.ProcessState;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationProcess {
    private String id;
    private String name;
    private int arrivalTime;
    private int burstTime;
    private int priority;
    private Integer batchGroup;

    private int remainingTime;
    private int waitingTime;
    private int responseTime;
    private int turnaroundTime;
    private int firstRunTick;
    private int completionTick;
    private boolean hasStarted;
    private ProcessState state;

    private int currentQueueLevel;
    private int currentQuantumUsed;
    private int remainingQuantum;

    public static SimulationProcess from(ProcessDefinition def) {
        return SimulationProcess.builder()
                .id(def.getId())
                .name(def.getName())
                .arrivalTime(def.getArrivalTime())
                .burstTime(def.getBurstTime())
                .priority(def.getPriority())
                .batchGroup(def.getBatchGroup())
                .remainingTime(def.getBurstTime())
                .waitingTime(0)
                .responseTime(0)
                .turnaroundTime(0)
                .firstRunTick(-1)
                .completionTick(-1)
                .hasStarted(false)
                .state(ProcessState.NEW)
                .currentQueueLevel(0)
                .currentQuantumUsed(0)
                .remainingQuantum(0)
                .build();
    }
}
