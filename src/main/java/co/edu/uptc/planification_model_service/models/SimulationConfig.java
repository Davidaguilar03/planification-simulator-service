package co.edu.uptc.planification_model_service.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SimulationConfig {
    private String simulationId;
    private List<ProcessDefinition> processes;

    @Builder.Default
    private int tickIntervalMs = 500;

    @Builder.Default
    private int[] mlfqQuantums = {2, 4, 8};

    @Builder.Default
    private int vrrQuantum = 4;

    @Builder.Default
    private boolean batchMode = false;
}
